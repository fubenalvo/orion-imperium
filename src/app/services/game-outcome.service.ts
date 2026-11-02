import { Injectable } from '@angular/core';
import { Faction, Fleet, PlanetTile, StarMapData, StarSystem } from '../components/star-map/star-map.models';
import { getRelationKind } from '../components/star-map/diplomacy';

/*
 * Diplomatic victory guard: when some surviving AI factions are only at
 * peace (not defeated), the allied side must own strictly more than this
 * share of all inhabited planets. Without it, signing peace with every AI
 * early in the game would be an instant win.
 */
export const DIPLOMATIC_VICTORY_PLANET_SHARE = 0.5;

export type GameOutcome = 'inProgress' | 'victory' | 'defeat';

/*
 * =========================================================
 * GAME OUTCOME SERVICE
 * =========================================================
 *
 * Outcome rules (from the human player's perspective; "allied" = the
 * player plus non-AI factions on the player's non-neutral team):
 *
 *  1. Terminal outcomes are sticky: once a save carries 'victory' or
 *     'defeat' it is returned unchanged, so later ticks can never
 *     overwrite it.
 *  1b. Dyson Swarm (docs/dyson-swarm.md): a completed warm-up in the save
 *     (dysonWarmup.remaining 0) decides the game for its holder: victory
 *     when the holder is allied, defeat otherwise. The warm-up only runs
 *     while the holder owns a planet, so it never contradicts rule 2.
 *  2. Defeat (= AI victory): the allied side owns no planet at all AND
 *     has no fleet carrying a living colonizer. Any owned planet (even an
 *     empty one) can still build, and a colonizer can found a new colony;
 *     warships alone do not count — without a planet there is no income,
 *     no repair and no production, so a planetless empire with only
 *     warships is treated as eliminated (it used to soft-lock the game in
 *     'inProgress'). Ships in the global stock do not count either:
 *     without an owned Spaceport they can never leave the stock.
 *     Elimination is checked first, so defeat is reachable even while
 *     hostile planets exist.
 *  3. Victory: every inhabited planet (population > 0 or any building) is
 *     allied or owned by an AI faction at peace with the player —
 *     independent (rebel) planets therefore still block victory, while
 *     independent civilization planets (`PlanetTile.civilization`) never
 *     count at all — and no
 *     AI faction at war with the player has a living fleet. Peace partners
 *     do not block victory (diplomatic victory, docs/diplomacy.md), but if
 *     any of them still owns an inhabited planet the allied side must own
 *     more than DIPLOMATIC_VICTORY_PLANET_SHARE of the inhabited planets.
 *  4. Otherwise the game is in progress.
 *
 * Rules 2 and 3 are mutually exclusive: victory requires at least one
 * allied inhabited planet, defeat requires none.
 */
@Injectable({ providedIn: 'root' })
export class GameOutcomeService {
  private lastOutcome: GameOutcome = 'inProgress';

  getLastOutcome(): GameOutcome { return this.lastOutcome; }
  reset(): void { this.lastOutcome = 'inProgress'; }
  setLastOutcome(outcome: GameOutcome): void { this.lastOutcome = outcome; }

  evaluate(data: StarMapData): GameOutcome {
    if (data.gameOutcome === 'victory' || data.gameOutcome === 'defeat') {
      this.lastOutcome = data.gameOutcome;
      return data.gameOutcome;
    }
    const dyson = data.dysonWarmup;
    if (dyson && typeof dyson.factionId === 'string' && dyson.remaining <= 0) {
      const outcome: GameOutcome = this.alliedFactionIds(data.factions).has(dyson.factionId) ? 'victory' : 'defeat';
      this.lastOutcome = outcome;
      return outcome;
    }
    const outcome = this.evaluateOutcome(data.factions, data.starSystems, data.fleets);
    this.lastOutcome = outcome;
    return outcome;
  }

  /* The player plus non-AI factions on the player's non-neutral team. */
  alliedFactionIds(factions: readonly Faction[]): Set<string> {
    const player = factions.find((f) => f.id === 'player');
    const allied = new Set<string>(['player']);
    for (const faction of factions) {
      if (faction.id === 'player' || !player) continue;
      if (faction.ai === false && faction.team !== 0 && faction.team === player.team) allied.add(faction.id);
    }
    return allied;
  }

  evaluateOutcome(factions: Faction[], starSystems: StarSystem[], fleets: Fleet[]): GameOutcome {
    const playerFaction = factions.find(f => f.id === 'player');
    if (!playerFaction) return 'defeat';

    const aiFactionIds = factions.filter(f => f.ai === true).map(f => f.id);
    const alliedFactionIds = new Set<string>();
    alliedFactionIds.add('player');
    for (const faction of factions) {
      if (faction.id === 'player') continue;
      if (faction.ai === false && faction.team !== 0 && faction.team === playerFaction.team) {
        alliedFactionIds.add(faction.id);
      }
    }

    const allPlanets = starSystems.flatMap((system) => system.planetsTiles ?? []);
    const alliedOwnsAnyPlanet = allPlanets.some((p) => alliedFactionIds.has(p.factionId));
    const alliedHasColonizer = [...alliedFactionIds].some((id) => this.hasLivingColonizer(fleets, id));
    if (!alliedOwnsAnyPlanet && !alliedHasColonizer) {
      return 'defeat';
    }

    const inhabitedPlanets: PlanetTile[] = [];
    for (const planet of allPlanets) {
      if (planet.factionId === 'unhabited') continue;
      // Independent civilizations take no part in the final reckoning: they
      // never block a conquest victory (a captured one counts as usual).
      if (planet.factionId === 'independent' && planet.civilization !== undefined) continue;
      if ((planet.population ?? 0) <= 0 && !(planet.buildings ?? []).length) continue;
      inhabitedPlanets.push(planet);
    }

    if (inhabitedPlanets.length === 0) {
      return this.lastOutcome === 'victory' ? 'victory' : 'inProgress';
    }

    const peacePartnerIds = new Set(
      factions
        .filter((f) => f.ai === true && getRelationKind(playerFaction, f) === 'peace')
        .map((f) => f.id),
    );

    let alliedPlanets = 0;
    let peacePartnerPlanets = 0;
    for (const planet of inhabitedPlanets) {
      if (alliedFactionIds.has(planet.factionId)) {
        alliedPlanets++;
      } else if (peacePartnerIds.has(planet.factionId)) {
        peacePartnerPlanets++;
      } else {
        return 'inProgress';
      }
    }

    if (peacePartnerPlanets > 0 && alliedPlanets / inhabitedPlanets.length <= DIPLOMATIC_VICTORY_PLANET_SHARE) {
      return 'inProgress';
    }

    for (const factionId of aiFactionIds) {
      if (alliedFactionIds.has(factionId) || peacePartnerIds.has(factionId)) continue;
      if (this.hasSurvivingFleet(fleets, factionId)) return 'inProgress';
    }

    return 'victory';
  }

  private hasLivingColonizer(fleets: Fleet[], factionId: string): boolean {
    return (fleets ?? []).some((fleet) =>
      fleet.factionId === factionId
      && !fleet.destroyed
      && (fleet.ships ?? []).some((s) => s.type === 'colonizer' && s.destroyed !== true));
  }

  private hasSurvivingFleet(fleets: Fleet[], factionId: string): boolean {
    for (const fleet of fleets ?? []) {
      if (fleet.factionId !== factionId) continue;
      if (fleet.destroyed) continue;
      if ((fleet.ships ?? []).some(s => s.destroyed !== true)) return true;
    }
    return false;
  }
}

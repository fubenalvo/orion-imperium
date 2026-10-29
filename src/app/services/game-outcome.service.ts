import { Injectable } from '@angular/core';
import { Faction, Fleet, PlanetTile, StarMapData, StarSystem } from '../components/star-map/star-map.models';

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
 *  2. Defeat (= AI victory): the allied side is eliminated — it owns no
 *     planet at all AND has no fleet with a living ship. While it still
 *     has either, a recovery route exists: a fleet can colonize (with a
 *     colonizer) or capture undefended / independent planets, and any
 *     owned planet can still build. Ships in the global stock do not
 *     count: without an owned Spaceport they can never leave the stock.
 *     Elimination is checked first, so defeat is reachable even while
 *     hostile planets exist (that ordering was the original bug).
 *  3. Victory: every inhabited planet (population > 0 or any building) is
 *     allied — independent (rebel) planets therefore still block victory
 *     — and no hostile AI faction has a living fleet.
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
    const outcome = this.evaluateOutcome(data.factions, data.starSystems, data.fleets);
    this.lastOutcome = outcome;
    return outcome;
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
    const alliedHasFleet = [...alliedFactionIds].some((id) => this.hasSurvivingFleet(fleets, id));
    if (!alliedOwnsAnyPlanet && !alliedHasFleet) {
      return 'defeat';
    }

    const inhabitedPlanets: PlanetTile[] = [];
    for (const planet of allPlanets) {
      if (planet.factionId === 'unhabited') continue;
      if ((planet.population ?? 0) <= 0 && !(planet.buildings ?? []).length) continue;
      inhabitedPlanets.push(planet);
    }

    if (inhabitedPlanets.length === 0) {
      return this.lastOutcome === 'victory' ? 'victory' : 'inProgress';
    }

    for (const planet of inhabitedPlanets) {
      if (!alliedFactionIds.has(planet.factionId)) return 'inProgress';
    }

    for (const factionId of aiFactionIds) {
      if (alliedFactionIds.has(factionId)) continue;
      if (this.hasSurvivingFleet(fleets, factionId)) return 'inProgress';
    }

    return 'victory';
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

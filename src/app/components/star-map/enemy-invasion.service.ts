import { Injectable } from '@angular/core';
import { Faction, FactionProduction, Fleet, PlanetTile, StarSystem, PLANET_TYPE_COLORS } from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService, VirtualDefenseFleet } from '../../services/planet-battle.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { BattleOutcomeService } from '../../services/battle-outcome.service';
import { Battle } from '../battle-screen/battle/battle.types';
import { autoResolveBattle } from '../battle-screen/battle/battle-auto-resolve';

/*
 * =========================================================
 * ENEMY INVASION SERVICE (AI planet capture)
 * =========================================================
 *
 * Galaxy-level planet capture for AI fleets. Unlike
 * StarMapPlanetArrivalService (which only runs for the star system the
 * player is viewing and needs system-view positions), everything here
 * works on galaxy-map cells and never depends on the player's view.
 *
 * Capture rules mirror the player's arrival rules:
 *  - only planets owned by another team (including neutral team 0, e.g.
 *    independent rebels) can be attacked — never own or allied planets;
 *  - a planet without combat defenses (no turret; a shield alone does
 *    not fight) is captured on arrival;
 *  - a defended planet is taken only by winning a planet battle.
 *
 * Battles:
 *  - Defender is the human player → the battle is queued for the
 *    interactive battle screen (StarMap takes it via
 *    StarMapAiTickService.takePendingPlayerBattle), exactly like a
 *    player-initiated planet battle. The player defends, may use AUTO,
 *    and the battle screen applies the result through BattleOutcomeService.
 *  - Any other defender → resolved immediately by autoResolveBattle (the
 *    minigame's combat rules without the grid; see battle-auto-resolve.ts
 *    for the simplifications) and applied through the same
 *    BattleOutcomeService. Both sides take losses; the planet changes
 *    owner only on attacker victory; a draw (time limit) leaves it with
 *    the defender.
 *
 * Garrisons: a defender fleet parked in the target system would already
 * have met the attackers in a fleet battle (collision detection) before
 * any planet battle, so invasions model the planet's own defenses only.
 *
 * All ownership changes go through PlanetOwnershipService.
 */
export type InvasionResult = 'captured' | 'repelled' | 'pending_player' | 'invalid';

export interface InvasionData {
  factions: Faction[];
  starSystems: StarSystem[];
  fleets: Fleet[];
  production: FactionProduction[];
}

@Injectable({ providedIn: 'root' })
export class EnemyInvasionService {
  // Ids that cannot collide with real fleets (virtual defense uses -planet.id).
  private static readonly FORECAST_FLEET_ID = -999_999;
  private readonly pendingPlayerBattles: Battle[] = [];

  constructor(
    private readonly shipService: ShipService,
    private readonly planetBattleService: PlanetBattleService,
    private readonly planetOwnership: PlanetOwnershipService,
    private readonly battleOutcomeService: BattleOutcomeService,
  ) {}

  reset(): void {
    this.pendingPlayerBattles.length = 0;
  }

  /* Next queued player-defended battle, removed from the queue. */
  takePendingPlayerBattle(): Battle | undefined {
    return this.pendingPlayerBattles.shift();
  }

  hasPendingBattleFor(planetId: number): boolean {
    return this.pendingPlayerBattles.some((b) => b.planetId === planetId);
  }

  /* Hostile = owned (not 'unhabited') by a faction on another team. */
  isHostilePlanet(planet: PlanetTile, attacker: Faction, factions: Faction[]): boolean {
    if (planet.factionId === 'unhabited' || planet.factionId === attacker.id) {
      return false;
    }
    const owner = factions.find((f) => f.id === planet.factionId);
    return owner !== undefined && owner.team !== attacker.team;
  }

  /*
   * forecast: Fights the battle the group would fight, with the same
   * resolver, without touching game state. Returns whether the attacker
   * wins and the share of its strength that would survive.
   */
  forecast(group: Fleet[], planet: PlanetTile, factions: Faction[]): { win: boolean; survivingRatio: number } {
    const attacker = group[0];
    const ships = group.flatMap((f) => f.ships.filter((s) => !s.destroyed)).map((s) => ({ ...s }));
    const before = this.shipService.calculateFleetStrength(ships);
    if (!this.planetBattleService.hasPlanetDefenses(planet)) {
      return { win: true, survivingRatio: 1 };
    }
    const defense = this.planetBattleService.createVirtualDefenseFleet(planet, null);
    if (defense.ships.length === 0) {
      return { win: true, survivingRatio: 1 };
    }
    const composite: Fleet = { ...attacker, id: EnemyInvasionService.FORECAST_FLEET_ID, ships };
    const battle = this.buildBattle(composite, defense, planet, factions);
    const { outcome } = autoResolveBattle(battle, this.shipService, this.planetBattleService);
    const surviving = outcome.attacker.ships.filter((s) => !s.destroyed).map((s) => ({ type: s.typeId }));
    const after = this.shipService.calculateFleetStrength(surviving);
    return { win: outcome.winnerSide === 'attacker', survivingRatio: before > 0 ? after / before : 0 };
  }

  /*
   * forecastFleetBattle: Fleet-vs-fleet forecast with the battle rules
   * (autoResolveBattle on composite copies; game state untouched). Used by
   * EnemyFleetService to judge interceptions and retreats. `survivingRatio`
   * is the share of the attackers' strength left alive.
   */
  forecastFleetBattle(attackers: Fleet[], defenders: Fleet[]): { win: boolean; survivingRatio: number } {
    const attackerShips = attackers.flatMap((f) => f.ships.filter((s) => !s.destroyed)).map((s) => ({ ...s }));
    const defenderShips = defenders.flatMap((f) => f.ships.filter((s) => !s.destroyed)).map((s) => ({ ...s }));
    if (attackerShips.length === 0) {
      return { win: false, survivingRatio: 0 };
    }
    if (defenderShips.length === 0) {
      return { win: true, survivingRatio: 1 };
    }
    const attacker: Fleet = { ...attackers[0], id: EnemyInvasionService.FORECAST_FLEET_ID, ships: attackerShips };
    const defender: Fleet = { ...defenders[0], id: EnemyInvasionService.FORECAST_FLEET_ID - 1, ships: defenderShips };
    const battle = {
      fleet1: attacker,
      fleet2: defender,
      faction1Name: attacker.factionId,
      faction1Color: '#ffffff',
      faction2Name: defender.factionId,
      faction2Color: '#ffffff',
      attackerId: attacker.id,
      defenderId: defender.id,
    } as Battle;
    const { outcome } = autoResolveBattle(battle, this.shipService, this.planetBattleService);
    const before = this.shipService.calculateFleetStrength(attackerShips);
    const after = this.shipService.calculateFleetStrength(
      outcome.attacker.ships.filter((s) => !s.destroyed).map((s) => ({ type: s.typeId })),
    );
    return { win: outcome.winnerSide === 'attacker', survivingRatio: before > 0 ? after / before : 0 };
  }

  /*
   * launch: Executes an assault by the group, which must already be in
   * the target system's galaxy cell. Co-located group fleets are merged
   * into the leader first (a real merge: same place, no teleport), so the
   * battle has one real attacker fleet whose roster the outcome writes.
   */
  launch(group: Fleet[], planet: PlanetTile, system: StarSystem, data: InvasionData): InvasionResult {
    const attackerFaction = data.factions.find((f) => f.id === group[0]?.factionId);
    if (!attackerFaction || !this.isHostilePlanet(planet, attackerFaction, data.factions)) {
      return 'invalid';
    }
    const present = group.filter(
      (f) => !f.destroyed && f.ships.some((s) => !s.destroyed) && this.inCell(f, system),
    );
    if (present.length === 0) {
      return 'invalid';
    }
    if (this.hasPendingBattleFor(planet.id)) {
      return 'pending_player';
    }

    const leader = this.mergeInto(present);

    const defense = this.planetBattleService.hasPlanetDefenses(planet)
      ? this.planetBattleService.createVirtualDefenseFleet(planet, null)
      : null;
    if (!defense || defense.ships.length === 0) {
      return this.planetOwnership.transferPlanet(data, planet, leader.factionId, 'captured') ? 'captured' : 'invalid';
    }

    const battle = this.buildBattle(leader, defense, planet, data.factions);
    const defenderFaction = data.factions.find((f) => f.id === planet.factionId);
    if (defenderFaction && defenderFaction.ai !== true && defenderFaction.team !== 0) {
      this.pendingPlayerBattles.push(battle);
      return 'pending_player';
    }

    const { outcome } = autoResolveBattle(battle, this.shipService, this.planetBattleService);
    const captured = this.battleOutcomeService.applyPlanetBattleOutcome(data, battle, outcome);
    leader.targetX = null;
    leader.targetY = null;
    return captured ? 'captured' : 'repelled';
  }

  private mergeInto(fleets: Fleet[]): Fleet {
    const sorted = [...fleets].sort((a, b) => a.id - b.id);
    const leader = sorted[0];
    for (const donor of sorted.slice(1)) {
      leader.ships.push(...donor.ships.filter((s) => !s.destroyed));
      donor.ships = donor.ships.filter((s) => s.destroyed);
      donor.destroyed = true;
      donor.targetX = null;
      donor.targetY = null;
    }
    return leader;
  }

  private buildBattle(attacker: Fleet, defense: VirtualDefenseFleet, planet: PlanetTile, factions: Faction[]): Battle {
    const attackerFaction = factions.find((f) => f.id === attacker.factionId);
    const defenderFaction = factions.find((f) => f.id === planet.factionId);
    return {
      fleet1: attacker,
      fleet2: defense,
      faction1Name: attackerFaction?.name ?? attacker.factionId,
      faction1Color: attackerFaction?.color ?? '#ffffff',
      faction2Name: defenderFaction?.name ?? planet.factionId,
      faction2Color: defenderFaction?.color ?? '#ffffff',
      attackerId: attacker.id,
      defenderId: defense.id,
      type: 'planet',
      planetId: planet.id,
      planetName: planet.name,
      planetColor: PLANET_TYPE_COLORS[planet.type] ?? '#ffffff',
    } as Battle;
  }

  private inCell(fleet: Fleet, system: StarSystem): boolean {
    return Math.floor(fleet.x) === Math.floor(system.x) && Math.floor(fleet.y) === Math.floor(system.y);
  }
}

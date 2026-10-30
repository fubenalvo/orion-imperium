import { Injectable } from '@angular/core';
import { ResearchService } from '../../services/research.service';
import { BattleService } from '../../services/battle.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { Faction, FactionProduction, Fleet, PlanetTile, StarSystem, PLANET_TYPE_COLORS } from './star-map.models';
import { StarMapMovementService } from './star-map-movement.service';
import { canAttackPlanetOf } from './diplomacy';

/*
 * =========================================================
 * STAR MAP PLANET ARRIVAL SERVICE
 * =========================================================
 *
 * Handles fleet arrivals on planet grid cells inside the
 * system view the player is watching: orbiting on own/teammate
 * planets, capturing undefended planets, and triggering planet
 * battles against defended ones.
 *
 * Colonization is NOT an arrival effect. A player fleet carrying
 * a colonizer that stops on an uninhabited planet only parks
 * there; the player colonizes explicitly with the fleet panel's
 * COLONIZE button (getColonizablePlanet + colonize). This keeps
 * the colonizer under the player's control (e.g. passing through
 * or waiting on a planet). AI fleets colonize through
 * EnemyActionExecutor on galaxy cells and never through here.
 *
 * The service owns the per-fleet arrival bookkeeping and the
 * triggered-battle registry (shared with the collision-based
 * battle detection so a garrison battle is never triggered
 * twice). It holds no game state beyond those bookkeeping
 * structures; live game state and the side-effect callbacks
 * (autosave, battle-screen navigation) come from the caller
 * via PlanetArrivalContext, mirroring the callback style of
 * StarMapBattleDetectionService.
 */
export interface PlanetArrivalContext {
  fleets: Fleet[];
  currentView: 'map' | 'system' | 'planet';
  selectedSystem: StarSystem | null;
  factions: Faction[];
  // Lets ownership transfers cancel the previous owner's orders on the planet.
  production?: FactionProduction[];
  saveGame: () => void;
  enterBattleScreen: () => void;
}

@Injectable({ providedIn: 'root' })
export class StarMapPlanetArrivalService {
  // Tracks which fleet is currently on which planet grid cell to log arrivals
  private fleetPlanetMap = new Map<number, number>();

  // Battle tracking (fleet pair keys already triggered)
  readonly triggeredBattles = new Set<string>();

  constructor(
    private planetBattleService: PlanetBattleService,
    private battleService: BattleService,
    private movementService: StarMapMovementService,
    private planetOwnership: PlanetOwnershipService,
    private researchService: ResearchService,
  ) {}

  /** Clears per-session arrival bookkeeping. Safe to call on every load. */
  reset(): void {
    this.fleetPlanetMap.clear();
    this.triggeredBattles.clear();
  }

  /** Checks if any fleet arrived at a planet's grid cell and handles the interaction. */
  checkFleetPlanetArrivals(ctx: PlanetArrivalContext): void {
    if (ctx.currentView !== 'system' || !ctx.selectedSystem) {
      return;
    }

    for (const fleet of ctx.fleets) {
      if (fleet.destroyed || fleet.system?.id !== ctx.selectedSystem.id) {
        continue;
      }
      if (!this.hasLivingShips(fleet) || this.isMovingInSystem(fleet)) {
        continue;
      }

      const planet = this.findPlanetUnderFleet(fleet, ctx.selectedSystem);
      if (!planet || this.fleetPlanetMap.get(fleet.id) === planet.id) {
        continue;
      }

      this.fleetPlanetMap.set(fleet.id, planet.id);
      this.handleFleetPlanetArrival(fleet, planet, ctx);
    }
  }

  /*
   * The uninhabited planet a fleet can colonize right now: the fleet is
   * stopped on the planet's cell inside a system and carries a living
   * colonizer. Works in every view, since fleet.system keeps its in-system
   * position until the fleet leaves the system on the galaxy map.
   */
  getColonizablePlanet(fleet: Fleet, starSystems: StarSystem[]): PlanetTile | null {
    if (fleet.destroyed || !fleet.system || this.isMovingInSystem(fleet) || !this.hasLivingColonizer(fleet)) {
      return null;
    }
    const system = starSystems.find((s) => s.id === fleet.system!.id);
    const planet = system ? this.findPlanetUnderFleet(fleet, system) : null;
    return planet?.factionId === 'unhabited' ? planet : null;
  }

  /*
   * Colonizes `planet` with `fleet` (player COLONIZE command). Consumes one
   * colonizer and transfers ownership through the single ownership pathway.
   * A fleet left without living ships is retired the way the AI executor and
   * fleet organization retire fleets. Returns null when the command is no
   * longer valid (re-checked here because the button can be stale).
   */
  colonize(
    fleet: Fleet,
    planet: PlanetTile,
    data: { production?: FactionProduction[]; factions?: Faction[] },
  ): { fleetRetired: boolean } | null {
    if (planet.factionId !== 'unhabited' || fleet.destroyed) {
      return null;
    }
    const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
    if (!result.colonized || result.colonizerIndex < 0) {
      return null;
    }

    fleet.ships.splice(result.colonizerIndex, 1);
    this.planetOwnership.transferPlanet(data, planet, fleet.factionId, 'colonized');

    const fleetRetired = !this.hasLivingShips(fleet);
    if (fleetRetired) {
      fleet.destroyed = true;
      fleet.targetX = null;
      fleet.targetY = null;
      fleet.interceptAsteroidId = null;
      fleet.attackFleetId = null;
    }
    return { fleetRetired };
  }

  /*
   * Player colonizer fleets in `system` for the planet panel's guidance:
   * the one parked on `planet` (ready to colonize), the one ordered onto it,
   * and whether any carrier is in the system at all.
   */
  getColonizationCarriers(
    fleets: Fleet[],
    system: StarSystem,
    planet: PlanetTile,
  ): { carriers: Fleet[]; parked: Fleet | null; enRoute: Fleet | null } {
    const planetCell = this.movementService.getPlanetGridPosition(planet);
    const onPlanetCell = (x: number, y: number) => {
      const cell = this.movementService.calculateSystemGridCell(x, y);
      return cell.col === planetCell.col && cell.row === planetCell.row;
    };
    const carriers = fleets.filter(
      (f) => f.factionId === 'player' && !f.destroyed && f.system?.id === system.id && this.hasLivingColonizer(f),
    );
    const parked =
      carriers.find((f) => !this.isMovingInSystem(f) && onPlanetCell(f.system!.x, f.system!.y)) ?? null;
    const enRoute =
      carriers.find(
        (f) =>
          f.system!.targetX != null &&
          f.system!.targetY != null &&
          onPlanetCell(f.system!.targetX, f.system!.targetY),
      ) ?? null;
    return { carriers, parked, enRoute };
  }

  private findPlanetUnderFleet(fleet: Fleet, system: StarSystem): PlanetTile | null {
    const fleetCell = this.movementService.calculateSystemGridCell(fleet.system!.x, fleet.system!.y);
    return (
      system.planetsTiles.find((planet) => {
        const planetCell = this.movementService.getPlanetGridPosition(planet);
        return fleetCell.col === planetCell.col && fleetCell.row === planetCell.row;
      }) ?? null
    );
  }

  private isMovingInSystem(fleet: Fleet): boolean {
    return fleet.system?.targetX != null || fleet.system?.targetY != null;
  }

  private hasLivingColonizer(fleet: Fleet): boolean {
    return (fleet.ships ?? []).some((s) => s.type === 'colonizer' && !s.destroyed);
  }

  /** Returns a garrisoned fleet on the given planet that belongs to the planet's owner faction. */
  getFleetOnPlanet(
    fleets: Fleet[],
    selectedSystem: StarSystem | null,
    planet: PlanetTile,
  ): Fleet | null {
    if (!selectedSystem) return null;

    for (const fleet of fleets) {
      if (fleet.destroyed || fleet.system?.id !== selectedSystem.id) continue;
      if (!this.hasLivingShips(fleet)) continue;
      if (fleet.factionId !== planet.factionId) continue;
      if (fleet.system.targetX != null || fleet.system.targetY != null) continue;

      const fleetCell = this.movementService.calculateSystemGridCell(
        fleet.system.x,
        fleet.system.y,
      );
      const planetCell = this.movementService.getPlanetGridPosition(planet);
      if (fleetCell.col === planetCell.col && fleetCell.row === planetCell.row) {
        return fleet;
      }
    }
    return null;
  }

  /** Handles a fleet arriving at a planet: orbit, capture, or battle trigger. */
  private handleFleetPlanetArrival(fleet: Fleet, planet: PlanetTile, ctx: PlanetArrivalContext): void {
    // Uninhabited planets are colonized only by the explicit COLONIZE command.
    if (planet.factionId === 'unhabited') {
      return;
    }

    if (planet.factionId === fleet.factionId) {
      return;
    }

    const planetFaction = ctx.factions.find((f) => f.id === planet.factionId);
    const fleetFaction = ctx.factions.find((f) => f.id === fleet.factionId);
    if (!planetFaction || !fleetFaction) {
      return;
    }

    // Allied or at-peace owners: the fleet just orbits (diplomacy.ts).
    if (!canAttackPlanetOf(fleetFaction, planetFaction)) {
      return;
    }

    if (!this.planetBattleService.hasPlanetDefenses(planet)) {
      this.planetOwnership.transferPlanet(ctx, planet, fleet.factionId, 'captured');
      ctx.saveGame();
      return;
    }

    this.triggerPlanetBattle(fleet, planet, ctx);
  }

  /** Triggers a battle between an attacking fleet and a planet's defenses. */
  private triggerPlanetBattle(
    attackerFleet: Fleet,
    targetPlanet: PlanetTile,
    ctx: PlanetArrivalContext,
  ): void {
    if (!this.hasLivingShips(attackerFleet)) {
      return;
    }
    const garrisonFleet = this.getFleetOnPlanet(ctx.fleets, ctx.selectedSystem, targetPlanet);
    const defenseFleet = this.planetBattleService.createVirtualDefenseFleet(
      targetPlanet,
      garrisonFleet,
    );

    /*
     * A planet can have only a shield building and no turrets or garrison.
     * That produces a pool but zero combat stacks, so treat it as an
     * undefended capture instead of opening an unwinnable empty battle.
     */
    if (defenseFleet.ships.length === 0) {
      this.planetOwnership.transferPlanet(ctx, targetPlanet, attackerFleet.factionId, 'captured');
      ctx.saveGame();
      return;
    }

    const attackerFaction = ctx.factions.find((f) => f.id === attackerFleet.factionId);
    const defenderFaction = ctx.factions.find((f) => f.id === targetPlanet.factionId);
    if (!attackerFaction || !defenderFaction) {
      return;
    }

    if (garrisonFleet) {
      const battleKey = `${Math.min(attackerFleet.id, garrisonFleet.id)}-${Math.max(attackerFleet.id, garrisonFleet.id)}`;
      this.triggeredBattles.add(battleKey);
    }

    this.battleService.setPlanetBattle({
      fleet1: attackerFleet,
      fleet2: defenseFleet,
      faction1Name: attackerFaction.name,
      faction1Color: attackerFaction.color,
      faction2Name: defenderFaction.name,
      faction2Color: defenderFaction.color,
      attackerId: attackerFleet.id,
      defenderId: defenseFleet.id,
      planetId: targetPlanet.id,
      planetName: targetPlanet.name,
      planetColor: PLANET_TYPE_COLORS[targetPlanet.type] ?? '#ffffff',
      combatBonuses: this.researchService.buildCombatBonuses([attackerFaction, defenderFaction]),
    });

    ctx.enterBattleScreen();
  }

  private hasLivingShips(fleet: Fleet): boolean {
    return (fleet.ships ?? []).some((ship) => ship.destroyed !== true);
  }
}

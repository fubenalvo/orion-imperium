import { Injectable } from '@angular/core';
import { BattleService } from '../../services/battle.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { StarMapMovementService } from './star-map-movement.service';

/*
 * =========================================================
 * STAR MAP PLANET ARRIVAL SERVICE
 * =========================================================
 *
 * Handles fleet arrivals on planet grid cells inside the
 * system view: colonization of uninhabited planets, orbiting
 * on own/teammate planets, capturing undefended planets, and
 * triggering planet battles against defended ones.
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
  ) {}

  /** Checks if any fleet arrived at a planet's grid cell and handles the interaction. */
  checkFleetPlanetArrivals(ctx: PlanetArrivalContext): void {
    if (ctx.currentView !== 'system' || !ctx.selectedSystem) {
      return;
    }

    for (const fleet of ctx.fleets) {
      if (fleet.destroyed || fleet.system?.id !== ctx.selectedSystem.id) {
        continue;
      }
      if (fleet.system.targetX != null || fleet.system.targetY != null) {
        continue;
      }

      const fleetCell = this.movementService.calculateSystemGridCell(
        fleet.system.x,
        fleet.system.y,
      );

      for (const planet of ctx.selectedSystem.planetsTiles) {
        const planetCell = this.movementService.getPlanetGridPosition(planet);
        if (fleetCell.col !== planetCell.col || fleetCell.row !== planetCell.row) {
          continue;
        }

        const lastPlanetId = this.fleetPlanetMap.get(fleet.id);
        if (lastPlanetId === planet.id) {
          break;
        }

        console.log(
          '[PLANET ARRIVAL] Fleet',
          fleet.id,
          fleet.name,
          'factionId:',
          fleet.factionId,
          'arrived at planet',
          planet.id,
          planet.name,
          'factionId:',
          planet.factionId,
          'cell:',
          fleetCell,
        );
        this.fleetPlanetMap.set(fleet.id, planet.id);
        this.handleFleetPlanetArrival(fleet, planet, ctx);
        break;
      }
    }
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

  /** Handles a fleet arriving at a planet: colonization, orbit, or battle trigger. */
  private handleFleetPlanetArrival(fleet: Fleet, planet: PlanetTile, ctx: PlanetArrivalContext): void {
    if (planet.factionId === 'unhabited') {
      const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
      if (result.colonized && result.colonizerIndex >= 0) {
        fleet.ships.splice(result.colonizerIndex, 1);
        planet.factionId = fleet.factionId;
        console.log(`[StarMap] Fleet ${fleet.name} colonized ${planet.name}`);
      } else {
        console.log(
          `[StarMap] Fleet ${fleet.name} orbiting uninhabited ${planet.name} (no colonizer)`,
        );
      }
      ctx.saveGame();
      return;
    }

    if (planet.factionId === fleet.factionId) {
      console.log(
        `[StarMap] Fleet ${fleet.name} arrived at own planet ${planet.name} (factionId: ${planet.factionId})`,
      );
      return;
    }

    const planetFaction = ctx.factions.find((f) => f.id === planet.factionId);
    const fleetFaction = ctx.factions.find((f) => f.id === fleet.factionId);
    if (!planetFaction || !fleetFaction) {
      console.log(
        `[StarMap] Faction not found - planetFaction: ${planetFaction?.id}, fleetFaction: ${fleetFaction?.id}`,
      );
      return;
    }

    console.log(
      `[StarMap] Fleet ${fleet.name} (${fleetFaction.name}, team ${fleetFaction.team}) vs planet ${planet.name} (${planetFaction.name}, team ${planetFaction.team})`,
    );

    if (planetFaction.team === fleetFaction.team) {
      console.log(`[StarMap] Fleet ${fleet.name} cannot attack teammate planet ${planet.name}`);
      return;
    }

    if (!this.planetBattleService.hasPlanetDefenses(planet)) {
      console.log(`[StarMap] Fleet ${fleet.name} captured undefended planet ${planet.name}`);
      planet.factionId = fleet.factionId;
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
    const garrisonFleet = this.getFleetOnPlanet(ctx.fleets, ctx.selectedSystem, targetPlanet);
    const defenseFleet = this.planetBattleService.createVirtualDefenseFleet(
      targetPlanet,
      garrisonFleet,
    );

    const attackerFaction = ctx.factions.find((f) => f.id === attackerFleet.factionId);
    const defenderFaction = ctx.factions.find((f) => f.id === targetPlanet.factionId);
    if (!attackerFaction || !defenderFaction) {
      return;
    }

    if (garrisonFleet) {
      const battleKey = `${Math.min(attackerFleet.id, garrisonFleet.id)}-${Math.max(attackerFleet.id, garrisonFleet.id)}`;
      this.triggeredBattles.add(battleKey);
    }

    console.log(
      '[PLANET BATTLE] Attacker:',
      JSON.stringify({
        id: attackerFleet.id,
        name: attackerFleet.name,
        factionId: attackerFleet.factionId,
        ships: attackerFleet.ships.map((s) => ({ type: s.type, hp: s.currentHp })),
      }),
    );
    console.log(
      '[PLANET BATTLE] Planet:',
      JSON.stringify({
        id: targetPlanet.id,
        name: targetPlanet.name,
        factionId: targetPlanet.factionId,
        buildings: targetPlanet.buildings.map((b) => b.name),
      }),
    );
    console.log(
      '[PLANET BATTLE] Garrison:',
      garrisonFleet
        ? JSON.stringify({
            id: garrisonFleet.id,
            name: garrisonFleet.name,
            factionId: garrisonFleet.factionId,
          })
        : 'none',
    );
    console.log(
      '[PLANET BATTLE] Virtual Defense Fleet ships:',
      JSON.stringify(defenseFleet.ships.map((s) => ({ type: s.type, name: s.name }))),
    );

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
    });

    ctx.enterBattleScreen();
  }
}

import { Injectable } from '@angular/core';
import {
  Faction,
  StarSystem,
  ActionResult,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
} from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';

/*
 * =========================================================
 * ENEMY ACTION EXECUTOR
 * =========================================================
 *
 * V5.1 action execution layer. Reads the current ActionResult
 * from EnemyActionService and executes the single supported
 * action type: produce_colonizer.
 *
 * This layer mutates game state only through the existing
 * ProductionService.queueOrder pathway. It does not evaluate
 * goals, capabilities, or actions, and it does not touch
 * fleets, ship stock, or movement directly.
 *
 * Timing: runs on the same RAF loop as the other AI layers,
 * using the same scaled gameDeltaTime. Returns early when
 * paused (deltaTime <= 0).
 */

@Injectable({ providedIn: 'root' })
export class EnemyActionExecutor {
  private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);

  constructor(
    private readonly productionService: ProductionService,
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
  ) {}

  reset(): void {
    // No mutable executor state for V5.1.
  }

  /*
   * tick: Attempts to execute the current action for an AI faction.
   * Returns true only when a production order was successfully queued.
   */
  tick(
    gameDeltaTime: number,
    action: ActionResult | undefined,
    factions: Faction[],
    starSystems: StarSystem[],
    production: FactionProduction[],
    shipStock: FactionShipStock[],
    fleets: Fleet[],
  ): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

    if (!action || action.type !== 'produce_colonizer') {
      return false;
    }

    if (!this.enemyFactionIds.has(action.factionId)) {
      return false;
    }

    const faction = factions.find((f) => f.id === action.factionId);
    if (!faction) {
      return false;
    }

    const shipType = this.shipService.getShipType('colonizer');
    if (!shipType) {
      return false;
    }

    if (!this.researchService.isResearched(faction, 'basic_engineering')) {
      return false;
    }

    if (!this.researchService.isShipUnlocked(faction, 'colonizer')) {
      return false;
    }

    const credits = faction.currencies['credits'] ?? 0;
    if (credits < shipType.cost) {
      return false;
    }

    if (this.hasPendingColonizerOrder(production, faction.id)) {
      return false;
    }

    const planet = this.selectProductionPlanet(faction.id, starSystems);
    if (!planet) {
      return false;
    }

    const result = this.productionService.queueOrder(
      { production },
      faction.id,
      planet.id,
      'colonizer',
      1,
      starSystems,
      factions,
    );

    if (!result.ok) {
      return false;
    }

    console.log(`[Enemy AI] ${faction.id} executed produce_colonizer at planet ${planet.name}`);
    return true;
  }

  /*
   * hasPendingColonizerOrder: Returns true if the faction already
   * has a colonizer order in its production queue. Prevents the
   * executor from queuing duplicate orders every evaluation cycle.
   */
  private hasPendingColonizerOrder(
    production: FactionProduction[],
    factionId: string,
  ): boolean {
    const factionProd = production.find((p) => p.factionId === factionId);
    if (!factionProd) {
      return false;
    }
    return Object.values(factionProd.ordersByPlanet).some((orders) =>
      orders.some((order) => order.shipTypeId === 'colonizer'),
    );
  }

  /*
   * selectProductionPlanet: Picks the first planet (by ascending
   * system id, then ascending planet id) owned by the faction that
   * has at least one Spaceship Factory. Deterministic tie-breaking
   * without strategic scoring.
   */
  private selectProductionPlanet(
    factionId: string,
    starSystems: StarSystem[],
  ): PlanetTile | undefined {
    const sortedSystems = [...starSystems].sort((a, b) => a.id.localeCompare(b.id));

    for (const system of sortedSystems) {
      const sortedPlanets = [...(system.planetsTiles ?? [])].sort((a, b) => a.id - b.id);
      for (const planet of sortedPlanets) {
        if (planet.factionId !== factionId) {
          continue;
        }
        if (this.productionService.getPlanetCapacity(planet, 'spaceship_factory') > 0) {
          return planet;
        }
      }
    }
    return undefined;
  }
}

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
import { ShipStockService } from '../../services/ship-stock.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';

/*
 * =========================================================
 * ENEMY ACTION EXECUTOR
 * =========================================================
 *
 * V5.1 / V5.2 action execution layer. Reads the current
 * ActionResult from EnemyActionService and executes the
 * supported action types:
 *   - produce_colonizer (V5.1)
 *   - assemble_fleet   (V5.2)
 *
 * This layer mutates game state only through the existing
 * service pathways (ProductionService.queueOrder for
 * production, FleetAssemblyService.reinforceFleet /
 * createFleet for assembly). It does not evaluate goals,
 * capabilities, or actions.
 *
 * Duplicate-execution protection is stateless: every frame
 * the executor re-checks the game-state fact that its own
 * mutation establishes (a queued colonizer order for
 * production; a fleet already carrying a colonizer for
 * assembly). No mutable executor state is kept.
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
    private readonly shipStockService: ShipStockService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly spaceportService: SpaceportService,
  ) {}

  reset(): void {
    // No mutable executor state for V5.1 / V5.2.
  }

  /*
   * tick: Attempts to execute the current action for an AI faction.
   * Returns true only when an action was successfully executed.
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

    if (!action) {
      return false;
    }

    if (!this.enemyFactionIds.has(action.factionId)) {
      return false;
    }

    switch (action.type) {
      case 'produce_colonizer':
        return this.executeProduceColonizer(action, factions, starSystems, production);
      case 'assemble_fleet':
        return this.executeAssembleFleet(action, starSystems, shipStock, fleets);
      default:
        return false;
    }
  }

  /*
   * executeProduceColonizer: Queues one colonizer production order
   * at the faction's deterministic first factory planet. Every frame
   * the faction has a pending colonizer order, no further order is
   * queued.
   */
  private executeProduceColonizer(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    production: FactionProduction[],
  ): boolean {
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
   * executeAssembleFleet: Moves one colonizer from the faction's
   * ship stock into a fleet, reusing the existing fleet assembly
   * system. Prefers reinforcing the faction's deterministic first
   * usable fleet; when no usable fleet exists a new fleet is
   * created at the faction's deterministic first Spaceport planet.
   *
   * Guards (checked every frame) prevent duplicate assembly while
   * the same action is still current:
   *   - a non-destroyed faction fleet already carries a colonizer
   *   - the faction has no colonizer left in stock
   * The FleetAssemblyService itself validates stock / ownership /
   * spaceport and never leaves a partial state on failure.
   */
  private executeAssembleFleet(
    action: ActionResult,
    starSystems: StarSystem[],
    shipStock: FactionShipStock[],
    fleets: Fleet[],
  ): boolean {
    if (this.hasFleetWithColonizer(action.factionId, fleets)) {
      return false;
    }

    const stockData = { shipStock } as { shipStock?: FactionShipStock[] };
    if (this.shipStockService.getCount(stockData, action.factionId, 'colonizer') < 1) {
      return false;
    }

    const data = { shipStock, fleets };
    const composition = [{ typeId: 'colonizer', count: 1 }];

    const candidate = this.selectReinforceFleet(action.factionId, fleets);
    if (candidate) {
      const result = this.fleetAssemblyService.reinforceFleet(data, starSystems, {
        factionId: action.factionId,
        fleetId: candidate.id,
        composition,
      });
      if (!result.ok) {
        return false;
      }
      console.log(`[Enemy AI] ${action.factionId} executed assemble_fleet: reinforced fleet ${result.fleet?.name} with 1 colonizer`);
      return true;
    }

    const location = this.selectAssemblySpaceport(action.factionId, starSystems);
    if (!location) {
      return false;
    }

    const result = this.fleetAssemblyService.createFleet(data, starSystems, {
      factionId: action.factionId,
      fleetName: '',
      systemId: location.system.id,
      planetId: location.planet.id,
      composition,
    });
    if (!result.ok) {
      return false;
    }
    console.log(`[Enemy AI] ${action.factionId} executed assemble_fleet: created fleet ${result.fleet?.name} with 1 colonizer`);
    return true;
  }

  /*
   * hasFleetWithColonizer: True when a non-destroyed faction fleet
   * already carries a living colonizer. This is the state fact that
   * a successful assembly establishes, so it doubles as the
   * duplicate-execution guard between action re-evaluations.
   */
  private hasFleetWithColonizer(factionId: string, fleets: Fleet[]): boolean {
    return fleets.some(
      (f) =>
        f.factionId === factionId &&
        !f.destroyed &&
        f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
    );
  }

  /*
   * selectReinforceFleet: Picks the lowest-id usable faction fleet
   * that does not yet carry a colonizer. Mirrors the deterministic
   * ascending-id ordering used by the EnemyActionService fleet
   * helpers; a fleet counts as usable when it has at least one
   * living ship.
   */
  private selectReinforceFleet(factionId: string, fleets: Fleet[]): Fleet | undefined {
    const candidates = fleets.filter(
      (f) =>
        f.factionId === factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        !f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
    );
    if (candidates.length === 0) {
      return undefined;
    }
    candidates.sort((a, b) => {
      if (a.id !== b.id) {
        return a.id - b.id;
      }
      return a.name.localeCompare(b.name);
    });
    return candidates[0];
  }

  /*
   * selectAssemblySpaceport: Returns the faction's first owned
   * Spaceport planet (ascending system id, then ascending planet
   * id) used as the assembly point when a new fleet must be
   * created. Deterministic tie-breaking without strategic scoring.
   */
  private selectAssemblySpaceport(
    factionId: string,
    starSystems: StarSystem[],
  ): { system: StarSystem; planet: PlanetTile } | undefined {
    const locations = this.spaceportService.listSpaceports(factionId, starSystems);
    if (locations.length === 0) {
      return undefined;
    }
    locations.sort((a, b) => {
      const systemComparison = a.system.id.localeCompare(b.system.id);
      if (systemComparison !== 0) {
        return systemComparison;
      }
      return a.planet.id - b.planet.id;
    });
    const location = locations[0];
    return { system: location.system, planet: location.planet };
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

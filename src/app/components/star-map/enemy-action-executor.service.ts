import { Injectable } from '@angular/core';
import {
  Faction,
  StarSystem,
  ActionResult,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  ColonizeGoal,
  AttackGoal,
  DefendGoal,
  PLANET_SIZE_MAP,
} from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { EconomyService } from '../../services/economy.service';
import { StarMapMovementService } from './star-map-movement.service';
import planetData from '../../components/star-map/planet-data.json';

/*
 * =========================================================
 * ENEMY ACTION EXECUTOR
 * =========================================================
 *
 * V5.1 / V5.2 / V5.3 action execution layer. Reads the current
 * ActionResult from EnemyActionService and executes the
 * supported action types:
 *   - produce_colonizer (V5.1)
 *   - assemble_fleet   (V5.2)
 *   - move_to_target   (V5.3)
 *
 * This layer mutates game state only through the existing
 * service pathways (ProductionService.queueOrder for
 * production, FleetAssemblyService.reinforceFleet /
 * createFleet for assembly, and Fleet.targetX/targetY for
 * movement). It does not evaluate goals, capabilities, or
 * actions.
 *
 * Duplicate-execution protection is stateless: every frame
 * the executor re-checks the game-state fact that its own
 * mutation establishes (a queued colonizer order for
 * production; a fleet already carrying a colonizer for
 * assembly; a fleet already moving to the same destination
 * for movement). No mutable executor state is kept.
 *
 * Timing: runs on the same RAF loop as the other AI layers,
 * using the same scaled gameDeltaTime. Returns early when
 * paused (deltaTime <= 0).
 */

@Injectable({ providedIn: 'root' })
export class EnemyActionExecutor {
  constructor(
    private readonly productionService: ProductionService,
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
    private readonly shipStockService: ShipStockService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly spaceportService: SpaceportService,
    private readonly planetBattleService: PlanetBattleService,
    private readonly economyService: EconomyService,
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

    const faction = factions.find((f) => f.id === action.factionId);
    if (faction?.ai !== true) {
      return false;
    }

    switch (action.type) {
      case 'produce_colonizer':
        return this.executeProduceColonizer(action, factions, starSystems, production);
      case 'assemble_fleet':
        return this.executeAssembleFleet(action, starSystems, shipStock, fleets);
      case 'move_to_target':
        return this.executeMoveToTarget(action, fleets, starSystems);
      case 'colonize':
        return this.executeColonize(action, factions, starSystems, fleets);
      case 'attack':
        return this.executeAttack(action, fleets);
      case 'defend':
        return this.executeDefend(action, starSystems, fleets);
      case 'develop':
        return this.executeDevelop(action, factions, starSystems);
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
      console.log(
        `[Enemy AI] ${action.factionId} executed assemble_fleet: reinforced fleet ${result.fleet?.name} with 1 colonizer`,
      );
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
    console.log(
      `[Enemy AI] ${action.factionId} executed assemble_fleet: created fleet ${result.fleet?.name} with 1 colonizer`,
    );
    return true;
  }

  /*
   * executeMoveToTarget: Starts map movement for an AI fleet toward
   * the target encoded in the action/goal. Reuses the existing
   * movement system by setting fleet.targetX/targetY; the game loop
   * advances the fleet frame-by-frame via StarMapMovementService.
   *
   * Supported goal types:
   *  - colonize: moves to the target star system's map position.
   *              Also validates that the target planet is still unhabited.
   *  - attack:   moves to the target fleet's current map position.
   *              Validates that the target fleet still exists and is alive.
   *  - defend:   moves to the threatened star system's map position.
   *
   * Stateless guards prevent duplicate restarts when the fleet is
   * already heading to the same destination, and protect against
   * invalid or missing targets.
   */
  private executeMoveToTarget(
    action: ActionResult,
    fleets: Fleet[],
    starSystems: StarSystem[],
  ): boolean {
    const fleet = fleets.find((f) => f.id === action.targetId);
    if (!fleet || fleet.destroyed || fleet.factionId !== action.factionId) {
      return false;
    }

    let destX: number | null = null;
    let destY: number | null = null;

    if (action.goalType === 'colonize') {
      const goal = action.goal as ColonizeGoal;
      const system = starSystems.find((s) => s.id === goal.targetSystemId);
      const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);
      if (!system || !planet || planet.factionId !== 'unhabited') {
        return false;
      }
      destX = system.x;
      destY = system.y;
    } else if (action.goalType === 'attack') {
      const goal = action.goal as AttackGoal;
      const targetFleet = fleets.find((f) => f.id === goal.targetFleetId);
      if (!targetFleet || targetFleet.destroyed) {
        return false;
      }
      destX = targetFleet.x;
      destY = targetFleet.y;
    } else if (action.goalType === 'defend') {
      const goal = action.goal as DefendGoal;
      const system = starSystems.find((s) => s.id === goal.targetSystemId);
      if (!system) {
        return false;
      }
      destX = system.x;
      destY = system.y;
    } else {
      return false;
    }

    if (destX === null || destY === null) {
      return false;
    }

    if (fleet.targetX === destX && fleet.targetY === destY) {
      return false;
    }

    fleet.targetX = destX;
    fleet.targetY = destY;

    console.log(
      `[Enemy AI] ${action.factionId} fleet ${fleet.name} moving to (${destX}, ${destY})`,
    );
    return true;
  }

  /*
   * executeColonize: Colonizes an unhabited planet using a colonizer
   * from an AI fleet that is at the planet's grid position. Reuses
   * PlanetBattleService.resolveUninhabitedArrival to detect the
   * colonizer and remove it from the fleet.
   *
   * Guards (checked every frame) prevent duplicate or invalid
   * colonization:
   *   - target planet still exists and is unhabited
   *   - an AI fleet with a living colonizer is at the planet cell
   */
  private executeColonize(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
  ): boolean {
    const system = starSystems.find((s) => s.id === action.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === action.targetPlanetId);
    if (!system || !planet || planet.factionId !== 'unhabited') {
      return false;
    }

    const fleet = fleets.find(
      (f) =>
        f.factionId === action.factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        Math.floor(f.x) === Math.floor(system.x) &&
        Math.floor(f.y) === Math.floor(system.y),
    );

    if (!fleet) {
      return false;
    }

    const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
    if (!result.colonized || result.colonizerIndex < 0) {
      return false;
    }

    fleet.ships.splice(result.colonizerIndex, 1);
    planet.factionId = action.factionId;

    console.log(`[Enemy AI] ${action.factionId} executed colonize: ${fleet.name} colonized ${planet.name}`);
    return true;
  }

  /*
   * executeAttack: Validates that an AI fleet and the target player
   * fleet occupy the same galaxy grid cell and are both alive. Does
   * NOT trigger battle; StarMapBattleDetectionService handles
   * collision-based battle start automatically.
   *
   * Guards prevent invalid or duplicate execution:
   *   - target fleet exists, not destroyed, has living ships
   *   - an AI fleet exists at the same grid cell, not destroyed, has living ships
   */
  private executeAttack(action: ActionResult, fleets: Fleet[]): boolean {
    const targetFleet = fleets.find((f) => f.id === action.targetId);
    if (!targetFleet || targetFleet.destroyed || targetFleet.factionId === action.factionId) {
      return false;
    }

    const targetHasShips = targetFleet.ships.some((s) => !s.destroyed);
    if (!targetHasShips) {
      return false;
    }

    const targetCol = Math.floor(targetFleet.x);
    const targetRow = Math.floor(targetFleet.y);
    const attackerFleet = fleets.find(
      (f) =>
        f.factionId === action.factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        Math.floor(f.x) === targetCol &&
        Math.floor(f.y) === targetRow,
    );

    if (!attackerFleet) {
      return false;
    }

    console.log(
      `[Enemy AI] ${action.factionId} executed attack: ${attackerFleet.name} engaging ${targetFleet.name}`,
    );
    return true;
  }

  /*
   * executeDefend: Validates that an AI fleet is positioned at the
   * threatened star system's grid cell. Movement to the system is
   * already handled by the move_to_target action; this method only
   * confirms the fleet has arrived.
   *
   * Guards prevent invalid execution:
   *   - target system exists
   *   - an AI fleet exists at the system's grid cell, not destroyed, has living ships
   */
  private executeDefend(action: ActionResult, starSystems: StarSystem[], fleets: Fleet[]): boolean {
    const system = starSystems.find((s) => s.id === action.targetSystemId);
    if (!system) {
      return false;
    }

    const fleet = fleets.find(
      (f) =>
        f.factionId === action.factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        Math.floor(f.x) === Math.floor(system.x) &&
        Math.floor(f.y) === Math.floor(system.y),
    );

    if (!fleet) {
      return false;
    }

    console.log(
      `[Enemy AI] ${action.factionId} executed defend: ${fleet.name} defending ${system.name}`,
    );
    return true;
  }

  /*
   * executeDevelop: Minimal deterministic building construction for
   * AI factions. Selects the first owned planet with a free building
   * slot, chooses a building based on economy priority, verifies
   * research unlock and credits, finds a valid placement, and places
   * the building.
   *
   * Building selection priority:
   *   1. Energy shortage -> Fusion Power Plant / Solar Array
   *   2. Workforce shortage -> residential block
   *   3. Raw material production needed -> Spaceship Factory / Mining Complex
   *   4. Fallback -> Research Laboratory
   *
   * Placement reuses the overlap/grid bounds logic from the planet
   * screen component. No new placement system is introduced.
   */
  private executeDevelop(action: ActionResult, factions: Faction[], starSystems: StarSystem[]): boolean {
    const faction = factions.find((f) => f.id === action.factionId);
    if (!faction) {
      return false;
    }

    const planet = this.selectDevelopPlanet(action.factionId, starSystems);
    if (!planet) {
      return false;
    }

    const buildingId = this.selectDevelopBuilding(faction, planet);
    if (!buildingId) {
      return false;
    }

    const buildingDef = (planetData as any).buildings.find((b: any) => b.id === buildingId);
    if (!buildingDef) {
      return false;
    }

    if (!this.researchService.isBuildingUnlocked(faction, buildingId)) {
      return false;
    }

    const credits = faction.currencies['credits'] ?? 0;
    if (credits < buildingDef.price) {
      return false;
    }

    const gridSize = (PLANET_SIZE_MAP[planet.size] ?? 3) * 2 + 3;
    const placement = this.findValidPlacement(planet, buildingDef.size, buildingId, gridSize);
    if (!placement) {
      return false;
    }

    faction.currencies['credits'] = credits - buildingDef.price;
    planet.buildings.push({
      name: buildingDef.name,
      size: buildingDef.size,
      x: placement.x,
      y: placement.y,
    });

    console.log(
      `[Enemy AI] ${action.factionId} executed develop: built ${buildingDef.name} on ${planet.name}`,
    );
    return true;
  }

  /*
   * selectDevelopPlanet: Returns the first owned planet (ascending
   * system id, then planet id) that has at least one free building
   * slot. Deterministic tie-breaking.
   */
  private selectDevelopPlanet(factionId: string, starSystems: StarSystem[]): PlanetTile | undefined {
    const sortedSystems = [...starSystems].sort((a, b) => a.id.localeCompare(b.id));
    for (const system of sortedSystems) {
      const sortedPlanets = [...(system.planetsTiles ?? [])].sort((a, b) => a.id - b.id);
      for (const planet of sortedPlanets) {
        if (planet.factionId !== factionId) {
          continue;
        }
        if (this.hasFreeBuildingSlot(planet)) {
          return planet;
        }
      }
    }
    return undefined;
  }

  /*
   * hasFreeBuildingSlot: Returns true when the planet has enough
   * free grid cells to accommodate at least one 1x1 building.
   * Uses the same grid-size formula as the planet screen.
   */
  private hasFreeBuildingSlot(planet: PlanetTile): boolean {
    const gridSize = (PLANET_SIZE_MAP[planet.size] ?? 3) * 2 + 3;
    const occupied = new Set<string>();
    for (const b of planet.buildings ?? []) {
      for (let r = b.y; r < b.y + b.size; r++) {
        for (let c = b.x; c < b.x + b.size; c++) {
          occupied.add(`${r},${c}`);
        }
      }
    }
    const totalCells = gridSize * gridSize;
    return occupied.size < totalCells;
  }

  /*
   * selectDevelopBuilding: Chooses a building based on the planet's
   * current economy needs. Returns the building id or undefined if
   * no suitable building is available.
   */
  private selectDevelopBuilding(faction: Faction, planet: PlanetTile): string | undefined {
    const economy = this.economyService.calculatePlanetEconomy(planet);
    const buildings = (planetData as any).buildings;

    if (economy.energyProduction < economy.energyConsumption) {
      const candidate = buildings.find((b: any) => b.role === 'power' && this.researchService.isBuildingUnlocked(faction, b.id));
      if (candidate) return candidate.id;
    }

    if (economy.workforceAvailable < economy.workforceRequired) {
      const candidate = buildings.find((b: any) => b.role === 'housing' && this.researchService.isBuildingUnlocked(faction, b.id));
      if (candidate) return candidate.id;
    }

    const rawMaterialProd = economy.production['rawmaterials'] ?? 0;
    if (rawMaterialProd < 10) {
      const candidate = buildings.find((b: any) => b.role === 'industry' && this.researchService.isBuildingUnlocked(faction, b.id));
      if (candidate) return candidate.id;
    }

    const candidate = buildings.find((b: any) => b.role === 'research' && this.researchService.isBuildingUnlocked(faction, b.id));
    if (candidate) return candidate.id;

    return undefined;
  }

  /*
   * findValidPlacement: Scans the planet grid for the first valid
   * top-left coordinate where the building footprint fits without
   * overlapping existing buildings or resource tiles (and satisfies
   * ore-proximity rules). Returns {x, y} or undefined.
   */
  private findValidPlacement(
    planet: PlanetTile,
    buildingSize: number,
    buildingId: string,
    gridSize: number,
  ): { x: number; y: number } | undefined {
    const buildingDef = (planetData as any).buildings.find((b: any) => b.id === buildingId);
    const requiresOre = buildingDef?.requiresOreProximity === true;
    const resourceTiles = planet.resourceTiles ?? [];

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        if (!this.canPlaceBuilding(planet, buildingSize, x, y, resourceTiles, requiresOre)) {
          continue;
        }
        return { x, y };
      }
    }
    return undefined;
  }

  /*
   * canPlaceBuilding: Checks bounds, building overlap, and resource
   * tile rules for a candidate placement.
   */
  private canPlaceBuilding(
    planet: PlanetTile,
    buildingSize: number,
    x: number,
    y: number,
    resourceTiles: { type: string; x: number; y: number }[],
    requiresOre: boolean,
  ): boolean {
    const gridSize = (PLANET_SIZE_MAP[planet.size] ?? 3) * 2 + 3;
    if (x + buildingSize > gridSize || y + buildingSize > gridSize) {
      return false;
    }

    for (const b of planet.buildings ?? []) {
      if (x < b.x + b.size && x + buildingSize > b.x && y < b.y + b.size && y + buildingSize > b.y) {
        return false;
      }
    }

    let touchesResource = false;
    for (let r = y; r < y + buildingSize; r++) {
      for (let c = x; c < x + buildingSize; c++) {
        for (const rt of resourceTiles) {
          if (r === rt.y && c === rt.x) {
            if (requiresOre) {
              touchesResource = true;
            } else {
              return false;
            }
          }
        }
      }
    }

    if (requiresOre && !touchesResource) {
      return false;
    }

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
  private hasPendingColonizerOrder(production: FactionProduction[], factionId: string): boolean {
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

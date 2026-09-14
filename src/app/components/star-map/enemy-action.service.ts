import { Injectable } from '@angular/core';
import {
  Fleet,
  Faction,
  StarSystem,
  StrategicGoal,
  ColonizeGoal,
  AttackGoal,
  DefendGoal,
  DevelopGoal,
  ActionType,
  ActionResult,
  CapabilityResult,
  ShipStockEntry,
  ProductionOrder,
  ShipType,
} from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { StarMapMovementService } from './star-map-movement.service';
import { isCombatShipType } from './ai-queries';

/*
 * =========================================================
 * ENEMY ACTION SERVICE
 * =========================================================
 *
 * Fourth strategic AI layer below EnemyStrategyService V4.1,
 * EnemyGoalService V4.2, and EnemyCapabilityService V4.3.
 *
 * Given a faction's current goal and capability assessment,
 * determines the single next action the faction should take.
 *
 * This layer does NOT execute actions. It only inspects the
 * current game state and returns an ActionResult describing
 * the recommended next step.
 *
 * Timing: actions are recalculated every STRATEGY_TICK_INTERVAL
 * seconds of game time using an internal accumulator, matching
 * the V4.1/V4.2/V4.3 cadence.
 */

@Injectable({ providedIn: 'root' })
export class EnemyActionService {
  private readonly STRATEGY_TICK_INTERVAL = 2;

  private accumulator = 0;
  private readonly currentActions = new Map<string, ActionResult>();

  constructor(
    private readonly shipService: ShipService,
    private readonly researchService: ResearchService,
    private readonly shipStockService: ShipStockService,
    private readonly productionService: ProductionService,
    private readonly spaceportService: SpaceportService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly movementService: StarMapMovementService,
  ) {}

  reset(): void {
    this.accumulator = 0;
    this.currentActions.clear();
  }

  tick(
    gameDeltaTime: number,
    currentGoal: StrategicGoal | undefined,
    capability: CapabilityResult | undefined,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
  ): boolean {
    if (gameDeltaTime <= 0) {
      return false;
    }

    this.accumulator += gameDeltaTime;
    if (this.accumulator < this.STRATEGY_TICK_INTERVAL) {
      return false;
    }

    this.accumulator -= this.STRATEGY_TICK_INTERVAL;
    if (this.accumulator < 0) {
      this.accumulator = 0;
    }

    const previous = this.currentActions.get(factionId);
    const next = currentGoal !== undefined && capability !== undefined
      ? this.evaluateAction(currentGoal, capability, factionId, fleets, factions, starSystems, shipStock, production)
      : undefined;

    if (previous !== undefined && next !== undefined) {
      const changed = JSON.stringify(previous) !== JSON.stringify(next);
      if (changed) {
        this.currentActions.set(factionId, next);
      }
      return changed;
    }

    if (previous === undefined && next !== undefined) {
      this.currentActions.set(factionId, next);
      return true;
    }

    if (previous !== undefined && next === undefined) {
      this.currentActions.delete(factionId);
      return true;
    }

    return false;
  }

  getAction(factionId: string): ActionResult | undefined {
    return this.currentActions.get(factionId);
  }

  private evaluateAction(
    goal: StrategicGoal,
    capability: CapabilityResult,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
  ): ActionResult {
    /*
     * Reinforcement is a valid behavior for a fleet that can still
     * defend, so capability.canExecute stays true and the normal
     * prepare path would never run. Evaluate the defend preparation
     * first and prefer a reinforcement action; otherwise fall through
     * to the regular execute path.
     */
    if (goal.type === 'defend') {
      const prepare = this.evaluateDefendPrepare(goal, capability, factionId, fleets, factions, starSystems, shipStock);
      if (prepare.type === 'reinforce_fleet') {
        return prepare;
      }
      if (!capability.canExecute) {
        return prepare;
      }
    }

    if (!capability.canExecute) {
      return this.evaluatePreparationAction(goal, capability, factionId, fleets, factions, starSystems, shipStock, production);
    }

    switch (goal.type) {
      case 'colonize':
        return this.evaluateColonizeExecute(goal, factionId, fleets, starSystems, shipStock);
      case 'attack':
        return this.evaluateAttackExecute(goal, factionId, fleets);
      case 'defend':
        return this.evaluateDefendExecute(goal, factionId, fleets, starSystems);
      case 'develop':
        return this.createAction('develop', factionId, goal, undefined, undefined, undefined, 'Develop goal is always executable');
      default:
        return this.createNoneAction(factionId, goal, 'Unknown goal type');
    }
  }

  private evaluatePreparationAction(
    goal: StrategicGoal,
    capability: CapabilityResult,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
  ): ActionResult {
    switch (goal.type) {
      case 'colonize':
        return this.evaluateColonizePrepare(goal, capability, factionId, fleets, factions, starSystems, shipStock, production);
      case 'attack':
        return this.evaluateAttackPrepare(goal, capability, factionId, fleets, factions);
      case 'defend':
        return this.evaluateDefendPrepare(goal, capability, factionId, fleets, factions, starSystems, shipStock);
      case 'develop':
        return this.createAction('develop', factionId, goal, undefined, undefined, undefined, 'Develop goal is always executable');
      default:
        return this.createNoneAction(factionId, goal, 'Unknown goal type');
    }
  }

  private evaluateColonizePrepare(
    goal: ColonizeGoal,
    capability: CapabilityResult,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
  ): ActionResult {
    const reqMap = new Map(capability.requirements.map((r) => [r.type, r]));

    const colonizerAvailable = reqMap.get('colonizer_available');
    const usableFleet = reqMap.get('usable_fleet');
    const targetValid = reqMap.get('target_valid');

    if (targetValid && !targetValid.satisfied) {
      return this.createNoneAction(factionId, goal, targetValid.reason);
    }

    const techReq = reqMap.get('colonizer_technology');
    const unlockReq = reqMap.get('colonizer_unlocked');
    if (techReq && !techReq.satisfied) {
      return this.createNoneAction(factionId, goal, techReq.reason);
    }
    if (unlockReq && !unlockReq.satisfied) {
      return this.createNoneAction(factionId, goal, unlockReq.reason);
    }

    if (colonizerAvailable && !colonizerAvailable.satisfied) {
      if (this.canProduceColonizer(factionId, factions, starSystems)) {
        return this.createAction('produce_colonizer', factionId, goal, undefined, goal.targetSystemId, goal.targetPlanetId, 'No colonizer available but production is possible');
      }
      return this.createNoneAction(factionId, goal, colonizerAvailable.reason);
    }

    if (usableFleet && !usableFleet.satisfied) {
      return this.createNoneAction(factionId, goal, usableFleet.reason);
    }

    return this.createNoneAction(factionId, goal, 'Cannot prepare for colonization');
  }

  private evaluateColonizeExecute(
    goal: ColonizeGoal,
    factionId: string,
    fleets: Fleet[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
  ): ActionResult {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);

    if (!system || !planet || planet.factionId !== 'unhabited') {
      return this.createNoneAction(factionId, goal, 'Target planet is no longer unhabited');
    }

    const fleetWithColonizer = this.findFleetWithColonizer(factionId, fleets);

    if (!fleetWithColonizer) {
      const stockData = { shipStock } as { shipStock?: { factionId: string; ships: ShipStockEntry[] }[] };
      const colonizerInStock = this.shipStockService.getCount(stockData, factionId, 'colonizer') > 0;
      if (colonizerInStock) {
        return this.createAction('assemble_fleet', factionId, goal, undefined, goal.targetSystemId, goal.targetPlanetId, 'Colonizer in stock but no fleet has it');
      }
      return this.createNoneAction(factionId, goal, 'No fleet with colonizer found');
    }

    const planetCell = this.movementService.getPlanetGridPosition(planet);
    const atTarget = fleetWithColonizer.gridCol === planetCell.col && fleetWithColonizer.gridRow === planetCell.row;

    if (atTarget) {
      return this.createAction('colonize', factionId, goal, planet.id, goal.targetSystemId, planet.id, 'Fleet with colonizer is at the target planet');
    }

    return this.createAction('move_to_target', factionId, goal, fleetWithColonizer.id, goal.targetSystemId, planet.id, 'Fleet with colonizer needs to move to the target planet');
  }

  private evaluateAttackPrepare(
    goal: AttackGoal,
    capability: CapabilityResult,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
  ): ActionResult {
    const reqMap = new Map(capability.requirements.map((r) => [r.type, r]));

    const availableFleet = reqMap.get('available_fleet');
    const targetValid = reqMap.get('target_valid');
    const canEngage = reqMap.get('fleet_can_engage');

    if (targetValid && !targetValid.satisfied) {
      return this.createNoneAction(factionId, goal, targetValid.reason);
    }

    if (availableFleet && !availableFleet.satisfied) {
      return this.createNoneAction(factionId, goal, availableFleet.reason);
    }

    if (canEngage && !canEngage.satisfied) {
      const ship = this.selectCheapestCombatShip(factionId, factions);
      if (ship) {
        return this.createAction('produce_combat_ship', factionId, goal, undefined, undefined, undefined, 'No combat capability but production is possible', ship.id);
      }
      return this.createNoneAction(factionId, goal, canEngage.reason);
    }

    return this.createNoneAction(factionId, goal, 'Cannot prepare for attack');
  }

  private evaluateAttackExecute(
    goal: AttackGoal,
    factionId: string,
    fleets: Fleet[],
  ): ActionResult {
    const targetFleet = fleets.find((f) => f.id === goal.targetFleetId);
    if (!targetFleet || targetFleet.destroyed) {
      return this.createNoneAction(factionId, goal, 'Target fleet is no longer valid');
    }

    const enemyFleet = this.findBestEnemyFleet(factionId, fleets);
    if (!enemyFleet) {
      return this.createNoneAction(factionId, goal, 'No available enemy fleet');
    }

    const atTarget = Math.floor(enemyFleet.x) === Math.floor(targetFleet.x) && Math.floor(enemyFleet.y) === Math.floor(targetFleet.y);

    if (atTarget) {
      return this.createAction('attack', factionId, goal, targetFleet.id, undefined, undefined, 'Enemy fleet is at the target fleet position');
    }

    return this.createAction('move_to_target', factionId, goal, enemyFleet.id, undefined, undefined, 'Enemy fleet needs to move to the target fleet');
  }

  private evaluateDefendPrepare(
    goal: DefendGoal,
    capability: CapabilityResult,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
  ): ActionResult {
    const reqMap = new Map(capability.requirements.map((r) => [r.type, r]));

    const targetValid = reqMap.get('target_valid');
    const needsReinforcement = reqMap.get('fleet_needs_reinforcement');
    const canEngage = reqMap.get('fleet_can_engage');
    const availableFleet = reqMap.get('available_fleet');

    if (targetValid && !targetValid.satisfied) {
      return this.createNoneAction(factionId, goal, targetValid.reason);
    }

    if (needsReinforcement && needsReinforcement.satisfied) {
      const economyOk = this.canAffordReinforcement(factionId, factions);
      if (economyOk) {
        if (availableFleet && availableFleet.satisfied) {
          const reinforceAction = this.createAction('reinforce_fleet', factionId, goal, this.selectWeakestFleet(factionId, fleets)?.id, undefined, undefined, 'Fleet under-strength, reinforcing from stock');
          reinforceAction.targetStrength = needsReinforcement.value;
          return reinforceAction;
        }
        return this.createNoneAction(factionId, goal, 'no_available_fleet');
      }
      return this.createNoneAction(factionId, goal, 'fleet_under_strength_economy_collapsing');
    }

    if (canEngage && !canEngage.satisfied) {
      /*
       * Prefer assembling a combat fleet from ships already in stock: it
       * gives immediate combat capability, whereas production only pays
       * off after the build time. The ship type must therefore come from
       * the stock, not from the (credits-based) production selection.
       */
      const stockShip = this.selectStockCombatShip(factionId, shipStock);
      if (stockShip) {
        const planet = this.selectReinforcementPlanet(factionId, starSystems);
        if (planet) {
          return this.createAction('create_fleet', factionId, goal, undefined, planet.system.id, planet.id, 'No combat capability, creating new fleet from stock', stockShip.id);
        }
      }

      const ship = this.selectCheapestCombatShip(factionId, factions);
      if (ship) {
        return this.createAction('produce_combat_ship', factionId, goal, undefined, undefined, undefined, 'No combat capability but production is possible', ship.id);
      }

      return this.createNoneAction(factionId, goal, canEngage.reason);
    }

    if (availableFleet && !availableFleet.satisfied) {
      return this.createNoneAction(factionId, goal, availableFleet.reason);
    }

    return this.createNoneAction(factionId, goal, 'Cannot prepare for defense');
  }

  private evaluateDefendExecute(
    goal: DefendGoal,
    factionId: string,
    fleets: Fleet[],
    starSystems: StarSystem[],
  ): ActionResult {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    if (!system) {
      return this.createNoneAction(factionId, goal, 'Target system no longer exists');
    }

    const enemyFleet = this.findBestEnemyFleet(factionId, fleets);
    if (!enemyFleet) {
      return this.createNoneAction(factionId, goal, 'No available enemy fleet');
    }

    const atSystem = Math.floor(enemyFleet.x) === Math.floor(system.x) && Math.floor(enemyFleet.y) === Math.floor(system.y);

    if (atSystem) {
      return this.createAction('defend', factionId, goal, enemyFleet.id, goal.targetSystemId, goal.targetPlanetId, 'Enemy fleet is at the threatened system');
    }

    return this.createAction('move_to_target', factionId, goal, enemyFleet.id, goal.targetSystemId, goal.targetPlanetId, 'Enemy fleet needs to move to the threatened system');
  }

  private findFleetWithColonizer(factionId: string, fleets: Fleet[]): Fleet | undefined {
    const candidates = fleets.filter(
      (f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
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

  private findBestEnemyFleet(factionId: string, fleets: Fleet[]): Fleet | undefined {
    const candidates = fleets.filter(
      (f) => f.factionId === factionId && !f.destroyed && f.ships.some((ship) => !ship.destroyed),
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

  private canProduceColonizer(factionId: string, factions: Faction[], starSystems: StarSystem[]): boolean {
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) {
      return false;
    }

    if (!this.researchService.isResearched(faction, 'basic_engineering')) {
      return false;
    }

    if (!this.researchService.isShipUnlocked(faction, 'colonizer')) {
      return false;
    }

    const colonizer = this.shipService.getShipType('colonizer');
    if (!colonizer) {
      return false;
    }

    const credits = faction.currencies['credits'] ?? 0;
    if (credits < colonizer.cost) {
      return false;
    }

    const enemySystems = starSystems.filter((s) =>
      s.planetsTiles.some((p) => p.factionId === factionId),
    );

    for (const system of enemySystems) {
      for (const planet of system.planetsTiles) {
        if (planet.factionId !== factionId) {
          continue;
        }
        const capacity = this.productionService.getPlanetCapacity(planet, 'spaceship_factory');
        if (capacity > 0) {
          return true;
        }
      }
    }

    return false;
  }

  private selectCheapestCombatShip(factionId: string, factions: Faction[]): ShipType | undefined {
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) {
      return undefined;
    }

    const combatShips = this.shipService.getAllShipTypes().filter((ship) => {
      if (!isCombatShipType(ship)) {
        return false;
      }
      if (!this.researchService.isShipUnlocked(faction, ship.id)) {
        return false;
      }
      const credits = faction.currencies['credits'] ?? 0;
      if (credits < ship.cost) {
        return false;
      }
      return true;
    });

    if (combatShips.length === 0) {
      return undefined;
    }

    combatShips.sort((a, b) => a.cost - b.cost);
    return combatShips[0];
  }

  /*
   * selectStockCombatShip: Picks the cheapest combat ship type the
   * faction currently has in the global stock. Used by create_fleet,
   * which assembles from stock rather than producing new ships, so
   * credits/unlock are irrelevant here — only stock presence matters.
   */
  private selectStockCombatShip(
    factionId: string,
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
  ): ShipType | undefined {
    const stock = shipStock.find((entry) => entry.factionId === factionId);
    if (!stock || stock.ships.length === 0) {
      return undefined;
    }
    const stockTypes = new Set(stock.ships.map((ship) => ship.type));
    const candidates = this.shipService
      .getAllShipTypes()
      .filter((shipType) => stockTypes.has(shipType.id) && isCombatShipType(shipType))
      .sort((a, b) => a.cost - b.cost);
    return candidates[0];
  }

  private canAffordReinforcement(factionId: string, factions: Faction[]): boolean {
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) {
      return false;
    }
    const ship = this.selectCheapestCombatShip(factionId, factions);
    if (!ship) {
      return false;
    }
    const credits = faction.currencies['credits'] ?? 0;
    return credits >= ship.cost;
  }

  private selectWeakestFleet(factionId: string, fleets: Fleet[]): Fleet | undefined {
    const factionFleets = fleets.filter(
      (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.length > 0,
    );
    if (factionFleets.length === 0) {
      return undefined;
    }
    factionFleets.sort((a, b) =>
      this.shipService.calculateFleetStrength(a.ships) - this.shipService.calculateFleetStrength(b.ships),
    );
    return factionFleets[0];
  }

  /*
   * selectReinforcementPlanet: Picks the faction's deterministic first
   * owned Spaceport planet (lowest system id, then lowest planet id).
   * Delegates Spaceport detection to SpaceportService so the assembly
   * rules cannot drift from FleetAssemblyService.
   */
  private selectReinforcementPlanet(factionId: string, starSystems: StarSystem[]): { id: number; system: StarSystem } | undefined {
    const spaceports = this.spaceportService.listSpaceports(factionId, starSystems);
    if (spaceports.length === 0) {
      return undefined;
    }
    const sorted = [...spaceports].sort((a, b) => {
      const systemCompare = a.system.id.localeCompare(b.system.id, undefined, { numeric: true });
      if (systemCompare !== 0) {
        return systemCompare;
      }
      return a.planet.id - b.planet.id;
    });
    return { id: sorted[0].planet.id, system: sorted[0].system };
  }

  private createAction(
    type: ActionType,
    factionId: string,
    goal: StrategicGoal,
    targetId: number | undefined,
    targetSystemId: string | undefined,
    targetPlanetId: number | undefined,
    reason: string,
    shipTypeId?: string,
  ): ActionResult {
    return {
      type,
      factionId,
      goalType: goal.type,
      goal,
      targetId,
      targetSystemId,
      targetPlanetId,
      shipTypeId,
      reason,
    };
  }

  private createNoneAction(factionId: string, goal: StrategicGoal | undefined, reason: string): ActionResult {
    return {
      type: 'none',
      factionId,
      goalType: goal?.type ?? 'develop',
      goal,
      reason,
    };
  }
}

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
  private readonly DEFEND_MIN_RATIO = 0.5;

  /*
   * One accumulator per faction. tick() is called once per AI faction per
   * frame, so a single shared accumulator advanced N times per frame and
   * only the faction whose call crossed the threshold was processed —
   * every other AI faction starved. Keyed by faction id so each faction
   * gets its own STRATEGY_TICK_INTERVAL cadence.
   */
  private readonly accumulators = new Map<string, number>();
  private readonly currentActions = new Map<string, ActionResult>();
  // Action for the parallel colonization objective (EnemyGoalService.getColonizationGoal).
  private readonly colonizationActions = new Map<string, ActionResult>();
  /*
   * Colonizer carrier → planet id of the colonization objective it serves.
   * With two concurrent objectives (primary + parallel slot) each carrier
   * must serve exactly one, or both objectives would steer the same fleet.
   */
  private readonly carrierTargets = new Map<number, number>();

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
    this.accumulators.clear();
    this.currentActions.clear();
    this.colonizationActions.clear();
    this.carrierTargets.clear();
  }

  /*
   * planColonizationAction: Evaluates the next step of the parallel
   * colonization objective with the same rules as a primary colonize goal
   * and stores it separately. `goal` undefined clears it. Cadence is the
   * caller's (StarMapAiTickService runs it on the strategy interval).
   */
  planColonizationAction(
    goal: ColonizeGoal | undefined,
    capability: CapabilityResult | undefined,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
    production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
  ): boolean {
    const previous = this.colonizationActions.get(factionId);
    if (!goal || !capability) {
      this.colonizationActions.delete(factionId);
      return previous !== undefined;
    }
    const next = this.evaluateAction(goal, capability, factionId, fleets, factions, starSystems, shipStock, production);
    this.colonizationActions.set(factionId, next);
    return JSON.stringify(previous) !== JSON.stringify(next);
  }

  getColonizationAction(factionId: string): ActionResult | undefined {
    return this.colonizationActions.get(factionId);
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

    const accumulator = (this.accumulators.get(factionId) ?? 0) + gameDeltaTime;
    if (accumulator < this.STRATEGY_TICK_INTERVAL) {
      this.accumulators.set(factionId, accumulator);
      return false;
    }
    this.accumulators.set(factionId, Math.max(0, accumulator - this.STRATEGY_TICK_INTERVAL));

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
        return this.evaluateColonizeExecute(goal, factionId, fleets, factions, starSystems, shipStock);
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
      /*
       * Expansion needs a Spaceship Factory, and only a develop action
       * builds one. Without this fallback a faction whose strategy stays
       * 'expand' waits forever for a factory it never constructs.
       */
      if (!this.hasShipFactory(factionId, starSystems)) {
        return this.createAction('develop', factionId, goal, undefined, undefined, undefined, 'missing_factory_for_colonizer');
      }
      return this.createNoneAction(factionId, goal, colonizerAvailable.reason);
    }

    if (usableFleet && !usableFleet.satisfied) {
      /*
       * No fleet left (e.g. all fleets lost) but a colonizer is in stock:
       * assembling at a Spaceport creates a new fleet for it, so this is
       * a recoverable state rather than a permanent 'none'.
       */
      const stockData = { shipStock } as { shipStock?: { factionId: string; ships: ShipStockEntry[] }[] };
      if (this.shipStockService.getCount(stockData, factionId, 'colonizer') > 0) {
        if (this.spaceportService.hasSpaceport(factionId, starSystems)) {
          return this.createAction('assemble_fleet', factionId, goal, undefined, goal.targetSystemId, goal.targetPlanetId, 'Colonizer in stock and no fleet; assembling at Spaceport');
        }
        return this.createAction('develop', factionId, goal, undefined, undefined, undefined, 'missing_spaceport_for_assembly');
      }
      return this.createNoneAction(factionId, goal, usableFleet.reason);
    }

    return this.createNoneAction(factionId, goal, 'Cannot prepare for colonization');
  }

  private evaluateColonizeExecute(
    goal: ColonizeGoal,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
    shipStock: { factionId: string; ships: ShipStockEntry[] }[],
  ): ActionResult {
    const system = starSystems.find((s) => s.id === goal.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === goal.targetPlanetId);

    if (!system || !planet || planet.factionId !== 'unhabited') {
      return this.createNoneAction(factionId, goal, 'Target planet is no longer unhabited');
    }

    const fleetWithColonizer = this.selectCarrier(factionId, goal, fleets);

    if (!fleetWithColonizer) {
      const stockData = { shipStock } as { shipStock?: { factionId: string; ships: ShipStockEntry[] }[] };
      const colonizerInStock = this.shipStockService.getCount(stockData, factionId, 'colonizer') > 0;
      if (colonizerInStock) {
        // Fleet assembly requires a Spaceport; build one first instead of
        // retrying an assembly that FleetAssemblyService always rejects.
        if (!this.spaceportService.hasSpaceport(factionId, starSystems)) {
          return this.createAction('develop', factionId, goal, undefined, undefined, undefined, 'missing_spaceport_for_assembly');
        }
        return this.createAction('assemble_fleet', factionId, goal, undefined, goal.targetSystemId, goal.targetPlanetId, 'Colonizer in stock but no fleet has it');
      }
      // Every carrier serves another objective: this one needs its own colonizer.
      if (this.canProduceColonizer(factionId, factions, starSystems)) {
        return this.createAction('produce_colonizer', factionId, goal, undefined, goal.targetSystemId, goal.targetPlanetId, 'All carriers are assigned; producing another colonizer');
      }
      return this.createNoneAction(factionId, goal, 'No fleet with colonizer found');
    }

    /*
     * Arrival is measured on the galaxy map: the fleet's map cell must
     * match the target system's map cell. This is the same test the
     * executor uses before colonizing and the destination that
     * move_to_target sets. Do NOT compare fleet.gridCol/gridRow with the
     * planet's system-view cell: gridCol holds a galaxy-map cell after
     * map movement but a system-view cell after FleetAssemblyService
     * creates a fleet, so that comparison is never reliably true.
     */
    const atTarget = this.isFleetAtSystem(fleetWithColonizer, system);

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

    /*
     * Hysteresis with EnemyStrategyService: the strategy only *starts* an
     * attack with the difficulty's strength advantage; once committed the
     * attack continues while the fleet is not weaker than the target, and
     * is abandoned when the target has become stronger (reinforced, or our
     * fleet took losses). The released fleet falls back to
     * EnemyFleetService (retreat / regroup) instead of chasing forever.
     */
    if (this.shipService.calculateFleetStrength(enemyFleet.ships) < this.shipService.calculateFleetStrength(targetFleet.ships)) {
      return this.createNoneAction(factionId, goal, 'target_too_strong');
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

    /*
     * Defending next to the planet's own defenses justifies worse odds
     * than an attack, but not a hopeless fight: below DEFEND_MIN_RATIO of
     * the threat the fleet is not sent (EnemyFleetService keeps it safe).
     */
    const threat = fleets.find((f) => f.id === goal.threateningFleetId && !f.destroyed);
    if (threat
      && this.shipService.calculateFleetStrength(enemyFleet.ships)
        < this.DEFEND_MIN_RATIO * this.shipService.calculateFleetStrength(threat.ships)) {
      return this.createNoneAction(factionId, goal, 'threat_too_strong');
    }

    const atSystem = Math.floor(enemyFleet.x) === Math.floor(system.x) && Math.floor(enemyFleet.y) === Math.floor(system.y);

    if (atSystem) {
      return this.createAction('defend', factionId, goal, enemyFleet.id, goal.targetSystemId, goal.targetPlanetId, 'Enemy fleet is at the threatened system');
    }

    return this.createAction('move_to_target', factionId, goal, enemyFleet.id, goal.targetSystemId, goal.targetPlanetId, 'Enemy fleet needs to move to the threatened system');
  }

  private isFleetAtSystem(fleet: Fleet, system: StarSystem): boolean {
    return Math.floor(fleet.x) === Math.floor(system.x) && Math.floor(fleet.y) === Math.floor(system.y);
  }

  /*
   * selectCarrier: The carrier already bound to this objective, otherwise
   * a carrier not bound to another still-active colonization objective
   * (lowest id). Binds the choice.
   */
  private selectCarrier(factionId: string, goal: ColonizeGoal, fleets: Fleet[]): Fleet | undefined {
    const carriers = fleets
      .filter((f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => s.type === 'colonizer' && !s.destroyed))
      .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name));
    // Drop bindings of this faction's fleets that are no longer carriers
    // (colonizer landed, fleet retired or destroyed), so the map stays bounded.
    const carrierIds = new Set(carriers.map((c) => c.id));
    for (const fleetId of [...this.carrierTargets.keys()]) {
      const fleet = fleets.find((f) => f.id === fleetId);
      if ((!fleet || fleet.factionId === factionId) && !carrierIds.has(fleetId)) {
        this.carrierTargets.delete(fleetId);
      }
    }
    const activeTargets = new Set<number>([goal.targetPlanetId]);
    for (const action of [this.currentActions.get(factionId), this.colonizationActions.get(factionId)]) {
      if (action?.goal?.type === 'colonize') {
        activeTargets.add(action.goal.targetPlanetId);
      }
    }
    const bound = carriers.find((c) => this.carrierTargets.get(c.id) === goal.targetPlanetId);
    const carrier = bound ?? carriers.find((c) => {
      const servedPlanet = this.carrierTargets.get(c.id);
      return servedPlanet === undefined || !activeTargets.has(servedPlanet);
    });
    if (carrier) {
      this.carrierTargets.set(carrier.id, goal.targetPlanetId);
    }
    return carrier;
  }

  /*
   * findBestEnemyFleet: The faction's strongest living fleet that carries
   * no colonizer (a colonization run is never diverted into combat).
   * Ties: lowest id. Strength counts living ships only.
   */
  private findBestEnemyFleet(factionId: string, fleets: Fleet[]): Fleet | undefined {
    const candidates = fleets.filter(
      (f) =>
        f.factionId === factionId
        && !f.destroyed
        && f.ships.some((ship) => !ship.destroyed)
        && !f.ships.some((ship) => ship.type === 'colonizer' && !ship.destroyed),
    );
    if (candidates.length === 0) {
      return undefined;
    }
    const strength = (f: Fleet) => this.shipService.calculateFleetStrength(f.ships);
    candidates.sort((a, b) => strength(b) - strength(a) || a.id - b.id || a.name.localeCompare(b.name));
    return candidates[0];
  }

  private hasShipFactory(factionId: string, starSystems: StarSystem[]): boolean {
    return starSystems.some((system) =>
      system.planetsTiles.some(
        (planet) =>
          planet.factionId === factionId && this.productionService.getPlanetCapacity(planet, 'spaceship_factory') > 0,
      ),
    );
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

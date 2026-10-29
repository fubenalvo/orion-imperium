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
} from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { EnemyIntelService } from './enemy-intel.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { StarMapMovementService } from './star-map-movement.service';
import { isCombatShipType } from './ai-queries';
import { canAffordCost, shipCost } from '../../services/resource-cost';

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
 * Duplicate-execution protection is mostly stateless: every
 * frame the executor re-checks the game-state fact that its own
 * mutation establishes (a queued colonizer order for
 * production; a fleet already carrying a colonizer for
 * assembly; a fleet already moving to, or already at, the same
 * destination for movement). One small piece of per-faction
 * state exists because no game-state fact can express it:
 *   - confirmedEngagements: attack/defend only *confirm* that a
 *     fleet is in place (battles start via collision detection),
 *     so they report a state change once per engagement, not on
 *     every frame the fleet stays there.
 * It is cleared by reset() (called from resetAiPipeline on load).
 *
 * Construction (`develop`) is delegated to EnemyEconomyService,
 * which owns the planner and the per-faction construction cooldown
 * shared with its background economy tick.
 *
 * The return value means "game state changed this frame"; it
 * feeds StarMap change detection and the autosave dirty flag.
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
    private readonly enemyEconomyService: EnemyEconomyService,
    private readonly planetOwnership: PlanetOwnershipService,
    private readonly intelService: EnemyIntelService,
  ) {}

  private readonly confirmedEngagements = new Map<string, string>();

  reset(): void {
    this.confirmedEngagements.clear();
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
    // True for the parallel colonization action: it must not reset the
    // primary action's attack/defend engagement confirmation.
    parallel = false,
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

    if (!parallel && action.type !== 'attack' && action.type !== 'defend') {
      this.confirmedEngagements.delete(faction.id);
    }

    switch (action.type) {
      case 'produce_colonizer':
        return this.executeProduceColonizer(action, factions, starSystems, production);
      case 'produce_combat_ship':
        return this.executeProduceCombatShip(action, factions, starSystems, production);
      case 'reinforce_fleet':
        return this.executeReinforceFleet(action, factions, starSystems, fleets, shipStock);
      case 'create_fleet':
        return this.executeCreateFleet(action, factions, starSystems, fleets, shipStock);
      case 'assemble_fleet':
        return this.executeAssembleFleet(action, starSystems, shipStock, fleets);
      case 'move_to_target':
        return this.executeMoveToTarget(action, fleets, starSystems);
      case 'colonize':
        return this.executeColonize(action, factions, starSystems, fleets, production);
      case 'attack':
        return this.executeAttack(action, fleets);
      case 'defend':
        return this.executeDefend(action, starSystems, fleets);
      case 'develop':
        return this.enemyEconomyService.tryConstruct(faction, starSystems, { fleets, shipStock, production, factions });
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

    if (!canAffordCost(faction, shipCost(shipType))) {
      return false;
    }

    if (this.hasPendingOrder(production, faction.id, 'colonizer')) {
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
    return true;
  }

  /*
   * executeProduceCombatShip: Queues one combat ship production order
   * at the faction's deterministic first factory planet. The ship type
   * is taken from action.shipTypeId which was selected by
   * EnemyActionService.selectCheapestCombatShip.
   *
   * Guards (checked every frame) prevent duplicate execution:
   *   - faction has researched basic_engineering
   *   - faction has unlocked the specific combat ship type
   *   - faction can afford the ship
   *   - no pending order for the same ship type already exists
   *   - a planet with spaceship_factory capacity exists
   */
  private executeProduceCombatShip(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    production: FactionProduction[],
  ): boolean {
    const faction = factions.find((f) => f.id === action.factionId);
    if (!faction) {
      return false;
    }

    const shipTypeId = action.shipTypeId;
    if (!shipTypeId) {
      return false;
    }

    const shipType = this.shipService.getShipType(shipTypeId);
    if (!shipType) {
      return false;
    }

    if (!this.researchService.isResearched(faction, 'basic_engineering')) {
      return false;
    }

    if (!this.researchService.isShipUnlocked(faction, shipTypeId)) {
      return false;
    }

    if (!canAffordCost(faction, shipCost(shipType))) {
      return false;
    }

    if (this.hasPendingOrder(production, faction.id, shipTypeId)) {
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
      shipTypeId,
      1,
      starSystems,
      factions,
    );

    if (!result.ok) {
      return false;
    }
    return true;
  }

  /*
   * executeReinforceFleet: Pulls one combat ship of each combat
   * type already present in the target fleet from the faction's
   * stock to replace losses.
   *
   * Guards:
   *   - Fleet exists, is not destroyed, belongs to the faction
   *   - Fleet has at least one combat ship type to reinforce
   *   - Fleet strength is still below action.targetStrength
   *     (the peak strength computed by the capability layer).
   *     This makes the action idempotent across the frame loop:
   *     once the fleet is healed the action produces no further
   *     stock consumption even though the action object persists
   *     until the next strategy tick.
   * The FleetAssemblyService validates spaceport and stock.
   */
  private executeReinforceFleet(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    shipStock: FactionShipStock[],
  ): boolean {
    const faction = factions.find((f) => f.id === action.factionId);
    if (!faction) {
      return false;
    }

    const fleet = fleets.find((f) => f.id === action.targetId);
    if (!fleet || fleet.destroyed || fleet.factionId !== faction.id) {
      return false;
    }

    /*
     * Compare living strength only. Destroyed ships stay in the roster
     * after a battle, so counting them would make a damaged fleet look
     * already healed and block the reinforcement it needs.
     */
    const livingShips = fleet.ships.filter((ship) => !ship.destroyed);
    if (action.targetStrength !== undefined
      && this.shipService.calculateFleetStrength(livingShips) >= action.targetStrength) {
      return false;
    }

    /*
     * Do not reinforce a fleet that is currently engaged. The map
     * battle flow triggers as soon as hostile fleets share a map
     * cell, so co-location with a non-allied living fleet is the
     * best available signal that a battle is being resolved or is
     * about to start. Reinforcing mid-engagement would feed stock
     * into a fight that is already being simulated elsewhere.
     */
    const inActiveBattle = fleets.some((other) => {
      if (other.id === fleet.id || other.destroyed) {
        return false;
      }
      if (other.factionId === fleet.factionId) {
        return false;
      }
      if (other.x !== fleet.x || other.y !== fleet.y) {
        return false;
      }
      const otherFaction = factions.find((f) => f.id === other.factionId);
      return otherFaction !== undefined && otherFaction.team !== faction.team;
    });

    if (inActiveBattle) {
      return false;
    }

    /*
     * Ships come out of the global stock at a Spaceport, so only a fleet
     * physically in a Spaceport system can receive them —
     * FleetAssemblyService.reinforceFleet does not check location itself.
     * A damaged fleet elsewhere is brought home by EnemyFleetService
     * (regroup) and reinforced on arrival.
     */
    const atSpaceport = this.spaceportService
      .listSpaceports(faction.id, starSystems)
      .some(({ system }) => Math.floor(system.x) === Math.floor(fleet.x) && Math.floor(system.y) === Math.floor(fleet.y));
    if (!atSpaceport) {
      return false;
    }

    const combatTypes = new Map<string, number>();
    for (const ship of livingShips) {
      if (isCombatShipType(this.shipService.getShipType(ship.type))) {
        combatTypes.set(ship.type, (combatTypes.get(ship.type) ?? 0) + 1);
      }
    }

    if (combatTypes.size === 0) {
      return false;
    }

    const data = { fleets, shipStock };
    const composition = Array.from(combatTypes.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([typeId]) => ({ typeId, count: 1 }));

    const result = this.fleetAssemblyService.reinforceFleet(data, starSystems, {
      factionId: faction.id,
      fleetId: fleet.id,
      composition,
    });

    return result.ok;
  }

  /*
   * executeCreateFleet: Creates a new defensive fleet at the
   * faction's nearest owned Spaceport planet with 2 copies
   * of the cheapest available combat ship type.
   *
   * Guard: skip once the faction already owns a living fleet with a
   * combat ship. The new fleet satisfies that fact immediately, which
   * makes creation idempotent across the frame loop — otherwise the
   * executor would create a fleet every frame until stock ran out.
   * FleetAssemblyService validates the planet and stock.
   */
  private executeCreateFleet(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    shipStock: FactionShipStock[],
  ): boolean {
    const faction = factions.find((f) => f.id === action.factionId);
    if (!faction) {
      return false;
    }

    if (this.hasCombatFleet(faction.id, fleets)) {
      return false;
    }

    const shipTypeId = action.shipTypeId;
    if (!shipTypeId) {
      return false;
    }

    const shipType = this.shipService.getShipType(shipTypeId);
    if (!shipType) {
      return false;
    }

    const system = starSystems.find((s) => s.id === action.targetSystemId);
    if (!system) {
      return false;
    }

    const planet = system.planetsTiles.find((p) => p.id === action.targetPlanetId);
    if (!planet || planet.factionId !== faction.id) {
      return false;
    }

    const data = { fleets, shipStock };
    const result = this.fleetAssemblyService.createFleet(data, starSystems, {
      factionId: faction.id,
      fleetName: `${faction.id} Fleet`,
      systemId: system.id,
      planetId: planet.id,
      composition: [{ typeId: shipTypeId, count: 2 }],
    });

    return result.ok;
  }

  /*
   * hasCombatFleet: True when the faction owns at least one living fleet
   * that contains at least one living combat-role ship.
   */
  private hasCombatFleet(factionId: string, fleets: Fleet[]): boolean {
    return fleets.some((fleet) =>
      fleet.factionId === factionId
      && !fleet.destroyed
      && fleet.ships.some((ship) => !ship.destroyed && isCombatShipType(this.shipService.getShipType(ship.type))),
    );
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
    if (this.hasIdleCarrier(action.factionId, fleets)) {
      return false;
    }

    const stockData = { shipStock } as { shipStock?: FactionShipStock[] };
    if (this.shipStockService.getCount(stockData, action.factionId, 'colonizer') < 1) {
      return false;
    }

    const data = { shipStock, fleets };
    const composition = [{ typeId: 'colonizer', count: 1 }];

    const candidate = this.selectReinforceFleet(action.factionId, fleets, starSystems);
    if (candidate) {
      const result = this.fleetAssemblyService.reinforceFleet(data, starSystems, {
        factionId: action.factionId,
        fleetId: candidate.id,
        composition,
      });
      if (!result.ok) {
        return false;
      }
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
      // Fog of war: chase where the faction believes the target is.
      const known = this.intelService.getKnownPosition(action.factionId, targetFleet);
      if (!known) {
        return false;
      }
      destX = known.x;
      destY = known.y;
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

    // A moving target (attack goal) shifts a little every frame; re-issue
    // the order only once it drifted a full cell, otherwise every frame
    // would rewrite the target and report a state change.
    if (fleet.targetX !== null && fleet.targetY !== null
      && Math.abs(fleet.targetX - destX) < 1 && Math.abs(fleet.targetY - destY) < 1) {
      return false;
    }

    // Already parked in the destination cell: re-issuing the order would
    // restart a zero-length move every frame (movement clears the target
    // on arrival) and report a false state change each time.
    if (fleet.targetX === null
      && Math.floor(fleet.x) === Math.floor(destX)
      && Math.floor(fleet.y) === Math.floor(destY)) {
      return false;
    }

    fleet.targetX = destX;
    fleet.targetY = destY;
    return true;
  }

  /*
   * executeColonize: Colonizes an unhabited planet using a colonizer
   * from an AI fleet in the target system's galaxy-map cell. Reuses
   * PlanetBattleService.resolveUninhabitedArrival to detect the
   * colonizer and remove it from the fleet.
   *
   * Guards (checked every frame) prevent duplicate or invalid
   * colonization:
   *   - target planet still exists and is unhabited
   *   - an AI fleet with a living colonizer is in the system's map cell
   */
  private executeColonize(
    action: ActionResult,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    production: FactionProduction[],
  ): boolean {
    const system = starSystems.find((s) => s.id === action.targetSystemId);
    const planet = system?.planetsTiles.find((p) => p.id === action.targetPlanetId);
    if (!system || !planet || planet.factionId !== 'unhabited') {
      return false;
    }

    // Prefer the fleet that actually carries a colonizer; a combat fleet
    // sharing the cell must not hide it.
    const fleetsHere = fleets.filter(
      (f) =>
        f.factionId === action.factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        Math.floor(f.x) === Math.floor(system.x) &&
        Math.floor(f.y) === Math.floor(system.y),
    );
    const fleet = fleetsHere.find((f) => f.ships.some((s) => s.type === 'colonizer' && !s.destroyed))
      ?? fleetsHere[0];

    if (!fleet) {
      return false;
    }

    const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
    if (!result.colonized || result.colonizerIndex < 0) {
      return false;
    }

    fleet.ships.splice(result.colonizerIndex, 1);
    this.planetOwnership.transferPlanet({ production, factions }, planet, action.factionId, 'colonized');
    // A colonizer-only fleet has nothing left after landing; retire it so
    // empty AI fleets do not accumulate on the map with every colony.
    if (!fleet.ships.some((s) => !s.destroyed)) {
      fleet.destroyed = true;
    }

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

    return this.confirmEngagement(action.factionId, `attack:${attackerFleet.id}:${targetFleet.id}`);
  }

  /*
   * Returns true only the first time a faction confirms a given
   * engagement, so a fleet waiting in place is not reported as a state
   * change on every frame.
   */
  private confirmEngagement(factionId: string, key: string): boolean {
    if (this.confirmedEngagements.get(factionId) === key) {
      return false;
    }
    this.confirmedEngagements.set(factionId, key);
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

    return this.confirmEngagement(action.factionId, `defend:${fleet.id}:${system.id}`);
  }

  /*
   * hasFleetWithColonizer: True when a non-destroyed faction fleet
   * already carries a living colonizer. This is the state fact that
   * a successful assembly establishes, so it doubles as the
   * duplicate-execution guard between action re-evaluations.
   */
  /*
   * hasIdleCarrier: A carrier with no movement order is waiting for one;
   * assembling another colonizer would duplicate it. Carriers already
   * travelling to an objective do not block assembly for a second,
   * concurrent objective (expansionist personality).
   */
  private hasIdleCarrier(factionId: string, fleets: Fleet[]): boolean {
    return fleets.some(
      (f) =>
        f.factionId === factionId &&
        !f.destroyed &&
        f.targetX === null &&
        f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
    );
  }

  /*
   * selectReinforceFleet: Picks the lowest-id usable faction fleet that
   * does not yet carry a colonizer, has no movement order, AND is physically in one of the
   * faction's Spaceport systems (same galaxy-map cell), so the colonizer
   * boards a fleet that is actually there. FleetAssemblyService itself
   * does not check fleet location; without this filter the colonizer
   * would appear in a fleet anywhere on the map. When no fleet is at a
   * Spaceport, executeAssembleFleet creates a new fleet at the Spaceport.
   */
  private selectReinforceFleet(factionId: string, fleets: Fleet[], starSystems: StarSystem[]): Fleet | undefined {
    const spaceportCells = new Set(
      this.spaceportService
        .listSpaceports(factionId, starSystems)
        .map(({ system }) => `${Math.floor(system.x)},${Math.floor(system.y)}`),
    );
    const candidates = fleets.filter(
      (f) =>
        f.factionId === factionId &&
        !f.destroyed &&
        f.ships.some((s) => !s.destroyed) &&
        !f.ships.some((s) => s.type === 'colonizer' && !s.destroyed) &&
        // Parked only: a fleet passing through on another order (e.g. an
        // interception) would carry the colonizer off with it.
        f.targetX === null &&
        spaceportCells.has(`${Math.floor(f.x)},${Math.floor(f.y)}`),
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

  private hasPendingOrder(production: FactionProduction[], factionId: string, shipTypeId: string): boolean {
    const factionProd = production.find((p) => p.factionId === factionId);
    if (!factionProd) {
      return false;
    }
    return Object.values(factionProd.ordersByPlanet).some((orders) =>
      orders.some((order) => order.shipTypeId === shipTypeId),
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

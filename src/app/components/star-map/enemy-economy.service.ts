import { EnemyResearchService } from './enemy-research.service';
import { constructionSites, operationalBuildings, startBuildingConstruction, withConstructionComplete } from './building-construction';
import { HULL_CLASSES, HULL_CLASS_INFO, HullClass, getHullClass } from './hull-class';
import { planetTypeTraits } from './planet-types';
import { Injectable } from '@angular/core';
import {
  Faction,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  ShipType,
  StarSystem,
} from './star-map.models';
import { centerOutPlacementOrder, getPlanetGridSize, isFootprintBlocked } from './planet-surface/planet-surface';
import { EconomyService, POPULATION_CREDIT_RATE, administrationShare } from '../../services/economy.service';
import { comfortNeed, comfortProvided } from './comfort';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { canSupportNewColony, isCombatShipType } from './ai-queries';
import { EnemyPlanService } from './enemy-plan.service';
import { getAiPersonalityProfile } from './ai-personality';
import planetData from './planet-data.json';
import { ResourceCost, addCosts, buildingCost, canAffordCost, payCost, shipCost } from '../../services/resource-cost';
import { hostileFactionIds } from './diplomacy';
import { depositMiningBlocker, DEPOSIT_MINING_BUILDING_NAMES } from './raw-deposits';
import { isCivilianMissionFleet } from './space-base';
import { isBuildingLimitReached } from './building-placement';
import { TRADING_POST_NAME, TRADE_BUY_CREDITS_PER_RAW, executeTrade, ownsTradingPost } from './trade';
import { TRADING_POST_EXPECTED_INCOME } from './trade-network';
import { AiActionLedger, rejectionReason } from './ai-action-ledger';

const BANK_NAME = 'Bank';

/*
 * =========================================================
 * ENEMY ECONOMY SERVICE (AI economy manager)
 * =========================================================
 *
 * Background economic management for every AI faction, independent of
 * the faction's current strategic goal. The strategic pipeline
 * (strategy → goal → capability → action → executor) picks ONE goal at
 * a time; without this service a faction stopped building while a
 * colonization run was in progress and never produced military when
 * no attack/defend goal was active.
 *
 * Every DECISION_INTERVAL seconds of game time, per faction:
 *   1. construction  — at most one building (shared cooldown with the
 *                      executor's `develop` action, see tryConstruct)
 *   2. military      — queue combat ships when below target strength
 *   3. deployment    — move stocked combat ships into a fleet located at
 *                      a Spaceport (or create a fleet there)
 *
 * Game rules this relies on (verified in code, keep in sync):
 *  - Buildings and ships cost credits AND raw materials (resource-cost.ts,
 *    the same helpers the player UI uses); ships are mostly raw materials,
 *    buildings mostly credits. Research costs research points and credits
 *    (ResearchService, spent by EnemyResearchService).
 *  - Raw materials come from finite deposits (raw-deposits.ts): a Mining
 *    Complex extracts its planet's deposit until it is empty. Depleted
 *    deposits are never mined again, so raw supply must be renewed by
 *    expanding (EnemyGoalService values deposits) and by asteroid mining
 *    stations (EnemyMiningService).
 *  - Buildings, fleet ships and stocked ships pay upkeep every economy
 *    tick (EconomyService.applyEconomyDelta). Credits never go negative:
 *    unpaid upkeep (arrears) drains satisfaction toward rebellion, and a
 *    large energy deficit lowers the satisfaction target (0 at a 50%
 *    shortfall; comfort.ts satisfactionTarget).
 *  - Credit income is population × 0.085 × satisfaction; population is
 *    capped by housing capacity, so housing is the real growth building.
 *    Above COMFORT_CONFIG.freePopulation a planet needs comfort buildings
 *    (comfort.ts): uncovered population lowers the satisfaction target,
 *    so the comfort tier runs before growth housing.
 *  - Ships are built by Spaceship Factories into the faction-wide stock;
 *    leaving the stock requires a Spaceport (FleetAssemblyService).
 *    FleetAssemblyService.reinforceFleet does not check where the fleet
 *    is, so this service only reinforces fleets that are physically in a
 *    Spaceport system (no teleporting ships).
 *
 * Spending policy: construction rules are tiered. Emergency and core
 * infrastructure may spend everything; optional tiers (defense, growth,
 * research) and military production must leave a reserve (credits and raw
 * materials) that covers the currently committed needs (next colonizer, a
 * missing Spaceport, the next military ship). An unaffordable rule falls
 * through to the next rule, so a shortage changes the decision instead of
 * deadlocking.
 *
 * Upkeep policy: every purchase adds permanent upkeep, so each one must
 * leave the faction's projected net credit income (current net minus the
 * upkeep of queued ships) above a per-tier margin: emergency power has no
 * margin (it prevents rebellion); core infrastructure and housing need
 * net ≥ 0 after the purchase, except that the treasury may carry a
 * deficit for CORE_RUNWAY_SECONDS; optional buildings and warships need a
 * share of gross income left over (OPTIONAL_BUILDING_MARGIN_SHARE, larger,
 * and UPKEEP_MARGIN_SHARE / personality military preference). A faction whose
 * net is negative therefore only builds what restores it (power, housing,
 * which raises income) until income catches up.
 *
 * State is in-memory only and rebuilt from the game snapshot; reset()
 * runs on load via StarMapAiTickService.resetAiPipeline().
 */

interface BuildingDef {
  id: string;
  name: string;
  role?: string;
  size: number;
  price: number;
  rawMaterialCost?: number;
  population?: number;
  requiresOreProximity?: boolean;
  maxPerPlanet?: number;
  production?: { credits?: number };
  workforce?: number;
  energyConsumption?: number;
  maintenanceCost?: number;
  /* Comfort points (comfort.ts); comfort buildings only. */
  comfort?: number;
}

interface ConstructionDecision {
  planet: PlanetTile;
  building: BuildingDef;
  x: number;
  y: number;
}

type PlanetEconomySnapshot = ReturnType<EconomyService['calculatePlanetEconomy']>;

/*
 * 'net': the purchase must keep the projected net non-negative, with no
 * treasury runway (comfort: a building whose upkeep exceeds the income it
 * restores must not push a faction into a lasting deficit).
 */
type UpkeepTier = 'emergency' | 'core' | 'net' | 'optional';

interface ConstructionRule {
  /*
   * Credit income/s the building is expected to add on this planet (the
   * comfort tier's satisfaction gain). It is deducted from the building's
   * upkeep like a Bank's output, so an investment that pays for itself is
   * allowed even at a negative net: the way out of a poverty trap.
   */
  incomeGain?: (planet: PlanetTile, building: BuildingDef) => number;
  /*
   * Whether this tier must leave the spending reserve untouched: entirely,
   * or only its credit part ('credits': mines, which produce the raw
   * materials the reserve is waiting for).
   */
  respectsReserve: boolean | 'credits';
  /* How much projected net income the new building's upkeep must leave (see header). */
  upkeep: UpkeepTier;
  candidates: (planet: PlanetTile, economy: PlanetEconomySnapshot) => BuildingDef[];
}

/* Budget for one construction decision: spendable stock and upkeep headroom (credits/s). */
interface ConstructionBudget {
  cost: ResourceCost;
  upkeepAllowance: number;
  /* The faction's empire upkeep scale; a new building's upkeep is priced with it. */
  upkeepScale: number;
  /* The rule's ConstructionRule.incomeGain. */
  incomeGain?: ConstructionRule['incomeGain'];
  /*
   * Core buildings the faction still lacks (Spaceport, Spaceship Factory),
   * the owned planets, and how many of the missing ones fit right now. No
   * placement may reduce that number (see countPlaceableCore).
   */
  coreSites?: { planets: PlanetTile[]; missing: BuildingDef[]; placeable: number };
}

export interface EconomyContext {
  fleets: Fleet[];
  shipStock: FactionShipStock[];
  production: FactionProduction[];
  /* All factions; used to measure hostile fleet threat. Optional for callers without it. */
  factions?: Faction[];
  /* Fog of war: what the faction knows (EnemyIntelService); threat and target checks use these. */
  perceivedFleets?: Fleet[];
  perceivedSystems?: StarSystem[];
}

@Injectable({ providedIn: 'root' })
export class EnemyEconomyService {
  static readonly DECISION_INTERVAL = 2;
  private static readonly COOLDOWN_EPSILON = 1e-6;
  // A planet at this fraction of its housing capacity gets more housing.
  private static readonly HOUSING_GROWTH_THRESHOLD = 0.9;
  // The comfort tier builds while a planet's coverage is below this.
  private static readonly AI_COMFORT_TARGET = 1;
  // Share of a housing block's expected net income counted before its people arrive (housingIncomeGain).
  private static readonly HOUSING_GAIN_DISCOUNT = 0.5;
  // Growth housing waits for comfort below this coverage (waitsForComfort).
  private static readonly AI_COMFORT_MIN_FOR_HOUSING = 0.8;
  /*
   * Military target, in ShipService.calculateFleetStrength units (a
   * fighter is ~26, a destroyer ~84): a peacetime baseline per owned
   * planet, raised to THREAT_COVER × the strength of hostile fleets near
   * AI territory. Above HOARD_THRESHOLD credits the target doubles so
   * surplus credits become military. Ship counts are capped so battles
   * and fleets stay bounded regardless of income.
   */
  private static readonly MILITARY_BASE_STRENGTH = 80;
  private static readonly MILITARY_STRENGTH_PER_PLANET = 60;
  /*
   * Economy-scaled floor of the military target: the strength whose upkeep
   * costs this share of gross credit income (using the preferred hull's
   * strength per upkeep). It matches the headroom the upkeep margins leave
   * for warships, so a growing economy keeps arming instead of spending
   * everything on buildings, and a shrinking one stops.
   */
  private static readonly MILITARY_INCOME_SHARE = 0.12;
  private static readonly THREAT_RADIUS = 25;
  private static readonly THREAT_COVER = 1.5;
  private static readonly WEALTHY_TARGET_MULTIPLIER = 2;
  private static readonly MILITARY_SHIP_CAP = 24;
  /*
   * Base share of each hull class (by ship cost) in an AI navy, before the
   * counter to the enemy's known fleets is mixed in (preferredHullClass).
   * Only unlocked classes count, renormalized.
   */
  private static readonly HULL_CLASS_BASE_MIX: Record<HullClass, number> = { light: 0.3, medium: 0.4, heavy: 0.3 };
  /* One carrier (shield-aura hull) per this many combat ships; see wantsSupportHull. */
  private static readonly SUPPORT_SHIPS_PER_HULL = 8;
  private static readonly WEALTHY_SHIP_CAP = 60;
  // A home fleet at this size is not reinforced further; new ships form a new fleet.
  private static readonly MAX_FLEET_SHIPS = 12;
  // Above this balance surplus credits are turned into extra military.
  // Just above the most expensive single building (Spaceport, 4000), so
  // only credits no planned purchase needs count as surplus.
  private static readonly HOARD_THRESHOLD = 5000;
  // A large surplus: commerce buildings switch to the personality's `rich` numbers.
  private static readonly COMMERCE_RICH_CREDITS = 15000;
  // Banks and Trading Posts only go on planets at least this populated.
  private static readonly COMMERCE_MIN_POPULATION = 600;
  /*
   * Share of gross credit income that must remain as net income after a
   * purchase's upkeep. Warships keep a small buffer (scaled by personality);
   * optional buildings keep a larger one. Building upkeep is permanent and
   * construction runs before military production every decision, so
   * without the gap optional buildings would lock in all headroom long
   * before the navy needs it.
   */
  private static readonly UPKEEP_MARGIN_SHARE = 0.1;
  private static readonly OPTIONAL_BUILDING_MARGIN_SHARE = 0.25;
  /*
   * Deposit mining: every owned planet with a live deposit gets one Mining
   * Complex; while raw materials are the binding constraint (see
   * isRawConstrained) a deposit holding at least SECOND_MINE_MIN_RESERVE
   * gets a second one, up to MAX_MINES_PER_PLANET. Extra mines empty a
   * deposit faster rather than adding to it, so they only pay off while raw
   * materials are short.
   */
  private static readonly MAX_MINES_PER_PLANET = 2;
  private static readonly SECOND_MINE_MIN_RESERVE = 15000;
  /*
   * Research is "starved" when the faction could pay the credits of every
   * technology it can research next (the most expensive one) but its labs
   * need longer than this to produce that technology's research points;
   * research buildings then come first.
   */
  private static readonly RESEARCH_STARVED_SECONDS = 180;
  /*
   * Warships are mostly raw materials and strength per raw material is
   * about the same for every hull, so buying the cheapest hull the moment
   * a few hundred raw materials come in would fill the ship-count cap with
   * light ships. The faction instead saves for its preferred hull when its
   * income pays the missing part within this many seconds.
   */
  private static readonly MILITARY_SAVE_SECONDS = 90;
  /*
   * Core purchases (housing, factory, Spaceport) may run a deficit the
   * treasury can carry for this many seconds. Without it a faction whose
   * only planet is a fresh colony (zero income) could never build the
   * housing that creates income.
   */
  private static readonly CORE_RUNWAY_SECONDS = 300;
  // Raw purchases (buyRawMaterials) leave this much gross income in credits untouched, and buy in lots of this size.
  private static readonly RAW_PURCHASE_MARGIN_SECONDS = 300;
  private static readonly RAW_PURCHASE_LOT = 500;
  // Negative-net time after which an idle fleet goes into the reserve (reserveWeakestIdleFleet).
  private static readonly DEFICIT_RESERVE_SECONDS = 120;
  private static readonly FACTORY_NAME = 'Spaceship Factory';
  private static readonly SPACEPORT_NAME = 'Spaceport';

  private readonly accumulators = new Map<string, number>();
  private readonly constructionCooldowns = new Map<string, number>();
  // Seconds of game time each faction's projected net has been negative in a row (decision granularity).
  private readonly deficitSeconds = new Map<string, number>();
  // deficitSeconds value at the faction's last reserveWeakestIdleFleet.
  private readonly lastReserveAt = new Map<string, number>();

  constructor(
    private readonly economyService: EconomyService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly productionService: ProductionService,
    private readonly spaceportService: SpaceportService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly planService: EnemyPlanService,
    private readonly enemyResearch: EnemyResearchService,
    private readonly actionLedger: AiActionLedger,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.constructionCooldowns.clear();
    this.deficitSeconds.clear();
    this.lastReserveAt.clear();
  }

  /*
   * advanceConstructionClock: Counts down the per-faction construction
   * cooldown. tick() calls it on every frame for every AI faction — tick
   * is the single per-frame owner of the clock, so the cooldown is never
   * decremented twice in one frame and keeps running even while the
   * faction has no strategic action.
   */
  advanceConstructionClock(factionId: string, gameDeltaTime: number): void {
    const cooldown = this.constructionCooldowns.get(factionId);
    if (cooldown !== undefined && gameDeltaTime > 0) {
      this.constructionCooldowns.set(factionId, Math.max(0, cooldown - gameDeltaTime));
    }
  }

  /* Background management; returns true when game state changed. */
  tick(gameDeltaTime: number, faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true) {
      return false;
    }
    this.advanceConstructionClock(faction.id, gameDeltaTime);
    const accumulator = (this.accumulators.get(faction.id) ?? 0) + gameDeltaTime;
    if (accumulator < EnemyEconomyService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, Math.max(0, accumulator - EnemyEconomyService.DECISION_INTERVAL));

    const net = this.getProjectedNet(faction, starSystems, context).net;
    const deficit = net < 0 ? (this.deficitSeconds.get(faction.id) ?? 0) + EnemyEconomyService.DECISION_INTERVAL : 0;
    this.deficitSeconds.set(faction.id, deficit);

    let changed = this.tryConstruct(faction, starSystems, context);
    changed = this.buyRawMaterials(faction, starSystems, context) || changed;
    changed = this.manageMilitaryProduction(faction, starSystems, context) || changed;
    // Stocked ships pay half upkeep: in a lasting deficit they stay in the
    // reserve, and every DEFICIT_RESERVE_SECONDS one more idle fleet joins
    // them while the treasury cannot carry the deficit.
    const lasting = deficit >= EnemyEconomyService.DEFICIT_RESERVE_SECONDS;
    if (!lasting) {
      this.lastReserveAt.delete(faction.id);
      changed = this.deployStockedCombatShips(faction, starSystems, context) || changed;
    } else if (deficit - (this.lastReserveAt.get(faction.id) ?? 0) >= EnemyEconomyService.DEFICIT_RESERVE_SECONDS
      && (faction.currencies['credits'] ?? 0) < -net * EnemyEconomyService.CORE_RUNWAY_SECONDS
      && this.reserveWeakestIdleFleet(faction, starSystems, context)) {
      this.lastReserveAt.set(faction.id, deficit);
      changed = true;
    }
    return changed;
  }

  /*
   * buyRawMaterials: the raw-bound surplus (docs/late-economy.md). A
   * faction that cannot pay the raw part of its next warships but holds
   * credits beyond its spending reserve plus RAW_PURCHASE_MARGIN_SECONDS of
   * gross income buys the missing raw materials at the exchange (open with
   * any own Trading Post), at the player's rate (trade.ts executeTrade). At most what two of its preferred
   * warships lack, in whole lots, so the expensive exchange turns surplus
   * credits into ships rather than a raw-material hoard.
   */
  private buyRawMaterials(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    if (!this.isRawConstrained(faction)) return false;
    if (!ownsTradingPost(faction.id, starSystems)) return false;
    const ship = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity);
    if (!ship) return false;
    const finances = this.getProjectedNet(faction, starSystems, context);
    const reserve = this.getSpendingReserve(faction, starSystems, context, true);
    const spendable = (faction.currencies['credits'] ?? 0) - reserve.credits - shipCost(ship, 2).credits
      - Math.max(0, finances.income) * EnemyEconomyService.RAW_PURCHASE_MARGIN_SECONDS;
    const missing = shipCost(ship, 2).rawmaterials + reserve.rawmaterials - (faction.currencies['rawmaterials'] ?? 0);
    const lot = EnemyEconomyService.RAW_PURCHASE_LOT;
    const amount = Math.min(Math.ceil(missing / lot), Math.floor(spendable / (lot * TRADE_BUY_CREDITS_PER_RAW))) * lot;
    if (amount <= 0) return false;
    const trade = executeTrade(faction, starSystems, 'buyRaw', amount);
    if (trade.ok) this.actionLedger.record(faction, 'raw_purchase', amount);
    else this.actionLedger.reject(faction, 'raw_purchase', trade.reason);
    return trade.ok;
  }

  /*
   * reserveWeakestIdleFleet: the poverty-trap exit (docs/late-economy.md).
   * After DEFICIT_RESERVE_SECONDS of negative net with a treasury that
   * cannot carry it, the faction moves its weakest idle combat fleet parked
   * at one of its Spaceports into the reserve (RESERVE_SHIP_UPKEEP_FACTOR:
   * half upkeep), the player's rule (docs/fleet-organization.md). At most one
   * fleet per DEFICIT_RESERVE_SECONDS; the reserve redeploys once the net
   * is no longer negative.
   */
  private reserveWeakestIdleFleet(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    const spaceports = this.getSortedSpaceports(faction.id, starSystems);
    const atSpaceport = (f: Fleet) => spaceports.some(
      (sp) => Math.floor(f.x) === Math.floor(sp.system.x) && Math.floor(f.y) === Math.floor(sp.system.y),
    );
    const fleet = context.fleets
      .filter((f) =>
        f.factionId === faction.id
        && !f.destroyed
        && f.targetX === null
        && f.ships.some((s) => !s.destroyed && isCombatShipType(this.shipService.getShipType(s.type)))
        && !f.ships.some((s) => !s.destroyed && !isCombatShipType(this.shipService.getShipType(s.type)))
        && !isCivilianMissionFleet(f)
        && atSpaceport(f))
      .map((f) => ({ f, strength: this.shipService.calculateFleetStrength(f.ships.filter((s) => !s.destroyed)) }))
      .sort((a, b) => a.strength - b.strength || a.f.id - b.f.id)[0]?.f;
    if (!fleet) return false;
    const result = this.fleetAssemblyService.disbandFleet({ fleets: context.fleets, shipStock: context.shipStock }, faction.id, fleet.id);
    if (result.ok) this.actionLedger.record(faction, 'fleet_to_reserve');
    else this.actionLedger.reject(faction, 'fleet_to_reserve', rejectionReason(result));
    return result.ok;
  }

  /*
   * tryConstruct: Places at most one building per faction per
   * DECISION_INTERVAL. Shared by the background tick and the executor's
   * `develop` action through one cooldown. A search that finds nothing
   * also starts the cooldown, so an impossible build is not re-planned on
   * every frame.
   *
   * Rule tiers (each tried over all owned planets, ascending system id
   * then planet id; the first feasible building wins):
   *   E1 energy shortage           → power            (no reserve)
   *   E2 workforce shortage        → housing          (no reserve)
   *   I1 faction has no factory    → Spaceship Factory (no reserve)
   *   M1 factory, no working mine  → first Mining Complex (no reserve)
   *   I2 factory but no Spaceport  → Spaceport        (no reserve)
   *   H  planet without housing    → cheapest housing  (no reserve)
   *   M  live deposit, too few mines → Mining Complex  (credit reserve only)
   *   D  planet without defense    → defense building (reserve)
   *   G  population ≥ 90% capacity, or no housing yet → largest unlocked housing (reserve)
   *   R  planet without research   → research building (reserve)
   *   R2 only a small lab          → Research Laboratory (reserve)
   *   P  wealthy (credits > HOARD_THRESHOLD) and planet has no factory
   *      → Spaceship Factory, adding parallel ship production (reserve)
   * Every candidate must be unlocked, affordable, placeable, and must not
   * create or worsen an energy/workforce deficit on its planet; otherwise
   * an enabling power/housing building is tried first (two levels).
   */
  tryConstruct(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    // The cooldown and the decision accumulator share the same 2 s period;
    // floating-point summation of frame deltas can leave ~1e-15 on the
    // cooldown exactly when the next decision fires, which would silently
    // skip every other construction. Treat that residue as elapsed.
    if ((this.constructionCooldowns.get(faction.id) ?? 0) > EnemyEconomyService.COOLDOWN_EPSILON) {
      return false;
    }
    this.constructionCooldowns.set(faction.id, EnemyEconomyService.DECISION_INTERVAL);

    const decision = this.selectConstruction(faction, starSystems, context);
    if (!decision) {
      return false;
    }

    const price = buildingCost(decision.building);
    if (!payCost(faction, price)) {
      this.actionLedger.reject(faction, 'building_placed', 'insufficient_resources');
      return false;
    }
    // Same rule as the player: the building starts as a construction site.
    startBuildingConstruction(decision.planet, decision.building, decision.x, decision.y, price);
    // Recorded here only: the executor's `develop` action also lands here.
    this.actionLedger.record(faction, 'building_placed');
    return true;
  }

  /*
   * getSpendingReserve: Credits optional spending must leave untouched,
   * covering the faction's currently committed needs.
   */
  getSpendingReserve(
    faction: Faction,
    starSystems: StarSystem[],
    context: EconomyContext,
    includeMilitary: boolean,
    includeMine = true,
  ): ResourceCost {
    let reserve: ResourceCost = { credits: 0, rawmaterials: 0 };
    const planets = this.getOwnedPlanetsSorted(faction.id, starSystems);

    // A live deposit without a mine is the best raw-material investment the
    // faction has: its Mining Complex is committed spending, so warships and
    // optional buildings cannot use up the raw materials it needs. (The
    // mining rule itself passes includeMine = false, or it would wait for
    // its own price.)
    const mine = this.findBuilding('mining_complex');
    if (includeMine && mine && this.researchService.isBuildingUnlocked(faction, mine.id) && this.hasUnminedDeposit(planets)) {
      reserve = addCosts(reserve, buildingCost(mine));
    }

    const colonizer = this.shipService.getShipType('colonizer');
    if (colonizer && this.wantsColonizer(faction, starSystems, context)) {
      reserve = addCosts(reserve, shipCost(colonizer));
    }

    // Missing core buildings are saved for before optional spending: at
    // their prices, cheap optional buildings would otherwise always win.
    // Saving only works with positive net income; without it (e.g. a lone
    // fresh colony) growth buildings must not wait for a factory forever.
    const canSave = this.getProjectedNet(faction, starSystems, context).net > 0;
    const hasFactory = planets.some((p) => this.isFactoryPlanet(p));
    const factory = this.findBuilding('spaceship_factory');
    if (factory && !hasFactory && planets.length > 0 && canSave) {
      reserve = addCosts(reserve, buildingCost(factory));
    }
    const spaceport = this.findBuilding('spaceport');
    if (spaceport && hasFactory && canSave && !this.hasPlannedSpaceport(faction.id, starSystems)) {
      reserve = addCosts(reserve, buildingCost(spaceport));
    }

    // A colony without housing can never grow; its first housing block is
    // committed spending (raw materials are scarce, and warships would
    // otherwise use them up before a new colony gets anything).
    const firstHousing = this.cheapestUnlockedHousing(faction);
    if (firstHousing) {
      for (const planet of planets) {
        if (!this.hasRole(planet, 'housing')) reserve = addCosts(reserve, buildingCost(firstHousing));
      }
    }

    // Research credits: the price of the technology research is waiting for
    // (see researchCreditReserve).
    reserve = addCosts(reserve, { credits: this.researchCreditReserve(faction), rawmaterials: 0 });

    if (includeMilitary && this.militaryNeed(faction, starSystems, context).strength > 0) {
      const ship = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity, 1, context);
      if (ship) reserve = addCosts(reserve, shipCost(ship));
    }
    return reserve;
  }

  /*
   * Credits construction and the navy must leave for research. Research
   * costs research points AND credits (4 per point), and credits are the
   * scarcer of the two, so research only progresses if its credits are not
   * spent elsewhere first.
   * - A research-funding personality (fundsResearchFirst — the
   *   technologist): the credit price of EnemyResearchService's current
   *   target (the technology it is saving for), as soon as it is the target,
   *   so the credits are ready when the points arrive.
   * - Everyone else: the cheapest available technology whose points are
   *   banked (readyResearchCredits), what research will buy next. Reserving
   *   the (often dearer) target for every faction was tried: with the
   *   starting research points banked it held back the early build-up of
   *   all AIs.
   */
  getResearchCreditReserve(faction: Faction): number {
    return this.researchCreditReserve(faction);
  }

  private researchCreditReserve(faction: Faction): number {
    if (getAiPersonalityProfile(faction).fundsResearchFirst) {
      const target = this.enemyResearch.getResearchTarget(faction);
      if (target) return this.researchService.getResearchPrice(faction, target).credits;
    }
    return this.readyResearchCredits(faction);
  }

  /*
   * Credit price of the cheapest available technology whose research
   * points the faction already has (0 if none): what EnemyResearchService
   * will spend next, as soon as the credits are there.
   */
  private readyResearchCredits(faction: Faction): number {
    const researched = new Set(faction.researchedTechnologies ?? []);
    const points = faction.currencies['research'] ?? 0;
    let best: number | undefined;
    for (const tech of this.researchService.getAllTechnologies()) {
      if (researched.has(tech.id) || !tech.prerequisites.every((p) => researched.has(p))) continue;
      const price = this.researchService.getResearchPrice(faction, tech);
      if (price.research <= points && (best === undefined || price.credits < best)) best = price.credits;
    }
    return best ?? 0;
  }

  /* Some owned planet has a deposit that is neither empty nor mined yet. */
  private hasUnminedDeposit(planets: PlanetTile[]): boolean {
    return planets.some((p) => depositMiningBlocker(p) === null && this.countMines(p) === 0);
  }

  private cheapestUnlockedHousing(faction: Faction): BuildingDef | undefined {
    return [...this.unlockedByRole(faction, 'housing')].sort((a, b) => a.price - b.price)[0];
  }

  /*
   * getProjectedNet: Net credit income per second including the upkeep
   * the faction has already committed to but not yet started paying
   * (queued ship orders). Uses the same EconomyService calculation as the
   * economy tick and the HUD.
   */
  getProjectedNet(
    faction: Faction,
    starSystems: StarSystem[],
    context: EconomyContext,
  ): { income: number; net: number; rawNet: number; researchNet: number; upkeepScale: number } {
    const breakdown = this.economyService.calculateEconomy(
      faction.id, context.factions ?? [faction], starSystems, context.fleets, context.shipStock,
    );
    const upkeepScale = breakdown.upkeepScale;
    const queuedUpkeep = this.pendingOrders(faction.id, context)
      .reduce((sum, o) => sum + o.quantity * this.economyService.getShipUpkeepPerSecond(o.shipTypeId, faction, upkeepScale), 0);
    // Construction sites cost no upkeep yet, but they will on completion:
    // like queued ships, their upkeep is committed. Without this the AI keeps
    // buying against headroom that its own sites will take, and falls into
    // arrears once they finish (measured in ai-simulation.spec.ts).
    let siteUpkeep = 0;
    for (const planet of this.getOwnedPlanetsSorted(faction.id, starSystems)) {
      const planetScale = upkeepScale * planetTypeTraits(planet.type).buildingUpkeep;
      for (const site of constructionSites(planet)) {
        siteUpkeep += this.economyService.getBuildingUpkeepPerSecond(site.name, faction, planetScale);
      }
    }
    return {
      upkeepScale,
      income: breakdown.incomePerSecond,
      net: breakdown.netPerSecond - queuedUpkeep - siteUpkeep,
      rawNet: breakdown.net['rawmaterials'] ?? 0,
      researchNet: breakdown.net['research'] ?? 0,
    };
  }

  /*
   * Raw materials, not credits, limit the faction: it cannot pay the raw
   * part of two of its preferred warships but could pay their credits. Then
   * mining capacity beats more factories or a bigger fleet budget.
   */
  isRawConstrained(faction: Faction): boolean {
    const raw = faction.currencies['rawmaterials'] ?? 0;
    const credits = faction.currencies['credits'] ?? 0;
    const ship = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity);
    if (!ship) return false;
    const pair = shipCost(ship, 2);
    return raw < pair.rawmaterials && credits >= pair.credits;
  }

  /* See RESEARCH_STARVED_SECONDS. */
  private isResearchStarved(faction: Faction, researchNet: number): boolean {
    const researched = new Set(faction.researchedTechnologies ?? []);
    const available = this.researchService.getAllTechnologies()
      .filter((t) => !researched.has(t.id) && t.prerequisites.every((p) => researched.has(p)));
    if (available.length === 0) return false;
    const dearest = available
      .map((t) => this.researchService.getResearchPrice(faction, t))
      .sort((a, b) => b.research - a.research)[0];
    const points = faction.currencies['research'] ?? 0;
    if (points >= dearest.research || (faction.currencies['credits'] ?? 0) < dearest.credits) return false;
    return researchNet <= 0 || (dearest.research - points) / researchNet > EnemyEconomyService.RESEARCH_STARVED_SECONDS;
  }

  /*
   * Research is held back by credits, not by labs: the banked research
   * points already pay for an available technology, but the credits do not
   * (research also costs RESEARCH_CREDITS_PER_POINT credits per point). More
   * research buildings would then only add upkeep and slow research down
   * further, so construction skips them until the credits catch up.
   */
  private isResearchCreditBound(faction: Faction): boolean {
    const researched = new Set(faction.researchedTechnologies ?? []);
    const points = faction.currencies['research'] ?? 0;
    const credits = faction.currencies['credits'] ?? 0;
    const covered = this.researchService.getAllTechnologies()
      .filter((t) => !researched.has(t.id) && t.prerequisites.every((p) => researched.has(p)))
      .map((t) => this.researchService.getResearchPrice(faction, t))
      .filter((price) => points >= price.research);
    return covered.length > 0 && covered.every((price) => credits < price.credits);
  }

  /* Upkeep (credits/s) a new purchase in this tier may add. */
  private upkeepAllowance(tier: UpkeepTier, finances: { income: number; net: number }, credits: number): number {
    if (tier === 'emergency') return Infinity;
    if (tier === 'core') return finances.net + Math.max(0, credits) / EnemyEconomyService.CORE_RUNWAY_SECONDS;
    if (tier === 'net') return finances.net;
    return finances.net - finances.income * EnemyEconomyService.OPTIONAL_BUILDING_MARGIN_SHARE;
  }

  private selectConstruction(
    faction: Faction,
    starSystems: StarSystem[],
    context: EconomyContext,
  ): ConstructionDecision | undefined {
    const planets = this.getOwnedPlanetsSorted(faction.id, starSystems);
    if (planets.length === 0) {
      return undefined;
    }

    const hasFactory = planets.some((p) => this.isFactoryPlanet(p));
    const hasSpaceport = this.hasPlannedSpaceport(faction.id, starSystems);
    const finances = this.getProjectedNet(faction, starSystems, context);
    const rawConstrained = this.isRawConstrained(faction);
    const hasActiveMine = planets.some((p) => depositMiningBlocker(p) === null && this.countMines(p) > 0);
    const economies = new Map(planets.map((p) => [p.id, this.economyService.calculatePlanetEconomy(withConstructionComplete(p), faction)] as const));
    const needsComfort = [...economies.values()].some((e) => e.comfortNeed > 0);

    const rules: ConstructionRule[] = [
      {
        respectsReserve: false,
        upkeep: 'emergency',
        candidates: (_, e) => (e.energyProduction < e.energyConsumption ? this.unlockedByRole(faction, 'power') : []),
      },
      {
        respectsReserve: false,
        upkeep: 'core',
        candidates: (_, e) => (e.workforceAvailable < e.workforceRequired ? this.unlockedByRole(faction, 'housing') : []),
      },
      {
        respectsReserve: false,
        upkeep: 'core',
        candidates: () => (hasFactory ? [] : this.unlockedById(faction, 'spaceship_factory')),
      },
      {
        // The faction's first working mine: without one, raw income is only
        // the population trickle and the starting stock runs out with the
        // factory and Spaceport. Factory first (nothing is built without
        // it), then the mine, then the Spaceport.
        respectsReserve: false,
        upkeep: 'core',
        candidates: (planet) =>
          hasFactory && !hasActiveMine && depositMiningBlocker(planet) === null ? this.unlockedById(faction, 'mining_complex') : [],
      },
      {
        respectsReserve: false,
        upkeep: 'core',
        candidates: () => (hasFactory && !hasSpaceport ? this.unlockedById(faction, 'spaceport') : []),
      },
      {
        // A colony's first housing: without it the planet never grows. Core
        // (it is in the reserve, so nothing else may spend it).
        respectsReserve: false,
        upkeep: 'core',
        candidates: (planet) => {
          const housing = this.cheapestUnlockedHousing(faction);
          return housing && !this.hasRole(planet, 'housing') ? [housing] : [];
        },
      },
      {
        respectsReserve: true,
        upkeep: 'optional',
        candidates: (planet) => (this.hasRole(planet, 'defense') ? [] : this.unlockedByRole(faction, 'defense')),
      },
      {
        // Housing raises the population cap and therefore income: it only
        // has to keep net income non-negative. Only the largest unlocked
        // block is built (saving up for it if needed): cheap small blocks
        // would fill the surface with low-capacity housing. Once the
        // faction's planets need comfort, new people cost about what they
        // earn (comfort, power, administration) and pay only after they
        // arrive, so housing may no longer use the treasury runway: a wide
        // expansionist otherwise grew into a lasting deficit.
        respectsReserve: true,
        upkeep: needsComfort ? 'net' : 'core',
        incomeGain: needsComfort
          ? (planet, building) => this.housingIncomeGain(faction, planet, building, administrationShare(planets.length), finances.upkeepScale)
          : undefined,
        candidates: (planet, economy) =>
          this.needsHousingGrowth(planet) && !this.waitsForComfort(faction, planet, economy)
            ? [...this.unlockedByRole(faction, 'housing')].sort((a, b) => (b.population ?? 0) - (a.population ?? 0)).slice(0, 1)
            : [],
      },
      {
        respectsReserve: true,
        upkeep: 'optional',
        // Research buildings per planet: personality-dependent cap (1 for most).
        candidates: (planet) =>
          this.countRole(planet, 'research') >= this.planService.getPosture(faction).researchBuildingsPerPlanet
            ? []
            : this.unlockedByRole(faction, 'research'),
      },
      {
        // Upgrade: a planet whose only research building is the small lab
        // gets the full Research Laboratory once researched.
        respectsReserve: true,
        upkeep: 'optional',
        candidates: (planet) =>
          this.hasRole(planet, 'research') && !planet.buildings.some((b) => b.name === 'Research Laboratory')
            ? this.unlockedById(faction, 'research_lab')
            : [],
      },
      {
        // Parallel factories only help while raw materials keep up: a
        // raw-constrained faction cannot feed the factories it has.
        respectsReserve: true,
        upkeep: 'optional',
        candidates: (planet) =>
          (this.isWealthy(faction) || getAiPersonalityProfile(faction).parallelMilitaryProduction)
            && !rawConstrained
            && this.countFactories(planet) < getAiPersonalityProfile(faction).factoriesPerPlanet
            ? this.unlockedById(faction, 'spaceship_factory')
            : [],
      },
    ];

    // Sites protected from other construction (see choosePlacement): the
    // missing Spaceport and factory, and the first mine on a live deposit —
    // without this, cheaper buildings can surround the deposit tile before
    // the mine is affordable and the deposit can never be mined.
    const missingCore = [
      ...(hasSpaceport ? [] : this.unlockedById(faction, 'spaceport')),
      ...(hasFactory ? [] : this.unlockedById(faction, 'spaceship_factory')),
      ...(this.hasUnminedDeposit(planets) ? this.unlockedById(faction, 'mining_complex') : []),
    ];
    const coreSites = missingCore.length > 0
      ? { planets, missing: missingCore, placeable: this.countPlaceableCore(planets, missingCore) }
      : undefined;
    let reserve: ResourceCost | undefined;
    let mineReserve: ResourceCost | undefined;
    let researchReserve: ResourceCost | undefined;

    /*
     * Posture-driven ordering of the optional tiers (indices 6.. are D, G,
     * R, R2, P): 'stabilize' builds only emergency and core infrastructure;
     * a 'research' priority or a research-heavy personality moves the
     * research tiers ahead of defense and growth.
     */
    const posture = this.planService.getPosture(faction);
    const core = rules.slice(0, 6);
    const [defenseTier, growthTier, researchTier, researchUpgradeTier, factoryTier] = rules.slice(6);
    // Raw-material supply comes right after core infrastructure: ships are
    // mostly raw materials and every deposit is finite, so an idle deposit
    // is wasted supply. It leaves the credit reserve (a missing factory or
    // Spaceport comes first) but may use raw materials the reserve holds for
    // ships, since the mine is what produces them. Only deposits that are not
    // empty qualify (depositMiningBlocker): a depleted planet never gets a mine.
    const miningTier: ConstructionRule = {
      respectsReserve: 'credits',
      upkeep: 'core',
      candidates: (planet) => {
        if (depositMiningBlocker(planet) !== null) return [];
        const mines = this.countMines(planet);
        const wanted = mines === 0
          || (rawConstrained
            && mines < EnemyEconomyService.MAX_MINES_PER_PLANET
            && (planet.rawDeposit?.remaining ?? 0) >= EnemyEconomyService.SECOND_MINE_MIN_RESERVE);
        return wanted ? this.unlockedById(faction, 'mining_complex') : [];
      },
    };
    // Research-starved (credits for the next technology, but the labs are
    // too slow): research buildings move ahead of defense and growth, and
    // they no longer wait behind the next warship's share of the reserve.
    const researchStarved = this.isResearchStarved(faction, finances.researchNet);
    const researchCreditBound = this.isResearchCreditBound(faction);
    const researchFirst = !researchCreditBound
      && (posture.primary === 'research' || posture.researchBuildingsPerPlanet > 1 || researchStarved);
    const researchTiers = researchCreditBound ? [] : [researchTier, researchUpgradeTier];
    // Banks and Trading Posts (docs/trade-network.md#ai): optional, in
    // personality-set numbers, after research and before extra factories.
    const commerceTier: ConstructionRule = {
      respectsReserve: true,
      upkeep: 'optional',
      candidates: (planet, economy) => this.commerceCandidates(faction, planet, planets, economy),
    };
    // Comfort (comfort.ts, docs/late-economy.md): a core tier, before growth
    // housing, and also while stabilizing, since missing comfort is one of
    // the reasons a planet's satisfaction falls.
    const comfortTier: ConstructionRule = {
      respectsReserve: false,
      upkeep: 'net',
      candidates: (planet, economy) => this.comfortCandidates(faction, planet, economy),
      incomeGain: (planet, building) => this.comfortIncomeGain(faction, planet, building, administrationShare(planets.length)),
    };
    const ordered = posture.primary === 'stabilize'
      ? [...core, comfortTier]
      : researchFirst
        ? [...core, miningTier, comfortTier, ...researchTiers, defenseTier, growthTier, commerceTier, factoryTier]
        : [...core, miningTier, defenseTier, comfortTier, growthTier, ...researchTiers, commerceTier, factoryTier];

    // While the navy is below target, optional buildings also leave upkeep
    // headroom for the next warship (the upkeep counterpart of the credit
    // reserve); otherwise construction runs first every decision and uses
    // up all headroom, and military production starves.
    const nextWarship = this.hasPlannedSpaceport(faction.id, starSystems)
      && this.militaryNeed(faction, starSystems, context).strength > 0
      ? this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity, 1, context)
      : undefined;
    const militaryUpkeepReserve = nextWarship
      ? this.economyService.getShipUpkeepPerSecond(nextWarship.id, faction, finances.upkeepScale)
      : 0;

    for (const rule of ordered) {
      const budget: ConstructionBudget = {
        cost: { credits: faction.currencies['credits'] ?? 0, rawmaterials: faction.currencies['rawmaterials'] ?? 0 },
        upkeepAllowance: this.upkeepAllowance(rule.upkeep, finances, faction.currencies['credits'] ?? 0)
          - (rule.upkeep === 'optional' ? militaryUpkeepReserve : 0),
        upkeepScale: finances.upkeepScale,
        incomeGain: rule.incomeGain,
        coreSites,
      };
      if (rule.respectsReserve) {
        const applied = rule === miningTier
          ? (mineReserve ??= this.getSpendingReserve(faction, starSystems, context, true, false))
          : researchStarved && (rule === researchTier || rule === researchUpgradeTier)
            ? (researchReserve ??= this.getSpendingReserve(faction, starSystems, context, false))
            : (reserve ??= this.getSpendingReserve(faction, starSystems, context, true));
        // Growth housing that pays for itself (comfort era, incomeGain) does
        // not wait for research credits: at a thin net, research otherwise
        // took every credit above its reserve and a faction stopped growing
        // for 40 minutes (large map, balanced, 2026-11-02 measurement).
        const researchShare = rule === growthTier && needsComfort ? this.researchCreditReserve(faction) : 0;
        budget.cost.credits -= Math.max(0, applied.credits - researchShare);
        if (rule.respectsReserve !== 'credits') budget.cost.rawmaterials -= applied.rawmaterials;
      }
      for (const planet of planets) {
        const decision = this.resolveCandidates(faction, planet, rule.candidates(planet, economies.get(planet.id)!), budget, 2);
        if (decision) {
          return decision;
        }
      }
    }
    return undefined;
  }

  private resolveCandidates(
    faction: Faction,
    planet: PlanetTile,
    candidates: BuildingDef[],
    budget: ConstructionBudget,
    depth: number,
  ): ConstructionDecision | undefined {
    const gridSize = getPlanetGridSize(planet);
    for (const building of candidates) {
      const cost = buildingCost(building);
      if (budget.cost.credits < cost.credits || budget.cost.rawmaterials < cost.rawmaterials) {
        continue;
      }
      const planetUpkeepScale = budget.upkeepScale * planetTypeTraits(planet.type).buildingUpkeep;
      // Net of the building's own credit income (the Bank's output, a Trading
      // Post's expected trade): one that earns more than it costs improves the
      // budget, so it is allowed even when the headroom is already used up.
      const netUpkeep = this.economyService.getBuildingUpkeepPerSecond(building.name, faction, planetUpkeepScale)
        - (building.production?.credits ?? 0)
        - (building.name === TRADING_POST_NAME ? TRADING_POST_EXPECTED_INCOME : 0)
        - (budget.incomeGain?.(planet, building) ?? 0);
      if (netUpkeep > 0 && netUpkeep > budget.upkeepAllowance) {
        continue;
      }
      const placement = this.choosePlacement(planet, building, gridSize, budget.coreSites);
      if (!placement) {
        continue;
      }
      const safety = this.checkSafety(faction, planet, building, placement);
      if (safety.energyOk && safety.workforceOk) {
        return { planet, building, x: placement.x, y: placement.y };
      }
      if (depth <= 0) {
        continue;
      }
      let enablers: BuildingDef[] = [];
      if (!safety.energyOk && building.role !== 'power') {
        enablers = this.unlockedByRole(faction, 'power');
      } else if (!safety.workforceOk && building.role !== 'housing') {
        enablers = this.unlockedByRole(faction, 'housing');
      }
      // An enabler only exists to unlock the building above, so it may not
      // use more upkeep headroom than that building's own tier allows.
      const enabler = this.resolveCandidates(faction, planet, enablers, budget, depth - 1);
      if (enabler) {
        return enabler;
      }
    }
    return undefined;
  }

  /*
   * choosePlacement: First valid placement (center-out) that does not
   * reduce how many missing core buildings still fit on the faction's
   * planets. Core buildings cost several times more than the cheap
   * buildings the AI keeps adding while it saves for them; without this
   * the faction could fill every surface (or put its factory on the only
   * Spaceport-sized spot) and then never build or deploy ships. A missing
   * core building may consume its own slot; when no placement keeps the
   * others possible it still gets the first one, since building it beats
   * waiting for room that will never appear. Other buildings are skipped.
   */
  private choosePlacement(
    planet: PlanetTile,
    building: BuildingDef,
    gridSize: number,
    coreSites: ConstructionBudget['coreSites'],
  ): { x: number; y: number } | undefined {
    const first = this.findValidPlacement(planet, building, gridSize);
    if (!first || !coreSites) {
      return first;
    }
    const isMissingCore = coreSites.missing.some((def) => def.id === building.id);
    const others = coreSites.missing.filter((def) => def.id !== building.id);
    const required = isMissingCore ? Math.max(0, coreSites.placeable - 1) : coreSites.placeable;
    const keepsCore = (at: { x: number; y: number }) => {
      const after = coreSites.planets.map((p) => p.id !== planet.id
        ? p
        : { ...p, buildings: [...p.buildings, { name: building.name, size: building.size, x: at.x, y: at.y }] });
      return this.countPlaceableCore(after, others) >= required;
    };
    if (keepsCore(first)) {
      return first;
    }
    const alternative = this.findValidPlacements(planet, building, gridSize).find(keepsCore);
    return alternative ?? (isMissingCore ? first : undefined);
  }

  /* How many of `defs` fit at once (largest first, greedy) on the given surfaces. */
  private countPlaceableCore(planets: PlanetTile[], defs: BuildingDef[]): number {
    const surfaces = planets.map((p) => ({ ...p, buildings: [...p.buildings] }));
    let count = 0;
    for (const def of [...defs].sort((a, b) => b.size - a.size)) {
      for (const p of surfaces) {
        const spot = this.findValidPlacement(p, def, getPlanetGridSize(p));
        if (spot) {
          p.buildings.push({ name: def.name, size: def.size, x: spot.x, y: spot.y });
          count++;
          break;
        }
      }
    }
    return count;
  }

  /*
   * checkSafety: Projects the planet economy with the building added. A
   * balance may stay negative only if it does not get worse, so a power
   * building on an energy-short planet is still allowed.
   */
  private checkSafety(
    faction: Faction,
    planet: PlanetTile,
    building: BuildingDef,
    placement: { x: number; y: number },
  ): { energyOk: boolean; workforceOk: boolean } {
    // Sites count as finished: the AI plans with what it has already paid for.
    const planned = withConstructionComplete(planet);
    const current = this.economyService.calculatePlanetEconomy(planned, faction);
    const projected = this.economyService.calculatePlanetEconomy({
      ...planned,
      buildings: [...planned.buildings, { name: building.name, size: building.size, x: placement.x, y: placement.y }],
    }, faction);
    const energyBefore = current.energyProduction - current.energyConsumption;
    const energyAfter = projected.energyProduction - projected.energyConsumption;
    const workforceBefore = current.workforceAvailable - current.workforceRequired;
    const workforceAfter = projected.workforceAvailable - projected.workforceRequired;
    return {
      energyOk: energyAfter >= Math.min(0, energyBefore),
      /*
       * Power buildings may open a workforce deficit: workforce efficiency
       * only scales resource production (EconomyService), never energy
       * output. Without this exemption a fresh colony deadlocks — housing
       * needs power (energy) and power needs workers (housing). The
       * workforce-shortage rule then builds housing on the next decision.
       */
      workforceOk: building.role === 'power' || workforceAfter >= Math.min(0, workforceBefore),
    };
  }

  /*
   * comfortCandidates: Comfort buildings for a planet whose coverage is
   * below AI_COMFORT_TARGET, best first: the most needed comfort it adds
   * (points beyond the need are wasted, a completed full set adds its
   * bonus) per upkeep point. A small gap therefore gets a Park, not an
   * Entertainment Center.
   */
  private comfortCandidates(faction: Faction, planet: PlanetTile, economy: PlanetEconomySnapshot): BuildingDef[] {
    if (!(economy.comfortNeed > 0) || economy.comfortCoverage >= EnemyEconomyService.AI_COMFORT_TARGET) return [];
    const pointsOf = (name: string) => this.findBuildingByName(name)?.comfort ?? 0;
    const names = planet.buildings.map((b) => b.name);
    const covered = Math.min(economy.comfortNeed, economy.comfortProvided);
    const score = (b: BuildingDef) =>
      (Math.min(economy.comfortNeed, comfortProvided([...names, b.name], pointsOf).points) - covered) / Math.max(1, b.maintenanceCost ?? 0);
    return this.buildings()
      .filter((b) => (b.comfort ?? 0) > 0 && this.researchService.isBuildingUnlocked(faction, b.id))
      .map((b) => ({ b, score: score(b) }))
      .sort((x, y) => y.score - x.score)
      .map((x) => x.b);
  }

  /*
   * Credit income/s a comfort building adds: the planet's population income
   * times the rise of its satisfaction target, after colony administration
   * (which takes its share of every credit the planet earns). Zero once the
   * planet is covered, so it never justifies over-building.
   */
  private comfortIncomeGain(faction: Faction, planet: PlanetTile, building: BuildingDef, adminShare: number): number {
    if (!(building.comfort && building.comfort > 0)) return 0;
    const planned = withConstructionComplete(planet);
    const before = this.economyService.calculatePlanetEconomy(planned, faction);
    const after = this.economyService.calculatePlanetEconomy({
      ...planned,
      buildings: [...planned.buildings, { name: building.name, size: building.size, x: -1, y: -1 }],
    }, faction);
    const rise = Math.max(0, after.satisfactionTarget - before.satisfactionTarget) / 100;
    return (planet.population ?? 0) * POPULATION_CREDIT_RATE * rise * (1 - adminShare);
  }

  /*
   * Expected credit income/s of a housing block once its people have
   * arrived, net of what they cost: their income at the planet's
   * satisfaction target after administration, minus the comfort upkeep
   * their need adds (cheapest comfort per point) and the power upkeep of
   * the block's energy, discounted by HOUSING_GAIN_DISCOUNT because the
   * people arrive over minutes. With it, growth that pays for itself is
   * still built at a zero net (the 'net' tier); without it a faction whose
   * planets were full stopped growing for good.
   */
  private housingIncomeGain(faction: Faction, planet: PlanetTile, building: BuildingDef, adminShare: number, upkeepScale: number): number {
    const people = building.population ?? 0;
    if (people <= 0) return 0;
    const economy = this.economyService.calculatePlanetEconomy(withConstructionComplete(planet), faction);
    const scale = upkeepScale * planetTypeTraits(planet.type).buildingUpkeep;
    const upkeepPerComfort = Math.min(...this.buildings()
      .filter((b) => (b.comfort ?? 0) > 0)
      .map((b) => this.economyService.getBuildingUpkeepPerSecond(b.name, faction, scale) / (b.comfort ?? 1)));
    const population = planet.population ?? 0;
    const comfortCost = (comfortNeed(population + people, planet.type) - comfortNeed(population, planet.type)) * upkeepPerComfort;
    const power = this.findBuilding('fusion_plant');
    const energyCost = power
      ? ((building.energyConsumption ?? 0) * this.economyService.getBuildingUpkeepPerSecond(power.name, faction, scale)) / 100
      : 0;
    const income = people * POPULATION_CREDIT_RATE * (economy.satisfactionTarget / 100) * (1 - adminShare);
    return (income - comfortCost) * EnemyEconomyService.HOUSING_GAIN_DISCOUNT - energyCost;
  }

  /*
   * waitsForComfort: growth housing waits while the planet's comfort is
   * below AI_COMFORT_MIN_FOR_HOUSING and a comfort building could still go
   * there; otherwise the credits keep going into housing whose new people
   * only add to the uncovered need. With no comfort building unlocked or
   * placeable, housing goes on (it still raises income).
   */
  private waitsForComfort(faction: Faction, planet: PlanetTile, economy: PlanetEconomySnapshot): boolean {
    if (!(economy.comfortNeed > 0) || economy.comfortCoverage >= EnemyEconomyService.AI_COMFORT_MIN_FOR_HOUSING) return false;
    const gridSize = getPlanetGridSize(planet);
    return this.comfortCandidates(faction, planet, economy).some((b) => this.findValidPlacement(planet, b, gridSize) !== undefined);
  }

  /*
   * needsHousingGrowth: Housing raises the population cap and therefore
   * credit income. A planet without any housing (a fresh colony) can never
   * grow, so it always qualifies; otherwise only near-full planets do.
   */
  private needsHousingGrowth(planet: PlanetTile): boolean {
    // EconomyService's capacity includes the planet type's population
    // factor (planet-types.ts); the raw housing sum would never be reached
    // on a harsh world, and its housing would never grow.
    // Housing under construction counts, or the AI would stack housing sites.
    const capacity = this.economyService.getPopulationCapacity(withConstructionComplete(planet));
    if (capacity <= 0) {
      return true;
    }
    return (planet.population ?? 0) >= capacity * EnemyEconomyService.HOUSING_GROWTH_THRESHOLD;
  }

  // ---------------------------------------------------------------
  // Military production and deployment
  // ---------------------------------------------------------------

  /*
   * manageMilitaryProduction: Queues one combat ship when the faction's
   * combat ship count (fleets + stock + queued) is below its target and
   * the purchase leaves the colonization/infrastructure reserve intact.
   * Requires a factory and a Spaceport — without a Spaceport produced
   * ships could never leave the stock. Normally one combat order at a
   * time, which keeps factory queues free for colonizers; a wealthy
   * faction instead fills every idle factory (one order each per
   * decision), turning surplus credits into military.
   */
  private manageMilitaryProduction(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    const need = this.militaryNeed(faction, starSystems, context);
    let shortfall = need.strength;
    let slots = need.slots;
    if (shortfall <= 0 || slots <= 0) {
      return false;
    }
    // A Spaceport under construction counts: ships wait in the stock until
    // it completes, and the AI does not idle its factories meanwhile.
    if (!this.hasPlannedSpaceport(faction.id, starSystems)) {
      return false;
    }
    // Military focus: wealthy, a military primary priority, or a militarist
    // personality fills every idle factory instead of one at a time.
    const wealthy = this.isMilitaryFocused(faction);
    const hasCombatOrder = this.pendingOrders(faction.id, context)
      .some((o) => isCombatShipType(this.shipService.getShipType(o.shipTypeId)));
    if (hasCombatOrder && !wealthy) {
      return false;
    }

    const factionProduction = context.production.find((p) => p.factionId === faction.id);
    const idleFactories = this.getOwnedPlanetsSorted(faction.id, starSystems).filter(
      (p) => this.isOperationalFactoryPlanet(p) && (factionProduction?.ordersByPlanet[p.id]?.length ?? 0) === 0,
    );
    const factories = wealthy ? idleFactories : idleFactories.slice(0, 1);
    if (factories.length === 0 && !wealthy) {
      // All factories busy (e.g. with a colonizer): queue behind it.
      const first = this.getOwnedPlanetsSorted(faction.id, starSystems).find((p) => this.isOperationalFactoryPlanet(p));
      if (first) factories.push(first);
    }

    let queued = false;
    for (const factoryPlanet of factories) {
      if (shortfall <= 0 || slots <= 0) {
        break;
      }
      const reserve = this.getSpendingReserve(faction, starSystems, context, false);
      const budget: ResourceCost = {
        credits: (faction.currencies['credits'] ?? 0) - reserve.credits,
        rawmaterials: (faction.currencies['rawmaterials'] ?? 0) - reserve.rawmaterials,
      };
      // Recomputed per order: the previous order's upkeep counts as committed.
      // Personality: a militarist (militaryTarget 1.5) keeps a smaller income
      // buffer for warship upkeep than an expansionist (0.8).
      const finances = this.getProjectedNet(faction, starSystems, context);
      const militaryPreference = Math.max(0.5, getAiPersonalityProfile(faction).militaryTarget);
      const upkeepAllowance = finances.net - finances.income * EnemyEconomyService.UPKEEP_MARGIN_SHARE / militaryPreference;
      const preferred = this.selectMilitaryShip(
        faction, { credits: Infinity, rawmaterials: Infinity }, upkeepAllowance, finances.upkeepScale, context,
      );
      if (preferred && this.worthSavingFor(preferred, budget, finances)) {
        break;
      }
      const preferredCost = preferred ? shipCost(preferred) : undefined;
      const ship = preferred && preferredCost!.credits <= budget.credits && preferredCost!.rawmaterials <= budget.rawmaterials
        ? preferred
        : this.selectMilitaryShip(faction, budget, upkeepAllowance, finances.upkeepScale, context);
      if (!ship) {
        break;
      }
      const result = this.productionService.queueOrder(
        { production: context.production },
        faction.id,
        factoryPlanet.id,
        ship.id,
        1,
        starSystems,
        [faction],
      );
      if (!result.ok) {
        this.actionLedger.reject(faction, 'warship_queued', rejectionReason(result));
        break;
      }
      this.actionLedger.record(faction, 'warship_queued');
      queued = true;
      shortfall -= this.shipService.calculateFleetStrength([{ type: ship.id }]);
      slots--;
    }
    return queued;
  }

  /* The hull is not affordable yet, but income covers the gap within MILITARY_SAVE_SECONDS (see there). */
  private worthSavingFor(ship: ShipType, budget: ResourceCost, finances: { net: number; rawNet: number }): boolean {
    const cost = shipCost(ship);
    const rawGap = cost.rawmaterials - budget.rawmaterials;
    const creditGap = cost.credits - budget.credits;
    if (rawGap <= 0 && creditGap <= 0) return false;
    const seconds = Math.max(
      rawGap <= 0 ? 0 : finances.rawNet > 0 ? rawGap / finances.rawNet : Infinity,
      creditGap <= 0 ? 0 : finances.net > 0 ? creditGap / finances.net : Infinity,
    );
    return seconds <= EnemyEconomyService.MILITARY_SAVE_SECONDS;
  }

  private isMilitaryFocused(faction: Faction): boolean {
    const primary = this.planService.getPosture(faction).primary;
    return this.isWealthy(faction) || primary === 'attack' || primary === 'defend'
      || getAiPersonalityProfile(faction).parallelMilitaryProduction;
  }

  private isWealthy(faction: Faction): boolean {
    return (faction.currencies['credits'] ?? 0) > EnemyEconomyService.HOARD_THRESHOLD;
  }

  /*
   * Bank / Trading Post wanted on this planet (personality `commerce`):
   * Banks on up to ceil(bankShare × owned planets) populated planets, one
   * each; Trading Posts on up to `tradingPosts` planets. With a large credit
   * surplus (COMMERCE_RICH_CREDITS) the `rich` values apply instead — the
   * only time a militarist builds them. Only established planets
   * (COMMERCE_MIN_POPULATION) qualify: on a fresh colony the Bank's 40
   * workforce and the post's energy held back its growth and slowed
   * colonization (measured in ai-simulation.spec.ts). Price and upkeep are
   * checked by the tier's normal optional-building rules.
   */
  private commerceCandidates(faction: Faction, planet: PlanetTile, planets: PlanetTile[], economy: PlanetEconomySnapshot): BuildingDef[] {
    const profile = getAiPersonalityProfile(faction).commerce;
    const rich = (faction.currencies['credits'] ?? 0) > EnemyEconomyService.COMMERCE_RICH_CREDITS;
    const bankShare = rich ? profile.richBankShare : profile.bankShare;
    // A raw-bound faction with surplus credits needs one post to buy raw
    // materials (buyRawMaterials), whatever its personality's limit.
    const postLimit = Math.max(rich ? profile.richTradingPosts : profile.tradingPosts,
      rich && this.isRawConstrained(faction) ? 1 : 0);
    if ((planet.population ?? 0) < EnemyEconomyService.COMMERCE_MIN_POPULATION) return [];
    // Spare workers and energy only: commerce must not create or deepen a
    // shortage (the generic safety check tolerates an existing deficit, and
    // a short homeworld would slow its factories and colonizer production).
    const spareWorkforce = economy.workforceAvailable - economy.workforceRequired;
    const spareEnergy = economy.energyProduction - economy.energyConsumption;
    const fits = (def: BuildingDef) => (def.workforce ?? 0) <= spareWorkforce && (def.energyConsumption ?? 0) <= spareEnergy;
    const candidates: BuildingDef[] = [];
    const has = (p: PlanetTile, name: string) => p.buildings.some((b) => b.name === name);
    if (!has(planet, BANK_NAME)
      && planets.filter((p) => has(p, BANK_NAME)).length < Math.ceil(bankShare * planets.length)) {
      candidates.push(...this.unlockedById(faction, 'bank').filter(fits));
    }
    if (!has(planet, TRADING_POST_NAME) && planets.filter((p) => has(p, TRADING_POST_NAME)).length < postLimit) {
      candidates.push(...this.unlockedById(faction, 'trading_post').filter(fits));
    }
    return candidates;
  }

  /*
   * deployStockedCombatShips: Moves every stocked combat ship into a
   * living fleet that is physically in a Spaceport system (galaxy-map
   * cell), or creates a new fleet at the Spaceport. Fleets carrying a
   * colonizer or currently moving are not used, so deployment never
   * changes an active colonization run.
   */
  private deployStockedCombatShips(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    const stock = context.shipStock.find((s) => s.factionId === faction.id);
    if (!stock) {
      return false;
    }
    const counts = new Map<string, number>();
    for (const ship of stock.ships) {
      if (isCombatShipType(this.shipService.getShipType(ship.type))) {
        counts.set(ship.type, (counts.get(ship.type) ?? 0) + 1);
      }
    }
    if (counts.size === 0) {
      return false;
    }
    const spaceport = this.getSortedSpaceports(faction.id, starSystems)[0];
    if (!spaceport) {
      return false;
    }

    const composition = [...counts.entries()].map(([typeId, count]) => ({ typeId, count }));
    const data = { fleets: context.fleets, shipStock: context.shipStock };
    // Reinforce the smallest parked fleet at the Spaceport that still has
    // room; a full home fleet means the new ships form a fresh fleet.
    const guard = context.fleets
      .filter(
        (f) =>
          f.factionId === faction.id
          && !f.destroyed
          && f.targetX === null
          && f.ships.some((s) => !s.destroyed)
          && !f.ships.some((s) => s.type === 'colonizer' && !s.destroyed)
          && !isCivilianMissionFleet(f)
          && f.ships.filter((s) => !s.destroyed).length < EnemyEconomyService.MAX_FLEET_SHIPS
          && Math.floor(f.x) === Math.floor(spaceport.system.x)
          && Math.floor(f.y) === Math.floor(spaceport.system.y),
      )
      .sort((a, b) => a.ships.filter((s) => !s.destroyed).length - b.ships.filter((s) => !s.destroyed).length || a.id - b.id)[0];

    const result = guard
      ? this.fleetAssemblyService.reinforceFleet(data, starSystems, { factionId: faction.id, fleetId: guard.id, composition })
      : this.fleetAssemblyService.createFleet(data, starSystems, {
          factionId: faction.id,
          fleetName: `${faction.name} Guard`,
          systemId: spaceport.system.id,
          planetId: spaceport.planet.id,
          composition,
        });
    if (result.ok) this.actionLedger.record(faction, 'ships_deployed', composition.reduce((n, c) => n + c.count, 0));
    else this.actionLedger.reject(faction, 'ships_deployed', rejectionReason(result));
    return result.ok;
  }

  /*
   * militaryNeed: Missing combat strength (fleets + stock + queued, living
   * ships only) versus the target, and how many more combat ships the
   * count cap still allows.
   */
  private militaryNeed(faction: Faction, starSystems: StarSystem[], context: EconomyContext): { strength: number; slots: number } {
    const ownedSystems = starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === faction.id));
    const planetCount = this.getOwnedPlanetsSorted(faction.id, starSystems).length;
    const wealthy = this.isWealthy(faction);

    let target = EnemyEconomyService.MILITARY_BASE_STRENGTH + EnemyEconomyService.MILITARY_STRENGTH_PER_PLANET * planetCount;
    target = Math.max(target, this.incomeSupportedStrength(faction, starSystems, context));
    target = Math.max(target, this.nearbyThreatStrength(faction, ownedSystems, context) * EnemyEconomyService.THREAT_COVER);
    // Posture: personality preference and current threat level.
    target *= this.planService.getPosture(faction).militaryTargetMultiplier;
    if (wealthy) {
      // Each HOARD_THRESHOLD of surplus credits adds another baseline's
      // worth of strength; WEALTHY_SHIP_CAP bounds the result.
      const surplusSteps = Math.floor((faction.currencies['credits'] ?? 0) / EnemyEconomyService.HOARD_THRESHOLD);
      target *= EnemyEconomyService.WEALTHY_TARGET_MULTIPLIER + surplusSteps;
    }

    const isCombat = (type: string) => isCombatShipType(this.shipService.getShipType(type));
    const fleetShips = context.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .flatMap((f) => f.ships.filter((s) => !s.destroyed && isCombat(s.type)));
    const stockShips = (context.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).filter((s) => isCombat(s.type));
    const queued = this.pendingOrders(faction.id, context).filter((o) => isCombat(o.shipTypeId));

    const current = this.shipService.calculateFleetStrength([...fleetShips, ...stockShips])
      + queued.reduce((sum, o) => sum + o.quantity * this.shipService.calculateFleetStrength([{ type: o.shipTypeId }]), 0);
    const count = fleetShips.length + stockShips.length + queued.reduce((sum, o) => sum + o.quantity, 0);
    // Personality scales the ship cap (bounded): militarists field larger navies.
    const capScale = Math.min(1.5, getAiPersonalityProfile(faction).militaryTarget);
    const cap = Math.round((wealthy ? EnemyEconomyService.WEALTHY_SHIP_CAP : EnemyEconomyService.MILITARY_SHIP_CAP) * capScale);
    return { strength: target - current, slots: cap - count };
  }

  /* Combat strength MILITARY_INCOME_SHARE of gross income can keep in upkeep. */
  private incomeSupportedStrength(faction: Faction, starSystems: StarSystem[], context: EconomyContext): number {
    const hull = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity, 1, context);
    const finances = this.getProjectedNet(faction, starSystems, context);
    const upkeep = hull ? this.economyService.getShipUpkeepPerSecond(hull.id, faction, finances.upkeepScale) : 0;
    if (!hull || upkeep <= 0) {
      return 0;
    }
    const strengthPerUpkeep = this.shipService.calculateFleetStrength([{ type: hull.id }]) / upkeep;
    const income = finances.income;
    return income * EnemyEconomyService.MILITARY_INCOME_SHARE * strengthPerUpkeep;
  }

  /* Strength of hostile (at-war, see diplomacy.ts) fleets near the faction's systems. */
  private nearbyThreatStrength(faction: Faction, ownedSystems: StarSystem[], context: EconomyContext): number {
    const factions = context.factions ?? [];
    const hostile = hostileFactionIds(faction, factions);
    return (context.perceivedFleets ?? context.fleets)
      .filter((f) => hostile.has(f.factionId) && !f.destroyed)
      .filter((f) => ownedSystems.some((s) => Math.hypot(s.x - f.x, s.y - f.y) <= EnemyEconomyService.THREAT_RADIUS))
      .reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
  }

  /*
   * selectMilitaryShip: Picks the hull class first (preferredHullClass:
   * the class the faction's navy lacks most against its target mix), then
   * the hull within that class. Within a class, with a comfortable budget
   * the binding limit is the ship-count cap, so it prefers the strongest
   * unlocked hull costing at most a quarter of the budget; when credits
   * are tight, it takes the best strength per credit that is affordable.
   * Research therefore pays off militarily by unlocking heavier hulls of
   * each class. When no hull of the preferred class fits, any class may be
   * chosen. Without a context (no fleet data) the class step is skipped.
   * Both credits and raw materials must fit the budget, and the hull's
   * upkeep must fit the faction's upkeep allowance (credits/s).
   */
  private selectMilitaryShip(
    faction: Faction,
    budget: ResourceCost,
    upkeepAllowance: number,
    upkeepScale = 1,
    context?: EconomyContext,
  ): ShipType | undefined {
    const candidates = this.shipService
      .getAllShipTypes()
      .filter((t) => {
        const cost = shipCost(t);
        return isCombatShipType(t) && t.cost > 0
          && cost.credits <= budget.credits && cost.rawmaterials <= budget.rawmaterials
          && this.economyService.getShipUpkeepPerSecond(t.id, faction, upkeepScale) <= upkeepAllowance
          && this.researchService.isShipUnlocked(faction, t.id);
      });
    if (candidates.length === 0) {
      return undefined;
    }
    const preferredClass = context ? this.preferredHullClass(faction, context) : null;
    const inClass = preferredClass ? candidates.filter((t) => getHullClass(t) === preferredClass) : [];
    const pool = inClass.length > 0 ? inClass : candidates;
    // Support hulls (shield aura, i.e. the carrier) when the navy is big
    // enough to need one; see wantsSupportHull.
    const support = context ? pool.filter((t) => (t.shieldAura ?? 0) > 0) : [];
    if (support.length > 0 && this.wantsSupportHull(faction, context!)) {
      return [...support].sort((a, b) => (b.shieldAura ?? 0) - (a.shieldAura ?? 0) || a.cost - b.cost)[0];
    }
    const strength = (t: ShipType) => this.shipService.calculateFleetStrength([{ type: t.id }]);
    const comfortable = pool.filter((t) => t.cost * 4 <= budget.credits && (t.rawMaterialCost ?? 0) * 4 <= budget.rawmaterials);
    if (comfortable.length > 0) {
      return [...comfortable].sort((a, b) => strength(b) - strength(a) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
    }
    const value = (t: ShipType) => strength(t) / t.cost;
    return [...pool].sort((a, b) => value(b) - value(a) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
  }

  /*
   * wantsSupportHull: One shield-aura hull (carrier) per SUPPORT_SHIPS_PER_HULL
   * combat ships once the navy (fleets + stock + queued) has at least that
   * many. Auras do not stack (battle-grid.ts shieldAuraFor), so more would
   * only add a weak gun; fewer leaves larger fleets without the aura. The
   * carrier is a medium hull, so this applies when the medium class is
   * chosen (or nothing else of the preferred class fits).
   */
  private wantsSupportHull(faction: Faction, context: EconomyContext): boolean {
    const isSupport = (type: string) => (this.shipService.getShipType(type)?.shieldAura ?? 0) > 0;
    const isCombat = (type: string) => isCombatShipType(this.shipService.getShipType(type));
    const fleetShips = context.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .flatMap((f) => f.ships.filter((s) => !s.destroyed).map((s) => ({ type: s.type, quantity: 1 })));
    const stockShips = (context.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).map((s) => ({ type: s.type, quantity: 1 }));
    const queued = this.pendingOrders(faction.id, context).map((o) => ({ type: o.shipTypeId, quantity: o.quantity }));
    const all = [...fleetShips, ...stockShips, ...queued].filter((s) => isCombat(s.type));
    const total = all.reduce((sum, s) => sum + s.quantity, 0);
    const support = all.filter((s) => isSupport(s.type)).reduce((sum, s) => sum + s.quantity, 0);
    return total >= EnemyEconomyService.SUPPORT_SHIPS_PER_HULL
      && support < Math.floor(total / EnemyEconomyService.SUPPORT_SHIPS_PER_HULL);
  }

  /*
   * preferredHullClass: The hull class (hull-class.ts counter cycle) the
   * faction should build next. Target mix = half a base mix
   * (HULL_CLASS_BASE_MIX) and half a counter mix: each class is wanted in
   * proportion to the share of the hostile navy it beats (light counters
   * heavy, medium counters light, heavy counters medium), measured by ship
   * cost over the hostile fleets the faction knows (fog of war:
   * perceivedFleets). Only classes with an unlocked combat hull count. The
   * class with the largest shortfall of the own navy (fleets + stock +
   * queued orders, by cost) against the target wins. A faction with a
   * single unlocked class simply builds that class.
   */
  private preferredHullClass(faction: Faction, context: EconomyContext): HullClass | null {
    const unlockedClasses = new Set(
      this.shipService
        .getAllShipTypes()
        .filter((t) => isCombatShipType(t) && t.cost > 0 && this.researchService.isShipUnlocked(faction, t.id))
        .map((t) => getHullClass(t)),
    );
    const classes = HULL_CLASSES.filter((c) => unlockedClasses.has(c));
    if (classes.length <= 1) {
      return classes[0] ?? null;
    }

    const valueByClass = (ships: { type: string; quantity?: number }[]): Record<HullClass, number> => {
      const totals: Record<HullClass, number> = { light: 0, medium: 0, heavy: 0 };
      for (const ship of ships) {
        const type = this.shipService.getShipType(ship.type);
        if (!type || !isCombatShipType(type)) continue;
        totals[getHullClass(type)] += type.cost * (ship.quantity ?? 1);
      }
      return totals;
    };

    const hostile = hostileFactionIds(faction, context.factions ?? []);
    const enemyShips = (context.perceivedFleets ?? context.fleets)
      .filter((f) => hostile.has(f.factionId) && !f.destroyed)
      .flatMap((f) => f.ships.filter((s) => !s.destroyed));
    const enemyTotals = valueByClass(enemyShips);

    const baseSum = classes.reduce((acc, c) => acc + EnemyEconomyService.HULL_CLASS_BASE_MIX[c], 0);
    const counterSum = classes.reduce((acc, c) => acc + enemyTotals[HULL_CLASS_INFO[c].strongAgainst], 0);
    const target = (c: HullClass): number => {
      const base = EnemyEconomyService.HULL_CLASS_BASE_MIX[c] / baseSum;
      const counter = counterSum > 0 ? enemyTotals[HULL_CLASS_INFO[c].strongAgainst] / counterSum : base;
      return 0.5 * base + 0.5 * counter;
    };

    const ownFleetShips = context.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .flatMap((f) => f.ships.filter((s) => !s.destroyed));
    const stockShips = context.shipStock.find((s) => s.factionId === faction.id)?.ships ?? [];
    const queued = this.pendingOrders(faction.id, context).map((o) => ({ type: o.shipTypeId, quantity: o.quantity }));
    const ownTotals = valueByClass([...ownFleetShips, ...stockShips, ...queued]);
    const ownSum = classes.reduce((acc, c) => acc + ownTotals[c], 0);

    // Deterministic: ties keep the HULL_CLASSES order (light, medium, heavy).
    let best: HullClass = classes[0];
    let bestGap = -Infinity;
    for (const c of classes) {
      const gap = target(c) - (ownSum > 0 ? ownTotals[c] / ownSum : 0);
      if (gap > bestGap + 1e-9) {
        best = c;
        bestGap = gap;
      }
    }
    return best;
  }

  /*
   * wantsColonizer: The faction can still expand (an unhabited planet
   * exists), has no colonizer anywhere in its pipeline (stock, fleets,
   * production queue) and can carry the upkeep of one more planet.
   */
  private wantsColonizer(faction: Faction, starSystems: StarSystem[], context: EconomyContext): boolean {
    const anyTarget = (context.perceivedSystems ?? starSystems).some((s) => s.planetsTiles.some((p) => p.factionId === 'unhabited'));
    if (!anyTarget) {
      return false;
    }
    const inStock = (context.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).some((s) => s.type === 'colonizer');
    const inFleet = context.fleets.some(
      (f) => f.factionId === faction.id && !f.destroyed && f.ships.some((s) => s.type === 'colonizer' && !s.destroyed),
    );
    const queued = this.pendingOrders(faction.id, context).some((o) => o.shipTypeId === 'colonizer');
    if (inStock || inFleet || queued) {
      return false;
    }
    // A colony the economy cannot carry is not committed spending (the
    // action layer does not order the colonizer either, see canSupportNewColony).
    const breakdown = this.economyService.calculateEconomy(
      faction.id, context.factions ?? [faction], starSystems, context.fleets, context.shipStock,
    );
    const owned = this.getOwnedPlanetsSorted(faction.id, starSystems).length;
    return canSupportNewColony(breakdown, owned, faction.currencies['credits'] ?? 0);
  }

  private pendingOrders(factionId: string, context: EconomyContext): { shipTypeId: string; quantity: number }[] {
    const factionProduction = context.production.find((p) => p.factionId === factionId);
    return Object.values(factionProduction?.ordersByPlanet ?? {}).flat();
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  private getSortedSpaceports(factionId: string, starSystems: StarSystem[]) {
    return [...this.spaceportService.listSpaceports(factionId, starSystems)].sort(
      (a, b) => a.system.id.localeCompare(b.system.id) || a.planet.id - b.planet.id,
    );
  }

  private getOwnedPlanetsSorted(factionId: string, starSystems: StarSystem[]): PlanetTile[] {
    const planets: PlanetTile[] = [];
    for (const system of [...starSystems].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const planet of [...(system.planetsTiles ?? [])].sort((a, b) => a.id - b.id)) {
        if (planet.factionId === factionId) {
          planets.push(planet);
        }
      }
    }
    return planets;
  }

  /*
   * Planning checks (isFactoryPlanet, countFactories, countRole, hasRole,
   * hasPlannedSpaceport) count construction sites as present: the building
   * is paid for, so it must not be bought again (docs/planet-construction.md).
   * Ships can only be ordered at an operational factory.
   */
  private isFactoryPlanet(planet: PlanetTile): boolean {
    return planet.buildings.some((b) => b.name === EnemyEconomyService.FACTORY_NAME);
  }

  private isOperationalFactoryPlanet(planet: PlanetTile): boolean {
    return operationalBuildings(planet).some((b) => b.name === EnemyEconomyService.FACTORY_NAME);
  }

  private hasPlannedSpaceport(factionId: string, starSystems: StarSystem[]): boolean {
    return starSystems.some((system) => system.planetsTiles.some(
      (p) => p.factionId === factionId && p.buildings.some((b) => b.name === EnemyEconomyService.SPACEPORT_NAME),
    ));
  }

  private countMines(planet: PlanetTile): number {
    return planet.buildings.filter((b) => DEPOSIT_MINING_BUILDING_NAMES.has(b.name)).length;
  }

  private countFactories(planet: PlanetTile): number {
    return planet.buildings.filter((b) => b.name === EnemyEconomyService.FACTORY_NAME).length;
  }

  private countRole(planet: PlanetTile, role: string): number {
    return planet.buildings.filter((b) => this.findBuildingByName(b.name)?.role === role).length;
  }

  private hasRole(planet: PlanetTile, role: string): boolean {
    return planet.buildings.some((b) => this.findBuildingByName(b.name)?.role === role);
  }

  private buildings(): BuildingDef[] {
    return (planetData as { buildings: BuildingDef[] }).buildings;
  }

  private findBuilding(id: string): BuildingDef | undefined {
    return this.buildings().find((b) => b.id === id);
  }

  private findBuildingByName(name: string): BuildingDef | undefined {
    return this.buildings().find((b) => b.name === name);
  }

  private unlockedByRole(faction: Faction, role: string): BuildingDef[] {
    return this.buildings().filter((b) => b.role === role && this.researchService.isBuildingUnlocked(faction, b.id));
  }

  private unlockedById(faction: Faction, id: string): BuildingDef[] {
    return this.buildings().filter((b) => b.id === id && this.researchService.isBuildingUnlocked(faction, b.id));
  }

  /*
   * Placement mirrors the planet screen rules: inside the grid, not on
   * terrain obstacles, no overlap with buildings, never on a resource tile
   * unless the building requires ore proximity (then it must touch one).
   * Candidates are scanned from the grid center outward so AI colonies grow
   * as one compact settlement (docs/planet-surface.md).
   */
  private findValidPlacements(planet: PlanetTile, building: BuildingDef, gridSize: number): { x: number; y: number }[] {
    const requiresOre = building.requiresOreProximity === true;
    // A mine only makes sense on a deposit that is not empty.
    if (requiresOre && depositMiningBlocker(planet) !== null) return [];
    if (isBuildingLimitReached(planet, building)) return [];
    const resourceTiles = planet.resourceTiles ?? [];
    return centerOutPlacementOrder(gridSize, building.size)
      .filter(({ x, y }) => this.canPlace(planet, building.size, x, y, resourceTiles, requiresOre))
      .map(({ x, y }) => ({ x, y }));
  }

  private findValidPlacement(planet: PlanetTile, building: BuildingDef, gridSize: number): { x: number; y: number } | undefined {
    const requiresOre = building.requiresOreProximity === true;
    if (requiresOre && depositMiningBlocker(planet) !== null) return undefined;
    if (isBuildingLimitReached(planet, building)) return undefined;
    const resourceTiles = planet.resourceTiles ?? [];
    const spot = centerOutPlacementOrder(gridSize, building.size).find(({ x, y }) =>
      this.canPlace(planet, building.size, x, y, resourceTiles, requiresOre),
    );
    return spot ? { x: spot.x, y: spot.y } : undefined;
  }

  private canPlace(
    planet: PlanetTile,
    size: number,
    x: number,
    y: number,
    resourceTiles: { x: number; y: number }[],
    requiresOre: boolean,
  ): boolean {
    if (isFootprintBlocked(planet, x, y, size)) {
      return false;
    }
    for (const b of planet.buildings ?? []) {
      if (x < b.x + b.size && x + size > b.x && y < b.y + b.size && y + size > b.y) {
        return false;
      }
    }
    let touchesResource = false;
    for (const tile of resourceTiles) {
      if (tile.x >= x && tile.x < x + size && tile.y >= y && tile.y < y + size) {
        if (!requiresOre) {
          return false;
        }
        touchesResource = true;
      }
    }
    return !requiresOre || touchesResource;
  }
}

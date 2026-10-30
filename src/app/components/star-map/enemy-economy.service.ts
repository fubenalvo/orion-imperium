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
import { EconomyService } from '../../services/economy.service';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { isCombatShipType } from './ai-queries';
import { EnemyPlanService } from './enemy-plan.service';
import { getAiPersonalityProfile } from './ai-personality';
import planetData from './planet-data.json';
import { ResourceCost, addCosts, buildingCost, canAffordCost, payCost, shipCost } from '../../services/resource-cost';

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
 *    the same helpers the player UI uses). Research points are spent only
 *    by the research tree.
 *  - Buildings, fleet ships and stocked ships pay upkeep every economy
 *    tick (EconomyService.applyEconomyDelta). Credits never go negative:
 *    unpaid upkeep (arrears) drains satisfaction toward rebellion, and an
 *    energy deficit does the same (-1/s).
 *  - Credit income is population × 0.1 × satisfaction; population is
 *    capped by housing capacity, so housing is the real growth building.
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
}

interface ConstructionDecision {
  planet: PlanetTile;
  building: BuildingDef;
  x: number;
  y: number;
}

type PlanetEconomySnapshot = ReturnType<EconomyService['calculatePlanetEconomy']>;

type UpkeepTier = 'emergency' | 'core' | 'optional';

interface ConstructionRule {
  /* Whether this tier must leave the spending reserve untouched. */
  respectsReserve: boolean;
  /* How much projected net income the new building's upkeep must leave (see header). */
  upkeep: UpkeepTier;
  candidates: (planet: PlanetTile, economy: PlanetEconomySnapshot) => BuildingDef[];
}

/* Budget for one construction decision: spendable stock and upkeep headroom (credits/s). */
interface ConstructionBudget {
  cost: ResourceCost;
  upkeepAllowance: number;
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
  private static readonly WEALTHY_SHIP_CAP = 60;
  // A home fleet at this size is not reinforced further; new ships form a new fleet.
  private static readonly MAX_FLEET_SHIPS = 12;
  // Above this balance surplus credits are turned into extra military.
  // Just above the most expensive single building (Spaceport, 4000), so
  // only credits no planned purchase needs count as surplus.
  private static readonly HOARD_THRESHOLD = 5000;
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
   * Raw-material income (per second) below which an ore planet gets a
   * Mining Complex. Factories alone yield little raw material, and ships
   * and buildings both consume it.
   */
  private static readonly RAW_INCOME_TARGET = 15;
  /*
   * Core purchases (housing, factory, Spaceport) may run a deficit the
   * treasury can carry for this many seconds. Without it a faction whose
   * only planet is a fresh colony (zero income) could never build the
   * housing that creates income.
   */
  private static readonly CORE_RUNWAY_SECONDS = 300;
  private static readonly FACTORY_NAME = 'Spaceship Factory';

  private readonly accumulators = new Map<string, number>();
  private readonly constructionCooldowns = new Map<string, number>();

  constructor(
    private readonly economyService: EconomyService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly productionService: ProductionService,
    private readonly spaceportService: SpaceportService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly planService: EnemyPlanService,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.constructionCooldowns.clear();
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

    let changed = this.tryConstruct(faction, starSystems, context);
    changed = this.manageMilitaryProduction(faction, starSystems, context) || changed;
    changed = this.deployStockedCombatShips(faction, starSystems, context) || changed;
    return changed;
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
   *   I2 factory but no Spaceport  → Spaceport        (no reserve)
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

    if (!payCost(faction, buildingCost(decision.building))) {
      return false;
    }
    decision.planet.buildings.push({
      name: decision.building.name,
      size: decision.building.size,
      x: decision.x,
      y: decision.y,
    });
    return true;
  }

  /*
   * getSpendingReserve: Credits optional spending must leave untouched,
   * covering the faction's currently committed needs.
   */
  getSpendingReserve(faction: Faction, starSystems: StarSystem[], context: EconomyContext, includeMilitary: boolean): ResourceCost {
    let reserve: ResourceCost = { credits: 0, rawmaterials: 0 };
    const planets = this.getOwnedPlanetsSorted(faction.id, starSystems);

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
    if (spaceport && hasFactory && canSave && !this.spaceportService.hasSpaceport(faction.id, starSystems)) {
      reserve = addCosts(reserve, buildingCost(spaceport));
    }

    if (includeMilitary && this.militaryNeed(faction, starSystems, context).strength > 0) {
      const ship = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity);
      if (ship) reserve = addCosts(reserve, shipCost(ship));
    }
    return reserve;
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
  ): { income: number; net: number; rawNet: number } {
    const breakdown = this.economyService.calculateEconomy(
      faction.id, context.factions ?? [faction], starSystems, context.fleets, context.shipStock,
    );
    const queuedUpkeep = this.pendingOrders(faction.id, context)
      .reduce((sum, o) => sum + o.quantity * this.economyService.getShipUpkeepPerSecond(o.shipTypeId, faction), 0);
    return {
      income: breakdown.incomePerSecond,
      net: breakdown.netPerSecond - queuedUpkeep,
      rawNet: breakdown.net['rawmaterials'] ?? 0,
    };
  }

  /* Upkeep (credits/s) a new purchase in this tier may add. */
  private upkeepAllowance(tier: UpkeepTier, finances: { income: number; net: number }, credits: number): number {
    if (tier === 'emergency') return Infinity;
    if (tier === 'core') return finances.net + Math.max(0, credits) / EnemyEconomyService.CORE_RUNWAY_SECONDS;
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
    const hasSpaceport = this.spaceportService.hasSpaceport(faction.id, starSystems);
    const finances = this.getProjectedNet(faction, starSystems, context);

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
        respectsReserve: false,
        upkeep: 'core',
        candidates: () => (hasFactory && !hasSpaceport ? this.unlockedById(faction, 'spaceport') : []),
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
        // would fill the surface with low-capacity housing.
        respectsReserve: true,
        upkeep: 'core',
        candidates: (planet) =>
          this.needsHousingGrowth(planet)
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
        respectsReserve: true,
        upkeep: 'optional',
        candidates: (planet) =>
          (this.isWealthy(faction) || getAiPersonalityProfile(faction).parallelMilitaryProduction)
            && this.countFactories(planet) < getAiPersonalityProfile(faction).factoriesPerPlanet
            ? this.unlockedById(faction, 'spaceship_factory')
            : [],
      },
    ];

    const economies = new Map(planets.map((p) => [p.id, this.economyService.calculatePlanetEconomy(p, faction)] as const));
    const missingCore = [
      ...(hasSpaceport ? [] : this.unlockedById(faction, 'spaceport')),
      ...(hasFactory ? [] : this.unlockedById(faction, 'spaceship_factory')),
    ];
    const coreSites = missingCore.length > 0
      ? { planets, missing: missingCore, placeable: this.countPlaceableCore(planets, missingCore) }
      : undefined;
    let reserve: ResourceCost | undefined;

    /*
     * Posture-driven ordering of the optional tiers (indices 4.. are D, G,
     * R, R2, P): 'stabilize' builds only emergency and core infrastructure;
     * a 'research' priority or a research-heavy personality moves the
     * research tiers ahead of defense and growth.
     */
    const posture = this.planService.getPosture(faction);
    const core = rules.slice(0, 4);
    const [defenseTier, growthTier, researchTier, researchUpgradeTier, factoryTier] = rules.slice(4);
    // Raw-material supply comes first among the optional tiers: ships and
    // every building need it, and it only triggers on ore planets while
    // raw income is low.
    const miningTier: ConstructionRule = {
      respectsReserve: true,
      upkeep: 'optional',
      candidates: (planet) =>
        finances.rawNet < EnemyEconomyService.RAW_INCOME_TARGET
          && (planet.resourceTiles ?? []).length > 0
          && !planet.buildings.some((b) => b.name === 'Mining Complex')
          ? this.unlockedById(faction, 'mining_complex')
          : [],
    };
    const researchFirst = posture.primary === 'research' || posture.researchBuildingsPerPlanet > 1;
    const ordered = posture.primary === 'stabilize'
      ? core
      : researchFirst
        ? [...core, miningTier, researchTier, researchUpgradeTier, defenseTier, growthTier, factoryTier]
        : [...core, miningTier, defenseTier, growthTier, researchTier, researchUpgradeTier, factoryTier];

    // While the navy is below target, optional buildings also leave upkeep
    // headroom for the next warship (the upkeep counterpart of the credit
    // reserve); otherwise construction runs first every decision and uses
    // up all headroom, and military production starves.
    const nextWarship = this.spaceportService.hasSpaceport(faction.id, starSystems)
      && this.militaryNeed(faction, starSystems, context).strength > 0
      ? this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity)
      : undefined;
    const militaryUpkeepReserve = nextWarship ? this.economyService.getShipUpkeepPerSecond(nextWarship.id, faction) : 0;

    for (const rule of ordered) {
      const budget: ConstructionBudget = {
        cost: { credits: faction.currencies['credits'] ?? 0, rawmaterials: faction.currencies['rawmaterials'] ?? 0 },
        upkeepAllowance: this.upkeepAllowance(rule.upkeep, finances, faction.currencies['credits'] ?? 0)
          - (rule.upkeep === 'optional' ? militaryUpkeepReserve : 0),
        coreSites,
      };
      if (rule.respectsReserve) {
        reserve ??= this.getSpendingReserve(faction, starSystems, context, true);
        budget.cost.credits -= reserve.credits;
        budget.cost.rawmaterials -= reserve.rawmaterials;
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
      if (this.economyService.getBuildingUpkeepPerSecond(building.name, faction) > budget.upkeepAllowance) {
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
    const current = this.economyService.calculatePlanetEconomy(planet, faction);
    const projected = this.economyService.calculatePlanetEconomy({
      ...planet,
      buildings: [...planet.buildings, { name: building.name, size: building.size, x: placement.x, y: placement.y }],
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
   * needsHousingGrowth: Housing raises the population cap and therefore
   * credit income. A planet without any housing (a fresh colony) can never
   * grow, so it always qualifies; otherwise only near-full planets do.
   * Capacity is read from planet-data.json directly so the rule does not
   * depend on EconomyService helpers beyond calculatePlanetEconomy.
   */
  private needsHousingGrowth(planet: PlanetTile): boolean {
    const capacity = planet.buildings.reduce((sum, b) => {
      const def = this.findBuildingByName(b.name);
      return def?.role === 'housing' ? sum + (def.population ?? 0) : sum;
    }, 0);
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
    if (!this.spaceportService.hasSpaceport(faction.id, starSystems)) {
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
      (p) => this.isFactoryPlanet(p) && (factionProduction?.ordersByPlanet[p.id]?.length ?? 0) === 0,
    );
    const factories = wealthy ? idleFactories : idleFactories.slice(0, 1);
    if (factories.length === 0 && !wealthy) {
      // All factories busy (e.g. with a colonizer): queue behind it.
      const first = this.getOwnedPlanetsSorted(faction.id, starSystems).find((p) => this.isFactoryPlanet(p));
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
      const ship = this.selectMilitaryShip(faction, budget, upkeepAllowance);
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
        break;
      }
      queued = true;
      shortfall -= this.shipService.calculateFleetStrength([{ type: ship.id }]);
      slots--;
    }
    return queued;
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
    const hull = this.selectMilitaryShip(faction, { credits: Infinity, rawmaterials: Infinity }, Infinity);
    const upkeep = hull ? this.economyService.getShipUpkeepPerSecond(hull.id, faction) : 0;
    if (!hull || upkeep <= 0) {
      return 0;
    }
    const strengthPerUpkeep = this.shipService.calculateFleetStrength([{ type: hull.id }]) / upkeep;
    const income = this.getProjectedNet(faction, starSystems, context).income;
    return income * EnemyEconomyService.MILITARY_INCOME_SHARE * strengthPerUpkeep;
  }

  /* Strength of hostile (other non-neutral team) fleets near the faction's systems. */
  private nearbyThreatStrength(faction: Faction, ownedSystems: StarSystem[], context: EconomyContext): number {
    const factions = context.factions ?? [];
    const hostile = new Set(factions.filter((f) => f.team !== 0 && f.team !== faction.team).map((f) => f.id));
    return (context.perceivedFleets ?? context.fleets)
      .filter((f) => hostile.has(f.factionId) && !f.destroyed)
      .filter((f) => ownedSystems.some((s) => Math.hypot(s.x - f.x, s.y - f.y) <= EnemyEconomyService.THREAT_RADIUS))
      .reduce((sum, f) => sum + this.shipService.calculateFleetStrength(f.ships), 0);
  }

  /*
   * selectMilitaryShip: Strength per credit is nearly flat across hulls
   * and build time is proportional to cost, so with a comfortable budget
   * the binding limit is the ship-count cap — prefer the strongest
   * unlocked hull costing at most a quarter of the budget. When credits
   * are tight, take the best strength per credit that is affordable.
   * Research therefore pays off militarily by unlocking heavier hulls.
   * Both credits and raw materials must fit the budget, and the hull's
   * upkeep must fit the faction's upkeep allowance (credits/s).
   */
  private selectMilitaryShip(faction: Faction, budget: ResourceCost, upkeepAllowance: number): ShipType | undefined {
    const candidates = this.shipService
      .getAllShipTypes()
      .filter((t) => {
        const cost = shipCost(t);
        return isCombatShipType(t) && t.cost > 0
          && cost.credits <= budget.credits && cost.rawmaterials <= budget.rawmaterials
          && this.economyService.getShipUpkeepPerSecond(t.id, faction) <= upkeepAllowance
          && this.researchService.isShipUnlocked(faction, t.id);
      });
    if (candidates.length === 0) {
      return undefined;
    }
    const strength = (t: ShipType) => this.shipService.calculateFleetStrength([{ type: t.id }]);
    const comfortable = candidates.filter((t) => t.cost * 4 <= budget.credits && (t.rawMaterialCost ?? 0) * 4 <= budget.rawmaterials);
    if (comfortable.length > 0) {
      return [...comfortable].sort((a, b) => strength(b) - strength(a) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
    }
    const value = (t: ShipType) => strength(t) / t.cost;
    return [...candidates].sort((a, b) => value(b) - value(a) || a.cost - b.cost || a.id.localeCompare(b.id))[0];
  }

  /*
   * wantsColonizer: The faction can still expand (an unhabited planet
   * exists) and has no colonizer anywhere in its pipeline (stock, fleets,
   * production queue).
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
    return !inStock && !inFleet && !queued;
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

  private isFactoryPlanet(planet: PlanetTile): boolean {
    return planet.buildings.some((b) => b.name === EnemyEconomyService.FACTORY_NAME);
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
    const resourceTiles = planet.resourceTiles ?? [];
    return centerOutPlacementOrder(gridSize, building.size)
      .filter(({ x, y }) => this.canPlace(planet, building.size, x, y, resourceTiles, requiresOre))
      .map(({ x, y }) => ({ x, y }));
  }

  private findValidPlacement(planet: PlanetTile, building: BuildingDef, gridSize: number): { x: number; y: number } | undefined {
    const requiresOre = building.requiresOreProximity === true;
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

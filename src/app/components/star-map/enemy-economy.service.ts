import { Injectable } from '@angular/core';
import {
  Faction,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  ShipType,
  StarSystem,
  PLANET_SIZE_MAP,
} from './star-map.models';
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
 *  - Credits are the only currency anything spends (ship cost via
 *    ProductionService.queueOrder, building price). Raw materials are
 *    produced but never consumed, research points are spent only by the
 *    research tree, and building maintenance is shown in the economy
 *    breakdown but never deducted. So credits cannot go negative through
 *    upkeep; the economic failure mode is satisfaction loss (energy
 *    deficit → -1/s) leading to rebellion.
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
 * research) and military production must leave a reserve that covers the
 * currently committed needs (next colonizer, a missing Spaceport, the
 * next military ship). An unaffordable rule falls through to the next
 * rule, so a shortage changes the decision instead of deadlocking.
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

interface ConstructionRule {
  /* Whether this tier must leave the spending reserve untouched. */
  respectsReserve: boolean;
  candidates: (planet: PlanetTile, economy: PlanetEconomySnapshot) => BuildingDef[];
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
  private static readonly THREAT_RADIUS = 25;
  private static readonly THREAT_COVER = 1.5;
  private static readonly WEALTHY_TARGET_MULTIPLIER = 2;
  private static readonly MILITARY_SHIP_CAP = 24;
  private static readonly WEALTHY_SHIP_CAP = 60;
  // A home fleet at this size is not reinforced further; new ships form a new fleet.
  private static readonly MAX_FLEET_SHIPS = 12;
  // Above this balance surplus credits are turned into extra military.
  private static readonly HOARD_THRESHOLD = 3000;
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

    faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) - decision.building.price;
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
  getSpendingReserve(faction: Faction, starSystems: StarSystem[], context: EconomyContext, includeMilitary: boolean): number {
    let reserve = 0;
    const planets = this.getOwnedPlanetsSorted(faction.id, starSystems);

    if (this.wantsColonizer(faction, starSystems, context)) {
      reserve += this.shipService.getShipType('colonizer')?.cost ?? 0;
    }

    const hasFactory = planets.some((p) => this.isFactoryPlanet(p));
    if (hasFactory && !this.spaceportService.hasSpaceport(faction.id, starSystems)) {
      reserve += this.findBuilding('spaceport')?.price ?? 0;
    }

    if (includeMilitary && this.militaryNeed(faction, starSystems, context).strength > 0) {
      reserve += this.selectMilitaryShip(faction, Infinity)?.cost ?? 0;
    }
    return reserve;
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

    const rules: ConstructionRule[] = [
      {
        respectsReserve: false,
        candidates: (_, e) => (e.energyProduction < e.energyConsumption ? this.unlockedByRole(faction, 'power') : []),
      },
      {
        respectsReserve: false,
        candidates: (_, e) => (e.workforceAvailable < e.workforceRequired ? this.unlockedByRole(faction, 'housing') : []),
      },
      {
        respectsReserve: false,
        candidates: () => (hasFactory ? [] : this.unlockedById(faction, 'spaceship_factory')),
      },
      {
        respectsReserve: false,
        candidates: () => (hasFactory && !hasSpaceport ? this.unlockedById(faction, 'spaceport') : []),
      },
      {
        respectsReserve: true,
        candidates: (planet) => (this.hasRole(planet, 'defense') ? [] : this.unlockedByRole(faction, 'defense')),
      },
      {
        respectsReserve: true,
        candidates: (planet) =>
          this.needsHousingGrowth(planet)
            ? [...this.unlockedByRole(faction, 'housing')].sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
            : [],
      },
      {
        respectsReserve: true,
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
        candidates: (planet) =>
          this.hasRole(planet, 'research') && !planet.buildings.some((b) => b.name === 'Research Laboratory')
            ? this.unlockedById(faction, 'research_lab')
            : [],
      },
      {
        respectsReserve: true,
        candidates: (planet) =>
          (this.isWealthy(faction) || getAiPersonalityProfile(faction).parallelMilitaryProduction)
            && this.countFactories(planet) < getAiPersonalityProfile(faction).factoriesPerPlanet
            ? this.unlockedById(faction, 'spaceship_factory')
            : [],
      },
    ];

    const economies = new Map(planets.map((p) => [p.id, this.economyService.calculatePlanetEconomy(p)] as const));
    let reserve: number | undefined;

    /*
     * Posture-driven ordering of the optional tiers (indices 4.. are D, G,
     * R, R2, P): 'stabilize' builds only emergency and core infrastructure;
     * a 'research' priority or a research-heavy personality moves the
     * research tiers ahead of defense and growth.
     */
    const posture = this.planService.getPosture(faction);
    const core = rules.slice(0, 4);
    const [defenseTier, growthTier, researchTier, researchUpgradeTier, factoryTier] = rules.slice(4);
    const researchFirst = posture.primary === 'research' || posture.researchBuildingsPerPlanet > 1;
    const ordered = posture.primary === 'stabilize'
      ? core
      : researchFirst
        ? [...core, researchTier, researchUpgradeTier, defenseTier, growthTier, factoryTier]
        : rules;

    for (const rule of ordered) {
      let budget = faction.currencies['credits'] ?? 0;
      if (rule.respectsReserve) {
        reserve ??= this.getSpendingReserve(faction, starSystems, context, true);
        budget -= reserve;
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
    budget: number,
    depth: number,
  ): ConstructionDecision | undefined {
    const gridSize = (PLANET_SIZE_MAP[planet.size] ?? 3) * 2 + 3;
    for (const building of candidates) {
      if (budget < building.price) {
        continue;
      }
      const placement = this.findValidPlacement(planet, building, gridSize);
      if (!placement) {
        continue;
      }
      const safety = this.checkSafety(planet, building, placement);
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
      const enabler = this.resolveCandidates(faction, planet, enablers, budget, depth - 1);
      if (enabler) {
        return enabler;
      }
    }
    return undefined;
  }

  /*
   * checkSafety: Projects the planet economy with the building added. A
   * balance may stay negative only if it does not get worse, so a power
   * building on an energy-short planet is still allowed.
   */
  private checkSafety(
    planet: PlanetTile,
    building: BuildingDef,
    placement: { x: number; y: number },
  ): { energyOk: boolean; workforceOk: boolean } {
    const current = this.economyService.calculatePlanetEconomy(planet);
    const projected = this.economyService.calculatePlanetEconomy({
      ...planet,
      buildings: [...planet.buildings, { name: building.name, size: building.size, x: placement.x, y: placement.y }],
    });
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
      const budget = (faction.currencies['credits'] ?? 0) - this.getSpendingReserve(faction, starSystems, context, false);
      const ship = this.selectMilitaryShip(faction, budget);
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
   */
  private selectMilitaryShip(faction: Faction, budget: number): ShipType | undefined {
    const candidates = this.shipService
      .getAllShipTypes()
      .filter((t) => isCombatShipType(t) && t.cost > 0 && t.cost <= budget && this.researchService.isShipUnlocked(faction, t.id));
    if (candidates.length === 0) {
      return undefined;
    }
    const strength = (t: ShipType) => this.shipService.calculateFleetStrength([{ type: t.id }]);
    const comfortable = candidates.filter((t) => t.cost * 4 <= budget);
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
   * Placement mirrors the planet screen rules: inside the grid, no
   * overlap with buildings, never on a resource tile unless the building
   * requires ore proximity (then it must touch one).
   */
  private findValidPlacement(planet: PlanetTile, building: BuildingDef, gridSize: number): { x: number; y: number } | undefined {
    const requiresOre = building.requiresOreProximity === true;
    const resourceTiles = planet.resourceTiles ?? [];
    for (let y = 0; y + building.size <= gridSize; y++) {
      for (let x = 0; x + building.size <= gridSize; x++) {
        if (this.canPlace(planet, building.size, x, y, resourceTiles, requiresOre)) {
          return { x, y };
        }
      }
    }
    return undefined;
  }

  private canPlace(
    planet: PlanetTile,
    size: number,
    x: number,
    y: number,
    resourceTiles: { x: number; y: number }[],
    requiresOre: boolean,
  ): boolean {
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

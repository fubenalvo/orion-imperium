import { Injectable, Optional } from '@angular/core';
import { operationalBuildings } from '../components/star-map/building-construction';
import { ShipService } from './ship.service';
import { PlanetOwnershipService } from './planet-ownership.service';
import { ProductionService } from './production.service';
import { ShipStockService } from './ship-stock.service';
import { ResearchService, TechModifiers } from './research.service';
import planetData from '../components/star-map/planet-data.json';
import { getAiIncomeMultiplier } from '../components/star-map/ai-difficulty';
import { getWarExhaustionPenalty } from '../components/star-map/diplomacy';
import { extractMiningStations, miningRatePerSecond } from '../components/star-map/mining-station';
import { SpaceBaseService } from '../components/star-map/space-base.service';
import { isStationComplete } from '../components/star-map/station-construction';
import { DYSON_ANCHOR_UPKEEP_POINTS, DysonBonusEffects, NO_DYSON_BONUS, dysonBonusEffects, isDysonAnchor } from '../components/star-map/dyson-anchor';
import { planetTypeTraits } from '../components/star-map/planet-types';

import {
  Faction,
  FactionProduction,
  StarSystem,
  PlanetTile,
  Fleet,
  FactionShipStock,
  ResourceType,
  ResourceRates,
  PlanetEconomy,
  EconomyBreakdown,
  PlanetEconomyEntry,
  BuildingExpenseEntry,
  FleetExpenseEntry,
  BuildingStats,
  PLANET_TYPE_HABITABILITY,
} from '../components/star-map/star-map.models';
import { comfortCoverage, comfortNeed, comfortProvided, excessShare, satisfactionTarget, stepSatisfaction } from '../components/star-map/comfort';

/*
 * Multiplier on a faction's gains (credit income, raw and research output;
 * never costs): the AI difficulty multiplier including the adaptive factor
 * (ai-difficulty.ts getAiIncomeMultiplier; 1 for the human) reduced by
 * the war-exhaustion penalty (docs/diplomacy.md), so the HUD, the economy
 * tick and the AI all see the same reduced numbers.
 */
function gainMultiplier(faction: Faction | null | undefined): number {
  if (!faction) return 1;
  return getAiIncomeMultiplier(faction) * (1 - getWarExhaustionPenalty(faction));
}

/*
 * =========================================================
 * ECONOMY SERVICE
 * =========================================================
 *
 * Data-driven resource production and consumption system.
 *
 * Resources:
 * - Stock: credits, rawmaterials, research
 * - Flow: energy (determines efficiency, not accumulated)
 *
 * Building production/consumption is defined in planet-data.json
 * and read generically, so new buildings require no code changes.
 *
 * Population income (pop * POPULATION_CREDIT_RATE credits/s, plus a pop * POPULATION_RAW_RATE
 * raw-material trickle) is treated as a planet-level production source.
 *
 * Raw materials come from finite deposits (raw-deposits.ts): buildings with
 * `requiresOreProximity` (Mining Complex) extract from their planet's
 * `rawDeposit`, mining stations from their asteroid. Their nominal rates are
 * part of the breakdown; applyEconomyDelta credits only what is actually
 * extracted and subtracts it from the deposit. The population trickle is
 * the only raw source that never runs out: it is the deliberate emergency
 * floor that keeps an empire with no deposit left able to rebuild.
 *
 * Upkeep: `maintenanceCost` in planet-data.json / ship-data.json is in
 * upkeep points per second; one point costs UPKEEP_CREDITS_PER_POINT
 * credits. Buildings, fleet ships, ships in the faction-wide reserve
 * (ship stock, at RESERVE_SHIP_UPKEEP_FACTOR), space bases and asteroid
 * mining stations all pay upkeep. Upkeep is the economy's main credit
 * sink: it grows with the empire, so credits cannot pile up unused. It is
 * charged only in applyEconomyDelta. See docs/economy.md.
 */

/*
 * Credits per second per inhabitant: the main income source (homeworld
 * 1200 pop → 102/s). Lowered from 0.1 against the credit glut. Lowering it
 * further was tried with the colony cores and rejected: it cuts the net
 * margin for the whole game and the AI stops expanding (docs/economy.md,
 * "Colony cores").
 */
export const POPULATION_CREDIT_RATE = 0.085;

/* Credits per second charged for one upkeep point (the single upkeep tuning knob). */
export const UPKEEP_CREDITS_PER_POINT = 0.3;
/*
 * Empire upkeep scale: every owned planet beyond the first makes ALL upkeep
 * (buildings, fleet and reserve ships, stations) this much more expensive,
 * capped at EMPIRE_UPKEEP_MAX_SCALE. This is the credit sink: a one-planet
 * start pays the base rates (the early build-up is tuned on them), while a
 * large empire's growing income is absorbed by its growing upkeep instead
 * of piling up unspent. A flat higher rate was tried and starved the early
 * game (late Spaceports, no early warships).
 */
export const EMPIRE_UPKEEP_SCALE_PER_PLANET = 0.07;
export const EMPIRE_UPKEEP_MAX_SCALE = 0.8;

export function empireUpkeepScale(ownedPlanetCount: number): number {
  return 1 + Math.min(EMPIRE_UPKEEP_MAX_SCALE, EMPIRE_UPKEEP_SCALE_PER_PLANET * Math.max(0, ownedPlanetCount - 1));
}
/*
 * Upkeep points of the stations, which have no data-file entry. They are
 * structures, so the building-upkeep technology modifier applies. A mining
 * station on a depleted asteroid costs nothing (see getStationUpkeepPerSecond).
 */
export const SPACE_BASE_UPKEEP_POINTS = 25;
export const MINING_STATION_UPKEEP_POINTS = 15;
/* Stocked ships are mothballed: they cost this share of their fleet upkeep. */
export const RESERVE_SHIP_UPKEEP_FACTOR = 0.5;
export const RESERVE_FLEET_LABEL = 'Reserve (ship stock)';
/*
 * Raw materials per second per inhabitant (homeworld: 1200 pop → 2.4/s).
 * Not a deposit and never depleted: the economy's anti-deadlock floor
 * (docs/economy.md, "Economic safety").
 */
export const POPULATION_RAW_RATE = 0.002;
/*
 * Colony administration: every owned planet beyond the first costs this
 * share of each planet's credit income, capped at ADMINISTRATION_MAX_SHARE.
 * It makes over-expansion expensive (a fresh colony raises the share on
 * the whole empire before its own income grows) without ever making total
 * income negative.
 */
export const ADMINISTRATION_SHARE_PER_PLANET = 0.03;
export const ADMINISTRATION_MAX_SHARE = 0.45;

export function administrationShare(ownedPlanetCount: number): number {
  return Math.min(ADMINISTRATION_MAX_SHARE, ADMINISTRATION_SHARE_PER_PLANET * Math.max(0, ownedPlanetCount - 1));
}

/*
 * Credits per second one more owned planet adds to the faction's expenses
 * before the new colony earns anything: the administration share rises on
 * the whole empire's income, and the empire upkeep scale rises on every
 * existing building, ship and station (all upkeep is multiplied by it).
 * The AI uses it to stop expanding into a negative net income; see
 * docs/ai-pipeline.md, "Colonization".
 */
export function marginalColonyCost(breakdown: EconomyBreakdown, ownedPlanetCount: number): number {
  const adminIncrease = administrationShare(ownedPlanetCount + 1) - administrationShare(ownedPlanetCount);
  const scaleIncrease = empireUpkeepScale(ownedPlanetCount + 1) / empireUpkeepScale(ownedPlanetCount) - 1;
  const scaledUpkeep = breakdown.buildingUpkeepPerSecond + breakdown.shipUpkeepPerSecond + breakdown.stationUpkeepPerSecond;
  return adminIncrease * breakdown.incomePerSecond + scaleIncrease * scaledUpkeep;
}

/*
 * Core buildings (role `core`: Capital, Colony Center; colony-core.ts) give
 * a planet its base population ceiling, workforce and energy. Their energy
 * is flat: energy technologies and the Venus-like bonus scale only power
 * buildings. See docs/economy.md, "Colony cores".
 */
function providesHousing(stats: BuildingStats): boolean {
  return stats.role === 'housing' || stats.role === 'core';
}

export type { ResourceType, ResourceRates, PlanetEconomy };
export type { EconomyBreakdown, PlanetEconomyEntry, BuildingExpenseEntry, FleetExpenseEntry, BuildingStats };

const STOCK_RESOURCES: ResourceType[] = ['credits', 'rawmaterials', 'research'];

@Injectable({ providedIn: 'root' })
export class EconomyService {
  private readonly buildingStats: Map<string, BuildingStats> = new Map();
  private readonly buildingStatsByName: Map<string, BuildingStats> = new Map();

  // Fraction of the remaining capacity a planet adds to its population per
  // second at full satisfaction and best habitability. Tunable balance knob.
  private readonly POPULATION_GROWTH_BASE_RATE = 0.005;

  /*
   * Satisfaction lost per second on every planet of a faction that cannot
   * pay any of its upkeep (scaled by the unpaid share).
   */
  static readonly ARREARS_MORALE_PENALTY = 2;

  private readonly planetOwnership: PlanetOwnershipService;
  /* Fractional credits carried between ticks, per faction (not persisted; < 1 credit). */
  private readonly creditRemainders = new Map<string, number>();

  /*
   * PlanetOwnershipService is always injected by Angular DI. It is optional
   * only so specs can still construct `new EconomyService(new ShipService())`;
   * such an instance gets a private ownership service with identical rules.
   */
  private readonly research: ResearchService;

  constructor(
    private shipService: ShipService,
    @Optional() planetOwnership?: PlanetOwnershipService,
    @Optional() research?: ResearchService,
    // The live space bases (session registry). Optional for specs that
    // construct the service by hand; such an instance sees no bases.
    @Optional() private spaceBases?: SpaceBaseService,
  ) {
    this.planetOwnership = planetOwnership
      ?? new PlanetOwnershipService(new ProductionService(shipService, new ShipStockService()));
    this.research = research ?? new ResearchService();
    const buildings = (planetData as { buildings: BuildingStats[] }).buildings;
    for (const building of buildings) {
      this.buildingStats.set(building.id, building);
      this.buildingStatsByName.set(building.name, building);
    }
  }

  /*
   * calculatePlanetEconomy: Pure calculation of a single planet's economy.
   * Does not mutate the planet. Reads the current satisfaction value from
   * the planet (defaulting to 100) and exposes the income multiplier that
   * should be applied to credits production.
   *
   * `owner` applies the owner's technology modifiers (energy, raw-material
   * and research output of buildings) and its Dyson anchor bonuses (energy).
   * Without it the result is the technology-free baseline; every economy and
   * AI path passes the owner.
   */
  calculatePlanetEconomy(planet: PlanetTile, owner?: Faction | null): PlanetEconomy {
    const tech = this.research.getModifiers(owner);
    // Stellar Power anchors add to the power multiplier like research bonuses do.
    const dysonEnergy = owner ? this.getDysonBonusEffects(owner.id).energyOutput : 0;
    const traits = planetTypeTraits(planet.type);
    const production: ResourceRates = {};
    const consumption: ResourceRates = {};
    let energyProduction = 0;
    let energyConsumption = 0;

    // Workforce + morale are pre-computed so building production can be scaled
    // by workforce efficiency during accumulation. Consumption and population
    // income are intentionally left unscaled.
    const { available, required, moraleBonus } = this.computeWorkforce(planet);
    const workforceEfficiency =
      required > 0 ? Math.min(1, Math.max(0, available / required)) : 1;
    const habitabilityDrift = PLANET_TYPE_HABITABILITY[planet.type] ?? 0;
    // Deposit mining buildings produce only while the planet's deposit lasts,
    // scaled by the deposit's richness.
    const deposit = planet.rawDeposit;
    const depositMultiplier = deposit && deposit.remaining > 0 ? deposit.richness * traits.depositMining : 0;
    let depositMining = 0;

    for (const building of operationalBuildings(planet)) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;

      for (const [resource, amount] of Object.entries(stats.production ?? {})) {
        const techMultiplier = resource === 'rawmaterials'
          ? tech.rawOutput
          : resource === 'research' ? tech.researchOutput * traits.researchOutput : 1;
        let output = amount * workforceEfficiency * techMultiplier;
        if (resource === 'rawmaterials' && stats.requiresOreProximity) {
          output *= depositMultiplier;
          depositMining += output;
        }
        production[resource as ResourceType] = (production[resource as ResourceType] ?? 0) + output;
      }

      for (const [resource, amount] of Object.entries(stats.consumption ?? {})) {
        consumption[resource as ResourceType] = (consumption[resource as ResourceType] ?? 0) + amount;
      }

      const energyMultiplier = stats.role === 'core' ? 1 : (tech.energyOutput + dysonEnergy) * traits.energyOutput;
      energyProduction += (stats.energyProduction ?? 0) * energyMultiplier;
      energyConsumption += stats.energyConsumption ?? 0;
    }

    const pop = planet.population || 0;
    if (pop > 0) {
      production['credits'] = (production['credits'] ?? 0) + pop * POPULATION_CREDIT_RATE;
      // Small population-driven raw trickle (local salvage and extraction).
      // Not scaled by workforce: it guarantees that a faction which lost its
      // factories and has no ore can still slowly afford to rebuild one, so
      // raw-material costs can never deadlock an economy.
      production['rawmaterials'] = (production['rawmaterials'] ?? 0) + pop * POPULATION_RAW_RATE;
      // Gas giants: flat atmospheric harvesting (planet-types.ts), never depleted.
      if (traits.gasHarvest > 0 && planet.factionId && planet.factionId !== 'independent') {
        production['rawmaterials'] = (production['rawmaterials'] ?? 0) + traits.gasHarvest;
      }
    }

    const net: ResourceRates = {};
    for (const resource of STOCK_RESOURCES) {
      const prod = production[resource] ?? 0;
      const cons = consumption[resource] ?? 0;
      net[resource] = prod - cons;
    }

    const energyBalance = energyProduction - energyConsumption;
    const efficiency = energyProduction >= energyConsumption ? 1.0 : energyProduction / Math.max(energyConsumption, 1);

    // Satisfaction is clamped to [0, 100]; an independent planet always reads
    // as 0% so the multiplier is consistent even though the planet no longer
    // contributes to its previous owner's income.
    const rawSatisfaction = planet.factionId === 'independent' ? 0 : (planet.satisfaction ?? 100);
    const satisfaction = Math.max(0, Math.min(100, rawSatisfaction));
    const incomeMultiplier = satisfaction / 100;

    // Comfort need (comfort.ts): the satisfaction target, not a positive
    // energy drift, is the ceiling. Type and industry offsets only count
    // above the free population, so the opening keeps 100%.
    const comfortNeedPoints = comfortNeed(pop, planet.type);
    const provided = comfortProvided(
      operationalBuildings(planet).map((b) => b.name),
      (name) => this.buildingStatsByName.get(name)?.comfort ?? 0,
    );
    const coverage = comfortCoverage(comfortNeedPoints, provided.points);
    const offsets = comfortNeedPoints > 0 ? habitabilityDrift + moraleBonus : 0;
    const target = satisfactionTarget(coverage, excessShare(pop), efficiency, offsets, 0);
    const drift = stepSatisfaction(satisfaction, target, 1) - satisfaction;

    return {
      production,
      consumption,
      net,
      energyProduction,
      energyConsumption,
      energyBalance,
      efficiency,
      satisfaction,
      incomeMultiplier,
      workforceAvailable: available,
      workforceRequired: required,
      workforceEfficiency,
      habitabilityDrift,
      buildingMoraleBonus: moraleBonus,
      comfortNeed: comfortNeedPoints,
      comfortProvided: provided.points,
      comfortFullSet: provided.fullSet,
      comfortCoverage: coverage,
      satisfactionTarget: target,
      satisfactionDrift: drift,
      depositMining,
    };
  }

  /*
   * computeWorkforce: Sums the workforce provided by residential (housing)
   * and core buildings and the workforce required by every building on the
   * planet, plus the aggregate building morale bonus. Housing and cores are
   * pure providers (their `workforce` requirement is 0); all other buildings
   * consume workforce. Returns raw totals so callers (economy calc, UI,
   * morale drift) can reuse a single pass instead of re-scanning buildings.
   */
  private computeWorkforce(planet: PlanetTile): {
    available: number;
    required: number;
    moraleBonus: number;
  } {
    let available = 0;
    let required = 0;
    let moraleBonus = 0;
    for (const building of operationalBuildings(planet)) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;
      required += stats.workforce ?? 0;
      if (providesHousing(stats)) {
        available += stats.providesWorkforce ?? 0;
      }
      moraleBonus += stats.moraleRate ?? 0;
    }
    return { available, required, moraleBonus };
  }

  /*
   * getWorkforce: Public accessor for a planet's workforce totals and the
   * workforce-driven efficiency (0..1). Exposed for the UI and for unit
   * tests that only care about the workforce/efficiency slice.
   */
  getWorkforce(planet: PlanetTile): {
    available: number;
    required: number;
    efficiency: number;
  } {
    const { available, required } = this.computeWorkforce(planet);
    const efficiency = required > 0 ? Math.min(1, Math.max(0, available / required)) : 1;
    return { available, required, efficiency };
  }

  /*
   * getMoraleDriftPerSecond: The non-energy portion of the satisfaction
   * drift, in satisfaction points per second (game time). Equals the planet
   * type's habitability base plus the aggregate morale bonus of every
   * building on the planet. Entertainment/social buildings offset harsh
   * habitability; industrial buildings contribute a small negative pressure.
   * This value is multiplied by the game-time `deltaTime` when applied, so
   * it pauses when the game is paused and runs 5× as fast at speed 5x.
   */
  getMoraleDriftPerSecond(planet: PlanetTile): number {
    const { moraleBonus } = this.computeWorkforce(planet);
    return (PLANET_TYPE_HABITABILITY[planet.type] ?? 0) + moraleBonus;
  }

  /* `owner` applies the populationGrowth technology modifier. */
  calculatePopulationGrowth(planet: PlanetTile, deltaTime: number, owner?: Faction | null): number {
    let capacity = this.getPopulationCapacity(planet);
    let pop = planet.population;
    if (pop === undefined) {
      pop = 0;
    }
    const remaining = Math.max(0, capacity - pop);
    let satisfaction = 100;
    if (planet.satisfaction !== undefined) {
      satisfaction = planet.satisfaction;
    }
    if (planet.factionId === 'independent') {
      satisfaction = 0;
    }
    const satMod = Math.max(0, Math.min(1, satisfaction / 100));
    let hab = 0;
    const looked = PLANET_TYPE_HABITABILITY[planet.type];
    if (looked !== undefined) {
      hab = looked;
    }
    const habMod = Math.max(0, 1 + hab);
    return this.POPULATION_GROWTH_BASE_RATE * satMod * habMod * remaining * deltaTime
      * this.research.getModifiers(owner).populationGrowth;
  }

  /*
   * getPopulationCapacity: planet population ceiling from the population
   * field of residential buildings (100/300/700) and the core building
   * (Capital 500, Colony Center 150) × the planet type's
   * populationCapacity (planet-types.ts).
   */
  getPopulationCapacity(planet: PlanetTile): number {
    let capacity = 0;
    for (const building of operationalBuildings(planet)) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;
      if (providesHousing(stats)) {
        capacity += stats.population ?? 0;
      }
    }
    return Math.floor(capacity * planetTypeTraits(planet.type).populationCapacity);
  }

  /*
   * calculateEconomy: Aggregates the faction economy across all owned
   * planets, fleets and the ship reserve.
   *
   * Every rate in the result is EFFECTIVE: it already includes energy
   * efficiency, the satisfaction multiplier on credits, the AI difficulty
   * income multiplier, and upkeep converted to credits. applyEconomyDelta
   * applies exactly `net[r] × deltaTime`, so what the HUD shows is what the
   * balance does (apart from integer rounding of credits and arrears
   * clamping at 0).
   *
   * Credits: production = Σ planet income; consumption = building upkeep
   * + colony administration (administrationShare × planet income) + fleet
   * and reserve ship upkeep. `incomePerSecond`, `expensePerSecond`,
   * `netPerSecond` mirror the credit row.
   */
  calculateEconomy(
    factionId: string,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    shipStock?: FactionShipStock[],
  ): EconomyBreakdown {
    const faction = factions.find((f) => f.id === factionId);
    const difficultyIncomeMultiplier = gainMultiplier(faction);
    const ownedPlanets = this.getOwnedPlanets(factionId, starSystems);
    const ownedFleets = fleets.filter((f) => f.factionId === factionId && !f.destroyed);

    const planets: PlanetEconomyEntry[] = [];
    const fleetExpenses: FleetExpenseEntry[] = [];

    const factionProduction: ResourceRates = {};
    const factionConsumption: ResourceRates = {};
    const factionNet: ResourceRates = {};
    let totalPopulation = 0;
    let totalEfficiency = 0;
    let depositMining = 0;
    let buildingUpkeep = 0;
    let administration = 0;
    const adminShare = administrationShare(ownedPlanets.length);
    const upkeepScale = empireUpkeepScale(ownedPlanets.length);

    for (const planet of ownedPlanets) {
      const entry = this.buildPlanetEntry(planet, difficultyIncomeMultiplier, adminShare, faction, upkeepScale);
      totalPopulation += entry.population;
      totalEfficiency += entry.efficiency;
      administration += entry.administration ?? 0;
      buildingUpkeep += entry.expense - (entry.administration ?? 0);
      depositMining += entry.miningRate;
      for (const resource of STOCK_RESOURCES) {
        factionProduction[resource] = (factionProduction[resource] ?? 0) + (entry.production[resource] ?? 0);
        factionConsumption[resource] = (factionConsumption[resource] ?? 0) + (entry.consumption[resource] ?? 0);
        factionNet[resource] = (factionNet[resource] ?? 0) + (entry.netRates[resource] ?? 0);
      }
      planets.push(entry);
    }

    let shipUpkeep = 0;
    for (const fleet of ownedFleets) {
      for (const entry of this.shipUpkeepEntries(fleet.name, fleet.ships.filter((s) => !s.destroyed), upkeepScale, faction)) {
        shipUpkeep += entry.totalCost;
        fleetExpenses.push(entry);
      }
    }
    const reserve = shipStock?.find((s) => s.factionId === factionId)?.ships ?? [];
    for (const entry of this.shipUpkeepEntries(RESERVE_FLEET_LABEL, reserve, RESERVE_SHIP_UPKEEP_FACTOR * upkeepScale, faction)) {
      shipUpkeep += entry.totalCost;
      fleetExpenses.push(entry);
    }
    const stationUpkeep = this.getStationUpkeepPerSecond(factionId, starSystems, faction, upkeepScale);
    // Building upkeep is already inside the planets' credit consumption.
    factionConsumption['credits'] = (factionConsumption['credits'] ?? 0) + shipUpkeep + stationUpkeep;
    factionNet['credits'] = (factionNet['credits'] ?? 0) - shipUpkeep - stationUpkeep;

    // Asteroid mining stations (mining-station.ts): a faction-level raw source,
    // not tied to any planet. applyEconomyDelta replaces this rate with the
    // amount actually extracted, so a nearly empty deposit is never overdrawn.
    const miningRate = miningRatePerSecond(factionId, starSystems, difficultyIncomeMultiplier);
    if (miningRate > 0) {
      factionProduction['rawmaterials'] = (factionProduction['rawmaterials'] ?? 0) + miningRate;
      factionNet['rawmaterials'] = (factionNet['rawmaterials'] ?? 0) + miningRate;
    }
    depositMining += miningRate;

    // Swarm Observatory anchors (dyson-anchor.ts): a flat faction-level research source.
    const dysonResearch = this.getDysonBonusEffects(factionId).researchPerSecond;
    if (dysonResearch > 0) {
      factionProduction['research'] = (factionProduction['research'] ?? 0) + dysonResearch;
      factionNet['research'] = (factionNet['research'] ?? 0) + dysonResearch;
    }

    const income = factionProduction['credits'] ?? 0;
    const expense = buildingUpkeep + administration + shipUpkeep + stationUpkeep;
    return {
      incomePerSecond: income,
      expensePerSecond: expense,
      netPerSecond: income - expense,
      buildingUpkeepPerSecond: buildingUpkeep,
      administrationPerSecond: administration,
      shipUpkeepPerSecond: shipUpkeep,
      stationUpkeepPerSecond: stationUpkeep,
      upkeepScale,
      unpaidUpkeepPerSecond: 0,
      depositMiningPerSecond: depositMining,
      totalPopulation,
      planets,
      fleetExpenses,
      production: factionProduction,
      consumption: factionConsumption,
      net: factionNet,
      efficiency: ownedPlanets.length > 0 ? totalEfficiency / ownedPlanets.length : 1.0,
    };
  }

  /*
   * applyEconomyDelta: Advances one faction's economy by deltaTime. Called
   * once per faction per economy tick (StarMap accumulates frame deltas into
   * ~1 s ticks), so upkeep is charged exactly once per tick and is
   * frame-rate independent. Energy is a flow resource and is NOT stored.
   *
   * Order within a tick:
   *  1. Satisfaction per owned planet moves toward its target
   *     (PlanetEconomy.satisfactionTarget, comfort.ts: comfort coverage with
   *     its floor × the energy factor, plus type / industry offsets above the
   *     free population) at COMFORT_CONFIG.drift per second. A planet in its
   *     capture grace (`rebellionGraceSeconds`) never rebels; otherwise one reaching 0
   *     rebels (→ 'independent') BEFORE income is computed, so it neither
   *     pays its old owner nor costs it upkeep on that tick.
   *  2. The effective breakdown is computed from the post-drift state and
   *     `net[r] × deltaTime` is applied to every stock resource: income
   *     minus upkeep for credits; raw materials and research as produced.
   *     Deposit mining (planet mines and asteroid stations) contributes
   *     what it actually extracts this tick, capped by what each deposit
   *     still holds, and depletes the deposits.
   *  3. Credits are kept as integers; the fractional remainder is carried
   *     per faction (in memory only) so rounding never drifts the balance
   *     away from the HUD rate.
   *  4. Arrears: credits never go below 0. If the treasury cannot cover the
   *     upkeep, the unpaid part is waived and every owned planet loses
   *     satisfaction at ARREARS_MORALE_PENALTY × (unpaid / upkeep) per
   *     second. A small shortfall is recovered by the move toward the target;
   *     a large one leads toward rebellion unless income recovers or upkeep
   *     is cut (e.g. by disbanding fleets into the cheaper reserve).
   *  5. Population growth on every owned planet.
   */
  applyEconomyDelta(
    factionId: string,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    deltaTime: number,
    // Lets a rebellion cancel the old owner's orders on the planet.
    production?: FactionProduction[],
    shipStock?: FactionShipStock[],
  ): EconomyBreakdown {
    const faction = factions.find((f) => f.id === factionId);
    if (!faction || deltaTime <= 0) {
      return this.calculateEconomy(factionId, factions, starSystems, fleets, shipStock);
    }

    // 1) Satisfaction moves toward its comfort target, then rebellion.
    for (const planet of this.getOwnedPlanets(factionId, starSystems)) {
      if (planet.factionId === 'independent') continue;
      const target = this.calculatePlanetEconomy(planet, faction).satisfactionTarget;
      planet.satisfaction = stepSatisfaction(planet.satisfaction ?? 100, target, deltaTime);
      // Capture grace (PlanetOwnershipService): no rebellion until it runs out.
      if (planet.rebellionGraceSeconds !== undefined) {
        planet.rebellionGraceSeconds -= deltaTime;
        if (planet.rebellionGraceSeconds > 0) continue;
        delete planet.rebellionGraceSeconds;
      }
      if (planet.satisfaction <= 0) {
        this.planetOwnership.transferPlanet({ production, factions }, planet, 'independent', 'rebellion');
      }
    }

    // 2) Raw materials and research from the effective (post-drift) breakdown.
    const breakdown = this.calculateEconomy(factionId, factions, starSystems, fleets, shipStock);
    // Deposit mining is applied as the amount really taken from the deposits
    // (capped by what is left) instead of the nominal rate inside breakdown.net.
    const mined = this.extractPlanetDeposits(factionId, starSystems, breakdown, deltaTime)
      + extractMiningStations(factionId, starSystems, deltaTime, gainMultiplier(faction));
    for (const resource of STOCK_RESOURCES) {
      if (resource === 'credits') continue;
      const rate = (breakdown.net[resource] ?? 0) - (resource === 'rawmaterials' ? breakdown.depositMiningPerSecond : 0);
      const extra = resource === 'rawmaterials' ? mined : 0;
      faction.currencies[resource] = (faction.currencies[resource] ?? 0) + rate * deltaTime + extra;
    }

    // 3) Credits with a carried fractional remainder.
    const exact = (faction.currencies['credits'] ?? 0) + (this.creditRemainders.get(factionId) ?? 0)
      + breakdown.netPerSecond * deltaTime;
    if (exact >= 0) {
      const whole = Math.floor(exact);
      faction.currencies['credits'] = whole;
      this.creditRemainders.set(factionId, exact - whole);
    } else {
      // 4) Arrears: the treasury is empty and part of the upkeep is unpaid.
      faction.currencies['credits'] = 0;
      this.creditRemainders.set(factionId, 0);
      const unpaid = -exact;
      const due = breakdown.expensePerSecond * deltaTime;
      const unpaidShare = due > 0 ? Math.min(1, unpaid / due) : 0;
      breakdown.unpaidUpkeepPerSecond = unpaid / deltaTime;
      const penalty = EconomyService.ARREARS_MORALE_PENALTY * unpaidShare * deltaTime;
      for (const planet of this.getOwnedPlanets(factionId, starSystems)) {
        planet.satisfaction = Math.max(0, (planet.satisfaction ?? 100) - penalty);
      }
    }

    // 5) Population growth (pauses with deltaTime 0, scales with speed).
    for (const planet of this.getOwnedPlanets(factionId, starSystems)) {
      const growth = this.calculatePopulationGrowth(planet, deltaTime, faction);
      const capacity = this.getPopulationCapacity(planet);
      planet.population = Math.min(capacity, (planet.population ?? 0) + growth);
    }

    return breakdown;
  }

  /*
   * Takes one tick of mining from each owned planet's deposit: the planet's
   * effective mining rate (its breakdown row) × deltaTime, capped by what
   * the deposit still holds. Returns the total extracted. Planet rows are
   * matched by position: calculateEconomy lists owned planets in the same
   * order as getOwnedPlanets.
   */
  private extractPlanetDeposits(
    factionId: string,
    starSystems: StarSystem[],
    breakdown: EconomyBreakdown,
    deltaTime: number,
  ): number {
    const planets = this.getOwnedPlanets(factionId, starSystems);
    let total = 0;
    planets.forEach((planet, index) => {
      const rate = breakdown.planets[index]?.miningRate ?? 0;
      const deposit = planet.rawDeposit;
      if (rate <= 0 || !deposit || deposit.remaining <= 0) return;
      const taken = Math.min(deposit.remaining, rate * deltaTime);
      deposit.remaining = Math.max(0, deposit.remaining - taken);
      total += taken;
    });
    return total;
  }

  /*
   * Upkeep in credits per second of one building / one ship of a type.
   * Exposed so the AI prices the ongoing cost of a purchase with the same
   * conversion the economy tick uses. `scale` is the owner's empire upkeep
   * scale (getEmpireUpkeepScale); without it the base rate is returned.
   */
  getBuildingUpkeepPerSecond(buildingName: string, owner?: Faction | null, scale = 1): number {
    return (this.buildingStatsByName.get(buildingName)?.maintenanceCost ?? 0) * UPKEEP_CREDITS_PER_POINT
      * this.research.getModifiers(owner).buildingUpkeep * scale;
  }

  /*
   * Upkeep a fresh colony adds within its first minutes: the AI builds its
   * first housing block and a Mining Complex there (EnemyEconomyService tiers
   * H and M), at the empire upkeep scale it will have with that planet. The
   * AI colony brake (canSupportNewColony) counts it: without it a faction
   * colonized at a near-zero margin and turned negative minutes later
   * (measured 2026-11-08, late-economy scenario).
   */
  colonyStarterUpkeepPerSecond(owner: Faction | null | undefined, ownedPlanetCount: number): number {
    const scale = empireUpkeepScale(ownedPlanetCount + 1);
    return this.getBuildingUpkeepPerSecond('Small Residential Block', owner, scale)
      + this.getBuildingUpkeepPerSecond('Mining Complex', owner, scale);
  }

  getShipUpkeepPerSecond(shipTypeId: string, owner?: Faction | null, scale = 1): number {
    return (this.shipService.getShipType(shipTypeId)?.maintenanceCost ?? 0) * UPKEEP_CREDITS_PER_POINT
      * this.research.getModifiers(owner).shipUpkeep * scale;
  }

  /* Empire upkeep scale of a faction (empireUpkeepScale of its owned planet count). */
  getEmpireUpkeepScale(factionId: string, starSystems: StarSystem[]): number {
    return empireUpkeepScale(this.getOwnedPlanets(factionId, starSystems).length);
  }

  /* Upkeep in credits per second of one space base / one mining station. */
  getStationUpkeepRates(owner?: Faction | null, scale = 1): { spaceBase: number; miningStation: number; dysonAnchor: number } {
    const factor = UPKEEP_CREDITS_PER_POINT * this.research.getModifiers(owner).buildingUpkeep * scale;
    return {
      spaceBase: SPACE_BASE_UPKEEP_POINTS * factor,
      miningStation: MINING_STATION_UPKEEP_POINTS * factor,
      dysonAnchor: DYSON_ANCHOR_UPKEEP_POINTS * factor,
    };
  }

  /*
   * Upkeep of a faction's completed stations: space bases from the live
   * registry, mining stations from the asteroids (only those still holding
   * raw materials, see below).
   */
  private getStationUpkeepPerSecond(
    factionId: string,
    starSystems: StarSystem[],
    owner: Faction | null | undefined,
    scale: number,
  ): number {
    // Construction sites pay nothing until complete (station-construction.ts).
    // Dyson anchors pay their own, higher rate (dyson-anchor.ts).
    const complete = this.spaceBases?.basesOf(factionId).filter(isStationComplete) ?? [];
    const anchors = complete.filter(isDysonAnchor).length;
    const bases = complete.length - anchors;
    let stations = 0;
    for (const system of starSystems) {
      for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
        // A station on a depleted asteroid is idle and pays nothing: it
        // cannot be dismantled, so charging it would be a permanent sink
        // that outlives the empire's ability to pay (QA 2026-11-01).
        const station = asteroid.miningStation;
        if (station?.factionId === factionId && isStationComplete(station) && asteroid.rawMaterials > 0) stations++;
      }
    }
    if (bases === 0 && stations === 0 && anchors === 0) return 0;
    const rates = this.getStationUpkeepRates(owner, scale);
    return bases * rates.spaceBase + stations * rates.miningStation + anchors * rates.dysonAnchor;
  }

  /* Summed bonuses of a faction's completed Dyson anchors (none without the base registry). */
  getDysonBonusEffects(factionId: string): DysonBonusEffects {
    return this.spaceBases ? dysonBonusEffects(this.spaceBases.bases, factionId) : NO_DYSON_BONUS;
  }

  /* Technology modifiers of a faction (same source every economy rule uses). */
  getTechModifiers(owner: Faction | null | undefined): TechModifiers {
    return this.research.getModifiers(owner);
  }

  /*
   * buildPlanetEntry: One planet's effective economy (see calculateEconomy).
   * Building upkeep and colony administration are booked as this planet's
   * credit consumption (and `expense`).
   */
  private buildPlanetEntry(
    planet: PlanetTile,
    difficultyIncomeMultiplier: number,
    adminShare: number,
    owner: Faction | null | undefined,
    upkeepScale: number,
  ): PlanetEconomyEntry {
    const economy = this.calculatePlanetEconomy(planet, owner);
    const buildingUpkeep = this.calculatePlanetMaintenance(planet, owner, upkeepScale);
    const creditIncome = (economy.production['credits'] ?? 0) * economy.efficiency * economy.incomeMultiplier
      * difficultyIncomeMultiplier;
    const administration = creditIncome * adminShare;
    const upkeep = buildingUpkeep + administration;
    const miningRate = economy.depositMining * economy.efficiency * difficultyIncomeMultiplier;
    const production: ResourceRates = {};
    const consumption: ResourceRates = {};
    const netRates: ResourceRates = {};
    for (const resource of STOCK_RESOURCES) {
      const satisfactionMultiplier = resource === 'credits' ? economy.incomeMultiplier : 1;
      production[resource] = (economy.production[resource] ?? 0) * economy.efficiency * satisfactionMultiplier
        * difficultyIncomeMultiplier;
      consumption[resource] = (economy.consumption[resource] ?? 0) + (resource === 'credits' ? upkeep : 0);
      netRates[resource] = production[resource]! - consumption[resource]!;
    }
    // Energy is reported raw (flow resource, never stored).
    production['energy'] = economy.energyProduction;
    consumption['energy'] = economy.energyConsumption;
    netRates['energy'] = economy.energyBalance;

    return {
      planetName: planet.name,
      population: planet.population || 0,
      income: production['credits'] ?? 0,
      expense: upkeep,
      administration,
      net: netRates['credits'] ?? 0,
      production,
      consumption,
      netRates,
      energyProduction: economy.energyProduction,
      energyConsumption: economy.energyConsumption,
      energyBalance: economy.energyBalance,
      efficiency: economy.efficiency,
      buildings: this.getPlanetBuildingExpenses(planet, owner, upkeepScale),
      satisfaction: economy.satisfaction,
      incomeMultiplier: economy.incomeMultiplier,
      workforceAvailable: economy.workforceAvailable,
      workforceRequired: economy.workforceRequired,
      workforceEfficiency: economy.workforceEfficiency,
      habitabilityDrift: economy.habitabilityDrift,
      buildingMoraleBonus: economy.buildingMoraleBonus,
      satisfactionDrift: economy.satisfactionDrift,
      satisfactionTarget: economy.satisfactionTarget,
      comfortNeed: economy.comfortNeed,
      comfortProvided: economy.comfortProvided,
      comfortFullSet: economy.comfortFullSet,
      comfortCoverage: economy.comfortCoverage,
      miningRate,
    };
  }

  /* Upkeep lines per ship type for one fleet (or the reserve), in credits/s. */
  private shipUpkeepEntries(
    fleetName: string,
    ships: { type: string }[],
    factor: number,
    owner: Faction | null | undefined,
  ): FleetExpenseEntry[] {
    const shipCounts = new Map<string, number>();
    for (const ship of ships) {
      shipCounts.set(ship.type, (shipCounts.get(ship.type) || 0) + 1);
    }
    const entries: FleetExpenseEntry[] = [];
    for (const [typeId, count] of shipCounts) {
      const shipType = this.shipService.getShipType(typeId);
      const cost = this.getShipUpkeepPerSecond(typeId, owner) * factor;
      if (cost > 0) {
        entries.push({ fleetName, shipType: shipType?.name ?? typeId, count, maintenanceCost: cost, totalCost: cost * count });
      }
    }
    return entries;
  }

  private findPlanetByName(planetName: string, starSystems: StarSystem[]): PlanetTile | null {
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.name === planetName) return planet;
      }
    }
    return null;
  }

  /*
   * getPlanetEnergy: Backward-compatible energy lookup for a planet.
   */
  getPlanetEnergy(planet: PlanetTile, owner?: Faction | null): number {
    const economy = this.calculatePlanetEconomy(planet, owner);
    return economy.energyProduction;
  }

  /*
   * getPlanetTax: Backward-compatible tax lookup for a planet.
   */
  getPlanetTax(planet: PlanetTile): number {
    const pop = planet.population || 0;
    const factories = operationalBuildings(planet).filter((b) => b.name === 'Spaceship Factory').length;
    return Math.floor(pop * POPULATION_CREDIT_RATE) + factories * 500;
  }

  /*
   * getPlanetEconomyBreakdown: Effective economy of one planet (same values
   * as its row in calculateEconomy), for the planet screen and info panel.
   */
  getPlanetEconomyBreakdown(planet: PlanetTile, factions: Faction[] = [], starSystems: StarSystem[] = []): PlanetEconomyEntry {
    const owner = factions.find((f) => f.id === planet.factionId);
    const ownedCount = starSystems.length > 0 ? this.getOwnedPlanets(planet.factionId, starSystems).length : 1;
    return this.buildPlanetEntry(
      planet, gainMultiplier(owner), administrationShare(ownedCount), owner, empireUpkeepScale(ownedCount),
    );
  }

  /* Building upkeep of a planet in credits per second. */
  private calculatePlanetMaintenance(planet: PlanetTile, owner: Faction | null | undefined, scale: number): number {
    let expense = 0;
    const planetScale = scale * planetTypeTraits(planet.type).buildingUpkeep;
    for (const building of operationalBuildings(planet)) {
      expense += this.getBuildingUpkeepPerSecond(building.name, owner, planetScale);
    }
    return expense;
  }

  private getPlanetBuildingExpenses(planet: PlanetTile, owner: Faction | null | undefined, scale: number): BuildingExpenseEntry[] {
    const buildingCounts = new Map<string, number>();
    const buildingCosts = new Map<string, number>();

    for (const building of operationalBuildings(planet)) {
      const cost = this.getBuildingUpkeepPerSecond(building.name, owner, scale * planetTypeTraits(planet.type).buildingUpkeep);
      if (cost > 0) {
        buildingCounts.set(building.name, (buildingCounts.get(building.name) || 0) + 1);
        buildingCosts.set(building.name, (buildingCosts.get(building.name) || 0) + cost);
      }
    }

    const entries: BuildingExpenseEntry[] = [];
    for (const [name, count] of buildingCounts) {
      const totalCost = buildingCosts.get(name) ?? 0;
      entries.push({
        buildingName: name,
        count,
        maintenanceCost: totalCost / count,
        totalCost,
      });
    }
    return entries;
  }

  private getOwnedPlanets(factionId: string, starSystems: StarSystem[]): PlanetTile[] {
    const planets: PlanetTile[] = [];
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId === factionId) {
          planets.push(planet);
        }
      }
    }
    return planets;
  }
}

import { Injectable, Optional } from '@angular/core';
import { ShipService } from './ship.service';
import { PlanetOwnershipService } from './planet-ownership.service';
import { ProductionService } from './production.service';
import { ShipStockService } from './ship-stock.service';
import { ResearchService, TechModifiers } from './research.service';
import planetData from '../components/star-map/planet-data.json';
import { getAiDifficultyProfile } from '../components/star-map/ai-difficulty';
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
 * Population income (pop * 0.1 credits/s, plus a pop * POPULATION_RAW_RATE
 * raw-material trickle) is treated as a planet-level production source.
 *
 * Upkeep: `maintenanceCost` in planet-data.json / ship-data.json is in
 * upkeep points per second; one point costs UPKEEP_CREDITS_PER_POINT
 * credits. Buildings, fleet ships and ships in the faction-wide reserve
 * (ship stock, at RESERVE_SHIP_UPKEEP_FACTOR) all pay upkeep. Upkeep is
 * charged only in applyEconomyDelta. See docs/economy.md.
 */

/* Credits per second charged for one upkeep point (the single upkeep tuning knob). */
export const UPKEEP_CREDITS_PER_POINT = 0.3;
/* Stocked ships are mothballed: they cost this share of their fleet upkeep. */
export const RESERVE_SHIP_UPKEEP_FACTOR = 0.5;
export const RESERVE_FLEET_LABEL = 'Reserve (ship stock)';
/* Raw materials per second per inhabitant (homeworld: 1400 pop → 2.8/s). */
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
   * and research output of buildings). Without it the result is the
   * technology-free baseline; every economy and AI path passes the owner.
   */
  calculatePlanetEconomy(planet: PlanetTile, owner?: Faction | null): PlanetEconomy {
    const tech = this.research.getModifiers(owner);
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

    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;

      for (const [resource, amount] of Object.entries(stats.production ?? {})) {
        const techMultiplier = resource === 'rawmaterials' ? tech.rawOutput : resource === 'research' ? tech.researchOutput : 1;
        production[resource as ResourceType] =
          (production[resource as ResourceType] ?? 0) + amount * workforceEfficiency * techMultiplier;
      }

      for (const [resource, amount] of Object.entries(stats.consumption ?? {})) {
        consumption[resource as ResourceType] = (consumption[resource as ResourceType] ?? 0) + amount;
      }

      energyProduction += (stats.energyProduction ?? 0) * tech.energyOutput;
      energyConsumption += stats.energyConsumption ?? 0;
    }

    const pop = planet.population || 0;
    if (pop > 0) {
      production['credits'] = (production['credits'] ?? 0) + pop * 0.1;
      // Small population-driven raw trickle (local salvage and extraction).
      // Not scaled by workforce: it guarantees that a faction which lost its
      // factories and has no ore can still slowly afford to rebuild one, so
      // raw-material costs can never deadlock an economy.
      production['rawmaterials'] = (production['rawmaterials'] ?? 0) + pop * POPULATION_RAW_RATE;
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
    };
  }

  /*
   * computeWorkforce: Sums the workforce provided by residential (housing)
   * buildings and the workforce required by every building on the planet,
   * plus the aggregate building morale bonus. Residential buildings are pure
   * providers (their `workforce` requirement is 0); all other buildings
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
    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;
      required += stats.workforce ?? 0;
      if (stats.role === 'housing') {
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
   * it pauses when the game is paused and runs 2× as fast at speed 2x.
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
   * getPopulationCapacity: planet population ceiling from residential
   * buildings' population field (100/300/700). Reuses existing data.
   */
  getPopulationCapacity(planet: PlanetTile): number {
    let capacity = 0;
    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;
      if (stats.role === 'housing') {
        capacity += stats.population ?? 0;
      }
    }
    return capacity;
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
    const difficultyIncomeMultiplier = faction ? getAiDifficultyProfile(faction).incomeMultiplier : 1;
    const ownedPlanets = this.getOwnedPlanets(factionId, starSystems);
    const ownedFleets = fleets.filter((f) => f.factionId === factionId && !f.destroyed);

    const planets: PlanetEconomyEntry[] = [];
    const fleetExpenses: FleetExpenseEntry[] = [];

    const factionProduction: ResourceRates = {};
    const factionConsumption: ResourceRates = {};
    const factionNet: ResourceRates = {};
    let totalPopulation = 0;
    let totalEfficiency = 0;
    let buildingUpkeep = 0;
    let administration = 0;
    const adminShare = administrationShare(ownedPlanets.length);

    for (const planet of ownedPlanets) {
      const entry = this.buildPlanetEntry(planet, difficultyIncomeMultiplier, adminShare, faction);
      totalPopulation += entry.population;
      totalEfficiency += entry.efficiency;
      administration += entry.administration ?? 0;
      buildingUpkeep += entry.expense - (entry.administration ?? 0);
      for (const resource of STOCK_RESOURCES) {
        factionProduction[resource] = (factionProduction[resource] ?? 0) + (entry.production[resource] ?? 0);
        factionConsumption[resource] = (factionConsumption[resource] ?? 0) + (entry.consumption[resource] ?? 0);
        factionNet[resource] = (factionNet[resource] ?? 0) + (entry.netRates[resource] ?? 0);
      }
      planets.push(entry);
    }

    let shipUpkeep = 0;
    for (const fleet of ownedFleets) {
      for (const entry of this.shipUpkeepEntries(fleet.name, fleet.ships.filter((s) => !s.destroyed), 1, faction)) {
        shipUpkeep += entry.totalCost;
        fleetExpenses.push(entry);
      }
    }
    const reserve = shipStock?.find((s) => s.factionId === factionId)?.ships ?? [];
    for (const entry of this.shipUpkeepEntries(RESERVE_FLEET_LABEL, reserve, RESERVE_SHIP_UPKEEP_FACTOR, faction)) {
      shipUpkeep += entry.totalCost;
      fleetExpenses.push(entry);
    }
    // Building upkeep is already inside the planets' credit consumption.
    factionConsumption['credits'] = (factionConsumption['credits'] ?? 0) + shipUpkeep;
    factionNet['credits'] = (factionNet['credits'] ?? 0) - shipUpkeep;

    const income = factionProduction['credits'] ?? 0;
    const expense = buildingUpkeep + administration + shipUpkeep;
    return {
      incomePerSecond: income,
      expensePerSecond: expense,
      netPerSecond: income - expense,
      buildingUpkeepPerSecond: buildingUpkeep,
      administrationPerSecond: administration,
      shipUpkeepPerSecond: shipUpkeep,
      unpaidUpkeepPerSecond: 0,
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
   *  1. Satisfaction drift per owned planet: +1/s with enough energy, -1/s
   *     when energy-short, plus habitability + building morale
   *     (getMoraleDriftPerSecond); clamped to [0, 100]. A planet reaching 0
   *     rebels (→ 'independent') BEFORE income is computed, so it neither
   *     pays its old owner nor costs it upkeep on that tick.
   *  2. The effective breakdown is computed from the post-drift state and
   *     `net[r] × deltaTime` is applied to every stock resource: income
   *     minus upkeep for credits; raw materials and research as produced.
   *  3. Credits are kept as integers; the fractional remainder is carried
   *     per faction (in memory only) so rounding never drifts the balance
   *     away from the HUD rate.
   *  4. Arrears: credits never go below 0. If the treasury cannot cover the
   *     upkeep, the unpaid part is waived and every owned planet loses
   *     satisfaction at ARREARS_MORALE_PENALTY × (unpaid / upkeep) per
   *     second. A small shortfall is outweighed by the +1/s energy drift; a
   *     large one leads toward rebellion unless income recovers or upkeep
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

    // 1) Satisfaction drift and rebellion.
    for (const planet of this.getOwnedPlanets(factionId, starSystems)) {
      if (planet.factionId === 'independent') continue;
      const energyShort = this.calculatePlanetEconomy(planet, faction).efficiency < 1.0;
      const energyDirection = energyShort ? -1 : 1;
      const moraleDrift = this.getMoraleDriftPerSecond(planet);
      const current = planet.satisfaction ?? 100;
      planet.satisfaction = Math.max(0, Math.min(100, current + (energyDirection + moraleDrift) * deltaTime));
      if (planet.satisfaction <= 0) {
        this.planetOwnership.transferPlanet({ production, factions }, planet, 'independent', 'rebellion');
      }
    }

    // 2) Raw materials and research from the effective (post-drift) breakdown.
    const breakdown = this.calculateEconomy(factionId, factions, starSystems, fleets, shipStock);
    for (const resource of STOCK_RESOURCES) {
      if (resource === 'credits') continue;
      faction.currencies[resource] = (faction.currencies[resource] ?? 0) + (breakdown.net[resource] ?? 0) * deltaTime;
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
   * Upkeep in credits per second of one building / one ship of a type.
   * Exposed so the AI prices the ongoing cost of a purchase with the same
   * conversion the economy tick uses.
   */
  getBuildingUpkeepPerSecond(buildingName: string, owner?: Faction | null): number {
    return (this.buildingStatsByName.get(buildingName)?.maintenanceCost ?? 0) * UPKEEP_CREDITS_PER_POINT
      * this.research.getModifiers(owner).buildingUpkeep;
  }

  getShipUpkeepPerSecond(shipTypeId: string, owner?: Faction | null): number {
    return (this.shipService.getShipType(shipTypeId)?.maintenanceCost ?? 0) * UPKEEP_CREDITS_PER_POINT
      * this.research.getModifiers(owner).shipUpkeep;
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
  ): PlanetEconomyEntry {
    const economy = this.calculatePlanetEconomy(planet, owner);
    const buildingUpkeep = this.calculatePlanetMaintenance(planet, owner);
    const creditIncome = (economy.production['credits'] ?? 0) * economy.efficiency * economy.incomeMultiplier
      * difficultyIncomeMultiplier;
    const administration = creditIncome * adminShare;
    const upkeep = buildingUpkeep + administration;
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
      buildings: this.getPlanetBuildingExpenses(planet, owner),
      satisfaction: economy.satisfaction,
      incomeMultiplier: economy.incomeMultiplier,
      workforceAvailable: economy.workforceAvailable,
      workforceRequired: economy.workforceRequired,
      workforceEfficiency: economy.workforceEfficiency,
      habitabilityDrift: economy.habitabilityDrift,
      buildingMoraleBonus: economy.buildingMoraleBonus,
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
    const factories = (planet.buildings ?? []).filter((b) => b.name === 'Spaceship Factory').length;
    return Math.floor(pop * 0.1) + factories * 500;
  }

  /*
   * getPlanetEconomyBreakdown: Effective economy of one planet (same values
   * as its row in calculateEconomy), for the planet screen and info panel.
   */
  getPlanetEconomyBreakdown(planet: PlanetTile, factions: Faction[] = [], starSystems: StarSystem[] = []): PlanetEconomyEntry {
    const owner = factions.find((f) => f.id === planet.factionId);
    const ownedCount = starSystems.length > 0 ? this.getOwnedPlanets(planet.factionId, starSystems).length : 1;
    return this.buildPlanetEntry(
      planet, owner ? getAiDifficultyProfile(owner).incomeMultiplier : 1, administrationShare(ownedCount), owner,
    );
  }

  /* Building upkeep of a planet in credits per second. */
  private calculatePlanetMaintenance(planet: PlanetTile, owner: Faction | null | undefined): number {
    let expense = 0;
    for (const building of planet.buildings ?? []) {
      expense += this.getBuildingUpkeepPerSecond(building.name, owner);
    }
    return expense;
  }

  private getPlanetBuildingExpenses(planet: PlanetTile, owner: Faction | null | undefined): BuildingExpenseEntry[] {
    const buildingCounts = new Map<string, number>();
    const buildingCosts = new Map<string, number>();

    for (const building of planet.buildings ?? []) {
      const cost = this.getBuildingUpkeepPerSecond(building.name, owner);
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

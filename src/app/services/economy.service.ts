import { Injectable } from '@angular/core';
import { ShipService } from './ship.service';
import planetData from '../components/star-map/planet-data.json';
import {
  Faction,
  StarSystem,
  PlanetTile,
  Fleet,
  FleetShip,
  ShipType,
  ResourceType,
  ResourceRates,
  PlanetEconomy,
  EconomyBreakdown,
  PlanetEconomyEntry,
  BuildingExpenseEntry,
  FleetExpenseEntry,
  BuildingStats,
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
 * Population income (pop * 0.1 credits/s) is treated as a
 * planet-level production source for extensibility.
 */

export type { ResourceType, ResourceRates, PlanetEconomy };
export type { EconomyBreakdown, PlanetEconomyEntry, BuildingExpenseEntry, FleetExpenseEntry, BuildingStats };

const STOCK_RESOURCES: ResourceType[] = ['credits', 'rawmaterials', 'research'];

@Injectable({ providedIn: 'root' })
export class EconomyService {
  private readonly buildingStats: Map<string, BuildingStats> = new Map();
  private readonly buildingStatsByName: Map<string, BuildingStats> = new Map();

  constructor(private shipService: ShipService) {
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
   */
  calculatePlanetEconomy(planet: PlanetTile): PlanetEconomy {
    const production: ResourceRates = {};
    const consumption: ResourceRates = {};
    let energyProduction = 0;
    let energyConsumption = 0;

    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      if (!stats) continue;

      for (const [resource, amount] of Object.entries(stats.production ?? {})) {
        production[resource as ResourceType] = (production[resource as ResourceType] ?? 0) + amount;
      }

      for (const [resource, amount] of Object.entries(stats.consumption ?? {})) {
        consumption[resource as ResourceType] = (consumption[resource as ResourceType] ?? 0) + amount;
      }

      energyProduction += stats.energyProduction ?? 0;
      energyConsumption += stats.energyConsumption ?? 0;
    }

    const pop = planet.population || 0;
    if (pop > 0) {
      production['credits'] = (production['credits'] ?? 0) + pop * 0.1;
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
    };
  }

  /*
   * calculateEconomy: Aggregates economy for a faction across all owned planets.
   * Returns extended breakdown with per-resource aggregates.
   */
  calculateEconomy(
    factionId: string,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
  ): EconomyBreakdown {
    const ownedPlanets = this.getOwnedPlanets(factionId, starSystems);
    const ownedFleets = fleets.filter((f) => f.factionId === factionId && !f.destroyed);

    const planets: PlanetEconomyEntry[] = [];
    const fleetExpenses: FleetExpenseEntry[] = [];

    const factionProduction: ResourceRates = {};
    const factionConsumption: ResourceRates = {};
    const factionNet: ResourceRates = {};
    let totalExpense = 0;
    let totalPopulation = 0;
    let totalEfficiency = 0;
    let planetCount = 0;

    for (const planet of ownedPlanets) {
      const pop = planet.population || 0;
      totalPopulation += pop;

      const economy = this.calculatePlanetEconomy(planet);

      const planetExpense = this.calculatePlanetMaintenance(planet);
      totalExpense += planetExpense;

      totalEfficiency += economy.efficiency;
      planetCount++;

      for (const resource of STOCK_RESOURCES) {
        factionProduction[resource] = (factionProduction[resource] ?? 0) + (economy.production[resource] ?? 0);
        factionConsumption[resource] = (factionConsumption[resource] ?? 0) + (economy.consumption[resource] ?? 0);
        factionNet[resource] = (factionNet[resource] ?? 0) + economy.net[resource]!;
      }

      const buildings: BuildingExpenseEntry[] = this.getPlanetBuildingExpenses(planet);

      planets.push({
        planetName: planet.name,
        population: pop,
        income: economy.production['credits'] ?? 0,
        expense: planetExpense,
        net: (economy.net['credits'] ?? 0) - planetExpense,
        production: economy.production,
        consumption: economy.consumption,
        netRates: economy.net,
        energyProduction: economy.energyProduction,
        energyConsumption: economy.energyConsumption,
        energyBalance: economy.energyBalance,
        efficiency: economy.efficiency,
        buildings,
        satisfaction: economy.satisfaction,
        incomeMultiplier: economy.incomeMultiplier,
      });
    }

    for (const fleet of ownedFleets) {
      const shipCounts = new Map<string, number>();
      for (const ship of fleet.ships) {
        if (ship.destroyed) continue;
        shipCounts.set(ship.type, (shipCounts.get(ship.type) || 0) + 1);
      }

      for (const [typeId, count] of shipCounts) {
        const shipType = this.shipService.getShipType(typeId);
        const cost = shipType?.maintenanceCost ?? 0;
        if (cost > 0) {
          const totalCost = cost * count;
          totalExpense += totalCost;
          fleetExpenses.push({
            fleetName: fleet.name,
            shipType: shipType?.name ?? typeId,
            count,
            maintenanceCost: cost,
            totalCost,
          });
        }
      }
    }

    const avgEfficiency = planetCount > 0 ? totalEfficiency / planetCount : 1.0;

    return {
      incomePerSecond: factionProduction['credits'] ?? 0,
      expensePerSecond: totalExpense,
      netPerSecond: (factionProduction['credits'] ?? 0) - totalExpense,
      totalPopulation,
      planets,
      fleetExpenses,
      production: factionProduction,
      consumption: factionConsumption,
      net: factionNet,
      efficiency: avgEfficiency,
    };
  }

  /*
   * applyEconomyDelta: Applies resource changes over deltaTime.
   * Only stock resources (credits, rawmaterials, research) are mutated.
   * Energy is a flow resource and is NOT accumulated.
   *
   * Side effects on each owned planet:
   * - Satisfaction is updated based on energy balance (±1 per second).
   *   When the planet is energy-short, satisfaction drops; otherwise it
   *   recovers (symmetric rate, clamped to [0, 100]).
   * - When satisfaction reaches 0, the planet's factionId is set to
   *   'independent'. This rebellion happens BEFORE the income tick so
   *   the flipping planet does not generate credits on the same tick.
   * - Credits are scaled by `satisfaction / 100`. Raw materials and
   *   research are not affected.
   */
  applyEconomyDelta(
    factionId: string,
    factions: Faction[],
    starSystems: StarSystem[],
    fleets: Fleet[],
    deltaTime: number,
  ): EconomyBreakdown {
    const breakdown = this.calculateEconomy(factionId, factions, starSystems, fleets);
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) return breakdown;

    for (const planetEntry of breakdown.planets) {
      const planet = this.findPlanetByName(planetEntry.planetName, starSystems);
      if (!planet) continue;

      // 1) Drift satisfaction based on this tick's energy balance.
      //    Independent planets stay locked at 0 (they are no longer in
      //    `breakdown.planets` because they are not owned by factionId,
      //    so the guard is mostly defensive).
      if (planet.factionId !== 'independent') {
        const energyShort = planetEntry.efficiency < 1.0;
        const direction = energyShort ? -1 : 1;
        const current = planet.satisfaction ?? 100;
        const next = Math.max(0, Math.min(100, current + direction * deltaTime));
        planet.satisfaction = next;

        // 2) Rebellion check: 0% satisfaction -> independent faction.
        //    The multiplier for this tick must be 0 so we do not pay out
        //    credits for the same tick the planet flips. We use the new
        //    satisfaction value here, not the one captured in the
        //    breakdown entry, so the flip is honored immediately.
        if (planet.satisfaction <= 0 && planet.factionId !== 'independent') {
          planet.factionId = 'independent';
        }
      }

      // 3) Apply resource deltas. Credits are scaled by the current
      //    satisfaction multiplier (read straight from the planet after
      //    any updates above). Raw materials and research are not scaled.
      const effectiveMultiplier = (planet.satisfaction ?? 0) / 100;
      for (const resource of STOCK_RESOURCES) {
        const netRate = planetEntry.netRates[resource] ?? 0;
        const multiplier = resource === 'credits' ? effectiveMultiplier : 1;
        const effectiveRate = netRate * planetEntry.efficiency * multiplier;
        const current = faction.currencies[resource] ?? 0;
        const newValue = current + effectiveRate * deltaTime;
        faction.currencies[resource] = resource === 'credits' ? Math.floor(newValue) : newValue;
      }
    }

    return breakdown;
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
  getPlanetEnergy(planet: PlanetTile): number {
    const economy = this.calculatePlanetEconomy(planet);
    return economy.energyProduction;
  }

  /*
   * getPlanetTax: Backward-compatible tax lookup for a planet.
   */
  getPlanetTax(planet: PlanetTile): number {
    const pop = planet.population || 0;
    const factories = (planet.buildings ?? []).filter((b) => b.name === 'Industrial Factory').length;
    return Math.floor(pop * 0.1) + factories * 500;
  }

  /*
   * getPlanetEconomyBreakdown: Returns the economy breakdown for a specific planet.
   */
  getPlanetEconomyBreakdown(planet: PlanetTile): PlanetEconomyEntry {
    const economy = this.calculatePlanetEconomy(planet);
    const pop = planet.population || 0;
    const planetExpense = this.calculatePlanetMaintenance(planet);
    const buildings = this.getPlanetBuildingExpenses(planet);

    return {
      planetName: planet.name,
      population: pop,
      income: economy.production['credits'] ?? 0,
      expense: planetExpense,
      net: (economy.net['credits'] ?? 0) - planetExpense,
      production: economy.production,
      consumption: economy.consumption,
      netRates: economy.net,
      energyProduction: economy.energyProduction,
      energyConsumption: economy.energyConsumption,
      energyBalance: economy.energyBalance,
      efficiency: economy.efficiency,
      buildings,
      satisfaction: economy.satisfaction,
      incomeMultiplier: economy.incomeMultiplier,
    };
  }

  private calculatePlanetMaintenance(planet: PlanetTile): number {
    let expense = 0;
    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      const cost = stats?.maintenanceCost ?? 0;
      expense += cost;
    }
    return expense;
  }

  private getPlanetBuildingExpenses(planet: PlanetTile): BuildingExpenseEntry[] {
    const buildingCounts = new Map<string, number>();
    const buildingCosts = new Map<string, number>();

    for (const building of planet.buildings ?? []) {
      const stats = this.buildingStatsByName.get(building.name);
      const cost = stats?.maintenanceCost ?? 0;
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
        maintenanceCost: Math.ceil(totalCost / count),
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

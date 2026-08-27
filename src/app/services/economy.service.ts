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
} from '../components/star-map/star-map.models';

/*
 * =========================================================
 * ECONOMY SERVICE
 * =========================================================
 *
 * Calculates and applies per-second credit income and
 * maintenance expenses for factions based on their owned
 * planets and fleets.
 *
 * Income: 10 credits per citizen per second.
 * Expenses: building maintenance costs per second +
 *           fleet ship maintenance costs per second.
 */

export interface EconomyBreakdown {
  incomePerSecond: number;
  expensePerSecond: number;
  netPerSecond: number;
  totalPopulation: number;
  planets: PlanetEconomyEntry[];
  fleetExpenses: FleetExpenseEntry[];
}

export interface PlanetEconomyEntry {
  planetName: string;
  population: number;
  income: number;
  expense: number;
  net: number;
  buildings: BuildingExpenseEntry[];
}

export interface BuildingExpenseEntry {
  buildingName: string;
  count: number;
  maintenanceCost: number;
  totalCost: number;
}

export interface FleetExpenseEntry {
  fleetName: string;
  shipType: string;
  count: number;
  maintenanceCost: number;
  totalCost: number;
}

interface BuildingStats {
  id: string;
  name: string;
  maintenanceCost: number;
}

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

    let totalIncome = 0;
    let totalExpense = 0;
    let totalPopulation = 0;

    for (const planet of ownedPlanets) {
      const pop = planet.population || 0;
      totalPopulation += pop;

      const income = pop * 0.1;
      const buildingCounts = new Map<string, number>();
      const buildingCosts = new Map<string, number>();
      let planetExpense = 0;

      for (const building of planet.buildings ?? []) {
        const stats = this.buildingStatsByName.get(building.name);
        const cost = stats?.maintenanceCost ?? 0;
        if (cost > 0) {
          planetExpense += cost;
          buildingCounts.set(building.name, (buildingCounts.get(building.name) || 0) + 1);
          buildingCosts.set(building.name, (buildingCosts.get(building.name) || 0) + cost);
        }
      }

      totalIncome += income;
      totalExpense += planetExpense;

      const buildings: BuildingExpenseEntry[] = [];
      for (const [name, count] of buildingCounts) {
        const totalCost = buildingCosts.get(name) ?? 0;
        buildings.push({
          buildingName: name,
          count,
          maintenanceCost: Math.ceil(totalCost / count),
          totalCost,
        });
      }

      planets.push({
        planetName: planet.name,
        population: pop,
        income,
        expense: planetExpense,
        net: income - planetExpense,
        buildings,
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

    return {
      incomePerSecond: totalIncome,
      expensePerSecond: totalExpense,
      netPerSecond: totalIncome - totalExpense,
      totalPopulation,
      planets,
      fleetExpenses,
    };
  }

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

    const netChange = breakdown.netPerSecond * deltaTime;
    const current = faction.currencies['credits'] ?? 0;
    faction.currencies['credits'] = Math.floor(current + netChange);

    return breakdown;
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

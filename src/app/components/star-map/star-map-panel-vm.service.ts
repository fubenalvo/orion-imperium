import { Injectable } from '@angular/core';
import { ProductionService } from '../../services/production.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ShipService } from '../../services/ship.service';
import { SpaceportService } from '../../services/spaceport.service';
import { ResearchService } from '../../services/research.service';
import { Faction, FactionProduction, FactionShipStock, PlanetTile, StarSystem } from './star-map.models';
import { ProductionPanelViewModel } from './star-map-production-panel/star-map-production-panel.component';
import { SpaceportPanelViewModel } from './star-map-spaceport-panel/star-map-spaceport-panel.component';

/*
 * =========================================================
 * STAR MAP PANEL VM SERVICE
 * =========================================================
 *
 * Builds the view models for the production and spaceport
 * panels and maps service failure reasons to user-facing
 * messages. Pure coordination logic: it reads game state
 * through the same services the StarMap component uses and
 * holds no state of its own.
 *
 * `data` follows the structural context pattern used by the
 * stock/production services: the caller passes its live
 * `shipStock` / `production` arrays so the underlying services
 * mutate the component-owned game state.
 */
@Injectable({ providedIn: 'root' })
export class StarMapPanelVmService {
  constructor(
    private productionService: ProductionService,
    private shipStockService: ShipStockService,
    private shipService: ShipService,
    private spaceportService: SpaceportService,
    private researchService: ResearchService,
  ) {}

  getProductionPanelVm(
    data: { shipStock?: FactionShipStock[]; production?: FactionProduction[] },
    selectedPlanetTile: PlanetTile | null,
    selectedSystem: StarSystem | null,
    factions: Faction[],
  ): ProductionPanelViewModel | null {
    if (!selectedPlanetTile || !selectedSystem) {
      return null;
    }
    const playerFaction = factions.find((f) => f.id === 'player');
    const buildable = this.productionService
      .listBuildableShipTypes(selectedPlanetTile)
      .filter((t) => this.researchService.isShipUnlocked(playerFaction!, t.id));
    const queue = this.productionService.getQueue(data, 'player', selectedPlanetTile.id);
    const etas: Record<number, number | null> = {};
    for (const order of queue) {
      etas[order.id] = this.productionService.getOrderEta(order, selectedPlanetTile);
    }
    const shipCosts: Record<string, number> = {};
    const shipBuildTimes: Record<string, number> = {};
    for (const t of buildable) {
      shipCosts[t.id] = t.cost;
      shipBuildTimes[t.id] = t.buildTime ?? Math.max(1, t.cost * 0.1);
    }
    return {
      planet: selectedPlanetTile,
      system: selectedSystem,
      factionId: 'player',
      buildable,
      capacity: this.productionService.getPlanetCapacity(selectedPlanetTile),
      power: this.productionService.getPlanetPower(selectedPlanetTile),
      queue,
      shipCosts,
      shipBuildTimes,
      etas,
      factionCredits: this.getPlayerCredits(factions),
    };
  }

  getSpaceportPanelVm(
    data: { shipStock?: FactionShipStock[]; production?: FactionProduction[] },
    selectedPlanetTile: PlanetTile | null,
    selectedSystem: StarSystem | null,
    starSystems: StarSystem[],
    factions: Faction[],
    spaceportError: string | null,
  ): SpaceportPanelViewModel | null {
    if (!selectedPlanetTile || !selectedSystem) {
      return null;
    }
    if (!this.spaceportService.isSpaceportPlanet(selectedPlanetTile)) {
      return null;
    }
    const playerFaction = factions.find((f) => f.id === 'player');
    const assemblySystems = this.spaceportService
      .listSpaceports('player', starSystems)
      .map((loc) => ({
        systemId: loc.system.id,
        systemName: loc.system.name,
        planets: loc.system.planetsTiles
          .filter((p) => p.factionId === 'player' && this.spaceportService.isSpaceportPlanet(p))
          .map((p) => ({ id: p.id, name: p.name })),
      }));
    const summary = this.shipStockService.getSummary(data, 'player');
    const available = summary
      .map((entry) => {
        const type = this.shipService.getShipType(entry.typeId);
        return {
          typeId: entry.typeId,
          typeName: type?.name ?? entry.typeId,
          available: entry.count,
        };
      })
      .filter((entry) => this.researchService.isShipUnlocked(playerFaction!, entry.typeId))
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
    return {
      system: selectedSystem,
      planet: selectedPlanetTile,
      factionId: 'player',
      available,
      selectedSystemId: selectedSystem.id,
      selectedPlanetId: selectedPlanetTile.id,
      assemblySystems,
      errorMessage: spaceportError,
    };
  }

  /** Returns the player's current credit balance. */
  private getPlayerCredits(factions: Faction[]): number {
    const player = factions.find((f) => f.id === 'player');
    return player?.currencies?.['credits'] ?? 0;
  }

  describeProductionError(reason: string | undefined): string {
    switch (reason) {
      case 'no_factory':
        return 'No factory on this planet.';
      case 'insufficient_resources':
        return 'Not enough credits.';
      case 'invalid_type':
        return 'Invalid ship type.';
      case 'invalid_quantity':
        return 'Invalid quantity.';
      default:
        return 'Could not queue order.';
    }
  }

  describeAssemblyError(reason: string | undefined): string {
    switch (reason) {
      case 'no_spaceport':
        return 'No Spaceport available.';
      case 'insufficient_stock':
        return 'Not enough ships in stock.';
      case 'invalid_composition':
        return 'Select at least one ship.';
      case 'invalid_target':
        return 'Invalid assembly point.';
      case 'fleet_not_found':
        return 'Fleet not found.';
      case 'enemy_fleet':
        return 'Cannot modify an enemy fleet.';
      default:
        return 'Assembly failed.';
    }
  }

  suggestFleetName(fleets: { factionId: string; name: string }[]): string {
    const used = new Set(fleets.filter((f) => f.factionId === 'player').map((f) => f.name));
    for (let i = 1; i < 1000; i++) {
      const name = `${i}${this.ordinalSuffix(i)} Fleet`;
      if (!used.has(name)) {
        return name;
      }
    }
    return 'New Fleet';
  }

  private ordinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }
}

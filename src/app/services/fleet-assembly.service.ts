import { Injectable } from '@angular/core';
import {
  Fleet,
  FleetShip,
  FactionShipStock,
  ShipStockEntry,
  StarSystem,
} from '../components/star-map/star-map.models';
import { ShipService, ShipType } from './ship.service';
import { ShipStockService } from './ship-stock.service';
import { MilitarySpaceportService } from './military-spaceport.service';

export type AssemblyFailure =
  | 'no_spaceport'
  | 'fleet_not_found'
  | 'insufficient_stock'
  | 'invalid_composition'
  | 'invalid_target'
  | 'enemy_fleet';

export interface AssemblyResult {
  ok: boolean;
  reason?: AssemblyFailure;
  fleet?: Fleet;
}

export interface AssemblyRequest {
  typeId: string;
  count: number;
}

const DEFAULT_FLEET_SPEED = 4;
const DEFAULT_FLEET_SENSOR_RANGE = 3;

/*
 * FleetAssemblyService
 * --------------------
 * Reuses the existing `Fleet` entity for everything that happens after
 * a ship leaves the stock. Composition is requested as `typeId + count`
 * from the UI; the service pops actual stock entries (per-instance) so
 * the battle / sensor code keeps working without changes.
 *
 * The service does NOT:
 *  - manage fleet movement
 *  - create new ship data
 *  - touch the global stock outside of the atomic pop it performs
 */
@Injectable({ providedIn: 'root' })
export class FleetAssemblyService {
  constructor(
    private shipService: ShipService,
    private shipStockService: ShipStockService,
    private spaceportService: MilitarySpaceportService,
  ) {}

  createFleet(
    data: {
      shipStock?: FactionShipStock[];
      fleets: Fleet[];
    },
    starSystems: StarSystem[],
    request: {
      factionId: string;
      fleetName: string;
      systemId: string;
      planetId: number;
      composition: AssemblyRequest[];
    },
  ): AssemblyResult {
    if (!this.spaceportService.hasSpaceport(request.factionId, starSystems)) {
      return { ok: false, reason: 'no_spaceport' };
    }
    const system = starSystems.find((s) => s.id === request.systemId);
    const planet = system?.planetsTiles.find((p) => p.id === request.planetId);
    if (!system || !planet || planet.factionId !== request.factionId) {
      return { ok: false, reason: 'invalid_target' };
    }
    if (!this.spaceportService.isSpaceportPlanet(planet)) {
      return { ok: false, reason: 'no_spaceport' };
    }
    if (request.composition.length === 0) {
      return { ok: false, reason: 'invalid_composition' };
    }
    const stockCheck = this.checkStock(data, request.factionId, request.composition);
    if (!stockCheck.ok) {
      return { ok: false, reason: stockCheck.reason };
    }

    const fleetShips: FleetShip[] = [];
    for (const item of request.composition) {
      const removed = this.shipStockService.removeFromStock(data, request.factionId, item.typeId, item.count);
      for (const entry of removed) {
        fleetShips.push(this.stockEntryToFleetShip(entry));
      }
    }

    const fleet: Fleet = {
      id: this.nextFleetId(data.fleets),
      name: request.fleetName.trim() || `${request.factionId} Fleet`,
      factionId: request.factionId,
      x: system.x,
      y: system.y,
      targetX: null,
      targetY: null,
      speed: DEFAULT_FLEET_SPEED,
      system: {
        id: system.id,
        x: 2.5,
        y: 32.5,
        targetX: null,
        targetY: null,
      },
      gridCol: Math.floor(system.x),
      gridRow: Math.floor(system.y),
      ships: fleetShips,
      destroyed: false,
      sensorRange: DEFAULT_FLEET_SENSOR_RANGE,
    };
    data.fleets.push(fleet);
    return { ok: true, fleet };
  }

  reinforceFleet(
    data: {
      shipStock?: FactionShipStock[];
      fleets: Fleet[];
    },
    starSystems: StarSystem[],
    request: {
      factionId: string;
      fleetId: number;
      composition: AssemblyRequest[];
    },
  ): AssemblyResult {
    const fleet = data.fleets.find((f) => f.id === request.fleetId);
    if (!fleet || fleet.destroyed) {
      return { ok: false, reason: 'fleet_not_found' };
    }
    if (fleet.factionId !== request.factionId) {
      return { ok: false, reason: 'enemy_fleet' };
    }
    if (!this.spaceportService.hasSpaceport(request.factionId, starSystems)) {
      return { ok: false, reason: 'no_spaceport' };
    }
    if (request.composition.length === 0) {
      return { ok: false, reason: 'invalid_composition' };
    }
    const stockCheck = this.checkStock(data, request.factionId, request.composition);
    if (!stockCheck.ok) {
      return { ok: false, reason: stockCheck.reason };
    }

    for (const item of request.composition) {
      const removed = this.shipStockService.removeFromStock(data, request.factionId, item.typeId, item.count);
      for (const entry of removed) {
        fleet.ships.push(this.stockEntryToFleetShip(entry));
      }
    }
    return { ok: true, fleet };
  }

  disbandFleet(
    data: { shipStock?: FactionShipStock[]; fleets: Fleet[] },
    factionId: string,
    fleetId: number,
  ): AssemblyResult {
    const fleet = data.fleets.find((f) => f.id === fleetId);
    if (!fleet || fleet.destroyed) {
      return { ok: false, reason: 'fleet_not_found' };
    }
    if (fleet.factionId !== factionId) {
      return { ok: false, reason: 'enemy_fleet' };
    }
    this.shipStockService.disbandFleet(data, fleet);
    return { ok: true, fleet };
  }

  /*
   * nextFleetId: Returns a fresh id greater than every existing fleet.
   * Idempotent; safe to call twice.
   */
  nextFleetId(fleets: Fleet[]): number {
    let max = 0;
    for (const f of fleets) {
      if (f.id > max) {
        max = f.id;
      }
    }
    return max + 1;
  }

  private checkStock(
    data: { shipStock?: FactionShipStock[] },
    factionId: string,
    composition: AssemblyRequest[],
  ): { ok: boolean; reason?: AssemblyFailure } {
    for (const item of composition) {
      if (item.count <= 0) {
        return { ok: false, reason: 'invalid_composition' };
      }
      if (this.shipStockService.getCount(data, factionId, item.typeId) < item.count) {
        return { ok: false, reason: 'insufficient_stock' };
      }
    }
    return { ok: true };
  }

  private stockEntryToFleetShip(entry: ShipStockEntry): FleetShip {
    const shipType: ShipType | undefined = this.shipService.getShipType(entry.type);
    return {
      id: entry.id,
      type: entry.type,
      name: entry.name,
      currentHp: shipType?.hitPoints,
      destroyed: false,
    };
  }
}

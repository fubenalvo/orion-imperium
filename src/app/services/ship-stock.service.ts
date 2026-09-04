import { Injectable } from '@angular/core';
import {
  Fleet,
  FactionShipStock,
  ShipStockEntry,
  StarSystem,
} from '../components/star-map/star-map.models';

/*
 * ShipStockService
 * ----------------
 * Pure helpers over `StarMapData.shipStock`. The stock is faction-scoped
 * (empire) and stores per-instance `ShipStockEntry` records, matching the
 * `FleetShip` shape used inside fleets. This keeps the existing battle,
 * sensor, and movement code able to consume stock entries without any
 * change when they are pushed into a fleet.
 *
 * Conventions:
 * - Stock is ordered oldest-first (FIFO). Order is purely informational;
 *   gameplay does not depend on it, but the order helps debug logs and
 *   future "veterancy" systems.
 * - All methods mutate the live arrays passed in. The service never
 *   owns the data; it operates on whatever `StarMapData` is current.
 */
@Injectable({ providedIn: 'root' })
export class ShipStockService {
  private static readonly DEFAULT_SHIP_NAME = 'Ship';

  /*
   * getStock: Returns the live stock array for a faction, creating an
   * empty entry if none exists. The returned reference is the one stored
   * on the data, so callers can iterate / count without an allocation.
   */
  getStock(data: { shipStock?: FactionShipStock[] }, factionId: string): ShipStockEntry[] {
    if (!data.shipStock) {
      data.shipStock = [];
    }
    let entry = data.shipStock.find((s) => s.factionId === factionId);
    if (!entry) {
      entry = { factionId, ships: [] };
      data.shipStock.push(entry);
    }
    return entry.ships;
  }

  getCount(data: { shipStock?: FactionShipStock[] }, factionId: string, typeId?: string): number {
    const ships = this.getStock(data, factionId);
    if (!typeId) {
      return ships.length;
    }
    let n = 0;
    for (const ship of ships) {
      if (ship.type === typeId) {
        n++;
      }
    }
    return n;
  }

  getSummary(data: { shipStock?: FactionShipStock[] }, factionId: string): { typeId: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const ship of this.getStock(data, factionId)) {
      counts.set(ship.type, (counts.get(ship.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([typeId, count]) => ({ typeId, count }));
  }

  /*
   * addToStock: Appends entries to a faction's stock. Used by the
   * production tick and by `disbandFleet` to return surviving ships.
   */
  addToStock(data: { shipStock?: FactionShipStock[] }, factionId: string, entries: ShipStockEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    const stock = this.getStock(data, factionId);
    stock.push(...entries);
  }

  /*
   * removeFromStock: Removes up to `count` ships of `typeId` from the
   * faction's stock and returns the removed entries. Returns an empty
   * array if the stock has fewer than `count` of that type. FIFO order
   * is used.
   */
  removeFromStock(
    data: { shipStock?: FactionShipStock[] },
    factionId: string,
    typeId: string,
    count: number,
  ): ShipStockEntry[] {
    if (count <= 0) {
      return [];
    }
    const stock = this.getStock(data, factionId);
    const removed: ShipStockEntry[] = [];
    for (let i = 0; i < stock.length && removed.length < count; ) {
      if (stock[i].type === typeId) {
        removed.push(stock.splice(i, 1)[0]);
      } else {
        i++;
      }
    }
    return removed;
  }

  /*
   * disbandFleet: Returns every surviving ship in the fleet to the
   * faction's stock, then marks the fleet as `destroyed` so the
   * existing movement / sensor / economy code stops touching it.
   * Destroyed ships in the fleet are lost (matches IG1 behaviour).
   */
  disbandFleet(
    data: { shipStock?: FactionShipStock[] },
    fleet: Fleet,
  ): number {
    if (fleet.destroyed) {
      return 0;
    }
    const survivors = (fleet.ships ?? []).filter((s) => !s.destroyed);
    if (survivors.length > 0) {
      const entries: ShipStockEntry[] = survivors.map((s) => ({
        id: s.id,
        type: s.type,
        name: s.name,
      }));
      this.addToStock(data, fleet.factionId, entries);
    }
    fleet.ships = [];
    fleet.destroyed = true;
    return survivors.length;
  }

  /*
   * onFactionRemoved: Returns the orphaned stock entries for a faction
   * that no longer exists, and removes them from the data. Callers can
   * redistribute or drop the returned entries; the current implementation
   * just drops them.
   */
  onFactionRemoved(data: { shipStock?: FactionShipStock[] }, factionId: string): ShipStockEntry[] {
    if (!data.shipStock) {
      return [];
    }
    const idx = data.shipStock.findIndex((s) => s.factionId === factionId);
    if (idx < 0) {
      return [];
    }
    const removed = data.shipStock.splice(idx, 1)[0];
    return removed.ships;
  }

  /*
   * nextShipId: Returns a new unique ship id. The id space is shared
   * with `FleetShip.id` so a stock entry can be pushed into a fleet
   * without colliding with existing fleet ships.
   */
  nextShipId(fleets: Fleet[], data: { shipStock?: FactionShipStock[] }): number {
    let max = 0;
    for (const fleet of fleets) {
      for (const ship of fleet.ships ?? []) {
        if (ship.id > max) {
          max = ship.id;
        }
      }
    }
    if (data.shipStock) {
      for (const stock of data.shipStock) {
        for (const ship of stock.ships) {
          if (ship.id > max) {
            max = ship.id;
          }
        }
      }
    }
    return max + 1;
  }

  static defaultNameFor(_typeName: string | undefined): string {
    return ShipStockService.DEFAULT_SHIP_NAME;
  }

  /*
   * Helper used by callers that have a `StarSystem` reference for a
   * planet to place a new fleet at. Returns the galaxy-grid cell of
   * the host star system, which is the natural starting position for
   * a freshly assembled fleet.
   */
  systemGalaxyCell(system: StarSystem): { x: number; y: number } {
    return { x: system.x, y: system.y };
  }
}

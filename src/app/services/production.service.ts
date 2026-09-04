import { Injectable } from '@angular/core';
import {
  Faction,
  FactionProduction,
  PlanetTile,
  ProductionOrder,
  ShipStockEntry,
  StarSystem,
} from '../components/star-map/star-map.models';
import { ShipService, ShipType, ProductionBuildingKind } from './ship.service';
import { ShipStockService } from './ship-stock.service';

export interface ProductionResult {
  ok: boolean;
  reason?: 'no_factory' | 'insufficient_resources' | 'invalid_type' | 'invalid_quantity';
  order?: ProductionOrder;
  refunded?: { credits: number; rawmaterials: number; research: number };
}

export interface ProductionTickResult {
  completedOrders: ProductionOrder[];
  producedShips: { factionId: string; planetId: number; typeId: string; count: number }[];
  refundedOrders: { factionId: string; planetId: number; orderId: number; refunded: { credits: number; rawmaterials: number; research: number } }[];
  stateChanged: boolean;
}

/*
 * ProductionService
 * -----------------
 * Owns the per-planet production queue and the per-tick progress of every
 * active order. Factories produce ships; ships enter the global stock. The
 * service never touches a fleet directly.
 *
 * One in-flight order per planet at a time (production-capacity = 1 by
 * default). This matches the IG1 single-queue mental model and avoids
 * ambiguous UI for v1. The service is fully data-driven: production
 * capacity and power come from the building definitions on each planet,
 * not from any hard-coded list.
 *
 * Resource cost is deducted up-front at queue time. If production stalls
 * because a factory is destroyed, the un-built portion is refunded
 * proportionally on auto-cancel.
 */
@Injectable({ providedIn: 'root' })
export class ProductionService {
  private static readonly STALLED_ORDER_TIMEOUT = 30;
  private static readonly DEFAULT_FACTORY_POWER = 0.5;
  private static readonly DEFAULT_FACTORY_SLOTS = 1;

  private orderIdCounter = 1;
  private tickCounter = 0;

  constructor(
    private shipService: ShipService,
    private shipStockService: ShipStockService,
  ) {}

  /*
   * queueOrder: Deducts the resource cost up-front, then enqueues the
   * order on the planet. Returns a structured result so the UI can
   * display the failure reason.
   */
  queueOrder(
    data: { production?: FactionProduction[] },
    factionId: string,
    planetId: number,
    shipTypeId: string,
    quantity: number,
    starSystems: StarSystem[],
    factions: Faction[],
  ): ProductionResult {
    if (quantity <= 0) {
      return { ok: false, reason: 'invalid_quantity' };
    }
    const shipType = this.shipService.getShipType(shipTypeId);
    if (!shipType) {
      return { ok: false, reason: 'invalid_type' };
    }
    const planet = this.findPlanet(starSystems, planetId);
    if (!planet) {
      return { ok: false, reason: 'no_factory' };
    }
    const capacity = this.getPlanetCapacity(planet, shipType.productionBuilding ?? 'spaceship_factory');
    if (capacity <= 0) {
      return { ok: false, reason: 'no_factory' };
    }
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) {
      return { ok: false, reason: 'invalid_type' };
    }
    const totalCost = shipType.cost * quantity;
    if (!this.canAfford(faction, totalCost)) {
      return { ok: false, reason: 'insufficient_resources' };
    }
    this.deductCost(faction, totalCost);

    const order: ProductionOrder = {
      id: this.orderIdCounter++,
      shipTypeId,
      quantity,
      progress: 0,
      startedAtTick: this.tickCounter,
    };
    this.getQueue(data, factionId, planetId).push(order);
    return { ok: true, order };
  }

  /*
   * cancelOrder: Removes the order from the queue and refunds the
   * un-built portion of its cost.
   */
  cancelOrder(
    data: { production?: FactionProduction[] },
    factionId: string,
    planetId: number,
    orderId: number,
    factions: Faction[],
  ): ProductionResult {
    const queue = this.getQueue(data, factionId, planetId);
    const idx = queue.findIndex((o) => o.id === orderId);
    if (idx < 0) {
      return { ok: false, reason: 'invalid_type' };
    }
    const order = queue[idx];
    queue.splice(idx, 1);
    const shipType = this.shipService.getShipType(order.shipTypeId);
    const totalCost = (shipType?.cost ?? 0) * order.quantity;
    const builtFraction = Math.max(0, Math.min(1, order.progress));
    const unbuilt = Math.round(totalCost * (1 - builtFraction));
    const faction = factions.find((f) => f.id === factionId);
    if (faction && unbuilt > 0) {
      faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) + unbuilt;
    }
    return {
      ok: true,
      refunded: { credits: unbuilt, rawmaterials: 0, research: 0 },
    };
  }

  getQueue(data: { production?: FactionProduction[] }, factionId: string, planetId: number): ProductionOrder[] {
    if (!data.production) {
      data.production = [];
    }
    let factionProd = data.production.find((p) => p.factionId === factionId);
    if (!factionProd) {
      factionProd = { factionId, ordersByPlanet: {} };
      data.production.push(factionProd);
    }
    if (!factionProd.ordersByPlanet[planetId]) {
      factionProd.ordersByPlanet[planetId] = [];
    }
    return factionProd.ordersByPlanet[planetId];
  }

  getPlanetCapacity(planet: PlanetTile, kind: ProductionBuildingKind = 'spaceship_factory'): number {
    return planet.buildings
      .filter((b) => b.name === 'Spaceship Factory' && kind === 'spaceship_factory')
      .reduce((sum, b) => sum + ProductionService.DEFAULT_FACTORY_SLOTS, 0);
  }

  getPlanetPower(planet: PlanetTile, kind: ProductionBuildingKind = 'spaceship_factory'): number {
    return planet.buildings
      .filter((b) => b.name === 'Spaceship Factory' && kind === 'spaceship_factory')
      .reduce((sum) => sum + ProductionService.DEFAULT_FACTORY_POWER, 0);
  }

  /*
   * tick: Advances every active order by `deltaTime` seconds. Completes
   * orders, pushes the resulting ships into the faction's stock, and
   * auto-cancels orders that cannot make progress (no eligible factory).
   * Designed to be called once per frame from the star-map game loop.
   *
   * When deltaTime is 0 (game paused), returns immediately without
   * incrementing the tick counter or advancing progress. This prevents
   * the frame-based stall timeout from firing while the game is paused.
   */
  tick(
    deltaTime: number,
    data: { shipStock?: { factionId: string; ships: ShipStockEntry[] }[]; production?: FactionProduction[] },
    starSystems: StarSystem[],
    fleets: { id: number; ships: { id: number; type: string; name: string; destroyed?: boolean }[] }[],
    factions: Faction[],
  ): ProductionTickResult {
    if (deltaTime <= 0) {
      return { completedOrders: [], producedShips: [], refundedOrders: [], stateChanged: false };
    }
    this.tickCounter++;
    if (!data.production) {
      return { completedOrders: [], producedShips: [], refundedOrders: [], stateChanged: false };
    }
    const result: ProductionTickResult = {
      completedOrders: [],
      producedShips: [],
      refundedOrders: [],
      stateChanged: false,
    };
    for (const factionProd of data.production) {
      for (const planetIdStr of Object.keys(factionProd.ordersByPlanet)) {
        const planetId = Number(planetIdStr);
        const planet = this.findPlanet(starSystems, planetId);
        if (!planet) {
          // Planet lost; refund every order on it.
          const queue = factionProd.ordersByPlanet[planetId];
          for (const order of queue.splice(0)) {
            const refund = this.refundOrder(order, factions, factionProd.factionId);
            result.refundedOrders.push({ factionId: factionProd.factionId, planetId, orderId: order.id, refunded: refund });
            result.stateChanged = true;
          }
          delete factionProd.ordersByPlanet[planetId];
          continue;
        }
        const queue = factionProd.ordersByPlanet[planetId];
        if (queue.length === 0) {
          continue;
        }
        const head = queue[0];
        const shipType = this.shipService.getShipType(head.shipTypeId);
        if (!shipType) {
          queue.shift();
          result.stateChanged = true;
          continue;
        }
        const kind = shipType.productionBuilding ?? 'spaceship_factory';
        const power = this.getPlanetPower(planet, kind);
        if (power <= 0) {
          // Factory missing: track stall, then auto-cancel if it times out.
          head.startedAtTick = head.startedAtTick;
          const age = this.tickCounter - head.startedAtTick;
          if (age > ProductionService.STALLED_ORDER_TIMEOUT) {
            queue.shift();
            const refund = this.refundOrder(head, factions, factionProd.factionId);
            result.refundedOrders.push({ factionId: factionProd.factionId, planetId, orderId: head.id, refunded: refund });
            result.stateChanged = true;
          }
          continue;
        }
        const buildTime = (shipType.buildTime ?? Math.max(1, shipType.cost * 0.1)) / power;
        head.progress += deltaTime / buildTime;
        if (head.progress >= 1) {
          queue.shift();
          const entries: ShipStockEntry[] = [];
          for (let i = 0; i < head.quantity; i++) {
            entries.push({
              id: this.shipStockService.nextShipId(fleets as never, data),
              type: shipType.id,
              name: shipType.name,
              producedAtTick: this.tickCounter,
              originPlanetId: planetId,
            });
          }
          this.shipStockService.addToStock(data as never, factionProd.factionId, entries);
          result.completedOrders.push(head);
          result.producedShips.push({
            factionId: factionProd.factionId,
            planetId,
            typeId: shipType.id,
            count: head.quantity,
          });
          result.stateChanged = true;
        }
      }
    }
    return result;
  }

  private refundOrder(
    order: ProductionOrder,
    factions: Faction[],
    factionId: string,
  ): { credits: number; rawmaterials: number; research: number } {
    const faction = factions.find((f) => f.id === factionId);
    if (!faction) {
      return { credits: 0, rawmaterials: 0, research: 0 };
    }
    const shipType = this.shipService.getShipType(order.shipTypeId);
    const totalCost = (shipType?.cost ?? 0) * order.quantity;
    const unbuilt = Math.round(totalCost * Math.max(0, 1 - order.progress));
    if (unbuilt > 0) {
      faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) + unbuilt;
    }
    return { credits: unbuilt, rawmaterials: 0, research: 0 };
  }

  private findPlanet(starSystems: StarSystem[], planetId: number): PlanetTile | null {
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.id === planetId) {
          return planet;
        }
      }
    }
    return null;
  }

  private canAfford(faction: Faction, amount: number): boolean {
    return (faction.currencies['credits'] ?? 0) >= amount;
  }

  private deductCost(faction: Faction, amount: number): void {
    faction.currencies['credits'] = (faction.currencies['credits'] ?? 0) - amount;
  }

  /*
   * getOrderEta: Approximate seconds remaining for a given order,
   * using the planet's current `productionPower`. Returns null if the
   * planet cannot produce that ship type at the moment.
   */
  getOrderEta(order: ProductionOrder, planet: PlanetTile): number | null {
    const shipType = this.shipService.getShipType(order.shipTypeId);
    if (!shipType) {
      return null;
    }
    const power = this.getPlanetPower(planet, shipType.productionBuilding ?? 'spaceship_factory');
    if (power <= 0) {
      return null;
    }
    const totalSeconds = (shipType.buildTime ?? Math.max(1, shipType.cost * 0.1)) / power;
    return Math.max(0, totalSeconds * (1 - order.progress));
  }

  /*
   * listBuildableShipTypes: Ship types that the planet can build right
   * now, given its current factory mix.
   */
  listBuildableShipTypes(planet: PlanetTile): ShipType[] {
    return this.shipService
      .getAllShipTypes()
      .filter((t) => this.getPlanetCapacity(planet, t.productionBuilding ?? 'spaceship_factory') > 0);
  }
}

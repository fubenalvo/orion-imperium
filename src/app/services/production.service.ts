import { Injectable, Optional } from '@angular/core';
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
import { ResourceCost, payCost, refundCost, scaleCost, shipCost } from './resource-cost';
import { ResearchService } from './research.service';

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
 * Resource cost (credits + raw materials, see resource-cost.ts) is
 * deducted in full at queue time and recorded on the order as `paid`.
 * That is the only charge: completion pushes ships into the stock for
 * free, and assembling fleets from the stock never charges again. A
 * cancel or auto-cancel (factory lost, planet lost, unknown type) refunds
 * the un-built fraction of `paid`, so a refund can never exceed the
 * original charge. A failed queue attempt changes nothing.
 */
@Injectable({ providedIn: 'root' })
export class ProductionService {
  private static readonly STALLED_ORDER_TIMEOUT = 30;
  private static readonly DEFAULT_FACTORY_POWER = 0.5;
  private static readonly DEFAULT_FACTORY_SLOTS = 1;

  private orderIdCounter = 1;
  private tickCounter = 0;

  private readonly research: ResearchService;

  constructor(
    private shipService: ShipService,
    private shipStockService: ShipStockService,
    @Optional() research?: ResearchService,
  ) {
    this.research = research ?? new ResearchService();
  }

  /*
   * Effective production power for a faction: factory power × the owner's
   * shipBuildSpeed technology multiplier. Progress already made is kept;
   * a new technology only speeds up the remaining work.
   */
  getEffectivePower(planet: PlanetTile, kind: ProductionBuildingKind, faction: Faction | null | undefined): number {
    return this.getPlanetPower(planet, kind) * this.research.getModifiers(faction).shipBuildSpeed;
  }

  /*
   * rebaseFromSave: Resynchronizes the in-memory id/tick counters with a
   * freshly loaded save. Without this, a browser refresh resets both to 0
   * while persisted orders carry large absolute startedAtTick values
   * (negative stall ages) and newly queued orders collide with persisted
   * order ids.
   */
  rebaseFromSave(production: FactionProduction[] | undefined): void {
    let maxOrderId = 0;
    let maxStartedAtTick = 0;
    for (const factionProd of production ?? []) {
      for (const orders of Object.values(factionProd.ordersByPlanet ?? {})) {
        for (const order of orders ?? []) {
          if (typeof order.id === 'number' && Number.isFinite(order.id)) {
            maxOrderId = Math.max(maxOrderId, order.id);
          }
          if (typeof order.startedAtTick === 'number' && Number.isFinite(order.startedAtTick)) {
            maxStartedAtTick = Math.max(maxStartedAtTick, order.startedAtTick);
          }
        }
      }
    }
    this.orderIdCounter = Math.max(1, maxOrderId + 1);
    this.tickCounter = Math.max(0, maxStartedAtTick);
  }

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
    const totalCost = shipCost(shipType, quantity);
    if (!payCost(faction, totalCost)) {
      return { ok: false, reason: 'insufficient_resources' };
    }

    const order: ProductionOrder = {
      id: this.orderIdCounter++,
      shipTypeId,
      quantity,
      progress: 0,
      startedAtTick: this.tickCounter,
      paid: totalCost,
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
    const refund = this.refundOrder(order, factions, factionId);
    return { ok: true, refunded: refund };
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
        // Planet gone or no longer owned by this faction (e.g. an order left
        // over in a save written before PlanetOwnershipService cancelled orders
        // on capture): refund every order instead of building for the loser.
        if (!planet || planet.factionId !== factionProd.factionId) {
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
          // Unknown/removed ship type: refund rather than silently dropping
          // the order (and the credits paid up front for it).
          queue.shift();
          const refund = this.refundOrder(head, factions, factionProd.factionId);
          result.refundedOrders.push({ factionId: factionProd.factionId, planetId, orderId: head.id, refunded: refund });
          result.stateChanged = true;
          continue;
        }
        const kind = shipType.productionBuilding ?? 'spaceship_factory';
        const power = this.getEffectivePower(planet, kind, factions.find((f) => f.id === factionProd.factionId));
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
    const unbuilt = scaleCost(this.getPaidCost(order), 1 - order.progress);
    refundCost(faction, unbuilt);
    return { credits: unbuilt.credits, rawmaterials: unbuilt.rawmaterials, research: 0 };
  }

  /*
   * getPaidCost: What the order was charged. Orders queued before
   * raw-material costs existed (legacy saves) have no `paid` record and
   * were charged credits only.
   */
  getPaidCost(order: ProductionOrder): ResourceCost {
    const paid = order.paid;
    // A malformed record (hand-edited or corrupt save) falls back to the legacy rule.
    if (paid && Number.isFinite(paid.credits) && Number.isFinite(paid.rawmaterials)) {
      return { credits: Math.max(0, paid.credits), rawmaterials: Math.max(0, paid.rawmaterials) };
    }
    const shipType = this.shipService.getShipType(order.shipTypeId);
    return { credits: (shipType?.cost ?? 0) * order.quantity, rawmaterials: 0 };
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

  /*
   * getOrderEta: Approximate seconds remaining for a given order,
   * using the planet's current `productionPower`. Returns null if the
   * planet cannot produce that ship type at the moment.
   */
  getOrderEta(order: ProductionOrder, planet: PlanetTile, faction?: Faction | null): number | null {
    const shipType = this.shipService.getShipType(order.shipTypeId);
    if (!shipType) {
      return null;
    }
    const power = this.getEffectivePower(planet, shipType.productionBuilding ?? 'spaceship_factory', faction);
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

import { TestBed } from '@angular/core/testing';
import { ProductionService } from './production.service';
import { ShipStockService } from './ship-stock.service';
import { Faction, FactionProduction, ShipStockEntry, StarSystem } from '../components/star-map/star-map.models';

describe('ProductionService — save rebasing', () => {
  let service: ProductionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ProductionService);
  });

  const faction = (): Faction => ({
    id: 'player',
    name: 'Player',
    color: '#8cc4ff',
    team: 1,
    ai: false,
    currencies: { credits: 1000, rawmaterials: 1000, research: 500 },
  });

  const planetSystem = (): StarSystem[] => [
    {
      id: 'sol',
      name: 'Sol',
      x: 1,
      y: 1,
      planets: 1,
      color: '#fff',
      planetsTiles: [
        {
          id: 5,
          index: 0,
          name: 'Terra',
          factionId: 'player',
          x: 1,
          y: 1,
          type: 'earthlike',
          size: 'medium',
          population: 100,
          buildings: [{ id: 'b1', name: 'Spaceship Factory', size: 2, x: 0, y: 0 }],
          explored: true,
        },
      ],
      explored: true,
    },
  ];

  it('rebases order ids and tick counter from loaded production data', () => {
    const production: FactionProduction[] = [
      {
        factionId: 'player',
        ordersByPlanet: {
          5: [{ id: 7, shipTypeId: 'fighter', quantity: 1, progress: 0, startedAtTick: 120 }],
        },
      },
    ];
    service.rebaseFromSave(production);

    const data: { production: FactionProduction[] } = { production: [] };
    const result = service.queueOrder(data, 'player', 5, 'fighter', 1, planetSystem(), [faction()]);

    expect(result.ok).toBe(true);
    expect(result.order?.id).toBe(8);
  });

  it('refunds queued orders whose ship type no longer exists', () => {
    const factions = [faction()];
    const data: { production: FactionProduction[] } = {
      production: [
        {
          factionId: 'player',
          ordersByPlanet: {
            5: [{ id: 3, shipTypeId: 'ship_that_does_not_exist', quantity: 2, progress: 0, startedAtTick: 0 }],
          },
        },
      ],
    };
    service.rebaseFromSave(data.production);

    const result = service.tick(1, data, planetSystem(), [], factions);

    expect(result.refundedOrders).toHaveLength(1);
    expect(data.production[0].ordersByPlanet[5]).toHaveLength(0);
    expect(result.stateChanged).toBe(true);
  });

  it('gives every ship of a multi-ship order its own id', () => {
    const data: { production: FactionProduction[]; shipStock: { factionId: string; ships: ShipStockEntry[] }[] } = {
      production: [
        {
          factionId: 'player',
          ordersByPlanet: { 5: [{ id: 1, shipTypeId: 'fighter', quantity: 3, progress: 0.999, startedAtTick: 0 }] },
        },
      ],
      shipStock: [],
    };
    // No rebaseFromSave here: it would split the batch. This covers an
    // unsplit multi-ship order still reaching tick (defensive path).
    const fleets = [{ id: 1, ships: [{ id: 40, type: 'fighter', name: 'Ship' }] }];

    const result = service.tick(100000, data, planetSystem(), fleets, [faction()]);

    expect(result.completedOrders).toHaveLength(1);
    expect(data.shipStock[0].ships.map((s) => s.id)).toEqual([41, 42, 43]);
  });

  describe('build time scales with quantity', () => {
    type Data = { production: FactionProduction[]; shipStock: { factionId: string; ships: ShipStockEntry[] }[] };
    const freshData = (): Data => ({ production: [], shipStock: [] });
    const rich = (): Faction => ({ ...faction(), currencies: { credits: 1e6, rawmaterials: 1e6, research: 0 } });
    const stockCount = (data: Data) => data.shipStock[0]?.ships.length ?? 0;

    /* Ticks in 0.1 s steps until `want` ships reached the stock; returns elapsed seconds. */
    const runUntil = (data: Data, want: number, factions: Faction[]): number => {
      let t = 0;
      while (stockCount(data) < want && t < 10000) {
        service.tick(0.1, data, planetSystem(), [], factions);
        t += 0.1;
      }
      return t;
    };

    it('queues one single-ship order per requested ship and charges the full price once', () => {
      const f = rich();
      const data = freshData();
      const result = service.queueOrder(data, 'player', 5, 'fighter', 5, planetSystem(), [f]);
      const queue = data.production[0].ordersByPlanet[5];

      expect(result.ok).toBe(true);
      expect(result.orders).toHaveLength(5);
      expect(queue).toHaveLength(5);
      expect(queue.every((o) => o.quantity === 1)).toBe(true);
      expect(new Set(queue.map((o) => o.id)).size).toBe(5);
      const paidCredits = queue.reduce((sum, o) => sum + o.paid!.credits, 0);
      expect(1e6 - f.currencies['credits']).toBe(paidCredits);
    });

    it('5 ships take 5x as long as 1 ship and arrive one by one', () => {
      const one = freshData();
      service.queueOrder(one, 'player', 5, 'fighter', 1, planetSystem(), [rich()]);
      const t1 = runUntil(one, 1, [rich()]);

      const five = freshData();
      service.queueOrder(five, 'player', 5, 'fighter', 5, planetSystem(), [rich()]);
      const tFirst = runUntil(five, 1, [rich()]);
      const t5 = tFirst + runUntil(five, 5, [rich()]);

      expect(tFirst).toBeCloseTo(t1, 0);
      expect(t5 / t1).toBeCloseTo(5, 1);
    });

    it('cancelling after half the ships refunds only the unbuilt ones', () => {
      const f = rich();
      const data = freshData();
      service.queueOrder(data, 'player', 5, 'fighter', 4, planetSystem(), [f]);
      const unit = data.production[0].ordersByPlanet[5][0].paid!.credits;
      runUntil(data, 2, [f]);
      const before = f.currencies['credits'];

      for (const order of [...data.production[0].ordersByPlanet[5]]) {
        service.cancelOrder(data, 'player', 5, order.id, [f]);
      }

      expect(stockCount(data)).toBe(2);
      // The next unit may have made a sliver of progress (refund is proportional).
      expect(f.currencies['credits'] - before).toBeGreaterThan(unit * 1.9);
      expect(f.currencies['credits'] - before).toBeLessThanOrEqual(unit * 2);
    });

    it('remaining-time estimate covers every queued ship', () => {
      const data = freshData();
      service.queueOrder(data, 'player', 5, 'fighter', 3, planetSystem(), [rich()]);
      const planet = planetSystem()[0].planetsTiles[0];
      const queue = data.production[0].ordersByPlanet[5];
      const etas = queue.map((o) => service.getOrderEta(o, planet)!);
      const first = { ...queue[0] };
      const t3 = runUntil(data, 3, [rich()]);

      expect(etas[0] * 3).toBeCloseTo(t3, 0);
      // A legacy batch order estimates its whole quantity.
      expect(service.getOrderEta({ ...first, quantity: 3 }, planet)).toBeCloseTo(etas[0] * 3, 5);
    });

    it('splits a legacy multi-ship order on load without losing ships or paid resources', () => {
      const production: FactionProduction[] = [
        {
          factionId: 'player',
          ordersByPlanet: {
            5: [
              { id: 4, shipTypeId: 'fighter', quantity: 3, progress: 0.5, startedAtTick: 10, paid: { credits: 301, rawmaterials: 31 } },
              { id: 9, shipTypeId: 'fighter', quantity: 1, progress: 0, startedAtTick: 10 },
            ],
          },
        },
      ];
      service.rebaseFromSave(production);
      const queue = production[0].ordersByPlanet[5];

      expect(queue.map((o) => o.quantity)).toEqual([1, 1, 1, 1]);
      expect(queue.map((o) => o.progress)).toEqual([0.5, 0, 0, 0]);
      expect(queue[0].id).toBe(4);
      expect(queue[3].id).toBe(9);
      expect(new Set(queue.map((o) => o.id)).size).toBe(4);
      expect(queue.slice(0, 3).reduce((s, o) => s + o.paid!.credits, 0)).toBe(301);
      expect(queue.slice(0, 3).reduce((s, o) => s + o.paid!.rawmaterials, 0)).toBe(31);

      const data = { production: [] as FactionProduction[] };
      const next = service.queueOrder(data, 'player', 5, 'fighter', 1, planetSystem(), [rich()]);
      expect(next.order!.id).toBeGreaterThan(Math.max(...queue.map((o) => o.id)));
    });
  });
});

describe('ShipStockService.repairDuplicateShipIds', () => {
  it('keeps the first occurrence and renumbers later duplicates above the maximum', () => {
    const data = {
      fleets: [{ ships: [{ id: 5 }, { id: 7 }] }] as never,
      shipStock: [{ factionId: 'player', ships: [{ id: 7 }, { id: 7 }, { id: 2 }] }] as never,
    };

    expect(ShipStockService.repairDuplicateShipIds(data)).toBe(2);
    const ids = [...(data.fleets as any)[0].ships, ...(data.shipStock as any)[0].ships].map((s: { id: number }) => s.id);
    expect(ids).toEqual([5, 7, 8, 9, 2]);
    // Idempotent.
    expect(ShipStockService.repairDuplicateShipIds(data)).toBe(0);
  });

});

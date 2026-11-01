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
    service.rebaseFromSave(data.production);
    const fleets = [{ id: 1, ships: [{ id: 40, type: 'fighter', name: 'Ship' }] }];

    const result = service.tick(1000, data, planetSystem(), fleets, [faction()]);

    expect(result.completedOrders).toHaveLength(1);
    expect(data.shipStock[0].ships.map((s) => s.id)).toEqual([41, 42, 43]);
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
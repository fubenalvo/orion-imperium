import { TestBed } from '@angular/core/testing';
import { ProductionService } from './production.service';
import { Faction, FactionProduction, StarSystem } from '../components/star-map/star-map.models';

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
});
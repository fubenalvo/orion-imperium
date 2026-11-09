import { describe, it, expect } from 'vitest';
import { StarMapMovementService } from './star-map-movement.service';
import { Fleet, FleetShip } from './star-map.models';
import { ShipLoadout } from './equipment';
import { SYSTEM_SPEED_FACTOR } from './system-grid';

/*
 * Phase 4 of docs/ship-equipment.md: engines change map speed. A fleet
 * moves at its stored base speed plus the lowest engine bonus among its
 * living ships; with standard engines nothing changes.
 */

const DT = 1 / 60;

const ship = (id: number, type: string, equipment?: ShipLoadout, destroyed = false): FleetShip => ({
  id,
  name: 'Ship',
  type,
  ...(equipment ? { equipment } : {}),
  ...(destroyed ? { destroyed } : {}),
});

const galaxyFleet = (ships: FleetShip[], speed = 4): Fleet => ({
  id: 1,
  name: 'F',
  factionId: 'player',
  x: 10,
  y: 10,
  targetX: 200,
  targetY: 10,
  speed,
  system: null,
  ships,
});

const createService = (): StarMapMovementService => {
  const service = new StarMapMovementService();
  service.initialize(2, 2, 300, 180);
  return service;
};

const advance = (service: StarMapMovementService, fleets: Fleet[], seconds: number, view: 'map' | 'system' = 'map'): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    service.updateFleets(fleets, [], null, view, DT, () => {}, () => {});
  }
};

const WARP: ShipLoadout = { engine: 'warp_drive' };
const ION: ShipLoadout = { engine: 'ion_engine' };

describe('map speed with engines', () => {
  it('keeps the old rate for standard engines and for callers without ships', () => {
    const standard = galaxyFleet([ship(1, 'cruiser'), ship(2, 'fighter', { weapon: 'railgun' })]);
    expect(StarMapMovementService.galaxyCellsPerSecond(standard)).toBe(4 / 10 / 2);
    expect(StarMapMovementService.galaxyCellsPerSecond({ speed: 4 })).toBe(4 / 10 / 2);
  });

  it('moves a fully warp-fitted fleet at base + 1 across the galaxy', () => {
    const plain = galaxyFleet([ship(1, 'cruiser'), ship(2, 'cruiser')]);
    const warp = galaxyFleet([ship(1, 'cruiser', WARP), ship(2, 'cruiser', WARP)]);
    advance(createService(), [plain], 60);
    advance(createService(), [warp], 60);
    // 4 / 10 / 2 = 0.2 cells/s → 12 cells; 5 / 10 / 2 = 0.25 cells/s → 15 cells.
    expect(plain.x - 10).toBeCloseTo(12, 6);
    expect(warp.x - 10).toBeCloseTo(15, 6);
  });

  it('is held back by the slowest engine, and speeds up when that ship is gone', () => {
    const mixed = galaxyFleet([ship(1, 'cruiser', WARP), ship(2, 'cruiser', ION)]);
    expect(StarMapMovementService.galaxyCellsPerSecond(mixed)).toBeCloseTo(4.5 / 10 / 2, 10);
    const withStandard = galaxyFleet([ship(1, 'cruiser', WARP), ship(2, 'fighter')]);
    expect(StarMapMovementService.galaxyCellsPerSecond(withStandard)).toBe(4 / 10 / 2);
    withStandard.ships[1].destroyed = true;
    expect(StarMapMovementService.galaxyCellsPerSecond(withStandard)).toBeCloseTo(5 / 10 / 2, 10);
  });

  it('adds the bonus to the stored base of starting fleets as well', () => {
    expect(StarMapMovementService.galaxyCellsPerSecond(galaxyFleet([ship(1, 'scout', WARP)], 8))).toBeCloseTo(9 / 10 / 2, 10);
  });

  it('includes the engines in the remaining-travel estimate', () => {
    const service = createService();
    const plain = galaxyFleet([ship(1, 'cruiser')]);
    const warp = galaxyFleet([ship(1, 'cruiser', WARP)]);
    advance(service, [plain, warp], DT); // plans both routes
    const plainEta = service.estimateRemainingTravelSeconds(plain)!;
    const warpEta = service.estimateRemainingTravelSeconds(warp)!;
    expect(warpEta / plainEta).toBeCloseTo(4 / 5, 2);
  });

  it('moves faster inside a star system too', () => {
    const inSystem = (ships: FleetShip[]): Fleet => ({
      ...galaxyFleet(ships),
      targetX: null,
      targetY: null,
      system: { id: 'sol', x: 5, y: 5, targetX: 80, targetY: 5 },
    });
    const plain = inSystem([ship(1, 'cruiser')]);
    const warp = inSystem([ship(1, 'cruiser', WARP)]);
    advance(createService(), [plain, warp], 2, 'system');
    // In-system speed is vw/s × SYSTEM_SPEED_FACTOR (0.5): 4 → 4 vw in 2 s, 5 → 5 vw.
    expect(plain.system!.x - 5).toBeCloseTo(8 * SYSTEM_SPEED_FACTOR, 6);
    expect(warp.system!.x - 5).toBeCloseTo(10 * SYSTEM_SPEED_FACTOR, 6);
  });
});

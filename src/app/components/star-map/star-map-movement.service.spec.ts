import { StarMapMovementService } from './star-map-movement.service';
import { Fleet } from './star-map.models';

/*
 * Regression: galaxy fleet movement used the *rendered* cell size
 * (cellSizeVw: 2 on desktop, 3.5 below the 1300px breakpoint) to convert
 * speed to cells/s, so fleets were ~43% slower on narrow windows and a
 * window resize changed travel speed mid-game. Movement must depend only
 * on fleet speed and game time.
 */
describe('StarMapMovementService galaxy movement', () => {
  const DESKTOP_CELL_VW = 2;
  const MOBILE_CELL_VW = 3.5;
  const DT = 1 / 60;

  const fleet = (id: number, speed: number): Fleet => ({
    id,
    name: `F${id}`,
    factionId: 'player',
    x: 10,
    y: 10,
    targetX: 200,
    targetY: 10,
    speed,
    system: null,
    ships: [],
  });

  const createService = (cellSizeVw: number): StarMapMovementService => {
    const service = new StarMapMovementService();
    service.initialize(cellSizeVw, cellSizeVw, 300, 180);
    return service;
  };

  const advance = (service: StarMapMovementService, fleets: Fleet[], seconds: number, dt = DT): void => {
    const frames = Math.round(seconds / dt);
    for (let i = 0; i < frames; i++) {
      service.updateFleets(fleets, [], null, 'map', dt, () => {}, () => {});
    }
  };

  it('moves a fleet the same distance at desktop and mobile cell sizes', () => {
    const desktopFleet = fleet(1, 3);
    const mobileFleet = fleet(1, 3);
    advance(createService(DESKTOP_CELL_VW), [desktopFleet], 60);
    advance(createService(MOBILE_CELL_VW), [mobileFleet], 60);

    expect(mobileFleet.x).toBeCloseTo(desktopFleet.x, 6);
    expect(mobileFleet.y).toBeCloseTo(desktopFleet.y, 6);
  });

  it('keeps the desktop travel rate: speed / 10 / 2 cells per second', () => {
    const f = fleet(1, 4);
    advance(createService(DESKTOP_CELL_VW), [f], 60);
    // 4 / 10 / 2 = 0.2 cells/s → 12 cells in 60 s (the rate AI reach and timeouts assume).
    expect(f.x - 10).toBeCloseTo(12, 6);
  });

  it('does not change speed when the viewport is resized mid-journey', () => {
    const service = createService(DESKTOP_CELL_VW);
    const resized = fleet(1, 3);
    const reference = fleet(2, 3);
    advance(service, [resized, reference], 30);
    // StarMap.onResize re-initializes the shared service with the new render size.
    service.initialize(MOBILE_CELL_VW, MOBILE_CELL_VW, 300, 180);
    advance(service, [resized], 30);
    advance(createService(DESKTOP_CELL_VW), [reference], 30);

    expect(resized.x).toBeCloseTo(reference.x, 6);
    expect(resized.x - 10).toBeCloseTo(0.15 * 60, 6);
  });

  it('preserves relative ship speeds and game-speed scaling', () => {
    const slow = fleet(1, 1);
    const fast = fleet(2, 5);
    advance(createService(MOBILE_CELL_VW), [slow, fast], 40);
    expect((fast.x - 10) / (slow.x - 10)).toBeCloseTo(5, 6);

    // Speed 2x = twice the scaled game delta per real frame (GameTimeService).
    const normal = fleet(3, 3);
    const doubled = fleet(4, 3);
    advance(createService(MOBILE_CELL_VW), [normal], 20, DT);
    advance(createService(MOBILE_CELL_VW), [doubled], 40, DT * 2);
    expect(doubled.x - 10).toBeCloseTo(2 * (normal.x - 10), 6);
  });
});

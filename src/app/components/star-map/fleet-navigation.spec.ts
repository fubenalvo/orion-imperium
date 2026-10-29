import { TestBed } from '@angular/core/testing';
import {
  BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS,
  NavObstacle,
  NavPoint,
  buildNavObstacles,
  distance,
  distanceToSegment,
  planRoute,
  routeLength,
} from './fleet-navigation';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';
import { Fleet, SpecialObject } from './star-map.models';
import { blackHoleObject } from '../../services/galaxy-generator.service';

/*
 * Black holes as navigation obstacles (docs/star-map-terrain.md): routes
 * avoid the no-fly disc, movement never enters it, player and AI fleets
 * are routed by the same code, and unreachable targets fail safely.
 */
describe('fleet navigation (black hole obstacles)', () => {
  const hole: NavObstacle = { x: 50, y: 50, radius: 5 };

  // Every leg of the path start → waypoints → end must stay out of the disc.
  const assertClear = (
    from: NavPoint,
    waypoints: NavPoint[],
    to: NavPoint,
    obstacles: NavObstacle[],
  ) => {
    const points = [from, ...waypoints, to];
    for (let i = 1; i < points.length; i++) {
      for (const o of obstacles) {
        expect(distanceToSegment(o, points[i - 1], points[i])).toBeGreaterThanOrEqual(
          o.radius - 1e-6,
        );
      }
    }
  };

  it('flies straight when the direct line misses the black hole', () => {
    const plan = planRoute({ x: 10, y: 10 }, { x: 90, y: 10 }, [hole]);
    expect(plan).toEqual({ ok: true, waypoints: [] });
  });

  it('reroutes a direct line that crosses the black hole around its no-fly radius', () => {
    const from = { x: 20, y: 50 };
    const to = { x: 80, y: 50 };
    const plan = planRoute(from, to, [hole], { width: 100, height: 100 });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.waypoints.length).toBeGreaterThan(0);
    assertClear(from, plan.waypoints, to, [hole]);
    // A detour, but not an absurd one (straight line is 60).
    expect(routeLength(from, plan.waypoints, to)).toBeLessThan(70);
  });

  it('rejects a route that only grazes the radius, not just the center', () => {
    // The line passes 3 cells from the center: outside the center point but
    // inside the radius-5 disc, so it must be rerouted.
    const from = { x: 20, y: 53 };
    const to = { x: 80, y: 53 };
    const plan = planRoute(from, to, [hole]);
    expect(plan.ok && plan.waypoints.length > 0).toBe(true);
    if (plan.ok) assertClear(from, plan.waypoints, to, [hole]);
  });

  it('rejects a destination inside the black hole', () => {
    expect(planRoute({ x: 10, y: 10 }, { x: 51, y: 49 }, [hole])).toEqual({
      ok: false,
      reason: 'target_blocked',
    });
  });

  it('reports no_route when obstacles wall off the destination', () => {
    // Two overlapping discs close the whole 20×10 map at x = 10.
    const wall: NavObstacle[] = [
      { x: 10, y: 2, radius: 5 },
      { x: 10, y: 8, radius: 5 },
    ];
    expect(planRoute({ x: 2, y: 5 }, { x: 18, y: 5 }, wall, { width: 20, height: 10 })).toEqual({
      ok: false,
      reason: 'no_route',
    });
  });

  it('lets a fleet that starts inside an obstacle (legacy save) leave it', () => {
    const plan = planRoute({ x: 50, y: 51 }, { x: 90, y: 90 }, [hole]);
    expect(plan.ok).toBe(true);
  });

  it('derives the obstacle from the generated black hole special object', () => {
    const obj: SpecialObject = blackHoleObject(180, 108);
    const [obstacle] = buildNavObstacles([obj]);
    expect(obstacle.x).toBe(90.5);
    expect(obstacle.y).toBe(54.5);
    expect(obstacle.radius).toBe(BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS);
    expect(buildNavObstacles([{ ...obj, navigationRadius: 7 }])[0].radius).toBe(7);
    expect(buildNavObstacles([{ ...obj, type: 'nebula-ish' }])).toEqual([]);
  });
});

describe('StarMapMovementService routing around black holes', () => {
  let movement: StarMapMovementService;
  let terrain: StarMapTerrainService;
  const bh = blackHoleObject(180, 108);
  const [obstacle] = buildNavObstacles([bh]);

  const fleet = (
    id: number,
    factionId: string,
    x: number,
    y: number,
    targetX: number,
    targetY: number,
  ): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX,
    targetY,
    speed: 8,
    system: null,
    ships: [{ id, name: 's', type: 'frigate' }],
  });

  /* Runs the movement loop, asserting the no-fly zone is never entered. */
  const fly = (fleets: Fleet[], seconds: number, onBlocked?: (id: number) => void): number => {
    const dt = 0.1;
    let minDistance = Infinity;
    for (let t = 0; t < seconds; t += dt) {
      movement.updateFleets(
        fleets,
        [],
        null,
        'map',
        dt,
        () => {},
        () => {},
        onBlocked,
      );
      for (const f of fleets) {
        minDistance = Math.min(minDistance, distance(f, obstacle));
      }
    }
    return minDistance;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    terrain = TestBed.inject(StarMapTerrainService);
    movement = TestBed.inject(StarMapMovementService);
    terrain.configure({ specialObjects: [bh], nebulae: [], width: 180, height: 108 });
    movement.initialize(2, 2, 180, 108);
  });

  it('takes player and AI fleets around the black hole to the opposite side', () => {
    const player = fleet(1, 'player', obstacle.x - 20, obstacle.y, obstacle.x + 20, obstacle.y);
    const ai = fleet(2, 'enemy1', obstacle.x + 20, obstacle.y + 1, obstacle.x - 20, obstacle.y - 1);

    const closest = fly([player, ai], 400);

    expect(closest).toBeGreaterThanOrEqual(obstacle.radius - 1e-6);
    for (const f of [player, ai]) {
      expect(f.targetX).toBeNull();
    }
    expect([player.x, player.y]).toEqual([obstacle.x + 20, obstacle.y]);
    expect([ai.x, ai.y]).toEqual([obstacle.x - 20, obstacle.y - 1]);
  });

  it('re-plans an existing straight order (e.g. from an old save) instead of crossing', () => {
    const f = fleet(1, 'player', obstacle.x, obstacle.y - 15, obstacle.x, obstacle.y + 15);
    expect(fly([f], 300)).toBeGreaterThanOrEqual(obstacle.radius - 1e-6);
    expect([f.x, f.y]).toEqual([obstacle.x, obstacle.y + 15]);
  });

  it('keeps a fleet in place and reports it when the destination is inside the black hole', () => {
    const f = fleet(1, 'enemy1', 30, 30, obstacle.x, obstacle.y);
    const blocked: number[] = [];
    fly([f], 5, (id) => blocked.push(id));

    expect([f.x, f.y]).toEqual([30, 30]);
    expect(f.targetX).toBeNull();
    expect(f.targetY).toBeNull();
    expect(blocked).toEqual([1]);
  });

  it('renders the trail along the route legs, matching the flown path', () => {
    const f = fleet(1, 'player', obstacle.x - 20, obstacle.y, obstacle.x + 20, obstacle.y);
    const segments = movement.getGalaxyTrailSegmentsVw(f);
    const waypoints = movement.getActiveRoute(f)!.waypoints;

    expect(segments.length).toBe(waypoints.length + 1);
    expect(segments[0].x1).toBeCloseTo((f.x - 0.5) * 2, 6);
    expect(segments[segments.length - 1].x2).toBeCloseTo((obstacle.x + 20 - 0.5) * 2, 6);
  });

  it('estimates the detour in the travel time', () => {
    const from = { x: obstacle.x - 20, y: obstacle.y };
    const to = { x: obstacle.x + 20, y: obstacle.y };
    const speed = 0.4;
    const estimate = movement.estimateTravelSeconds(from, to, speed);
    expect(estimate).toBeGreaterThan(40 / speed);
    expect(movement.estimateTravelSeconds(from, { x: obstacle.x, y: obstacle.y }, speed)).toBe(
      Infinity,
    );
  });

  it('leaves movement unchanged in open space (no obstacles configured)', () => {
    terrain.reset();
    const f = fleet(1, 'player', 10, 10, 50, 10);
    movement.updateFleets(
      [f],
      [],
      null,
      'map',
      10,
      () => {},
      () => {},
    );
    // 8 / 10 / 2 = 0.4 cells/s → 4 cells in 10 s.
    expect(f.x).toBeCloseTo(14, 6);
  });
});

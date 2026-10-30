import { TestBed } from '@angular/core/testing';
import {
  ASTEROID_BELT_CONFIG,
  areSystemsConnected,
  beltAxisDistance,
  beltLength,
  beltNavigationRadius,
  beltObstacles,
  buildBeltFragments,
  buildBeltView,
  isWellFormedBelt,
} from './asteroid-belts';
import {
  NavGraph,
  NavPoint,
  buildNavObstacles,
  distance,
  distanceToSegment,
} from './fleet-navigation';
import { AsteroidBelt, Fleet } from './star-map.models';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { validateGeneratedGalaxy } from '../../services/galaxy-validation';
import { NewGameConfig } from '../../services/new-game.models';
import { GalaxySize } from './star-map.models';

const configFor = (galaxySize: GalaxySize, ais = 2): NewGameConfig => ({
  galaxySize,
  players: [
    { name: 'Human', color: '#8cc4ff', controller: 'human', difficulty: 'normal' },
    ...Array.from({ length: ais }, (_, i) => ({
      name: `Bot ${i}`,
      color: ['#d65757', '#39b8a8', '#b07cff', '#7bd66b', '#ff9a3c'][i],
      controller: 'ai' as const,
      difficulty: 'normal' as const,
    })),
  ],
});

/* A straight horizontal test belt from (x1, y) to (x2, y). */
const belt = (id: number, x1: number, x2: number, y: number, halfWidth = 1.5): AsteroidBelt => ({
  id,
  points: [
    { x: x1, y },
    { x: x2, y },
  ],
  halfWidth,
  visualSeed: id * 977,
});

describe('asteroid belt generation', () => {
  let generator: GalaxyGeneratorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    generator = TestBed.inject(GalaxyGeneratorService);
  });

  it('generates several well-formed belts with valid dimensions inside the map', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const data = generator.generate(configFor(size), 11);
      const belts = data.asteroidBelts!;
      expect(belts.length).toBe(ASTEROID_BELT_CONFIG.countBySize[size]);
      for (const b of belts) {
        expect(isWellFormedBelt(b)).toBe(true);
        expect(b.halfWidth).toBeGreaterThanOrEqual(ASTEROID_BELT_CONFIG.halfWidth.min - 0.01);
        expect(b.halfWidth).toBeLessThanOrEqual(ASTEROID_BELT_CONFIG.halfWidth.max + 0.01);
        expect(beltLength(b)).toBeGreaterThanOrEqual(
          data.map.width * ASTEROID_BELT_CONFIG.lengthFraction.min - 0.1,
        );
        for (const p of b.points) {
          // Ends keep a real passage to the border (no way around via the edge is cut off by accident).
          expect(p.x).toBeGreaterThan(ASTEROID_BELT_CONFIG.minPassage);
          expect(p.y).toBeGreaterThan(ASTEROID_BELT_CONFIG.minPassage);
          expect(p.x).toBeLessThan(data.map.width - ASTEROID_BELT_CONFIG.minPassage);
          expect(p.y).toBeLessThan(data.map.height - ASTEROID_BELT_CONFIG.minPassage);
        }
      }
    }
  });

  it('spreads belts over the map with different orientations', () => {
    const data = generator.generate(configFor('large', 4), 5);
    const belts = data.asteroidBelts!;
    const angles = belts.map((b) => {
      const a = b.points[0];
      const z = b.points[b.points.length - 1];
      return ((Math.atan2(z.y - a.y, z.x - a.x) * 180) / Math.PI + 180) % 180;
    });
    // Not all parallel: at least two orientations differ by ≥ 20°.
    const spread = Math.max(
      ...angles.flatMap((a) => angles.map((b) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)))),
    );
    expect(spread).toBeGreaterThanOrEqual(20);
    const centers = belts.map((b) => ({
      x: b.points.reduce((s, p) => s + p.x, 0) / b.points.length,
      y: b.points.reduce((s, p) => s + p.y, 0) / b.points.length,
    }));
    const xs = centers.map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(data.map.width * 0.25);
  });

  it('keeps every start playable: no system or fleet covered, every home reaches every system', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      for (let seed = 1; seed <= 15; seed++) {
        let data;
        try {
          data = generator.generate(configFor(size, size === 'small' ? 2 : 3), seed);
        } catch {
          continue;
        }
        const belts = data.asteroidBelts!;
        for (const b of belts) {
          for (const s of data.starSystems) {
            expect(beltAxisDistance(b, s)).toBeGreaterThan(
              beltNavigationRadius(b) + ASTEROID_BELT_CONFIG.systemClearance - 1e-6,
            );
          }
          for (const f of data.fleets) {
            expect(beltAxisDistance(b, f)).toBeGreaterThan(beltNavigationRadius(b));
          }
        }
        const homes = data.starSystems.filter((s) =>
          s.planetsTiles.some((p) => p.factionId === 'player' || p.factionId.startsWith('enemy')),
        );
        expect(
          areSystemsConnected(belts, {
            width: data.map.width,
            height: data.map.height,
            systems: data.starSystems,
            homes,
            obstacles: buildNavObstacles(data.specialObjects),
          }),
        ).toBe(true);
        expect(
          validateGeneratedGalaxy(data, configFor(size, size === 'small' ? 2 : 3)).errors,
        ).toEqual([]);
      }
    }
  });

  it('is deterministic for a seed and does not change systems, fleets or nebulae', () => {
    const a = generator.generate(configFor('medium'), 42);
    const b = generator.generate(configFor('medium'), 42);
    const c = generator.generate(configFor('medium'), 43);
    expect(a.asteroidBelts).toEqual(b.asteroidBelts);
    expect(a.asteroidBelts).not.toEqual(c.asteroidBelts);
    // Belts use their own rng stream: removing them would leave the rest identical.
    expect(a.starSystems).toEqual(b.starSystems);
  });

  it('builds fragments strictly inside the band so the barrier covers every rock', () => {
    const b: AsteroidBelt = {
      id: 1,
      points: [
        { x: 20, y: 20 },
        { x: 60, y: 30 },
        { x: 90, y: 22 },
      ],
      halfWidth: 1.6,
      visualSeed: 12345,
    };
    const fragments = buildBeltFragments(b);
    expect(fragments.length).toBeGreaterThan(50);
    expect(fragments.length).toBeLessThanOrEqual(ASTEROID_BELT_CONFIG.maxFragmentsPerBelt);
    for (const f of fragments) {
      expect(beltAxisDistance(b, f) + f.size).toBeLessThanOrEqual(b.halfWidth + 1e-9);
    }
    // Varied sizes and rotations, deterministic.
    expect(new Set(fragments.map((f) => f.size.toFixed(2))).size).toBeGreaterThan(10);
    expect(buildBeltFragments(b)).toEqual(fragments);
    // Bounded DOM cost: every rock is merged into at most three paths.
    const view = buildBeltView(b);
    expect(view.rocks.length).toBeLessThanOrEqual(3);
  });
});

describe('asteroid belt navigation', () => {
  let movement: StarMapMovementService;
  let terrain: StarMapTerrainService;
  const W = 200;
  const H = 120;

  const configure = (belts: AsteroidBelt[]) => {
    terrain.configure({
      specialObjects: [],
      nebulae: [],
      asteroidBelts: belts,
      width: W,
      height: H,
    });
  };

  const fleet = (
    id: number,
    factionId: string,
    x: number,
    y: number,
    tx: number,
    ty: number,
  ): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX: tx,
    targetY: ty,
    speed: 8,
    system: null,
    ships: [{ id, name: 's', type: 'frigate' }],
  });

  /* Flies until arrival; returns the closest approach to any belt axis minus its radius and the time. */
  const fly = (
    fleets: Fleet[],
    belts: AsteroidBelt[],
    maxSeconds = 2000,
    onBlocked?: (id: number) => void,
  ) => {
    let clearance = Infinity;
    let t = 0;
    const dt = 0.1;
    while (fleets.some((f) => f.targetX !== null) && t < maxSeconds) {
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
      t += dt;
      for (const f of fleets) {
        for (const b of belts) {
          clearance = Math.min(clearance, beltAxisDistance(b, f) - beltNavigationRadius(b));
        }
      }
    }
    return { clearance, seconds: t };
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    terrain = TestBed.inject(StarMapTerrainService);
    movement = TestBed.inject(StarMapMovementService);
    movement.initialize(2, 2, W, H);
  });

  it('never lets a fleet cross the middle of a belt — player and AI alike', () => {
    const wall = belt(1, 40, 160, 60);
    configure([wall]);
    const player = fleet(1, 'player', 100, 40, 100, 80);
    const ai = fleet(2, 'enemy1', 101, 82, 99, 38);

    const { clearance } = fly([player, ai], [wall]);

    expect(clearance).toBeGreaterThanOrEqual(-1e-6);
    expect([player.x, player.y]).toEqual([100, 80]);
    expect([ai.x, ai.y]).toEqual([99, 38]);
  });

  it('routes around the nearer endpoint, on either side', () => {
    const wall = belt(1, 40, 160, 60);
    configure([wall]);
    const nearLeft = movement.planGalaxyRoute({ x: 50, y: 50 }, { x: 50, y: 70 });
    const nearRight = movement.planGalaxyRoute({ x: 150, y: 50 }, { x: 150, y: 70 });
    expect(nearLeft.ok && nearRight.ok).toBe(true);
    if (!nearLeft.ok || !nearRight.ok) return;
    expect(Math.max(...nearLeft.waypoints.map((p) => p.x))).toBeLessThan(45);
    expect(Math.min(...nearRight.waypoints.map((p) => p.x))).toBeGreaterThan(155);
  });

  it('passes between two belts only through a genuine opening', () => {
    // 8-cell opening between capsule edges at x ≈ 96..104.
    const left = belt(1, 20, 94, 60, 1.5);
    const right = belt(2, 106, 180, 60, 1.5);
    configure([left, right]);
    const through = movement.planGalaxyRoute({ x: 100, y: 40 }, { x: 100, y: 80 });
    expect(through).toEqual({ ok: true, waypoints: [] });

    // Same layout with a 0.6-cell gap between the rock bands: visually a crack,
    // but inside the safety margins — fleets must go around the outer ends.
    const tightLeft = belt(1, 20, 98.7, 60, 1.5);
    const tightRight = belt(2, 101.3, 180, 60, 1.5);
    configure([tightLeft, tightRight]);
    const around = movement.planGalaxyRoute({ x: 100, y: 40 }, { x: 100, y: 80 });
    expect(around.ok).toBe(true);
    if (!around.ok) return;
    const xs = around.waypoints.map((p) => p.x);
    expect(Math.min(...xs) < 20 || Math.max(...xs) > 180).toBe(true);
    const f = fleet(1, 'player', 100, 40, 100, 80);
    expect(fly([f], [tightLeft, tightRight]).clearance).toBeGreaterThanOrEqual(-1e-6);
    expect([f.x, f.y]).toEqual([100, 80]);
  });

  it('routes direct target writes (as the AI does) instead of flying straight', () => {
    const wall = belt(1, 40, 160, 60);
    configure([wall]);
    const f = fleet(1, 'enemy1', 100, 50, 100, 70);
    // No validation call: the target is just written, like every AI subsystem does.
    const { clearance } = fly([f], [wall]);
    expect(clearance).toBeGreaterThanOrEqual(-1e-6);
    expect([f.x, f.y]).toEqual([100, 70]);
  });

  it('fails safely when a belt walls the map off or the target is inside it', () => {
    // Hand-made wall from border to border (the generator never does this).
    const wall: AsteroidBelt = {
      id: 1,
      points: [
        { x: 100, y: -5 },
        { x: 100, y: H + 5 },
      ],
      halfWidth: 1.5,
      visualSeed: 1,
    };
    configure([wall]);
    const plan = movement.planGalaxyRoute({ x: 50, y: 60 }, { x: 150, y: 60 });
    expect(plan).toEqual({ ok: false, reason: 'no_route' });

    const blocked: number[] = [];
    const f = fleet(1, 'enemy1', 50, 60, 150, 60);
    fly([f], [wall], 5, (id) => blocked.push(id));
    expect([f.x, f.y]).toEqual([50, 60]);
    expect(f.targetX).toBeNull();
    expect(blocked).toEqual([1]);

    configure([belt(1, 40, 160, 60)]);
    expect(movement.planGalaxyRoute({ x: 50, y: 40 }, { x: 90, y: 60.5 })).toEqual({
      ok: false,
      reason: 'target_blocked',
      blockedBy: 'belt',
    });
  });

  it('estimates travel time including the detour, matching the real flight', () => {
    const wall = belt(1, 40, 160, 60);
    configure([wall]);
    const f = fleet(1, 'player', 100, 50, 100, 70);
    const eta = movement.estimateRemainingTravelSeconds(f)!;
    expect(eta).toBeGreaterThan((20 / 0.4) * 2); // far longer than the 20-cell straight line
    expect(fly([f], [wall]).seconds).toBeCloseTo(eta, 0);
  });

  it('keeps every route leg out of each capsule, including bends and joints', () => {
    const bent: AsteroidBelt = {
      id: 1,
      points: [
        { x: 40, y: 30 },
        { x: 100, y: 70 },
        { x: 160, y: 35 },
      ],
      halfWidth: 1.7,
      visualSeed: 3,
    };
    const obstacles = beltObstacles([bent]);
    const graph = new NavGraph(obstacles, { width: W, height: H });
    const pairs: [NavPoint, NavPoint][] = [
      [
        { x: 100, y: 50 },
        { x: 100, y: 95 },
      ],
      [
        { x: 70, y: 45 },
        { x: 130, y: 70 },
      ],
      [
        { x: 30, y: 60 },
        { x: 170, y: 20 },
      ],
    ];
    for (const [from, to] of pairs) {
      const plan = graph.plan(from, to);
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      const pts = [from, ...plan.waypoints, to];
      for (let i = 1; i < pts.length; i++) {
        for (const o of obstacles) {
          // Sample each leg densely: no point may be inside the capsule.
          for (let k = 0; k <= 50; k++) {
            const p = {
              x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / 50,
              y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / 50,
            };
            expect(distanceToSegment(p, o, { x: o.x2!, y: o.y2! })).toBeGreaterThanOrEqual(
              o.radius - 1e-6,
            );
          }
        }
      }
    }
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('still avoids black holes together with belts', () => {
    terrain.configure({
      specialObjects: [
        { x: 99, y: 59, type: 'blackhole', width: 4, height: 4, component: 'blackhole' },
      ],
      nebulae: [],
      asteroidBelts: [belt(1, 20, 80, 30)],
      width: W,
      height: H,
    });
    const f = fleet(1, 'player', 85, 60.5, 115, 60.5);
    fly([f], []);
    expect([f.x, f.y]).toEqual([115, 60.5]);
    const route = movement.planGalaxyRoute({ x: 85, y: 60.5 }, { x: 115, y: 60.5 });
    expect(route.ok && route.waypoints.length > 0).toBe(true);
  });
});

describe('NavGraph connectivity', () => {
  it('agrees with pairwise route planning', () => {
    const wall: AsteroidBelt = { id: 1, points: [{ x: 100, y: -5 }, { x: 100, y: 125 }], halfWidth: 1.5, visualSeed: 1 };
    const split = new NavGraph(beltObstacles([wall]), { width: 200, height: 120 });
    expect(split.arePointsConnected([{ x: 50, y: 60 }, { x: 60, y: 20 }])).toBe(true);
    expect(split.arePointsConnected([{ x: 50, y: 60 }, { x: 150, y: 60 }])).toBe(false);
    expect(split.plan({ x: 50, y: 60 }, { x: 150, y: 60 }).ok).toBe(false);

    const open = new NavGraph(beltObstacles([belt(1, 40, 160, 60)]), { width: 200, height: 120 });
    expect(open.arePointsConnected([{ x: 100, y: 40 }, { x: 100, y: 80 }, { x: 20, y: 60 }])).toBe(true);
    expect(open.plan({ x: 100, y: 40 }, { x: 100, y: 80 }).ok).toBe(true);
  });
});

describe('asteroid belt shapes', () => {
  it('makes some belts gentle arcs (smooth turns, real sag) and keeps others straight', () => {
    TestBed.configureTestingModule({});
    const generator = TestBed.inject(GalaxyGeneratorService);
    const belts = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => generator.generate(configFor('large', 3), seed).asteroidBelts!);
    const arcs = belts.filter((b) => b.points.length > 2);
    const straight = belts.filter((b) => b.points.length === 2);
    expect(arcs.length).toBeGreaterThan(0);
    expect(straight.length).toBeGreaterThan(0);
    for (const arc of arcs) {
      const a = arc.points[0];
      const z = arc.points[arc.points.length - 1];
      const mid = arc.points[Math.floor(arc.points.length / 2)];
      const chord = Math.hypot(z.x - a.x, z.y - a.y);
      // Noticeably curved, but not a hook.
      const sag = distanceToSegment(mid, a, z);
      expect(sag).toBeGreaterThan(chord * 0.04);
      expect(sag).toBeLessThan(chord * 0.16);
      // Consecutive segments turn gently in the same direction.
      const turns: number[] = [];
      for (let i = 2; i < arc.points.length; i++) {
        const [p, q, r] = [arc.points[i - 2], arc.points[i - 1], arc.points[i]];
        const t1 = Math.atan2(q.y - p.y, q.x - p.x);
        const t2 = Math.atan2(r.y - q.y, r.x - q.x);
        turns.push(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
      }
      expect(turns.every((t) => Math.abs(t) < (25 * Math.PI) / 180)).toBe(true);
      expect(turns.every((t) => Math.sign(t) === Math.sign(turns[0]))).toBe(true);
    }
  });
});

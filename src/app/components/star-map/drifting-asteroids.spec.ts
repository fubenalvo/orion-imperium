import { TestBed } from '@angular/core/testing';
import {
  ASTEROID_CONFIG,
  StatefulRng,
  asteroidExitPoint,
  asteroidPosition,
  createInitialAsteroidState,
  planAsteroidIntercept,
  spawnAsteroid,
} from './drifting-asteroids';
import { DriftingAsteroidService } from './drifting-asteroid.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';
import { distanceToSegment } from './fleet-navigation';
import { AsteroidEventState, DriftingAsteroid, Faction, Fleet } from './star-map.models';

const W = 180;
const H = 108;
const onBorder = (p: { x: number; y: number }) =>
  Math.abs(p.x - 0.5) < 1e-6 ||
  Math.abs(p.y - 0.5) < 1e-6 ||
  Math.abs(p.x - (W + 0.5)) < 1e-6 ||
  Math.abs(p.y - (H + 0.5)) < 1e-6;

describe('drifting asteroid spawning', () => {
  const obstacles = [{ x: 90.5, y: 54.5, radius: 4 }];

  it('enters and exits on the map border on a straight line that crosses the map', () => {
    const rng = new StatefulRng(123);
    for (let i = 1; i <= 200; i++) {
      const a = spawnAsteroid(rng, i, W, H, obstacles)!;
      expect(a).not.toBeNull();
      expect(onBorder({ x: a.startX, y: a.startY })).toBe(true);
      expect(onBorder(asteroidExitPoint(a))).toBe(true);
      expect(Math.hypot(a.dirX, a.dirY)).toBeCloseTo(1, 9);
      expect(a.length).toBeGreaterThanOrEqual(ASTEROID_CONFIG.minCrossingFraction * Math.min(W, H));
      expect(a.speed).toBeGreaterThanOrEqual(ASTEROID_CONFIG.speed.min);
      expect(a.speed).toBeLessThanOrEqual(ASTEROID_CONFIG.speed.max);
      // Never through the black hole.
      expect(
        distanceToSegment(obstacles[0], { x: a.startX, y: a.startY }, asteroidExitPoint(a)),
      ).toBeGreaterThan(obstacles[0].radius);
      // Cargo within the configured range of its type.
      for (const [key, range] of Object.entries(ASTEROID_CONFIG.types[a.type].rewards)) {
        const amount = a.reward[key as 'rawmaterials' | 'research']!;
        expect(amount).toBeGreaterThanOrEqual(Math.floor(range!.min / 10) * 10);
        expect(amount).toBeLessThanOrEqual(Math.ceil(range!.max / 10) * 10);
      }
    }
  });

  it('is deterministic for the same rng state', () => {
    const a = spawnAsteroid(new StatefulRng(9), 1, W, H, obstacles);
    const b = spawnAsteroid(new StatefulRng(9), 1, W, H, obstacles);
    expect(a).toEqual(b);
  });
});

describe('DriftingAsteroidService', () => {
  let service: DriftingAsteroidService;
  let movement: StarMapMovementService;
  let terrain: StarMapTerrainService;

  const factions = (): Faction[] => [
    {
      id: 'player',
      name: 'P',
      color: '#8cc4ff',
      team: 1,
      ai: false,
      currencies: { rawmaterials: 100, research: 50 },
    },
    {
      id: 'enemy1',
      name: 'E',
      color: '#d65757',
      team: 2,
      ai: true,
      currencies: { rawmaterials: 0, research: 0 },
    },
    { id: 'independent', name: 'I', color: '#ffcc00', team: 0, ai: false, currencies: {} },
  ];
  const fleet = (id: number, factionId: string, x: number, y: number, speed = 8): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX: null,
    targetY: null,
    speed,
    system: null,
    ships: [{ id, name: 's', type: 'frigate' }],
  });
  // A horizontal asteroid crossing the map at y = 50 from the left edge.
  const asteroid = (overrides: Partial<DriftingAsteroid> = {}): DriftingAsteroid => ({
    id: 1,
    type: 'mixed',
    startX: 0.5,
    startY: 50,
    dirX: 1,
    dirY: 0,
    speed: 0.2,
    traveled: 0,
    length: W,
    reward: { rawmaterials: 200, research: 120 },
    ...overrides,
  });
  const stateWith = (active: DriftingAsteroid[], spawnTimer = 10_000): AsteroidEventState => ({
    nextId: 10,
    spawnTimer,
    rngState: 77,
    active,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    terrain = TestBed.inject(StarMapTerrainService);
    terrain.configure({ specialObjects: [], nebulae: [], width: W, height: H });
    movement = TestBed.inject(StarMapMovementService);
    movement.initialize(2, 2, W, H);
    service = TestBed.inject(DriftingAsteroidService);
  });

  it('spawns periodically, never all at once, and respects the active limit', () => {
    service.restore(createInitialAsteroidState(5), 5);
    expect(service.active.length).toBe(0);
    let maxSeen = 0;
    let spawned = 0;
    let lastId = 0;
    for (let t = 0; t < 4000; t += 1) {
      service.tick(1, [], factions(), W, H);
      maxSeen = Math.max(maxSeen, service.active.length);
      for (const a of service.active) {
        if (a.id > lastId) {
          spawned++;
          lastId = a.id;
        }
      }
    }
    expect(spawned).toBeGreaterThan(10);
    expect(maxSeen).toBeLessThanOrEqual(ASTEROID_CONFIG.maxActive);
    // Expired asteroids are cleaned up: the state stays bounded.
    expect(service.serialize().active.length).toBeLessThanOrEqual(ASTEROID_CONFIG.maxActive);
  });

  it('moves in a straight line at constant speed, scaled by game time, and freezes while paused', () => {
    service.restore(stateWith([asteroid()]), 1);
    service.tick(0, [], factions(), W, H);
    expect(asteroidPosition(service.active[0])).toEqual({ x: 0.5, y: 50 });

    service.tick(10, [], factions(), W, H);
    const p1 = asteroidPosition(service.active[0]);
    expect(p1.x).toBeCloseTo(2.5, 6);
    expect(p1.y).toBe(50);

    // 2× speed = twice the game delta per frame.
    service.tick(20, [], factions(), W, H);
    expect(asteroidPosition(service.active[0]).x).toBeCloseTo(6.5, 6);
  });

  it('leaves the map and is removed when nobody intercepts it', () => {
    service.restore(stateWith([asteroid({ traveled: W - 1 })]), 1);
    service.tick(4, [], factions(), W, H);
    expect(service.active.length).toBe(1);
    service.tick(2, [], factions(), W, H);
    expect(service.active.length).toBe(0);
  });

  it('grants the reward exactly once to the closest fleet', () => {
    const fs = factions();
    service.restore(stateWith([asteroid({ traveled: 49.5 })]), 1);
    const near = fleet(2, 'player', 50.4, 50);
    const far = fleet(1, 'enemy1', 50.8, 50.3);
    const result = service.tick(0.1, [far, near], fs, W, H);

    expect(result.collected.map((c) => c.fleetId)).toEqual([2]);
    expect(fs[0].currencies['rawmaterials']).toBe(300);
    expect(fs[0].currencies['research']).toBe(170);
    expect(fs[1].currencies['rawmaterials']).toBe(0);
    expect(service.active.length).toBe(0);

    // Further ticks cannot pay it again.
    service.tick(1, [far, near], fs, W, H);
    expect(fs[0].currencies['rawmaterials']).toBe(300);
  });

  it('does not collect from screen proximity: positions must actually meet', () => {
    const fs = factions();
    service.restore(stateWith([asteroid({ traveled: 49.5 })]), 1);
    // Same grid cell row, 1.5 cells away: visually adjacent, not touching.
    const result = service.tick(0.1, [fleet(1, 'player', 51.5, 50)], fs, W, H);
    expect(result.collected).toEqual([]);
    expect(service.active.length).toBe(1);
  });

  it('ignores neutral and destroyed fleets', () => {
    const fs = factions();
    service.restore(stateWith([asteroid({ traveled: 49.5 })]), 1);
    const neutral = fleet(1, 'independent', 50, 50);
    const dead = { ...fleet(2, 'player', 50, 50), destroyed: true };
    expect(service.tick(0.1, [neutral, dead], fs, W, H).collected).toEqual([]);
  });

  it('plans an intercept with the fleet speed and rejects impossible ones', () => {
    const a = asteroid({ traveled: 20 });
    const reachable = planAsteroidIntercept(
      { x: 60, y: 70 },
      0.4,
      a,
      (f, t, s) => Math.hypot(t.x - f.x, t.y - f.y) / s,
    );
    expect(reachable).not.toBeNull();
    // At the meeting time the asteroid is at the meeting point and the fleet can be there.
    expect(reachable!.point.y).toBe(50);
    expect(Math.hypot(reachable!.point.x - 60, 20) / 0.4).toBeLessThanOrEqual(
      reachable!.time + 0.25,
    );

    // Too slow and too far behind an asteroid about to leave the map.
    const leaving = asteroid({ traveled: W - 5 });
    expect(
      planAsteroidIntercept(
        { x: 10, y: 50 },
        0.1,
        leaving,
        (f, t, s) => Math.hypot(t.x - f.x, t.y - f.y) / s,
      ),
    ).toBeNull();
  });

  it('steers a fleet with an intercept order to the asteroid and collects it', () => {
    const fs = factions();
    service.restore(stateWith([asteroid({ traveled: 10 })]), 1);
    const hunter = fleet(1, 'player', 60, 75);
    const order = service.orderIntercept(hunter, 1);
    expect(order.ok).toBe(true);
    expect(hunter.interceptAsteroidId).toBe(1);

    let collectedBy: number | null = null;
    for (let t = 0; t < 600 && collectedBy === null; t += 0.1) {
      movement.updateFleets(
        [hunter],
        [],
        null,
        'map',
        0.1,
        () => {},
        () => {},
      );
      const result = service.tick(0.1, [hunter], fs, W, H);
      collectedBy = result.collected[0]?.fleetId ?? null;
    }
    expect(collectedBy).toBe(1);
    expect(hunter.interceptAsteroidId).toBeNull();
    expect(fs[0].currencies['rawmaterials']).toBe(300);
  });

  it('refuses an intercept order the fleet cannot complete', () => {
    service.restore(stateWith([asteroid({ traveled: W - 3 })]), 1);
    const slow = fleet(1, 'player', 20, 100, 2);
    expect(service.orderIntercept(slow, 1)).toEqual({ ok: false, reason: 'unreachable' });
    expect(slow.interceptAsteroidId ?? null).toBeNull();
    expect(slow.targetX).toBeNull();
    expect(service.orderIntercept(slow, 999)).toEqual({ ok: false, reason: 'gone' });
  });

  it('drops an intercept order when the asteroid is collected by someone else', () => {
    const fs = factions();
    service.restore(stateWith([asteroid({ traveled: 49.5 })]), 1);
    const chaser = fleet(1, 'player', 70, 80);
    service.orderIntercept(chaser, 1);
    const rival = fleet(2, 'enemy1', 50, 50);
    const result = service.tick(0.1, [chaser, rival], fs, W, H);

    expect(result.collected[0].factionId).toBe('enemy1');
    expect(chaser.interceptAsteroidId).toBeNull();
    expect(chaser.targetX).toBeNull();
    expect(result.failedIntercepts).toEqual([{ fleetId: 1, asteroidId: 1 }]);
  });

  it('restores active asteroids, cargo, timer and rng exactly after save/load', () => {
    service.restore(createInitialAsteroidState(31), 31);
    for (let t = 0; t < 400; t++) service.tick(1, [], factions(), W, H);
    const saved = JSON.parse(JSON.stringify(service.serialize())) as AsteroidEventState;
    expect(saved.active.length).toBeGreaterThan(0);

    // Continue the original for a while…
    for (let t = 0; t < 300; t++) service.tick(1, [], factions(), W, H);
    const continued = service.serialize();

    // …and replay from the save: identical future.
    service.restore(saved, 31);
    expect(service.serialize()).toEqual(saved);
    for (let t = 0; t < 300; t++) service.tick(1, [], factions(), W, H);
    expect(service.serialize()).toEqual(continued);
  });

  it('clears intercept orders that point at asteroids missing from the save', () => {
    const f = { ...fleet(1, 'player', 10, 10), interceptAsteroidId: 42 };
    service.restore(stateWith([asteroid()]), 1, [f]);
    expect(f.interceptAsteroidId).toBeNull();
  });
});

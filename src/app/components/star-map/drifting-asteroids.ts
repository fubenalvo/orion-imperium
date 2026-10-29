import {
  AsteroidEventState,
  AsteroidReward,
  AsteroidType,
  DriftingAsteroid,
} from './star-map.models';
import { NavObstacle, NavPoint, obstacleEnd, segmentDistance } from './fleet-navigation';

/*
 * =========================================================
 * DRIFTING ASTEROIDS (pure rules)
 * =========================================================
 *
 * Resource-bearing asteroids periodically cross the galaxy map on a
 * straight line and can be collected by a fleet that meets them. Rules
 * (docs/star-map-terrain.md#drifting-asteroids):
 *
 * - Spawning: every ASTEROID_CONFIG.spawnInterval game seconds (random in
 *   range) one asteroid enters at a random point of the map border, aimed
 *   at a random point of the central part of the map, so it always crosses
 *   a meaningful part of the playable area. Trajectories that would touch
 *   a black hole or asteroid belt are rejected. Never more than `maxActive` at
 *   once; a spawn attempt with no valid trajectory just waits for the next
 *   interval.
 * - Movement: constant speed along the line; position is derived from
 *   `traveled`, so the asteroid moves only with game time (pause/speed are
 *   inherited from the scaled delta).
 * - Exit: once `traveled >= length` the asteroid has left the map and is
 *   removed.
 * - Collection: a living fleet of a non-neutral faction whose gameplay
 *   position is within `collectRadius` cells of the asteroid collects it.
 *   If several qualify in the same frame the closest wins (ties: lowest
 *   fleet id), so a reward is granted exactly once. The reward goes to the
 *   fleet's faction currencies (existing resources only: raw materials and
 *   research points).
 *
 * Randomness: a Mulberry32 stream whose state is persisted in
 * AsteroidEventState.rngState, so spawns are reproducible across save/load.
 */

export interface RewardRange {
  min: number;
  max: number;
}

export interface AsteroidTypeConfig {
  label: string;
  /* Relative spawn weight. */
  weight: number;
  rewards: Partial<Record<keyof AsteroidReward, RewardRange>>;
}

export const ASTEROID_CONFIG = {
  /* Game seconds before the first asteroid of a new game. */
  firstSpawnDelay: { min: 40, max: 80 } as RewardRange,
  /* Game seconds between spawn attempts. */
  spawnInterval: { min: 90, max: 170 } as RewardRange,
  maxActive: 3,
  /* Grid cells per game second (fleets: 0.3–0.4 for speed 6–8). */
  speed: { min: 0.12, max: 0.2 } as RewardRange,
  /* Aim points are drawn from this central fraction of each map axis. */
  centralAimFraction: 0.5,
  /* A trajectory must cross at least this fraction of the shorter map side. */
  minCrossingFraction: 0.5,
  /* Trajectories keep this many cells away from black holes and asteroid belts. */
  obstacleMargin: 3,
  /* Gameplay distance (cells) at which a fleet collects an asteroid. */
  collectRadius: 1,
  /* Length of the rendered tail in cells (visual only, never saved). */
  trailLength: 9,
  /* Game seconds between intercept re-aims of a pursuing fleet. */
  reaimInterval: 1,
  types: {
    ore: { label: 'Ore Asteroid', weight: 5, rewards: { rawmaterials: { min: 250, max: 600 } } },
    crystal: {
      label: 'Crystal Asteroid',
      weight: 3,
      rewards: { research: { min: 150, max: 400 } },
    },
    mixed: {
      label: 'Mixed Cargo Asteroid',
      weight: 2,
      rewards: { rawmaterials: { min: 120, max: 320 }, research: { min: 80, max: 220 } },
    },
  } as Record<AsteroidType, AsteroidTypeConfig>,
} as const;

export const ASTEROID_TYPES: readonly AsteroidType[] = ['ore', 'crystal', 'mixed'];

/* One Mulberry32 step on an explicit state (same algorithm as createMulberry32). */
export function mulberry32Next(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/* An rng closure over persisted state; read `.state` back after use. */
export class StatefulRng {
  constructor(public state: number) {}

  next(): number {
    const step = mulberry32Next(this.state);
    this.state = step.state;
    return step.value;
  }

  range(range: RewardRange): number {
    return range.min + this.next() * (range.max - range.min);
  }
}

export function createInitialAsteroidState(seed: number): AsteroidEventState {
  // Derived from (not equal to) the galaxy seed so asteroid rolls do not
  // mirror the galaxy layout stream.
  const rng = new StatefulRng((seed ^ 0x5bd1e995) | 0);
  const spawnTimer = Math.round(rng.range(ASTEROID_CONFIG.firstSpawnDelay));
  return { nextId: 1, spawnTimer, rngState: rng.state, active: [] };
}

export function asteroidPosition(asteroid: DriftingAsteroid): NavPoint {
  return {
    x: asteroid.startX + asteroid.dirX * asteroid.traveled,
    y: asteroid.startY + asteroid.dirY * asteroid.traveled,
  };
}

export function asteroidExitPoint(asteroid: DriftingAsteroid): NavPoint {
  return {
    x: asteroid.startX + asteroid.dirX * asteroid.length,
    y: asteroid.startY + asteroid.dirY * asteroid.length,
  };
}

/* Game seconds until the asteroid leaves the map. */
export function asteroidRemainingSeconds(asteroid: DriftingAsteroid): number {
  return Math.max(0, (asteroid.length - asteroid.traveled) / asteroid.speed);
}

/*
 * Map rectangle in fleet coordinates: cell N is centered at N, so the
 * playable area spans [0.5, W + 0.5] × [0.5, H + 0.5].
 */
function mapRect(width: number, height: number) {
  return { minX: 0.5, minY: 0.5, maxX: width + 0.5, maxY: height + 0.5 };
}

/* Distance along `dir` from `start` (on or inside the rect) to the rect border. */
function distanceToBorder(start: NavPoint, dir: NavPoint, width: number, height: number): number {
  const rect = mapRect(width, height);
  const tx =
    dir.x > 0
      ? (rect.maxX - start.x) / dir.x
      : dir.x < 0
        ? (rect.minX - start.x) / dir.x
        : Infinity;
  const ty =
    dir.y > 0
      ? (rect.maxY - start.y) / dir.y
      : dir.y < 0
        ? (rect.minY - start.y) / dir.y
        : Infinity;
  return Math.min(tx, ty);
}

function pickType(rng: StatefulRng): AsteroidType {
  const total = ASTEROID_TYPES.reduce((sum, t) => sum + ASTEROID_CONFIG.types[t].weight, 0);
  let roll = rng.next() * total;
  for (const type of ASTEROID_TYPES) {
    roll -= ASTEROID_CONFIG.types[type].weight;
    if (roll < 0) {
      return type;
    }
  }
  return ASTEROID_TYPES[ASTEROID_TYPES.length - 1];
}

function rollReward(rng: StatefulRng, type: AsteroidType): AsteroidReward {
  const reward: AsteroidReward = {};
  const ranges = ASTEROID_CONFIG.types[type].rewards;
  for (const key of ['rawmaterials', 'research'] as const) {
    const range = ranges[key];
    if (range) {
      // Rounded to tens: cargo values read better in the UI.
      reward[key] = Math.round(rng.range(range) / 10) * 10;
    }
  }
  return reward;
}

/*
 * Creates one asteroid with a valid trajectory, or null when no valid
 * trajectory was found within a bounded number of attempts.
 */
export function spawnAsteroid(
  rng: StatefulRng,
  id: number,
  width: number,
  height: number,
  obstacles: readonly NavObstacle[],
): DriftingAsteroid | null {
  const rect = mapRect(width, height);
  const spanX = rect.maxX - rect.minX;
  const spanY = rect.maxY - rect.minY;
  const perimeter = 2 * (spanX + spanY);
  const aimInset = (1 - ASTEROID_CONFIG.centralAimFraction) / 2;
  const minCrossing = ASTEROID_CONFIG.minCrossingFraction * Math.min(width, height);

  for (let attempt = 0; attempt < 20; attempt++) {
    // Entry point uniformly distributed along the map border.
    let along = rng.next() * perimeter;
    let entry: NavPoint;
    if (along < spanX) {
      entry = { x: rect.minX + along, y: rect.minY };
    } else if ((along -= spanX) < spanY) {
      entry = { x: rect.maxX, y: rect.minY + along };
    } else if ((along -= spanY) < spanX) {
      entry = { x: rect.maxX - along, y: rect.maxY };
    } else {
      along -= spanX;
      entry = { x: rect.minX, y: rect.maxY - along };
    }
    const aim = {
      x: rect.minX + spanX * (aimInset + rng.next() * ASTEROID_CONFIG.centralAimFraction),
      y: rect.minY + spanY * (aimInset + rng.next() * ASTEROID_CONFIG.centralAimFraction),
    };
    const dx = aim.x - entry.x;
    const dy = aim.y - entry.y;
    const norm = Math.hypot(dx, dy);
    if (norm < 1) {
      continue;
    }
    const dir = { x: dx / norm, y: dy / norm };
    const length = distanceToBorder(entry, dir, width, height);
    if (!Number.isFinite(length) || length < minCrossing) {
      continue;
    }
    const exit = { x: entry.x + dir.x * length, y: entry.y + dir.y * length };
    if (
      obstacles.some(
        (o) =>
          segmentDistance(o, obstacleEnd(o), entry, exit) <
          o.radius + ASTEROID_CONFIG.obstacleMargin,
      )
    ) {
      continue;
    }
    const type = pickType(rng);
    return {
      id,
      type,
      startX: entry.x,
      startY: entry.y,
      dirX: dir.x,
      dirY: dir.y,
      speed: Math.round(rng.range(ASTEROID_CONFIG.speed) * 1000) / 1000,
      traveled: 0,
      length,
      reward: rollReward(rng, type),
    };
  }
  return null;
}

export interface InterceptPlan {
  /* Game seconds from now until the fleet meets the asteroid. */
  time: number;
  /* Meeting point on the asteroid's track. */
  point: NavPoint;
}

/*
 * Earliest meeting point of a fleet starting at `from` with open-space speed
 * `cellsPerSecond` and the moving asteroid, or null if the fleet cannot get
 * there before the asteroid leaves the map.
 *
 * Step 1 solves the classic straight-line pursuit quadratic
 * |A + v·t − P| = s·t; it is a lower bound because terrain only slows a
 * fleet down. Step 2 refines t with `travelSeconds` (the real route time:
 * detours around black holes and nebula slowdown) by fixed-point iteration
 * t ← travel(P → A(t)) until the fleet arrives no later than the asteroid.
 */
export function planAsteroidIntercept(
  from: NavPoint,
  cellsPerSecond: number,
  asteroid: DriftingAsteroid,
  travelSeconds: (from: NavPoint, to: NavPoint, cellsPerSecond: number) => number,
): InterceptPlan | null {
  if (cellsPerSecond <= 0) {
    return null;
  }
  const start = asteroidPosition(asteroid);
  const remaining = asteroidRemainingSeconds(asteroid);
  const vx = asteroid.dirX * asteroid.speed;
  const vy = asteroid.dirY * asteroid.speed;
  const rx = start.x - from.x;
  const ry = start.y - from.y;

  if (Math.hypot(rx, ry) <= ASTEROID_CONFIG.collectRadius) {
    return { time: 0, point: start };
  }

  const a = vx * vx + vy * vy - cellsPerSecond * cellsPerSecond;
  const b = 2 * (rx * vx + ry * vy);
  const c = rx * rx + ry * ry;
  let t: number;
  if (Math.abs(a) < 1e-9) {
    if (b >= 0) {
      return null;
    }
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      return null;
    }
    const sqrt = Math.sqrt(disc);
    const roots = [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)]
      .filter((r) => r >= 0)
      .sort((p, q) => p - q);
    if (roots.length === 0) {
      return null;
    }
    t = roots[0];
  }

  for (let iteration = 0; iteration < 12; iteration++) {
    if (t > remaining) {
      return null;
    }
    const point = { x: start.x + vx * t, y: start.y + vy * t };
    const travel = travelSeconds(from, point, cellsPerSecond);
    if (!Number.isFinite(travel)) {
      return null;
    }
    if (travel <= t + 0.25) {
      return { time: t, point };
    }
    t = travel;
  }
  return null;
}

/* Structural check for save validation. */
export function isWellFormedAsteroid(value: unknown): value is DriftingAsteroid {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const a = value as Partial<DriftingAsteroid>;
  const finite = [a.id, a.startX, a.startY, a.dirX, a.dirY, a.speed, a.traveled, a.length].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  );
  const reward = a.reward as Record<string, unknown> | undefined;
  return (
    finite &&
    (a.speed ?? 0) > 0 &&
    typeof a.type === 'string' &&
    (ASTEROID_TYPES as readonly string[]).includes(a.type) &&
    !!reward &&
    typeof reward === 'object' &&
    Object.values(reward).every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  );
}

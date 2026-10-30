import { AsteroidBelt } from './star-map.models';
import {
  NavBounds,
  NavGraph,
  NavObstacle,
  NavPoint,
  distanceToSegment,
  obstacleEnd,
  segmentDistance,
} from './fleet-navigation';
import { createMulberry32 } from './star-map-resources.util';

/*
 * =========================================================
 * ASTEROID BELTS (impassable navigation barriers)
 * =========================================================
 *
 * Long, narrow walls of rock that split the galaxy into regions, like
 * cliffs in a real-time strategy map. See docs/star-map-terrain.md#asteroid-belts.
 *
 * Gameplay vs visuals are deliberately separate:
 * - Navigation: one capsule obstacle per polyline segment of the belt axis
 *   (`beltObstacles`), radius = halfWidth + safetyMargin. Consecutive
 *   capsules share their end point, so the barrier is continuous; routing
 *   (fleet-navigation.ts) is the same code that avoids black holes, so the
 *   player and the AI are blocked identically.
 * - Visuals: `buildBeltFragments` scatters irregular rocks strictly inside
 *   halfWidth from `visualSeed`. Gaps between rocks are cosmetic only —
 *   they never create a passage, because the capsule covers the whole band.
 *
 * Generation (`generateAsteroidBelts`) guarantees a playable map:
 * - belts keep `systemClearance` from every star system and starting fleet,
 *   `minPassage` cells of open space from each other, the map border and
 *   black hole no-fly zones (so every end of a belt is a real way around);
 * - after placement every home system must still reach every star system
 *   (checked with the real router); belts are dropped until it does.
 * - The rng stream is derived from the galaxy seed but separate from the
 *   layout and nebula streams, so systems/fleets/nebulae of a seed are
 *   unchanged by belts.
 */

export const ASTEROID_BELT_CONFIG = {
  /* Belts per galaxy size (fewer when no valid placement is found). */
  countBySize: { small: 2, medium: 3, large: 4 } as Record<string, number>,
  /* Belt length as a fraction of the map width. */
  lengthFraction: { min: 0.2, max: 0.36 },
  /* Half thickness of the rock band (cells). */
  halfWidth: { min: 0.9, max: 1.7 },
  /* Extra no-fly distance around the rocks (cells). */
  safetyMargin: 0.5,
  /*
   * Chance of a gently curved belt and its sag (sideways offset of the arc
   * middle, × length). Arcs are sampled into `arcSegments` capsules: enough
   * to look curved, few enough to keep the routing graph small.
   */
  arcChance: 0.45,
  arcSagFraction: { min: 0.06, max: 0.14 },
  arcSegments: 4,
  /* Minimum open space between a belt and other belts, the border or a black hole. */
  minPassage: 6,
  /* Minimum distance from a belt's no-fly edge to any star system or starting fleet. */
  systemClearance: 4,
  attemptsPerZone: 20,
  /* Visual density: fragments per cell² of band area, capped per belt. */
  fragmentsPerCell: 1.6,
  maxFragmentsPerBelt: 320,
};

/* Radius of a belt's navigation capsules. */
export function beltNavigationRadius(belt: AsteroidBelt): number {
  return belt.halfWidth + ASTEROID_BELT_CONFIG.safetyMargin;
}

export function beltObstacles(belts: readonly AsteroidBelt[] | undefined): NavObstacle[] {
  const obstacles: NavObstacle[] = [];
  for (const belt of belts ?? []) {
    const radius = beltNavigationRadius(belt);
    for (let i = 1; i < belt.points.length; i++) {
      const a = belt.points[i - 1];
      const b = belt.points[i];
      obstacles.push({ x: a.x, y: a.y, x2: b.x, y2: b.y, radius, kind: 'belt' });
    }
  }
  return obstacles;
}

/* Distance from a point to the belt axis. */
export function beltAxisDistance(belt: AsteroidBelt, p: NavPoint): number {
  let min = Infinity;
  for (let i = 1; i < belt.points.length; i++) {
    min = Math.min(min, distanceToSegment(p, belt.points[i - 1], belt.points[i]));
  }
  return min;
}

function beltToObstacleDistance(belt: AsteroidBelt, o: NavObstacle): number {
  let min = Infinity;
  for (let i = 1; i < belt.points.length; i++) {
    min = Math.min(min, segmentDistance(belt.points[i - 1], belt.points[i], o, obstacleEnd(o)));
  }
  return min;
}

export function beltLength(belt: AsteroidBelt): number {
  let total = 0;
  for (let i = 1; i < belt.points.length; i++) {
    total += Math.hypot(
      belt.points[i].x - belt.points[i - 1].x,
      belt.points[i].y - belt.points[i - 1].y,
    );
  }
  return total;
}

export interface BeltGenerationInput {
  width: number;
  height: number;
  count: number;
  /* Every star system (kept clear) */
  systems: readonly NavPoint[];
  /* Home systems: must reach every system after placement. */
  homes: readonly NavPoint[];
  /* Starting fleet positions (kept clear). */
  fleets: readonly NavPoint[];
  /* Existing obstacles (black holes). */
  obstacles: readonly NavObstacle[];
}

export function isBeltPlacementValid(
  belt: AsteroidBelt,
  existing: readonly AsteroidBelt[],
  input: Omit<BeltGenerationInput, 'count' | 'homes'>,
): boolean {
  const cfg = ASTEROID_BELT_CONFIG;
  const r = beltNavigationRadius(belt);
  // Ends far enough from the border that going around them is a real route.
  const margin = r * 1.1 + cfg.minPassage + 1;
  for (const p of belt.points) {
    if (p.x < margin || p.y < margin || p.x > input.width - margin || p.y > input.height - margin) {
      return false;
    }
  }
  for (const s of input.systems) {
    if (beltAxisDistance(belt, s) < r + cfg.systemClearance) {
      return false;
    }
  }
  for (const f of input.fleets) {
    if (beltAxisDistance(belt, f) < r + cfg.systemClearance / 2) {
      return false;
    }
  }
  for (const o of input.obstacles) {
    if (beltToObstacleDistance(belt, o) < r + o.radius + cfg.minPassage) {
      return false;
    }
  }
  for (const other of existing) {
    const minGap = r + beltNavigationRadius(other) + cfg.minPassage;
    for (const o of beltObstacles([other])) {
      if (beltToObstacleDistance(belt, o) < minGap) {
        return false;
      }
    }
  }
  return true;
}

/* True when every home can still reach every system with these belts. */
export function areSystemsConnected(
  belts: readonly AsteroidBelt[],
  input: Pick<BeltGenerationInput, 'width' | 'height' | 'systems' | 'homes' | 'obstacles'>,
): boolean {
  const bounds: NavBounds = { width: input.width, height: input.height };
  const graph = new NavGraph([...input.obstacles, ...beltObstacles(belts)], bounds);
  // Homes are systems: all systems mutually connected ⇔ every home reaches every system.
  return graph.arePointsConnected([...input.homes, ...input.systems]);
}

/*
 * Procedurally places belts. Deterministic for a given rng stream.
 *
 * Distribution mirrors nebulae: the map is split into ~2× as many zones as
 * belts and each belt is centered in a different random zone. Orientations
 * are spread over half a turn (base angle + k·π/count + jitter), so belts
 * never all run parallel.
 */
export function generateAsteroidBelts(
  rng: () => number,
  input: BeltGenerationInput,
): AsteroidBelt[] {
  const cfg = ASTEROID_BELT_CONFIG;
  const { width, height, count } = input;
  if (count <= 0 || width <= 0 || height <= 0) {
    return [];
  }
  const zoneCols = Math.max(2, Math.round(Math.sqrt(count * 2 * (width / height))));
  const zoneRows = Math.max(2, Math.ceil((count * 2) / zoneCols));
  const zones: { col: number; row: number }[] = [];
  for (let col = 0; col < zoneCols; col++) {
    for (let row = 0; row < zoneRows; row++) {
      zones.push({ col, row });
    }
  }
  for (let i = zones.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [zones[i], zones[j]] = [zones[j], zones[i]];
  }

  const baseAngle = rng() * Math.PI;
  const belts: AsteroidBelt[] = [];
  for (const zone of zones) {
    if (belts.length >= count) {
      break;
    }
    for (let attempt = 0; attempt < cfg.attemptsPerZone; attempt++) {
      const center = {
        x: ((zone.col + rng()) * width) / zoneCols + 0.5,
        y: ((zone.row + rng()) * height) / zoneRows + 0.5,
      };
      const angle =
        baseAngle + (belts.length * Math.PI) / count + (rng() - 0.5) * (Math.PI / (count * 2));
      const length =
        width *
        (cfg.lengthFraction.min + rng() * (cfg.lengthFraction.max - cfg.lengthFraction.min));
      const halfWidth = cfg.halfWidth.min + rng() * (cfg.halfWidth.max - cfg.halfWidth.min);
      const curved = rng() < cfg.arcChance;
      const sag =
        (cfg.arcSagFraction.min + rng() * (cfg.arcSagFraction.max - cfg.arcSagFraction.min)) *
        length *
        (rng() < 0.5 ? -1 : 1);
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const normal = { x: -dir.y, y: dir.x };
      const round = (v: number) => Math.round(v * 100) / 100;
      const a = {
        x: round(center.x - (dir.x * length) / 2),
        y: round(center.y - (dir.y * length) / 2),
      };
      const b = {
        x: round(center.x + (dir.x * length) / 2),
        y: round(center.y + (dir.y * length) / 2),
      };
      // Quadratic Bézier with its control point at 2 × sag, so the arc's
      // middle passes `sag` cells beside the chord center.
      const control = { x: center.x + normal.x * 2 * sag, y: center.y + normal.y * 2 * sag };
      const points = curved
        ? Array.from({ length: cfg.arcSegments + 1 }, (_, i) => {
            const t = i / cfg.arcSegments;
            const u = 1 - t;
            return {
              x: round(u * u * a.x + 2 * u * t * control.x + t * t * b.x),
              y: round(u * u * a.y + 2 * u * t * control.y + t * t * b.y),
            };
          })
        : [a, b];
      const visualSeed = Math.floor(rng() * 0x7fffffff);
      const candidate: AsteroidBelt = {
        id: belts.length + 1,
        points,
        halfWidth: Math.round(halfWidth * 100) / 100,
        visualSeed,
      };
      if (isBeltPlacementValid(candidate, belts, input)) {
        belts.push(candidate);
        break;
      }
    }
  }

  // Playability: every home must still reach every system. The geometric
  // rules above almost always guarantee it; this is the hard check.
  while (belts.length > 0 && !areSystemsConnected(belts, input)) {
    belts.pop();
  }
  return belts;
}

/* Structural check for save validation. */
export function isWellFormedBelt(value: unknown): value is AsteroidBelt {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const b = value as Partial<AsteroidBelt>;
  return (
    [b.id, b.halfWidth, b.visualSeed].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (b.halfWidth ?? 0) > 0 &&
    Array.isArray(b.points) &&
    b.points.length >= 2 &&
    b.points.every(
      (p) =>
        !!p &&
        typeof p === 'object' &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y),
    )
  );
}

// ---------------------------------------------------------------------------
// Visuals (render-only, rebuilt from visualSeed; never saved)
// ---------------------------------------------------------------------------

export interface BeltFragment {
  x: number;
  y: number;
  /* Radius of the rock (cells). */
  size: number;
  rotation: number;
  /* 0..2: dark, mid, light rock. */
  shade: number;
  shape: number;
}

const ROCK_SHAPE_COUNT = 6;

/*
 * Irregular unit rocks (radius ≈ 1 around the origin), fixed for every game
 * so a belt's look depends only on its visualSeed.
 */
export const ROCK_SHAPES: readonly NavPoint[][] = (() => {
  const rng = createMulberry32(0x0be17);
  return Array.from({ length: ROCK_SHAPE_COUNT }, () => {
    const corners = 6 + Math.floor(rng() * 4);
    return Array.from({ length: corners }, (_, i) => {
      const angle = (i / corners) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      const r = 0.7 + rng() * 0.3;
      return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });
  });
})();

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/* Point and unit tangent at distance `t` along the belt axis. */
function pointAlong(belt: AsteroidBelt, t: number): { p: NavPoint; dir: NavPoint } {
  let remaining = t;
  for (let i = 1; i < belt.points.length; i++) {
    const a = belt.points[i - 1];
    const b = belt.points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= len || i === belt.points.length - 1) {
      const f = len > 0 ? Math.min(1, remaining / len) : 0;
      const dir = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, dir };
    }
    remaining -= len;
  }
  return { p: { ...belt.points[0] }, dir: { x: 1, y: 0 } };
}

/*
 * Deterministic rock fragments of a belt. Every fragment (including its
 * radius) lies within halfWidth of the axis, so the navigation capsule
 * (halfWidth + safetyMargin) always covers the visuals. Density varies
 * along the belt (clumps and thin stretches) and rocks are bigger near the
 * axis, giving irregular edges.
 */
export function buildBeltFragments(belt: AsteroidBelt): BeltFragment[] {
  const cfg = ASTEROID_BELT_CONFIG;
  const rng = createMulberry32(belt.visualSeed >>> 0);
  const length = beltLength(belt);
  const target = Math.min(
    cfg.maxFragmentsPerBelt,
    Math.round(length * belt.halfWidth * 2 * cfg.fragmentsPerCell),
  );
  // Density waves along the belt: 2–3 overlapping sines with random phase.
  const waves = [0, 1, 2].map(() => ({ freq: 0.08 + rng() * 0.25, phase: rng() * Math.PI * 2 }));
  const density = (t: number) =>
    0.55 +
    (0.45 * waves.reduce((sum, w) => sum + Math.sin(t * w.freq + w.phase), 0)) / waves.length;

  const fragments: BeltFragment[] = [];
  for (let attempt = 0; fragments.length < target && attempt < target * 3; attempt++) {
    const t = rng() * length;
    if (rng() > density(t)) {
      continue;
    }
    const { p, dir } = pointAlong(belt, t);
    // Triangular distribution: most rocks near the axis.
    const lateral = (rng() + rng() - 1) * belt.halfWidth;
    const centrality = 1 - Math.abs(lateral) / belt.halfWidth;
    let size = 0.12 + Math.pow(rng(), 2.2) * 0.55 * (0.5 + centrality);
    size = Math.min(size, belt.halfWidth - Math.abs(lateral));
    if (size < 0.08) {
      continue;
    }
    fragments.push({
      x: p.x - dir.y * lateral,
      y: p.y + dir.x * lateral,
      size,
      rotation: rng() * 360,
      shade: Math.min(2, Math.floor(rng() * 3)),
      shape: Math.floor(rng() * ROCK_SHAPE_COUNT),
    });
  }
  return fragments;
}

export interface BeltView {
  id: number;
  /* Axis polyline (SVG units) for the dust haze and the minimap. */
  axis: string;
  haloWidth: number;
  /* Rocks merged into one path per shade (static; belts do not animate). */
  rocks: { shade: number; d: string }[];
}

/*
 * Render data of a belt in SVG units (1 unit = 1 cell; grid coordinate N
 * is drawn at N - 0.5, the galaxy view's cell center). Rocks are merged
 * into three paths (one per shade) so a belt with hundreds of rocks costs a
 * handful of DOM nodes; the galaxy view lights each merged path with a
 * clipped rim/shadow trick instead of per-rock elements.
 */
export function buildBeltView(belt: AsteroidBelt): BeltView {
  const shades: string[][] = [[], [], []];
  for (const f of buildBeltFragments(belt)) {
    const cx = f.x - 0.5;
    const cy = f.y - 0.5;
    const rad = (f.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const pts = ROCK_SHAPES[f.shape].map((p) => ({
      x: cx + (p.x * cos - p.y * sin) * f.size,
      y: cy + (p.x * sin + p.y * cos) * f.size,
    }));
    shades[f.shade].push(`M${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L')} Z`);
  }
  return {
    id: belt.id,
    axis: `M${belt.points.map((p) => `${fmt(p.x - 0.5)} ${fmt(p.y - 0.5)}`).join(' L')}`,
    haloWidth: belt.halfWidth * 2.6,
    rocks: shades
      .map((paths, shade) => ({ shade, d: paths.join(' ') }))
      .filter((r) => r.d.length > 0),
  };
}

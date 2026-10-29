import { Nebula } from './star-map.models';
import { NavObstacle, NavPoint } from './fleet-navigation';

/*
 * =========================================================
 * NEBULAE (shape, procedural generation, gameplay field)
 * =========================================================
 *
 * Nebulae are irregular gas clouds on the galaxy map. Gameplay rules (see
 * docs/star-map-terrain.md):
 *
 * - Movement: a fleet whose current position is inside any nebula moves at
 *   NEBULA_CONFIG.speedMultiplier of its normal galaxy speed. The factor is
 *   applied per movement step from the fleet's position, so the slowdown is
 *   proportional to the distance flown inside the cloud and can never be
 *   applied twice (it is not stored anywhere). Overlapping nebulae do NOT
 *   stack: inside one or several nebulae is the same penalty.
 * - Sensors: a sensor source inside a nebula, or a target cell inside a
 *   nebula, uses NEBULA_CONFIG.sensorMultiplier × the sensor radius. Both
 *   conditions together still apply the multiplier once. Implemented in
 *   StarMapSensorService and shared by the player fog of war and the AI
 *   (EnemyIntelService).
 *
 * Point membership is exact (polar boundary test). Sensor checks work on
 * grid cells, so NebulaField precomputes which cell centers are inside.
 */

export const NEBULA_CONFIG = {
  /* Effective speed while inside a nebula: 0.7 = 30% slower. */
  speedMultiplier: 0.7,
  /* Effective sensor radius when the source or target is inside: 0.6 = 40% shorter. */
  sensorMultiplier: 0.6,
  /* Nebula count per galaxy size (the generator may place fewer if space runs out). */
  countBySize: { small: 3, medium: 4, large: 5 } as Record<string, number>,
  /* Base radius range as a fraction of the map height. */
  minRadiusFraction: 0.12,
  maxRadiusFraction: 0.19,
  /* Number of boundary lobes and their radius multiplier range. */
  minLobes: 9,
  maxLobes: 14,
  minLobeScale: 0.62,
  maxLobeScale: 1.28,
  /* Cells kept clear between a nebula edge and a home system. */
  homeClearance: 4,
  /* Cells kept clear between a nebula edge and a black hole no-fly zone. */
  blackHoleClearance: 4,
  /* Sampling step (cells) used to integrate the slowdown along a route. */
  travelSampleStep: 0.5,
  colors: ['#c0569e', '#4f7fd8', '#7c5cd6', '#3fa5a0', '#d06a6a', '#6f8be8'],
} as const;

/* Largest possible edge distance of a nebula (radius × max lobe). */
export function nebulaOuterRadius(nebula: Nebula): number {
  return nebula.radius * Math.max(...nebula.lobes, 1);
}

/* Edge distance from the nebula center at the given angle (radians). */
export function nebulaRadiusAt(nebula: Nebula, angle: number): number {
  const lobes = nebula.lobes;
  const count = lobes.length;
  if (count === 0) {
    return nebula.radius;
  }
  const turn = Math.PI * 2;
  let t = (((angle - nebula.rotation) % turn) + turn) % turn;
  t = (t / turn) * count;
  const i = Math.floor(t) % count;
  const j = (i + 1) % count;
  const f = t - Math.floor(t);
  // Cosine interpolation gives a smooth, organic edge between lobes.
  const w = (1 - Math.cos(f * Math.PI)) / 2;
  return nebula.radius * (lobes[i] * (1 - w) + lobes[j] * w);
}

export function isPointInNebula(nebula: Nebula, x: number, y: number): boolean {
  const dx = x - nebula.x;
  const dy = y - nebula.y;
  const distSq = dx * dx + dy * dy;
  const outer = nebulaOuterRadius(nebula);
  if (distSq > outer * outer) {
    return false;
  }
  return Math.sqrt(distSq) <= nebulaRadiusAt(nebula, Math.atan2(dy, dx));
}

export function isPointInAnyNebula(nebulae: readonly Nebula[], x: number, y: number): boolean {
  return nebulae.some((n) => isPointInNebula(n, x, y));
}

/*
 * Precomputed per-cell nebula membership for the current map. A cell
 * counts as inside when its center (integer coordinates) is inside.
 */
export class NebulaField {
  private readonly mask: Uint8Array;

  constructor(
    readonly nebulae: readonly Nebula[],
    readonly width: number,
    readonly height: number,
  ) {
    this.mask = new Uint8Array(Math.max(0, width * height));
    for (const nebula of nebulae) {
      const outer = nebulaOuterRadius(nebula);
      const minCol = Math.max(1, Math.floor(nebula.x - outer));
      const maxCol = Math.min(width, Math.ceil(nebula.x + outer));
      const minRow = Math.max(1, Math.floor(nebula.y - outer));
      const maxRow = Math.min(height, Math.ceil(nebula.y + outer));
      for (let col = minCol; col <= maxCol; col++) {
        for (let row = minRow; row <= maxRow; row++) {
          if (isPointInNebula(nebula, col, row)) {
            this.mask[(row - 1) * width + (col - 1)] = 1;
          }
        }
      }
    }
  }

  get isEmpty(): boolean {
    return this.nebulae.length === 0;
  }

  isCellInNebula(col: number, row: number): boolean {
    if (col < 1 || row < 1 || col > this.width || row > this.height) {
      return false;
    }
    return this.mask[(row - 1) * this.width + (col - 1)] === 1;
  }

  isPointInNebula(x: number, y: number): boolean {
    return this.nebulae.length > 0 && isPointInAnyNebula(this.nebulae, x, y);
  }

  speedMultiplierAt(x: number, y: number): number {
    return this.isPointInNebula(x, y) ? NEBULA_CONFIG.speedMultiplier : 1;
  }

  /*
   * Game seconds needed to fly a straight leg at `cellsPerSecond` open-space
   * speed, integrating the nebula slowdown along the leg by sampling. Uses
   * the same point test as the per-frame movement, so the estimate and the
   * real flight agree up to the sampling resolution.
   */
  legTravelSeconds(a: NavPoint, b: NavPoint, cellsPerSecond: number): number {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (cellsPerSecond <= 0) {
      return Infinity;
    }
    if (length === 0) {
      return 0;
    }
    if (this.nebulae.length === 0) {
      return length / cellsPerSecond;
    }
    const steps = Math.max(1, Math.ceil(length / NEBULA_CONFIG.travelSampleStep));
    const stepLength = length / steps;
    let seconds = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const factor = this.speedMultiplierAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      seconds += stepLength / (cellsPerSecond * factor);
    }
    return seconds;
  }

  pathTravelSeconds(points: readonly NavPoint[], cellsPerSecond: number): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this.legTravelSeconds(points[i - 1], points[i], cellsPerSecond);
    }
    return total;
  }
}

export interface NebulaGenerationInput {
  width: number;
  height: number;
  count: number;
  /* Home systems: never covered by a nebula (with homeClearance). */
  homes: readonly NavPoint[];
  obstacles: readonly NavObstacle[];
}

/*
 * Procedurally places nebulae. Deterministic for a given rng stream.
 *
 * Distribution: the map is split into a coarse grid of zones (about twice
 * as many zones as nebulae) and each nebula is placed at a random point
 * inside a different, randomly chosen zone. This spreads clouds across the
 * whole map instead of clustering them in the center or along the edges.
 * A candidate is rejected when it would cover a home system, touch a black
 * hole's no-fly zone, overlap another nebula heavily, or leave the map.
 * Placement gives up on a nebula after a bounded number of attempts, so
 * the result may contain fewer nebulae than requested — never an invalid one.
 */
export function generateNebulae(rng: () => number, input: NebulaGenerationInput): Nebula[] {
  const { width, height, count, homes, obstacles } = input;
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
  shuffleInPlace(rng, zones);

  const nebulae: Nebula[] = [];
  const zoneWidth = width / zoneCols;
  const zoneHeight = height / zoneRows;

  for (const zone of zones) {
    if (nebulae.length >= count) {
      break;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = randomNebula(rng, nebulae.length + 1, width, height, {
        x: (zone.col + rng()) * zoneWidth + 0.5,
        y: (zone.row + rng()) * zoneHeight + 0.5,
      });
      if (isNebulaPlacementValid(candidate, nebulae, input)) {
        nebulae.push(candidate);
        break;
      }
    }
  }
  return nebulae;
}

function randomNebula(
  rng: () => number,
  id: number,
  width: number,
  height: number,
  center: NavPoint,
): Nebula {
  const radius =
    height *
    (NEBULA_CONFIG.minRadiusFraction +
      rng() * (NEBULA_CONFIG.maxRadiusFraction - NEBULA_CONFIG.minRadiusFraction));
  const lobeCount =
    NEBULA_CONFIG.minLobes +
    Math.floor(rng() * (NEBULA_CONFIG.maxLobes - NEBULA_CONFIG.minLobes + 1));
  const lobes: number[] = [];
  for (let i = 0; i < lobeCount; i++) {
    const scale =
      NEBULA_CONFIG.minLobeScale +
      rng() * (NEBULA_CONFIG.maxLobeScale - NEBULA_CONFIG.minLobeScale);
    lobes.push(Math.round(scale * 1000) / 1000);
  }
  return {
    id,
    x: Math.round(Math.min(width, Math.max(1, center.x)) * 10) / 10,
    y: Math.round(Math.min(height, Math.max(1, center.y)) * 10) / 10,
    radius: Math.round(radius * 10) / 10,
    lobes,
    rotation: Math.round(rng() * Math.PI * 2 * 1000) / 1000,
    color: NEBULA_CONFIG.colors[Math.floor(rng() * NEBULA_CONFIG.colors.length)],
  };
}

export function isNebulaPlacementValid(
  candidate: Nebula,
  existing: readonly Nebula[],
  input: Pick<NebulaGenerationInput, 'width' | 'height' | 'homes' | 'obstacles'>,
): boolean {
  const outer = nebulaOuterRadius(candidate);
  // Keep most of the cloud on the map.
  const inset = outer * 0.5;
  if (
    candidate.x < inset ||
    candidate.y < inset ||
    candidate.x > input.width - inset ||
    candidate.y > input.height - inset
  ) {
    return false;
  }
  for (const home of input.homes) {
    if (
      Math.hypot(home.x - candidate.x, home.y - candidate.y) <
      outer + NEBULA_CONFIG.homeClearance
    ) {
      return false;
    }
  }
  for (const obstacle of input.obstacles) {
    if (
      Math.hypot(obstacle.x - candidate.x, obstacle.y - candidate.y) <
      outer + obstacle.radius + NEBULA_CONFIG.blackHoleClearance
    ) {
      return false;
    }
  }
  for (const other of existing) {
    const minGap = (outer + nebulaOuterRadius(other)) * 0.75;
    if (Math.hypot(other.x - candidate.x, other.y - candidate.y) < minGap) {
      return false;
    }
  }
  return true;
}

/*
 * Structural check used by save validation and galaxy validation. A
 * malformed nebula would break point tests (NaN) and rendering.
 */
export function isWellFormedNebula(value: unknown): value is Nebula {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const n = value as Partial<Nebula>;
  return (
    [n.id, n.x, n.y, n.radius, n.rotation].every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) &&
    (n.radius ?? 0) > 0 &&
    Array.isArray(n.lobes) &&
    n.lobes.length >= 3 &&
    n.lobes.every((l) => typeof l === 'number' && Number.isFinite(l) && l > 0) &&
    typeof n.color === 'string'
  );
}

/*
 * SVG path (closed, smooth) of the nebula boundary scaled by `scale`, in
 * SVG user units where 1 unit = 1 grid cell and the cell with coordinate N
 * is centered at N - 0.5 (the galaxy view's cell layout). Rendering only.
 */
export function nebulaSvgPath(nebula: Nebula, scale = 1, samples = 40): string {
  const points: NavPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const r = nebulaRadiusAt(nebula, angle) * scale;
    points.push({
      x: nebula.x - 0.5 + r * Math.cos(angle),
      y: nebula.y - 0.5 + r * Math.sin(angle),
    });
  }
  // Closed Catmull-Rom spline converted to cubic Bézier segments.
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 0; i < samples; i++) {
    const p0 = points[(i - 1 + samples) % samples];
    const p1 = points[i];
    const p2 = points[(i + 1) % samples];
    const p3 = points[(i + 2) % samples];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return `${d} Z`;
}

function shuffleInPlace<T>(rng: () => number, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

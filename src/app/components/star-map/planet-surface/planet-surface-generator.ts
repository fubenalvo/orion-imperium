import { PlanetBuilding, PlanetSurface, PlanetTile, ResourceDeposit } from '../star-map.models';
import {
  encodeBlockedMask,
  getBlockedMask,
  getPlanetGridSize,
  planetSurfaceSeed,
} from './planet-surface';
import { PLANET_SURFACE_MARGIN, PlanetSurfaceField, SURFACE_LAND_LIMIT } from './planet-surface-field';

/*
 * =========================================================
 * PLANET SURFACE GENERATOR
 * =========================================================
 *
 * Produces the persisted PlanetSurface record (seed + blocked mask) for a
 * planet. Runs at new-game generation, in the v6 save migration and as a
 * load-time backfill for planets that lack a usable surface.
 *
 * Guarantees (relied on by placement code and covered by tests):
 * - `keepClear` cells (existing buildings, deposits) are never blocked, so
 *   generating terrain for an existing colony never invalidates it.
 * - At most MAX_BLOCKED_FRACTION of the grid is blocked: the generator
 *   retries with shallower intrusions and finally falls back to a fully
 *   buildable grid (environment only outside the grid).
 * - Tiny obstacle specks inside the grid are dropped and tiny enclosed
 *   buildable pockets are folded into the obstacles (tidyRegions).
 */

export const PLANET_SURFACE_VERSION = 1;
const MAX_BLOCKED_FRACTION = 0.2;
const INTRUSION_STEPS = [1, 0.6, 0.3, 0];
/* A cell is blocked when at least this many of its 3×3 samples are not land. */
const BLOCKING_SAMPLES = 3;
const MIN_POCKET_CELLS = 3;

/*
 * Samples each cell at its corners, edge midpoints and center. The samples
 * live on a shared half-cell lattice, so neighbouring cells reuse each
 * other's values (≈2× fewer field evaluations), and cells deep inside the
 * grid that the field mask can never reach are skipped entirely. This runs
 * for every planet of every new galaxy, so it has to stay cheap.
 */
export function computeBlockedMask(field: PlanetSurfaceField, keepClear: ReadonlySet<number>): Uint8Array {
  const n = field.gridSize;
  const m = field.margin;
  const mask = new Uint8Array(n * n);
  if (field.intrusion <= 0) return mask;
  const side = n * 2 + 1;
  const lattice = new Float32Array(side * side).fill(Number.NaN);
  const sample = (i: number, j: number): number => {
    const k = j * side + i;
    let f = lattice[k];
    if (Number.isNaN(f)) {
      f = field.value(m + i / 2, m + j / 2);
      lattice[k] = f;
    }
    return f;
  };
  const unreachable = -(field.maxReach() + 0.75);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (keepClear.has(y * n + x)) continue;
      if (field.gridDistance(m + x + 0.5, m + y + 0.5) < unreachable) continue;
      let hits = 0;
      for (let sj = 0; sj < 3 && hits < BLOCKING_SAMPLES; sj++) {
        for (let si = 0; si < 3; si++) {
          if (Math.abs(sample(x * 2 + si, y * 2 + sj)) > SURFACE_LAND_LIMIT) hits++;
        }
      }
      if (hits >= BLOCKING_SAMPLES) mask[y * n + x] = 1;
    }
  }
  tidyRegions(mask, n, keepClear);
  return mask;
}

/*
 * Removes visual noise from the mask: tiny obstacle specks that do not touch
 * the grid border are cleared (terrain should frame the colony, not pepper
 * it), and tiny buildable pockets enclosed by terrain are blocked so the
 * buildable area reads as one organic shape. Pockets holding existing
 * buildings or deposits are never blocked.
 */
function tidyRegions(mask: Uint8Array, n: number, keepClear: ReadonlySet<number>): void {
  for (const region of collectRegions(mask, n, 1)) {
    const touchesBorder = region.some((cell) => {
      const x = cell % n;
      const y = (cell - x) / n;
      return x === 0 || y === 0 || x === n - 1 || y === n - 1;
    });
    if (region.length < MIN_POCKET_CELLS && !touchesBorder) {
      for (const cell of region) mask[cell] = 0;
    }
  }
  for (const region of collectRegions(mask, n, 0)) {
    if (region.length < MIN_POCKET_CELLS && !region.some((cell) => keepClear.has(cell))) {
      for (const cell of region) mask[cell] = 1;
    }
  }
}

/** 4-connected regions of cells whose mask value equals `value`. */
function collectRegions(mask: Uint8Array, n: number, value: 0 | 1): number[][] {
  const seen = new Uint8Array(n * n);
  const regions: number[][] = [];
  for (let start = 0; start < n * n; start++) {
    if (mask[start] !== value || seen[start]) continue;
    const region: number[] = [start];
    seen[start] = 1;
    for (let i = 0; i < region.length; i++) {
      const cell = region[i];
      const x = cell % n;
      const y = (cell - x) / n;
      const neighbours = [
        x > 0 ? cell - 1 : -1,
        x < n - 1 ? cell + 1 : -1,
        y > 0 ? cell - n : -1,
        y < n - 1 ? cell + n : -1,
      ];
      for (const nb of neighbours) {
        if (nb >= 0 && mask[nb] === value && !seen[nb]) {
          seen[nb] = 1;
          region.push(nb);
        }
      }
    }
    regions.push(region);
  }
  return regions;
}

/** Grid cell indices (y * N + x) covered by buildings and deposits. */
export function occupiedCells(planet: PlanetTile, gridSize: number = getPlanetGridSize(planet)): Set<number> {
  const cells = new Set<number>();
  for (const b of planet.buildings ?? []) {
    for (let y = b.y; y < b.y + b.size; y++) {
      for (let x = b.x; x < b.x + b.size; x++) {
        if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) cells.add(y * gridSize + x);
      }
    }
  }
  for (const r of planet.resourceTiles ?? []) {
    if (r.x >= 0 && r.y >= 0 && r.x < gridSize && r.y < gridSize) cells.add(r.y * gridSize + r.x);
  }
  return cells;
}

/**
 * Generates the surface terrain record for a planet. Existing buildings and
 * deposits are kept buildable. Pure and deterministic for
 * (galaxySeed, planet id, type, size, occupied cells).
 */
export function generatePlanetSurface(planet: PlanetTile, galaxySeed: number): PlanetSurface {
  const gridSize = getPlanetGridSize(planet);
  const seed = planetSurfaceSeed(galaxySeed, planet.id);
  const keepClear = occupiedCells(planet, gridSize);
  let mask: Uint8Array = new Uint8Array(gridSize * gridSize);
  let intrusion = 0;
  for (const step of INTRUSION_STEPS) {
    const field = new PlanetSurfaceField(seed, planet.type, gridSize, PLANET_SURFACE_MARGIN, step);
    const candidate = computeBlockedMask(field, keepClear);
    const blocked = candidate.reduce((sum, v) => sum + v, 0);
    if (blocked <= gridSize * gridSize * MAX_BLOCKED_FRACTION) {
      mask = candidate;
      intrusion = step;
      break;
    }
  }
  return {
    version: PLANET_SURFACE_VERSION,
    seed,
    gridSize,
    intrusion,
    blocked: encodeBlockedMask(mask, gridSize),
  };
}

/** True when the planet's stored surface is missing or no longer matches its grid. */
export function needsSurface(planet: PlanetTile): boolean {
  return getBlockedMask(planet) === null;
}

/**
 * Re-centers a building layout (authored at the grid origin) on a grid.
 * Used for the generator's homeworld and colony templates.
 */
export function centerLayout(layout: readonly PlanetBuilding[], gridSize: number): PlanetBuilding[] {
  if (layout.length === 0) return [];
  const maxX = Math.max(...layout.map((b) => b.x + b.size));
  const maxY = Math.max(...layout.map((b) => b.y + b.size));
  const minX = Math.min(...layout.map((b) => b.x));
  const minY = Math.min(...layout.map((b) => b.y));
  const offsetX = Math.floor((gridSize - (maxX - minX)) / 2) - minX;
  const offsetY = Math.floor((gridSize - (maxY - minY)) / 2) - minY;
  return layout.map((b) => ({ ...b, x: b.x + offsetX, y: b.y + offsetY }));
}

/**
 * Chebyshev distance from every grid cell to the nearest blocked cell or
 * the grid border (border counts as distance 1 from edge cells).
 */
function clearanceMap(mask: Uint8Array | null, n: number): Int32Array {
  const dist = new Int32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let d = Math.min(x + 1, y + 1, n - x, n - y);
      if (mask) {
        for (let r = 1; r < d; r++) {
          let hit = false;
          for (let yy = y - r; yy <= y + r && !hit; yy++) {
            for (let xx = x - r; xx <= x + r; xx++) {
              if (xx >= 0 && yy >= 0 && xx < n && yy < n && mask[yy * n + xx]) {
                hit = true;
                break;
              }
            }
          }
          if (hit) {
            d = r;
            break;
          }
        }
      }
      dist[y * n + x] = d;
    }
  }
  return dist;
}

/**
 * Picks deposit cells on buildable ground with room around them, so a 3×3
 * Mining Complex always has somewhere to stand next to the deposit.
 * Deterministic per planet id (same rng stream as the original generator).
 */
export function pickResourceDeposits(
  planet: PlanetTile,
  gridSize: number,
  rng: () => number,
): ResourceDeposit[] {
  const mask = getBlockedMask(planet);
  const occupied = occupiedCells({ ...planet, resourceTiles: [] }, gridSize);
  const clearance = clearanceMap(mask, gridSize);
  const free = (cell: number) => !(mask && mask[cell]) && !occupied.has(cell);
  const pickFrom = (minClearance: number, taken: Set<number>): ResourceDeposit | null => {
    const candidates: number[] = [];
    for (let cell = 0; cell < gridSize * gridSize; cell++) {
      if (free(cell) && !taken.has(cell) && clearance[cell] >= minClearance) candidates.push(cell);
    }
    if (candidates.length === 0) return null;
    const cell = candidates[Math.floor(rng() * candidates.length)];
    return { type: 'rawmaterial', x: cell % gridSize, y: Math.floor(cell / gridSize) };
  };
  const pick = (taken: Set<number>) => pickFrom(4, taken) ?? pickFrom(2, taken) ?? pickFrom(1, taken);

  const tiles: ResourceDeposit[] = [];
  const taken = new Set<number>();
  const first = pick(taken);
  if (first) {
    tiles.push(first);
    taken.add(first.y * gridSize + first.x);
  }
  if (rng() < 0.05) {
    const second = pick(taken);
    if (second) tiles.push(second);
  }
  return tiles;
}

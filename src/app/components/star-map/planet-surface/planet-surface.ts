import { PLANET_SIZE_MAP, PlanetSize, PlanetSurface, PlanetTile } from '../star-map.models';

/*
 * =========================================================
 * PLANET SURFACE — grid dimensions and terrain occupancy
 * =========================================================
 *
 * Single source of truth for the planet surface grid used by every system
 * that places or validates buildings (player build mode, AI construction,
 * galaxy generation, save validation). See docs/planet-surface.md.
 *
 * Coordinates: buildings and deposits use 0-indexed grid cells
 * (x = column, y = row) inside an N×N grid, N = getPlanetGridSize(planet).
 *
 * Terrain occupancy: `planet.surface.blocked` is the authoritative list of
 * cells covered by environmental obstacles (water, cliffs, rock, chasms).
 * It is generated once (new game or save migration) and persisted; the
 * visual terrain is re-derived from `surface.seed` but is always flattened
 * to match the stored mask, so gameplay and visuals cannot disagree.
 * A planet without a surface (or with a stale one) has no blocked cells —
 * placement never fails because terrain data is missing.
 */

/** Grid side length per numeric planet size: 1→10, 2→14, 3→18, 4→22. */
export function gridSizeForNumericSize(numericSize: number): number {
  return numericSize * 4 + 6;
}

/** Grid side length of a planet's surface. */
export function getPlanetGridSize(planet: { size: PlanetSize | string }): number {
  return gridSizeForNumericSize(PLANET_SIZE_MAP[planet.size as PlanetSize] ?? 3);
}

/**
 * Grid side length used before surfaces were doubled (save version < 6).
 * Only the save migration may use this.
 */
export function legacyPlanetGridSize(planet: { size: PlanetSize | string }): number {
  return (PLANET_SIZE_MAP[planet.size as PlanetSize] ?? 3) * 2 + 3;
}

/** Deterministic per-planet surface seed derived from the galaxy seed. */
export function planetSurfaceSeed(galaxySeed: number, planetId: number): number {
  let h = (galaxySeed >>> 0) ^ Math.imul(planetId + 0x632be5ab, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/*
 * Mask encoding: one row after another, each row as ceil(N/4) hex digits;
 * bit (x % 4) of digit floor(x / 4) is cell x of that row. Compact enough
 * for localStorage (≤ 132 chars for the largest grid) and trivial to validate.
 */
export function encodeBlockedMask(mask: Uint8Array, gridSize: number): string {
  const digitsPerRow = Math.ceil(gridSize / 4);
  let out = '';
  for (let y = 0; y < gridSize; y++) {
    for (let d = 0; d < digitsPerRow; d++) {
      let nibble = 0;
      for (let bit = 0; bit < 4; bit++) {
        const x = d * 4 + bit;
        if (x < gridSize && mask[y * gridSize + x]) nibble |= 1 << bit;
      }
      out += nibble.toString(16);
    }
  }
  return out;
}

export function decodeBlockedMask(blocked: string, gridSize: number): Uint8Array {
  const mask = new Uint8Array(gridSize * gridSize);
  const digitsPerRow = Math.ceil(gridSize / 4);
  for (let y = 0; y < gridSize; y++) {
    for (let d = 0; d < digitsPerRow; d++) {
      const nibble = parseInt(blocked.charAt(y * digitsPerRow + d) || '0', 16) || 0;
      for (let bit = 0; bit < 4; bit++) {
        const x = d * 4 + bit;
        if (x < gridSize && nibble & (1 << bit)) mask[y * gridSize + x] = 1;
      }
    }
  }
  return mask;
}

export function isWellFormedBlockedMask(blocked: unknown, gridSize: number): boolean {
  return (
    typeof blocked === 'string' &&
    blocked.length === gridSize * Math.ceil(gridSize / 4) &&
    /^[0-9a-f]*$/.test(blocked)
  );
}

// Surfaces are immutable once generated, so decoding once per object is safe;
// AI placement scans call isFootprintBlocked thousands of times per tick.
const maskCache = new WeakMap<PlanetSurface, Uint8Array>();

/**
 * Decoded blocked mask of a planet, or null when the planet has no usable
 * surface (missing, or generated for a different grid size).
 */
export function getBlockedMask(planet: PlanetTile): Uint8Array | null {
  const surface = planet.surface;
  if (!surface) return null;
  const gridSize = getPlanetGridSize(planet);
  if (surface.gridSize !== gridSize || !isWellFormedBlockedMask(surface.blocked, gridSize)) {
    return null;
  }
  let mask = maskCache.get(surface);
  if (!mask) {
    mask = decodeBlockedMask(surface.blocked, gridSize);
    maskCache.set(surface, mask);
  }
  return mask;
}

export function isSurfaceCellBlocked(planet: PlanetTile, x: number, y: number): boolean {
  const mask = getBlockedMask(planet);
  if (!mask) return false;
  const n = getPlanetGridSize(planet);
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  return mask[y * n + x] === 1;
}

/** True when any cell of the size×size footprint at (x, y) is terrain-blocked. */
export function isFootprintBlocked(planet: PlanetTile, x: number, y: number, size: number): boolean {
  const mask = getBlockedMask(planet);
  if (!mask) return false;
  const n = getPlanetGridSize(planet);
  for (let r = y; r < y + size; r++) {
    for (let c = x; c < x + size; c++) {
      if (c >= 0 && r >= 0 && c < n && r < n && mask[r * n + c] === 1) return true;
    }
  }
  return false;
}

/**
 * Candidate top-left positions for a size×size footprint, ordered from the
 * grid center outward (row-major tie-break). AI construction uses this order
 * so colonies grow as a compact settlement around the center instead of
 * filling the top-left corner first.
 */
export function centerOutPlacementOrder(
  gridSize: number,
  size: number,
): readonly { readonly x: number; readonly y: number }[] {
  const key = `${gridSize}:${size}`;
  const cached = placementOrderCache.get(key);
  if (cached) return cached;
  const positions: { x: number; y: number; d: number }[] = [];
  const center = gridSize / 2;
  for (let y = 0; y + size <= gridSize; y++) {
    for (let x = 0; x + size <= gridSize; x++) {
      const dx = x + size / 2 - center;
      const dy = y + size / 2 - center;
      positions.push({ x, y, d: dx * dx + dy * dy });
    }
  }
  positions.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const order = positions.map(({ x, y }) => ({ x, y }));
  placementOrderCache.set(key, order);
  return order;
}

const placementOrderCache = new Map<string, readonly { x: number; y: number }[]>();

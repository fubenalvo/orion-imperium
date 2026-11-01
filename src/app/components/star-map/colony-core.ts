import planetData from './planet-data.json';
import { PlanetTile } from './star-map.models';
import {
  centerOutPlacementOrder,
  decodeBlockedMask,
  encodeBlockedMask,
  getBlockedMask,
  getPlanetGridSize,
} from './planet-surface/planet-surface';

/*
 * =========================================================
 * COLONY CORES
 * =========================================================
 *
 * Every planet a faction owns has exactly one core building (role `core` in
 * planet-data.json): the Capital on a generated homeworld, the Colony Center
 * everywhere else. The core carries the planet's base values — population
 * ceiling, workforce and a flat energy supply — so they are tuned in the
 * building data instead of being hidden constants (docs/economy.md,
 * "Colony cores").
 *
 * Rules:
 *  - Cores are never built by hand (no technology unlocks them, the build
 *    list hides `autoPlaced` buildings) and cost nothing, neither price nor
 *    upkeep.
 *  - They are placed automatically: by the galaxy generator in the starting
 *    layouts, by PlanetOwnershipService whenever a faction (not
 *    `independent`) takes a planet without one, and by StarMap on load for
 *    owned planets from older saves.
 *  - A core stays with the planet through capture and rebellion; there is no
 *    demolition. A captured Capital stays a Capital.
 *  - Placement: the free spot nearest to the grid center (same order as AI
 *    construction). When terrain leaves no room, the nearest spot that is
 *    free of buildings and deposits is cleared of terrain instead, so a core
 *    can only be missing on a planet whose grid is completely built over.
 */

export const CAPITAL_ID = 'capital';
export const COLONY_CENTER_ID = 'colony_center';

interface CoreDef {
  id: string;
  name: string;
  size: number;
  role?: string;
}

const BUILDINGS = (planetData as { buildings: CoreDef[] }).buildings;
const CORE_NAMES = new Set(BUILDINGS.filter((b) => b.role === 'core').map((b) => b.name));

function coreDef(id: string): CoreDef {
  const def = BUILDINGS.find((b) => b.id === id);
  if (!def) throw new Error(`Missing core building "${id}" in planet-data.json`);
  return def;
}

export const CAPITAL = coreDef(CAPITAL_ID);
export const COLONY_CENTER = coreDef(COLONY_CENTER_ID);

/* True for a real faction; the neutral `unhabited` and `independent` owners never get a core. */
export function isCoreOwner(factionId: string | null | undefined): boolean {
  return !!factionId && factionId !== 'unhabited' && factionId !== 'independent';
}

export function isCoreBuildingName(name: string): boolean {
  return CORE_NAMES.has(name);
}

export function hasColonyCore(planet: PlanetTile): boolean {
  return (planet.buildings ?? []).some((b) => CORE_NAMES.has(b.name));
}

/*
 * Gives `planet` a core if it has none. Returns true when one was placed.
 * Idempotent: a planet that already has any core is left unchanged.
 */
export function ensureColonyCore(planet: PlanetTile, coreId: string = COLONY_CENTER_ID): boolean {
  if (hasColonyCore(planet)) return false;
  const def = coreDef(coreId);
  const spot = findCoreSpot(planet, def.size);
  if (!spot) return false;
  if (spot.clearTerrain) clearTerrain(planet, spot.x, spot.y, def.size);
  planet.buildings = [...(planet.buildings ?? []), { name: def.name, size: def.size, x: spot.x, y: spot.y }];
  return true;
}

function findCoreSpot(planet: PlanetTile, size: number): { x: number; y: number; clearTerrain: boolean } | null {
  const n = getPlanetGridSize(planet);
  const mask = getBlockedMask(planet);
  const taken = new Uint8Array(n * n);
  for (const b of planet.buildings ?? []) mark(taken, n, b.x, b.y, b.size);
  for (const r of planet.resourceTiles ?? []) mark(taken, n, r.x, r.y, 1);

  let fallback: { x: number; y: number } | null = null;
  for (const { x, y } of centerOutPlacementOrder(n, size)) {
    if (anySet(taken, n, x, y, size)) continue;
    if (!mask || !anySet(mask, n, x, y, size)) return { x, y, clearTerrain: false };
    fallback ??= { x, y };
  }
  return fallback ? { ...fallback, clearTerrain: true } : null;
}

/*
 * Surfaces are cached by object identity (planet-surface.ts), so the mask is
 * replaced with a new surface object rather than edited in place.
 */
function clearTerrain(planet: PlanetTile, x: number, y: number, size: number): void {
  const surface = planet.surface;
  if (!surface) return;
  const n = getPlanetGridSize(planet);
  const mask = decodeBlockedMask(surface.blocked, n);
  for (let r = y; r < y + size; r++) {
    for (let c = x; c < x + size; c++) mask[r * n + c] = 0;
  }
  planet.surface = { ...surface, blocked: encodeBlockedMask(mask, n) };
}

function mark(cells: Uint8Array, n: number, x: number, y: number, size: number): void {
  for (let r = y; r < y + size; r++) {
    for (let c = x; c < x + size; c++) {
      if (c >= 0 && r >= 0 && c < n && r < n) cells[r * n + c] = 1;
    }
  }
}

function anySet(cells: Uint8Array, n: number, x: number, y: number, size: number): boolean {
  for (let r = y; r < y + size; r++) {
    for (let c = x; c < x + size; c++) {
      if (cells[r * n + c]) return true;
    }
  }
  return false;
}

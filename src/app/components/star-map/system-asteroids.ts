import { Fleet, PlanetTile, StarSystem, SystemAsteroid, SystemAsteroidBelt } from './star-map.models';
import {
  SYSTEM_FLEET_ENTRY_VW,
  SYSTEM_GRID_COLUMNS,
  SYSTEM_GRID_ROWS,
  SYSTEM_PLANET_FOOTPRINT,
  SYSTEM_SUN_CENTER_X_VW,
  SYSTEM_SUN_CENTER_Y_VW,
  planetFootprintCenterVw,
  planetFootprintOrigin,
  systemCellAtVw,
  systemCellCenterVw,
} from './system-grid';
import { createSurfaceRng } from './planet-surface/planet-surface-field';

/*
 * In-system asteroid belts (docs/game-systems.md, "Star system view").
 *
 * Every star system has one belt: a ring of single-cell asteroids around the
 * star, placed in a gap between planet orbits. One asteroid in ten (rounded,
 * at least one per belt) holds a large raw-material deposit. Which one is
 * hidden until a human player fleet has been on that cell ("surveyed").
 *
 * - Generation is deterministic from (galaxy seed, system id) and uses its
 *   own rng, so it never disturbs the galaxy layout stream. The belt is
 *   still persisted on the StarSystem because survey results live in it.
 * - Asteroids never overlap a planet footprint or the ring of cells around
 *   it, and do not block movement.
 * - Surveying is player-only and only reveals the deposit. Nothing extracts
 *   raw materials yet; the AI ignores belts entirely.
 */
export const SYSTEM_ASTEROID_CONFIG = {
  generatorVersion: 1,
  /* Belt center-line radius limits (vw from the star center). The inner
     limit keeps the belt out of the star's glow. */
  minRadiusVw: 26,
  maxRadiusVw: 88,
  /* Half-thickness (vw) of the band a cell center must fall in. */
  halfWidthVw: 3.6,
  /* Minimum distance (vw) between the belt line and any planet orbit. */
  planetOrbitClearanceVw: 6,
  /* Probability that a cell inside the band holds an asteroid. */
  density: 0.5,
  /* Below this the belt would look like stray rocks; try another radius. */
  minAsteroids: 14,
  /* Share of asteroids holding a deposit (rounded, at least one). */
  richShare: 0.1,
  richRawMaterials: { min: 2000, max: 4000 },
  radiusAttempts: 12,
} as const;

/* Seed for one system's belt, mixed from the galaxy seed and the system id. */
export function systemAsteroidSeed(galaxySeed: number, systemId: string): number {
  let h = (galaxySeed >>> 0) ^ 0x2c1b3c6d;
  for (let i = 0; i < systemId.length; i++) {
    h = Math.imul(h ^ systemId.charCodeAt(i), 0x9e3779b1);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function distanceToSun(x: number, y: number): number {
  return Math.hypot(x - SYSTEM_SUN_CENTER_X_VW, y - SYSTEM_SUN_CENTER_Y_VW);
}

/*
 * Cells covered by planets plus a one-cell margin around each footprint, and
 * the fleet entry cell (a fleet appearing there would survey it for free).
 */
function planetKeepOutCells(planets: PlanetTile[]): Set<string> {
  const entry = systemCellAtVw(SYSTEM_FLEET_ENTRY_VW.x, SYSTEM_FLEET_ENTRY_VW.y);
  const blocked = new Set<string>([`${entry.col},${entry.row}`]);
  for (const planet of planets) {
    const origin = planetFootprintOrigin(planet);
    for (let c = origin.col - 1; c <= origin.col + SYSTEM_PLANET_FOOTPRINT; c++) {
      for (let r = origin.row - 1; r <= origin.row + SYSTEM_PLANET_FOOTPRINT; r++) {
        blocked.add(`${c},${r}`);
      }
    }
  }
  return blocked;
}

/*
 * Radii free of planet orbits, as [from, to] intervals. A belt line inside
 * one keeps planetOrbitClearanceVw from every orbit.
 */
function freeRadiusIntervals(planets: PlanetTile[]): [number, number][] {
  const cfg = SYSTEM_ASTEROID_CONFIG;
  let intervals: [number, number][] = [[cfg.minRadiusVw, cfg.maxRadiusVw]];
  for (const planet of planets) {
    const center = planetFootprintCenterVw(planet);
    const orbit = distanceToSun(center.x, center.y);
    const lo = orbit - cfg.planetOrbitClearanceVw;
    const hi = orbit + cfg.planetOrbitClearanceVw;
    intervals = intervals.flatMap(([a, b]): [number, number][] => {
      if (hi <= a || lo >= b) return [[a, b]];
      const parts: [number, number][] = [];
      if (lo > a) parts.push([a, lo]);
      if (hi < b) parts.push([hi, b]);
      return parts;
    });
  }
  return intervals.filter(([a, b]) => b > a);
}

/* A radius drawn uniformly over the free intervals (any radius if none is free). */
function pickRadius(rng: () => number, intervals: [number, number][]): number {
  const cfg = SYSTEM_ASTEROID_CONFIG;
  const total = intervals.reduce((sum, [a, b]) => sum + (b - a), 0);
  if (total <= 0) {
    return cfg.minRadiusVw + rng() * (cfg.maxRadiusVw - cfg.minRadiusVw);
  }
  let t = rng() * total;
  for (const [a, b] of intervals) {
    if (t <= b - a) return a + t;
    t -= b - a;
  }
  const last = intervals[intervals.length - 1];
  return last[1];
}

function layBelt(rng: () => number, radius: number, keepOut: Set<string>): SystemAsteroid[] {
  const cfg = SYSTEM_ASTEROID_CONFIG;
  const asteroids: SystemAsteroid[] = [];
  for (let row = 1; row <= SYSTEM_GRID_ROWS; row++) {
    for (let col = 1; col <= SYSTEM_GRID_COLUMNS; col++) {
      // Both draws happen for every cell so the stream does not depend on
      // which cells are kept out.
      const edgeNoise = rng();
      const fill = rng();
      if (keepOut.has(`${col},${row}`)) continue;
      const center = systemCellCenterVw(col, row);
      const offset = Math.abs(distanceToSun(center.x, center.y) - radius);
      // Ragged edges: the band is 75%–125% of its nominal half-width per cell.
      if (offset > cfg.halfWidthVw * (0.75 + 0.5 * edgeNoise)) continue;
      if (fill >= cfg.density) continue;
      asteroids.push({ col, row, rawMaterials: 0, surveyed: false });
    }
  }
  return asteroids;
}

export function generateSystemAsteroidBelt(galaxySeed: number, system: StarSystem): SystemAsteroidBelt {
  const cfg = SYSTEM_ASTEROID_CONFIG;
  const rng = createSurfaceRng(systemAsteroidSeed(galaxySeed, system.id));
  const planets = Array.isArray(system.planetsTiles) ? system.planetsTiles : [];
  const keepOut = planetKeepOutCells(planets);
  const intervals = freeRadiusIntervals(planets);

  let radius = pickRadius(rng, intervals);
  let asteroids = layBelt(rng, radius, keepOut);
  // Large radii only clip the grid's corner; prefer the fullest attempt.
  for (let attempt = 1; attempt < cfg.radiusAttempts && asteroids.length < cfg.minAsteroids; attempt++) {
    const candidateRadius = pickRadius(rng, intervals);
    const candidate = layBelt(rng, candidateRadius, keepOut);
    if (candidate.length > asteroids.length) {
      radius = candidateRadius;
      asteroids = candidate;
    }
  }

  if (asteroids.length > 0) {
    const richCount = Math.max(1, Math.round(asteroids.length * cfg.richShare));
    const order = asteroids.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const { min, max } = cfg.richRawMaterials;
    for (const index of order.slice(0, richCount)) {
      asteroids[index].rawMaterials = Math.round((min + rng() * (max - min)) / 50) * 50;
    }
  }

  return { version: cfg.generatorVersion, radiusVw: Math.round(radius * 100) / 100, asteroids };
}

function isValidBelt(belt: unknown): belt is SystemAsteroidBelt {
  if (!belt || typeof belt !== 'object') return false;
  const b = belt as Partial<SystemAsteroidBelt>;
  return (
    typeof b.version === 'number' &&
    typeof b.radiusVw === 'number' &&
    Number.isFinite(b.radiusVw) &&
    Array.isArray(b.asteroids) &&
    b.asteroids.every(
      (a) =>
        !!a &&
        Number.isInteger(a.col) &&
        Number.isInteger(a.row) &&
        typeof a.rawMaterials === 'number' &&
        Number.isFinite(a.rawMaterials) &&
        a.rawMaterials >= 0 &&
        typeof a.surveyed === 'boolean',
    )
  );
}

/*
 * Gives every system without a (well-formed) belt its deterministic one.
 * Idempotent: existing belts, and the survey state in them, are kept.
 * Planet positions must already be on the current grid.
 */
export function ensureSystemAsteroidBelts(systems: StarSystem[], galaxySeed: number): void {
  for (const system of systems) {
    if (!system || typeof system !== 'object' || typeof system.id !== 'string') continue;
    if (!isValidBelt(system.asteroidBelt)) {
      system.asteroidBelt = generateSystemAsteroidBelt(galaxySeed, system);
    }
  }
}

export interface AsteroidSurveyResult {
  fleet: Fleet;
  system: StarSystem;
  asteroid: SystemAsteroid;
}

/*
 * Marks asteroids under human player fleets as surveyed. Any presence on the
 * cell counts, including flying through it. Returns only newly surveyed
 * asteroids so callers can announce discoveries once.
 */
export function surveySystemAsteroids(
  fleets: Fleet[],
  systems: StarSystem[],
  playerFactionId = 'player',
): AsteroidSurveyResult[] {
  const results: AsteroidSurveyResult[] = [];
  let systemsById: Map<string, StarSystem> | null = null;
  for (const fleet of fleets) {
    if (fleet.destroyed || fleet.factionId !== playerFactionId || !fleet.system?.id) continue;
    systemsById ??= new Map(systems.map((s) => [s.id, s]));
    const system = systemsById.get(fleet.system.id);
    const belt = system?.asteroidBelt;
    if (!system || !belt) continue;
    const cell = systemCellAtVw(fleet.system.x, fleet.system.y);
    const asteroid = belt.asteroids.find((a) => a.col === cell.col && a.row === cell.row);
    if (asteroid && !asteroid.surveyed) {
      asteroid.surveyed = true;
      results.push({ fleet, system, asteroid });
    }
  }
  return results;
}

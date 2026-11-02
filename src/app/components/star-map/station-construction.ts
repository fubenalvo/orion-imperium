import { StarSystem, SystemAsteroid } from './star-map.models';

/*
 * =========================================================
 * STATION CONSTRUCTION (pure rules, shared by every station type)
 * =========================================================
 *
 * A deployed station is not finished at once. Deployment consumes the ship
 * and leaves a construction site on the station's spot; the station is
 * complete after its construction time of scaled game time
 * (STATION_CONSTRUCTION_SECONDS). See docs/territory.md, "Construction".
 *
 * While under construction a station:
 * - already reserves its spot: one station per asteroid, base spacing,
 *   and the AI counts it as planned (it is a real SpaceBase / MiningStation
 *   record, only with `constructionRemaining` set);
 * - does NOT claim territory, sense, extract or pay upkeep — every consumer
 *   of those functions asks isStationComplete;
 * - can be attacked under the usual station battle rules, but defends with
 *   the construction site only (CONSTRUCTION_SITE_STATS: no attack, no
 *   turrets, no shield), so any hostile warship fleet destroys it.
 *
 * On completion the site's battle damage is discarded: the finished station
 * starts with a full core hull and shield pool.
 *
 * `constructionRemaining` is an optional saved field; missing (or not a
 * positive number) means complete, so it needs no save version bump.
 */
export const STATION_CONSTRUCTION_SECONDS = {
  spaceBase: 60,
  miningStation: 180,
} as const;

/* The construction site's only battle unit: it soaks damage, never fires. */
export const CONSTRUCTION_SITE_STATS = {
  id: 'construction_site',
  name: 'Construction Site',
  role: 'defense',
  hitPoints: 300,
  attack: 0,
  attackType: 'kinetic',
  weakness: 'energy',
  defense: 0,
  range: 1,
  fireRate: 1,
} as const;

export interface StationConstructionState {
  /* Seconds of game time until the station is complete. Missing = complete. */
  constructionRemaining?: number;
}

export function isStationComplete(station: StationConstructionState): boolean {
  const left = station.constructionRemaining;
  return !(typeof left === 'number' && Number.isFinite(left) && left > 0);
}

/* 0 … 1 share of the construction done (1 = complete). */
export function constructionProgress(station: StationConstructionState, totalSeconds: number): number {
  if (isStationComplete(station) || totalSeconds <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - station.constructionRemaining! / totalSeconds));
}

/* "Under construction · 42 s left" — rounds up so it never shows 0 s before completion. */
export function describeConstruction(station: StationConstructionState): string {
  return `Under construction · ${Math.ceil(station.constructionRemaining ?? 0)} s left`;
}

/*
 * Advances one station's construction by `deltaSeconds`. Returns true when
 * the station completed during this step; the site's battle damage is then
 * dropped so the finished station starts at full hull and shield.
 */
export function advanceStationConstruction(
  station: StationConstructionState & { hullCurrent?: number; shieldPoolCurrent?: number },
  deltaSeconds: number,
): boolean {
  if (isStationComplete(station)) {
    // Normalizes a malformed or zero value to the canonical "complete".
    delete station.constructionRemaining;
    return false;
  }
  if (!(deltaSeconds > 0)) return false;
  const left = station.constructionRemaining! - deltaSeconds;
  if (left > 0) {
    station.constructionRemaining = left;
    return false;
  }
  delete station.constructionRemaining;
  delete station.hullCurrent;
  delete station.shieldPoolCurrent;
  return true;
}

/*
 * Advances every mining station under construction by `deltaSeconds` and
 * returns the ones that completed in this step (with their system).
 */
export function advanceMiningStationConstruction(
  starSystems: readonly StarSystem[],
  deltaSeconds: number,
): { system: StarSystem; asteroid: SystemAsteroid }[] {
  return allMiningStations(starSystems).filter(({ asteroid }) => advanceStationConstruction(asteroid.miningStation!, deltaSeconds));
}

/* Every mining station (complete or not) with its system, in map order. */
export function allMiningStations(starSystems: readonly StarSystem[]): { system: StarSystem; asteroid: SystemAsteroid }[] {
  const result: { system: StarSystem; asteroid: SystemAsteroid }[] = [];
  for (const system of starSystems) {
    for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
      if (asteroid.miningStation) result.push({ system, asteroid });
    }
  }
  return result;
}

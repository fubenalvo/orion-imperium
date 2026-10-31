import { PlanetRawDeposit, PlanetSize, PlanetTile, StarSystem, SystemAsteroid } from './star-map.models';
import { createMulberry32 } from './star-map-resources.util';
import planetData from './planet-data.json';

/*
 * =========================================================
 * FINITE RAW-MATERIAL DEPOSITS (pure rules and configuration)
 * =========================================================
 *
 * Raw materials come from finite deposits on planets and asteroids
 * (docs/economy.md, "Finite deposits"). Once a deposit is empty it never
 * produces again; nothing regenerates it. This module owns:
 *  - the planet deposit configuration and its deterministic generation,
 *  - load-time backfill of deposits (ensurePlanetDeposits),
 *  - the shared status vocabulary (unmined / active / depleted) the UI uses
 *    for planets and asteroids alike,
 *  - a faction's raw-material outlook, which the AI uses to decide how
 *    urgently it needs new deposits.
 *
 * Extraction itself happens only in the economy tick: planet deposits in
 * EconomyService.applyEconomyDelta, asteroid deposits in
 * mining-station.ts extractMiningStations. Asteroid deposit sizes and rates
 * are generated with the belt (system-asteroids.ts).
 *
 * Invariants:
 *  - A planet has `rawDeposit` exactly when it has deposit tiles
 *    (`resourceTiles` non-empty); the tiles say where mines may be built,
 *    the deposit says how much is left.
 *  - 0 ≤ remaining ≤ total; remaining only decreases.
 */
export const PLANET_DEPOSIT_CONFIG = {
  /* Typical reserve by planet size; each deposit varies by ±reserveSpread. */
  reserveBySize: {
    tiny: 20000,
    small: 28000,
    medium: 40000,
    big: 52000,
    huge: 64000,
  } as Record<PlanetSize, number>,
  reserveSpread: 0.2,
  /* Output multiplier of the planet's mining buildings. */
  richness: { min: 0.8, max: 1.25 },
} as const;

/*
 * Thresholds of rawSupplyPressure: how soon the deposits a faction mines
 * may run dry before the AI treats new raw-material sources as a priority.
 */
export const RAW_OUTLOOK_CONFIG = {
  /* Remaining mining time (s) under which the need for new deposits is urgent / noticeable. */
  urgentSeconds: 600,
  concernSeconds: 1800,
} as const;

export type DepositStatus = 'none' | 'unmined' | 'active' | 'depleted';

/*
 * Buildings that extract from their planet's deposit: the ones that must be
 * placed next to a deposit tile (planet-data.json `requiresOreProximity`).
 */
export const DEPOSIT_MINING_BUILDING_NAMES: ReadonlySet<string> = new Set(
  (planetData as { buildings: { name: string; requiresOreProximity?: boolean }[] }).buildings
    .filter((b) => b.requiresOreProximity === true)
    .map((b) => b.name),
);

export function planetHasMine(planet: PlanetTile): boolean {
  return (planet.buildings ?? []).some((b) => DEPOSIT_MINING_BUILDING_NAMES.has(b.name));
}

/*
 * Why a deposit-mining building cannot go on this planet, or null. Placing a
 * mine on a depleted deposit would only add upkeep, so it is refused for the
 * player and never chosen by the AI.
 */
export function depositMiningBlocker(planet: PlanetTile): 'no_deposit' | 'depleted' | null {
  if (!planet.rawDeposit || (planet.resourceTiles ?? []).length === 0) return 'no_deposit';
  if (planet.rawDeposit.remaining <= 0) return 'depleted';
  return null;
}

/* Display model of a planet deposit for the planet screen and info panel. */
export interface PlanetDepositView {
  status: DepositStatus;
  label: string;
  remaining: number;
  total: number;
  /* 0…100 */
  depletedPercent: number;
  richness: number;
  /* Effective raw/s extracted now (EconomyService), 0 when idle. */
  miningRate: number;
  /* Seconds until empty at the current rate; null when not being mined. */
  secondsLeft: number | null;
}

export function planetDepositView(planet: PlanetTile, miningRate: number): PlanetDepositView | null {
  const deposit = planet.rawDeposit;
  if (!deposit) return null;
  const status = planetDepositStatus(planet, planetHasMine(planet));
  const rate = status === 'active' ? Math.max(0, miningRate) : 0;
  return {
    status,
    label: depositStatusLabel(status),
    remaining: deposit.remaining,
    total: deposit.total,
    depletedPercent: Math.round(depletionFraction(deposit.total, deposit.remaining) * 100),
    richness: deposit.richness,
    miningRate: rate,
    secondsLeft: rate > 0 ? deposit.remaining / rate : null,
  };
}

/* Deterministic deposit for a planet, from its id and size. */
export function generatePlanetDeposit(planet: Pick<PlanetTile, 'id' | 'size'>): PlanetRawDeposit {
  const cfg = PLANET_DEPOSIT_CONFIG;
  const rng = createMulberry32(Math.imul(planet.id + 1, 0x2f6b9a31) ^ 0x5bd1e995);
  const base = cfg.reserveBySize[planet.size] ?? cfg.reserveBySize.medium;
  const total = Math.round((base * (1 - cfg.reserveSpread + 2 * cfg.reserveSpread * rng())) / 500) * 500;
  const richness = Math.round((cfg.richness.min + (cfg.richness.max - cfg.richness.min) * rng()) * 100) / 100;
  return { total, remaining: total, richness };
}

function isValidDeposit(value: unknown): value is PlanetRawDeposit {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<PlanetRawDeposit>;
  return (
    typeof d.total === 'number' && Number.isFinite(d.total) && d.total >= 0
    && typeof d.remaining === 'number' && Number.isFinite(d.remaining) && d.remaining >= 0
    && typeof d.richness === 'number' && Number.isFinite(d.richness) && d.richness > 0
  );
}

/*
 * Keeps the deposit invariant on load and for new games: planets with
 * deposit tiles get their deterministic reserve if they have none (saves
 * from before finite deposits start full), planets without tiles lose any
 * stray record, and a malformed record is regenerated. An existing valid
 * record — including a depleted one — is never touched. Idempotent.
 */
export function ensurePlanetDeposits(planets: PlanetTile[]): void {
  for (const planet of planets) {
    if (!planet || typeof planet !== 'object') continue;
    const hasTiles = Array.isArray(planet.resourceTiles) && planet.resourceTiles.length > 0;
    if (!hasTiles) {
      delete planet.rawDeposit;
      continue;
    }
    if (!isValidDeposit(planet.rawDeposit)) {
      planet.rawDeposit = generatePlanetDeposit(planet);
      continue;
    }
    planet.rawDeposit.remaining = Math.min(planet.rawDeposit.remaining, planet.rawDeposit.total);
  }
}

/* Share of the original reserve already extracted (0…1). */
export function depletionFraction(total: number, remaining: number): number {
  if (total <= 0) return remaining <= 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - remaining / total));
}

export function planetDepositStatus(planet: PlanetTile, hasMine: boolean): DepositStatus {
  const deposit = planet.rawDeposit;
  if (!deposit) return 'none';
  if (deposit.remaining <= 0) return 'depleted';
  return hasMine ? 'active' : 'unmined';
}

export function asteroidDepositStatus(asteroid: SystemAsteroid): DepositStatus {
  const total = asteroid.totalRawMaterials ?? asteroid.rawMaterials;
  if (total <= 0) return 'none';
  if (asteroid.rawMaterials <= 0) return 'depleted';
  return asteroid.miningStation ? 'active' : 'unmined';
}

export function depositStatusLabel(status: DepositStatus): string {
  switch (status) {
    case 'none': return 'No deposit';
    case 'unmined': return 'Unmined';
    case 'active': return 'Mining';
    case 'depleted': return 'Depleted';
  }
}

/*
 * Has `factionId` surveyed this asteroid? The human player ('player') uses
 * the `surveyed` flag the UI reads; AI factions are listed in `surveyedBy`.
 */
export function isAsteroidSurveyedBy(asteroid: SystemAsteroid, factionId: string, playerFactionId = 'player'): boolean {
  if (factionId === playerFactionId) return asteroid.surveyed;
  return (asteroid.surveyedBy ?? []).includes(factionId);
}

export function markAsteroidSurveyed(asteroid: SystemAsteroid, factionId: string, playerFactionId = 'player'): boolean {
  if (isAsteroidSurveyedBy(asteroid, factionId, playerFactionId)) return false;
  if (factionId === playerFactionId) {
    asteroid.surveyed = true;
  } else {
    asteroid.surveyedBy = [...(asteroid.surveyedBy ?? []), factionId];
  }
  return true;
}

/* Nominal raw/s of one deposit-mining building (planet-data.json), before workforce, energy and technology. */
const MINE_NOMINAL_OUTPUT = new Map(
  (planetData as { buildings: { name: string; requiresOreProximity?: boolean; production?: { rawmaterials?: number } }[] }).buildings
    .filter((b) => b.requiresOreProximity === true)
    .map((b) => [b.name, b.production?.rawmaterials ?? 0] as const),
);

/*
 * A faction's raw-material supply at a glance, from the deposits it is
 * mining now. The extraction rate is nominal (mine output × deposit
 * richness, station rates; no workforce, energy, technology or difficulty
 * scaling) — accurate enough for "how soon does this run out" and free of
 * any service dependency, so every AI layer can use it.
 *  - minedReserve: what is left in deposits the faction is mining;
 *  - idleReserve: deposits on its own planets with no mine yet;
 *  - secondsLeft: how long current extraction can continue (0 when nothing
 *    is being mined).
 */
export interface RawOutlook {
  minedReserve: number;
  idleReserve: number;
  extractionPerSecond: number;
  secondsLeft: number;
}

export function rawOutlook(factionId: string, starSystems: readonly StarSystem[]): RawOutlook {
  let minedReserve = 0;
  let idleReserve = 0;
  let extractionPerSecond = 0;
  for (const system of starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      const deposit = planet.rawDeposit;
      if (planet.factionId !== factionId || !deposit || deposit.remaining <= 0) continue;
      let output = 0;
      for (const building of planet.buildings ?? []) output += MINE_NOMINAL_OUTPUT.get(building.name) ?? 0;
      if (output > 0) {
        minedReserve += deposit.remaining;
        extractionPerSecond += output * deposit.richness;
      } else {
        idleReserve += deposit.remaining;
      }
    }
    for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
      if (asteroid.miningStation?.factionId === factionId && asteroid.rawMaterials > 0) {
        minedReserve += asteroid.rawMaterials;
        extractionPerSecond += asteroid.extractionRate ?? 0;
      }
    }
  }
  const secondsLeft = extractionPerSecond > 0 ? minedReserve / extractionPerSecond : 0;
  return { minedReserve, idleReserve, extractionPerSecond, secondsLeft };
}

/*
 * How much a faction needs new raw-material sources, 0.25 (comfortable) … 2
 * (urgent): urgent when current mining runs out within urgentSeconds or
 * there is no mining at all, noticeable within concernSeconds. Idle
 * deposits on own planets halve the need because a mine can be built there
 * without expanding.
 */
export function rawSupplyPressure(outlook: RawOutlook): number {
  const cfg = RAW_OUTLOOK_CONFIG;
  let pressure: number;
  if (outlook.extractionPerSecond <= 0) pressure = 2;
  else if (outlook.secondsLeft < cfg.urgentSeconds) pressure = 2;
  else if (outlook.secondsLeft < cfg.concernSeconds) pressure = 1;
  else pressure = 0.25;
  if (outlook.idleReserve > 0) pressure *= 0.5;
  return pressure;
}

/*
 * Deposits a faction is mining right now (non-empty, with a mine or station
 * of the faction). Taken before an economy tick so the caller can announce
 * exactly the deposits that ran dry during it.
 */
export interface MinedDeposit {
  label: string;
  isEmpty: () => boolean;
}

export function minedDepositsOf(factionId: string, starSystems: readonly StarSystem[]): MinedDeposit[] {
  const result: MinedDeposit[] = [];
  for (const system of starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      const deposit = planet.rawDeposit;
      if (planet.factionId === factionId && deposit && deposit.remaining > 0 && planetHasMine(planet)) {
        result.push({ label: `the ${planet.name} deposit`, isEmpty: () => deposit.remaining <= 0 });
      }
    }
    for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
      if (asteroid.miningStation?.factionId === factionId && asteroid.rawMaterials > 0) {
        result.push({ label: `an asteroid deposit in the ${system.name} belt`, isEmpty: () => asteroid.rawMaterials <= 0 });
      }
    }
  }
  return result;
}

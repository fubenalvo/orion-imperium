import { Faction, Fleet, StarSystem, SystemAsteroid } from './star-map.models';
import { hasLivingOutpostShip, OUTPOST_SHIP_TYPE } from './space-base';
import { systemCellAtVw } from './system-grid';
import { TerritoryMap } from './territory';

/*
 * =========================================================
 * ASTEROID MINING STATIONS (pure rules)
 * =========================================================
 *
 * The second use of the outpost ship (space-base.ts covers the first, the
 * galaxy-map space base). Inside a star system an outpost ship standing on
 * a surveyed asteroid deposit (system-asteroids.ts) can be turned into a
 * mining station on that asteroid. See docs/territory.md, "Mining stations".
 *
 * - The station is stored on the asteroid itself (SystemAsteroid.miningStation),
 *   so an asteroid can never hold two stations and the station is always tied
 *   to its asteroid and system. It is saved with the system's belt.
 * - Deployment consumes one outpost ship, exactly like a base deployment,
 *   and retires a fleet left without living ships.
 * - A station extracts raw materials from its deposit during the economy tick
 *   (EconomyService) until the deposit is empty. A depleted station stays on
 *   its asteroid (it is permanent, like a base) but produces nothing.
 * - Stations have no combat role, sensor range or territory claim.
 *
 * Player and AI would use the same validation and mutation; the AI does not
 * deploy stations yet (it neither surveys asteroids nor builds outpost ships).
 */
export const MINING_STATION_CONFIG = {
  /* Raw materials extracted per second of game time (before the faction gain multiplier). */
  extractionPerSecond: 5,
} as const;

export type MiningDeploymentFailure =
  | 'no_outpost_ship'
  | 'not_in_system'
  | 'fleet_moving'
  | 'neutral_faction'
  | 'no_asteroid'
  | 'not_surveyed'
  | 'no_deposit'
  | 'occupied'
  | 'foreign_territory';

export type MiningDeploymentCheck =
  | { ok: true; system: StarSystem; asteroid: SystemAsteroid }
  | { ok: false; reason: MiningDeploymentFailure; system: StarSystem | null; asteroid: SystemAsteroid | null };

export interface MiningDeploymentInput {
  fleet: Fleet;
  factions: readonly Faction[];
  starSystems: readonly StarSystem[];
  territory: TerritoryMap;
}

/* The asteroid on the system cell a fleet stands on, if any. */
export function asteroidUnderFleet(
  fleet: Fleet,
  starSystems: readonly StarSystem[],
): { system: StarSystem | null; asteroid: SystemAsteroid | null } {
  if (!fleet.system?.id) return { system: null, asteroid: null };
  const system = starSystems.find((s) => s.id === fleet.system!.id) ?? null;
  const cell = systemCellAtVw(fleet.system.x, fleet.system.y);
  const asteroid = system?.asteroidBelt?.asteroids.find((a) => a.col === cell.col && a.row === cell.row) ?? null;
  return { system, asteroid };
}

/*
 * Rules for an asteroid alone, independent of any fleet: the deposit must be
 * known (surveyed), non-empty and free, and the system must not lie in
 * another empire's territory (the base and colonization rule: own or neutral
 * space only). Shared by the deployment check and the hover feedback.
 */
export function asteroidMiningBlocker(
  factionId: string,
  system: StarSystem,
  asteroid: SystemAsteroid,
  territory: TerritoryMap,
): MiningDeploymentFailure | null {
  if (asteroid.miningStation) return 'occupied';
  if (!asteroid.surveyed) return 'not_surveyed';
  if (asteroid.rawMaterials <= 0) return 'no_deposit';
  const owner = territory.systemTerritoryOwner(system);
  if (owner !== null && owner !== factionId) return 'foreign_territory';
  return null;
}

/*
 * Can `fleet` deploy a mining station on the asteroid it stands on?
 *  - the fleet carries a living outpost ship and belongs to a non-neutral faction;
 *  - it is inside a star system, stopped (no galaxy or system target);
 *  - its system cell holds an asteroid that passes asteroidMiningBlocker.
 */
export function validateMiningStationDeployment(input: MiningDeploymentInput): MiningDeploymentCheck {
  const { fleet } = input;
  const { system, asteroid } = asteroidUnderFleet(fleet, input.starSystems);
  const fail = (reason: MiningDeploymentFailure): MiningDeploymentCheck => ({ ok: false, reason, system, asteroid });

  if (fleet.destroyed || !hasLivingOutpostShip(fleet)) return fail('no_outpost_ship');
  if (!fleet.system || !system) return fail('not_in_system');
  const owner = input.factions.find((f) => f.id === fleet.factionId);
  if (!owner || owner.team === 0) return fail('neutral_faction');
  if (fleet.targetX !== null || fleet.targetY !== null || fleet.system.targetX !== null || fleet.system.targetY !== null) {
    return fail('fleet_moving');
  }
  if (!asteroid) return fail('no_asteroid');
  const blocker = asteroidMiningBlocker(fleet.factionId, system, asteroid, input.territory);
  if (blocker) return fail(blocker);
  return { ok: true, system, asteroid };
}

export function describeMiningDeploymentFailure(reason: MiningDeploymentFailure): string {
  switch (reason) {
    case 'no_outpost_ship':
      return 'The fleet carries no outpost ship.';
    case 'not_in_system':
      return 'Enter a star system: mining stations are built on asteroids.';
    case 'fleet_moving':
      return 'Stop the fleet first: the station is built on the asteroid the fleet stands on.';
    case 'neutral_faction':
      return 'This faction cannot deploy mining stations.';
    case 'no_asteroid':
      return 'Move onto a surveyed asteroid deposit to deploy a mining station.';
    case 'not_surveyed':
      return 'Survey the asteroid first: fly a fleet over it.';
    case 'no_deposit':
      return 'This asteroid holds no raw materials.';
    case 'occupied':
      return 'This asteroid already has a mining station.';
    case 'foreign_territory':
      return "Cannot build inside another empire's territory.";
  }
}

/*
 * Deploys a mining station from `fleet` on its asteroid: re-checks the
 * rules, consumes one outpost ship and retires a fleet left without living
 * ships (same outcome as SpaceBaseService.deploy). Nothing changes when the
 * check fails.
 */
export function deployMiningStation(
  input: MiningDeploymentInput,
): { ok: true; system: StarSystem; asteroid: SystemAsteroid; fleetRetired: boolean } | { ok: false; check: MiningDeploymentCheck } {
  const check = validateMiningStationDeployment(input);
  if (!check.ok) return { ok: false, check };

  const { fleet } = input;
  const index = fleet.ships.findIndex((s) => s.type === OUTPOST_SHIP_TYPE && !s.destroyed);
  fleet.ships.splice(index, 1);
  check.asteroid.miningStation = { factionId: fleet.factionId };

  const fleetRetired = !fleet.ships.some((s) => !s.destroyed);
  if (fleetRetired) {
    fleet.destroyed = true;
    fleet.targetX = null;
    fleet.targetY = null;
    fleet.interceptAsteroidId = null;
    fleet.attackFleetId = null;
  }
  return { ok: true, system: check.system, asteroid: check.asteroid, fleetRetired };
}

/* Stations of a faction that still have raw materials to extract. */
export function activeMiningStationsOf(factionId: string, starSystems: readonly StarSystem[]): SystemAsteroid[] {
  const result: SystemAsteroid[] = [];
  for (const system of starSystems) {
    for (const asteroid of system.asteroidBelt?.asteroids ?? []) {
      if (asteroid.miningStation?.factionId === factionId && asteroid.rawMaterials > 0) {
        result.push(asteroid);
      }
    }
  }
  return result;
}

/* Effective extraction rate (raw/s) of a faction's stations, as the HUD shows it. */
export function miningRatePerSecond(factionId: string, starSystems: readonly StarSystem[], gainMultiplier: number): number {
  return activeMiningStationsOf(factionId, starSystems).length * MINING_STATION_CONFIG.extractionPerSecond * gainMultiplier;
}

/*
 * Moves raw materials from a faction's deposits into its stock for one
 * economy tick. Each station takes at most what its deposit still holds, so
 * the deposit never goes negative and nothing is mined twice. Returns the
 * amount extracted (the caller adds it to the faction's stock).
 */
export function extractMiningStations(
  factionId: string,
  starSystems: readonly StarSystem[],
  deltaTime: number,
  gainMultiplier: number,
): number {
  if (deltaTime <= 0) return 0;
  const perStation = MINING_STATION_CONFIG.extractionPerSecond * gainMultiplier * deltaTime;
  let total = 0;
  for (const asteroid of activeMiningStationsOf(factionId, starSystems)) {
    const taken = Math.min(asteroid.rawMaterials, perStation);
    asteroid.rawMaterials = Math.max(0, asteroid.rawMaterials - taken);
    total += taken;
  }
  return total;
}

/*
 * Hover feedback for one asteroid in the system view, from the viewing
 * faction's point of view. `tone` drives the highlight: `valid` = a deposit
 * a mining station can be built on with an outpost ship present in this
 * system, `invalid` = not a target (barren, occupied, foreign space, or no
 * outpost ship here), `neutral` = unknown (unsurveyed), `own` = the viewer's
 * own station. The deposit amount is never revealed before the survey.
 */
export interface AsteroidHint {
  tone: 'valid' | 'invalid' | 'neutral' | 'own';
  title: string;
  detail: string;
}

export interface AsteroidHintInput {
  factionId: string;
  system: StarSystem;
  asteroid: SystemAsteroid;
  territory: TerritoryMap;
  fleets: readonly Fleet[];
  factionName: (factionId: string) => string;
}

function formatRaw(amount: number): string {
  return Math.floor(amount).toLocaleString('en-US');
}

export function describeAsteroidForFaction(input: AsteroidHintInput): AsteroidHint {
  const { factionId, system, asteroid } = input;
  const station = asteroid.miningStation;
  if (station) {
    const depleted = asteroid.rawMaterials <= 0;
    if (station.factionId === factionId) {
      return {
        tone: 'own',
        title: 'Your mining station',
        detail: depleted
          ? 'Deposit depleted.'
          : `${formatRaw(asteroid.rawMaterials)} raw materials left · ${MINING_STATION_CONFIG.extractionPerSecond}/s`,
      };
    }
    return {
      tone: 'invalid',
      title: `${input.factionName(station.factionId)} mining station`,
      detail: 'Occupied: an asteroid holds one station.',
    };
  }

  const blocker = asteroidMiningBlocker(factionId, system, asteroid, input.territory);
  if (blocker === 'not_surveyed') {
    return { tone: 'neutral', title: 'Unsurveyed asteroid', detail: 'Fly a fleet over it to look for raw materials.' };
  }
  if (blocker === 'no_deposit') {
    return { tone: 'invalid', title: 'Barren asteroid', detail: 'No raw materials: no mining station possible.' };
  }
  const deposit = `${formatRaw(asteroid.rawMaterials)} raw materials`;
  if (blocker === 'foreign_territory') {
    const owner = input.territory.systemTerritoryOwner(system);
    return {
      tone: 'invalid',
      title: deposit,
      detail: `${owner ? input.factionName(owner) : 'Foreign'} territory: no mining station possible.`,
    };
  }

  const outpostFleets = input.fleets.filter(
    (f) => !f.destroyed && f.factionId === factionId && f.system?.id === system.id && hasLivingOutpostShip(f),
  );
  if (outpostFleets.length === 0) {
    return { tone: 'invalid', title: `Mining target · ${deposit}`, detail: 'Needs an Outpost Ship in this system.' };
  }
  const parkedHere = outpostFleets.some((f) => {
    if (f.targetX !== null || f.targetY !== null || f.system!.targetX !== null || f.system!.targetY !== null) return false;
    const cell = systemCellAtVw(f.system!.x, f.system!.y);
    return cell.col === asteroid.col && cell.row === asteroid.row;
  });
  return {
    tone: 'valid',
    title: `Mining target · ${deposit}`,
    detail: parkedHere
      ? 'Outpost ship in position: use DEPLOY MINING in the fleet panel.'
      : 'Move an outpost fleet onto it, then DEPLOY MINING (uses the Outpost Ship).',
  };
}

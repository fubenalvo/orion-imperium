import { Fleet, FleetShip, StarSystem, SystemAsteroid } from './star-map.models';
import { CONSTRUCTION_SITE_STATS } from './station-construction';

/*
 * =========================================================
 * STATION DEFENSE (pure rules, shared by every station type)
 * =========================================================
 *
 * One defense model for all deployable space stations: the galaxy-map
 * space base (space-base.ts, the radar / observation post) and the
 * asteroid mining station (mining-station.ts). Their primary functions stay
 * separate — a base senses and claims territory, a mining station extracts
 * its asteroid — but how they fight is defined only here:
 *
 * - Hull: every station has a station core (STATION_CORE_STATS), an
 *   immobile virtual unit whose hit points are the station's own health.
 *   Damage to the core persists between battles (`hullCurrent` on the
 *   station; there is no repair yet). The station is destroyed when the
 *   attacker wins the battle, i.e. the core and every turret are destroyed.
 * - Turrets: 0–3, from the OWNER's research (the `stationTurrets` bonus of
 *   the Turret Research I–III technologies, research-tree.json). The count
 *   is derived at battle time and for rendering, never stored, so a new
 *   research level upgrades every existing station of every type at once
 *   and a newly deployed station starts with the current level.
 * - Shield: one shared pool over all immobile units, persisted between
 *   battles (`shieldPoolCurrent`), like a planet's planetary shield.
 *
 * - Construction: a station still under construction (station-construction.ts)
 *   fights as a single CONSTRUCTION_SITE_STATS unit instead — no turrets, no
 *   shield, no attack — and is destroyed like any station when it loses.
 *
 * Combat goes through the planet-battle path (Battle.type 'planet') of the
 * battle minigame and the auto-resolver; the battle names its station with
 * Battle.spaceBaseId or Battle.miningStation. BattleOutcomeService
 * .applyStationBattleOutcome writes the result back for both types.
 * See docs/territory.md, "Station defense".
 */
export const STATION_DEFENSE_CONFIG = {
  coreTypeId: 'station_core',
  /*
   * Turret types (planet-data.json ids) in unlock order: level I adds the
   * first, level II the second, level III the third.
   */
  turretTypeIds: ['laser_turret', 'laser_turret', 'missile_turret'],
  /* Shared shield pool covering every immobile defense unit. */
  shield: 250,
  shieldRegen: 12,
} as const;

export const MAX_STATION_TURRETS = STATION_DEFENSE_CONFIG.turretTypeIds.length;

/*
 * Stats of the station core, the station's own hull. It enters battle as an
 * immobile virtual unit like a turret (PlanetBattleService.getVirtualShipType).
 */
export const STATION_CORE_STATS = {
  id: STATION_DEFENSE_CONFIG.coreTypeId,
  name: 'Station Core',
  role: 'defense',
  hitPoints: 900,
  attack: 30,
  attackType: 'energy',
  weakness: 'missile',
  defense: 15,
  range: 4,
  fireRate: 1,
} as const;

/* Virtual unit ids start here, like planet defense units (PlanetBattleService). */
const VIRTUAL_UNIT_ID_START = 1_000_000;
/* The core is always the first unit of a station defense roster. */
export const STATION_CORE_UNIT_ID = VIRTUAL_UNIT_ID_START;

/*
 * Turret count for a research level (the summed `stationTurrets` bonus),
 * clamped to the number of turret slots.
 */
export function stationTurretCount(researchLevel: number | undefined): number {
  if (typeof researchLevel !== 'number' || !Number.isFinite(researchLevel)) return 0;
  return Math.max(0, Math.min(MAX_STATION_TURRETS, Math.floor(researchLevel)));
}

/* Persisted defense state common to every station type. */
export interface StationDefenseState {
  /* Shared shield pool left after a battle. Missing = full. */
  shieldPoolCurrent?: number;
  /* Station core hit points left after a battle. Missing = full. */
  hullCurrent?: number;
}

export function stationHull(state: StationDefenseState): number {
  const hull = state.hullCurrent;
  return typeof hull === 'number' && Number.isFinite(hull) && hull > 0
    ? Math.min(hull, STATION_CORE_STATS.hitPoints)
    : STATION_CORE_STATS.hitPoints;
}

export interface StationDefenseInput extends StationDefenseState {
  /* Negative fleet id of the virtual defense fleet (never written back). */
  fleetId: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  turretCount: number;
  /* The station is a construction site: one passive unit, no turrets or shield. */
  underConstruction?: boolean;
}

export type StationDefenseFleet = Fleet & {
  shieldPool: number;
  shieldPoolRegen: number;
  shieldPoolMax: number;
};

/*
 * The defense roster of a station for one battle: the core (with its
 * persisted hull) plus `turretCount` turrets, under the shared shield pool.
 * Same shape as PlanetBattleService.createVirtualDefenseFleet output, so the
 * battle minigame and the auto-resolver treat it like a planet's defenses.
 */
export function buildStationDefenseFleet(input: StationDefenseInput): StationDefenseFleet {
  if (input.underConstruction) return buildConstructionSiteFleet(input);
  const turrets = STATION_DEFENSE_CONFIG.turretTypeIds.slice(0, stationTurretCount(input.turretCount));
  const ships: FleetShip[] = [
    {
      id: STATION_CORE_UNIT_ID,
      name: `${input.name} Core`,
      type: STATION_DEFENSE_CONFIG.coreTypeId,
      currentHp: stationHull(input),
      destroyed: false,
    },
    ...turrets.map((type, index) => ({
      id: STATION_CORE_UNIT_ID + 1 + index,
      name: `${input.name} Turret ${index + 1}`,
      type,
      destroyed: false,
    })),
  ];
  const max = STATION_DEFENSE_CONFIG.shield;
  const persisted = input.shieldPoolCurrent;
  const current = typeof persisted === 'number' && Number.isFinite(persisted) ? Math.max(0, Math.min(persisted, max)) : max;
  return {
    id: input.fleetId,
    name: `${input.name} Defenses`,
    factionId: input.factionId,
    x: input.x,
    y: input.y,
    targetX: null,
    targetY: null,
    speed: 0,
    system: null,
    ships,
    destroyed: false,
    shieldPool: current,
    shieldPoolRegen: STATION_DEFENSE_CONFIG.shieldRegen,
    shieldPoolMax: max,
  };
}

/*
 * A construction site's roster: one unit that cannot fire, with the site's
 * persisted hull, under an empty shield pool that never regenerates.
 */
function buildConstructionSiteFleet(input: StationDefenseInput): StationDefenseFleet {
  const max = CONSTRUCTION_SITE_STATS.hitPoints;
  const hull = input.hullCurrent;
  const currentHp = typeof hull === 'number' && Number.isFinite(hull) && hull > 0 ? Math.min(hull, max) : max;
  return {
    id: input.fleetId,
    name: `${input.name} Construction Site`,
    factionId: input.factionId,
    x: input.x,
    y: input.y,
    targetX: null,
    targetY: null,
    speed: 0,
    system: null,
    ships: [
      {
        id: STATION_CORE_UNIT_ID,
        name: `${input.name} Construction Site`,
        type: CONSTRUCTION_SITE_STATS.id,
        currentHp,
        destroyed: false,
      },
    ],
    destroyed: false,
    shieldPool: 0,
    shieldPoolRegen: 0,
    shieldPoolMax: 0,
  };
}

/*
 * Defense state a surviving station keeps after a battle, read from the
 * defender's outcome roster (core hit points) and shield pool.
 */
export function stationDefenseStateFromOutcome(defender: {
  ships: readonly { shipId: number; hp: number; destroyed?: boolean }[];
  shieldPoolCurrent?: number;
}): StationDefenseState {
  const core = defender.ships.find((s) => s.shipId === STATION_CORE_UNIT_ID);
  const state: StationDefenseState = {};
  if (core && Number.isFinite(core.hp)) state.hullCurrent = Math.max(1, Math.min(core.hp, STATION_CORE_STATS.hitPoints));
  if (defender.shieldPoolCurrent !== undefined) state.shieldPoolCurrent = defender.shieldPoolCurrent;
  return state;
}

/* "Turrets 2/3 · Hull 900/900" — the defense line of station info texts. */
export function describeStationDefense(state: StationDefenseState, turretCount: number): string {
  return `Turrets ${stationTurretCount(turretCount)}/${MAX_STATION_TURRETS} · Hull ${Math.ceil(stationHull(state))}/${STATION_CORE_STATS.hitPoints}`;
}

/* ---------------- Mining station addressing ---------------- */

/* A mining station is addressed by its asteroid: system id + belt cell. */
export interface MiningStationRef {
  systemId: string;
  col: number;
  row: number;
}

export function findMiningStationAsteroid(
  starSystems: readonly StarSystem[] | undefined,
  ref: MiningStationRef,
): { system: StarSystem; asteroid: SystemAsteroid } | null {
  const system = starSystems?.find((s) => s.id === ref.systemId);
  const asteroid = system?.asteroidBelt?.asteroids.find((a) => a.col === ref.col && a.row === ref.row);
  return system && asteroid?.miningStation ? { system, asteroid } : null;
}

/*
 * Virtual defense fleets of mining stations use ids below
 * -MINING_STATION_FLEET_ID_OFFSET (bases use -10 000 000 - id, planets
 * -planet.id). Only unique within one battle; never persisted.
 */
export const MINING_STATION_FLEET_ID_OFFSET = 20_000_000;

export function miningStationDefenseFleetId(systemIndex: number, asteroidIndex: number): number {
  return -(MINING_STATION_FLEET_ID_OFFSET + systemIndex * 1000 + asteroidIndex);
}

/* Is this battle (or its state / outcome) fought against a station of either type? */
export function isStationBattle(battle: { spaceBaseId?: number | null; miningStation?: MiningStationRef | null }): boolean {
  return battle.spaceBaseId != null || battle.miningStation != null;
}

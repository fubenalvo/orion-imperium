import { Faction, Fleet, FleetShip, SpaceBase, StarSystem } from './star-map.models';
import { TerritoryMap } from './territory';

/*
 * =========================================================
 * SPACE BASES (pure rules)
 * =========================================================
 *
 * A space base is deployed by an outpost ship (`outpost_ship` in
 * ship-data.json) carried in a fleet. Deployment consumes the ship and
 * creates a permanent, immobile SpaceBase on the fleet's galaxy cell. The
 * base is an observation post (sensor source for its owner) and extends
 * its owner's territory (territory.ts); nothing else — no economy,
 * research or production.
 *
 * Player and AI deploy through the same validation (validateBaseDeployment)
 * and the same mutation (SpaceBaseService.deploy). See docs/territory.md.
 *
 * Combat: a base fights like a planet's static defenses. Its virtual
 * defense fleet (buildBaseDefenseFleet) holds an immobile station core and
 * the planet turret types, covered by a shared shield pool, and goes
 * through the planet-battle path of the battle minigame / auto-resolver.
 */
export const OUTPOST_SHIP_TYPE = 'outpost_ship';

export const SPACE_BASE_CONFIG = {
  /* Minimum distance (cells) between any two bases, own or foreign. */
  minBaseSpacing: 10,
  /* Minimum distance (cells) from any star: bases sit in open space. */
  minStarDistance: 3,
  /* Owner's sensor radius around the base (cells, incl. the global +2 bonus). */
  sensorRange: 6,
  /* Virtual defense units: one core plus planet turret types (planet-data.json ids). */
  coreTypeId: 'station_core',
  turretTypeIds: ['laser_turret', 'laser_turret', 'missile_turret'],
  /* Shared shield pool covering every immobile defense unit. */
  shield: 250,
  shieldRegen: 12,
} as const;

/*
 * Stats of the station core, the base's own hull. It enters battle as an
 * immobile virtual unit like a turret (PlanetBattleService.getVirtualShipType),
 * so the base has its own hit points and armor besides the turrets.
 */
export const STATION_CORE_STATS = {
  id: SPACE_BASE_CONFIG.coreTypeId,
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

/*
 * Virtual defense fleets of bases use ids below -SPACE_BASE_FLEET_ID_OFFSET,
 * far from planet defense fleets (-planet.id), and like those are never
 * written back to the overworld (negative ids are skipped).
 */
export const SPACE_BASE_FLEET_ID_OFFSET = 10_000_000;

export function spaceBaseDefenseFleetId(base: Pick<SpaceBase, 'id'>): number {
  return -(SPACE_BASE_FLEET_ID_OFFSET + base.id);
}

export function hasLivingOutpostShip(fleet: Fleet): boolean {
  return (fleet.ships ?? []).some((s) => s.type === OUTPOST_SHIP_TYPE && !s.destroyed);
}

export type BaseDeploymentFailure =
  | 'no_outpost_ship'
  | 'fleet_moving'
  | 'inside_system'
  | 'neutral_faction'
  | 'out_of_bounds'
  | 'blocked_terrain'
  | 'near_star'
  | 'foreign_territory'
  | 'too_close_to_base';

export type BaseDeploymentCheck =
  | { ok: true; col: number; row: number }
  | { ok: false; reason: BaseDeploymentFailure; col: number; row: number };

export interface BaseDeploymentInput {
  fleet: Fleet;
  factions: readonly Faction[];
  starSystems: readonly StarSystem[];
  bases: readonly SpaceBase[];
  territory: TerritoryMap;
  width: number;
  height: number;
  /* Navigation obstacle test (black holes, asteroid belts) in grid coordinates. */
  isBlocked?: (x: number, y: number) => boolean;
}

/*
 * Can `fleet` deploy a base where it stands? The base goes on the fleet's
 * cell. Rules (identical for player and AI):
 *  - the fleet carries a living outpost ship, is stopped, and is on the
 *    galaxy map (not inside a system view);
 *  - the cell is on the map and not inside a navigation obstacle;
 *  - at least minStarDistance from every star;
 *  - not inside another empire's territory (own or neutral space only);
 *  - at least minBaseSpacing from every other base.
 */
export function validateBaseDeployment(input: BaseDeploymentInput): BaseDeploymentCheck {
  const { fleet } = input;
  const col = Math.floor(fleet.x);
  const row = Math.floor(fleet.y);
  const fail = (reason: BaseDeploymentFailure): BaseDeploymentCheck => ({ ok: false, reason, col, row });

  if (fleet.destroyed || !hasLivingOutpostShip(fleet)) return fail('no_outpost_ship');
  if (fleet.targetX !== null || fleet.targetY !== null) return fail('fleet_moving');
  if (fleet.system) return fail('inside_system');
  const owner = input.factions.find((f) => f.id === fleet.factionId);
  if (!owner || owner.team === 0) return fail('neutral_faction');
  if (col < 1 || row < 1 || col > input.width || row > input.height) return fail('out_of_bounds');
  if (input.isBlocked?.(col, row) || input.isBlocked?.(fleet.x, fleet.y)) return fail('blocked_terrain');

  const minStar = SPACE_BASE_CONFIG.minStarDistance;
  if (input.starSystems.some((s) => (Math.floor(s.x) - col) ** 2 + (Math.floor(s.y) - row) ** 2 < minStar * minStar)) {
    return fail('near_star');
  }
  const territoryOwner = input.territory.ownerAt(col, row);
  if (territoryOwner !== null && territoryOwner !== fleet.factionId) return fail('foreign_territory');
  const spacing = SPACE_BASE_CONFIG.minBaseSpacing;
  if (input.bases.some((b) => (b.x - col) ** 2 + (b.y - row) ** 2 < spacing * spacing)) {
    return fail('too_close_to_base');
  }
  return { ok: true, col, row };
}

export function describeDeploymentFailure(reason: BaseDeploymentFailure): string {
  switch (reason) {
    case 'no_outpost_ship':
      return 'The fleet carries no outpost ship.';
    case 'fleet_moving':
      return 'Stop the fleet first: a base is deployed where the fleet stands.';
    case 'inside_system':
      return 'Leave the star system: bases are deployed in open space.';
    case 'neutral_faction':
      return 'This faction cannot deploy bases.';
    case 'out_of_bounds':
      return 'Outside the map.';
    case 'blocked_terrain':
      return 'Cannot deploy inside a black hole zone or an asteroid belt.';
    case 'near_star':
      return `Too close to a star (minimum ${SPACE_BASE_CONFIG.minStarDistance} cells).`;
    case 'foreign_territory':
      return "Cannot deploy inside another empire's territory.";
    case 'too_close_to_base':
      return `Too close to another space base (minimum ${SPACE_BASE_CONFIG.minBaseSpacing} cells).`;
  }
}

/* Base name from the nearest star: "Vega Outpost", made unique with a number. */
export function nameSpaceBase(col: number, row: number, starSystems: readonly StarSystem[], bases: readonly SpaceBase[]): string {
  let nearest: StarSystem | null = null;
  let best = Infinity;
  for (const system of starSystems) {
    const d = (system.x - col) ** 2 + (system.y - row) ** 2;
    if (d < best) {
      best = d;
      nearest = system;
    }
  }
  const stem = nearest ? `${nearest.name} Outpost` : 'Deep Space Outpost';
  const taken = new Set(bases.map((b) => b.name));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    if (!taken.has(`${stem} ${n}`)) return `${stem} ${n}`;
  }
}

/* Virtual unit ids start here, like planet defense units (PlanetBattleService). */
const VIRTUAL_UNIT_ID_START = 1_000_000;

/*
 * The base's defense roster for a battle: the station core plus its
 * turrets. Same shape as PlanetBattleService.createVirtualDefenseFleet
 * output, so the battle minigame and auto-resolver treat it exactly like
 * a planet's defenses (immobile stacks under a shared shield pool).
 */
export function buildBaseDefenseFleet(base: SpaceBase): Fleet & {
  shieldPool: number;
  shieldPoolRegen: number;
  shieldPoolMax: number;
} {
  const unitTypes = [SPACE_BASE_CONFIG.coreTypeId, ...SPACE_BASE_CONFIG.turretTypeIds];
  const ships: FleetShip[] = unitTypes.map((type, index) => ({
    id: VIRTUAL_UNIT_ID_START + index,
    name: `${base.name} ${type === SPACE_BASE_CONFIG.coreTypeId ? 'Core' : `Turret ${index}`}`,
    type,
    destroyed: false,
  }));
  const max = SPACE_BASE_CONFIG.shield;
  const persisted = base.shieldPoolCurrent;
  const current = typeof persisted === 'number' && Number.isFinite(persisted) ? Math.max(0, Math.min(persisted, max)) : max;
  return {
    id: spaceBaseDefenseFleetId(base),
    name: `${base.name} Defenses`,
    factionId: base.factionId,
    x: base.x,
    y: base.y,
    targetX: null,
    targetY: null,
    speed: 0,
    system: null,
    ships,
    destroyed: false,
    shieldPool: current,
    shieldPoolRegen: SPACE_BASE_CONFIG.shieldRegen,
    shieldPoolMax: max,
  };
}

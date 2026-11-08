import type { ShipType } from '../../services/ship.service';
import {
  EquipmentStat,
  ResolvedLoadout,
  ShipLoadout,
  moduleInSlot,
  resolveLoadout,
  sumModifier,
  touchesStat,
} from './equipment';

/*
 * =========================================================
 * SHIP STATS — the central stat resolver (pure)
 * =========================================================
 *
 * Turns (ship type, loadout, research bonus) into the stats one ship
 * fights and moves with. Battle, map movement, displays and the AI are
 * meant to read stats through here (docs/ship-equipment.md, B.4), so they
 * can't disagree.
 *
 * Order, and why:
 *  1. hull base values from ship-data.json;
 *  2. research multipliers on the hull's own attack and shield (the same
 *     Battle.combatBonuses factors createBattleState applies today);
 *  3. fixed module additions, the same on every hull. They come after
 *     research so a +16 module stays exactly +16 with any research;
 *  4. floors, applied only to stats a module changed, so a standard ship
 *     can never be altered by a floor.
 *
 * Fire rate is the exception to fixed values: the weapon's fireRateFactor
 * scales the hull's rate and, unlike the hull's own rate, changes damage
 * per second. Combat must therefore split the volley by `hullFireRate`
 * (damage per shot stays the hull's) and fire at `fireRate`.
 *
 * Invariant: a standard loadout with no research returns the ShipType's
 * own values (ship-stats.spec.ts).
 */

/* Fallback fire rate, the same as getBattleShipStats and REFERENCE_FIRE_RATE. */
const DEFAULT_FIRE_RATE = 1.5;

/* Floors for stats lowered by module trade-offs (see docs/ship-equipment.md, B.4). */
export const MIN_BATTLE_SPEED = 0.5;
export const MIN_ATTACK = 1;
export const MIN_RANGE = 1;
/* Applied by battle-heading.ts to tier turn rate + turnRateBonus (Phase 3). */
export const MIN_TURN_RATE = 45;
/* Lowest effective fleet speed when engines lower it (no current module does). */
export const MIN_STRATEGIC_SPEED = 1;

/* Research multipliers for this hull (1 = none), as in Battle.combatBonuses. */
export interface ResearchStatBonus {
  attack?: number;
  shield?: number;
}

export type ShipStatsInput = Pick<
  ShipType,
  'id' | 'attack' | 'attackType' | 'weakness' | 'defense' | 'speed' | 'range' | 'shield' | 'shieldRegen' | 'fireRate'
>;

export interface ResolvedShipStats {
  attack: number;
  attackType: string;
  /* Shots per second the ship fires at. */
  fireRate: number;
  /* The hull's own fire rate: splits damage per shot, so fireRate / hullFireRate scales damage per second. */
  hullFireRate: number;
  range: number;
  /* In ShipType.speed units; battle applies BATTLE_SPEED_MULTIPLIER on top. */
  battleSpeed: number;
  /* Degrees per battle second added to the hull's tier turn rate. */
  turnRateBonus: number;
  /* Added to Fleet.speed; a fleet uses the lowest bonus among its living ships. */
  strategicSpeedBonus: number;
  shield: number;
  shieldRegen: number;
  defense: number;
  /* Defense profile: the damage type the ship resists (ShipType.weakness semantics). */
  weakness: string;
  modules: ResolvedLoadout;
}

export function resolveShipStats(
  shipType: ShipStatsInput,
  loadout?: ShipLoadout | null,
  research?: ResearchStatBonus | null,
): ResolvedShipStats {
  const modules = resolveLoadout(shipType.id, loadout);
  const fitted = [modules.engine, modules.weapon, modules.defense];
  const add = (stat: EquipmentStat) => sumModifier(fitted, stat);
  const floored = (stat: EquipmentStat, value: number, min: number) =>
    touchesStat(fitted, stat) ? Math.max(min, value) : value;

  const hullFireRate = shipType.fireRate ?? DEFAULT_FIRE_RATE;
  return {
    attack: floored('attack', shipType.attack * (research?.attack ?? 1) + add('attack'), MIN_ATTACK),
    attackType: modules.weapon.attackType ?? shipType.attackType ?? 'kinetic',
    fireRate: hullFireRate * (modules.weapon.fireRateFactor ?? 1),
    hullFireRate,
    range: floored('range', shipType.range + add('range'), MIN_RANGE),
    battleSpeed: floored('battleSpeed', shipType.speed + add('battleSpeed'), MIN_BATTLE_SPEED),
    turnRateBonus: add('turnRate'),
    strategicSpeedBonus: add('strategicSpeed'),
    shield: floored('shield', (shipType.shield ?? 0) * (research?.shield ?? 1) + add('shield'), 0),
    shieldRegen: floored('shieldRegen', (shipType.shieldRegen ?? 0) + add('shieldRegen'), 0),
    defense: floored('defense', shipType.defense + add('defense'), 0),
    weakness: modules.defense.resistType ?? shipType.weakness ?? 'energy',
    modules,
  };
}

/*
 * Map speed of one ship's engine, as a bonus on the fleet's stored base
 * speed. Only the engine slot can carry strategicSpeed, so the hull's
 * stats are not needed.
 */
export function strategicSpeedBonus(ship: { type: string; equipment?: ShipLoadout | null }): number {
  // Called per moving fleet per frame (StarMapMovementService): ships
  // without an engine module skip the catalog lookup.
  if (!ship.equipment?.engine) {
    return 0;
  }
  return sumModifier([moduleInSlot(ship.type, ship.equipment, 'engine')], 'strategicSpeed');
}

/*
 * Galaxy / system speed a fleet actually moves at. Fleet.speed stays the
 * stored base (4 for assembled fleets, 6–8 for generated starting fleets)
 * and is never rewritten; the fleet moves at the pace of its slowest-
 * engined living ship. With standard engines (bonus 0 everywhere) the
 * stored speed is returned unchanged, so movement is exactly as before.
 */
export function effectiveFleetSpeed(fleet: {
  speed: number;
  ships: readonly { type: string; destroyed?: boolean; equipment?: ShipLoadout | null }[];
}): number {
  let lowest: number | null = null;
  for (const ship of fleet.ships) {
    if (ship.destroyed) {
      continue;
    }
    const bonus = strategicSpeedBonus(ship);
    lowest = lowest === null ? bonus : Math.min(lowest, bonus);
  }
  if (!lowest) {
    return fleet.speed;
  }
  return Math.max(MIN_STRATEGIC_SPEED, fleet.speed + lowest);
}

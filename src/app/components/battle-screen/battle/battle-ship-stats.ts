import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import planetData from '../../star-map/planet-data.json';
import { STATION_CORE_STATS } from '../../star-map/station-defense';
import { CONSTRUCTION_SITE_STATS } from '../../star-map/station-construction';
import { CombatClass, getHullClass } from '../../star-map/hull-class';
import { BATTLE_SPEED_MULTIPLIER } from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — SHIP STAT RESOLUTION
 * =========================================================
 *
 * Maps a ship type id (real ship or virtual planet-defense building)
 * to the combat stats the minigame uses. Pure and deterministic.
 *
 * Real-time movement: speed from ship-data.json (1-5 vw/s).
 * No AP costs, no moveRange limits — animation lock is the only gate.
 */

export interface BattleShipStats {
  typeId: string;
  typeName: string;
  maxHp: number;
  attack: number;
  defense: number;
  tier: number;
  attackRange: number;
  immobile: boolean;
  shield: number;
  shieldRegen: number;
  attackType: string;
  weakness: string;
  role: string;
  /* Size class for the counter cycle; 'structure' for static defenses (hull-class.ts). */
  hullClass: CombatClass;
  /* Real-time movement speed in vw/s: ship-data.json speed × BATTLE_SPEED_MULTIPLIER. */
  speed: number;
  /* Shots per second (from ship-data.json fireRate). */
  fireRate: number;
  /* Passive shield aura: damage reduction for covered allies (carrier), 0 for every other unit. */
  shieldAura: number;
}

const TIER_LOOKUP: Record<string, number> = {
  scout: 1,
  fighter: 1,
  colonizer: 1,
  outpost_ship: 1,
  swarm_constructor: 1,
  corvette: 1,
  frigate: 2,
  destroyer: 2,
  cruiser: 3,
  carrier: 3,
  battleship: 4,
  battlecruiser: 4,
  dreadnought: 5,
};

/* Cost-based fallback for ship types outside the lookup table. */
function fallbackTier(cost: number): number {
  return Math.min(5, Math.max(1, Math.ceil(cost / 150)));
}

/* Virtual defense building attack ranges (planet-data.json defense block), plus the space base core. */
const VIRTUAL_RANGE_LOOKUP: Record<string, number> = {
  ...Object.fromEntries(
    (planetData as { buildings: { id: string; range?: number }[] }).buildings
      .filter((b) => b.range != null)
      .map((b) => [b.id, b.range as number]),
  ),
  [STATION_CORE_STATS.id]: STATION_CORE_STATS.range,
  [CONSTRUCTION_SITE_STATS.id]: CONSTRUCTION_SITE_STATS.range,
};

/* Virtual defense building fire rates (planet-data.json, shots per second), plus the space base core. */
const VIRTUAL_FIRE_RATE_LOOKUP: Record<string, number> = {
  ...Object.fromEntries(
    (planetData as { buildings: { id: string; fireRate?: number }[] }).buildings
      .filter((b) => b.fireRate != null)
      .map((b) => [b.id, b.fireRate as number]),
  ),
  [STATION_CORE_STATS.id]: STATION_CORE_STATS.fireRate,
  [CONSTRUCTION_SITE_STATS.id]: CONSTRUCTION_SITE_STATS.fireRate,
};

export function getBattleShipStats(
  typeId: string,
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
): BattleShipStats {
  const shipType = shipService.getShipType(typeId);
  if (shipType) {
    const tier = TIER_LOOKUP[typeId] ?? fallbackTier(shipType.cost);
    return {
      typeId,
      typeName: shipType.name,
      maxHp: shipType.hitPoints,
      attack: shipType.attack,
      defense: shipType.defense,
      tier,
      attackRange: shipType.range,
      immobile: false,
      shield: shipType.shield ?? 0,
      shieldRegen: shipType.shieldRegen ?? 0,
      attackType: shipType.attackType ?? 'kinetic',
      weakness: shipType.weakness ?? 'energy',
      role: shipType.role ?? 'Light Combat',
      hullClass: getHullClass(shipType),
      speed: shipType.speed * BATTLE_SPEED_MULTIPLIER,
      fireRate: shipType.fireRate ?? 1.5,
      shieldAura: shipType.shieldAura ?? 0,
    };
  }

  const virtual = planetBattleService.getVirtualShipType(typeId);
  if (virtual) {
    return {
      typeId,
      typeName: virtual.name,
      maxHp: virtual.hitPoints,
      attack: virtual.attack,
      defense: virtual.defense,
      tier: 3,
      attackRange: VIRTUAL_RANGE_LOOKUP[typeId] ?? 2,
      immobile: true,
      // Virtual defense buildings (turrets) have no per-ship shield in
      // planet-data.json. The shield building is filtered out of virtual
      // fleets and becomes a shared pool instead, so these stay zero.
      shield: 0,
      shieldRegen: 0,
      attackType: virtual.attackType ?? 'kinetic',
      weakness: virtual.weakness ?? 'energy',
      role: virtual.role ?? 'defense',
      hullClass: 'structure',
      speed: 0,
      fireRate: VIRTUAL_FIRE_RATE_LOOKUP[typeId] ?? 1.5,
      shieldAura: 0,
    };
  }

  return {
    typeId,
    typeName: typeId,
    maxHp: 1,
    attack: 0,
    defense: 0,
    tier: 3,
    attackRange: 0,
    immobile: true,
    shield: 0,
    shieldRegen: 0,
    attackType: 'kinetic',
    weakness: 'energy',
    role: 'Light Combat',
    hullClass: 'structure',
    speed: 0,
    fireRate: 1.5,
    shieldAura: 0,
  };
}

import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import planetData from '../../star-map/planet-data.json';

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
  /* Real-time movement speed in vw/s (from ship-data.json speed). */
  speed: number;
  /* Shots per second (from ship-data.json fireRate). */
  fireRate: number;
}

const TIER_LOOKUP: Record<string, number> = {
  scout: 1,
  fighter: 1,
  colonizer: 1,
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

/* Virtual defense building attack ranges (planet-data.json defense block). */
const VIRTUAL_RANGE_LOOKUP: Record<string, number> = Object.fromEntries(
  (planetData as { buildings: { id: string; range?: number }[] }).buildings
    .filter((b) => b.range != null)
    .map((b) => [b.id, b.range as number]),
);

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
      speed: shipType.speed,
      fireRate: shipType.fireRate ?? 1.5,
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
      speed: 0,
      fireRate: 1.5,
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
    speed: 0,
    fireRate: 1.5,
  };
}

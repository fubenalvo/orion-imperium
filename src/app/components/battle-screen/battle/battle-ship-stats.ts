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
 * AP tier model (derived from the ship-data.json cost column — an
 * explicit lookup because a pure formula mis-buckets carrier at 500):
 *
 *   tier 1 → move 1 AP/cell, attack 1 AP  (scout, fighter, colonizer, corvette)
 *   tier 2 → move 2 AP/cell, attack 2 AP  (frigate, destroyer)
 *   tier 3 → move 3 AP/cell, attack 3 AP  (cruiser, carrier)
 *   tier 4 → move 4 AP/cell, attack 4 AP  (battleship, battlecruiser)
 *   tier 5 → move 5 AP/cell, attack 5 AP  (dreadnought)
 *
 * Movement range per turn reuses the existing `speed` stat; attack
 * range reuses the existing `range` stat. No new movement stat is
 * invented.
 */

export interface BattleShipStats {
  typeId: string;
  typeName: string;
  maxHp: number;
  attack: number;
  defense: number;
  tier: number;
  moveApPerCell: number;
  attackAp: number;
  moveRange: number;
  attackRange: number;
  immobile: boolean;
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
      moveApPerCell: Math.ceil(tier * 1.5),
      attackAp: Math.ceil(tier * 1.5),
      moveRange: shipType.battleMoveRange ?? shipType.speed,
      attackRange: shipType.range,
      immobile: false,
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
      moveApPerCell: Math.ceil(3 * 1.5),
      attackAp: Math.ceil(2 * 1.5),
      moveRange: 0,
      attackRange: VIRTUAL_RANGE_LOOKUP[typeId] ?? 2,
      immobile: true,
    };
  }

  return {
    typeId,
    typeName: typeId,
    maxHp: 1,
    attack: 0,
    defense: 0,
    tier: 3,
    moveApPerCell: Math.ceil(3 * 1.5),
    attackAp: Math.ceil(2 * 1.5),
    moveRange: 0,
    attackRange: 0,
    immobile: true,
  };
}

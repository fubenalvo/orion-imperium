import shipData from './ship-data.json';
import {
  Faction,
  Fleet,
  FleetShipTypeSummary,
  PlanetTile,
  PLANET_SIZE_MAP,
  PLANET_TYPE_COLORS,
  ShipType,
} from './star-map.models';
import { getPlanetGridSize as getSurfaceGridSize } from './planet-surface/planet-surface';
import { resolveShipStats } from './ship-stats';

/*
 * =========================================================
 * STAR MAP DISPLAY UTILS
 * =========================================================
 *
 * Pure presentation helpers extracted from the StarMap component.
 * They map game state (factions, fleets, planets) to display values
 * such as colors, names, and numeric sizes, and contain no state
 * of their own.
 *
 * The ship-type lookup below intentionally uses the RAW definitions
 * from ship-data.json (not the normalized ShipService variants) to
 * preserve the exact display behavior of the former component-level
 * lookup.
 */

const shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes;
const shipTypeById: Map<string, ShipType> = new Map(
  shipTypes.map((type) => [type.id, type] as [string, ShipType]),
);

/** Looks up a raw ship type definition by its ID. */
export function getShipTypeById(typeId: string): ShipType | undefined {
  return shipTypeById.get(typeId);
}

/** Returns the color associated with a faction ID. */
export function getFactionColor(factions: Faction[] | undefined, factionId: string): string {
  if (!factions) {
    return '#ffffff';
  }
  const faction = factions.find((f) => f.id === factionId);
  return faction ? faction.color : '#ffffff';
}

/** Returns the display name of a faction by its ID. */
export function getFactionName(factions: Faction[] | undefined, factionId: string): string {
  if (!factions) {
    return 'Unknown';
  }
  const faction = factions.find((f) => f.id === factionId);
  return faction ? faction.name : 'Unknown';
}

/** Returns a faction's currencies as key-value pairs. */
export function getFactionCurrencies(
  factions: Faction[],
  factionId: string,
): { name: string; value: number }[] {
  const faction = factions.find((f) => f.id === factionId);
  if (!faction?.currencies) {
    return [];
  }
  return Object.entries(faction.currencies).map(([name, value]) => ({ name, value }));
}

/** Returns the player's currencies as key-value pairs. */
export function getPlayerCurrencies(factions: Faction[]): { name: string; value: number }[] {
  const player = factions.find((f) => f.id === 'player');
  if (!player?.currencies) {
    return [];
  }
  return Object.entries(player.currencies).map(([name, value]) => ({ name, value }));
}

/** Returns the player's current credit balance. */
export function getPlayerCredits(factions: Faction[]): number {
  const player = factions.find((f) => f.id === 'player');
  return player?.currencies?.['credits'] ?? 0;
}

/** Returns the CSS class names to apply to a planet tile for styling. */
export function getPlanetClassNames(planet: PlanetTile): string[] {
  return [planet.type, planet.size, planet.size ? `planet-size-${planet.size}` : undefined].filter(
    (className): className is string => Boolean(className),
  );
}

/** Maps a planet's string size to a numeric size (1-4) for grid calculations. */
export function getPlanetNumericSize(planet: PlanetTile): number {
  return PLANET_SIZE_MAP[planet.size] ?? 3;
}

/**
 * Returns the grid dimension (side length) for a planet's surface grid.
 * Delegates to the planet-surface module (10 / 14 / 18 / 22 cells).
 */
export function getPlanetGridSize(planet: PlanetTile): number {
  return getSurfaceGridSize(planet);
}

/** Returns the representative color for a planet based on its type. */
export function getPlanetColor(planet: PlanetTile): string {
  return PLANET_TYPE_COLORS[planet.type] ?? '#ffffff';
}

/** Builds a summary of ship types and counts present in a fleet. */
/*
 * A ship's attack and armour with its installed equipment (ship-stats.ts),
 * the values it fights with (before research bonuses, which are battle-only).
 * Standard ships resolve to their ship type's values.
 */
function shipAttackDefense(ship: Fleet['ships'][number]): { attack: number; defense: number } | null {
  const type = getShipTypeById(ship.type);
  if (!type) return null;
  const stats = resolveShipStats(type, ship.equipment);
  return { attack: stats.attack, defense: stats.defense };
}

/* Per-type rows; with mixed equipment in one type the row shows the type's average, rounded. */
export function getFleetShipTypeSummary(fleet: Fleet): FleetShipTypeSummary[] {
  const groups = new Map<string, { count: number; attack: number; defense: number }>();
  for (const ship of fleet.ships) {
    const values = shipAttackDefense(ship);
    if (!values) continue;
    const group = groups.get(ship.type) ?? { count: 0, attack: 0, defense: 0 };
    group.count++;
    group.attack += values.attack;
    group.defense += values.defense;
    groups.set(ship.type, group);
  }

  const summary: FleetShipTypeSummary[] = [];
  for (const [typeId, group] of groups) {
    summary.push({
      typeId,
      typeName: getShipTypeById(typeId)!.name,
      count: group.count,
      attack: Math.round(group.attack / group.count),
      defense: Math.round(group.defense / group.count),
    });
  }
  return summary;
}

/** Calculates the total attack value of all ships in a fleet (installed equipment included). */
export function getFleetTotalAttack(fleet: Fleet): number {
  return Math.round(fleet.ships.reduce((sum, ship) => sum + (shipAttackDefense(ship)?.attack ?? 0), 0));
}

/** Calculates the total defense value of all ships in a fleet (installed equipment included). */
export function getFleetTotalDefense(fleet: Fleet): number {
  return Math.round(fleet.ships.reduce((sum, ship) => sum + (shipAttackDefense(ship)?.defense ?? 0), 0));
}

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
 * Formula: size * 2 + 3, so size 1 -> 5, size 2 -> 7, size 3 -> 9, size 4 -> 11.
 */
export function getPlanetGridSize(planet: PlanetTile): number {
  const numericSize = getPlanetNumericSize(planet);
  return numericSize * 2 + 3;
}

/** Returns the representative color for a planet based on its type. */
export function getPlanetColor(planet: PlanetTile): string {
  return PLANET_TYPE_COLORS[planet.type] ?? '#ffffff';
}

/** Builds a summary of ship types and counts present in a fleet. */
export function getFleetShipTypeSummary(fleet: Fleet): FleetShipTypeSummary[] {
  const counts = new Map<string, number>();
  for (const ship of fleet.ships) {
    counts.set(ship.type, (counts.get(ship.type) || 0) + 1);
  }

  const summary: FleetShipTypeSummary[] = [];
  for (const [typeId, count] of counts) {
    const type = getShipTypeById(typeId);
    if (type) {
      summary.push({
        typeId,
        typeName: type.name,
        count,
        attack: type.attack,
        defense: type.defense,
      });
    }
  }
  return summary;
}

/** Calculates the total attack value of all ships in a fleet. */
export function getFleetTotalAttack(fleet: Fleet): number {
  return fleet.ships.reduce((sum, ship) => sum + (getShipTypeById(ship.type)?.attack ?? 0), 0);
}

/** Calculates the total defense value of all ships in a fleet. */
export function getFleetTotalDefense(fleet: Fleet): number {
  return fleet.ships.reduce((sum, ship) => sum + (getShipTypeById(ship.type)?.defense ?? 0), 0);
}

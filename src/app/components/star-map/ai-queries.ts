import { Fleet, Faction, StarSystem } from './star-map.models';

export function getEnemyFleets(factionId: string, fleets: Fleet[]): Fleet[] {
  return fleets.filter(
    (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.length > 0,
  );
}

export function getPlayerFleets(fleets: Fleet[], factions: Faction[]): Fleet[] {
  const playerFactionIds = new Set(
    factions
      .filter((faction) => faction.team === 1)
      .map((faction) => faction.id),
  );

  return fleets.filter(
    (fleet) =>
      playerFactionIds.has(fleet.factionId) && !fleet.destroyed && fleet.ships.length > 0,
  );
}

export function getEnemyPlanets(factionId: string, starSystems: StarSystem[]): StarSystem[] {
  return starSystems.filter((system) =>
    system.planetsTiles.some((planet) => planet.factionId === factionId),
  );
}

export function getUnhabitedPlanets(starSystems: StarSystem[]): { system: StarSystem; planet: StarSystem['planetsTiles'][0] }[] {
  const result: { system: StarSystem; planet: StarSystem['planetsTiles'][0] }[] = [];

  for (const system of starSystems) {
    for (const planet of system.planetsTiles) {
      if (planet.factionId === 'unhabited') {
        result.push({ system, planet });
      }
    }
  }

  return result;
}

export function isPlayerFleet(fleet: Fleet, factions: Faction[]): boolean {
  const playerFactionIds = new Set(
    factions
      .filter((faction) => faction.team === 1)
      .map((faction) => faction.id),
  );
  return playerFactionIds.has(fleet.factionId);
}

/*
 * isCombatShipType: A ship counts as combat-capable when its role is
 * neither Recon nor Colonizer. Shared by the AI action layer (combat
 * ship selection) and the action executor (reinforcement composition)
 * so both agree on what can engage and what can be reinforced.
 */
export function isCombatShipType(shipType: { role: string } | undefined): boolean {
  return shipType !== undefined && shipType.role !== 'Recon' && shipType.role !== 'Colonizer';
}

import { getAiPersonalityProfile } from './ai-personality';
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

/*
 * AI_COLONIZATION_REACH: Maximum distance (galaxy cells) from an owned
 * system at which an AI faction considers an unhabited planet a
 * colonization target. Shared by EnemyStrategyService (whether 'expand'
 * is worth choosing) and EnemyGoalService (which targets qualify) so the
 * two layers never disagree — a strategy that says 'expand' with no goal
 * able to match it would leave the faction idle. Generated maps space
 * systems 22–30 cells apart (neighbours are typically 45–60 cells away);
 * an AI-assembled fleet (0.2 cells/s) needs ~300 s for the full reach.
 */
export const AI_COLONIZATION_REACH = 60;

/* The faction's colonization reach: AI_COLONIZATION_REACH × personality reach. */
export function getColonizationReach(faction: Faction | undefined): number {
  return AI_COLONIZATION_REACH * getAiPersonalityProfile(faction).colonizationReach;
}

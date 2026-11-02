import { getAiPersonalityProfile } from './ai-personality';
import { EconomyBreakdown, Fleet, Faction, StarSystem } from './star-map.models';
import { areFactionsHostile, hostileFactionIds } from './diplomacy';
import { marginalColonyCost } from '../../services/economy.service';

export function getEnemyFleets(factionId: string, fleets: Fleet[]): Fleet[] {
  return fleets.filter(
    (fleet) => fleet.factionId === factionId && !fleet.destroyed && fleet.ships.length > 0,
  );
}

/*
 * Living fleets of every faction `factionId` is at war with (diplomacy.ts).
 * Before diplomacy this meant "the human player's fleets" (team 1); the
 * legacy strategy/goal/capability layers now treat any warring faction,
 * AI or human, as the enemy.
 */
export function getHostileFleets(factionId: string, fleets: Fleet[], factions: Faction[]): Fleet[] {
  const self = factions.find((faction) => faction.id === factionId);
  if (!self) {
    return [];
  }
  const hostileIds = hostileFactionIds(self, factions);
  return fleets.filter(
    (fleet) => hostileIds.has(fleet.factionId) && !fleet.destroyed && fleet.ships.length > 0,
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

export function isHostileFleet(fleet: Fleet, factionId: string, factions: Faction[]): boolean {
  const self = factions.find((faction) => faction.id === factionId);
  const owner = factions.find((faction) => faction.id === fleet.factionId);
  return areFactionsHostile(self, owner);
}

/*
 * isCombatShipType: A ship counts as combat-capable when its role is
 * none of Recon, Colonizer or Outpost. Shared by the AI action layer (combat
 * ship selection) and the action executor (reinforcement composition)
 * so both agree on what can engage and what can be reinforced.
 */
export function isCombatShipType(shipType: { role: string } | undefined): boolean {
  return (
    shipType !== undefined &&
    shipType.role !== 'Recon' &&
    shipType.role !== 'Colonizer' &&
    shipType.role !== 'Outpost' &&
    // The Swarm Constructor (dyson-anchor.ts) is a civilian builder like the outpost ship.
    shipType.role !== 'DysonAnchor'
  );
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

/*
 * How long the treasury may carry the deficit a new colony causes. A fresh
 * colony earns almost nothing at first, so expansion into a deficit is only
 * acceptable while the stock covers it for this long (the same runway the
 * AI's core construction uses, EnemyEconomyService.CORE_RUNWAY_SECONDS).
 */
export const COLONY_RUNWAY_SECONDS = 300;

/*
 * Over-expansion brake for the AI: one more planet raises administration
 * and the empire upkeep scale on the whole empire (marginalColonyCost).
 * The faction may start another colony only if its net credit income stays
 * non-negative afterwards, or its credits cover the resulting deficit for
 * COLONY_RUNWAY_SECONDS. Without this an expansionist kept colonizing at
 * ~0 net income and ended in permanent upkeep arrears.
 */
export function canSupportNewColony(
  breakdown: EconomyBreakdown,
  ownedPlanetCount: number,
  credits: number,
): boolean {
  if (ownedPlanetCount === 0) return true;
  const netAfter = breakdown.netPerSecond - marginalColonyCost(breakdown, ownedPlanetCount);
  return netAfter >= 0 || Math.max(0, credits) >= -netAfter * COLONY_RUNWAY_SECONDS;
}

/*
 * Conquest brake for the AI (the capture counterpart of canSupportNewColony).
 * `netAfter` is the faction's projected net credit income with the target
 * planet already owned (EnemyFleetService.projectedNetAfterCapture: the
 * planet keeps its population and buildings, satisfaction at least
 * CAPTURE_MIN_SATISFACTION, and the empire pays the higher administration
 * share and upkeep scale). A capture is allowed when the faction stays
 * solvent, when the treasury covers the deficit for COLONY_RUNWAY_SECONDS,
 * when the capture improves the net (a struggling faction may still take a
 * rich world), or when the faction owns no planet (its recovery route).
 * Without it a militarist conquered its way to ~-200 credits/s for the rest
 * of a game (QA 2026-11-01).
 */
export function canSupportCapture(netBefore: number, netAfter: number, ownedPlanetCount: number, credits: number): boolean {
  if (ownedPlanetCount === 0) return true;
  if (netAfter >= 0 || netAfter > netBefore) return true;
  return Math.max(0, credits) >= -netAfter * COLONY_RUNWAY_SECONDS;
}

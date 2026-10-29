import { AiPersonality, Faction } from './star-map.models';

export type { AiPersonality } from './star-map.models';

/*
 * AI personalities: small, data-driven strategic preferences.
 *
 * A personality never changes game rules or grants resources; it only
 * weights what the faction considers important. It is read by
 * EnemyPlanService (scoring of strategic priorities) and, through the
 * posture that service publishes, by the economy, fleet and research
 * layers:
 *
 * - `weights` multiply the economy / defense / expansion / offense /
 *   research scores before the primary priority is chosen;
 * - `militaryTarget` scales the economy manager's military strength target;
 * - `assaultMinSurvival` is the share of the assault group's strength a
 *   battle forecast must leave alive before the faction attacks a planet
 *   (lower = bolder);
 * - `homeGuard` is the minimum share of fleet strength kept out of
 *   assaults;
 * - `parallelColonizationMaxThreat` is the defense score up to which the
 *   faction keeps colonizing while also handling a military situation;
 * - `researchBuildingsPerPlanet` caps research buildings per planet;
 * - `colonizationReach` multiplies AI_COLONIZATION_REACH (strategy, goal
 *   and plan all use getColonizationReach, so they never disagree);
 * - `parallelMilitaryProduction`: combat ships on every idle factory and
 *   extra factories even when not wealthy (otherwise only when wealthy or
 *   when the primary priority is attack/defend);
 * - `concurrentColonizations`: colonization objectives the faction runs
 *   at once (primary colonize goal + parallel slot). Each colonizer
 *   carrier is bound to one objective (EnemyActionService).
 * - `factoriesPerPlanet`: Spaceship Factories the economy manager adds per
 *   planet. AI factions are usually rich enough to keep every factory
 *   busy, so factory count is what actually limits warship output.
 *
 * Invariant: 'balanced' is neutral (all weights 1, the Phase 4 behavior).
 * Factions without `aiPersonality` (older saves, the legacy map) are
 * 'balanced'.
 */
export interface AiPersonalityProfile {
  id: AiPersonality;
  label: string;
  weights: { economy: number; defense: number; expansion: number; offense: number; research: number };
  militaryTarget: number;
  assaultMinSurvival: number;
  homeGuard: number;
  parallelColonizationMaxThreat: number;
  researchBuildingsPerPlanet: number;
  colonizationReach: number;
  parallelMilitaryProduction: boolean;
  factoriesPerPlanet: number;
  concurrentColonizations: number;
}

export const AI_PERSONALITY_PROFILES: Readonly<Record<AiPersonality, AiPersonalityProfile>> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    weights: { economy: 1, defense: 1, expansion: 1, offense: 1, research: 1 },
    militaryTarget: 1,
    assaultMinSurvival: 0.5,
    homeGuard: 0.3,
    parallelColonizationMaxThreat: 1,
    researchBuildingsPerPlanet: 1,
    colonizationReach: 1,
    parallelMilitaryProduction: false,
    factoriesPerPlanet: 1,
    concurrentColonizations: 1,
  },
  expansionist: {
    id: 'expansionist',
    label: 'Expansionist',
    weights: { economy: 1, defense: 0.8, expansion: 1.6, offense: 0.7, research: 0.9 },
    militaryTarget: 0.8,
    assaultMinSurvival: 0.6,
    homeGuard: 0.3,
    parallelColonizationMaxThreat: 1.5,
    researchBuildingsPerPlanet: 1,
    colonizationReach: 1.35,
    parallelMilitaryProduction: false,
    factoriesPerPlanet: 1,
    concurrentColonizations: 2,
  },
  militarist: {
    id: 'militarist',
    label: 'Militarist',
    weights: { economy: 1, defense: 1.2, expansion: 0.8, offense: 1.6, research: 0.9 },
    militaryTarget: 1.5,
    assaultMinSurvival: 0.35,
    homeGuard: 0.25,
    parallelColonizationMaxThreat: 0.6,
    researchBuildingsPerPlanet: 1,
    colonizationReach: 1,
    parallelMilitaryProduction: true,
    factoriesPerPlanet: 2,
    concurrentColonizations: 1,
  },
  technologist: {
    id: 'technologist',
    label: 'Technologist',
    weights: { economy: 1.1, defense: 1, expansion: 0.9, offense: 0.8, research: 1.6 },
    militaryTarget: 0.9,
    assaultMinSurvival: 0.6,
    homeGuard: 0.35,
    parallelColonizationMaxThreat: 1,
    researchBuildingsPerPlanet: 2,
    colonizationReach: 1,
    parallelMilitaryProduction: false,
    factoriesPerPlanet: 1,
    concurrentColonizations: 1,
  },
};

export const AI_PERSONALITIES: readonly AiPersonality[] = ['balanced', 'expansionist', 'militarist', 'technologist'];

export function isAiPersonality(value: unknown): value is AiPersonality {
  return typeof value === 'string' && (AI_PERSONALITIES as readonly string[]).includes(value);
}

export function getAiPersonalityProfile(faction: Faction | undefined): AiPersonalityProfile {
  if (!faction || faction.ai !== true || !isAiPersonality(faction.aiPersonality)) {
    return AI_PERSONALITY_PROFILES.balanced;
  }
  return AI_PERSONALITY_PROFILES[faction.aiPersonality];
}

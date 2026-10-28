import { AiDifficulty, Faction } from './star-map.models';

/*
 * AI difficulty profiles.
 *
 * Difficulty is a per-faction property (`Faction.aiDifficulty`) chosen on the
 * New Game screen and persisted with the save. It does not introduce a second
 * AI: the existing pipeline (strategy → goal → capability → action → executor)
 * reads these values at the points listed below.
 *
 * - `attackStrengthAdvantage`: EnemyStrategyService only picks the ATTACK
 *   strategy when an AI fleet is at least this many times stronger than a
 *   nearby player fleet. Lower = more aggressive.
 * - `incomeMultiplier`: EconomyService scales an AI faction's positive
 *   per-planet resource income by this factor. Losses are never scaled.
 * - `startingResourceMultiplier`, `startingFleetPreset`, `extraColonies`:
 *   consumed only by GalaxyGeneratorService when a new game is created.
 *
 * Invariant: 'normal' must stay neutral (multipliers 1, advantage 1.2) so that
 * factions without `aiDifficulty` (older saves, the legacy map) keep the exact
 * behavior they had before difficulty existed.
 */
export interface AiDifficultyProfile {
  id: AiDifficulty;
  label: string;
  attackStrengthAdvantage: number;
  incomeMultiplier: number;
  startingResourceMultiplier: number;
  startingFleetPreset: 'reduced' | 'standard' | 'reinforced';
  extraColonies: number;
}

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'normal';

export const AI_DIFFICULTY_PROFILES: Readonly<Record<AiDifficulty, AiDifficultyProfile>> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    attackStrengthAdvantage: 1.6,
    incomeMultiplier: 0.75,
    startingResourceMultiplier: 0.75,
    startingFleetPreset: 'reduced',
    extraColonies: 0,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    attackStrengthAdvantage: 1.2,
    incomeMultiplier: 1,
    startingResourceMultiplier: 1,
    startingFleetPreset: 'standard',
    extraColonies: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    attackStrengthAdvantage: 1.0,
    incomeMultiplier: 1.3,
    startingResourceMultiplier: 1.5,
    startingFleetPreset: 'reinforced',
    extraColonies: 2,
  },
};

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ['easy', 'normal', 'hard'];

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

/*
 * Resolves the profile for a faction. Human and neutral factions get the
 * neutral 'normal' profile so callers can apply multipliers unconditionally.
 */
export function getAiDifficultyProfile(faction: Faction | undefined): AiDifficultyProfile {
  if (!faction || faction.ai !== true || !isAiDifficulty(faction.aiDifficulty)) {
    return AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY];
  }
  return AI_DIFFICULTY_PROFILES[faction.aiDifficulty];
}

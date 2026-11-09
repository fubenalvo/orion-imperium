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
 * - `combatForecast` (decision quality): when true, EnemyFleetService
 *   judges interceptions and retreats with a battle forecast using the
 *   real combat rules (autoResolveBattle); when false it compares summed
 *   fleet strength, a cruder judgment that ignores weapon matchups,
 *   shields and focus fire.
 * - `reactionInterval` (decision quality): multiplier on the fleet
 *   operations decision interval (2 s); higher = slower reactions.
 * - `militaryTargetMultiplier` (tempo): EnemyEconomyService scales the
 *   navy it aims for (target strength and ship-count cap).
 * - `colonizationCooldownSeconds` (tempo): EnemyGoalService starts no new
 *   colonization until this much game time has passed since the faction's
 *   planet count last grew. Measured 2026-11-09 (APM report): the AI acts
 *   only 4–8 times per game minute on every difficulty, so the gap to a
 *   human is expansion pace and navy size, not decision speed. With the
 *   current values a passive-player 30-minute small game ends with Easy
 *   2–5, Normal 4–8, Hard 5–9 AI planets (before: Easy 6–7, Normal 6–8).
 * - `openingGraceSeconds`: how long this AI spares the human player at the
 *   start (opening-grace.ts).
 * - `adaptiveRange`, `adaptiveTargetRatio`: the adaptive difficulty band
 *   (see "Adaptive difficulty" below).
 *
 * Difficulty never bypasses game mechanics: the only economic advantage
 * is the income multiplier on legitimately produced income.
 *
 * Invariant: 'normal' is the reference setting for decision quality
 * (income multiplier 1, advantage 1.2, combat forecast on, reaction interval
 * 1); factions without `aiDifficulty` (older saves, the legacy map) are
 * treated as 'normal'. Normal is slowed on tempo only (navy 0.85×,
 * colonization pause, no extra starting colony) because play testing found
 * it too fast for a human (2026-11-09).
 *
 * Adaptive difficulty: while the global ADAPTIVE AI option is on
 * (AiSettingsService, Options menu, stored per browser), every AI faction
 * with a difficulty gets its `aiAdaptiveFactor` (missing = 1) on its income,
 * its navy target and its colonization pause. AiAdaptiveDifficultyService
 * moves the factor once per game minute toward keeping the AI's power at
 * `adaptiveTargetRatio` of the human player's, never outside
 * `adaptiveRange`, so the chosen difficulty still sets the floor and the
 * ceiling. It never changes combat rules or grants resources directly.
 * With the option off the saved factor is kept but ignored (factor 1), so
 * turning it back on resumes where it stopped.
 */
export interface AiDifficultyProfile {
  id: AiDifficulty;
  label: string;
  attackStrengthAdvantage: number;
  incomeMultiplier: number;
  startingResourceMultiplier: number;
  startingFleetPreset: 'player' | 'reduced' | 'standard' | 'reinforced';
  extraColonies: number;
  combatForecast: boolean;
  reactionInterval: number;
  militaryTargetMultiplier: number;
  colonizationCooldownSeconds: number;
  openingGraceSeconds: number;
  /* [min, max] of Faction.aiAdaptiveFactor for this difficulty. */
  adaptiveRange: readonly [number, number];
  /* AI power / player power the adaptive factor steers toward. */
  adaptiveTargetRatio: number;
}

export const DEFAULT_AI_DIFFICULTY: AiDifficulty = 'normal';

export const AI_DIFFICULTY_PROFILES: Readonly<Record<AiDifficulty, AiDifficultyProfile>> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    attackStrengthAdvantage: 1.6,
    incomeMultiplier: 0.7,
    startingResourceMultiplier: 0.75,
    startingFleetPreset: 'player',
    extraColonies: 0,
    combatForecast: false,
    reactionInterval: 2,
    militaryTargetMultiplier: 0.6,
    colonizationCooldownSeconds: 360,
    openingGraceSeconds: 600,
    adaptiveRange: [0.6, 1.1],
    adaptiveTargetRatio: 0.85,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    attackStrengthAdvantage: 1.2,
    incomeMultiplier: 1,
    startingResourceMultiplier: 1,
    startingFleetPreset: 'reduced',
    extraColonies: 0,
    combatForecast: true,
    reactionInterval: 1,
    militaryTargetMultiplier: 0.85,
    colonizationCooldownSeconds: 120,
    openingGraceSeconds: 360,
    adaptiveRange: [0.75, 1.2],
    adaptiveTargetRatio: 1,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    attackStrengthAdvantage: 1.0,
    incomeMultiplier: 1.3,
    startingResourceMultiplier: 1.5,
    startingFleetPreset: 'standard',
    extraColonies: 2,
    combatForecast: true,
    reactionInterval: 1,
    militaryTargetMultiplier: 1,
    colonizationCooldownSeconds: 0,
    openingGraceSeconds: 240,
    adaptiveRange: [0.9, 1.35],
    adaptiveTargetRatio: 1.2,
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
export function getAiDifficultyProfile(faction: Pick<Faction, 'ai' | 'aiDifficulty'> | undefined): AiDifficultyProfile {
  if (!faction || faction.ai !== true || !isAiDifficulty(faction.aiDifficulty)) {
    return AI_DIFFICULTY_PROFILES[DEFAULT_AI_DIFFICULTY];
  }
  return AI_DIFFICULTY_PROFILES[faction.aiDifficulty];
}

/* Upper bound of any adaptive factor, used by save validation. */
export const ADAPTIVE_FACTOR_LIMITS: readonly [number, number] = [0.25, 2];

/*
 * Global ADAPTIVE AI switch. Module state rather than an injected service
 * because the economy and AI read the factor from plain functions. Off until
 * AiSettingsService (created by the App root component) applies the stored
 * preference, so headless games — simulations and unit tests — keep fixed
 * difficulty and their measurements stay comparable.
 */
let adaptiveDifficultyEnabled = false;

export function setAdaptiveDifficultyEnabled(enabled: boolean): void {
  adaptiveDifficultyEnabled = enabled;
}

export function isAdaptiveDifficultyEnabled(): boolean {
  return adaptiveDifficultyEnabled;
}

/* AI factions the adaptive difficulty applies to: AIs with a difficulty (not neutrals or pirates). */
export function isAdaptiveAiFaction(faction: Pick<Faction, 'ai' | 'aiDifficulty'> | undefined): boolean {
  return faction?.ai === true && isAiDifficulty(faction.aiDifficulty);
}

/*
 * The faction's adaptive factor, clamped to its difficulty's band; 1 when
 * the option is off or the faction is not an adaptive AI. A missing saved
 * factor (a game that never ran adaptive) counts as 1.
 */
export function getAiAdaptiveFactor(faction: Pick<Faction, 'ai' | 'aiDifficulty' | 'aiAdaptiveFactor'> | undefined): number {
  if (!adaptiveDifficultyEnabled || !faction || !isAdaptiveAiFaction(faction)) {
    return 1;
  }
  if (typeof faction.aiAdaptiveFactor !== 'number' || !Number.isFinite(faction.aiAdaptiveFactor)) {
    return 1;
  }
  const [min, max] = getAiDifficultyProfile(faction).adaptiveRange;
  return Math.min(max, Math.max(min, faction.aiAdaptiveFactor));
}

/* Difficulty income multiplier × adaptive factor (gains only; EconomyService). */
export function getAiIncomeMultiplier(faction: Faction | undefined): number {
  return getAiDifficultyProfile(faction).incomeMultiplier * getAiAdaptiveFactor(faction);
}

/* Difficulty navy multiplier × adaptive factor (EnemyEconomyService.militaryNeed). */
export function getAiMilitaryMultiplier(faction: Faction | undefined): number {
  return getAiDifficultyProfile(faction).militaryTargetMultiplier * getAiAdaptiveFactor(faction);
}

/* Colonization pause; a weaker adaptive factor lengthens it (EnemyGoalService). */
export function getAiColonizationCooldown(faction: Faction | undefined): number {
  return getAiDifficultyProfile(faction).colonizationCooldownSeconds / getAiAdaptiveFactor(faction);
}

/*
 * One adaptive step: the next factor given the AI's power ratio to the
 * human (AI / player). Inside a ±ADAPTIVE_DEADBAND band around the target
 * nothing changes (no oscillation around the target); outside it the
 * factor moves by ADAPTIVE_STEP toward the target, clamped to the band.
 */
export const ADAPTIVE_STEP = 0.05;
export const ADAPTIVE_DEADBAND = 0.15;

export function nextAdaptiveFactor(faction: Faction, powerRatio: number): number {
  const profile = getAiDifficultyProfile(faction);
  const current = getAiAdaptiveFactor(faction);
  const [min, max] = profile.adaptiveRange;
  let next = current;
  if (powerRatio > profile.adaptiveTargetRatio * (1 + ADAPTIVE_DEADBAND)) next = current - ADAPTIVE_STEP;
  else if (powerRatio < profile.adaptiveTargetRatio / (1 + ADAPTIVE_DEADBAND)) next = current + ADAPTIVE_STEP;
  // Rounded so repeated steps never drift by floating-point residue.
  return Math.round(Math.min(max, Math.max(min, next)) * 1000) / 1000;
}

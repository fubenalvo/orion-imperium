import { PlanetType } from './star-map.models';

/*
 * =========================================================
 * COMFORT NEED (pure rules)
 * =========================================================
 *
 * The mid/late-game counterweight to population income (docs/late-economy.md).
 * A planet's population above COMFORT_CONFIG.freePopulation needs comfort:
 * Park, School, Hospital and Entertainment Center provide comfort points
 * (planet-data.json `comfort`), and a planet with all four kinds gets the
 * full-set bonus. Coverage (provided / need) sets the satisfaction TARGET;
 * satisfaction moves toward it at COMFORT_CONFIG.drift points per second.
 * Satisfaction multiplies the planet's credit income and its growth, so
 * uncovered population earns less, while the comfort buildings themselves
 * carry a high upkeep. Both costs grow with population, i.e. with income.
 *
 * The target (satisfactionTarget):
 *   comfort part = 100 × (1 − (1 − floor) × uncovered share), where the
 *                  uncovered share = (excess population / population) ×
 *                  (1 − coverage): the part of the people who lack comfort.
 *                  Uncovered people count at `floor`, covered and free
 *                  people at 100%, so the target falls smoothly from the
 *                  free population on (no cliff at the threshold), every
 *                  comfort point counts, and comfort alone never pulls a
 *                  planet below `floor` (it never rebels from this rule);
 *   × energy factor = max(0, 1 − energyTargetLoss × shortfall) — a power
 *                  shortage still lowers the target, down to 0 (rebellion)
 *                  at a 50% shortfall, as the old energy drift did;
 *   + 100 × (habitability + building morale) — the planet type's small
 *                  malus and industrial buildings' negative morale (comfort
 *                  buildings carry no morale: their effect is their points).
 *                  Only on a planet above the free population (the caller
 *                  passes 0 otherwise), so the opening keeps 100%.
 * Clamped to [0, 100]. Energy no longer pushes satisfaction up by itself:
 * the target, not a positive drift, is the ceiling.
 *
 * Everything here is derived from the planet's buildings and population,
 * nothing is saved.
 */
export const COMFORT_CONFIG = {
  /* Population a planet carries without any comfort: the opening and small colonies are untouched. */
  freePopulation: 5000,
  /* People one comfort point covers above the free population (× the type factor). */
  peoplePerComfort: 500,
  /* Harsher worlds need more comfort per person. */
  typeFactor: {
    earthlike: 1,
    gasgiant: 1.3,
    marslike: 1.4,
    desert: 1.6,
    venuslike: 1.6,
    ice: 2,
  } as Record<PlanetType, number>,
  /* Extra comfort (share of the provided points) with all four comfort kinds on the planet. */
  fullSetBonus: 0.15,
  /*
   * Lowest satisfaction comfort alone can cause (0–1). Tunable
   * (docs/late-economy.md, "Decisions"); must stay above the AI's stability
   * threshold (EnemyPlanService.STABILITY_THRESHOLD, 40) or an AI with
   * neglected planets would sit in its "stabilize" posture for good.
   */
  floor: 0.6,
  /* Satisfaction points per second toward the target, up and down. */
  drift: 1,
  /* Target lost per unit of energy shortfall: 25% short → ×0.5, 50% short → 0. */
  energyTargetLoss: 2,
} as const;

/* The four comfort building kinds (planet-data.json names). */
export const COMFORT_BUILDING_NAMES = ['Central Park', 'School', 'Hospital', 'Entertainment Center'] as const;

export function comfortTypeFactor(type: PlanetType | string | undefined): number {
  return (COMFORT_CONFIG.typeFactor as Record<string, number>)[type ?? ''] ?? 1;
}

/* Comfort points a planet needs for its population. */
export function comfortNeed(population: number, type: PlanetType | string | undefined): number {
  const excess = Math.max(0, (population || 0) - COMFORT_CONFIG.freePopulation);
  return (excess * comfortTypeFactor(type)) / COMFORT_CONFIG.peoplePerComfort;
}

/*
 * Comfort points the planet's buildings provide. `pointsOf` maps a building
 * name to its comfort points (0 for non-comfort buildings).
 */
export function comfortProvided(
  buildingNames: readonly string[],
  pointsOf: (name: string) => number,
): { points: number; fullSet: boolean } {
  let base = 0;
  const kinds = new Set<string>();
  for (const name of buildingNames) {
    const points = pointsOf(name);
    if (points > 0) {
      base += points;
      kinds.add(name);
    }
  }
  const fullSet = COMFORT_BUILDING_NAMES.every((name) => kinds.has(name));
  return { points: base * (fullSet ? 1 + COMFORT_CONFIG.fullSetBonus : 1), fullSet };
}

/* 0 … 1; a planet that needs nothing is fully covered. */
export function comfortCoverage(need: number, provided: number): number {
  return need <= 0 ? 1 : Math.max(0, Math.min(1, provided / need));
}

/* Share of a planet's population above the free population, 0 … 1. */
export function excessShare(population: number): number {
  return population > 0 ? Math.max(0, population - COMFORT_CONFIG.freePopulation) / population : 0;
}

/*
 * The satisfaction the planet moves toward, 0 … 100 (see the module note).
 * `excess` is excessShare(population); `efficiency` is the planet's energy
 * efficiency (1 = fully powered); `habitability` and `morale` are drifts
 * per second in the old units (e.g. ice −0.08), read here as percentage
 * points × 100.
 */
export function satisfactionTarget(
  coverage: number,
  excess: number,
  efficiency: number,
  habitability: number,
  morale: number,
): number {
  const uncovered = Math.max(0, Math.min(1, excess)) * (1 - Math.max(0, Math.min(1, coverage)));
  const comfort = 100 * (1 - (1 - COMFORT_CONFIG.floor) * uncovered);
  const shortfall = Math.max(0, Math.min(1, 1 - efficiency));
  const energy = Math.max(0, 1 - COMFORT_CONFIG.energyTargetLoss * shortfall);
  return Math.max(0, Math.min(100, comfort * energy + 100 * (habitability + morale)));
}

/* Satisfaction after `deltaSeconds`: toward the target at COMFORT_CONFIG.drift, never past it. */
export function stepSatisfaction(current: number, target: number, deltaSeconds: number): number {
  if (!(deltaSeconds > 0)) return current;
  const step = COMFORT_CONFIG.drift * deltaSeconds;
  const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
  return Math.max(0, Math.min(100, next));
}

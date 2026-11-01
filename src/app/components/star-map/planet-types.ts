import { PlanetType } from './star-map.models';

/*
 * Planet type traits — the single source of truth for what a planet's type
 * changes in the economy (docs/economy.md, "Planet types"). Habitability
 * (satisfaction drift) stays in PLANET_TYPE_HABITABILITY.
 *
 * Design: the earthlike world is the ideal home (every factor 1). Every
 * other type is a trade-off: a lower population ceiling (= less credit
 * income, the main income source) and pricier building upkeep (heating,
 * cooling, domes), against one advantage that gives a reason to settle it.
 *
 * Applied by EconomyService for the player and the AI alike:
 * - populationCapacity: × the housing capacity (getPopulationCapacity).
 * - buildingUpkeep: × the upkeep of every building on the planet (also when
 *   the AI prices a new building for that planet).
 * - depositMining: × the output of deposit mines (Mining Complex).
 * - researchOutput: × the research output of the planet's buildings.
 * - energyOutput: × the energy of the planet's power buildings (not the
 *   colony core).
 * - gasHarvest: flat raw materials/s of a populated, owned planet. Like the
 *   population trickle it is not a deposit and never runs out.
 */
export interface PlanetTypeTraits {
  populationCapacity: number;
  buildingUpkeep: number;
  depositMining: number;
  researchOutput: number;
  energyOutput: number;
  gasHarvest: number;
  /* Short player-facing summary for the planet panels. */
  summary: string;
}

const NEUTRAL: Omit<PlanetTypeTraits, 'summary'> = {
  populationCapacity: 1,
  buildingUpkeep: 1,
  depositMining: 1,
  researchOutput: 1,
  energyOutput: 1,
  gasHarvest: 0,
};

export const PLANET_TYPE_TRAITS: Readonly<Record<PlanetType, PlanetTypeTraits>> = {
  earthlike: { ...NEUTRAL, summary: 'Ideal world: no penalties' },
  marslike: {
    ...NEUTRAL, populationCapacity: 0.75, buildingUpkeep: 1.15, depositMining: 1.25,
    summary: 'Population 75%, upkeep +15%, mining +25%',
  },
  desert: {
    ...NEUTRAL, populationCapacity: 0.7, buildingUpkeep: 1.15, depositMining: 1.25,
    summary: 'Population 70%, upkeep +15%, mining +25%',
  },
  venuslike: {
    ...NEUTRAL, populationCapacity: 0.6, buildingUpkeep: 1.3, energyOutput: 1.25,
    summary: 'Population 60%, upkeep +30%, power plants +25% (geothermal)',
  },
  ice: {
    ...NEUTRAL, populationCapacity: 0.6, buildingUpkeep: 1.3, researchOutput: 1.25,
    summary: 'Population 60%, upkeep +30%, research +25%',
  },
  gasgiant: {
    ...NEUTRAL, populationCapacity: 0.5, buildingUpkeep: 1.2, gasHarvest: 3,
    summary: 'Population 50%, upkeep +20%, gas harvesting +3 raw/s',
  },
};

export function planetTypeTraits(type: PlanetType | string | undefined): PlanetTypeTraits {
  return PLANET_TYPE_TRAITS[type as PlanetType] ?? PLANET_TYPE_TRAITS.earthlike;
}

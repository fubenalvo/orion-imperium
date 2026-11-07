import researchTreeData from './research-tree.json';
import { UPKEEP_CREDITS_PER_POINT } from '../../services/economy.service';
import type { BuildingType } from './star-map-planet-screen/star-map-planet-screen.component';

/*
 * Player-facing explanation of a building: what it is for (a hand-written
 * one-liner per building id) plus effect lines derived from planet-data.json.
 *
 * The planet screen shows it in the info box that opens under a clicked
 * build-list row (docs/planet-surface.md, "Building info box"), so the build
 * list itself stays one compact row per building.
 *
 * The numbers come from the building data, so balance changes show up
 * automatically. The summaries are prose and must be kept in step with the
 * rules they describe (economy.md, planet-capture.md, fleet-organization.md,
 * trade-network.md); a building without a summary falls back to its category.
 */

export type BuildingInfoTone = 'gain' | 'cost' | 'neutral';

export interface BuildingInfoLine {
  label: string;
  value: string;
  tone: BuildingInfoTone;
}

export interface BuildingInfo {
  category: string;
  summary: string;
  effects: BuildingInfoLine[];
  notes: string[];
}

const CATEGORY_BY_ROLE: Record<string, string> = {
  defense: 'Defense',
  housing: 'Housing',
  social: 'Comfort',
  power: 'Power',
  industry: 'Industry',
  military: 'Military',
  research: 'Research',
  trade: 'Trade',
  finance: 'Finance',
  core: 'Colony core',
};

const SUMMARY_BY_ID: Record<string, string> = {
  laser_turret:
    'Defends the planet: rapid, short-range energy fire at attacking ships. A planet without any turret is captured as soon as an enemy fleet arrives.',
  missile_turret:
    'Defends the planet: slow, long-range missile volleys at attacking ships. A planet without any turret is captured as soon as an enemy fleet arrives.',
  planetary_shield:
    'A regenerating shield that protects the planet’s turrets in battle. It does not fight: without a turret the planet is still captured on arrival.',
  small_residential: 'Homes for more people. Inhabitants pay the taxes that make most of your credits and supply the workers other buildings need.',
  medium_residential: 'Homes for more people. Inhabitants pay the taxes that make most of your credits and supply the workers other buildings need.',
  large_residential: 'Homes for more people. Inhabitants pay the taxes that make most of your credits and supply the workers other buildings need.',
  park: 'Keeps a crowded planet content. Comfort only matters above 5,000 inhabitants; owning all four comfort buildings adds +15%.',
  school: 'Keeps a crowded planet content. Comfort only matters above 5,000 inhabitants; owning all four comfort buildings adds +15%.',
  hospital: 'Keeps a crowded planet content. Comfort only matters above 5,000 inhabitants; owning all four comfort buildings adds +15%.',
  entertainment_center:
    'Keeps a crowded planet content. Comfort only matters above 5,000 inhabitants; owning all four comfort buildings adds +15%.',
  solar_array: 'Cheap, small power source. Most buildings need energy; a planet short on energy produces less and grows unhappy.',
  fusion_plant: 'Large power source for a developed planet. A planet short on energy produces less and grows unhappy.',
  spaceship_factory: 'Builds ships (PRODUCTION tab). Finished ships go to your empire-wide stock; a Spaceport turns them into fleets.',
  spaceport: 'Turns stocked ships into fleets (ASSEMBLY tab), gives access to the ship reserve and repairs your fleets in orbit.',
  mining_complex: 'Mines raw materials from the planet’s ore deposit, the main source of raw materials for ships. The deposit runs out eventually.',
  small_research_lab: 'Produces research points for new technologies.',
  research_lab: 'Produces research points for new technologies.',
  trading_post:
    'Opens the TRADE tab to swap credits and raw materials (at poor rates) and joins the civilian trade network: traders pay you credits on delivery.',
  bank: 'Produces credits directly.',
};

const NOTE_BY_ID: Record<string, string> = {
  spaceport: 'Repairs fleets in orbit at 5% hull per second.',
  mining_complex: 'Output scales with the deposit’s richness.',
};

const technologyByBuilding = new Map<string, string>();
for (const tech of (researchTreeData as { technologies: { name: string; unlocksBuildings?: string[] }[] }).technologies) {
  for (const buildingId of tech.unlocksBuildings ?? []) {
    if (!technologyByBuilding.has(buildingId)) technologyByBuilding.set(buildingId, tech.name);
  }
}

/* Name of the technology that unlocks the building, if any. */
export function unlockingTechnologyName(buildingId: string): string | null {
  return technologyByBuilding.get(buildingId) ?? null;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

export function describeBuilding(building: BuildingType): BuildingInfo {
  const effects: BuildingInfoLine[] = [];
  const production = building.production ?? {};

  if (building.population > 0) {
    effects.push({ label: 'Housing', value: `+${building.population} people`, tone: 'gain' });
  }
  if ((building.providesWorkforce ?? 0) > 0) {
    effects.push({ label: 'Workers', value: `+${building.providesWorkforce}`, tone: 'gain' });
  }
  if ((building.energyProduction ?? 0) > 0) {
    effects.push({ label: 'Energy', value: signed(building.energyProduction), tone: 'gain' });
  }
  if (production.rawmaterials) {
    effects.push({ label: 'Raw materials', value: `+${production.rawmaterials}/s`, tone: 'gain' });
  }
  if (production.research) {
    effects.push({ label: 'Research', value: `+${production.research}/s`, tone: 'gain' });
  }
  if (production.credits) {
    effects.push({ label: 'Credits', value: `+${production.credits}/s`, tone: 'gain' });
  }
  if (building.comfort) {
    effects.push({ label: 'Comfort', value: `+${building.comfort}`, tone: 'gain' });
  }
  if (building.attack) {
    effects.push({ label: 'Attack', value: `${building.attack} · range ${building.range ?? '?'}`, tone: 'neutral' });
  }
  if (building.shield) {
    effects.push({ label: 'Shield', value: `${building.shield} (+${building.shieldRegen ?? 0} regen)`, tone: 'neutral' });
  }

  if ((building.energyConsumption ?? 0) > 0) {
    effects.push({ label: 'Energy', value: signed(-building.energyConsumption), tone: 'cost' });
  }
  if (building.workforce > 0) {
    effects.push({ label: 'Workers needed', value: `${building.workforce}`, tone: 'cost' });
  }
  if (building.maintenanceCost > 0) {
    const upkeep = building.maintenanceCost * UPKEEP_CREDITS_PER_POINT;
    effects.push({ label: 'Base upkeep', value: `${upkeep.toFixed(1)} CR/s`, tone: 'cost' });
  }
  if (building.moraleRate < 0) {
    effects.push({ label: 'Satisfaction', value: 'slightly lower', tone: 'cost' });
  }

  const notes: string[] = [`Size ${building.size}×${building.size}.`];
  if (building.requiresOreProximity) notes.push('Must touch an ore deposit.');
  if (building.maxPerPlanet) notes.push(building.maxPerPlanet === 1 ? 'One per planet.' : `At most ${building.maxPerPlanet} per planet.`);
  const extra = NOTE_BY_ID[building.id];
  if (extra) notes.push(extra);

  const category = CATEGORY_BY_ROLE[building.role] ?? building.role;
  return { category, summary: SUMMARY_BY_ID[building.id] ?? category, effects, notes };
}

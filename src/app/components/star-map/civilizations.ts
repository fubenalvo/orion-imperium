import { AsteroidBelt, Fleet, PlanetBuilding, PlanetSize, PlanetTile, PlanetType, SpecialObject, StarSystem } from './star-map.models';
import { ASTEROID_BELT_CONFIG, beltAxisDistance, beltNavigationRadius, beltObstacles } from './asteroid-belts';
import { NavGraph, buildNavObstacles } from './fleet-navigation';
import { centerLayout } from './planet-surface/planet-surface-generator';
import { getPlanetGridSize } from './planet-surface/planet-surface';
import { planetTypeTraits } from './planet-types';

/*
 * Independent civilizations (docs/trade-network.md#independent-civilizations).
 *
 * Peaceful neutral cultures generated at New Game in star systems of their
 * own, ADDED to the regular systems of the galaxy preset. Each lives on one
 * or two `independent` planets tagged with `PlanetTile.civilization`; its
 * capital always has a Bank and a Trading Post, so every civilization is a
 * node of the civilian trade network, plus light defenses.
 *
 * They are not factions and have no simulation: no fleets, no diplomacy, no
 * AI. Their existence is ownership + buildings + their traders. Any empire
 * may conquer them through the normal capture rules.
 *
 * Placement runs after the rest of the galaxy (systems, fleets, nebulae,
 * belts) and uses its own rng stream, so a seed's original layout is
 * unchanged. A civilization system keeps the regular system spacing, stays
 * well away from home systems, clear of belts, starting fleets and the black
 * hole, and must stay reachable from every other system. When no position
 * qualifies, that civilization is skipped (a galaxy may have fewer).
 */

export const CIVILIZATION_CONFIG = {
  systemsBySize: { small: 3, medium: 4, large: 5 } as Record<string, number>,
  /* Distance from every home system, × the preset's minimum system spacing. */
  homeDistanceFactor: 1.3,
  /* Cells kept between a civilization system and a starting fleet. Belts keep ASTEROID_BELT_CONFIG.systemClearance, as for every system. */
  fleetClearance: 4,
  candidatesPerSystem: 80,
  /* Planets in a civilization system (the capital is planet 1). */
  planetCountWeights: [0, 3, 3, 2],
  /* Chance that planet 2 is a second civilization world. */
  secondWorldChance: 0.5,
  capitalTypes: ['earthlike', 'earthlike', 'marslike', 'desert'] as PlanetType[],
  capitalSizes: ['medium', 'big', 'huge'] as PlanetSize[],
  /* Share of the housing capacity (after the type ceiling) that is populated. */
  populationShare: 0.8,
  /* Starting satisfaction: what a conqueror inherits (capture keeps at least 40). */
  satisfaction: 60,
  names: [
    'Veyra Concord', 'Tessaran League', 'Ombrin Cooperative', 'Halcyon Free Cities', 'Quorran Mercantile Union',
    'Seluvi Assembly', 'Drennic Guilds', 'Aurel Compact', 'Ithari Commonwealth', 'Kosmar Exchange',
  ],
} as const;

/*
 * Capital: housing 150 workforce for 146 required; Fusion Power Plant + the
 * Colony Center a conqueror receives (colony-core.ts; 110 energy once
 * owned) for 77 used, so a conqueror inherits a
 * working, powered planet. Shield + 2 laser + 2 missile turrets: strong
 * enough that an opening fleet cannot simply take it (the AI also waits,
 * see AiPersonalityProfile.civilizationAssaultAfter). Authored at the
 * origin; centerLayout centers it.
 */
export const CAPITAL_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
  { name: 'Medium Residential Block', size: 2, x: 3, y: 0 },
  { name: 'Fusion Power Plant', size: 3, x: 5, y: 0 },
  { name: 'Bank', size: 2, x: 0, y: 3 },
  { name: 'Trading Post', size: 2, x: 2, y: 3 },
  { name: 'Planetary Shield', size: 2, x: 4, y: 3 },
  { name: 'Laser Turret', size: 1, x: 6, y: 3 },
  { name: 'Laser Turret', size: 1, x: 7, y: 3 },
  { name: 'Missile Turret', size: 1, x: 6, y: 4 },
  { name: 'Missile Turret', size: 1, x: 7, y: 4 },
];
const CAPITAL_HOUSING = 700 + 300;

/* Second world: a small settlement (workforce 50 for 23, energy 50 for 14). */
const OUTPOST_BUILDINGS: readonly PlanetBuilding[] = [
  { name: 'Medium Residential Block', size: 2, x: 0, y: 0 },
  { name: 'Solar Array', size: 2, x: 2, y: 0 },
  { name: 'Laser Turret', size: 1, x: 4, y: 0 },
  { name: 'Missile Turret', size: 1, x: 4, y: 1 },
];
const OUTPOST_HOUSING = 300;

export interface CivilizationInput {
  rng: () => number;
  width: number;
  height: number;
  center: { x: number; y: number };
  minSystemSpacing: number;
  blackHoleClearance: number;
  edgeMargin: number;
  galaxySize: string;
  starSystems: readonly StarSystem[];
  homeSystems: readonly StarSystem[];
  fleets: readonly Fleet[];
  asteroidBelts: readonly AsteroidBelt[];
  specialObjects: readonly SpecialObject[];
  /* Unused star names, in order; one per civilization system. */
  starNames: readonly string[];
  nextPlanetId: number;
  /* Returns a galaxy-unique planet name. */
  planetName: () => string;
  /* Planet layout positions by planet index (same as regular systems). */
  planetLayout: readonly { x: number; y: number }[];
  planetTypes: readonly PlanetType[];
  planetSizes: readonly PlanetSize[];
  starColors: readonly string[];
}

/* Creates the civilization systems (not yet part of `starSystems`). */
export function generateCivilizationSystems(input: CivilizationInput): StarSystem[] {
  const cfg = CIVILIZATION_CONFIG;
  const { rng } = input;
  const count = cfg.systemsBySize[input.galaxySize] ?? 0;
  const names = shuffled(rng, [...cfg.names]);
  // The obstacles never change during placement: one graph for every query.
  const graph = new NavGraph([...buildNavObstacles(input.specialObjects), ...beltObstacles(input.asteroidBelts)], {
    width: input.width,
    height: input.height,
  });
  const anchor = input.homeSystems[0];
  const placed: StarSystem[] = [];
  let nextPlanetId = input.nextPlanetId;

  for (let n = 0; n < count && n < input.starNames.length; n++) {
    const all = [...input.starSystems, ...placed];
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < cfg.candidatesPerSystem; attempt++) {
      const candidate = {
        x: input.edgeMargin + 1 + Math.floor(rng() * (input.width - 2 * input.edgeMargin)),
        y: input.edgeMargin + 1 + Math.floor(rng() * (input.height - 2 * input.edgeMargin)),
      };
      if (!isAllowedPosition(candidate, input, all)) continue;
      const nearest = Math.min(...all.map((s) => Math.hypot(s.x - candidate.x, s.y - candidate.y)));
      if (nearest <= bestScore) continue;
      // All existing systems are mutually connected (generation guarantees
      // it), so reaching one home system means reaching every system. This
      // is the expensive test, so it runs only for a new best candidate.
      if (anchor && !graph.plan({ x: anchor.x, y: anchor.y }, candidate).ok) continue;
      bestScore = nearest;
      best = candidate;
    }
    if (!best) continue;

    const civilization = names[n % names.length];
    const name = input.starNames[n];
    const planetCount = 1 + weighted(rng, cfg.planetCountWeights);
    const planetsTiles: PlanetTile[] = [];
    for (let index = 1; index <= planetCount; index++) {
      const layout = input.planetLayout[index - 1];
      planetsTiles.push({
        id: nextPlanetId++,
        index,
        name: input.planetName(),
        factionId: 'unhabited',
        x: layout.x,
        y: layout.y,
        type: pick(rng, input.planetTypes),
        size: pick(rng, input.planetSizes),
        population: 0,
        buildings: [],
        explored: false,
      });
    }
    settle(planetsTiles[0], civilization, CAPITAL_BUILDINGS, CAPITAL_HOUSING, {
      type: pick(rng, cfg.capitalTypes),
      size: pick(rng, cfg.capitalSizes),
    });
    if (planetsTiles.length > 1 && rng() < cfg.secondWorldChance) {
      const second = planetsTiles[1];
      settle(second, civilization, OUTPOST_BUILDINGS, OUTPOST_HOUSING, {
        type: second.type === 'gasgiant' ? 'marslike' : second.type,
        size: second.size === 'tiny' ? 'small' : second.size,
      });
    }
    placed.push({
      id: name.toLowerCase(),
      name,
      x: best.x,
      y: best.y,
      planets: planetsTiles.length,
      color: pick(rng, input.starColors),
      explored: true,
      planetsTiles,
    });
  }
  return placed;
}

function isAllowedPosition(p: { x: number; y: number }, input: CivilizationInput, systems: readonly StarSystem[]): boolean {
  const cfg = CIVILIZATION_CONFIG;
  if (Math.hypot(p.x - input.center.x, p.y - input.center.y) < input.blackHoleClearance) return false;
  if (systems.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < input.minSystemSpacing)) return false;
  const homeDistance = input.minSystemSpacing * cfg.homeDistanceFactor;
  if (input.homeSystems.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < homeDistance)) return false;
  if (input.fleets.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < cfg.fleetClearance)) return false;
  return input.asteroidBelts.every((belt) => beltAxisDistance(belt, p) > beltNavigationRadius(belt) + ASTEROID_BELT_CONFIG.systemClearance);
}

function settle(
  planet: PlanetTile,
  civilization: string,
  layout: readonly PlanetBuilding[],
  housing: number,
  shape: { type: PlanetType; size: PlanetSize },
): void {
  planet.type = shape.type;
  planet.size = shape.size;
  planet.factionId = 'independent';
  planet.civilization = civilization;
  planet.satisfaction = CIVILIZATION_CONFIG.satisfaction;
  planet.population = Math.floor(housing * planetTypeTraits(shape.type).populationCapacity * CIVILIZATION_CONFIG.populationShare);
  planet.buildings = centerLayout(layout, getPlanetGridSize(planet));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function shuffled<T>(rng: () => number, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/* Index drawn with the given weights. */
function weighted(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

import { PlanetTile, ResourceDeposit } from './star-map.models';

export function createMulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateResourceTilesForPlanet(
  planet: PlanetTile,
  getGridSize: (p: PlanetTile) => number,
): ResourceDeposit[] {
  const gridSize = getGridSize(planet);
  const rng = createMulberry32(planet.id * 4967297);
  const tiles: ResourceDeposit[] = [];
  tiles.push({
    type: 'rawmaterial',
    x: Math.floor(rng() * gridSize),
    y: Math.floor(rng() * gridSize),
  });
  if (rng() < 0.05) {
    tiles.push({
      type: 'rawmaterial',
      x: Math.floor(rng() * gridSize),
      y: Math.floor(rng() * gridSize),
    });
  }
  return tiles;
}

export function selectPlanetsForResources(planets: PlanetTile[]): Set<number> {
  const targetCount = Math.max(1, Math.round(planets.length * 0.2));
  const indices = planets.map((_, i) => i);
  const baseSeed = planets.reduce((sum, p) => sum + p.id, 0);
  const rng = createMulberry32(baseSeed);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const selected = new Set<number>();
  for (let k = 0; k < Math.min(targetCount, indices.length); k++) {
    selected.add(planets[indices[k]].id);
  }
  return selected;
}

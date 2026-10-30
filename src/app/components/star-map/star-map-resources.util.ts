import { PlanetTile, ResourceDeposit } from './star-map.models';
import { pickResourceDeposits } from './planet-surface/planet-surface-generator';

export function createMulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/*
 * Deposits are placed on buildable ground (never on terrain obstacles) with
 * clearance around them; see pickResourceDeposits. Call after the planet's
 * surface exists so the terrain mask is respected.
 */
export function generateResourceTilesForPlanet(
  planet: PlanetTile,
  getGridSize: (p: PlanetTile) => number,
): ResourceDeposit[] {
  const rng = createMulberry32(planet.id * 4967297);
  return pickResourceDeposits(planet, getGridSize(planet), rng);
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

import { describe, it, expect } from 'vitest';
import { checkBuildingPlacement } from './building-placement';
import { PlanetTile } from './star-map.models';

describe('checkBuildingPlacement', () => {
  const planet = (overrides: Partial<PlanetTile> = {}): PlanetTile => ({
    id: 1,
    index: 0,
    name: 'P',
    factionId: 'player',
    x: 1,
    y: 1,
    type: 'earthlike',
    size: 'medium',
    population: 100,
    buildings: [{ name: 'Spaceport', size: 2, x: 4, y: 4 }],
    resourceTiles: [{ x: 0, y: 9 }],
    explored: true,
    ...overrides,
  } as PlanetTile);
  const house = { size: 1 };
  const mine = { size: 3, requiresOreProximity: true };

  it('accepts a free cell', () => {
    expect(checkBuildingPlacement(planet(), 10, house, 0, 0)).toBeNull();
  });

  it('rejects footprints outside the grid', () => {
    expect(checkBuildingPlacement(planet(), 10, { size: 2 }, 9, 0)).toBe('out_of_grid');
    expect(checkBuildingPlacement(planet(), 10, house, -1, 0)).toBe('out_of_grid');
    expect(checkBuildingPlacement(planet(), 10, house, 0.5, 0)).toBe('out_of_grid');
  });

  it('rejects overlap with an existing building', () => {
    expect(checkBuildingPlacement(planet(), 10, { size: 2 }, 3, 3)).toBe('overlap');
    expect(checkBuildingPlacement(planet(), 10, house, 6, 4)).toBeNull();
  });

  it('rejects ordinary buildings on a deposit and mines away from one', () => {
    expect(checkBuildingPlacement(planet(), 10, house, 0, 9)).toBe('on_deposit');
    expect(checkBuildingPlacement(planet(), 10, mine, 1, 6)).toBeNull();
    expect(checkBuildingPlacement(planet(), 10, mine, 6, 0)).toBe('needs_deposit');
  });
});

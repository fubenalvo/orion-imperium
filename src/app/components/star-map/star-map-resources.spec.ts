import { describe, it, expect } from 'vitest';
import {
  createMulberry32,
  generateResourceTilesForPlanet,
  selectPlanetsForResources,
} from './star-map-resources.util';
import { PlanetTile } from './star-map.models';

const makePlanet = (id: number, size: 'medium' = 'medium'): PlanetTile => ({
  id,
  index: id,
  name: `Planet ${id}`,
  factionId: 'player',
  x: 0,
  y: 0,
  type: 'earthlike',
  size,
  population: 0,
  buildings: [],
  explored: true,
  resourceTiles: [],
});

const getGridSize = (_p: PlanetTile): number => 9;

describe('resource deposit generation', () => {
  describe('createMulberry32', () => {
    it('should produce deterministic values for the same seed', () => {
      const a = createMulberry32(12345);
      const b = createMulberry32(12345);
      expect(a()).toBe(b());
      expect(a()).toBe(b());
    });

    it('should produce different values for different seeds', () => {
      const a = createMulberry32(12345);
      const b = createMulberry32(54321);
      expect(a()).not.toBe(b());
    });
  });

  describe('generateResourceTilesForPlanet', () => {
    it('should return at least one rawmaterial tile', () => {
      const planet = makePlanet(1);
      const tiles = generateResourceTilesForPlanet(planet, getGridSize);
      expect(tiles.length).toBeGreaterThanOrEqual(1);
      expect(tiles[0].type).toBe('rawmaterial');
    });

    it('should place tiles within valid grid bounds', () => {
      const planet = makePlanet(2);
      const tiles = generateResourceTilesForPlanet(planet, getGridSize);
      for (const tile of tiles) {
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(9);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(9);
      }
    });

    it('should produce at most 2 tiles', () => {
      const planet = makePlanet(3);
      const tiles = generateResourceTilesForPlanet(planet, getGridSize);
      expect(tiles.length).toBeLessThanOrEqual(2);
    });

    it('should be deterministic for the same planet id', () => {
      const planet = makePlanet(42);
      const first = generateResourceTilesForPlanet(planet, getGridSize);
      const second = generateResourceTilesForPlanet(planet, getGridSize);
      expect(first).toEqual(second);
    });
  });

  describe('selectPlanetsForResources', () => {
    it('should select exactly 20% of planets with proper rounding', () => {
      const planets = Array.from({ length: 29 }, (_, i) => makePlanet(i + 1));
      const selected = selectPlanetsForResources(planets);
      expect(selected.size).toBe(Math.round(29 * 0.2));
    });

    it('should select at least 1 planet even for small counts', () => {
      const planets = [makePlanet(1), makePlanet(2)];
      const selected = selectPlanetsForResources(planets);
      expect(selected.size).toBeGreaterThanOrEqual(1);
    });

    it('should not select more planets than available', () => {
      const planets = [makePlanet(1)];
      const selected = selectPlanetsForResources(planets);
      expect(selected.size).toBeLessThanOrEqual(planets.length);
    });

    it('should be deterministic', () => {
      const planets = Array.from({ length: 29 }, (_, i) => makePlanet(i + 1));
      const first = selectPlanetsForResources(planets);
      const second = selectPlanetsForResources(planets);
      expect(first).toEqual(second);
    });
  });
});

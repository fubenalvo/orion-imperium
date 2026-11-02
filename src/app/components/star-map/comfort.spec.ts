import { describe, expect, it } from 'vitest';
import {
  COMFORT_BUILDING_NAMES,
  COMFORT_CONFIG,
  comfortCoverage,
  comfortNeed,
  comfortProvided,
  excessShare,
  satisfactionTarget,
  stepSatisfaction,
} from './comfort';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { PlanetTile } from './star-map.models';

/* Comfort need (docs/late-economy.md): need, points, full set, coverage, target and drift. */

const points: Record<string, number> = { 'Central Park': 1, School: 2, Hospital: 3, 'Entertainment Center': 4 };
const pointsOf = (name: string) => points[name] ?? 0;

describe('comfort rules', () => {
  it('needs nothing up to the free population, then scales with population and planet type', () => {
    expect(comfortNeed(COMFORT_CONFIG.freePopulation, 'earthlike')).toBe(0);
    expect(comfortNeed(0, 'ice')).toBe(0);
    const excess = 5000;
    expect(comfortNeed(COMFORT_CONFIG.freePopulation + excess, 'earthlike')).toBeCloseTo(excess / COMFORT_CONFIG.peoplePerComfort);
    expect(comfortNeed(COMFORT_CONFIG.freePopulation + excess, 'ice')).toBeCloseTo((2 * excess) / COMFORT_CONFIG.peoplePerComfort);
    expect(comfortNeed(10000, 'desert')).toBeGreaterThan(comfortNeed(10000, 'marslike'));
  });

  it('sums the points of every comfort building and adds the full-set bonus only with all four kinds', () => {
    expect(comfortProvided(['Central Park', 'Central Park', 'Solar Array'], pointsOf)).toEqual({ points: 2, fullSet: false });
    const all = comfortProvided([...COMFORT_BUILDING_NAMES], pointsOf);
    expect(all.fullSet).toBe(true);
    expect(all.points).toBeCloseTo(10 * (1 + COMFORT_CONFIG.fullSetBonus));
  });

  it('coverage is provided / need, capped, and full when nothing is needed', () => {
    expect(comfortCoverage(0, 0)).toBe(1);
    expect(comfortCoverage(10, 5)).toBe(0.5);
    expect(comfortCoverage(4, 9)).toBe(1);
  });

  it('uncovered people count at the floor: the target falls with the uncovered share of the population', () => {
    const floor = 100 * COMFORT_CONFIG.floor;
    expect(satisfactionTarget(1, 1, 1, 0, 0)).toBe(100);
    expect(satisfactionTarget(0, 1, 1, 0, 0)).toBeCloseTo(floor);
    expect(satisfactionTarget(0.5, 1, 1, 0, 0)).toBeCloseTo(floor + (100 - floor) / 2);
    expect(satisfactionTarget(0, 0.5, 1, 0, 0)).toBeCloseTo(floor + (100 - floor) / 2);
  });

  it('has no cliff at the free population', () => {
    expect(excessShare(COMFORT_CONFIG.freePopulation)).toBe(0);
    expect(excessShare(0)).toBe(0);
    const justAbove = COMFORT_CONFIG.freePopulation + 10;
    expect(satisfactionTarget(0, excessShare(justAbove), 1, 0, 0)).toBeGreaterThan(99.8);
  });

  it('an energy shortage lowers the target, to 0 at half power; offsets add percentage points', () => {
    expect(satisfactionTarget(1, 1, 0.75, 0, 0)).toBeCloseTo(50);
    expect(satisfactionTarget(1, 1, 0.5, 0, 0)).toBe(0);
    expect(satisfactionTarget(1, 1, 1, -0.08, 0)).toBeCloseTo(92);
    expect(satisfactionTarget(1, 1, 1, 0, 0.05)).toBe(100);
  });

  it('satisfaction moves toward the target at the drift rate, never past it, and freezes while paused', () => {
    expect(stepSatisfaction(100, 60, 10)).toBe(100 - 10 * COMFORT_CONFIG.drift);
    expect(stepSatisfaction(62, 60, 10)).toBe(60);
    expect(stepSatisfaction(50, 80, 5)).toBe(55);
    expect(stepSatisfaction(79, 80, 5)).toBe(80);
    expect(stepSatisfaction(70, 20, 0)).toBe(70);
  });
});

describe('comfort in the planet economy', () => {
  const economy = new EconomyService(new ShipService());
  const planet = (population: number, buildings: string[], satisfaction = 100): PlanetTile => ({
    id: 1, index: 0, name: 'P', factionId: 'player', x: 1, y: 1, type: 'earthlike', size: 'huge', population, satisfaction,
    explored: true, resourceTiles: [],
    buildings: [{ name: 'Capital', size: 3, x: 0, y: 0 }, { name: 'Solar Array', size: 2, x: 4, y: 0 }, { name: 'Solar Array', size: 2, x: 6, y: 0 },
      ...buildings.map((name, i) => ({ name, size: 2, x: (i % 5) * 3, y: 4 + Math.floor(i / 5) * 3 }))],
  } as PlanetTile);

  it('a small colony needs no comfort and stays at 100%', () => {
    const e = economy.calculatePlanetEconomy(planet(2000, []));
    expect(e.comfortNeed).toBe(0);
    expect(e.satisfactionTarget).toBe(100);
    expect(e.satisfactionDrift).toBe(0);
  });

  // Ten comfort points of need on an earthlike world.
  const CROWDED = COMFORT_CONFIG.freePopulation + 10 * COMFORT_CONFIG.peoplePerComfort;
  const EXCESS = (CROWDED - COMFORT_CONFIG.freePopulation) / CROWDED;

  it('a crowded planet without comfort heads for the floor; comfort buildings raise its target', () => {
    const crowded = economy.calculatePlanetEconomy(planet(CROWDED, []));
    expect(crowded.comfortNeed).toBeCloseTo(10);
    // Every person above the free population is uncovered, at the floor.
    expect(crowded.satisfactionTarget).toBeCloseTo(100 - (100 - 100 * COMFORT_CONFIG.floor) * EXCESS);
    expect(crowded.satisfactionDrift).toBeLessThan(0);
    const served = economy.calculatePlanetEconomy(planet(CROWDED, ['Entertainment Center', 'Hospital', 'School']));
    expect(served.comfortProvided).toBe(9);
    expect(served.satisfactionTarget).toBeCloseTo(100 - (100 - 100 * COMFORT_CONFIG.floor) * EXCESS * 0.1);
  });

  it('the economy tick moves satisfaction toward the target and income follows it', () => {
    const p = planet(CROWDED, []);
    const faction = { id: 'player', name: 'P', color: '#fff', team: 1, ai: false, currencies: { credits: 100000, rawmaterials: 0, research: 0 } };
    const systems = [{ id: 's', name: 's', x: 1, y: 1, planets: 1, color: '#fff', explored: true, planetsTiles: [p] }];
    economy.applyEconomyDelta('player', [faction as never], systems as never, [], 10);
    expect(p.satisfaction).toBeCloseTo(90);
    const full = economy.calculatePlanetEconomy(planet(CROWDED, [], 100));
    const lower = economy.calculatePlanetEconomy(p);
    expect(lower.incomeMultiplier).toBeLessThan(full.incomeMultiplier);
  });
});

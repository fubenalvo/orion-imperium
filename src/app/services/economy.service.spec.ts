import { describe, it, expect, beforeEach } from 'vitest';
import { EconomyService } from './economy.service';
import { ShipService } from './ship.service';
import { PlanetTile, PlanetType, StarSystem, Faction, Fleet } from '../components/star-map/star-map.models';

/*
 * Unit tests for the habitability/morale drift and workforce mechanics added
 * to EconomyService. PlanetTile objects are built with plain building names
 * that resolve to the definitions in planet-data.json (loaded by the service
 * constructor), so the real building `moraleRate` / `workforce` /
 * `providesWorkforce` values drive every assertion.
 */
describe('EconomyService — habitability & workforce', () => {
  let economy: EconomyService;

  beforeEach(() => {
    economy = new EconomyService(new ShipService());
  });

  const makePlanet = (
    id: number,
    type: PlanetType,
    buildings: { name: string; size: number; x: number; y: number }[] = [],
    overrides: Partial<PlanetTile> = {},
  ): PlanetTile => ({
    id,
    index: id,
    name: `Planet ${id}`,
    factionId: 'player',
    x: 0,
    y: 0,
    type,
    size: 'medium',
    population: 100,
    buildings: buildings as PlanetTile['buildings'],
    explored: true,
    satisfaction: 50,
    ...overrides,
  });

  const b = (name: string, x = 0, y = 0, size = 1): { name: string; size: number; x: number; y: number } => ({
    name,
    size,
    x,
    y,
  });

  describe('1. terran/habitable planet has no natural morale drift', () => {
    it('earthlike planet with no buildings drifts at 0', () => {
      const planet = makePlanet(1, 'earthlike');
      expect(economy.getMoraleDriftPerSecond(planet)).toBe(0);
    });

    it('gasgiant is not colonisable: drift 0', () => {
      const planet = makePlanet(1, 'gasgiant');
      expect(economy.getMoraleDriftPerSecond(planet)).toBe(0);
    });
  });

  describe('2. desert planet has negative morale drift', () => {
    it('desert planet with no buildings drifts at -0.05', () => {
      const planet = makePlanet(1, 'desert');
      expect(economy.getMoraleDriftPerSecond(planet)).toBe(-0.05);
    });

    it('is negative', () => {
      const planet = makePlanet(1, 'desert');
      expect(economy.getMoraleDriftPerSecond(planet)).toBeLessThan(0);
    });
  });

  describe('3. ice planet has negative morale drift', () => {
    it('ice planet with no buildings drifts at -0.08', () => {
      const planet = makePlanet(1, 'ice');
      expect(economy.getMoraleDriftPerSecond(planet)).toBe(-0.08);
    });

    it('is more negative than desert', () => {
      expect(economy.getMoraleDriftPerSecond(makePlanet(1, 'ice'))).toBeLessThan(
        economy.getMoraleDriftPerSecond(makePlanet(2, 'desert')),
      );
    });
  });

  describe('4. entertainment buildings offset negative habitability drift', () => {
    it('Entertainment Center (+0.08) fully offsets a desert (-0.05)', () => {
      const planet = makePlanet(1, 'desert', [b('Entertainment Center')]);
      expect(economy.getMoraleDriftPerSecond(planet)).toBeCloseTo(-0.05 + 0.08, 5);
    });

    it('net drift becomes positive when offset', () => {
      const planet = makePlanet(1, 'desert', [b('Entertainment Center')]);
      expect(economy.getMoraleDriftPerSecond(planet)).toBeGreaterThan(0);
    });

    it('Central Park partially offsets ice', () => {
      const planet = makePlanet(1, 'ice', [b('Central Park')]);
      // ice -0.08 + park 0.03 = -0.05
      expect(economy.getMoraleDriftPerSecond(planet)).toBeCloseTo(-0.05, 5);
    });
  });

  describe('5. sufficient workforce => efficiency = 1', () => {
    it('available >= required yields efficiency 1', () => {
      // Large Residential provides 100; Spaceship Factory requires 100 (req == available).
      const planet = makePlanet(1, 'earthlike', [
        b('Large Residential Block'),
        b('Spaceship Factory'),
      ]);
      expect(economy.getWorkforce(planet).efficiency).toBe(1);
    });

    it('calculatePlanetEconomy reports workforceEfficiency 1 and surplus', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Large Residential Block'),
        b('Medium Residential Block'),
        b('Spaceship Factory'),
      ]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.workforceAvailable).toBe(150);
      expect(e.workforceRequired).toBe(100);
      expect(e.workforceEfficiency).toBe(1);
    });
  });

  describe('6. 50% workforce => efficiency = 0.5', () => {
    it('getWorkforce returns 0.5', () => {
      // Medium Residential provides 50; Spaceship Factory requires 100.
      const planet = makePlanet(1, 'earthlike', [
        b('Medium Residential Block'),
        b('Spaceship Factory'),
      ]);
      expect(economy.getWorkforce(planet).efficiency).toBe(0.5);
    });

    it('calculatePlanetEconomy reports workforceEfficiency 0.5', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Medium Residential Block'),
        b('Spaceship Factory'),
      ]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.workforceRequired).toBe(100);
      expect(e.workforceAvailable).toBe(50);
      expect(e.workforceEfficiency).toBe(0.5);
    });
  });

  describe('7. production is reduced when workforce is short', () => {
    it('Spaceship Factory base 10 rawmaterials -> 5 at 50% workforce', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Medium Residential Block'),
        b('Spaceship Factory'),
      ]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.production['rawmaterials']).toBeCloseTo(5, 5);
    });

    it('production is full when workforce is sufficient', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Large Residential Block'),
        b('Spaceship Factory'),
      ]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.production['rawmaterials']).toBeCloseTo(10, 5);
    });
  });

  describe('8. morale is frozen while paused (deltaTime 0)', () => {
    const makeFaction = (): Faction => ({
      id: 'player',
      name: 'Player',
      color: '#fff',
      team: 1,
      currencies: { credits: 1000, rawmaterials: 1000, research: 1000 },
    });

    const wrap = (planet: PlanetTile): { factions: Faction[]; systems: StarSystem[]; fleets: Fleet[] } => {
      const system: StarSystem = {
        id: 'sys1',
        name: 'System 1',
        x: 1,
        y: 1,
        planets: 1,
        color: '#fff',
        planetsTiles: [planet],
      };
      return { factions: [makeFaction()], systems: [system], fleets: [] as Fleet[] };
    };

    it('satisfaction unchanged when deltaTime is 0 (pause)', () => {
      const planet = makePlanet(1, 'desert', [b('Entertainment Center')], { satisfaction: 60 });
      const { factions, systems, fleets } = wrap(planet);

      economy.applyEconomyDelta('player', factions, systems, fleets, 0);
      expect(planet.satisfaction).toBe(60);
    });

    it('satisfaction unchanged across multiple zero-delta ticks', () => {
      const planet = makePlanet(1, 'ice', [], { satisfaction: 50 });
      const { factions, systems, fleets } = wrap(planet);

      economy.applyEconomyDelta('player', factions, systems, fleets, 0);
      economy.applyEconomyDelta('player', factions, systems, fleets, 0);
      expect(planet.satisfaction).toBe(50);
    });
  });

  describe('9. morale tick scales with game time (2x => 2x drift)', () => {
    const makeFaction = (): Faction => ({
      id: 'player',
      name: 'Player',
      color: '#fff',
      team: 1,
      currencies: { credits: 1000, rawmaterials: 1000, research: 1000 },
    });

    const makeSystem = (planet: PlanetTile): StarSystem => ({
      id: 'sys1',
      name: 'System 1',
      x: 1,
      y: 1,
      planets: 1,
      color: '#fff',
      planetsTiles: [planet],
    });

    it('desert morale drift (-0.05) is part of the per-second delta', () => {
      // No buildings => balanced energy (0/0) => energyDirection +1; drift = -0.05.
      // Expected per-second change = (+1 - 0.05) * deltaTime = 0.95 * deltaTime.
      const base = makePlanet(1, 'desert', [], { satisfaction: 90 });
      const cloneAt = (delta: number): PlanetTile => ({ ...base, satisfaction: 90 });

      const f1 = cloneAt(1);
      economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(f1)], [], 1);
      const changeAt1 = (f1.satisfaction ?? 0) - 90;

      const f2 = cloneAt(2);
      economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(f2)], [], 2);
      const changeAt2 = (f2.satisfaction ?? 0) - 90;

      // 2x the game-time delta produces exactly 2x the satisfaction change.
      expect(changeAt2).toBeCloseTo(2 * changeAt1, 5);
      expect(changeAt1).toBeCloseTo(0.95, 5);
    });

    it('linear in deltaTime proves 2x speed doubles the morale tick', () => {
      // GameTimeService.getScaledDeltaTime already doubles delta at speed 2
      // (see game-time.service.spec.ts); the morale application multiplies
      // (energyDirection + moraleDrift) by deltaTime, so a 2x delta yields a
      // 2x change. We assert linearity directly.
      // Solar Array powers the planet (energy balanced => +1/s) and is neutral
      // for morale; Central Park adds +0.03 morale. Total = 1.03/s.
      const base = makePlanet(2, 'earthlike', [b('Solar Array'), b('Central Park')], { satisfaction: 80 });
      const run = (delta: number): number => {
        const p = { ...base, satisfaction: 80 };
        economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(p)], [], delta);
        return (p.satisfaction ?? 0) - 80;
      };
      const c1 = run(1);
      const c3 = run(3);
      expect(c1).toBeCloseTo(1.03, 5);
      expect(c3).toBeCloseTo(3 * c1, 5);
    });
  });

  describe('edge cases', () => {
    it('no buildings => required 0, available 0, efficiency 1', () => {
      const planet = makePlanet(1, 'earthlike');
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.workforceRequired).toBe(0);
      expect(e.workforceAvailable).toBe(0);
      expect(e.workforceEfficiency).toBe(1);
    });

    it('habitability drift is zero for earthlike even with a factory', () => {
      const planet = makePlanet(1, 'earthlike', [b('Spaceship Factory')]);
      // earthlike 0 + factory moraleRate -0.02 = -0.02
      expect(economy.getMoraleDriftPerSecond(planet)).toBeCloseTo(-0.02, 5);
    });

    it('workforce never goes negative; efficiency floor 0', () => {
      // Mining Complex requires 80 but no residential => available 0.
      const planet = makePlanet(1, 'earthlike', [b('Mining Complex')]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.workforceAvailable).toBe(0);
      expect(e.workforceRequired).toBe(80);
      expect(e.workforceEfficiency).toBe(0);
    });

    it('production is 0 when workforce is 0 for a mining planet', () => {
      const planet = makePlanet(1, 'earthlike', [b('Mining Complex')]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.production['rawmaterials']).toBeCloseTo(0, 5);
    });

    it('residential only => efficiency 1, no required workforce', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')]);
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.workforceRequired).toBe(0);
      expect(e.workforceAvailable).toBe(20);
      expect(e.workforceEfficiency).toBe(1);
    });
  });

  describe('10. population growth', () => {
    const makeFaction = (): Faction => ({
      id: 'player',
      name: 'Player',
      color: '#fff',
      team: 1,
      currencies: { credits: 0, rawmaterials: 0, research: 0 },
    });

    const wrap = (planet: PlanetTile, factionId = 'player'): { factions: Faction[]; systems: StarSystem[]; fleets: Fleet[] } => {
      const system: StarSystem = {
        id: 'sys1',
        name: 'System 1',
        x: 0,
        y: 0,
        planets: 1,
        color: '#fff',
        planetsTiles: [planet],
      };
      const faction: Faction = { ...makeFaction(), id: factionId };
      return { factions: [faction], systems: [system], fleets: [] };
    };

    it('no residential => capacity 0 => zero growth', () => {
      const planet = makePlanet(1, 'earthlike', [], { satisfaction: 100, population: 0 });
      expect(economy.getPopulationCapacity(planet)).toBe(0);
      expect(economy.calculatePopulationGrowth(planet, 1)).toBe(0);
    });

    it('earthlike, 1 Small Residential (cap 100), pop 0, sat 100, delta 1 -> 0.5', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      expect(economy.getPopulationCapacity(planet)).toBe(100);
      // 0.005 * satMod(1) * habMod(1) * remaining(100) * delta(1) = 0.5
      expect(economy.calculatePopulationGrowth(planet, 1)).toBeCloseTo(0.5, 5);
    });

    it('growth scales linearly with remaining capacity', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 50 });
      // 0.005 * 1 * 1 * (100-50) * 1 = 0.25
      expect(economy.calculatePopulationGrowth(planet, 1)).toBeCloseTo(0.25, 5);
    });

    it('at capacity => zero growth', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 100 });
      expect(economy.calculatePopulationGrowth(planet, 1)).toBe(0);
    });

    it('desert habitability (hab -0.05) reduces growth to 95% of earthlike', () => {
      const earth = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const des = makePlanet(2, 'desert', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const earthGrowth = economy.calculatePopulationGrowth(earth, 1);
      expect(economy.calculatePopulationGrowth(des, 1)).toBeCloseTo(0.95 * earthGrowth, 5);
    });

    it('50% satisfaction halves growth', () => {
      const full = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const half = makePlanet(2, 'earthlike', [b('Small Residential Block')], { satisfaction: 50, population: 0 });
      expect(economy.calculatePopulationGrowth(half, 1)).toBeCloseTo(0.5 * economy.calculatePopulationGrowth(full, 1), 5);
    });

    it('growth is linear in deltaTime (paused tick = 0)', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      expect(economy.calculatePopulationGrowth(planet, 0)).toBe(0);
      expect(economy.calculatePopulationGrowth(planet, 2)).toBeCloseTo(2 * economy.calculatePopulationGrowth(planet, 1), 5);
    });

    it('independent planets produce zero growth via applyEconomyDelta', () => {
      const planet = makePlanet(1, 'earthlike', [b('Small Residential Block')], {
        factionId: 'independent',
        satisfaction: 100,
        population: 10,
      });
      const { factions, systems, fleets } = wrap(planet, 'independent');
      economy.applyEconomyDelta('independent', factions, systems, fleets, 1);
      expect(planet.population).toBe(10);
    });

    // Solar Array (40 energy) balances Small Residential (3 energy) so
    // energyDirection stays +1 and satisfaction holds at 100, isolating
    // population growth from the morale/satisfaction dynamics.
    it('applyEconomyDelta mutates planet.population; paused tick does nothing', () => {
      const planet = makePlanet(1, 'earthlike', [b('Solar Array'), b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const { factions, systems, fleets } = wrap(planet);
      economy.applyEconomyDelta('player', factions, systems, fleets, 0);
      expect(planet.population).toBe(0);
      economy.applyEconomyDelta('player', factions, systems, fleets, 1);
      // 0.005 * satMod(1) * habMod(1) * remaining(100) * delta(1) = 0.5
      expect(planet.population).toBeCloseTo(0.5, 5);
    });

    it('population cannot exceed capacity after a large tick', () => {
      const planet = makePlanet(1, 'earthlike', [b('Solar Array'), b('Small Residential Block')], { satisfaction: 100, population: 99.8 });
      const { factions, systems, fleets } = wrap(planet);
      economy.applyEconomyDelta('player', factions, systems, fleets, 1000);
      // growth = 0.005 * 1 * 1 * (100-99.8) * 1000 = 1.0; nextPop 100.8 clamped to 100
      expect(planet.population).toBe(100);
    });
  });
});

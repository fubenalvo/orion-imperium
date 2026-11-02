import { describe, it, expect, beforeEach } from 'vitest';
import { EconomyService, marginalColonyCost } from './economy.service';
import { COLONY_RUNWAY_MAX_DEFICIT_SHARE, COLONY_RUNWAY_SECONDS, canSupportCapture, canSupportNewColony } from '../components/star-map/ai-queries';
import { ShipService } from './ship.service';
import { EconomyBreakdown, PlanetTile, PlanetType, StarSystem, Faction, Fleet } from '../components/star-map/star-map.models';
import { satisfactionTarget } from '../components/star-map/comfort';

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

  describe('4. comfort buildings work through comfort points, not morale (comfort.ts)', () => {
    it('an Entertainment Center adds no morale; its effect is its comfort points', () => {
      const planet = makePlanet(1, 'desert', [b('Entertainment Center')]);
      expect(economy.getMoraleDriftPerSecond(planet)).toBeCloseTo(-0.05, 5);
      expect(economy.calculatePlanetEconomy(planet).comfortProvided).toBe(4);
    });

    it('a Central Park gives one comfort point on any world', () => {
      const planet = makePlanet(1, 'ice', [b('Central Park')]);
      expect(economy.getMoraleDriftPerSecond(planet)).toBeCloseTo(-0.08, 5);
      expect(economy.calculatePlanetEconomy(planet).comfortProvided).toBe(1);
    });
  });

  describe('4. research buildings do not affect morale', () => {
    it('research laboratories contribute zero morale', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Small Research Laboratory'),
        b('Research Laboratory'),
      ]);

      expect(economy.calculatePlanetEconomy(planet).buildingMoraleBonus).toBe(0);
      expect(economy.getMoraleDriftPerSecond(planet)).toBe(0);
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
    // Population 0 isolates building output from the population raw trickle.
    // The Mining Complex (15 raw/s, needs 80 workers) extracts the planet's
    // deposit; richness 1 keeps the numbers round.
    const deposit = () => ({
      population: 0,
      resourceTiles: [{ type: 'rawmaterial' as const, x: 0, y: 0 }],
      rawDeposit: { total: 10000, remaining: 10000, richness: 1 },
    });

    it('Mining Complex base 15 rawmaterials -> 9.375 at 62.5% workforce', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Medium Residential Block'),
        b('Mining Complex'),
      ], deposit());
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.production['rawmaterials']).toBeCloseTo(9.375, 5);
    });

    it('production is full when workforce is sufficient', () => {
      const planet = makePlanet(1, 'earthlike', [
        b('Large Residential Block'),
        b('Mining Complex'),
      ], deposit());
      const e = economy.calculatePlanetEconomy(planet);
      expect(e.production['rawmaterials']).toBeCloseTo(15, 5);
    });

    it('the Spaceship Factory produces no raw materials (every raw source but the trickle is a deposit)', () => {
      const planet = makePlanet(1, 'earthlike', [b('Large Residential Block'), b('Spaceship Factory')], { population: 0 });
      expect(economy.calculatePlanetEconomy(planet).production['rawmaterials'] ?? 0).toBe(0);
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

  describe('9. morale tick scales with game time (3x => 3x drift)', () => {
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

    it('satisfaction moves toward its target at 1/s of game time (a small desert colony targets 100%)', () => {
      // Below the free population the type offset does not apply: the target is 100.
      const base = makePlanet(1, 'desert', [], { satisfaction: 90 });
      const cloneAt = (delta: number): PlanetTile => ({ ...base, satisfaction: 90 });

      const f1 = cloneAt(1);
      economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(f1)], [], 1);
      const changeAt1 = (f1.satisfaction ?? 0) - 90;

      const f3 = cloneAt(3);
      economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(f3)], [], 3);
      const changeAt3 = (f3.satisfaction ?? 0) - 90;

      // 3x the game-time delta produces exactly 3x the satisfaction change.
      expect(changeAt3).toBeCloseTo(3 * changeAt1, 5);
      expect(changeAt1).toBeCloseTo(1, 5);
    });

    it('linear in deltaTime proves 3x speed triples the morale tick', () => {
      // GameTimeService.getScaledDeltaTime already triples delta at speed 3
      // (see game-time.service.spec.ts); the morale application multiplies
      // the total satisfaction drift by deltaTime, so a 3x delta yields a
      // 3x change. We assert linearity directly.
      // Toward the target (100%) at COMFORT_CONFIG.drift = 1/s.
      const base = makePlanet(2, 'earthlike', [b('Solar Array'), b('Central Park')], { satisfaction: 80 });
      const run = (delta: number): number => {
        const p = { ...base, satisfaction: 80 };
        economy.applyEconomyDelta('player', [makeFaction()], [makeSystem(p)], [], delta);
        return (p.satisfaction ?? 0) - 80;
      };
      const c1 = run(1);
      const c3 = run(3);
      expect(c1).toBeCloseTo(1, 5);
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
      const planet = makePlanet(1, 'earthlike', [b('Mining Complex')], { population: 0 });
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

    it('desert habitability (hab -0.05) and its smaller ceiling slow growth', () => {
      const earth = makePlanet(1, 'earthlike', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const des = makePlanet(2, 'desert', [b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const earthGrowth = economy.calculatePopulationGrowth(earth, 1);
      // Growth fills the remaining capacity; the desert ceiling is 70% (planet-types.ts).
      const ceilingRatio = economy.getPopulationCapacity(des) / economy.getPopulationCapacity(earth);
      expect(economy.calculatePopulationGrowth(des, 1)).toBeCloseTo(0.95 * ceilingRatio * earthGrowth, 5);
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
    // the energy drift stays +1 and satisfaction holds at 100, isolating
    // population growth from the morale/satisfaction dynamics.
    it('applyEconomyDelta mutates planet.population; paused tick does nothing', () => {
      const planet = makePlanet(1, 'earthlike', [b('Solar Array'), b('Small Residential Block')], { satisfaction: 100, population: 0 });
      const { factions, systems, fleets } = wrap(planet);
      // Funds the buildings' upkeep so arrears do not lower satisfaction (and growth).
      factions[0].currencies['credits'] = 1000;
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

/*
 * Energy and satisfaction (docs/economy.md, "Energy and satisfaction"):
 * the colony core's flat energy and the proportional energy drift that
 * replaced the old "any shortfall = -1/s" rule.
 */
describe('EconomyService — energy shortfall and satisfaction', () => {
  let economy: EconomyService;

  beforeEach(() => {
    economy = new EconomyService(new ShipService());
  });

  const planetWith = (names: string[], overrides: Partial<PlanetTile> = {}): PlanetTile => ({
    id: 1,
    index: 1,
    name: 'Home',
    factionId: 'player',
    x: 0,
    y: 0,
    type: 'earthlike',
    size: 'medium',
    population: 0,
    buildings: names.map((name, i) => ({ name, size: 1, x: i, y: 0 })) as PlanetTile['buildings'],
    explored: true,
    satisfaction: 60,
    ...overrides,
  });

  const tick = (planet: PlanetTile, seconds: number): void => {
    const faction = {
      id: 'player',
      name: 'Player',
      color: '#fff',
      currencies: { credits: 1_000_000, rawmaterials: 0, research: 0 },
    } as unknown as Faction;
    const system = { id: 's', name: 'S', x: 0, y: 0, planets: 1, color: '#fff', planetsTiles: [planet] } as StarSystem;
    economy.applyEconomyDelta('player', [faction], [system], [], seconds);
  };

  it('an energy shortfall lowers the satisfaction target: 4% short → 92, 25% short → 50, half power → 0', () => {
    expect(satisfactionTarget(1, 1, 1, 0, 0)).toBe(100);
    expect(satisfactionTarget(1, 1, 0.96, 0, 0)).toBeCloseTo(92, 6);
    expect(satisfactionTarget(1, 1, 0.75, 0, 0)).toBeCloseTo(50, 6);
    expect(satisfactionTarget(1, 1, 0.5, 0, 0)).toBe(0);
    expect(satisfactionTarget(1, 1, 0, 0, 0)).toBe(0);
  });

  it('base values come from the core building: no core, no energy, housing or workforce', () => {
    const bare = planetWith([]);
    expect(economy.calculatePlanetEconomy(bare).energyProduction).toBe(0);
    expect(economy.getPopulationCapacity(bare)).toBe(0);
    expect(economy.getWorkforce(bare).available).toBe(0);

    const colony = planetWith(['Colony Center']);
    expect(economy.calculatePlanetEconomy(colony).energyProduction).toBe(10);
    expect(economy.getPopulationCapacity(colony)).toBe(150);
    expect(economy.getWorkforce(colony).available).toBe(30);

    const capital = planetWith(['Capital']);
    expect(economy.calculatePlanetEconomy(capital).energyProduction).toBe(20);
    expect(economy.getPopulationCapacity(capital)).toBe(500);
    expect(economy.getWorkforce(capital).available).toBe(100);
  });

  it('core buildings cost no upkeep', () => {
    const owner = { id: 'player', name: 'P', color: '#fff', ai: false, currencies: { credits: 0 } } as unknown as Faction;
    const planet = planetWith(['Capital', 'Colony Center'], { population: 0 });
    const system = { id: 's', name: 'S', x: 0, y: 0, planets: 1, color: '#fff', planetsTiles: [planet] } as StarSystem;
    expect(economy.calculateEconomy('player', [owner], [system], []).buildingUpkeepPerSecond).toBe(0);
  });

  it('a new colony can run its first housing block before any power building', () => {
    const colony = planetWith(['Colony Center', 'Medium Residential Block']);
    expect(economy.calculatePlanetEconomy(colony).efficiency).toBe(1);
    tick(colony, 10);
    expect(colony.satisfaction).toBeGreaterThan(60);
  });

  it('a small energy overshoot lowers output but satisfaction keeps rising', () => {
    // 100 (fusion) + 10 (Colony Center) produced; 30 + 20 + 20 + 25 + 6 + 12 + 3 = 116 used: ~5% short.
    const home = planetWith([
      'Colony Center',
      'Fusion Power Plant',
      'Spaceship Factory',
      'Mining Complex',
      'Spaceport',
      'Research Laboratory',
      'Medium Residential Block',
      'Large Residential Block',
      'Missile Turret',
    ]);
    const e = economy.calculatePlanetEconomy(home);
    expect(e.efficiency).toBeLessThan(1);
    expect(e.satisfactionTarget).toBeGreaterThan(80);
    const before = home.satisfaction!;
    tick(home, 30);
    expect(home.factionId).toBe('player');
    expect(home.satisfaction!).toBeGreaterThan(before);
  });

  it('a severe shortage still drains satisfaction at -1/s and ends in rebellion', () => {
    // 10 (Colony Center) produced; 3 x 12 = 36 used: 72% short.
    const colony = planetWith(['Colony Center', 'Large Residential Block', 'Large Residential Block', 'Large Residential Block'], {
      satisfaction: 5,
    });
    expect(economy.calculatePlanetEconomy(colony).satisfactionDrift).toBeCloseTo(-1, 6);
    tick(colony, 3);
    expect(colony.satisfaction).toBeCloseTo(2, 6);
    tick(colony, 3);
    expect(colony.factionId).toBe('independent');
  });

  it('a planet in its capture grace does not rebel at 0% until the grace runs out', () => {
    // Severe shortage (-1/s) right after a capture.
    const captured = planetWith(['Large Residential Block', 'Large Residential Block', 'Large Residential Block'], {
      satisfaction: 40,
      rebellionGraceSeconds: 120,
    });
    tick(captured, 60);
    expect(captured.satisfaction).toBeCloseTo(0, 6);
    expect(captured.factionId).toBe('player');
    expect(captured.rebellionGraceSeconds).toBeCloseTo(60, 6);

    tick(captured, 59);
    expect(captured.factionId).toBe('player');

    tick(captured, 2);
    expect(captured.rebellionGraceSeconds).toBeUndefined();
    expect(captured.factionId).toBe('independent');
  });

  it('a recovering planet simply loses its grace when it runs out', () => {
    const captured = planetWith(['Colony Center', 'Medium Residential Block'], { satisfaction: 40, rebellionGraceSeconds: 5 });
    tick(captured, 10);
    expect(captured.rebellionGraceSeconds).toBeUndefined();
    expect(captured.factionId).toBe('player');
    expect(captured.satisfaction).toBeGreaterThan(40);
  });
});

describe('marginalColonyCost / canSupportNewColony (AI over-expansion brake)', () => {
  // Only the fields the formula reads matter; the rest of the breakdown is irrelevant here.
  const breakdown = (income: number, building: number, ship: number, station: number) => ({
    incomePerSecond: income,
    buildingUpkeepPerSecond: building,
    shipUpkeepPerSecond: ship,
    stationUpkeepPerSecond: station,
    netPerSecond: income - building - ship - station,
  }) as unknown as EconomyBreakdown;

  it('charges the administration step on the whole income and the upkeep-scale step on all scaled upkeep', () => {
    // 5 → 6 planets: administration 12% → 15% of income; scale 1.28 → 1.35.
    const b = breakdown(1000, 300, 100, 20);
    const expected = 0.03 * 1000 + (1.35 / 1.28 - 1) * 420;
    expect(marginalColonyCost(b, 5)).toBeCloseTo(expected, 6);
  });

  it('adds no administration once the administration cap is reached', () => {
    const b = breakdown(1000, 0, 0, 0);
    expect(marginalColonyCost(b, 20)).toBe(0);
  });

  it('allows a colony that keeps net income non-negative', () => {
    expect(canSupportNewColony(breakdown(1000, 300, 100, 0), 5, 0)).toBe(true);
  });

  it('refuses a colony that drives net income negative unless the treasury covers the runway', () => {
    // A small positive net that the colony turns into a small deficit.
    const b = breakdown(1000, 500, 440, 0);
    const deficit = marginalColonyCost(b, 10) - b.netPerSecond;
    expect(deficit).toBeGreaterThan(0);
    expect(deficit).toBeLessThan(COLONY_RUNWAY_MAX_DEFICIT_SHARE * 1000);
    expect(canSupportNewColony(b, 10, 0)).toBe(false);
    expect(canSupportNewColony(b, 10, deficit * COLONY_RUNWAY_SECONDS - 1)).toBe(false);
    expect(canSupportNewColony(b, 10, deficit * COLONY_RUNWAY_SECONDS + 1)).toBe(true);
  });

  it('never expands into a large lasting deficit, however full the treasury', () => {
    // net 0 before: the colony's deficit exceeds the runway's share of income.
    const b = breakdown(500, 300, 200, 0);
    expect(marginalColonyCost(b, 10)).toBeGreaterThan(COLONY_RUNWAY_MAX_DEFICIT_SHARE * 500);
    expect(canSupportNewColony(b, 10, 1e9)).toBe(false);
  });

  it('never blocks a faction without planets', () => {
    expect(canSupportNewColony(breakdown(0, 50, 50, 0), 0, 0)).toBe(true);
  });
});

describe('canSupportCapture (AI conquest brake)', () => {
  it('allows a capture that keeps net income non-negative', () => {
    expect(canSupportCapture(50, 10, 8, 0)).toBe(true);
  });

  it('allows a capture that improves a negative net (a struggling faction may take a rich world)', () => {
    expect(canSupportCapture(-80, -20, 8, 0)).toBe(true);
  });

  it('refuses a capture that drives net income further negative unless the treasury covers the runway', () => {
    expect(canSupportCapture(20, -30, 8, 0)).toBe(false);
    expect(canSupportCapture(20, -30, 8, 30 * COLONY_RUNWAY_SECONDS - 1)).toBe(false);
    expect(canSupportCapture(20, -30, 8, 30 * COLONY_RUNWAY_SECONDS)).toBe(true);
  });

  it('refuses a deficit above the runway share of income, however full the treasury', () => {
    expect(canSupportCapture(20, -30, 8, 1e9, 30 / COLONY_RUNWAY_MAX_DEFICIT_SHARE)).toBe(true);
    expect(canSupportCapture(20, -30, 8, 1e9, 30 / COLONY_RUNWAY_MAX_DEFICIT_SHARE - 1)).toBe(false);
  });

  it('never blocks a faction without planets (its recovery route)', () => {
    expect(canSupportCapture(-50, -90, 0, 0)).toBe(true);
  });
});

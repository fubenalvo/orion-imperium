import { TestBed } from '@angular/core/testing';
import { EnemyEconomyService, EconomyContext } from './enemy-economy.service';
import { EconomyService } from '../../services/economy.service';
import { Faction, FactionShipStock, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { COMFORT_CONFIG } from './comfort';
import { TRADE_BUY_CREDITS_PER_RAW } from './trade';

/*
 * The AI's side of the late-economy rules (docs/late-economy.md): the
 * comfort tier, raw purchases at the Trading Post, and the poverty-trap
 * exit that moves an idle fleet into the cheaper reserve.
 */
describe('EnemyEconomyService — late economy', () => {
  let service: EnemyEconomyService;
  let economy: EconomyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyEconomyService);
    economy = TestBed.inject(EconomyService);
  });

  const COMFORT_TECHS = ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power', 'advanced_industry', 'advanced_science'];

  const faction = (credits: number, rawmaterials = 100000): Faction => ({
    id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true,
    currencies: { credits, rawmaterials },
    researchedTechnologies: COMFORT_TECHS,
    aiPersonality: 'balanced',
  } as Faction);

  const system = (planets: PlanetTile[]): StarSystem => ({
    id: 'sys1', name: 'Sys', x: 10, y: 10, planets: planets.length, color: '#fff', planetsTiles: planets,
  });

  const context = (fleets: Fleet[] = [], shipStock: FactionShipStock[] = []): EconomyContext => ({ fleets, shipStock, production: [] });

  const run = (f: Faction, systems: StarSystem[], ctx: EconomyContext, seconds: number): void => {
    for (let i = 0; i < seconds * 10; i++) service.tick(1 / 10, f, systems, ctx);
  };

  /* A fully built homeworld: factory, Spaceport, power and workers to spare. */
  const home = (population: number, extra: { name: string; size: number; x: number; y: number }[] = []): PlanetTile => ({
    id: 1, index: 0, name: 'Home', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'huge', population,
    explored: true, resourceTiles: [],
    buildings: [
      { name: 'Capital', size: 3, x: 0, y: 0 },
      { name: 'Spaceship Factory', size: 3, x: 3, y: 0 },
      { name: 'Spaceport', size: 4, x: 6, y: 0 },
      { name: 'Fusion Power Plant', size: 3, x: 10, y: 0 },
      { name: 'Fusion Power Plant', size: 3, x: 13, y: 0 },
      ...Array.from({ length: 12 }, (_, i) => ({ name: 'Large Residential Block', size: 3, x: (i % 6) * 3, y: 4 + Math.floor(i / 6) * 3 })),
      { name: 'Laser Turret', size: 1, x: 18, y: 0 },
      ...extra,
    ],
  } as PlanetTile);

  const select = (f: Faction, systems: StarSystem[], ctx: EconomyContext) =>
    (service as unknown as { selectConstruction(f: Faction, s: StarSystem[], c: EconomyContext): { building: { name: string } } | undefined })
      .selectConstruction(f, systems, ctx);

  it('covers a small comfort gap with a Park, not an Entertainment Center', () => {
    const f = faction(1e6);
    // 300 people above the free population: well under one comfort point.
    const planet = home(COMFORT_CONFIG.freePopulation + 300);
    expect(economy.calculatePlanetEconomy(planet, f).comfortCoverage).toBe(0);
    expect(select(f, [system([planet])], context())?.building.name).toBe('Central Park');
  });

  it('builds comfort before more housing on a crowded planet', () => {
    const f = faction(1e6);
    const planet = home(COMFORT_CONFIG.freePopulation + 8 * COMFORT_CONFIG.peoplePerComfort);
    const choice = select(f, [system([planet])], context())?.building.name;
    expect(['Central Park', 'School', 'Hospital', 'Entertainment Center']).toContain(choice);
  });

  it('builds no comfort once the planet is covered', () => {
    const f = faction(1e6);
    const planet = home(COMFORT_CONFIG.freePopulation + 300, [{ name: 'Central Park', size: 2, x: 18, y: 4 }]);
    expect(economy.calculatePlanetEconomy(planet, f).comfortCoverage).toBe(1);
    const choice = select(f, [system([planet])], context())?.building.name;
    expect(['Central Park', 'School', 'Hospital', 'Entertainment Center']).not.toContain(choice);
  });

  it('buys missing raw materials at its Trading Post when raw-bound and rich, in whole lots at the exchange rate', () => {
    const f = faction(1e6, 0);
    const planet = home(2000, [{ name: 'Trading Post', size: 2, x: 18, y: 4 }]);
    const systems = [system([planet])];
    expect(service.isRawConstrained(f)).toBe(true);
    const buy = (service as unknown as { buyRawMaterials(f: Faction, s: StarSystem[], c: EconomyContext): boolean })
      .buyRawMaterials.bind(service);
    expect(buy(f, systems, context())).toBe(true);
    const bought = f.currencies['rawmaterials'];
    expect(bought).toBeGreaterThan(0);
    expect(bought % 500).toBe(0);
    expect(f.currencies['credits']).toBe(1e6 - bought * TRADE_BUY_CREDITS_PER_RAW);
    expect(service.isRawConstrained(f)).toBe(false);
  });

  it('buys nothing without a Trading Post or without surplus credits', () => {
    const buy = (service as unknown as { buyRawMaterials(f: Faction, s: StarSystem[], c: EconomyContext): boolean })
      .buyRawMaterials.bind(service);
    const poorWithPost = faction(5000, 0);
    expect(buy(poorWithPost, [system([home(2000, [{ name: 'Trading Post', size: 2, x: 18, y: 4 }])])], context())).toBe(false);
    const richWithout = faction(1e6, 0);
    expect(buy(richWithout, [system([home(2000)])], context())).toBe(false);
    expect(richWithout.currencies['rawmaterials']).toBe(0);
  });

  it('after a lasting deficit with an empty treasury, moves its weakest idle fleet at the Spaceport into the reserve', () => {
    const f = faction(0);
    const planet = home(500);
    const systems = [system([planet])];
    const fleetAt = (id: number, types: string[]): Fleet => ({
      id, name: `F${id}`, factionId: 'enemy1', x: 10, y: 10, targetX: null, targetY: null, speed: 3, system: null,
      ships: types.map((type, i) => ({ id: id * 100 + i, name: type, type })),
    });
    const strong = fleetAt(1, Array(30).fill('battleship'));
    const weak = fleetAt(2, Array(10).fill('frigate'));
    const fleets = [strong, weak];
    const stock: FactionShipStock[] = [{ factionId: 'enemy1', ships: [] }];
    const ctx = context(fleets, stock);
    expect(service.getProjectedNet(f, systems, ctx).net).toBeLessThan(0);

    run(f, systems, ctx, 60);
    expect(weak.destroyed).toBeFalsy();

    run(f, systems, ctx, 70);
    expect(weak.destroyed).toBe(true);
    expect(strong.destroyed).toBeFalsy();
    expect(stock[0].ships.map((s) => s.type)).toEqual(Array(10).fill('frigate'));
  });
});

import { TestBed } from '@angular/core/testing';
import { EnemyEconomyService, EconomyContext } from './enemy-economy.service';
import { Faction, FactionProduction, FactionShipStock, Fleet, PlanetTile, StarSystem } from './star-map.models';

/*
 * Unit tests for the AI economy manager using the real economy,
 * research, production and fleet-assembly services.
 */
describe('EnemyEconomyService', () => {
  let service: EnemyEconomyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyEconomyService);
  });

  const faction = (credits: number): Faction => ({
    id: 'enemy1',
    name: 'Enemy 1',
    color: '#d65757',
    team: 2,
    ai: true,
    currencies: { credits },
    researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'],
  });

  const planet = (overrides: Partial<PlanetTile> = {}): PlanetTile => ({
    id: 1,
    index: 0,
    name: 'Home',
    factionId: 'enemy1',
    x: 12,
    y: 3,
    type: 'earthlike',
    size: 'medium',
    population: 0,
    buildings: [],
    explored: true,
    ...overrides,
  });

  const system = (planets: PlanetTile[], overrides: Partial<StarSystem> = {}): StarSystem => ({
    id: 'sys1',
    name: 'Sys',
    x: 10,
    y: 10,
    planets: planets.length,
    color: '#fff',
    planetsTiles: planets,
    ...overrides,
  });

  const context = (fleets: Fleet[] = [], shipStock: FactionShipStock[] = [], production: FactionProduction[] = []): EconomyContext => ({
    fleets,
    shipStock,
    production,
  });

  // Runs decisions until `seconds` of game time have passed at 60 fps.
  const run = (f: Faction, systems: StarSystem[], ctx: EconomyContext, seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      service.tick(1 / 60, f, systems, ctx);
    }
  };

  it('bootstraps an empty colony with power and then housing instead of deadlocking', () => {
    const f = faction(1000);
    const colony = planet({ id: 2, size: 'small' });
    const systems = [system([colony])];

    run(f, systems, context(), 5);

    const names = colony.buildings.map((b) => b.name);
    expect(names[0]).toBe('Solar Array');
    expect(names).toContain('Small Residential Block');
  });

  it('builds at most one building per decision interval', () => {
    const f = faction(100000);
    const home = planet({ size: 'huge' });
    const systems = [system([home])];

    run(f, systems, context(), 10.5);

    expect(home.buildings.length).toBeGreaterThan(0);
    expect(home.buildings.length).toBeLessThanOrEqual(5);
  });

  it('saves for a missing Spaceport before optional research buildings', () => {
    const f = faction(0);
    const home = planet({
      population: 1400,
      buildings: [
        { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
        { name: 'Large Residential Block', size: 3, x: 3, y: 0 },
        { name: 'Fusion Power Plant', size: 3, x: 6, y: 0 },
        { name: 'Spaceship Factory', size: 3, x: 0, y: 6 },
        { name: 'Laser Turret', size: 1, x: 8, y: 8 },
      ],
    });
    const systems = [system([home])];
    const ctx = context();

    // Credits arrive in steps: below the Spaceport price nothing optional is built.
    f.currencies['credits'] = 450;
    run(f, systems, ctx, 2.1);
    expect(home.buildings.some((b) => b.name === 'Small Research Laboratory')).toBe(false);

    // The Spaceport (60 workers) would open a workforce deficit (205/200),
    // so the planner first builds an enabling Small Residential Block.
    f.currencies['credits'] = 700;
    run(f, systems, ctx, 4.1);
    const names = home.buildings.map((b) => b.name);
    expect(names).toContain('Spaceport');
    expect(names.indexOf('Small Residential Block')).toBeLessThan(names.indexOf('Spaceport'));
    expect(names).not.toContain('Small Research Laboratory');
  });

  it('deploys stocked combat ships only into a fleet at the Spaceport, otherwise creates one there', () => {
    const f = faction(0);
    const home = planet({ buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }] });
    const systems = [system([home])];
    const distant: Fleet = {
      id: 1,
      name: 'FAR',
      factionId: 'enemy1',
      x: 60,
      y: 60,
      targetX: null,
      targetY: null,
      speed: 6,
      system: null,
      ships: [{ id: 1, name: 'F', type: 'frigate' }],
    };
    const fleets = [distant];
    const shipStock: FactionShipStock[] = [{ factionId: 'enemy1', ships: [{ id: 50, type: 'fighter', name: 'Fighter' }] }];

    run(f, systems, context(fleets, shipStock), 2.1);

    expect(distant.ships).toHaveLength(1);
    expect(shipStock[0].ships).toHaveLength(0);
    const created = fleets.find((fl) => fl.id !== 1)!;
    expect(created.ships.map((s) => s.id)).toEqual([50]);
    expect(created.x).toBe(10);
    expect(created.y).toBe(10);
  });

  it('queues combat ships when below its military target and the factory is free', () => {
    const f = faction(1000);
    const home = planet({
      population: 1400,
      buildings: [
        { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
        { name: 'Fusion Power Plant', size: 3, x: 3, y: 0 },
        { name: 'Spaceship Factory', size: 3, x: 6, y: 0 },
        { name: 'Spaceport', size: 4, x: 0, y: 3 },
      ],
    });
    const systems = [system([home])];
    const production: FactionProduction[] = [];

    run(f, systems, context([], [], production), 2.1);

    const orders = Object.values(production.find((p) => p.factionId === 'enemy1')?.ordersByPlanet ?? {}).flat();
    expect(orders.map((o) => o.shipTypeId)).toEqual(['fighter']);
  });

  it('does nothing while paused', () => {
    const f = faction(1000);
    const colony = planet();
    service.tick(0, f, [system([colony])], context());
    expect(colony.buildings).toHaveLength(0);
  });
});

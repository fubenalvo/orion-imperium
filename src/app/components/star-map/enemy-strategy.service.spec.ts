import { TestBed } from '@angular/core/testing';
import { EnemyStrategyService } from './enemy-strategy.service';
import { Fleet, Faction, StarSystem } from './star-map.models';

describe('EnemyStrategyService', () => {
  let service: EnemyStrategyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyStrategyService);
  });

  afterEach(() => {
    service.reset();
  });

  const createFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
    id: 1,
    name: 'FLEET',
    factionId: 'player',
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    speed: 5,
    system: null,
    ships: [{ id: 1, name: 'Ship', type: 'frigate', currentHp: 10, destroyed: false }],
    destroyed: false,
    ...overrides,
  });

  const createPlanet = (overrides: Partial<StarSystem['planetsTiles'][0]> = {}): StarSystem['planetsTiles'][0] => ({
    id: 1,
    index: 1,
    name: 'Planet',
    factionId: 'unhabited',
    x: 10,
    y: 10,
    type: 'earthlike',
    size: 'medium',
    population: 0,
    buildings: [],
    explored: true,
    ...overrides,
  });

  const createSystem = (overrides: Partial<StarSystem> = {}): StarSystem => ({
    id: 'sys1',
    name: 'System',
    x: 10,
    y: 10,
    planets: 1,
    color: '#fff',
    planetsTiles: [createPlanet()],
    ...overrides,
  });

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, currencies: {} },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, currencies: {} },
    { id: 'independent', name: 'Independent', color: '#ffcc00', team: 0, currencies: {} },
    { id: 'unhabited', name: 'Unhabited', color: '#666666', team: 0, currencies: {} },
  ];

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return undefined strategy before first tick', () => {
    expect(service.getStrategy('enemy1')).toBeUndefined();
  });

  it('should return false when deltaTime is 0 (paused)', () => {
    const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
    const systems = [createSystem({ x: 50, y: 50, planetsTiles: [createPlanet({ factionId: 'enemy1' })] })];

    const result = service.tick(0, fleets, factions, systems);
    expect(result).toBe(false);
  });

  it('should return false when deltaTime is negative', () => {
    const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
    const systems = [createSystem({ x: 50, y: 50, planetsTiles: [createPlanet({ factionId: 'enemy1' })] })];

    const result = service.tick(-1, fleets, factions, systems);
    expect(result).toBe(false);
  });

  it('should choose defend when enemy planet is threatened', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
    ];
    const systems = [
      createSystem({
        x: 5,
        y: 5,
        planetsTiles: [createPlanet({ factionId: 'enemy1' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('defend');
  });

  it('should not choose defend when player fleet is far from enemy planet', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, id: 2 }),
    ];
    const systems = [
      createSystem({
        x: 50,
        y: 50,
        planetsTiles: [createPlanet({ factionId: 'enemy1' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).not.toBe('defend');
  });

  it('should choose attack when favorable engagement exists', () => {
    const fleets = [
      createFleet({
        factionId: 'enemy1',
        name: 'RAIDER',
        x: 0,
        y: 0,
        id: 1,
        ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }],
      }),
      createFleet({
        factionId: 'player',
        name: 'ORION',
        x: 5,
        y: 5,
        id: 2,
        ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
      }),
    ];
    const systems: StarSystem[] = [];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('attack');
  });

  it('should choose expand when unhabited planet is reachable', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('expand');
  });

  it('should fall back to develop when no other condition is met', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 100,
        y: 100,
        planetsTiles: [createPlanet({ factionId: 'enemy1' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('develop');
  });

  it('should choose defend over attack and expand', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
    ];
    const systems = [
      createSystem({
        x: 5,
        y: 5,
        planetsTiles: [createPlanet({ factionId: 'enemy1' })],
      }),
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('defend');
  });

  it('should choose attack over expand', () => {
    const fleets = [
      createFleet({
        factionId: 'enemy1',
        name: 'RAIDER',
        x: 0,
        y: 0,
        id: 1,
        ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }],
      }),
      createFleet({
        factionId: 'player',
        name: 'ORION',
        x: 5,
        y: 5,
        id: 2,
        ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
      }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('attack');
  });

  it('should be deterministic for the same input', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    const first = service.getStrategy('enemy1');

    service.reset();
    const fleets2 = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems2 = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets2, factions, systems2);
    const second = service.getStrategy('enemy1');

    expect(first).toBe(second);
  });

  it('should not modify player fleets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, targetX: null, targetY: null, id: 2 }),
    ];
    const systems: StarSystem[] = [];

    service.tick(3, fleets, factions, systems);
    expect(fleets[1].targetX).toBeNull();
    expect(fleets[1].targetY).toBeNull();
  });

  it('should not modify neutral or unhabited planets', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [
          createPlanet({ factionId: 'unhabited', id: 1 }),
          createPlanet({ factionId: 'independent', id: 2 }),
        ],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
    expect(systems[0].planetsTiles[1].factionId).toBe('independent');
  });

  it('should not modify enemy planet ownership', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'enemy1', id: 1 })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
  });

  it('should handle multiple enemy factions independently', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 100, y: 100, id: 2 }),
      createFleet({
        factionId: 'player',
        name: 'ORION',
        x: 2,
        y: 2,
        id: 3,
        ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
      }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
      createSystem({
        x: 100,
        y: 100,
        planetsTiles: [createPlanet({ factionId: 'enemy2' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('attack');
    expect(service.getStrategy('enemy2')).toBe('develop');
  });

  it('should evaluate strategy after the accumulator reaches the interval', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(1, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBeUndefined();

    service.tick(1.5, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('expand');
  });

  it('should clear strategy after reset', () => {
    const fleets = [
      createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
    ];
    const systems = [
      createSystem({
        x: 10,
        y: 10,
        planetsTiles: [createPlanet({ factionId: 'unhabited' })],
      }),
    ];

    service.tick(3, fleets, factions, systems);
    expect(service.getStrategy('enemy1')).toBe('expand');

    service.reset();
    expect(service.getStrategy('enemy1')).toBeUndefined();
  });
});

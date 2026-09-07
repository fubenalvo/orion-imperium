import { TestBed } from '@angular/core/testing';
import { EnemyGoalService } from './enemy-goal.service';
import { Fleet, Faction, StarSystem } from './star-map.models';

describe('EnemyGoalService', () => {
  let service: EnemyGoalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyGoalService);
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
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, currencies: {} },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, ai: true, currencies: {} },
    { id: 'independent', name: 'Independent', color: '#ffcc00', team: 0, ai: false, currencies: {} },
    { id: 'unhabited', name: 'Unhabited', color: '#666666', team: 0, ai: false, currencies: {} },
  ];

  describe('expand strategy', () => {
    it('should select a valid colonization target', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect(goal).toBeDefined();
      expect((goal as { type: string }).type).toBe('colonize');
      expect((goal as { targetPlanetId: number }).targetPlanetId).toBe(1);
      expect((goal as { targetSystemId: string }).targetSystemId).toBe('sys1');
    });

    it('should prefer closer planets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
        createSystem({
          id: 'sys2',
          x: 5,
          y: 5,
          planetsTiles: [createPlanet({ id: 2, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect((goal as { targetPlanetId: number }).targetPlanetId).toBe(2);
      expect((goal as { targetSystemId: string }).targetSystemId).toBe('sys2');
    });

    it('should return undefined when no unhabited planets exist', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'player' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });

    it('should return undefined when enemy has no fleets', () => {
      const fleets: Fleet[] = [];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });
  });

  describe('attack strategy', () => {
    it('should select a valid player fleet', () => {
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

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect(goal).toBeDefined();
      expect((goal as { type: string }).type).toBe('attack');
      expect((goal as { targetFleetId: number }).targetFleetId).toBe(2);
    });

    it('should prefer weaker targets', () => {
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
          name: 'WEAK',
          x: 1,
          y: 1,
          id: 2,
          ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
        }),
        createFleet({
          factionId: 'player',
          name: 'STRONG',
          x: 10,
          y: 10,
          id: 3,
          ships: [{ id: 1, name: 'B', type: 'battleship', currentHp: 10, destroyed: false }],
        }),
      ];
      const systems: StarSystem[] = [];

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect((goal as { targetFleetId: number }).targetFleetId).toBe(2);
    });

    it('should return undefined when no player fleets exist', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems: StarSystem[] = [];

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });
  });

  describe('defend strategy', () => {
    it('should select the most threatened planet', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 5,
          y: 5,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect(goal).toBeDefined();
      expect((goal as { type: string }).type).toBe('defend');
      expect((goal as { targetPlanetId: number }).targetPlanetId).toBe(1);
      expect((goal as { targetSystemId: string }).targetSystemId).toBe('sys1');
    });

    it('should return undefined when no player fleets are nearby', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, id: 2 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 50,
          y: 50,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });

    it('should return undefined when enemy has no planets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
      ];
      const systems: StarSystem[] = [];

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });
  });

  describe('develop strategy', () => {
    it('should produce a develop goal', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 100,
          y: 100,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];

      service.tick(3, 'develop', 'enemy1', fleets, factions, systems);
      const goal = service.getGoal('enemy1');

      expect(goal).toBeDefined();
      expect((goal as { type: string }).type).toBe('develop');
    });
  });

  describe('goal commitment', () => {
    it('should replace invalid goals', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeDefined();
      expect((service.getGoal('enemy1') as { type: string }).type).toBe('colonize');

      systems[0].planetsTiles[0].factionId = 'player';

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });

    it('should keep valid goals committed', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      const firstGoal = service.getGoal('enemy1');

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      const secondGoal = service.getGoal('enemy1');

      expect(firstGoal).toBe(secondGoal);
    });

    it('should replace goal when strategy changes', () => {
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
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect((service.getGoal('enemy1') as { type: string }).type).toBe('colonize');

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect((service.getGoal('enemy1') as { type: string }).type).toBe('attack');
    });
  });

  describe('multi-faction independence', () => {
    it('should maintain independent goals for each faction', () => {
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
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
        createSystem({
          id: 'sys2',
          x: 100,
          y: 100,
          planetsTiles: [createPlanet({ id: 2, factionId: 'enemy2' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      service.tick(3, 'develop', 'enemy2', fleets, factions, systems);

      expect((service.getGoal('enemy1') as { type: string }).type).toBe('colonize');
      expect((service.getGoal('enemy2') as { type: string }).type).toBe('develop');
    });
  });

  describe('determinism', () => {
    it('should produce the same goal for identical input', () => {
      const fleets1 = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems1 = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets1, factions, systems1);
      const first = service.getGoal('enemy1');

      service.reset();
      const fleets2 = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems2 = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets2, factions, systems2);
      const second = service.getGoal('enemy1');

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });

  describe('no state mutation', () => {
    it('should not modify player fleets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, targetX: null, targetY: null, id: 2 }),
      ];
      const systems: StarSystem[] = [];

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect(fleets[1].targetX).toBeNull();
      expect(fleets[1].targetY).toBeNull();
    });

    it('should not modify neutral or unhabited planets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [
            createPlanet({ factionId: 'unhabited', id: 1 }),
            createPlanet({ factionId: 'independent', id: 2 }),
          ],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
      expect(systems[0].planetsTiles[1].factionId).toBe('independent');
    });

    it('should not modify enemy planet ownership', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ factionId: 'enemy1', id: 1 })],
        }),
      ];

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
    });
  });

  describe('edge cases', () => {
    it('should return false when deltaTime is 0 (paused)', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems: StarSystem[] = [];

      const result = service.tick(0, 'expand', 'enemy1', fleets, factions, systems);
      expect(result).toBe(false);
    });

    it('should return false when deltaTime is negative', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems: StarSystem[] = [];

      const result = service.tick(-1, 'expand', 'enemy1', fleets, factions, systems);
      expect(result).toBe(false);
    });

    it('should persist goal across accumulator cycles', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(1, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();

      service.tick(1.5, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeDefined();
      expect((service.getGoal('enemy1') as { type: string }).type).toBe('colonize');
    });

    it('should invalidate attack goal when target is destroyed', () => {
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

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect((service.getGoal('enemy1') as { targetFleetId: number }).targetFleetId).toBe(2);

      fleets[1].destroyed = true;

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });

    it('should skip planets already targeted by another faction', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 0, y: 0, id: 2 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect((service.getGoal('enemy1') as { targetPlanetId: number }).targetPlanetId).toBe(1);

      service.tick(3, 'expand', 'enemy2', fleets, factions, systems);
      expect(service.getGoal('enemy2')).toBeUndefined();
    });

    it('should invalidate defend goal when threat disappears', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 3, y: 3, id: 2 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 5,
          y: 5,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      expect((service.getGoal('enemy1') as { type: string }).type).toBe('defend');

      fleets[1].x = 100;
      fleets[1].y = 100;

      service.tick(3, 'defend', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });

    it('should return undefined for attack goal when all player fleets are destroyed', () => {
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

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeDefined();

      fleets[1].destroyed = true;

      service.tick(3, 'attack', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeUndefined();
    });
  });

  describe('reset', () => {
    it('should clear goals after reset', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, 'expand', 'enemy1', fleets, factions, systems);
      expect(service.getGoal('enemy1')).toBeDefined();

      service.reset();
      expect(service.getGoal('enemy1')).toBeUndefined();
    });
  });
});

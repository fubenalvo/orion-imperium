import { TestBed } from '@angular/core/testing';
import { EnemyCapabilityService } from './enemy-capability.service';
import { Fleet, Faction, StarSystem } from './star-map.models';

describe('EnemyCapabilityService', () => {
  let service: EnemyCapabilityService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyCapabilityService);
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

  const emptyShipStock: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[] = [];
  const emptyProduction: { factionId: string; ordersByPlanet: Record<number, { shipTypeId: string; quantity: number; progress: number; startedAtTick: number }[]> }[] = [];

  describe('colonize goal', () => {
    it('should be executable when all prerequisites are satisfied', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }] }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(true);
      expect(result!.goalType).toBe('colonize');
      expect(result!.factionId).toBe('enemy1');
      result!.requirements.forEach((r) => expect(r.satisfied).toBe(true));
    });

    it('should detect missing colonizer technology', () => {
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
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const techReq = result!.requirements.find((r) => r.type === 'colonizer_technology');
      expect(techReq).toBeDefined();
      expect(techReq!.satisfied).toBe(false);
      expect(techReq!.reason).toBe('no_colonizer_technology');
    });

    it('should detect missing colonizer ship unlock', () => {
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
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithOtherTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_science'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithOtherTech, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const unlockReq = result!.requirements.find((r) => r.type === 'colonizer_unlocked');
      expect(unlockReq).toBeDefined();
      expect(unlockReq!.satisfied).toBe(false);
      expect(unlockReq!.reason).toBe('colonizer_not_unlocked');
    });

    it('should detect unavailable colonizer ship', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }] }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const availReq = result!.requirements.find((r) => r.type === 'colonizer_available');
      expect(availReq).toBeDefined();
      expect(availReq!.satisfied).toBe(false);
      expect(availReq!.reason).toBe('no_colonizer_available');
    });

    it('should detect missing usable fleet', () => {
      const fleets: Fleet[] = [];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);
      const shipStockWithColonizer = [{ factionId: 'enemy1', ships: [{ id: 1, type: 'colonizer', name: 'Colonizer' }] }];

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, shipStockWithColonizer, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const fleetReq = result!.requirements.find((r) => r.type === 'usable_fleet');
      expect(fleetReq).toBeDefined();
      expect(fleetReq!.satisfied).toBe(false);
      expect(fleetReq!.reason).toBe('no_usable_fleet');
    });

    it('should detect invalid target', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems: StarSystem[] = [];
      const goal = { type: 'colonize' as const, targetPlanetId: 999, targetSystemId: 'nonexistent' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const targetReq = result!.requirements.find((r) => r.type === 'target_valid');
      expect(targetReq).toBeDefined();
      expect(targetReq!.satisfied).toBe(false);
      expect(targetReq!.reason).toBe('target_invalid');
    });
  });

  describe('attack goal', () => {
    it('should be executable with a valid combat fleet', () => {
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
      const goal = { type: 'attack' as const, targetFleetId: 2 };

      service.tick(3, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(true);
      expect(result!.goalType).toBe('attack');
      result!.requirements.forEach((r) => expect(r.satisfied).toBe(true));
    });

    it('should detect missing enemy fleet', () => {
      const fleets = [
        createFleet({
          factionId: 'player',
          name: 'ORION',
          x: 5,
          y: 5,
          id: 2,
          ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
        }),
      ];
      const goal = { type: 'attack' as const, targetFleetId: 2 };

      service.tick(3, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const fleetReq = result!.requirements.find((r) => r.type === 'available_fleet');
      expect(fleetReq).toBeDefined();
      expect(fleetReq!.satisfied).toBe(false);
      expect(fleetReq!.reason).toBe('no_available_fleet');
    });

    it('should detect destroyed target fleet', () => {
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
          destroyed: true,
          ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: true }],
        }),
      ];
      const goal = { type: 'attack' as const, targetFleetId: 2 };

      service.tick(3, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const targetReq = result!.requirements.find((r) => r.type === 'target_valid');
      expect(targetReq).toBeDefined();
      expect(targetReq!.satisfied).toBe(false);
      expect(targetReq!.reason).toBe('target_destroyed');
    });
  });

  describe('defend goal', () => {
    it('should be executable when a suitable fleet exists and threat is present', () => {
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
      const goal = { type: 'defend' as const, targetPlanetId: 1, targetSystemId: 'sys1' };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(true);
      expect(result!.goalType).toBe('defend');
      result!.requirements.forEach((r) => expect(r.satisfied).toBe(true));
    });

    it('should detect missing enemy fleet', () => {
      const fleets = [
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
      const goal = { type: 'defend' as const, targetPlanetId: 1, targetSystemId: 'sys1' };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const fleetReq = result!.requirements.find((r) => r.type === 'available_fleet');
      expect(fleetReq).toBeDefined();
      expect(fleetReq!.satisfied).toBe(false);
      expect(fleetReq!.reason).toBe('no_available_fleet');
    });

    it('should detect missing threat', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 100, y: 100, id: 2 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 5,
          y: 5,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const goal = { type: 'defend' as const, targetPlanetId: 1, targetSystemId: 'sys1' };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const threatReq = result!.requirements.find((r) => r.type === 'threat_present');
      expect(threatReq).toBeDefined();
      expect(threatReq!.satisfied).toBe(false);
      expect(threatReq!.reason).toBe('no_threat');
    });
  });

  describe('develop goal', () => {
    it('should be considered executable', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const goal = { type: 'develop' as const };

      service.tick(3, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(true);
      expect(result!.goalType).toBe('develop');
      expect(result!.requirements).toHaveLength(1);
      expect(result!.requirements[0].type).toBe('always_executable');
      expect(result!.requirements[0].satisfied).toBe(true);
    });
  });

  describe('determinism', () => {
    it('should produce the same result for identical input', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }] }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, emptyShipStock, emptyProduction);
      const first = service.getCapability('enemy1');

      service.reset();
      const fleets2 = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }] }),
      ];
      const systems2 = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, goal, 'enemy1', fleets2, factionsWithTech, systems2, emptyShipStock, emptyProduction);
      const second = service.getCapability('enemy1');

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  });

  describe('no state mutation', () => {
    it('should not modify input fleets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, targetX: null, targetY: null, id: 2 }),
      ];
      const systems: StarSystem[] = [];
      const goal = { type: 'attack' as const, targetFleetId: 2 };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      expect(fleets[1].targetX).toBeNull();
      expect(fleets[1].targetY).toBeNull();
    });

    it('should not modify factions', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems: StarSystem[] = [];
      const goal = { type: 'attack' as const, targetFleetId: 2 };
      const originalResearch = factions[0].researchedTechnologies;

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      expect(factions[0].researchedTechnologies).toBe(originalResearch);
    });

    it('should not modify star systems', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const originalFactionId = systems[0].planetsTiles[0].factionId;

      service.tick(3, { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' }, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      expect(systems[0].planetsTiles[0].factionId).toBe(originalFactionId);
    });
  });

  describe('multi-faction independence', () => {
    it('should produce independent results for each faction', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, destroyed: true, ships: [] }),
        createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 100, y: 100, id: 2, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
        createFleet({
          factionId: 'player',
          name: 'ORION',
          x: 2,
          y: 2,
          id: 3,
          ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }],
        }),
      ];
      const systems: StarSystem[] = [];
      const goal1 = { type: 'attack' as const, targetFleetId: 3 };
      const goal2 = { type: 'attack' as const, targetFleetId: 3 };

      service.tick(3, goal1, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      service.tick(3, goal2, 'enemy2', fleets, factions, systems, emptyShipStock, emptyProduction);

      const result1 = service.getCapability('enemy1');
      const result2 = service.getCapability('enemy2');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1!.canExecute).toBe(false);
      expect(result2!.canExecute).toBe(true);
    });
  });

  describe('timing and reset', () => {
    it('should return false when deltaTime is 0 (paused)', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const goal = { type: 'develop' as const };

      const result = service.tick(0, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getCapability('enemy1')).toBeUndefined();
    });

    it('should return false when deltaTime is negative', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const goal = { type: 'develop' as const };

      const result = service.tick(-1, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getCapability('enemy1')).toBeUndefined();
    });

    it('should persist result across accumulator cycles', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const goal = { type: 'develop' as const };

      service.tick(1, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(service.getCapability('enemy1')).toBeUndefined();

      service.tick(1.5, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(service.getCapability('enemy1')).toBeDefined();
      expect(service.getCapability('enemy1')!.canExecute).toBe(true);
    });

    it('should clear capabilities after reset', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];
      const goal = { type: 'develop' as const };

      service.tick(3, goal, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(service.getCapability('enemy1')).toBeDefined();

      service.reset();
      expect(service.getCapability('enemy1')).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should return false when goal is undefined', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
      ];

      const result = service.tick(3, undefined, 'enemy1', fleets, factions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getCapability('enemy1')).toBeUndefined();
    });

    it('should handle faction with undefined researchedTechnologies', () => {
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
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };

      service.tick(3, goal, 'enemy1', fleets, factions, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const techReq = result!.requirements.find((r) => r.type === 'colonizer_technology');
      expect(techReq!.satisfied).toBe(false);
    });

    it('should treat fleet with only destroyed ships as no usable fleet', () => {
      const fleets = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 0,
          y: 0,
          id: 1,
          ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 0, destroyed: true }],
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
      const goal = { type: 'colonize' as const, targetPlanetId: 1, targetSystemId: 'sys1' };
      const factionsWithTech = factions.map((f) => f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f);

      service.tick(3, goal, 'enemy1', fleets, factionsWithTech, systems, emptyShipStock, emptyProduction);
      const result = service.getCapability('enemy1');

      expect(result).toBeDefined();
      expect(result!.canExecute).toBe(false);
      const fleetReq = result!.requirements.find((r) => r.type === 'usable_fleet');
      expect(fleetReq!.satisfied).toBe(false);
    });
  });
});

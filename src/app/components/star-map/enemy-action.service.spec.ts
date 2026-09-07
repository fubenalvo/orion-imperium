import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EnemyActionService } from './enemy-action.service';
import { Fleet, Faction, StarSystem, CapabilityResult, ColonizeGoal, AttackGoal, DefendGoal, DevelopGoal } from './star-map.models';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { StarMapMovementService } from './star-map-movement.service';

describe('EnemyActionService', () => {
  let service: EnemyActionService;
  let shipService: any;
  let researchService: any;
  let shipStockService: any;
  let productionService: any;
  let spaceportService: any;
  let fleetAssemblyService: any;
  let movementService: any;

  beforeEach(() => {
    shipService = {
      getShipType: vi.fn(() => ({ id: 'colonizer', name: 'Colonizer', cost: 100 })),
    };
    researchService = {
      isResearched: vi.fn(() => true),
      isShipUnlocked: vi.fn(() => true),
    };
    shipStockService = {
      getCount: vi.fn(() => 0),
    };
    productionService = {
      getPlanetCapacity: vi.fn(() => 1),
      listBuildableShipTypes: vi.fn(() => []),
    };
    spaceportService = {
      hasSpaceport: vi.fn(() => true),
    };
    fleetAssemblyService = {};
    movementService = {
      getPlanetGridPosition: vi.fn(() => ({ col: 1, row: 1 })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ShipService, useValue: shipService },
        { provide: ResearchService, useValue: researchService },
        { provide: ShipStockService, useValue: shipStockService },
        { provide: ProductionService, useValue: productionService },
        { provide: SpaceportService, useValue: spaceportService },
        { provide: FleetAssemblyService, useValue: fleetAssemblyService },
        { provide: StarMapMovementService, useValue: movementService },
      ],
    });

    service = TestBed.inject(EnemyActionService);
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
    gridCol: 1,
    gridRow: 1,
    ships: [{ id: 1, name: 'Ship', type: 'frigate', currentHp: 10, destroyed: false }],
    destroyed: false,
    sensorRange: 3,
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

  const baseFactions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, currencies: {} },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, ai: true, currencies: {} },
  ];

  const emptyShipStock: { factionId: string; ships: { id: number; type: string; name: string; producedAtTick?: number; originPlanetId?: number | null }[] }[] = [];
  const emptyProduction: any[] = [];

  const makeCapability = (overrides: Partial<CapabilityResult> = {}): CapabilityResult => ({
    canExecute: true,
    goalType: 'colonize',
    factionId: 'enemy1',
    requirements: [],
    ...overrides,
  });

  const makeColonizeGoal = (overrides: Partial<ColonizeGoal> = {}): ColonizeGoal => ({
    type: 'colonize',
    targetPlanetId: 1,
    targetSystemId: 'sys1',
    ...overrides,
  });

  const makeAttackGoal = (overrides: Partial<AttackGoal> = {}): AttackGoal => ({
    type: 'attack',
    targetFleetId: 1,
    ...overrides,
  });

  const makeDefendGoal = (overrides: Partial<DefendGoal> = {}): DefendGoal => ({
    type: 'defend',
    targetPlanetId: 1,
    targetSystemId: 'sys1',
    ...overrides,
  });

  const makeDevelopGoal = (): DevelopGoal => ({ type: 'develop' });

  describe('colonize goal', () => {
    it('should produce PRODUCE_COLONIZER when colonizer is missing but production is possible', () => {
      const factionsWithCredits = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: false,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: false, reason: 'no_colonizer_available' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', [], factionsWithCredits, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('produce_colonizer');
      expect(result!.factionId).toBe('enemy1');
      expect(result!.goalType).toBe('colonize');
    });

    it('should produce ASSEMBLE_FLEET when colonizer is in stock but no fleet has it', () => {
      const factionsWithCredits = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })] })];
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: true,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });
      const shipStock = [{ factionId: 'enemy1', ships: [{ id: 1, type: 'colonizer', name: 'Colonizer' }] }];

      (shipStockService.getCount as any).mockReturnValue(1);

      service.tick(3, goal, capability, 'enemy1', [], factionsWithCredits, systems, shipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('assemble_fleet');
    });

    it('should produce MOVE_TO_TARGET when fleet with colonizer is away from target', () => {
      const movementMock = { getPlanetGridPosition: vi.fn(() => ({ col: 10, row: 10 })) };
      service = new EnemyActionService(
        shipService,
        researchService,
        shipStockService,
        productionService,
        spaceportService,
        fleetAssemblyService,
        movementMock as any,
      );

      const fleets = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 0,
          y: 0,
          gridCol: 1,
          gridRow: 1,
          id: 1,
          ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }],
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
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: true,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('move_to_target');
      expect(result!.targetId).toBe(1);
    });

    it('should produce COLONIZE when fleet with colonizer is at target', () => {
      const movementMock = { getPlanetGridPosition: vi.fn(() => ({ col: 10, row: 10 })) };
      service = new EnemyActionService(
        shipService,
        researchService,
        shipStockService,
        productionService,
        spaceportService,
        fleetAssemblyService,
        movementMock as any,
      );

      const fleets = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 10,
          y: 10,
          gridCol: 10,
          gridRow: 10,
          id: 1,
          ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }],
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
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: true,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('colonize');
      expect(result!.targetId).toBe(1);
    });

    it('should produce NONE for invalid colonization goal', () => {
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'player' })],
        }),
      ];
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: false,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: false, reason: 'target_invalid' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', [], baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('none');
      expect(result!.reason).toBe('target_invalid');
    });
  });

  describe('attack goal', () => {
    it('should produce MOVE_TO_TARGET when fleet is away from target', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 2 }),
      ];
      const goal = makeAttackGoal({ targetFleetId: 2 });
      const capability = makeCapability({
        canExecute: true,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'fleet_can_engage', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('move_to_target');
      expect(result!.targetId).toBe(1);
    });

    it('should produce ATTACK when fleet is at target position', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 5, y: 5, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 2 }),
      ];
      const goal = makeAttackGoal({ targetFleetId: 2 });
      const capability = makeCapability({
        canExecute: true,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'fleet_can_engage', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('attack');
      expect(result!.targetId).toBe(2);
    });

    it('should produce NONE for invalid attack goal', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 5, y: 5, id: 2, destroyed: true, ships: [] }),
      ];
      const goal = makeAttackGoal({ targetFleetId: 2 });
      const capability = makeCapability({
        canExecute: false,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: false, reason: 'target_destroyed' },
          { type: 'fleet_can_engage', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('none');
      expect(result!.reason).toBe('target_destroyed');
    });
  });

  describe('defend goal', () => {
    it('should produce MOVE_TO_TARGET when fleet is away from threatened system', () => {
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
      const goal = makeDefendGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'defend',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'threat_present', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('move_to_target');
      expect(result!.targetId).toBe(1);
    });

    it('should produce DEFEND when fleet is at threatened system', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 10, y: 10, id: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const goal = makeDefendGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'defend',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'threat_present', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('defend');
    });
  });

  describe('develop goal', () => {
    it('should produce DEVELOP for develop goal', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('develop');
      expect(result!.goalType).toBe('develop');
      expect(result!.reason).toBe('Develop goal is always executable');
    });
  });

  describe('general', () => {
    it('should produce the same result for identical input (determinism)', () => {
      const fleets = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 0,
          y: 0,
          id: 1,
          ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }],
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
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: true,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const first = service.getAction('enemy1');

      service.reset();
      const fleets2 = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 0,
          y: 0,
          id: 1,
          ships: [{ id: 1, name: 'C', type: 'colonizer', currentHp: 10, destroyed: false }],
        }),
      ];
      const systems2 = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];

      service.tick(3, goal, capability, 'enemy1', fleets2, baseFactions, systems2, emptyShipStock, emptyProduction);
      const second = service.getAction('enemy1');

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('should not modify input fleets', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 }),
        createFleet({ factionId: 'player', name: 'ORION', x: 0, y: 0, targetX: null, targetY: null, id: 2 }),
      ];
      const goal = makeAttackGoal();
      const capability = makeCapability({
        canExecute: false,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: false, reason: 'no_available_fleet' },
          { type: 'target_valid', satisfied: false, reason: 'target_destroyed' },
          { type: 'fleet_can_engage', satisfied: false, reason: 'no_combat_capability' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(fleets[1].targetX).toBeNull();
      expect(fleets[1].targetY).toBeNull();
    });

    it('should not modify factions', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeAttackGoal();
      const capability = makeCapability({
        canExecute: false,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: false, reason: 'no_available_fleet' },
          { type: 'target_valid', satisfied: false, reason: 'target_destroyed' },
          { type: 'fleet_can_engage', satisfied: false, reason: 'no_combat_capability' },
        ],
      });
      const originalResearch = baseFactions[0].researchedTechnologies;

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(baseFactions[0].researchedTechnologies).toBe(originalResearch);
    });

    it('should not modify star systems', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const goal = makeDefendGoal();
      const capability = makeCapability({
        canExecute: false,
        goalType: 'defend',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: false, reason: 'no_available_fleet' },
          { type: 'target_valid', satisfied: false, reason: 'target_lost' },
          { type: 'threat_present', satisfied: false, reason: 'no_threat' },
        ],
      });
      const originalFactionId = systems[0].planetsTiles[0].factionId;

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      expect(systems[0].planetsTiles[0].factionId).toBe(originalFactionId);
    });

    it('should produce independent actions for each faction', () => {
      const fleets = [
        createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1, destroyed: true, ships: [] }),
        createFleet({ factionId: 'enemy2', name: 'HUNTER', x: 100, y: 100, id: 2, ships: [{ id: 1, name: 'D', type: 'destroyer', currentHp: 10, destroyed: false }] }),
        createFleet({ factionId: 'player', name: 'ORION', x: 2, y: 2, id: 3, ships: [{ id: 1, name: 'S', type: 'scout', currentHp: 10, destroyed: false }] }),
      ];
      const goal1 = makeAttackGoal({ targetFleetId: 3 });
      const goal2 = makeAttackGoal({ targetFleetId: 3 });
      const capability1 = makeCapability({
        canExecute: false,
        goalType: 'attack',
        factionId: 'enemy1',
        requirements: [
          { type: 'available_fleet', satisfied: false, reason: 'no_available_fleet' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'fleet_can_engage', satisfied: false, reason: 'no_combat_capability' },
        ],
      });
      const capability2 = makeCapability({
        canExecute: true,
        goalType: 'attack',
        factionId: 'enemy2',
        requirements: [
          { type: 'available_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
          { type: 'fleet_can_engage', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal1, capability1, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      service.tick(3, goal2, capability2, 'enemy2', fleets, baseFactions, [], emptyShipStock, emptyProduction);

      const result1 = service.getAction('enemy1');
      const result2 = service.getAction('enemy2');

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(result1!.type).toBe('none');
      expect(result2!.type).toBe('move_to_target');
    });
  });

  describe('timing and reset', () => {
    it('should return false when deltaTime is 0 (paused)', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      const result = service.tick(0, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getAction('enemy1')).toBeUndefined();
    });

    it('should return false when deltaTime is negative', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      const result = service.tick(-1, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getAction('enemy1')).toBeUndefined();
    });

    it('should persist result across accumulator cycles', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      service.tick(1, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(service.getAction('enemy1')).toBeUndefined();

      service.tick(1.5, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(service.getAction('enemy1')).toBeDefined();
      expect(service.getAction('enemy1')!.type).toBe('develop');
    });

    it('should clear actions after reset', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(service.getAction('enemy1')).toBeDefined();

      service.reset();
      expect(service.getAction('enemy1')).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should return NONE when goal is undefined', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const capability = makeCapability({
        canExecute: true,
        goalType: 'develop',
        factionId: 'enemy1',
        requirements: [{ type: 'always_executable', satisfied: true, reason: 'satisfied' }],
      });

      const result = service.tick(3, undefined, capability, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getAction('enemy1')).toBeUndefined();
    });

    it('should return NONE when capability is undefined', () => {
      const fleets = [createFleet({ factionId: 'enemy1', name: 'RAIDER', x: 0, y: 0, id: 1 })];
      const goal = makeDevelopGoal();

      const result = service.tick(3, goal, undefined, 'enemy1', fleets, baseFactions, [], emptyShipStock, emptyProduction);
      expect(result).toBe(false);
      expect(service.getAction('enemy1')).toBeUndefined();
    });

    it('should return NONE for colonization when no fleet with colonizer exists for execute', () => {
      const fleets = [
        createFleet({
          factionId: 'enemy1',
          name: 'RAIDER',
          x: 0,
          y: 0,
          id: 1,
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
      const goal = makeColonizeGoal();
      const capability = makeCapability({
        canExecute: true,
        requirements: [
          { type: 'colonizer_technology', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_unlocked', satisfied: true, reason: 'satisfied' },
          { type: 'colonizer_available', satisfied: true, reason: 'satisfied' },
          { type: 'usable_fleet', satisfied: true, reason: 'satisfied' },
          { type: 'target_valid', satisfied: true, reason: 'satisfied' },
        ],
      });

      service.tick(3, goal, capability, 'enemy1', fleets, baseFactions, systems, emptyShipStock, emptyProduction);
      const result = service.getAction('enemy1');

      expect(result).toBeDefined();
      expect(result!.type).toBe('none');
      expect(result!.reason).toBe('No fleet with colonizer found');
    });
  });
});

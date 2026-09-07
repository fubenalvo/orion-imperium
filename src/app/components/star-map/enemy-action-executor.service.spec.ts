import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EnemyActionExecutor } from './enemy-action-executor.service';
import {
  Faction,
  StarSystem,
  ActionResult,
  ColonizeGoal,
  AttackGoal,
  DefendGoal,
  DevelopGoal,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  PlanetBuilding,
  PLANET_SIZE_MAP,
} from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { EconomyService } from '../../services/economy.service';
import { StarMapMovementService } from './star-map-movement.service';

describe('EnemyActionExecutor', () => {
  let service: EnemyActionExecutor;
  let productionService: any;
  let shipService: any;
  let researchService: any;
  let planetBattleService: any;
  let economyService: any;

  beforeEach(() => {
    productionService = {
      queueOrder: vi.fn(() => ({
        ok: true,
        order: { id: 1, shipTypeId: 'colonizer', quantity: 1, progress: 0, startedAtTick: 0 },
      })),
      getPlanetCapacity: vi.fn(() => 1),
    };
    shipService = {
      getShipType: vi.fn(() => ({ id: 'colonizer', name: 'Colonizer', cost: 100 })),
    };
    researchService = {
      isResearched: vi.fn(() => true),
      isShipUnlocked: vi.fn(() => true),
      isBuildingUnlocked: vi.fn(() => true),
    };
    planetBattleService = {
      resolveUninhabitedArrival: vi.fn((fleet: Fleet) => {
        const index = fleet.ships.findIndex((s) => s.type === 'colonizer' && !s.destroyed);
        return { colonized: index >= 0, colonizerIndex: index };
      }),
    };
    economyService = {
      calculatePlanetEconomy: vi.fn(() => ({
        energyProduction: 10,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      })),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ProductionService, useValue: productionService },
        { provide: ShipService, useValue: shipService },
        { provide: ResearchService, useValue: researchService },
        { provide: PlanetBattleService, useValue: planetBattleService },
        { provide: EconomyService, useValue: economyService },
        {
          provide: StarMapMovementService,
          useValue: {
            getPlanetGridPosition: vi.fn(() => ({ col: 2, row: 2 })),
            calculateGridCell: vi.fn((x: number, y: number) => ({ col: Math.floor(x), row: Math.floor(y) })),
          },
        },
      ],
    });

    service = TestBed.inject(EnemyActionExecutor);
  });

  afterEach(() => {
    service.reset();
    vi.resetAllMocks();
  });

  const createFaction = (overrides: Partial<Faction> = {}): Faction => ({
    id: 'enemy1',
    name: 'Enemy 1',
    color: '#d65757',
    team: 2,
    ai: true,
    currencies: { credits: 200 },
    ...overrides,
  });

  const createPlanet = (
    overrides: Partial<StarSystem['planetsTiles'][0]> = {},
  ): StarSystem['planetsTiles'][0] => ({
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

  const makeAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
    type: 'produce_colonizer',
    factionId: 'enemy1',
    goalType: 'colonize',
    goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' } as ColonizeGoal,
    reason: 'No colonizer available but production is possible',
    ...overrides,
  });

  const baseFactions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    {
      id: 'enemy1',
      name: 'Enemy 1',
      color: '#d65757',
      team: 2,
      ai: true,
      currencies: { credits: 200 },
      researchedTechnologies: ['basic_engineering'],
    },
    {
      id: 'enemy2',
      name: 'Enemy 2',
      color: '#39b8a8',
      team: 2,
      ai: true,
      currencies: { credits: 200 },
      researchedTechnologies: ['basic_engineering'],
    },
  ];

  const emptyProduction: FactionProduction[] = [];
  const emptyShipStock: FactionShipStock[] = [];
  const emptyFleets: Fleet[] = [];

  describe('produce_colonizer execution', () => {
    it('should start colonizer production when action is produce_colonizer and conditions are met', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
          : f,
      );
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        factions,
        systems,
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(true);
      expect(productionService.queueOrder).toHaveBeenCalledWith(
        { production: [] },
        'enemy1',
        1,
        'colonizer',
        1,
        systems,
        factions,
      );
    });

    it('should select the deterministic lowest system/planet id with factory capacity', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
          : f,
      );
      const systems = [
        createSystem({
          id: 'sys2',
          planetsTiles: [
            createPlanet({
              id: 3,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({
              id: 2,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        factions,
        systems,
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(true);
      expect(productionService.queueOrder).toHaveBeenCalledWith(
        { production: [] },
        'enemy1',
        2,
        'colonizer',
        1,
        systems,
        factions,
      );
    });

    it('should not execute for player faction', () => {
      const action = makeAction({ factionId: 'player' });
      const factions = baseFactions;

      const result = service.tick(
        2,
        action,
        factions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute for independent faction', () => {
      const action = makeAction({ factionId: 'independent' });
      const factions = baseFactions;

      const result = service.tick(
        2,
        action,
        factions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when colonizer is locked', () => {
      (researchService.isShipUnlocked as any).mockReturnValue(false);
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction lacks basic_engineering', () => {
      (researchService.isResearched as any).mockReturnValue(false);
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction has insufficient credits', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, currencies: { credits: 10 } } : f,
      );
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        factions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when no planet has factory capacity', () => {
      (productionService.getPlanetCapacity as any).mockReturnValue(0);
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction does not exist', () => {
      const action = makeAction({ factionId: 'nonexistent' });

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when action type is not produce_colonizer', () => {
      const action = makeAction({ type: 'none' });

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when gameDeltaTime is 0 (paused)', () => {
      const action = makeAction();

      const result = service.tick(
        0,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when gameDeltaTime is negative', () => {
      const action = makeAction();

      const result = service.tick(
        -1,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not create duplicate orders when a pending colonizer order exists', () => {
      const existingProduction: FactionProduction[] = [
        {
          factionId: 'enemy1',
          ordersByPlanet: {
            1: [{ id: 1, shipTypeId: 'colonizer', quantity: 1, progress: 0.5, startedAtTick: 0 }],
          },
        },
      ];
      const action = makeAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        existingProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when queueOrder returns failure', () => {
      (productionService.queueOrder as any).mockReturnValue({
        ok: false,
        reason: 'insufficient_resources',
      });
      const action = makeAction();
      const systems = [
        createSystem({
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(false);
      expect(productionService.queueOrder).toHaveBeenCalled();
    });

    it('should not modify player production queue', () => {
      const playerProduction: FactionProduction[] = [
        {
          factionId: 'player',
          ordersByPlanet: {
            1: [{ id: 1, shipTypeId: 'scout', quantity: 1, progress: 0, startedAtTick: 0 }],
          },
        },
      ];
      const action = makeAction();
      const systems = [
        createSystem({
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        playerProduction,
        emptyShipStock,
        emptyFleets,
      );

      expect(result).toBe(true);
      expect(playerProduction[0].ordersByPlanet[1]).toHaveLength(1);
      expect(playerProduction[0].ordersByPlanet[1][0].shipTypeId).toBe('scout');
    });

    it('should log execution success', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];
      const action = makeAction();

      service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(logSpy).toHaveBeenCalledWith(
        '[Enemy AI] enemy1 executed produce_colonizer at planet Planet',
      );
      logSpy.mockRestore();
    });
  });

  describe('planet selection', () => {
    it('should pick the first planet with factory capacity across multiple systems', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
          : f,
      );
      const systems = [
        createSystem({
          id: 'sys10',
          planetsTiles: [
            createPlanet({
              id: 5,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
        createSystem({
          id: 'sys2',
          planetsTiles: [
            createPlanet({ id: 2, factionId: 'enemy1', buildings: [] }),
            createPlanet({
              id: 3,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];
      const action = makeAction();

      service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(productionService.queueOrder).toHaveBeenCalledWith(
        { production: [] },
        'enemy1',
        1,
        'colonizer',
        1,
        systems,
        factions,
      );
    });

    it('should skip planets owned by other factions', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] }
          : f,
      );
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({
              id: 1,
              factionId: 'player',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
            createPlanet({
              id: 2,
              factionId: 'enemy1',
              buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }],
            }),
          ],
        }),
      ];
      const action = makeAction();

      service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(productionService.queueOrder).toHaveBeenCalledWith(
        { production: [] },
        'enemy1',
        2,
        'colonizer',
        1,
        systems,
        factions,
      );
    });
  });

  describe('assemble_fleet execution', () => {
    const makeAssembleAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'assemble_fleet',
      factionId: 'enemy1',
      goalType: 'colonize',
      goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' } as ColonizeGoal,
      reason: 'Colonizer in stock but no fleet has it',
      ...overrides,
    });

    const createEnemyFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
      id: 3,
      name: 'RAIDER',
      factionId: 'enemy1',
      x: 30,
      y: 30,
      targetX: null,
      targetY: null,
      speed: 5,
      system: null,
      gridCol: 1,
      gridRow: 1,
      ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
      destroyed: false,
      sensorRange: 3,
      ...overrides,
    });

    const makeStock = (factionId: string, ids: number[]): FactionShipStock[] => [
      { factionId, ships: ids.map((id) => ({ id, type: 'colonizer', name: 'Colonizer' })) },
    ];

    const spaceportSystems = (): StarSystem[] => [
      createSystem({
        id: 'sys1',
        planetsTiles: [
          createPlanet({
            id: 1,
            factionId: 'enemy1',
            buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }],
          }),
        ],
      }),
    ];

    it('should move one colonizer from stock into the existing faction fleet', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(shipStock[0].ships).toHaveLength(0);
      expect(fleets).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(2);
      expect(
        fleets[0].ships.some((s) => s.type === 'colonizer' && s.id === 101 && !s.destroyed),
      ).toBe(true);
    });

    it('should keep the reinforced fleet identity and position unchanged', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({ id: 3, name: 'RAIDER', x: 12, y: 34, gridCol: 5, gridRow: 6 }),
      ];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);
      const fleetBefore = {
        id: fleets[0].id,
        name: fleets[0].name,
        x: fleets[0].x,
        y: fleets[0].y,
        system: fleets[0].system,
      };

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(fleets).toHaveLength(1);
      expect(fleets[0].id).toBe(fleetBefore.id);
      expect(fleets[0].name).toBe(fleetBefore.name);
      expect(fleets[0].x).toBe(fleetBefore.x);
      expect(fleets[0].y).toBe(fleetBefore.y);
      expect(fleets[0].system).toEqual(fleetBefore.system);
      expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(true);
    });

    it('should log execution success exactly once', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(logSpy).toHaveBeenCalledWith(
        '[Enemy AI] enemy1 executed assemble_fleet: reinforced fleet RAIDER with 1 colonizer',
      );
      logSpy.mockRestore();
    });

    it('should not execute when the faction stock has no colonizer', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', []);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(0);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not mutate state when the faction owns no Spaceport', () => {
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [] })],
        }),
      ];
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        systems,
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not assemble ships from another faction stock', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy2', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not modify player stock or player fleets', () => {
      const fleets: Fleet[] = [createEnemyFleet({ factionId: 'player', id: 1, name: 'ORION' })];
      const shipStock: FactionShipStock[] = makeStock('player', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not execute assemble_fleet for the player faction', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction({ factionId: 'player' }),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not assemble the same colonizer twice across repeated frames', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101, 102]);
      const action = makeAssembleAction();

      const first = service.tick(
        2,
        action,
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );
      const second = service.tick(
        2,
        action,
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(1);
    });

    it('should not assemble when a faction fleet already carries a colonizer', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [
            { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
            { id: 200, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
          ],
        }),
      ];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(1);
    });

    it('should skip destroyed and unusable fleets when picking the target fleet', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({ id: 2, name: 'GHOST', destroyed: true }),
        createEnemyFleet({
          id: 5,
          name: 'HUSK',
          ships: [{ id: 20, name: 'Scout', type: 'scout', destroyed: true }],
        }),
        createEnemyFleet({ id: 7, name: 'GUARD' }),
      ];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(shipStock[0].ships).toHaveLength(0);
      expect(fleets.find((f) => f.id === 7)?.ships.some((s) => s.type === 'colonizer')).toBe(true);
      expect(fleets.find((f) => f.id === 2)?.ships.some((s) => s.type === 'colonizer')).toBe(false);
      expect(fleets.find((f) => f.id === 5)?.ships.some((s) => s.type === 'colonizer')).toBe(false);
    });

    it('should create a new faction fleet at the deterministic spaceport when no usable fleet exists', () => {
      const systems = spaceportSystems();
      const fleets: Fleet[] = [];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction(),
        baseFactions,
        systems,
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(shipStock[0].ships).toHaveLength(0);
      expect(fleets).toHaveLength(1);
      const fleet = fleets[0];
      expect(fleet.factionId).toBe('enemy1');
      expect(fleet.name).toBe('enemy1 Fleet');
      expect(fleet.ships).toHaveLength(1);
      expect(fleet.ships[0].type).toBe('colonizer');
      expect(fleet.ships[0].id).toBe(101);
      expect(fleet.x).toBe(systems[0].x);
      expect(fleet.y).toBe(systems[0].y);
      expect(fleet.system?.id).toBe('sys1');
      expect(fleet.gridCol).toBe(2);
      expect(fleet.gridRow).toBe(2);
    });

    it('should not execute assemble_fleet while paused', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        0,
        makeAssembleAction(),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });

    it('should not execute action types other than produce_colonizer and assemble_fleet', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const shipStock: FactionShipStock[] = makeStock('enemy1', [101]);

      const result = service.tick(
        2,
        makeAssembleAction({ type: 'move_to_target', targetId: 3 }),
        baseFactions,
        spaceportSystems(),
        emptyProduction,
        shipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(shipStock[0].ships).toHaveLength(1);
      expect(fleets[0].ships).toHaveLength(1);
    });
  });

  describe('move_to_target execution', () => {
    const makeMoveAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'move_to_target',
      factionId: 'enemy1',
      goalType: 'colonize',
      goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' } as ColonizeGoal,
      targetId: 3,
      targetSystemId: 'sys1',
      targetPlanetId: 1,
      reason: 'Fleet needs to move to target',
      ...overrides,
    });

    const createEnemyFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
      id: 3,
      name: 'RAIDER',
      factionId: 'enemy1',
      x: 10,
      y: 10,
      targetX: null,
      targetY: null,
      speed: 5,
      system: null,
      gridCol: 1,
      gridRow: 1,
      ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
      destroyed: false,
      sensorRange: 3,
      ...overrides,
    });

    const baseSystems = (): StarSystem[] => [
      createSystem({
        id: 'sys1',
        planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
      }),
    ];

    it('should start movement toward the target system for colonize goal', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = baseSystems();
      const action = makeMoveAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(fleets[0].targetX).toBe(systems[0].x);
      expect(fleets[0].targetY).toBe(systems[0].y);
    });

    it('should not start movement when the target system does not exist', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const action = makeMoveAction({ targetSystemId: 'nonexistent' });

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not start movement when the target planet is no longer unhabited', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const action = makeMoveAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not move a destroyed fleet', () => {
      const fleets: Fleet[] = [createEnemyFleet({ destroyed: true })];
      const systems = baseSystems();
      const action = makeMoveAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not move a fleet owned by another faction', () => {
      const fleets: Fleet[] = [createEnemyFleet({ factionId: 'enemy2' })];
      const systems = baseSystems();
      const action = makeMoveAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not move a player fleet', () => {
      const fleets: Fleet[] = [createEnemyFleet({ id: 1, factionId: 'player', name: 'ORION' })];
      const systems = baseSystems();
      const action = makeMoveAction({ targetId: 1 });

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not restart movement when already heading to the same destination', () => {
      const fleets: Fleet[] = [createEnemyFleet({ targetX: 10, targetY: 10 })];
      const systems = baseSystems();
      const action = makeMoveAction();

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBe(10);
      expect(fleets[0].targetY).toBe(10);
    });

    it('should start movement toward the target fleet for attack goal', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
      ];
      const action = makeMoveAction({
        goalType: 'attack',
        goal: { type: 'attack', targetFleetId: 5 } as AttackGoal,
        targetId: 3,
        targetSystemId: undefined,
        targetPlanetId: undefined,
      });

      const result = service.tick(
        2,
        action,
        baseFactions,
        baseSystems(),
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(fleets[0].targetX).toBe(20);
      expect(fleets[0].targetY).toBe(20);
    });

    it('should not move for attack goal when the target fleet is destroyed', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', destroyed: true }),
      ];
      const action = makeMoveAction({
        goalType: 'attack',
        goal: { type: 'attack', targetFleetId: 5 } as AttackGoal,
        targetId: 3,
        targetSystemId: undefined,
        targetPlanetId: undefined,
      });

      const result = service.tick(
        2,
        action,
        baseFactions,
        baseSystems(),
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should start movement toward the threatened system for defend goal', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = [
        createSystem({ id: 'sys1', planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] }),
      ];
      const action = makeMoveAction({
        goalType: 'defend',
        goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' } as DefendGoal,
        targetId: 3,
      });

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(true);
      expect(fleets[0].targetX).toBe(systems[0].x);
      expect(fleets[0].targetY).toBe(systems[0].y);
    });

    it('should not move for defend goal when the target system does not exist', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const action = makeMoveAction({
        goalType: 'defend',
        goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'nonexistent' } as DefendGoal,
        targetId: 3,
      });

      const result = service.tick(
        2,
        action,
        baseFactions,
        [],
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should log execution success exactly once', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = baseSystems();
      const action = makeMoveAction();

      service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(logSpy).toHaveBeenCalledWith('[Enemy AI] enemy1 fleet RAIDER moving to (10, 10)');
      logSpy.mockRestore();
    });

    it('should not execute when the action target fleet id is missing', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = baseSystems();
      const action = makeMoveAction({ targetId: 999 });

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });

    it('should not execute move_to_target for the player faction', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = baseSystems();
      const action = makeMoveAction({ factionId: 'player' });

      const result = service.tick(
        2,
        action,
        baseFactions,
        systems,
        emptyProduction,
        emptyShipStock,
        fleets,
      );

      expect(result).toBe(false);
      expect(fleets[0].targetX).toBeNull();
      expect(fleets[0].targetY).toBeNull();
    });
  });

  describe('colonize execution', () => {
    const makeColonizeAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'colonize',
      factionId: 'enemy1',
      goalType: 'colonize',
      goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' } as ColonizeGoal,
      targetPlanetId: 1,
      targetSystemId: 'sys1',
      reason: 'Fleet with colonizer is at the target planet',
      ...overrides,
    });

    const createEnemyFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
      id: 3,
      name: 'RAIDER',
      factionId: 'enemy1',
      x: 10,
      y: 10,
      targetX: null,
      targetY: null,
      speed: 5,
      system: null,
      gridCol: 10,
      gridRow: 10,
      ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
      destroyed: false,
      sensorRange: 3,
      ...overrides,
    });

    it('should colonize an unhabited planet when fleet is at the planet with a colonizer', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [
            { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
            { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
          ],
        }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
      expect(fleets[0].ships).toHaveLength(1);
      expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(false);
    });

    it('should not execute when the target planet no longer exists', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const action = makeColonizeAction({ targetSystemId: 'nonexistent' });

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when the target planet is already colonized', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
    });

    it('should not execute when the fleet has no colonizer', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
        }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
    });

    it('should not execute when no fleet is at the target planet position', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({ x: 1, y: 1, gridCol: 1, gridRow: 1 }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
    });

    it('should colonize when fleet is at the system position even if planet grid position differs', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          x: 10,
          y: 10,
          gridCol: 10,
          gridRow: 10,
          ships: [
            { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
            { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
          ],
        }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          x: 10,
          y: 10,
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited', x: 5, y: 5 })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
      expect(fleets[0].ships).toHaveLength(1);
      expect(fleets[0].ships.some((s) => s.type === 'colonizer')).toBe(false);
    });

    it('should not execute colonization twice (duplicate guard)', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [
            { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
            { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
          ],
        }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const action = makeColonizeAction();

      const first = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);
      const second = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(systems[0].planetsTiles[0].factionId).toBe('enemy1');
      expect(fleets[0].ships.filter((s) => s.type === 'colonizer')).toHaveLength(0);
    });

    it('should not modify game state when planetBattleService reports no colonizer', () => {
      (planetBattleService.resolveUninhabitedArrival as any).mockReturnValue({ colonized: false, colonizerIndex: -1 });
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [
            { id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false },
            { id: 20, name: 'Colonizer', type: 'colonizer', currentHp: 30, destroyed: false },
          ],
        }),
      ];
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'unhabited' })],
        }),
      ];
      const action = makeColonizeAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].factionId).toBe('unhabited');
      expect(fleets[0].ships).toHaveLength(2);
    });
  });

  describe('attack execution', () => {
    const makeAttackAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'attack',
      factionId: 'enemy1',
      goalType: 'attack',
      goal: { type: 'attack', targetFleetId: 5 } as AttackGoal,
      targetId: 5,
      reason: 'Enemy fleet is at the target fleet position',
      ...overrides,
    });

    const createEnemyFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
      id: 3,
      name: 'RAIDER',
      factionId: 'enemy1',
      x: 20,
      y: 20,
      targetX: null,
      targetY: null,
      speed: 5,
      system: null,
      gridCol: 2,
      gridRow: 2,
      ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
      destroyed: false,
      sensorRange: 3,
      ...overrides,
    });

    it('should return true when AI fleet and target fleet are at the same cell', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20, gridCol: 2, gridRow: 2 }),
      ];
      const action = makeAttackAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(true);
    });

    it('should not execute when the target fleet does not exist', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const action = makeAttackAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when the target fleet is destroyed', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', destroyed: true }),
      ];
      const action = makeAttackAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when the target fleet has no living ships', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({
          id: 5,
          factionId: 'player',
          name: 'ORION',
          ships: [{ id: 50, name: 'Scout', type: 'scout', destroyed: true }],
        }),
      ];
      const action = makeAttackAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when no AI fleet is at the target cell', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({ x: 1, y: 1, gridCol: 1, gridRow: 1 }),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
      ];
      const action = makeAttackAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not modify player fleet state', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20, destroyed: false, ships: [{ id: 50, name: 'Cruiser', type: 'cruiser', destroyed: false }] }),
      ];
      const action = makeAttackAction();
      const playerFleetBefore = { ...fleets[1] };

      service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(fleets[1].destroyed).toBe(playerFleetBefore.destroyed);
      expect(fleets[1].ships).toHaveLength(playerFleetBefore.ships.length);
    });

    it('should not execute attack for the player faction', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 20, y: 20 }),
      ];
      const action = makeAttackAction({ factionId: 'player' });

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });
  });

  describe('defend execution', () => {
    const makeDefendAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'defend',
      factionId: 'enemy1',
      goalType: 'defend',
      goal: { type: 'defend', targetPlanetId: 1, targetSystemId: 'sys1' } as DefendGoal,
      targetSystemId: 'sys1',
      targetPlanetId: 1,
      reason: 'Enemy fleet is at the threatened system',
      ...overrides,
    });

    const createEnemyFleet = (overrides: Partial<Fleet> = {}): Fleet => ({
      id: 3,
      name: 'RAIDER',
      factionId: 'enemy1',
      x: 10,
      y: 10,
      targetX: null,
      targetY: null,
      speed: 5,
      system: null,
      gridCol: 1,
      gridRow: 1,
      ships: [{ id: 10, name: 'Destroyer', type: 'destroyer', currentHp: 20, destroyed: false }],
      destroyed: false,
      sensorRange: 3,
      ...overrides,
    });

    it('should return true when AI fleet is at the threatened system', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(true);
    });

    it('should not execute when the target system does not exist', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const action = makeDefendAction({ targetSystemId: 'nonexistent' });

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when no AI fleet is at the system position', () => {
      const fleets: Fleet[] = [createEnemyFleet({ x: 1, y: 1 })];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when the AI fleet is destroyed', () => {
      const fleets: Fleet[] = [createEnemyFleet({ destroyed: true })];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not execute when the AI fleet has no living ships', () => {
      const fleets: Fleet[] = [
        createEnemyFleet({
          ships: [{ id: 10, name: 'Scout', type: 'scout', destroyed: true }],
        }),
      ];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });

    it('should not modify player fleets', () => {
      const fleets: Fleet[] = [
        createEnemyFleet(),
        createEnemyFleet({ id: 5, factionId: 'player', name: 'ORION', x: 10, y: 10 }),
      ];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction();

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(true);
      expect(fleets[1].factionId).toBe('player');
    });

    it('should not execute defend for the player faction', () => {
      const fleets: Fleet[] = [createEnemyFleet()];
      const systems = [createSystem({ id: 'sys1', x: 10, y: 10, planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1' })] })];
      const action = makeDefendAction({ factionId: 'player' });

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, fleets);

      expect(result).toBe(false);
    });
  });

  describe('develop execution', () => {
    const makeDevelopAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
      type: 'develop',
      factionId: 'enemy1',
      goalType: 'develop',
      goal: { type: 'develop' } as DevelopGoal,
      reason: 'Develop goal is always executable',
      ...overrides,
    });

    const createOwnedPlanet = (overrides: Partial<StarSystem['planetsTiles'][0]> = {}): StarSystem['planetsTiles'][0] =>
      createPlanet({ factionId: 'enemy1', ...overrides });

    it('should build a power building when energy is short', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'], currencies: { ...f.currencies } }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 5,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
      expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Fusion Power Plant');
      expect(factions.find((f) => f.id === 'enemy1')!.currencies['credits']).toBe(100);
    });

    it('should build a residential building when workforce is short', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_science'], currencies: { ...f.currencies } }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 10,
        energyConsumption: 10,
        workforceAvailable: 5,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
      expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Small Residential Block');
    });

    it('should build an industry building when raw materials are needed', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_industry'], currencies: { ...f.currencies } }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 10,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 5 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createOwnedPlanet({
              id: 1,
              size: 'medium',
              buildings: [],
              resourceTiles: [{ type: 'rawmaterial', x: 0, y: 3 }],
            }),
          ],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
      expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Spaceship Factory');
    });

    it('should build a research building as fallback', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_science'], currencies: { ...f.currencies } }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 10,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(true);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(1);
      expect(systems[0].planetsTiles[0].buildings[0].name).toBe('Small Research Laboratory');
    });

    it('should not build when the building is not researched', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering'], currencies: { ...f.currencies } }
          : f,
      );
      (researchService.isBuildingUnlocked as any).mockReturnValue(false);
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 5,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(0);
    });

    it('should not build when the faction lacks credits', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'], currencies: { credits: 10 } }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 5,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(systems[0].planetsTiles[0].buildings).toHaveLength(0);
    });

    it('should not build when no valid placement exists', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'] }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 5,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const buildings: PlanetBuilding[] = [];
      const gridSize = (PLANET_SIZE_MAP['medium'] ?? 3) * 2 + 3;
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          buildings.push({ name: 'Laser Turret', size: 1, x, y, type: 'turret' });
        }
      }
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
    });

    it('should not build on a planet owned by another faction', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1'
          ? { ...f, researchedTechnologies: ['basic_engineering', 'basic_power'] }
          : f,
      );
      (economyService.calculatePlanetEconomy as any).mockReturnValue({
        energyProduction: 5,
        energyConsumption: 10,
        workforceAvailable: 20,
        workforceRequired: 20,
        production: { rawmaterials: 10 },
      });
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'player', size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
    });

    it('should not execute develop for the player faction', () => {
      const factions = baseFactions;
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createOwnedPlanet({ id: 1, size: 'medium', buildings: [] })],
        }),
      ];
      const action = makeDevelopAction({ factionId: 'player' });

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
    });
  });
});

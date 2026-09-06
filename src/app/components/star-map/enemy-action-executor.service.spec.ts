import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EnemyActionExecutor } from './enemy-action-executor.service';
import { Faction, StarSystem, ActionResult, ColonizeGoal, FactionProduction, FactionShipStock, Fleet } from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ResearchService } from '../../services/research.service';

describe('EnemyActionExecutor', () => {
  let service: EnemyActionExecutor;
  let productionService: any;
  let shipService: any;
  let researchService: any;

  beforeEach(() => {
    productionService = {
      queueOrder: vi.fn(() => ({ ok: true, order: { id: 1, shipTypeId: 'colonizer', quantity: 1, progress: 0, startedAtTick: 0 } })),
      getPlanetCapacity: vi.fn(() => 1),
    };
    shipService = {
      getShipType: vi.fn(() => ({ id: 'colonizer', name: 'Colonizer', cost: 100 })),
    };
    researchService = {
      isResearched: vi.fn(() => true),
      isShipUnlocked: vi.fn(() => true),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: ProductionService, useValue: productionService },
        { provide: ShipService, useValue: shipService },
        { provide: ResearchService, useValue: researchService },
      ],
    });

    service = TestBed.inject(EnemyActionExecutor);
  });

  afterEach(() => {
    service.reset();
    vi.clearAllMocks();
  });

  const createFaction = (overrides: Partial<Faction> = {}): Faction => ({
    id: 'enemy1',
    name: 'Enemy 1',
    color: '#d65757',
    team: 2,
    currencies: { credits: 200 },
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

  const makeAction = (overrides: Partial<ActionResult> = {}): ActionResult => ({
    type: 'produce_colonizer',
    factionId: 'enemy1',
    goalType: 'colonize',
    goal: { type: 'colonize', targetPlanetId: 1, targetSystemId: 'sys1' } as ColonizeGoal,
    reason: 'No colonizer available but production is possible',
    ...overrides,
  });

  const baseFactions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] },
    { id: 'enemy2', name: 'Enemy 2', color: '#39b8a8', team: 2, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] },
  ];

  const emptyProduction: FactionProduction[] = [];
  const emptyShipStock: FactionShipStock[] = [];
  const emptyFleets: Fleet[] = [];

  describe('produce_colonizer execution', () => {
    it('should start colonizer production when action is produce_colonizer and conditions are met', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];
      const action = makeAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

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
        f.id === 'enemy1' ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [
        createSystem({
          id: 'sys2',
          planetsTiles: [createPlanet({ id: 3, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 2, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];
      const action = makeAction();

      const result = service.tick(2, action, factions, systems, emptyProduction, emptyShipStock, emptyFleets);

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

      const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute for independent faction', () => {
      const action = makeAction({ factionId: 'independent' });
      const factions = baseFactions;

      const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when colonizer is locked', () => {
      (researchService.isShipUnlocked as any).mockReturnValue(false);
      const action = makeAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction lacks basic_engineering', () => {
      (researchService.isResearched as any).mockReturnValue(false);
      const action = makeAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction has insufficient credits', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, currencies: { credits: 10 } } : f,
      );
      const action = makeAction();

      const result = service.tick(2, action, factions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when no planet has factory capacity', () => {
      (productionService.getPlanetCapacity as any).mockReturnValue(0);
      const action = makeAction();

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when faction does not exist', () => {
      const action = makeAction({ factionId: 'nonexistent' });

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when action type is not produce_colonizer', () => {
      const action = makeAction({ type: 'none' });

      const result = service.tick(2, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when gameDeltaTime is 0 (paused)', () => {
      const action = makeAction();

      const result = service.tick(0, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when gameDeltaTime is negative', () => {
      const action = makeAction();

      const result = service.tick(-1, action, baseFactions, [], emptyProduction, emptyShipStock, emptyFleets);

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

      const result = service.tick(2, action, baseFactions, [], existingProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(false);
      expect(productionService.queueOrder).not.toHaveBeenCalled();
    });

    it('should not execute when queueOrder returns failure', () => {
      (productionService.queueOrder as any).mockReturnValue({ ok: false, reason: 'insufficient_resources' });
      const action = makeAction();
      const systems = [
        createSystem({
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];

      const result = service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);

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
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];

      const result = service.tick(2, action, baseFactions, systems, playerProduction, emptyShipStock, emptyFleets);

      expect(result).toBe(true);
      expect(playerProduction[0].ordersByPlanet[1]).toHaveLength(1);
      expect(playerProduction[0].ordersByPlanet[1][0].shipTypeId).toBe('scout');
    });

    it('should log execution success', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] })],
        }),
      ];
      const action = makeAction();

      service.tick(2, action, baseFactions, systems, emptyProduction, emptyShipStock, emptyFleets);

      expect(logSpy).toHaveBeenCalledWith('[Enemy AI] enemy1 executed produce_colonizer at planet Planet');
      logSpy.mockRestore();
    });
  });

  describe('planet selection', () => {
    it('should pick the first planet with factory capacity across multiple systems', () => {
      const factions = baseFactions.map((f) =>
        f.id === 'enemy1' ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [
        createSystem({
          id: 'sys10',
          planetsTiles: [
            createPlanet({ id: 5, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] }),
          ],
        }),
        createSystem({
          id: 'sys2',
          planetsTiles: [
            createPlanet({ id: 2, factionId: 'enemy1', buildings: [] }),
            createPlanet({ id: 3, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] }),
          ],
        }),
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({ id: 1, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] }),
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
        f.id === 'enemy1' ? { ...f, currencies: { credits: 200 }, researchedTechnologies: ['basic_engineering'] } : f,
      );
      const systems = [
        createSystem({
          id: 'sys1',
          planetsTiles: [
            createPlanet({ id: 1, factionId: 'player', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] }),
            createPlanet({ id: 2, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] }),
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
});

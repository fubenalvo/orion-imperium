import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { EnemyActionService } from './enemy-action.service';
import { EnemyAiService } from './enemy-ai.service';
import { EnemyStrategyService } from './enemy-strategy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyCapabilityService } from './enemy-capability.service';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { ProductionService } from '../../services/production.service';
import { EconomyService } from '../../services/economy.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';
import { BattleService } from '../../services/battle.service';
import type { BattleOutcome } from '../../services/battle.service';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';

describe('StarMap', () => {
  let component: StarMap;
  let fixture: ComponentFixture<StarMap>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [
        {
          provide: StarMapGameLoopService,
          useValue: {
            startGameLoop: vi.fn(),
            stopGameLoop: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StarMap);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('serializes the current save format version', () => {
    const data = component['serializeGameState']();
    expect(data.saveVersion).toBe(SAVE_VERSION);
  });

  describe('EnemyActionService integration', () => {
    let actionService: EnemyActionService;
    let strategyService: EnemyStrategyService;
    let goalService: EnemyGoalService;
    let capabilityService: EnemyCapabilityService;
    let aiService: EnemyAiService;
    let productionService: ProductionService;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      actionService = TestBed.inject(EnemyActionService);
      strategyService = TestBed.inject(EnemyStrategyService);
      goalService = TestBed.inject(EnemyGoalService);
      capabilityService = TestBed.inject(EnemyCapabilityService);
      aiService = TestBed.inject(EnemyAiService);

      aiService.reset();
      strategyService.reset();
      goalService.reset();
      capabilityService.reset();
      actionService.reset();

      // Prevent V3 EnemyAiService from modifying fleet positions between
      // partial-delta calls so the game state stays stable.
      vi.spyOn(aiService, 'tick').mockReturnValue(false);
      // Prevent production and economy from mutating the game state between ticks.
      productionService = TestBed.inject(ProductionService);
      vi.spyOn(productionService, 'tick').mockReturnValue({
        completedOrders: [], producedShips: [], refundedOrders: [], stateChanged: false,
      });
      const economyService = TestBed.inject(EconomyService);
      vi.spyOn(economyService, 'applyEconomyDelta').mockImplementation(() => ({}) as never);
      vi.spyOn(economyService, 'calculateEconomy').mockImplementation(() => ({}) as never);
      // Suppress verbose AI console output and prevent Angular CD.
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(component['ngZone'], 'run').mockImplementation((fn: () => void) => fn());
      vi.spyOn(component['cdr'], 'detectChanges').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('should inject EnemyActionService', () => {
      expect(actionService).toBeTruthy();
    });

    it('should produce ActionResult after 2s of game time', () => {
      component['gameLoopCallback'](2);
      expect(actionService.getAction('enemy1')).toBeDefined();
      expect(actionService.getAction('enemy2')).toBeDefined();
    });

    it('should not fire action before 2s of game time', () => {
      component['gameLoopCallback'](1);
      expect(actionService.getAction('enemy1')).toBeUndefined();
      expect(actionService.getAction('enemy2')).toBeUndefined();
    });

    it('should not fire action when paused (deltaTime=0)', () => {
      component['gameLoopCallback'](1);
      expect(actionService.getAction('enemy1')).toBeUndefined();

      component['gameLoopCallback'](0);
      component['gameLoopCallback'](0);
      expect(actionService.getAction('enemy1')).toBeUndefined();
    });

    it('should not change action during pause after evaluation', () => {
      component['gameLoopCallback'](2);
      const actionBefore = actionService.getAction('enemy1');

      component['gameLoopCallback'](0);
      component['gameLoopCallback'](0);

      const actionAfter = actionService.getAction('enemy1');
      expect(actionAfter).toEqual(actionBefore);
    });

    it('should fire on a single 2s delta (2x speed: 1 real second feeds 2 game seconds)', () => {
      component['gameLoopCallback'](2);
      expect(actionService.getAction('enemy1')).toBeDefined();
      expect(actionService.getAction('enemy2')).toBeDefined();
    });

    it('should give enemy1 and enemy2 independent ActionResults', () => {
      component['gameLoopCallback'](2);

      const action1 = actionService.getAction('enemy1');
      const action2 = actionService.getAction('enemy2');

      expect(action1).toBeDefined();
      expect(action2).toBeDefined();
      expect(action1!.factionId).toBe('enemy1');
      expect(action2!.factionId).toBe('enemy2');
    });

    it('should clear actions on reset', () => {
      component['gameLoopCallback'](2);
      expect(actionService.getAction('enemy1')).toBeDefined();
      expect(actionService.getAction('enemy2')).toBeDefined();

      actionService.reset();
      expect(actionService.getAction('enemy1')).toBeUndefined();
      expect(actionService.getAction('enemy2')).toBeUndefined();
    });

    it('should not mutate game state during paused ticks', () => {
      const fleetsBefore = JSON.stringify(component.fleets);
      const factionsBefore = JSON.stringify(component.factions);

      component['gameLoopCallback'](0);

      expect(JSON.stringify(component.fleets)).toBe(fleetsBefore);
      expect(JSON.stringify(component.factions)).toBe(factionsBefore);
    });

    it('should run ActionService after Strategy → Goal → Capability in game loop', () => {
      component['gameLoopCallback'](2);

      expect(strategyService.getStrategy('enemy1')).toBeDefined();
      expect(goalService.getGoal('enemy1')).toBeDefined();
      expect(capabilityService.getCapability('enemy1')).toBeDefined();
      expect(actionService.getAction('enemy1')).toBeDefined();

      expect(strategyService.getStrategy('enemy2')).toBeDefined();
      expect(goalService.getGoal('enemy2')).toBeDefined();
      expect(capabilityService.getCapability('enemy2')).toBeDefined();
      expect(actionService.getAction('enemy2')).toBeDefined();
    });

    it('should reset EnemyActionService alongside other AI services on loadGame', () => {
      const saveGameService = TestBed.inject(SaveGameService);

      component['gameLoopCallback'](2);
      expect(actionService.getAction('enemy1')).toBeDefined();

      component['saveGame']();
      saveGameService.currentSlot = SaveSlotId.AUTOSAVE;

      component.loadGame();

      expect(actionService.getAction('enemy1')).toBeUndefined();
      expect(actionService.getAction('enemy2')).toBeUndefined();
    });

    it('should not log AI action changes', () => {
      const logCalls: string[] = [];
      logSpy.mockImplementation((msg: unknown) => {
        if (typeof msg === 'string' && msg.includes('[Enemy AI]')) {
          logCalls.push(msg);
        }
      });

      component['gameLoopCallback'](2);
      expect(logCalls.length).toBe(0);

      component['gameLoopCallback'](2);
      expect(logCalls.length).toBe(0);
    });

    it('should execute produce_colonizer through the full AI pipeline', () => {
      component.factions = component.factions.map((f) => {
        if (f.id === 'enemy1') {
          return { ...f, currencies: { credits: 1000 }, researchedTechnologies: ['basic_engineering'] };
        }
        return f;
      });

      component.starSystems = component.starSystems.map((s) => {
        if (s.id === 'sol') {
          return {
            ...s,
            planetsTiles: s.planetsTiles.map((p) => {
              if (p.id === 1) {
                return { ...p, factionId: 'enemy1', buildings: [{ name: 'Spaceship Factory', size: 1, x: 0, y: 0 }] };
              }
              return p;
            }),
          };
        }
        return s;
      });

      const queueOrderSpy = vi.spyOn(productionService, 'queueOrder');

      component['gameLoopCallback'](2);

      expect(queueOrderSpy).toHaveBeenCalledWith(
        { production: component.production },
        'enemy1',
        1,
        'colonizer',
        1,
        component.starSystems,
        component.factions,
      );
      expect(component.production.length).toBeGreaterThan(0);
      expect(component.production[0].ordersByPlanet[1]).toBeDefined();
      expect(component.production[0].ordersByPlanet[1][0].shipTypeId).toBe('colonizer');
    });

    it('should execute assemble_fleet through the full AI pipeline', () => {
      component.factions = component.factions.map((f) => {
        if (f.id === 'enemy1') {
          return { ...f, currencies: { credits: 1000 }, researchedTechnologies: ['basic_engineering'] };
        }
        return f;
      });

      component.starSystems = component.starSystems.map((s) => {
        if (s.id === 'sol') {
          return {
            ...s,
            planetsTiles: s.planetsTiles.map((p) => {
              if (p.id === 1) {
                return { ...p, factionId: 'enemy1', buildings: [{ name: 'Spaceport', size: 1, x: 0, y: 0 }] };
              }
              return p;
            }),
          };
        }
        return s;
      });

      component.shipStock = [
        { factionId: 'enemy1', ships: [{ id: 5001, type: 'colonizer', name: 'Colonizer' }] },
      ];

      const ownedBefore = component.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === 'enemy1').length;
      component['gameLoopCallback'](2);

      expect(actionService.getAction('enemy1')?.type).toBe('assemble_fleet');

      // RAIDER is not at the Spaceport, so the colonizer must not teleport
      // into it: a new enemy1 fleet is created at the Spaceport system.
      const sol = component.starSystems.find((s) => s.id === 'sol')!;
      const raider = component.fleets.find((f: any) => f.id === 3);
      expect(raider).toBeDefined();
      expect(raider!.ships.some((s: any) => s.type === 'colonizer')).toBe(false);
      const carrier = component.fleets.find(
        (f: any) => f.factionId === 'enemy1' && f.ships.some((s: any) => s.type === 'colonizer' && s.id === 5001),
      );
      expect(carrier).toBeDefined();
      expect(carrier!.x).toBe(sol.x);
      expect(carrier!.y).toBe(sol.y);

      const enemyStock = component.shipStock.find((s) => s.factionId === 'enemy1');
      expect(enemyStock?.ships.filter((s: any) => s.type === 'colonizer') ?? []).toHaveLength(0);

      component['gameLoopCallback'](2);
      const colonizers = component.fleets
        .filter((f: any) => f.factionId === 'enemy1')
        .flatMap((f: any) => f.ships)
        .filter((s: any) => s.type === 'colonizer');
      // The colonizer is never duplicated: it is either still in a fleet or
      // was spent on exactly one new colony (the target may be in sol itself).
      const newColonies =
        component.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === 'enemy1').length - ownedBefore;
      expect(colonizers.length + newColonies).toBe(1);
    });
  });

  describe('Battle return session state', () => {
    let saveGameService: SaveGameService;

    beforeEach(() => {
      saveGameService = TestBed.inject(SaveGameService);
      saveGameService.currentSlot = null;
      localStorage.clear();
    });

    // A stale manual snapshot with every fleet alive — the trap that the old
    // code fell into when it read currentSlot instead of autosave.
    const seedStaleManualSnapshot = (): void => {
      saveGameService.saveToSlot(1, {
        factions: component.factions,
        map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
        starSystems: component.starSystems,
        fleets: component.fleets.map((f) => ({ ...f, destroyed: false })),
        currentView: 'map',
        cameraX: 0,
        cameraY: 0,
        selectedSystemId: null,
        selectedFleetId: null,
        selectedPlanetTileId: null,
        selectedFleetAction: null,
        targetX: null,
        targetY: null,
        destroyedFleetId: null,
        exploredGridCells: [],
        shipStock: component.shipStock,
        production: component.production,
      });
    };

    /*
     * Regression: a fleet destroyed in an earlier battle must not be
     * resurrected after a later battle returns to the map. During gameplay
     * the active session is always backed by the autosave slot, so
     * reloadAfterBattle reads the cumulative destructions from autosave even
     * when a stale manual snapshot exists alongside it.
     */
    it('should keep earlier fleet destructions after reloadAfterBattle', () => {
      component.fleets.find((f) => f.id === 1)!.destroyed = true;

      // Autosave holds the live session state (ORION destroyed).
      component['saveGame']();
      saveGameService.currentSlot = SaveSlotId.AUTOSAVE;
      seedStaleManualSnapshot();

      // Return from battle: reloadAfterBattle must keep ORION destroyed.
      component['reloadAfterBattle']();
      expect(component.fleets.find((f) => f.id === 1)!.destroyed).toBe(true);
      expect(component.fleets.find((f) => f.id === 2)!.destroyed).toBe(false);

      // Second battle: PEGASUS destroyed too. Cumulative destructions must
      // survive another reload cycle.
      component.fleets.find((f) => f.id === 2)!.destroyed = true;
      component['saveGame']();
      component['reloadAfterBattle']();

      expect(component.fleets.find((f) => f.id === 1)!.destroyed).toBe(true);
      expect(component.fleets.find((f) => f.id === 2)!.destroyed).toBe(true);
    });

    it('should keep planet ownership changes after a later battle reload', () => {
      const sol = component.starSystems.find((s) => s.id === 'sol')!;
      sol.planetsTiles.find((p) => p.id === 1)!.factionId = 'enemy1';

      // Autosave holds the live session state (planet captured).
      component['saveGame']();
      saveGameService.currentSlot = SaveSlotId.AUTOSAVE;

      component['reloadAfterBattle']();

      const earth = component.starSystems
        .find((s) => s.id === 'sol')!
        .planetsTiles.find((p) => p.id === 1)!;
      expect(earth.factionId).toBe('enemy1');
    });

    it('should seed autosave from a manual pause-menu load and switch currentSlot to 0', () => {
      seedStaleManualSnapshot();

      // Pause-menu load: activation seeds autosave and switches to slot 0,
      // so all subsequent runtime saves and battle results accumulate there.
      component.loadFromMenu(1);

      expect(saveGameService.currentSlot).toBe(SaveSlotId.AUTOSAVE);
      expect(component.fleets.find((f) => f.id === 1)!.destroyed).toBe(false);

       // A new destruction now lands in autosave and survives a reload.
      component.fleets.find((f) => f.id === 1)!.destroyed = true;
      component['saveGame']();
      component.loadGame();
      expect(component.fleets.find((f) => f.id === 1)!.destroyed).toBe(true);
    });
  });

  describe('Battle return survivor roster application', () => {
    let saveGameService: SaveGameService;
    let battleService: BattleService;

    beforeEach(() => {
      saveGameService = TestBed.inject(SaveGameService);
      battleService = TestBed.inject(BattleService);
      saveGameService.currentSlot = null;
      localStorage.clear();
    });

    it('writes surviving-ship HP and the wiped-out loser from the battle result', () => {
      saveGameService.currentSlot = SaveSlotId.AUTOSAVE;
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      const raider = component.fleets.find((f) => f.id === 2)!;
      const originalShipId = orion.ships[0].id;

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 1,
        loserFleetId: 2,
        attacker: {
          fleetId: 1,
          side: 'attacker',
          factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id,
            typeId: s.type,
            name: s.name,
            hp: 1,
            destroyed: false,
          })),
          survivors: [],
          wipedOut: false,
        },
        defender: {
          fleetId: 2,
          side: 'defender',
          factionId: raider.factionId,
          ships: raider.ships.map((s) => ({
            shipId: s.id,
            typeId: s.type,
            name: s.name,
            hp: 0,
            destroyed: true,
          })),
          survivors: [],
          wipedOut: true,
        },
        rounds: 2,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);

      component['removeDestroyedFleetFromService']();

      const updatedOrion = component.fleets.find((f) => f.id === 1)!;
      const updatedRaider = component.fleets.find((f) => f.id === 2)!;
      expect(updatedOrion.ships.find((s) => s.id === originalShipId)!.currentHp).toBe(1);
      expect(updatedRaider.destroyed).toBe(true);
      expect(updatedRaider.ships.every((s) => s.destroyed)).toBe(true);
      expect(battleService.getBattleResult()).toBeNull();
    });
  });

  describe('Battle return — fleet position update', () => {
    let saveGameService: SaveGameService;
    let battleService: BattleService;

    beforeEach(() => {
      saveGameService = TestBed.inject(SaveGameService);
      battleService = TestBed.inject(BattleService);
      saveGameService.currentSlot = SaveSlotId.AUTOSAVE;
      localStorage.clear();
    });

    it('snaps winner position to grid cell and clears movement targets', () => {
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      const raider = component.fleets.find((f) => f.id === 3)!;
      // Reset to known state — prior tests may have mutated initialStarMapData.
      orion.destroyed = false;
      orion.x = 18.7;
      orion.y = 42.3;
      orion.targetX = 25;
      orion.targetY = 40;
      raider.destroyed = false;
      raider.x = 18.5;
      raider.y = 42.1;

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 1,
        loserFleetId: 3,
        attacker: {
          fleetId: 1, side: 'attacker', factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          survivors: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          wipedOut: false,
        },
        defender: {
          fleetId: 3, side: 'defender', factionId: raider.factionId,
          ships: raider.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 0, destroyed: true,
          })),
          survivors: [],
          wipedOut: true,
        },
        rounds: 3,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);
      component['removeDestroyedFleetFromService']();

      const updatedOrion = component.fleets.find((f) => f.id === 1)!;
      const updatedRaider = component.fleets.find((f) => f.id === 3)!;

      expect(updatedOrion.x).toBe(18);
      expect(updatedOrion.y).toBe(42);
      expect(updatedOrion.targetX).toBeNull();
      expect(updatedOrion.targetY).toBeNull();
      expect(updatedOrion.destroyed).toBe(false);
      expect(updatedRaider.destroyed).toBe(true);
    });

    it('marks fleet destroyed when wiped out', () => {
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      const outcome: BattleOutcome = {
        winnerSide: 'defender',
        winnerFleetId: 2,
        loserFleetId: 1,
        attacker: {
          fleetId: 1, side: 'attacker', factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 0, destroyed: true,
          })),
          survivors: [],
          wipedOut: true,
        },
        defender: {
          fleetId: 2, side: 'defender', factionId: 'enemy1',
          ships: [],
          survivors: [],
          wipedOut: false,
        },
        rounds: 1,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);
      component['removeDestroyedFleetFromService']();

      const updatedOrion = component.fleets.find((f) => f.id === 1)!;
      expect(updatedOrion.destroyed).toBe(true);
    });

    it('preserves damaged survivor HP after battle', () => {
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      const raider = component.fleets.find((f) => f.id === 3)!;
      orion.destroyed = false;
      raider.destroyed = false;
      const originalShipId = orion.ships[0].id;

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 1,
        loserFleetId: 3,
        attacker: {
          fleetId: 1, side: 'attacker', factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 37, destroyed: false,
          })),
          survivors: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 37, destroyed: false,
          })),
          wipedOut: false,
        },
        defender: {
          fleetId: 3, side: 'defender', factionId: raider.factionId,
          ships: raider.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 0, destroyed: true,
          })),
          survivors: [],
          wipedOut: true,
        },
        rounds: 2,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);
      component['removeDestroyedFleetFromService']();

      const updatedOrion = component.fleets.find((f) => f.id === 1)!;
      expect(updatedOrion.ships.find((s) => s.id === originalShipId)!.currentHp).toBe(37);
    });

    it('does not resurrect destroyed ships after save/load', () => {
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      const raider = component.fleets.find((f) => f.id === 3)!;

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 1,
        loserFleetId: 3,
        attacker: {
          fleetId: 1, side: 'attacker', factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          survivors: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          wipedOut: false,
        },
        defender: {
          fleetId: 3, side: 'defender', factionId: raider.factionId,
          ships: raider.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: 0, destroyed: true,
          })),
          survivors: [],
          wipedOut: true,
        },
        rounds: 1,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);
      component['removeDestroyedFleetFromService']();
      component['saveGame']();
      component.loadGame();

      const updatedRaider = component.fleets.find((f) => f.id === 3)!;
      expect(updatedRaider.destroyed).toBe(true);
      expect(updatedRaider.ships.every((s) => s.destroyed)).toBe(true);
    });

    it('snaps position for planet battle winner too', () => {
      component['saveGame']();

      const orion = component.fleets.find((f) => f.id === 1)!;
      orion.destroyed = false;
      orion.x = 18.7;
      orion.y = 42.3;
      orion.targetX = 25;
      orion.targetY = 40;

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 1,
        loserFleetId: -1,
        attacker: {
          fleetId: 1, side: 'attacker', factionId: orion.factionId,
          ships: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          survivors: orion.ships.map((s) => ({
            shipId: s.id, typeId: s.type, name: s.name,
            hp: s.currentHp ?? 100, destroyed: false,
          })),
          wipedOut: false,
        },
        defender: {
          fleetId: -1, side: 'defender', factionId: 'enemy1',
          ships: [],
          survivors: [],
          wipedOut: true,
        },
        rounds: 2,
        battleType: 'planet',
        planetId: 1,
      };
      battleService.setBattleResult(outcome);
      component['removeDestroyedFleetFromService']();

      const updatedOrion = component.fleets.find((f) => f.id === 1)!;
      expect(updatedOrion.x).toBe(18);
      expect(updatedOrion.y).toBe(42);
      expect(updatedOrion.targetX).toBeNull();
      expect(updatedOrion.targetY).toBeNull();
      expect(updatedOrion.destroyed).toBe(false);
    });

    it('handles empty or invalid fleet IDs without throwing', () => {
      component['saveGame']();

      const outcome: BattleOutcome = {
        winnerSide: 'attacker',
        winnerFleetId: 99999,
        loserFleetId: 99998,
        attacker: {
          fleetId: 99999, side: 'attacker', factionId: 'player',
          ships: [], survivors: [], wipedOut: false,
        },
        defender: {
          fleetId: 99998, side: 'defender', factionId: 'enemy1',
          ships: [], survivors: [], wipedOut: false,
        },
        rounds: 1,
        battleType: 'fleet',
      };
      battleService.setBattleResult(outcome);
      expect(() => component['removeDestroyedFleetFromService']()).not.toThrow();
    });
  });

  describe('Galaxy camera focus and zoom', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;

    function setWindowSize(width: number, height: number): void {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    }

    /** Screen position (in vw, relative to the viewport) of a grid position. */
    function screenPosOf(gridX: number, gridY: number): { x: number; y: number } {
      return {
        x: ((gridX - 0.5) * component.cellSizeVw - component.cameraX) * component.zoom,
        y: ((gridY - 0.5) * component.cellSizeVh - component.cameraY) * component.zoom,
      };
    }

    function wheel(deltaY: number, clientX = 0, clientY = 0): WheelEvent {
      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
      const event = new WheelEvent('wheel', { deltaY, clientX, clientY, cancelable: true });
      Object.defineProperty(event, 'currentTarget', { value: target });
      return event;
    }

    function stepZoom(deltaY: number, clientX = 0, clientY = 0): WheelEvent {
      // Bypass the burst cooldown so each call is treated as a new gesture.
      component['lastZoomStepAt'] = -Infinity;
      const event = wheel(deltaY, clientX, clientY);
      component.onMapWheel(event);
      return event;
    }

    beforeEach(() => {
      component.currentView = 'map';
      // Large-galaxy size, so the map is wider than the viewport at every
      // zoom level and focusing is not limited by edge clamping.
      component.mapWidth = 300;
      component.mapHeight = 180;
      component.onResize();
    });

    afterEach(() => {
      setWindowSize(originalWidth, originalHeight);
    });

    // 21:9, 16:9 and a landscape phone; the fleet must land on the exact
    // viewport center for every aspect ratio and zoom level.
    for (const [label, width, height] of [
      ['21:9', 3440, 1440],
      ['16:9', 1920, 1080],
      ['mobile landscape', 844, 390],
    ] as const) {
      it(`centers the selected fleet on the viewport center (${label})`, () => {
        setWindowSize(width, height);
        component.onResize();
        const fleet = component.fleets[0];
        fleet.x = Math.round(component.movementService.gridColumns / 2);
        fleet.y = Math.round(component.movementService.gridRows / 2);

        for (let i = 0; i < component.zoomLevels.length; i++) {
          component.setZoomIndex(i);
          component.selectFleet(fleet);
          const pos = screenPosOf(fleet.x, fleet.y);
          expect(pos.x).toBeCloseTo(50, 6);
          expect(pos.y).toBeCloseTo(component.viewportHeightVw / 2, 6);
        }
      });
    }

    it('centers a map smaller than the visible area instead of pinning it to a corner', () => {
      setWindowSize(1920, 1080);
      component.mapWidth = 100;
      component.mapHeight = 60;
      component.onResize();
      component.setZoomIndex(component.zoomLevels.length - 1);
      component.setCamera({ x: 0, y: 0 });
      const gridW = component.movementService.gridColumns * component.cellSizeVw;
      expect(gridW).toBeLessThan(component.visibleWidthVw);
      expect(component.cameraX).toBeCloseTo((gridW - component.visibleWidthVw) / 2, 6);
    });

    it('does not change the zoom level when focusing a fleet', () => {
      component.setZoomIndex(2);
      component.selectFleet(component.fleets[0]);
      expect(component.zoomIndex).toBe(2);
    });

    it('zooms out exactly three steps with the wheel and stops at the limit', () => {
      expect(component.zoom).toBe(1);
      const zooms: number[] = [];
      for (let i = 0; i < 5; i++) {
        stepZoom(100);
        zooms.push(component.zoom);
      }
      expect(component.zoomLevels).toHaveLength(4);
      expect(zooms).toEqual([0.75, 0.5, 0.35, 0.35, 0.35]);
    });

    it('zooms back in and never past the original level', () => {
      component.setZoomIndex(3);
      for (let i = 0; i < 5; i++) {
        stepZoom(-100);
      }
      expect(component.zoom).toBe(1);
    });

    it('prevents the page from scrolling on wheel', () => {
      const event = stepZoom(100);
      expect(event.defaultPrevented).toBe(true);
    });

    it('applies at most one zoom step per wheel burst', () => {
      component['lastZoomStepAt'] = -Infinity;
      component.onMapWheel(wheel(100));
      component.onMapWheel(wheel(100));
      component.onMapWheel(wheel(100));
      expect(component.zoomIndex).toBe(1);
    });

    it('keeps the world point under the cursor fixed while zooming', () => {
      setWindowSize(1920, 1080);
      component.onResize();
      component.setCamera({ x: 200, y: 120 });
      const cursorPx = { x: 700, y: 400 };
      const vwPx = window.innerWidth / 100;
      const worldBefore = {
        x: component.cameraX + cursorPx.x / vwPx / component.zoom,
        y: component.cameraY + cursorPx.y / vwPx / component.zoom,
      };

      stepZoom(100, cursorPx.x, cursorPx.y);

      expect(component.zoom).toBe(0.75);
      expect(component.cameraX + cursorPx.x / vwPx / component.zoom).toBeCloseTo(worldBefore.x, 6);
      expect(component.cameraY + cursorPx.y / vwPx / component.zoom).toBeCloseTo(worldBefore.y, 6);
    });

    it('keeps the camera inside the map at every zoom level', () => {
      setWindowSize(1920, 1080);
      component.onResize();
      const gridW = component.movementService.gridColumns * component.cellSizeVw;
      const gridH = component.movementService.gridRows * component.cellSizeVh;

      for (let i = 0; i < component.zoomLevels.length; i++) {
        component.setZoomIndex(i);
        component.setCamera({ x: 1e6, y: 1e6 });
        if (gridW > component.visibleWidthVw) {
          expect(component.cameraX + component.visibleWidthVw).toBeCloseTo(gridW, 6);
        }
        if (gridH > component.visibleHeightVw) {
          expect(component.cameraY + component.visibleHeightVw).toBeCloseTo(gridH, 6);
        }
        component.setCamera({ x: -1e6, y: -1e6 });
        expect(component.cameraX).toBeLessThanOrEqual(0.000001);
        expect(component.cameraY).toBeLessThanOrEqual(0.000001);
      }
    });

    it('converts map clicks to world coordinates using the zoom', () => {
      setWindowSize(1920, 1080);
      component.onResize();
      component.setZoomIndex(2);
      component.setCamera({ x: 100, y: 60 });
      const fleet = component.fleets.find((f) => f.factionId === 'player') ?? component.fleets[0];
      component.selectedFleet = fleet;
      component.selectedFleetAction = 'move';
      const moveSpy = vi.spyOn(component, 'moveSelectedFleet' as any).mockImplementation(() => {});

      const vwPx = window.innerWidth / 100;
      const target = document.createElement('div');
      target.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
      const event = new MouseEvent('click', { clientX: 10 * vwPx, clientY: 5 * vwPx });
      Object.defineProperty(event, 'currentTarget', { value: target });
      component.onMapClick(event);

      // Screen (10vw, 5vw) at zoom 0.5 is world (100 + 20, 60 + 10).
      const expected = component.movementService.getTileCenter(120, 70);
      expect(moveSpy).toHaveBeenCalledWith(expected.x, expected.y);
    });
  });

  describe('AI planet capture integration', () => {
    // Minimal valid game: the player owns one planet and one fleet, enemy1 owns one planet.
    beforeEach(() => {
      component.factions = [
        { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: { credits: 0 } },
        { id: 'enemy1', name: 'Enemy', color: '#d65757', team: 2, ai: true, currencies: { credits: 0 } },
      ];
      const planet = (id: number, factionId: string) => ({
        id, index: 0, name: `P${id}`, factionId, x: 12, y: 3, type: 'earthlike' as const, size: 'medium' as const,
        population: 500, buildings: [], explored: true,
      });
      component.starSystems = [
        { id: 'a', name: 'A', x: 10, y: 10, planets: 1, color: '#fff', planetsTiles: [planet(1, 'player')] },
        { id: 'b', name: 'B', x: 40, y: 10, planets: 1, color: '#fff', planetsTiles: [planet(2, 'enemy1')] },
      ];
      component.fleets = [
        { id: 1, name: 'ORION', factionId: 'player', x: 10, y: 10, targetX: null, targetY: null, speed: 4, system: null, ships: [{ id: 1, name: 'f', type: 'frigate' }] },
      ];
      component.gameOutcome = 'inProgress';
    });

    it('opens the battle screen for a queued AI assault on a player planet', () => {
      const aiTick = TestBed.inject(StarMapAiTickService);
      const battleService = TestBed.inject(BattleService);
      const battle = { type: 'planet', planetId: 1, attackerId: 3 } as any;
      vi.spyOn(aiTick, 'tick').mockReturnValue(false);
      vi.spyOn(aiTick, 'takePendingPlayerBattle').mockReturnValueOnce(battle);
      const setPlanetBattle = vi.spyOn(battleService, 'setPlanetBattle');
      const enterBattle = vi.spyOn(component as any, 'enterBattleScreen').mockImplementation(() => {});

      component['gameLoopCallback'](0.016);

      expect(setPlanetBattle).toHaveBeenCalledWith(battle);
      expect(enterBattle).toHaveBeenCalledTimes(1);
    });

    it('ends the game in defeat when an ownership change during the frame loop eliminates the player', () => {
      const aiTick = TestBed.inject(StarMapAiTickService);
      const ownership = TestBed.inject(PlanetOwnershipService);
      vi.spyOn(aiTick, 'takePendingPlayerBattle').mockReturnValue(undefined);
      component.fleets = component.fleets.filter((f) => f.factionId !== 'player');
      component['gameLoopCallback'](0.016);
      expect(component.gameOutcome).toBe('inProgress');

      // An AI capture of every player planet happens inside the AI tick.
      vi.spyOn(aiTick, 'tick').mockImplementation(() => {
        for (const planet of component.starSystems.flatMap((s) => s.planetsTiles)) {
          if (planet.factionId === 'player') {
            ownership.transferPlanet({ factions: component.factions }, planet, 'enemy1', 'battle_won');
          }
        }
        return true;
      });
      component['gameLoopCallback'](0.016);

      expect(component.gameOutcome).toBe('defeat');
    });
  });
});

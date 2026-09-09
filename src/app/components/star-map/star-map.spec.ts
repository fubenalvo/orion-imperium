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
import { BattleService } from '../../services/battle.service';
import type { BattleOutcome } from '../../services/battle.service';

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

    it('should only log when ActionResult changes', () => {
      const logCalls: string[] = [];
      logSpy.mockImplementation((msg: unknown) => {
        if (typeof msg === 'string' && msg.includes('[Enemy AI]')) {
          logCalls.push(msg);
        }
      });

      component['gameLoopCallback'](2);
      expect(logCalls.length).toBe(2);

      component['gameLoopCallback'](2);
      expect(logCalls.length).toBe(2);
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

      component['gameLoopCallback'](2);

      expect(actionService.getAction('enemy1')?.type).toBe('assemble_fleet');

      const raider = component.fleets.find((f: any) => f.id === 3);
      expect(raider).toBeDefined();
      expect(raider!.factionId).toBe('enemy1');
      expect(raider!.ships.some((s: any) => s.type === 'colonizer' && s.id === 5001)).toBe(true);

      const enemyStock = component.shipStock.find((s) => s.factionId === 'enemy1');
      expect(enemyStock?.ships.filter((s: any) => s.type === 'colonizer') ?? []).toHaveLength(0);

      component['gameLoopCallback'](2);
      expect(component.fleets.find((f: any) => f.id === 3)!.ships.filter((s: any) => s.type === 'colonizer')).toHaveLength(1);
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
});

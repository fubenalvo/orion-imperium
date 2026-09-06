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
      const productionService = TestBed.inject(ProductionService);
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
  });
});

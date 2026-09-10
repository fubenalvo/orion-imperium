import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter, Router } from '@angular/router';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import { FleetShip } from './battle/battle.types';
import { ANIMATION_MS } from './battle/battle.types';
import { BattleAnimationService } from './battle/battle-animation.service';
import { BattleScreenComponent } from './battle-screen.component';

describe('BattleScreenComponent', () => {
  let fixture: ComponentFixture<BattleScreenComponent>;
  let component: BattleScreenComponent;
  let battleService: BattleService;
  let saveGameService: SaveGameService;
  let router: Router;
  let gameTimeService: GameTimeService;
  let anim: BattleAnimationService;

  const fleetShip = (id: number, type: string): FleetShip => ({ id, name: `S${id}`, type });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BattleScreenComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    battleService = TestBed.inject(BattleService);
    saveGameService = TestBed.inject(SaveGameService);
    router = TestBed.inject(Router);
    gameTimeService = TestBed.inject(GameTimeService);
    anim = TestBed.inject(BattleAnimationService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    battleService.clearBattle();
  });

  const seedAutosave = (): void => {
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, {
      factions: [],
      map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [],
      fleets: [
        {
          id: 1, name: 'ORION', factionId: 'player', x: 0, y: 0,
          targetX: null, targetY: null, speed: 5, system: null, ships: [],
        },
        {
          id: 2, name: 'RAIDER', factionId: 'enemy1', x: 0, y: 0,
          targetX: null, targetY: null, speed: 5, system: null, ships: [],
        },
      ],
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
      shipStock: [],
      production: [],
    } as any);
  };

  it('should create and freeze game time when a battle is present', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(2, 'frigate')] },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: 2,
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component).toBeTruthy();
    expect(component.battleState).toBeTruthy();
    expect(gameTimeService.isPaused).toBe(true);
    expect(component.battleOver).toBe(false);
  });

  it('should show a recovery action and clear stale battle state when no battle is active', async () => {
    seedAutosave();
    const before = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    battleService.setBattleResult({
      winnerSide: 'attacker',
      winnerFleetId: 1,
      loserFleetId: 2,
      attacker: {
        fleetId: 1,
        side: 'attacker',
        factionId: 'player',
        ships: [],
        survivors: [],
        wipedOut: false,
      },
      defender: {
        fleetId: 2,
        side: 'defender',
        factionId: 'enemy1',
        ships: [],
        survivors: [],
        wipedOut: false,
      },
      rounds: 1,
      battleType: 'fleet',
    });
    battleService.setDestroyedFleetId(99);

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.battle-screen__error');
    const button = error?.querySelector('button');
    expect(error?.textContent).toContain('NO ACTIVE BATTLE');
    expect(button).toBeTruthy();

    button.click();

    expect(routerSpy).toHaveBeenCalledWith(['/star-map']);
    expect(gameTimeService.isPaused).toBe(false);
    expect(battleService.getBattle()).toBeNull();
    expect(battleService.getBattleResult()).toBeNull();
    expect(battleService.getDestroyedFleetId()).toBeNull();
    expect(saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)).toEqual(before);
  });

  it('END TURN is disabled while an animation is in flight', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(2, 'frigate')] },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: 2,
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const state = component['state'];
    const stack = state?.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    component.selectedStackId = stack.stackId;

    // Kick off a move without awaiting — the lock should engage immediately.
    const moveP = component['doMove'](stack, stack.col + 1, stack.row);
    expect(component.canEndTurn).toBe(false);

    await vi.advanceTimersByTimeAsync(ANIMATION_MS.move + 1);
    await moveP;

    expect(component.canEndTurn).toBe(true);
    fixture.detectChanges();
  });

  it('backToStarMap persists the outcome, sets the loser id, navigates, and resumes time', async () => {
    seedAutosave();
    const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(2, 'frigate')] },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: 2,
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Simulate a resolved battle: attacker wins, defender wiped out.
    const state = component['state']!;
    state.winner = 'attacker';
    state.stacks.filter((s) => s.side === 'defender').forEach((s) => (s.destroyed = true));
    state.defenderShips.forEach((s) => {
      s.hp = 0;
      s.alive = false;
    });

    component.backToStarMap();

    const result = battleService.getBattleResult();
    expect(result?.winnerSide).toBe('attacker');
    expect(result?.defender.wipedOut).toBe(true);
    expect(battleService.getDestroyedFleetId()).toBe(2);

    const saved = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    const raider = saved!.fleets?.find((f) => f.id === 2);
    expect(raider?.destroyed).toBe(true);
    expect(raider?.ships.find((s) => s.id === 2)?.destroyed).toBe(true);

    expect(routerSpy).toHaveBeenCalledWith(['/star-map']);
    expect(gameTimeService.isPaused).toBe(false);
  });
});

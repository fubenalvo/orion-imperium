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
    expect(component.planetVisual).toBeNull();
    expect(component.planetShield).toBeNull();
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

  /*
   * Selection-panel aggregate getters. The panel derives every value from
   * the selected BattleStack/BattleShip state; no combat logic is duplicated.
   *
   * NOTE: buildStacks() gives each ship its own stack when the roster is
   * small, so to exercise multi-ship aggregation we merge two ships into
   * the selected stack directly (mirroring the >28-ship grouped path).
   */
  it('exposes aggregate stats for the selected stack', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(3, 'frigate')] },
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

    const state = component['state']!;
    const stack = state.stacks.find((s) => s.side === 'attacker')!;
    // Merge the second fighter into this stack so it holds 2 ships.
    const second = state.stacks.find((s) => s.side === 'attacker' && s.stackId !== stack.stackId)!;
    stack.ships.push(second.ships[0]);

    component.selectedStackId = stack.stackId;

    // Two fighters: 50 maxHp each, 15 attack each, 3 defense each.
    expect(component.selectedShipCount).toBe(2);
    expect(component.selectedTotalHp).toBe(100);
    expect(component.selectedMaxHp).toBe(100);
    expect(component.selectedTotalAttack).toBe(30);
    expect(component.selectedTotalDefense).toBe(6);
    expect(component.selectedHullFraction).toBe(1);
  });

  it('reflects damaged ships in the aggregate HP and fraction', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(3, 'frigate')] },
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

    const state = component['state']!;
    const stack = state.stacks.find((s) => s.side === 'attacker')!;
    const second = state.stacks.find((s) => s.side === 'attacker' && s.stackId !== stack.stackId)!;
    stack.ships.push(second.ships[0]);

    component.selectedStackId = stack.stackId;

    // Knock 20 HP off the first fighter (50 -> 30).
    stack.ships[0].hp = 30;

    expect(component.selectedTotalHp).toBe(80);
    expect(component.selectedMaxHp).toBe(100);
    expect(component.selectedHullFraction).toBe(0.8);
  });

  it('does not count destroyed ships in alive aggregates', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')] },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [fleetShip(3, 'frigate')] },
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

    const state = component['state']!;
    const stack = state.stacks.find((s) => s.side === 'attacker')!;
    const second = state.stacks.find((s) => s.side === 'attacker' && s.stackId !== stack.stackId)!;
    stack.ships.push(second.ships[0]);

    component.selectedStackId = stack.stackId;

    stack.ships[1].alive = false;
    stack.ships[1].hp = 0;

    expect(component.selectedShipCount).toBe(1);
    expect(component.selectedTotalHp).toBe(50);
    expect(component.selectedTotalAttack).toBe(15);
    expect(component.selectedTotalDefense).toBe(3);
  });

  it('returns zero-safe aggregates when no stack is selected', () => {
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

    expect(component.selectedStackId).toBeNull();
    expect(component.selectedShipCount).toBe(0);
    expect(component.selectedTotalHp).toBe(0);
    expect(component.selectedMaxHp).toBe(0);
    expect(component.selectedTotalAttack).toBe(0);
    expect(component.selectedTotalDefense).toBe(0);
    expect(component.selectedHullFraction).toBe(0);
  });

  /*
   * End-of-battle result view. The outcome is derived from the same
   * buildBattleOutcome() the overworld persists — no duplicated logic.
   */
  it('builds a BattleOutcome from the finished state', () => {
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

    // Not over yet — no outcome.
    expect(component.battleOutcome).toBeNull();
    expect(component.getPlanetResultLabel()).toBe('');

    const state = component['state']!;
    state.winner = 'attacker';
    state.defenderShips[0].hp = 0;
    state.defenderShips[0].alive = false;

    const outcome = component.battleOutcome!;
    expect(outcome.winnerSide).toBe('attacker');
    expect(outcome.winnerFleetId).toBe(1);
    expect(outcome.loserFleetId).toBe(2);
    expect(outcome.battleType).toBe('fleet');
    expect(outcome.attacker.survivors).toHaveLength(1);
    expect(outcome.defender.wipedOut).toBe(true);
    expect(outcome.defender.ships[0].destroyed).toBe(true);
  });

  it('returns the planet result label for planet battles', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: { id: -7, name: 'DEFENSE', factionId: 'enemy1', ships: [fleetShip(2, 'frigate')] },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: -7,
      type: 'planet',
      planetId: 7,
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Defender holds the planet.
    const state = component['state']!;
    state.winner = 'defender';
    expect(component.getPlanetResultLabel()).toBe('DEFENDED');

    // Attacker takes the planet.
    state.winner = 'attacker';
    expect(component.getPlanetResultLabel()).toBe('CAPTURED');
  });

  it('exposes the separate planet visual and shared shield pool for planet battles', () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: -7,
        name: 'DEFENSE',
        factionId: 'enemy1',
        ships: [fleetShip(2, 'laser_turret')],
        shieldPool: 300,
        shieldPoolRegen: 15,
      },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: -7,
      type: 'planet',
      planetId: 7,
      planetName: 'Mars',
      planetColor: '#b35a2a',
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.planetVisual).toEqual({ name: 'Mars', color: '#b35a2a' });
    expect(component.planetShield).toEqual({ current: 300, max: 300, regen: 15 });
    expect(component.planetShieldFraction).toBe(1);

    const shieldBar = fixture.nativeElement.querySelector('.battle-screen__planet-shield');
    expect(shieldBar).toBeTruthy();
    expect(shieldBar.textContent).toContain('300');
  });
});

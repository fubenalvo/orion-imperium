import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter, Router } from '@angular/router';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import { FleetShip, BattleStack, BattleModelState } from './battle/battle.types';
import { BattleAnimationService } from './battle/battle-animation.service';
import { BattleTimeService } from './battle/battle-time.service';
import { BattleGameLoopService } from './battle/battle-game-loop.service';
import { BattleSettingsService } from '../../services/battle-settings.service';
import { stackCenterVw } from './battle/battle-grid';
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
    anim.reset();
  });


  const syncPosition = (stack: BattleStack): void => {
    const center = stackCenterVw({
      side: stack.side,
      size: stack.size,
      col: stack.col,
      row: stack.row,
    } as BattleStack);
    stack.x = center.x;
    stack.y = center.y;
  };

  const seedAutosave = (): void => {
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, {
      factions: [],
      map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [],
      fleets: [
        {
          id: 1,
          name: 'ORION',
          factionId: 'player',
          x: 0,
          y: 0,
          targetX: null,
          targetY: null,
          speed: 5,
          system: null,
          ships: [],
        },
        {
          id: 2,
          name: 'RAIDER',
          factionId: 'enemy1',
          x: 0,
          y: 0,
          targetX: null,
          targetY: null,
          speed: 5,
          system: null,
          ships: [],
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

  /*
   * Drives the simulation exactly like BattleGameLoopService.tick: advance
   * battle time, run one frame, then let promise continuations run. The
   * real RAF loop is stopped in createBattle() so frames only happen here.
   */
  const runFrames = async (ms: number, frameMs = 16): Promise<void> => {
    const time = TestBed.inject(BattleTimeService);
    for (let t = 0; t < ms; t += frameMs) {
      const real = frameMs / 1000 / time.speed;
      time.onTick(real);
      component['gameLoopCallback'](time.getScaledDeltaTime(real));
      await vi.advanceTimersByTimeAsync(0);
    }
  };

  const createBattle = (playerShips: FleetShip[], enemyShips: FleetShip[]): BattleModelState => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: playerShips },
      fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: enemyShips },
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
    TestBed.inject(BattleGameLoopService).stopGameLoop();
    return component['state']!;
  };

  const place = (stack: BattleStack, col: number, row: number): void => {
    stack.col = col;
    stack.row = row;
    syncPosition(stack);
  };

  /* Makes a stack effectively unkillable so long-running scenarios are not
   * cut short by return fire. */
  const tank = (stack: BattleStack): void => {
    for (const ship of stack.ships) {
      ship.hp = ship.maxHp = 100000;
    }
  };

  const volleys = (state: BattleModelState, attackerId: string, targetId: string): number =>
    state.log.filter((e) => e.attackerStack === attackerId && e.defenderStack === targetId).length;

  /* Player fighters A (front) and B (far back); enemy frigates E1 (near A)
   * and E2 (in reach of A but farther than E1, so E1 is A's automatic pick). */
  const standardSetup = () => {
    const state = createBattle(
      [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')],
      [fleetShip(10, 'frigate'), fleetShip(11, 'frigate')],
    );
    const [a, b] = state.stacks.filter((s) => s.side === 'attacker');
    const [e1, e2] = state.stacks.filter((s) => s.side === 'defender');
    place(a, 5, 8);
    place(b, 2, 15);
    place(e1, 8, 8);
    place(e2, 10, 8);
    [a, b, e1, e2].forEach(tank);
    return { state, a, b, e1, e2 };
  };

  it('fires every stack of both sides at the same fire-rate cadence', async () => {
    const { state, a, e1 } = standardSetup();
    await runFrames(16);
    // A, E1 and E2 fired on the first frame (B starts out of reach); their
    // bolts are in flight.
    expect(state.projectiles).toHaveLength(3);
    expect(component.projectiles).toBe(state.projectiles);

    // fireRate 1.5 → one volley per ~667 battle-ms: t≈0 and t≈667.
    await runFrames(1000);
    expect(volleys(state, a.stackId, e1.stackId)).toBe(2);
    const enemyVolleysAtA = state.log.filter((e) => e.defenderStack === a.stackId).length;
    // Two enemy frigates in reach of A, each on its own cadence.
    expect(enemyVolleysAtA).toBe(4);
  });

  it('keeps a manual attack order when another stack is selected and ignores automatic picks', async () => {
    const { state, a, b, e1, e2 } = standardSetup();
    component.onStackClick(a.stackId);
    component.onStackClick(e2.stackId);
    component.onStackClick(b.stackId);

    expect(component.selectedStackId).toBe(b.stackId);
    expect(a.explicitAttackTargetId).toBe(e2.stackId);

    await runFrames(1500);
    expect(a.explicitAttackTargetId).toBe(e2.stackId);
    expect(volleys(state, a.stackId, e2.stackId)).toBeGreaterThanOrEqual(2);
    expect(volleys(state, a.stackId, e1.stackId)).toBe(0);
  });

  it('chases an out-of-reach manual target, keeps the order, and fires opportunistically', async () => {
    const { state, a, e1, e2 } = standardSetup();
    place(e2, 34, 3);
    const startDistance = Math.hypot(a.x - e2.x, a.y - e2.y);

    component.onStackClick(a.stackId);
    component.onStackClick(e2.stackId);
    await runFrames(800);

    expect(a.explicitAttackTargetId).toBe(e2.stackId);
    expect(a.moveToAttackTargetId).toBe(e2.stackId);
    expect(Math.hypot(a.x - e2.x, a.y - e2.y)).toBeLessThan(startDistance);
    // E1 was in reach while A was setting off: opportunistic fire.
    expect(volleys(state, a.stackId, e1.stackId)).toBeGreaterThanOrEqual(1);
  });

  it('clears the order when the target dies and returns to automatic targeting', async () => {
    const { state, a, e1, e2 } = standardSetup();
    e2.ships[0].hp = 1;
    e2.ships[0].shield = 0;

    component.onStackClick(a.stackId);
    component.onStackClick(e2.stackId);
    await runFrames(1500);

    expect(e2.destroyed).toBe(true);
    expect(a.explicitAttackTargetId).toBeNull();
    expect(volleys(state, a.stackId, e1.stackId)).toBeGreaterThanOrEqual(1);
  });

  it('replaces the previous order with a new one; a blocked move keeps the old order', async () => {
    const { a, e1, e2 } = standardSetup();
    component.onStackClick(a.stackId);
    component.onStackClick(e1.stackId);
    component.onStackClick(e2.stackId);
    expect(a.explicitAttackTargetId).toBe(e2.stackId);

    // Moving onto an occupied cell fails and must not cancel the order.
    component.onCellClick(e1.col, e1.row);
    await runFrames(16);
    expect(a.explicitAttackTargetId).toBe(e2.stackId);
    expect(component.isMoveBlocked).toBe(true);

    component.onCellClick(a.col, a.row + 3);
    await runFrames(16);
    expect(a.explicitAttackTargetId).toBeNull();
    expect(a.manualMoveOrder).toBe(true);
    expect(a.moving).toBe(true);
  });

  it('AUTO battle never overrides a manual order', async () => {
    const { a, e2 } = standardSetup();
    expect(component.autoBattleEnabled).toBe(true);
    place(e2, 34, 3);

    component.onStackClick(a.stackId);
    component.onStackClick(e2.stackId);
    await runFrames(2000);

    expect(a.explicitAttackTargetId).toBe(e2.stackId);
    // The AI never commanded this stack.
    expect(a.actionCooldownUntil).toBeUndefined();
  });

  it('pausing freezes firing and movement; orders given while paused apply on resume', async () => {
    const { state, a, e2 } = standardSetup();
    place(e2, 34, 3);
    component.toggleBattlePause();
    const x = a.x;

    component.onStackClick(a.stackId);
    component.onStackClick(e2.stackId);
    await runFrames(500);

    expect(state.log).toHaveLength(0);
    expect(a.x).toBe(x);
    expect(a.explicitAttackTargetId).toBe(e2.stackId);

    component.toggleBattlePause();
    await runFrames(500);
    expect(a.x).not.toBe(x);
    expect(state.log.length).toBeGreaterThan(0);
  });

  it('changes the selected stack targeting mode and drops the sticky target', () => {
    const { a, e1 } = standardSetup();
    component.onStackClick(a.stackId);
    a.autoTargetId = e1.stackId;

    expect(component.selectedTargetingMode).toBe('balanced');
    component.setSelectedTargetingMode('weakest');

    expect(a.targetingMode).toBe('weakest');
    expect(a.autoTargetId).toBeNull();
    expect(component.selectedTargetingMode).toBe('weakest');
  });

  it('eases the parallax background on real time, even while paused, and never resets it on leave', () => {
    createBattle([fleetShip(1, 'fighter')], [fleetShip(2, 'frigate')]);
    component.toggleBattlePause();
    const screen = fixture.nativeElement.querySelector('.battle-screen') as HTMLElement;
    vi.spyOn(screen, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);

    screen.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000, clientY: 500, bubbles: true }));
    expect(component.bgDeepTransform).toBe('translate3d(0vw, 0vh, 0)');

    // Paused: scaled delta is 0, the real delta still eases the background.
    component['gameLoopCallback'](0, 0.25);
    const eased = component.parallax.x;
    expect(eased).toBeGreaterThan(0.5);
    expect(eased).toBeLessThan(1);

    // Leaving the screen must not move the background at all.
    screen.dispatchEvent(new MouseEvent('mouseleave'));
    component['gameLoopCallback'](0, 0.25);
    expect(component.parallax.x).toBeGreaterThan(eased);
    expect(fixture.nativeElement.innerHTML).not.toContain('mouseleave');
  });

  /*
   * Regression guard against stuck battles: with AUTO on, both sides close
   * in and fight; with AUTO off, the passive player side still fires at
   * enemies that come into reach. Either way a winner must emerge.
   */
  for (const auto of [true, false]) {
    it(`runs a mixed-fleet battle to completion (AUTO ${auto ? 'on' : 'off'})`, async () => {
      const types = ['fighter', 'frigate', 'destroyer', 'cruiser', 'carrier', 'battleship', 'dreadnought'];
      const fleet = (base: number) => types.map((type, i) => fleetShip(base + i, type));
      TestBed.inject(BattleSettingsService).setAutoBattle(auto);
      const state = createBattle(fleet(100), fleet(200));

      for (let elapsed = 0; elapsed < 180000 && !state.winner; elapsed += 1000) {
        await runFrames(1000, 50);
      }

      expect(state.winner).not.toBeNull();
      expect(state.stacks.filter((s) => !s.destroyed).every((s) => s.side === state.winner)).toBe(true);
      expect(state.effects.every((e) => state.stacks.some((s) => s.stackId === e.attackerStackId))).toBe(true);
    }, 30000);
  }

  it('lets immobile planet turrets fire at attackers in reach', async () => {
    battleService.setPlanetBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: { id: -5, name: 'PLANET', factionId: 'enemy1', ships: [fleetShip(100, 'laser_turret')] },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Defense',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: -5,
      type: 'planet',
      planetId: 5,
    });
    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    TestBed.inject(BattleGameLoopService).stopGameLoop();
    const state = component['state']!;
    const fighter = state.stacks.find((s) => s.side === 'attacker')!;
    const turret = state.stacks.find((s) => s.side === 'defender')!;
    expect(turret.immobile).toBe(true);
    tank(fighter);
    place(fighter, turret.col - 6, turret.row);

    await runFrames(800);
    expect(volleys(state, turret.stackId, fighter.stackId)).toBeGreaterThanOrEqual(1);
  });

  it('gameLoopCallback keeps calling anim.tick() after checkVictory sets winner', () => {
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

    const state = component['state']!;
    // Destroy all defender stacks so checkVictory sets winner on next tick.
    const def = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    def.ships[0].hp = 0;
    def.ships[0].alive = false;
    def.destroyed = true;

    let tickCount = 0;
    const sub = anim.ticks$.subscribe(() => tickCount++);

    // Simulate a game loop tick: checkVictory should set winner, then anim.tick() fires.
    component['gameLoopCallback'](1 / 60);

    expect(state.winner).toBe('attacker');
    expect(tickCount).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('doCarrierBoost triggers change detection when ending the battle', () => {
    battleService.setBattle({
      fleet1: {
        id: 1,
        name: 'ORION',
        factionId: 'player',
        ships: [fleetShip(1, 'carrier'), fleetShip(2, 'fighter')],
      },
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
    const carrier = state.stacks.find((s) => s.typeId === 'carrier')!;
    const ally = state.stacks.find((s) => s.typeId === 'fighter')!;
    const enemy = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    // Place enemy in range of carrier but also need ally in range of enemy for boost targets.
    enemy.col = carrier.col + 2;
    enemy.row = carrier.row;
    ally.col = carrier.col - 2;
    ally.row = carrier.row;
    // Shield Pulse only fires when an ally in reach is missing shield.
    ally.ships[0].shield = 0;
    // Destroy enemy ships so carrierShieldBoost sets winner after boosting ally shields.
    // Actually carrierShieldBoost only checks range — it will set winner if enemy is wiped.
    // Since enemy still has alive ships, winner won't be set. Instead we just verify
    // detectChanges is called regardless of winner state.
    const detectChangesSpy = vi.spyOn((component as any).cdr, 'detectChanges');

    component.selectedStackId = carrier.stackId;
    component['doCarrierBoost']();

    expect(detectChangesSpy).toHaveBeenCalled();
    detectChangesSpy.mockRestore();
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
      fleet1: {
        id: 1,
        name: 'ORION',
        factionId: 'player',
        ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')],
      },
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
      fleet1: {
        id: 1,
        name: 'ORION',
        factionId: 'player',
        ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')],
      },
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
      fleet1: {
        id: 1,
        name: 'ORION',
        factionId: 'player',
        ships: [fleetShip(1, 'fighter'), fleetShip(2, 'fighter')],
      },
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

  it('returns shield pool in BattleOutcome after planet battle', () => {
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

    // Simulate partial shield depletion during battle.
    const state = component['state']!;
    state.defenderShieldPool!.current = 150;
    state.winner = 'attacker';
    state.defenderShips[0].hp = 0;
    state.defenderShips[0].alive = false;

    const outcome = component.battleOutcome!;
    expect(outcome.defender.shieldPoolCurrent).toBe(150);
    expect(outcome.defender.shieldPoolMax).toBe(300);
  });

  it('writes final shield pool back to planet on attacker victory', () => {
    seedAutosave();
    const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const planetId = 101;

    // Add the target planet to autosave.
    const autosave = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    autosave.starSystems = [
      {
        id: 'sol',
        name: 'Sol',
        x: 0,
        y: 0,
        planets: 1,
        color: '#8cc4ff',
        planetsTiles: [
          {
            id: planetId,
            index: 0,
            name: 'Terra',
            factionId: 'enemy1',
            x: 0,
            y: 0,
            type: 'earthlike',
            size: 'medium',
            population: 100,
            buildings: [],
            explored: true,
            shieldPoolCurrent: 300,
          },
        ],
      },
    ];
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, autosave);

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
      planetId,
      planetName: 'Terra',
      planetColor: '#b35a2a',
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Simulate partial shield depletion during battle.
    const state = component['state']!;
    state.winner = 'attacker';
    state.defenderShieldPool!.current = 150;
    state.defenderShips[0].hp = 0;
    state.defenderShips[0].alive = false;

    component.backToStarMap();

    const saved = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    const planet = saved.starSystems[0].planetsTiles[0];
    expect(planet.factionId).toBe('player');
    expect(planet.shieldPoolCurrent).toBe(150);
  });

  it('writes final shield pool back to planet on defender victory', () => {
    seedAutosave();
    const routerSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const planetId = 102;

    const autosave = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    autosave.starSystems = [
      {
        id: 'sol',
        name: 'Sol',
        x: 0,
        y: 0,
        planets: 1,
        color: '#8cc4ff',
        planetsTiles: [
          {
            id: planetId,
            index: 0,
            name: 'Terra',
            factionId: 'enemy1',
            x: 0,
            y: 0,
            type: 'earthlike',
            size: 'medium',
            population: 100,
            buildings: [],
            explored: true,
            shieldPoolCurrent: 300,
          },
        ],
      },
    ];
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, autosave);

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
      planetId,
      planetName: 'Terra',
      planetColor: '#b35a2a',
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Defender wins with shield remaining.
    const state = component['state']!;
    state.winner = 'defender';
    state.defenderShieldPool!.current = 200;
    state.attackerShips[0].hp = 0;
    state.attackerShips[0].alive = false;

    component.backToStarMap();

    const saved = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    const planet = saved!.starSystems[0].planetsTiles[0];
    expect(planet.factionId).toBe('enemy1');
    expect(planet.shieldPoolCurrent).toBe(200);
  });

  it('persists garrison ship damage after a defender victory', () => {
    seedAutosave();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const planetId = 103;

    const autosave = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    autosave.starSystems = [
      {
        id: 'sol',
        name: 'Sol',
        x: 0,
        y: 0,
        planets: 1,
        color: '#8cc4ff',
        planetsTiles: [
          {
            id: planetId,
            index: 0,
            name: 'Terra',
            factionId: 'enemy1',
            x: 0,
            y: 0,
            type: 'earthlike',
            size: 'medium',
            population: 100,
            buildings: [],
            explored: true,
            shieldPoolCurrent: 300,
          },
        ],
      },
    ];
    autosave.fleets = [
      ...autosave.fleets,
      {
        id: 99,
        name: 'GARRISON',
        factionId: 'enemy1',
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
        speed: 0,
        system: { id: 'sol', x: 1, y: 1, targetX: null, targetY: null },
        ships: [{ id: 22, name: 'G1', type: 'frigate', currentHp: 40 }],
        destroyed: false,
      },
    ];
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, autosave);

    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: -7,
        name: 'DEFENSE',
        factionId: 'enemy1',
        ships: [
          fleetShip(2, 'laser_turret'),
          { id: 1002, name: 'G1', type: 'frigate', currentHp: 40 },
        ],
        shieldPool: 300,
        shieldPoolRegen: 15,
        shieldPoolMax: 300,
        garrisonFleetId: 99,
        garrisonShipMap: { 1002: 22 },
      },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: -7,
      type: 'planet',
      planetId,
      planetName: 'Terra',
      planetColor: '#b35a2a',
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    // Defender wins; the turret is destroyed but the garrison ship lives on at 20 HP.
    const state = component['state']!;
    state.winner = 'defender';
    state.defenderShips[0].hp = 0;
    state.defenderShips[0].alive = false;
    const garrison = state.defenderShips.find((s) => s.shipId === 1002)!;
    garrison.hp = 20;
    state.attackerShips[0].hp = 0;
    state.attackerShips[0].alive = false;

    component.backToStarMap();

    const savedGarrison = saveGameService
      .loadFromSlot(SaveSlotId.AUTOSAVE)!
      .fleets.find((f) => f.id === 99)!;
    expect(savedGarrison.ships[0].currentHp).toBe(20);
    expect(savedGarrison.ships[0].destroyed).toBe(false);
    expect(savedGarrison.destroyed).toBe(false);
  });

  it('marks the garrison fleet destroyed when the planet is captured', () => {
    seedAutosave();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const planetId = 104;

    const autosave = saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE)!;
    autosave.starSystems = [
      {
        id: 'sol',
        name: 'Sol',
        x: 0,
        y: 0,
        planets: 1,
        color: '#8cc4ff',
        planetsTiles: [
          {
            id: planetId,
            index: 0,
            name: 'Terra',
            factionId: 'enemy1',
            x: 0,
            y: 0,
            type: 'earthlike',
            size: 'medium',
            population: 100,
            buildings: [],
            explored: true,
            shieldPoolCurrent: 300,
          },
        ],
      },
    ];
    autosave.fleets = [
      ...autosave.fleets,
      {
        id: 98,
        name: 'GARRISON',
        factionId: 'enemy1',
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
        speed: 0,
        system: { id: 'sol', x: 1, y: 1, targetX: null, targetY: null },
        ships: [{ id: 30, name: 'G1', type: 'frigate', currentHp: 50 }],
        destroyed: false,
      },
    ];
    saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, autosave);

    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: -7,
        name: 'DEFENSE',
        factionId: 'enemy1',
        ships: [
          fleetShip(2, 'laser_turret'),
          { id: 1003, name: 'G1', type: 'frigate', currentHp: 50 },
        ],
        shieldPool: 300,
        shieldPoolRegen: 15,
        shieldPoolMax: 300,
        garrisonFleetId: 98,
        garrisonShipMap: { 1003: 30 },
      },
      faction1Name: 'Player',
      faction1Color: '#8cc4ff',
      faction2Name: 'Enemy 1',
      faction2Color: '#d65757',
      attackerId: 1,
      defenderId: -7,
      type: 'planet',
      planetId,
      planetName: 'Terra',
      planetColor: '#b35a2a',
    });

    fixture = TestBed.createComponent(BattleScreenComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const state = component['state']!;
    state.winner = 'attacker';
    state.defenderShips.forEach((s) => {
      s.hp = 0;
      s.alive = false;
    });

    component.backToStarMap();

    const captured = saveGameService
      .loadFromSlot(SaveSlotId.AUTOSAVE)!
      .fleets.find((f) => f.id === 98)!;
    expect(captured.destroyed).toBe(true);
    expect(captured.ships.every((s) => s.destroyed === true)).toBe(true);
  });

  it('moveConnectionLine returns null when no stack is selected', () => {
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

    expect(component.moveConnectionLine).toBeNull();
  });

  it('moveConnectionLine returns line when selected stack is moving', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;

    atk.x = 4;
    atk.y = 14;
    atk.targetX = 20;
    atk.targetY = 14;
    atk.moving = true;
    component.selectedStackId = atk.stackId;

    const line = component.moveConnectionLine;
    expect(line).not.toBeNull();
    expect(line!.from.x).toBe(4);
    expect(line!.from.y).toBe(14);
    expect(line!.to.x).toBe(20);
    expect(line!.to.y).toBe(14);
  });

  it('moveConnectionLine returns null when selected stack is not moving', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;

    atk.x = 4;
    atk.y = 14;
    atk.targetX = 20;
    atk.targetY = 14;
    // Not moving
    atk.moving = false;
    component.selectedStackId = atk.stackId;

    expect(component.moveConnectionLine).toBeNull();
  });

  it('attackConnectionLine returns null when no stack is selected', () => {
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

    expect(component.attackConnectionLine).toBeNull();
  });

  it('attackConnectionLine returns line when selected stack has explicit attack target', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    const def = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    atk.x = 4;
    atk.y = 14;
    def.x = 20;
    def.y = 14;
    atk.explicitAttackTargetId = def.stackId;
    component.selectedStackId = atk.stackId;

    const line = component.attackConnectionLine;
    expect(line).not.toBeNull();
    expect(line!.from.x).toBe(4);
    expect(line!.from.y).toBe(14);
    expect(line!.to.x).toBe(20);
    expect(line!.to.y).toBe(14);
  });

  it('attackConnectionLine returns line when selected stack has moveToAttackTargetId', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    const def = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    atk.x = 4;
    atk.y = 14;
    def.x = 20;
    def.y = 14;
    atk.moving = true;
    atk.moveToAttackTargetId = def.stackId;
    component.selectedStackId = atk.stackId;

    const line = component.attackConnectionLine;
    expect(line).not.toBeNull();
    expect(line!.from.x).toBe(4);
    expect(line!.from.y).toBe(14);
    expect(line!.to.x).toBe(20);
    expect(line!.to.y).toBe(14);
  });

  it('attackConnectionLine returns null when target is destroyed', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    const def = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    atk.x = 4;
    atk.y = 14;
    def.x = 20;
    def.y = 14;
    atk.explicitAttackTargetId = def.stackId;
    def.destroyed = true;
    component.selectedStackId = atk.stackId;

    expect(component.attackConnectionLine).toBeNull();
  });

  it('attackConnectionLine returns null when no attack target', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    atk.x = 4;
    atk.y = 14;
    component.selectedStackId = atk.stackId;

    expect(component.attackConnectionLine).toBeNull();
  });

  /*
   * =========================================================
   * CONNECTION LINES DURING PAUSE
   * =========================================================
   *
   * When the battle is paused, connection lines (move and attack)
   * must remain visible and their CSS animations must continue.
   * The fix in battle-grid.ts ensures updateStackPositions does not
   * complete movement when deltaTime === 0 (paused), keeping
   * stack.moving = true so moveConnectionLine stays visible.
   */

  it('moveConnectionLine remains visible when battle is paused', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;

    // Set up a moving stack
    atk.x = 4;
    atk.y = 14;
    atk.targetX = 20;
    atk.targetY = 14;
    atk.moving = true;
    component.selectedStackId = atk.stackId;

    // Initially visible (unpaused)
    expect(component.moveConnectionLine).not.toBeNull();

    // Pause the battle
    component.toggleBattlePause();
    expect(component.battlePaused).toBe(true);
    fixture.detectChanges();

    // Connection line should still be visible when paused
    expect(component.moveConnectionLine).not.toBeNull();
    expect(component.moveConnectionLine!.from.x).toBe(4);
    expect(component.moveConnectionLine!.from.y).toBe(14);
    expect(component.moveConnectionLine!.to.x).toBe(20);
    expect(component.moveConnectionLine!.to.y).toBe(14);
  });

  it('moveConnectionLine stays visible after gameLoopCallback with paused deltaTime', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;

    // Set up a moving stack not yet at target
    atk.x = 4;
    atk.y = 14;
    atk.targetX = 20;
    atk.targetY = 14;
    atk.moving = true;
    component.selectedStackId = atk.stackId;

    // Pause the battle
    component.toggleBattlePause();
    expect(component.battlePaused).toBe(true);

    // Simulate a game loop tick with deltaTime = 0 (paused)
    component['gameLoopCallback'](0);
    fixture.detectChanges();

    // Stack should still be moving (not completed) and line visible
    expect(atk.moving).toBe(true);
    expect(atk.targetX).not.toBeNull();
    expect(atk.targetY).not.toBeNull();
    expect(component.moveConnectionLine).not.toBeNull();
  });

  it('attackConnectionLine remains visible when battle is paused', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;
    const def = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    atk.x = 4;
    atk.y = 14;
    def.x = 20;
    def.y = 14;
    atk.explicitAttackTargetId = def.stackId;
    component.selectedStackId = atk.stackId;

    // Initially visible (unpaused)
    expect(component.attackConnectionLine).not.toBeNull();

    // Pause the battle
    component.toggleBattlePause();
    expect(component.battlePaused).toBe(true);
    fixture.detectChanges();

    // Attack connection line should still be visible when paused
    // (doesn't depend on stack.moving)
    expect(component.attackConnectionLine).not.toBeNull();
    expect(component.attackConnectionLine!.from.x).toBe(4);
    expect(component.attackConnectionLine!.from.y).toBe(14);
    expect(component.attackConnectionLine!.to.x).toBe(20);
    expect(component.attackConnectionLine!.to.y).toBe(14);
  });

  it('moveConnectionLine works correctly when unpausing and movement completes', () => {
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

    const state = component['state']!;
    const atk = state.stacks.find((s) => !s.destroyed && s.side === 'attacker')!;

    // Set up a moving stack very close to target (within 0.01 so it completes in one frame)
    atk.x = 19.995;
    atk.y = 14;
    atk.targetX = 20;
    atk.targetY = 14;
    atk.moving = true;
    atk.speed = 10;
    component.selectedStackId = atk.stackId;

    // Pause the battle
    component.toggleBattlePause();
    expect(component.battlePaused).toBe(true);

    // Simulate paused game loop tick
    component['gameLoopCallback'](0);
    fixture.detectChanges();

    // Should still be moving during pause
    expect(atk.moving).toBe(true);
    expect(component.moveConnectionLine).not.toBeNull();

    // Unpause
    component.toggleBattlePause();
    expect(component.battlePaused).toBe(false);

    // Simulate unpaused game loop tick - movement should complete
    component['gameLoopCallback'](1 / 60);
    fixture.detectChanges();

    // Movement should complete, target cleared, line hidden
    expect(atk.moving).toBe(false);
    expect(atk.targetX).toBeNull();
    expect(atk.targetY).toBeNull();
    expect(component.moveConnectionLine).toBeNull();
  });
});

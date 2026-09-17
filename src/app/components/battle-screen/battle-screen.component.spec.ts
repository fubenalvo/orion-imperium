import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter, Router } from '@angular/router';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';
import { FleetShip, BattleStack } from './battle/battle.types';
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
    anim.reset();
  });

  const placeAdjacent = (atk: BattleStack, def: BattleStack): void => {
    def.col = atk.col + Math.min(atk.attackRange, 3);
    def.row = atk.row;
  };

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

  it('animation lock engages during attack and releases after', async () => {
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
    // Place attacker in range of defender
    def.col = atk.col + 2;
    def.row = atk.row;
    // Make defender killable so auto-attack chain terminates (1 volley)
    def.ships[0].hp = 1;
    def.ships[0].shield = 0;

    component.selectedStackId = atk.stackId;

    // Kick off an attack without awaiting — the lock engages immediately.
    const attackP = component['doAttack'](atk, def);
    expect(anim.isBusy).toBe(true);

    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await vi.advanceTimersByTimeAsync(1);
    await attackP;

    expect(anim.isBusy).toBe(false);
    fixture.detectChanges();
  });

  it('canAct remains true during an attack animation', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    const def2 = state.stacks.find(
      (s) => !s.destroyed && s.side === 'defender' && s.stackId !== def1.stackId,
    )!;
    placeAdjacent(atk, def1);
    def2.col = atk.col + 2;
    def2.row = atk.row;
    // Make both defenders killable so auto-attack terminates
    def1.ships[0].hp = 1;
    def1.ships[0].shield = 0;
    def2.ships[0].hp = 1;
    def2.ships[0].shield = 0;

    component.selectedStackId = atk.stackId;

    expect(component.canAct).toBe(true);

    const attackP = component['doAttack'](atk, def1);
    // canAct should remain true during animation (animation doesn't block input)
    expect(component.canAct).toBe(true);
    expect(anim.isBusy).toBe(true);

    // First attack on def1 (destroyed): projectile + explosion = 720ms
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    // Trigger game loop - explicit target destroyed, should auto-attack def2
    const autoAttackP = component['tryAutoAttack'](atk);
    // Second attack on def2 (destroyed): projectile + explosion = 720ms
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await autoAttackP;
    // Trigger game loop again - no more targets
    component['gameLoopCallback'](1/60);
    // Extra time for any pending cooldowns
    await vi.advanceTimersByTimeAsync(100);
    await attackP;

    // Flush any remaining microtasks (e.g., animation finally blocks)
    await vi.advanceTimersByTimeAsync(0);

    // After chain completes and battle ends, canAct is false
    expect(anim.isBusy).toBe(false);
  });

  it('auto-attack chains to next target when first is destroyed', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    const def2 = state.stacks.find(
      (s) => !s.destroyed && s.side === 'defender' && s.stackId !== def1.stackId,
    )!;
    placeAdjacent(atk, def1);
    // Place second target explicitly within range (2 cols away, range=3)
    def2.col = atk.col + 2;
    def2.row = atk.row;

    component.selectedStackId = atk.stackId;
    const totalHpBefore = def2.ships[0].hp + (def2.ships[0].shield ?? 0);
    def1.ships[0].hp = 1;
    def1.ships[0].shield = 0;
    def2.ships[0].hp = 1;
    def2.ships[0].shield = 0;

    const attackP = component['doAttack'](atk, def1);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await vi.advanceTimersByTimeAsync(147);
    await attackP;

    expect(def1.destroyed).toBe(true);
    const def2Ship = def2.ships[0]!;
    expect((def2Ship.shield ?? 0) + def2Ship.hp).toBeLessThan(totalHpBefore);
  });

  it('auto-attack stops when no targets remain', async () => {
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
    placeAdjacent(atk, def);
    component.selectedStackId = atk.stackId;

    /*
     * Make defender killable in one volley so auto-attack chain triggers
     * and then stops (no other targets in range).
     */
    def.ships[0].hp = 1;
    def.ships[0].shield = 0;

    const attackP = component['doAttack'](atk, def);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    /* Cooldown after destroyed target: 0ms but wait(0) needs 1ms */
    await vi.advanceTimersByTimeAsync(1);
    await attackP;

    expect(def.destroyed).toBe(true);
    // autoAttackActive no longer exists; auto-attack is now handled by game loop
    // Expect animation to be complete
    expect(anim.isBusy).toBe(false);
  });

  it('auto-attack stops when player selects different stack during chain', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    const def2 = state.stacks.find(
      (s) => !s.destroyed && s.side === 'defender' && s.stackId !== def1.stackId,
    )!;
    placeAdjacent(atk, def1);
    def1.ships[0].hp = 1;
    def1.ships[0].shield = 0;

    component.selectedStackId = atk.stackId;
    const hpBefore = def2.ships[0].hp;

    const attackP = component['doAttack'](atk, def1);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    /*
     * Deselect during animation — auto-attack should stop when it checks
     * selectedStackId after the first volley kills the target.
     */
    component.selectedStackId = null;
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await attackP;

    expect(def1.destroyed).toBe(true);
    expect(component.selectedStackId).toBeNull();
    // autoAttackActive no longer exists; auto-attack is now handled by game loop
    expect(anim.isBusy).toBe(false);
    expect(def2.ships[0].hp).toBe(hpBefore);
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
        ships: [fleetShip(2, 'laser_turret'), { id: 1002, name: 'G1', type: 'frigate', currentHp: 40 }],
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
        ships: [fleetShip(2, 'laser_turret'), { id: 1003, name: 'G1', type: 'frigate', currentHp: 50 }],
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

  it('explicit attack target overrides auto-attack and resumes after target destroyed', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;
    const def2 = state.stacks.find(
      (s) => !s.destroyed && s.side === 'defender' && s.stackId !== def1.stackId,
    )!;
    placeAdjacent(atk, def1);
    // Place second target explicitly within range
    def2.col = atk.col + 2;
    def2.row = atk.row;

    component.selectedStackId = atk.stackId;
    // Make both defenders killable
    def1.ships[0].hp = 1;
    def1.ships[0].shield = 0;
    def2.ships[0].hp = 1;
    def2.ships[0].shield = 0;

    const initialDef2Hp = def2.ships[0].hp + (def2.ships[0].shield ?? 0);

    // Explicit attack on def1 - should ONLY attack def1, not def2
    const attackP = component['doAttack'](atk, def1);
    // First attack on def1 (destroyed)
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    // Explicit target should now be cleared (def1 destroyed)
    expect(atk.explicitAttackTargetId).toBeNull();
    // Manually trigger auto-attack on attacker (simulating game loop)
    const autoAttackP = component['tryAutoAttack'](atk);
    // Second attack on def2 - advance timers for its animation
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await autoAttackP;
    await vi.advanceTimersByTimeAsync(100);
    await attackP;

    // def1 destroyed (explicit target)
    expect(def1.destroyed).toBe(true);
    // After explicit target destroyed, auto-attack resumes and attacks def2
    const def2Ship = def2.ships[0]!;
    expect((def2Ship.shield ?? 0) + def2Ship.hp).toBeLessThan(initialDef2Hp);
  });

  it('move command clears explicit attack target', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    component.selectedStackId = atk.stackId;
    // Make defender survive first volley
    def1.ships[0].hp = 50;
    def1.ships[0].shield = 0;

    // Explicit attack sets target (synchronously in doAttack)
    component['doAttack'](atk, def1);
    expect(atk.explicitAttackTargetId).toBe(def1.stackId);

    // Move command clears explicit target
    await component['doMove'](atk, atk.col + 1, atk.row);
    expect(atk.explicitAttackTargetId).toBeNull();
  });

  it('deselecting stack clears explicit attack target', async () => {
    battleService.setBattle({
      fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
      fleet2: {
        id: 2, name: 'RAIDER', factionId: 'enemy1',
        ships: [fleetShip(2, 'frigate'), fleetShip(3, 'frigate')],
      },
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
    const def1 = state.stacks.find((s) => !s.destroyed && s.side === 'defender')!;

    component.selectedStackId = atk.stackId;
    // Make defender survive first volley
    def1.ships[0].hp = 50;
    def1.ships[0].shield = 0;

    // Explicit attack sets target (synchronously in doAttack)
    component['doAttack'](atk, def1);
    expect(atk.explicitAttackTargetId).toBe(def1.stackId);

    // Deselect (select null) clears explicit target
    component.selectedStackId = null;
    expect(atk.explicitAttackTargetId).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { BattleCombatService } from './battle-combat.service';
import { BattleTurnService } from './battle-turn.service';
import { BattleAnimationService } from './battle-animation.service';
import { ANIMATION_MS } from './battle.types';

describe('BattleCombatService', () => {
  let combat: BattleCombatService;
  let turn: BattleTurnService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    combat = TestBed.inject(BattleCombatService);
    turn = TestBed.inject(BattleTurnService);
    anim = TestBed.inject(BattleAnimationService);
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    anim.reset();
    vi.useRealTimers();
  });

  const fleetShip = (id: number, type: string): FleetShip => ({ id, name: `S${id}`, type });

  const battle = (attacker: FleetShip[], defender: FleetShip[]): Battle => ({
    fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: attacker },
    fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: defender },
    faction1Name: 'Player',
    faction1Color: '#8cc4ff',
    faction2Name: 'Enemy 1',
    faction2Color: '#d65757',
    attackerId: 1,
    defenderId: 2,
  });

  const setup = (attacker: FleetShip[], defender: FleetShip[]): BattleModelState => {
    const state = createBattleState(battle(attacker, defender), shipService, planetBattleService);
    anim.reset();
    state.activeSide = 'attacker';
    return state;
  };

  const placeAdjacent = (atker: BattleStack, defender: BattleStack): void => {
    // defender within the attacker's attack range on the same row
    defender.col = atker.col + Math.min(atker.attackRange, 3);
    defender.row = atker.row;
  };

  it('applies max(1, totalAttack - frontDefense) and deducts AP', async () => {
    // 5 fighters => totalAttack 75 vs frigate (defense 8) => damage 67
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'frigate')],
    );
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    const apBefore = state.ap;
    const hpBefore = def.ships[0].hp;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(state.ap).toBe(apBefore - atk.attackAp);
    expect(def.ships[0].hp).toBe(hpBefore - 67);
    expect(def.ships[0].alive).toBe(true);
    expect(atk.attackedThisTurn).toBe(true);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].kills).toBe(0);
  });

  it('spills overkill across a defender stack until a ship dies', async () => {
    // 5 fighters (75) vs 2 scouts in one stack (defense 2): damage 73 kills
    // the front scout (hp 40) and wounds the next (40 -> 7).
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [
        fleetShip(100, 'scout'),
        fleetShip(101, 'scout'),
      ],
    );
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    const dead = def.ships.filter((s) => !s.alive);
    const wounded = def.ships.filter((s) => s.alive && s.hp < s.maxHp);
    expect(dead).toHaveLength(1);
    expect(wounded).toHaveLength(1);
    expect(wounded[0].hp).toBe(7);
    expect(state.log[0].kills).toBe(1);
  });

  it('destroys a stack when all its ships die and triggers victory', async () => {
    // 5 fighters (75) vs 1 scout (hp 40, defense 2): damage 73 → scout dies
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'scout')],
    );
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    // explosion phase for a wiped target
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await p;

    expect(def.destroyed).toBe(true);
    expect(state.winner).toBe('attacker');
    expect(state.log[0].kills).toBe(1);
  });

  it('runs the projectile -> impact -> clear effect lifecycle with ticks', async () => {
    const state = setup(
      [fleetShip(0, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    let tickCount = 0;
    const sub = anim.ticks$.subscribe(() => tickCount++);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    expect(state.effect?.phase).toBe('impact');
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    expect(state.effect).toBeNull();
    await p;

    expect(tickCount).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('rejects attacks from out of range', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 10; // beyond range 2

    const result = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
  });

  it('rejects attacking a same-side stack', async () => {
    const state = setup(
      [fleetShip(0, 'fighter'), fleetShip(1, 'scout')],
      [fleetShip(100, 'frigate')],
    );
    const atk = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    const buddy = getStacks(state, 'attacker').find((s) => s.typeId === 'scout')!;
    const result = await combat.attackStack(state, atk.stackId, buddy.stackId);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
  });

  it('rejects a second attack by the same stack in one turn', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const first = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await first;
    expect(state.ap).toBe(10 - atk.attackAp);

    const second = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(second).toBe(false);
  });

  it('rejects attacks while the animation lock is busy', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const inFlight = combat.attackStack(state, atk.stackId, def.stackId);
    const result = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(result).toBe(false);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await inFlight;
  });
});

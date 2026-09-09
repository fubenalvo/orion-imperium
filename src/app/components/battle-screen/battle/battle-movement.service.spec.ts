import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState } from './battle-state';
import { BattleMovementService } from './battle-movement.service';
import { BattleAnimationService } from './battle-animation.service';
import { ANIMATION_MS } from './battle.types';

describe('BattleMovementService', () => {
  let movement: BattleMovementService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    movement = TestBed.inject(BattleMovementService);
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

  const battle = (ships: FleetShip[]): Battle => ({
    fleet1: { id: 1, name: 'ORION', factionId: 'player', ships },
    fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [] },
    faction1Name: 'Player',
    faction1Color: '#8cc4ff',
    faction2Name: 'Enemy 1',
    faction2Color: '#d65757',
    attackerId: 1,
    defenderId: 2,
  });

  const setup = (attackerShips: FleetShip[]): BattleModelState => {
    const state = createBattleState(battle(attackerShips), shipService, planetBattleService);
    anim.reset();
    return state;
  };

  const stackFrom = (state: BattleModelState, idx: number): BattleStack => state.stacks[idx];

  it('moves an adjacent stack, deducts AP up-front, commits position after the tween', async () => {
    const state = setup([fleetShip(1, 'fighter'), fleetShip(2, 'fighter')]);
    const stack = stackFrom(state, 0);
    const apBefore = state.ap;
    const targetCol = stack.col + 1;

    const moveMs = stack.moveMs;
    const p = movement.moveStack(state, stack.stackId, targetCol, stack.row);
    // AP and counters commit synchronously (before the tween resolves).
    expect(state.ap).toBe(apBefore - stack.moveApPerCell);

    expect(stack.col).toBe(stack.col); // not yet moved
    await vi.advanceTimersByTimeAsync(moveMs);
    expect(await p).toBe(true);
    expect(stack.col).toBe(targetCol);
  });

  it('rejects moves beyond the stack move range', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const stack = stackFrom(state, 0);
    const beyondCol = stack.col + stack.moveRange + 1;
    const result = await movement.moveStack(state, stack.stackId, beyondCol, stack.row);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
  });

  it('rejects out-of-bounds moves', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const stack = stackFrom(state, 0);
    const result = await movement.moveStack(state, stack.stackId, 0, stack.row);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
  });

  it('rejects moving onto an occupied cell', async () => {
    // Two distinct ship types deploy as separate stacks so the blocker
    // occupies its own cell.
    const state = setup([fleetShip(1, 'fighter'), fleetShip(2, 'frigate')]);
    const mover = state.stacks.find((s) => s.typeId === 'fighter')!;
    const blocker = state.stacks.find((s) => s.typeId === 'frigate')!;
    const result = await movement.moveStack(state, mover.stackId, blocker.col, mover.row);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
  });

  it('rejects moving an immobile (planet defense) stack', async () => {
    const state = setup([fleetShip(1, 'laser_turret')]);
    const stack = stackFrom(state, 0);
    expect(stack.immobile).toBe(true);
    const result = await movement.moveStack(state, stack.stackId, stack.col + 1, stack.row);
    expect(result).toBe(false);
  });

  it('rejects a second move while the tween is in flight', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const stack = stackFrom(state, 0);
    const moveMs = stack.moveMs;
    const first = movement.moveStack(state, stack.stackId, stack.col + 1, stack.row);
    // Lock is held until the tween resolves.
    expect(await movement.moveStack(state, stack.stackId, stack.col + 2, stack.row)).toBe(false);
    await vi.advanceTimersByTimeAsync(moveMs);
    await first;
  });

  it('rejects moving when it is not the stack side turn', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    state.activeSide = 'defender';
    const stack = stackFrom(state, 0);
    const result = await movement.moveStack(state, stack.stackId, stack.col + 1, stack.row);
    expect(result).toBe(false);
  });
});

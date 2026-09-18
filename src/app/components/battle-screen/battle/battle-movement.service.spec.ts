import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState } from './battle-state';
import { BattleMovementService } from './battle-movement.service';
import { BattleAnimationService } from './battle-animation.service';
import { updateStackPositions, stackCenterVw } from './battle-grid';

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

  it('sets a vw target and moves the stack toward it over time', async () => {
    const state = setup([fleetShip(1, 'fighter'), fleetShip(2, 'fighter')]);
    const stack = stackFrom(state, 0);
    const targetCol = stack.col + 1;
    const targetRow = stack.row;

    const result = await movement.moveStack(state, stack.stackId, targetCol, targetRow);
    expect(result).toBe(true);
    expect(stack.moving).toBe(true);

    // Verify target was set to the cell centre vw (with side offset)
    const expectedTarget = stackCenterVw({ side: stack.side, size: stack.size, col: targetCol, row: targetRow } as BattleStack);
    expect(stack.targetX).toBeCloseTo(expectedTarget.x, 1);
    expect(stack.targetY).toBeCloseTo(expectedTarget.y, 1);

    // Simulate game loop running until the stack reaches its target.
    // The game loop calls updateStackPositions every frame. First call
    // moves the stack toward the target; a second call detects arrival
    // and snaps position + col/row.
    updateStackPositions(state, 10);
    updateStackPositions(state, 0.1); // second frame: detects snap

    expect(stack.moving).toBe(false);
    expect(stack.col).toBe(targetCol);
    expect(stack.row).toBe(targetRow);
  });

  it('rejects out-of-bounds moves', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const stack = stackFrom(state, 0);
    const result = await movement.moveStack(state, stack.stackId, 0, stack.row);
    expect(result).toBe(false);
    expect(stack.moving).toBe(false);
  });

  it('rejects moving onto an occupied cell', async () => {
    const state = setup([fleetShip(1, 'fighter'), fleetShip(2, 'frigate')]);
    const mover = state.stacks.find((s) => s.typeId === 'fighter')!;
    const blocker = state.stacks.find((s) => s.typeId === 'frigate')!;
    const result = await movement.moveStack(state, mover.stackId, blocker.col, mover.row);
    expect(result).toBe(false);
  });

  it('rejects moving an immobile (planet defense) stack', async () => {
    const state = setup([fleetShip(1, 'laser_turret')]);
    const stack = stackFrom(state, 0);
    expect(stack.immobile).toBe(true);
    const result = await movement.moveStack(state, stack.stackId, stack.col + 1, stack.row);
    expect(result).toBe(false);
  });

  it('allows changing the move target while already moving', async () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const stack = stackFrom(state, 0);
    const first = movement.moveStack(state, stack.stackId, stack.col + 1, stack.row);
    expect(stack.moving).toBe(true);
    const result = await movement.moveStack(state, stack.stackId, stack.col + 2, stack.row);
    expect(result).toBe(true);
    await first;
  });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState } from './battle-state';
import { BattleMovementService } from './battle-movement.service';
import { BattleAnimationService } from './battle-animation.service';
import { updateStackPositions, stackCenterVw, isAbsoluteInRange, vwToStackCell } from './battle-grid';

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

  it('updateMoveToAttackTargets re-computes destination when target moves', () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const attacker = stackFrom(state, 0);
    const defender = { ...baseFleetStack('defender:frigate:0'), side: 'defender' as const };
    state.stacks.push(defender);

    // Place attacker at x=6, defender far at x=42.
    attacker.x = 6; attacker.y = 14; attacker.col = 2; attacker.row = 4;
    defender.x = 42; defender.y = 14; defender.col = 11; defender.row = 4;
    attacker.moving = true;
    attacker.targetX = 6;
    attacker.targetY = 14;
    attacker.moveToAttackTargetId = defender.stackId;

    const oldTargetX = attacker.targetX;
    const oldTargetY = attacker.targetY;

    // Move defender further away.
    defender.x = 50;
    defender.y = 14;

    movement.updateMoveToAttackTargets(state);

    expect(attacker.targetX).not.toBe(oldTargetX);
    expect(attacker.targetY).not.toBe(oldTargetY);
    expect(attacker.moveToAttackTargetId).toBe(defender.stackId);
  });

  it('updateMoveToAttackTargets clears target when destroyed and snaps to grid', () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const attacker = stackFrom(state, 0);
    const defender = { ...baseFleetStack('defender:frigate:0'), side: 'defender' as const };
    state.stacks.push(defender);

    attacker.x = 7; attacker.y = 13; attacker.col = 2; attacker.row = 4;
    defender.x = 14; defender.y = 14; defender.col = 4; defender.row = 4;
    attacker.moving = true;
    attacker.targetX = 14;
    attacker.targetY = 14;
    attacker.moveToAttackTargetId = defender.stackId;

    defender.destroyed = true;

    movement.updateMoveToAttackTargets(state);

    expect(attacker.moveToAttackTargetId).toBeNull();
    expect(attacker.moving).toBe(false);
    expect(attacker.targetX).toBeNull();
    expect(attacker.targetY).toBeNull();
    // Position should be snapped to the nearest grid cell centre
    const expectedCenter = stackCenterVw(attacker);
    expect(attacker.x).toBeCloseTo(expectedCenter.x, 5);
    expect(attacker.y).toBeCloseTo(expectedCenter.y, 5);
    // col/row should be consistent with the snapped position
    const expectedCell = vwToStackCell(attacker, attacker.x, attacker.y);
    expect(attacker.col).toBe(expectedCell.col);
    expect(attacker.row).toBe(expectedCell.row);
  });

  it('updateMoveToAttackTargets clears target when target is in range and snaps to grid', () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const attacker = stackFrom(state, 0);
    const defender = { ...baseFleetStack('defender:frigate:0'), side: 'defender' as const };
    state.stacks.push(defender);

    // Place attacker at an off-grid position (between cells 2 and 3, between rows 4 and 5).
    attacker.x = 7; attacker.y = 13; attacker.col = 2; attacker.row = 4;
    defender.x = 12; defender.y = 14; defender.col = 4; defender.row = 4;
    attacker.moving = true;
    attacker.targetX = 14;
    attacker.targetY = 14;
    attacker.moveToAttackTargetId = defender.stackId;

    movement.updateMoveToAttackTargets(state);

    expect(attacker.moveToAttackTargetId).toBeNull();
    expect(attacker.moving).toBe(false);
    expect(attacker.targetX).toBeNull();
    expect(attacker.targetY).toBeNull();
    // Position should be snapped to the nearest grid cell centre
    const expectedCenter = stackCenterVw(attacker);
    expect(attacker.x).toBeCloseTo(expectedCenter.x, 5);
    expect(attacker.y).toBeCloseTo(expectedCenter.y, 5);
    // col/row should be consistent with the snapped position
    const expectedCell = vwToStackCell(attacker, attacker.x, attacker.y);
    expect(attacker.col).toBe(expectedCell.col);
    expect(attacker.row).toBe(expectedCell.row);
  });

  it('updateMoveToAttackTargets does nothing for non-moving stacks', () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const attacker = stackFrom(state, 0);
    const defender = { ...baseFleetStack('defender:frigate:0'), side: 'defender' as const };
    state.stacks.push(defender);

    attacker.x = 6; attacker.y = 14; attacker.col = 2; attacker.row = 4;
    defender.x = 14; defender.y = 14; defender.col = 4; defender.row = 4;
    // Not moving, but has targetId set.
    attacker.moveToAttackTargetId = defender.stackId;

    movement.updateMoveToAttackTargets(state);

    expect(attacker.moveToAttackTargetId).toBe(defender.stackId);
    expect(attacker.moving).toBe(false);
  });

  it('updateMoveToAttackTargets snaps to nearest grid cell when target is brought into range', () => {
    const state = setup([fleetShip(1, 'fighter')]);
    const attacker = stackFrom(state, 0);
    const defender = { ...baseFleetStack('defender:frigate:0'), side: 'defender' as const };
    state.stacks.push(defender);

    // Attacker starts clearly between cells — col 2 center is ~5.684vw,
    // col 3 center is ~9.474vw; place at 8vw which is between them.
    const offGridX = 8;
    const offGridY = 13;
    attacker.x = offGridX; attacker.y = offGridY; attacker.col = 2; attacker.row = 4;
    // Defender positioned so attacker is within attack range (3 cells = ~10.5vw).
    defender.x = offGridX - 6; defender.y = offGridY; defender.col = 1; defender.row = 4;
    attacker.moving = true;
    attacker.targetX = offGridX - 10;
    attacker.targetY = offGridY;
    attacker.moveToAttackTargetId = defender.stackId;

    movement.updateMoveToAttackTargets(state);

    expect(attacker.moving).toBe(false);
    expect(attacker.targetX).toBeNull();
    expect(attacker.targetY).toBeNull();

    // The position must now be exactly at a cell centre
    const snapCenter = stackCenterVw(attacker);
    expect(attacker.x).toBeCloseTo(snapCenter.x, 5);
    expect(attacker.y).toBeCloseTo(snapCenter.y, 5);

    // And it must be the nearest cell to the original off-grid position
    const expectedCell = vwToStackCell({ ...attacker, x: offGridX, y: offGridY } as BattleStack, offGridX, offGridY);
    expect(attacker.col).toBe(expectedCell.col);
    expect(attacker.row).toBe(expectedCell.row);
  });
});

function baseFleetStack(stackId: string): BattleStack {
  return {
    stackId,
    side: 'attacker',
    typeId: 'frigate',
    typeName: 'Frigate',
    role: 'Line Ship',
    col: 1,
    row: 4,
    ships: [{
      shipId: 1,
      name: 'F1',
      typeId: 'frigate',
      hp: 40,
      maxHp: 40,
      shield: 0,
      maxShield: 0,
      shieldRegen: 0,
      attackType: 'kinetic',
      weakness: 'energy',
      attack: 8,
      defense: 3,
      alive: true,
    }],
    size: 1,
    tier: 2,
    attackRange: 3,
    immobile: false,
    moving: false,
    firing: false,
    destroyed: false,
    speed: 3,
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    fireRate: 1.5,
  };
}

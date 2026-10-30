import { describe, it, expect } from 'vitest';
import { BattleModelState, BattleStack, GridCell } from './battle.types';
import { BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS, BATTLE_RANGE_UNIT_VW, BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW, ATTACK_RANGE_TOLERANCE } from './battle.types';
import {
  cellDistance,
  getAttackTargetIds,
  getReachableCells,
  getOccupiedCells,
  isInRange,
  isInBounds,
  isOccupied,
  isCellReserved,
  isPathClear,
  linePath,
  stackCenterVw,
  absoluteDistanceVw,
  isAbsoluteInRange,
  isAbsolutePositionInRange,
  getMoveToAttackCells,
  findBestMoveToAttackCell,
  getMoveToAttackTargetIds,
  computeCarrierBoostTargets,
  vwToStackCell,
  findApproachCell,
  canAttack,
  absoluteDistanceRangeUnits,
} from './battle-grid';

function baseStack(): BattleStack {
  const stack: BattleStack = {
    stackId: 'attacker:fighter:0',
    side: 'attacker',
    typeId: 'fighter',
    typeName: 'Fighter',
    col: 2,
    row: 4,
    ships: [],
    size: 1,
    tier: 1,
    speed: 3,
    attackRange: 2,
    immobile: false,
    moving: false,
    firing: false,
    destroyed: false,
    role: 'Interceptor',
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    fireRate: 1.5,
  };
  placeStack(stack, 2, 4);
  return stack;
}

function placeStack(stack: BattleStack, col: number, row: number): void {
  stack.col = col;
  stack.row = row;
  const center = stackCenterVw(stack);
  stack.x = center.x;
  stack.y = center.y;
}

function placeStackAt(stack: BattleStack, x: number, y: number): void {
  stack.x = x;
  stack.y = y;
  const cell = vwToStackCell(stack, x, y);
  stack.col = cell.col;
  stack.row = cell.row;
}

function makeState(stacks: BattleStack[]): BattleModelState {
  return {
    round: 1,
    stacks,
    log: [],
    effects: [],
    projectiles: [],
    winner: null,
    attackerFleetId: 1,
    defenderFleetId: 2,
    attackerFactionId: 'player',
    defenderFactionId: 'enemy1',
    attackerName: 'A',
    attackerColor: '#fff',
    defenderName: 'D',
    defenderColor: '#f00',
    battleType: 'fleet',
    attackerShips: [],
    defenderShips: [],
  };
}

describe('battle-grid', () => {
  it('bounds match the doubled 38 x 16 grid over the same 72 x 28 vw field', () => {
    expect(BATTLE_GRID_COLUMNS).toBe(38);
    expect(BATTLE_GRID_ROWS).toBe(16);
    expect(BATTLE_CELL_WIDTH_VW * BATTLE_GRID_COLUMNS).toBeCloseTo(72);
    expect(BATTLE_CELL_HEIGHT_VW * BATTLE_GRID_ROWS).toBeCloseTo(28);
    expect(isInBounds(1, 1)).toBe(true);
    expect(isInBounds(38, 16)).toBe(true);
    expect(isInBounds(0, 4)).toBe(false);
    expect(isInBounds(39, 4)).toBe(false);
    expect(isInBounds(1, 17)).toBe(false);
  });

  it('measures range in physical units independent of grid density', () => {
    // One range unit is the cell height of the original 19x8 grid, so
    // doubling the grid did not change weapon reach.
    expect(BATTLE_RANGE_UNIT_VW).toBe(3.5);
    expect(BATTLE_CELL_HEIGHT_VW).toBeCloseTo(BATTLE_RANGE_UNIT_VW / 2);
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 2, 4);
    const reachVw = (attacker.attackRange + ATTACK_RANGE_TOLERANCE) * BATTLE_RANGE_UNIT_VW;
    const inside = { ...baseStack(), stackId: 'in', side: 'defender' as const, x: attacker.x + reachVw, y: attacker.y };
    const outside = { ...baseStack(), stackId: 'out', side: 'defender' as const, x: attacker.x + reachVw + 0.01, y: attacker.y };
    expect(canAttack(attacker, inside)).toBe(true);
    expect(canAttack(attacker, outside)).toBe(false);
    expect(absoluteDistanceRangeUnits(attacker, inside)).toBeCloseTo(3);
  });

  it('cellDistance is Euclidean', () => {
    expect(cellDistance({ col: 2, row: 4 }, { col: 2, row: 4 })).toBe(0);
    expect(cellDistance({ col: 1, row: 1 }, { col: 4, row: 5 })).toBe(5);
    expect(cellDistance({ col: 4, row: 4 }, { col: 7, row: 4 })).toBe(3);
  });

  it('isInRange uses squared Euclidean and is inclusive at exactly range', () => {
    const a: GridCell = { col: 4, row: 4 };
    expect(isInRange(a, { col: 6, row: 4 }, 2)).toBe(true);
    expect(isInRange(a, { col: 7, row: 4 }, 2)).toBe(false);
    expect(isInRange(a, { col: 5, row: 5 }, 2)).toBe(true);
  });

  it('linePath returns intermediate cells along a straight line', () => {
    expect(linePath({ col: 2, row: 4 }, { col: 5, row: 4 })).toEqual([
      { col: 3, row: 4 },
      { col: 4, row: 4 },
      { col: 5, row: 4 },
    ]);
  });

  it('linePath returns null for a degenerate (same-cell) path', () => {
    expect(linePath({ col: 2, row: 4 }, { col: 2, row: 4 })).toBeNull();
  });

  it('isOccupied ignores destroyed stacks and an excluded stack', () => {
    const state = makeState([
      { ...baseStack(), stackId: 'a', col: 3, row: 4 },
      { ...baseStack(), stackId: 'b', side: 'defender', col: 3, row: 4 },
      { ...baseStack(), stackId: 'c', col: 3, row: 4, destroyed: true },
    ]);
    expect(isOccupied(state, 3, 4, undefined)).toBe(true);
    expect(isOccupied(state, 3, 4, 'a')).toBe(true);
    expect(isOccupied(state, 3, 4, 'c')).toBe(true);
    expect(isOccupied(state, 3, 4, 'b')).toBe(true);
    expect(isOccupied(state, 9, 9, undefined)).toBe(false);
  });

  it('isCellReserved blocks destination cells of in-flight stacks', () => {
    const inflight = { ...baseStack(), stackId: 'moving', col: 2, row: 4, moving: true };
    placeStack(inflight, 2, 4);
    // Set an in-flight target to cell (5, 4)
    const targetCenter = stackCenterVw({ ...inflight, col: 5, row: 4 });
    inflight.targetX = targetCenter.x;
    inflight.targetY = targetCenter.y;
    const state = makeState([inflight]);

    // isOccupied checks only static position — does NOT see the in-flight target
    expect(isOccupied(state, 5, 4, undefined)).toBe(false);
    // isCellReserved sees the in-flight target
    expect(isCellReserved(state, 5, 4, undefined)).toBe(true);
    // Excluding the in-flight stack frees the target cell
    expect(isCellReserved(state, 5, 4, 'moving')).toBe(false);
    // The current cell is occupied (static) but not a "reservation" check
    expect(isOccupied(state, 2, 4, undefined)).toBe(true);
    // A different cell is free
    expect(isCellReserved(state, 3, 4, undefined)).toBe(false);
  });

  it('isCellReserved does not block target cells of non-moving stacks', () => {
    // A stack with targetX/targetY set but moving=false should not reserve its target
    const idle = { ...baseStack(), stackId: 'idle', col: 2, row: 4, moving: false };
    placeStack(idle, 2, 4);
    const targetCenter = stackCenterVw({ ...idle, col: 5, row: 4 });
    idle.targetX = targetCenter.x;
    idle.targetY = targetCenter.y;
    const state = makeState([idle]);

    expect(isCellReserved(state, 5, 4, undefined)).toBe(false);
  });

  it('isPathClear blocks the destination cell if reserved by an in-flight stack', () => {
    const mover = { ...baseStack(), stackId: 'mover', col: 2, row: 4 };
    const inFlight = {
      ...baseStack(),
      stackId: 'inflight',
      col: 1,
      row: 4,
      moving: true,
    };
    placeStack(inFlight, 1, 4);
    // In-flight stack reserves cell (5, 4) as its destination
    const targetCenter = stackCenterVw({ ...inFlight, col: 5, row: 4 });
    inFlight.targetX = targetCenter.x;
    inFlight.targetY = targetCenter.y;
    const state = makeState([mover, inFlight]);

    // Path that ends at (5, 4) — the reserved cell — should be blocked
    const blockedPath = linePath({ col: 2, row: 4 }, { col: 5, row: 4 })!;
    expect(isPathClear(state, blockedPath, mover)).toBe(false);

    // Path that ends at (4, 4) — NOT the reserved cell — should be clear
    const clearPath = linePath({ col: 2, row: 4 }, { col: 4, row: 4 })!;
    expect(isPathClear(state, clearPath, mover)).toBe(true);

    // Path that passes THROUGH (5, 4) but ends at (6, 4) should be clear
    // (intermediate cells are not checked for reservations)
    const throughPath = linePath({ col: 2, row: 4 }, { col: 6, row: 4 })!;
    expect(isPathClear(state, throughPath, mover)).toBe(true);
  });

  it('getReachableCells stays within movement range and clear paths', () => {
    const stack = { ...baseStack(), col: 2, row: 4 };
    const state = makeState([
      stack,
      { ...baseStack(), stackId: 'blocker', side: 'defender', col: 4, row: 4 },
    ]);
    const cells = getReachableCells(state, stack);
    // (4,4) is blocked; cells beyond it on the same row are blocked too
    const blockedCell = cells.find((c) => c.col === 4 && c.row === 4);
    expect(blockedCell).toBeUndefined();
    // adjacent cells are reachable
    expect(cells.some((c) => c.col === 3 && c.row === 4)).toBe(true);
    // cells beyond a blocker are blocked
    expect(cells.some((c) => c.col === 5 && c.row === 4)).toBe(false);
  });

  it('getReachableCells excludes cells already targeted by an in-flight stack', () => {
    const mover = { ...baseStack(), stackId: 'mover', col: 2, row: 4 };
    const inFlight = {
      ...baseStack(),
      stackId: 'inflight',
      col: 1,
      row: 4,
      moving: true,
    };
    placeStack(inFlight, 1, 4);
    // In-flight stack is heading to cell (6, 4)
    const targetCenter = stackCenterVw({ ...inFlight, col: 6, row: 4 });
    inFlight.targetX = targetCenter.x;
    inFlight.targetY = targetCenter.y;
    const state = makeState([mover, inFlight]);

    const cells = getReachableCells(state, mover);
    // (6,4) should be excluded — it's the destination of the in-flight stack
    expect(cells.some((c) => c.col === 6 && c.row === 4)).toBe(false);
    // (5,4) is still reachable (in-flight target blocks only (6,4))
    expect(cells.some((c) => c.col === 5 && c.row === 4)).toBe(true);
  });

  it('getAttackTargetIds returns enemy stacks within attack range', () => {
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 4, 4);
    const d1 = { ...baseStack(), stackId: 'd1', side: 'defender' as const };
    placeStack(d1, 5, 4);
    const d2 = { ...baseStack(), stackId: 'd2', side: 'defender' as const };
    placeStack(d2, 12, 4); // 8 cells ≈ 15.2vw > reach (2 + 1) * 3.5 = 10.5vw
    const state = makeState([attacker, d1, d2]);
    const targets = getAttackTargetIds(state, attacker);
    expect(targets).toContain('d1');
    expect(targets).not.toContain('d2');
    expect(targets).toHaveLength(1);
  });

  it('getAttackTargetIds uses absolute position — grid-far but visually close', () => {
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 2, 4); // x=6, y=14
    const far = { ...baseStack(), stackId: 'far', side: 'defender' as const };
    placeStack(far, 10, 4); // x=38, y=14 → visually far (32vw > 8vw range)
    far.x = 9; // override: now visually close to attacker (3vw < 8vw range)
    far.y = 14;
    const state = makeState([attacker, far]);
    const targets = getAttackTargetIds(state, attacker);
    expect(targets).toContain('far');
  });

  it('getAttackTargetIds uses absolute position — visually far but grid-close', () => {
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 2, 4); // x=6, y=14
    const near = { ...baseStack(), stackId: 'near', side: 'defender' as const };
    placeStack(near, 3, 4); // grid 1 cell away, but override x/y far
    near.x = 50;
    near.y = 50;
    const state = makeState([attacker, near]);
    const targets = getAttackTargetIds(state, attacker);
    expect(targets).not.toContain('near');
    expect(targets).toHaveLength(0);
  });

  it('getAttackTargetIds includes targets of moving stacks', () => {
    const attacker = { ...baseStack(), attackRange: 2, moving: true };
    placeStack(attacker, 2, 4);
    const target = { ...baseStack(), stackId: 'd1', side: 'defender' as const, moving: true };
    placeStack(target, 3, 4); // x=10, distance=4vw ≤ 8vw range
    const state = makeState([attacker, target]);
    expect(getAttackTargetIds(state, attacker)).toContain('d1');
  });

  it('isAbsolutePositionInRange is inclusive at exactly the range boundary', () => {
    // BATTLE_RANGE_UNIT_VW = 3.5, so range 2 = 7vw regardless of grid density.
    const a = { x: 5.25, y: 12.25 };
    const rangeCells = 2; // 7vw
    const boundary = { x: 12.25, y: 12.25 }; // distance = 7vw exactly
    expect(isAbsolutePositionInRange(a, boundary, rangeCells)).toBe(true);
    const justOutside = { x: 12.26, y: 12.25 };
    expect(isAbsolutePositionInRange(a, justOutside, rangeCells)).toBe(false);
  });

  it('computeCarrierBoostTargets uses absolute range and ignores non-carrier type', () => {
    const carrier = { ...baseStack(), stackId: 'carrier:0', typeId: 'carrier', attackRange: 4 };
    placeStack(carrier, 2, 4); // reach (4 + 1) * 3.5 = 17.5vw
    const allyNear = { ...baseStack(), stackId: 'ally:near', side: 'attacker' as const };
    placeStack(allyNear, 4, 4); // 2 cells ≈ 3.8vw
    const allyFar = { ...baseStack(), stackId: 'ally:far', side: 'attacker' as const };
    placeStack(allyFar, 14, 4); // 12 cells ≈ 22.7vw > 17.5vw
    const enemy = { ...baseStack(), stackId: 'enemy:0', side: 'defender' as const };
    placeStack(enemy, 3, 4); // in reach, but enemy side
    const state = makeState([carrier, allyNear, allyFar, enemy]);
    const targets = computeCarrierBoostTargets(state, carrier);
    expect(targets).toContain('ally:near');
    expect(targets).not.toContain('ally:far');
    expect(targets).not.toContain('enemy:0');
  });

  it('getMoveToAttackCells finds cells within absolute range of the target position', () => {
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 2, 4); // x=6, y=14
    const target = { ...baseStack(), stackId: 'd1', side: 'defender' as const };
    placeStack(target, 5, 4); // x=18, y=14
    const state = makeState([attacker, target]);
    const cells = getMoveToAttackCells(state, attacker, target);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const cellCenter = stackCenterVw({ ...attacker, col: cell.col, row: cell.row });
      expect(isAbsolutePositionInRange(cellCenter, target, attacker.attackRange)).toBe(true);
    }
  });

  it('getMoveToAttackTargetIds uses absolute range', () => {
    const attacker = { ...baseStack(), attackRange: 2 };
    placeStack(attacker, 2, 4); // x=6, y=14
    const inRange = { ...baseStack(), stackId: 'd1', side: 'defender' as const };
    placeStack(inRange, 3, 3); // different row — in range but does not block path
    const outOfRange = { ...baseStack(), stackId: 'd2', side: 'defender' as const };
    placeStack(outOfRange, 12, 4); // ≈ 15.2vw > 10.5vw reach
    const state = makeState([attacker, inRange, outOfRange]);
    const movableTargets = getMoveToAttackTargetIds(state, attacker);
    expect(movableTargets).not.toContain('d1');
    expect(movableTargets).toContain('d2');
  });

  it('getOccupiedCells respects size and side direction', () => {
    const attacker = { ...baseStack(), stackId: 'a', side: 'attacker' as const, col: 2, row: 4, size: 3 };
    const defender = { ...baseStack(), stackId: 'd', side: 'defender' as const, col: 17, row: 4, size: 2 };
    expect(getOccupiedCells(attacker)).toEqual([
      { col: 2, row: 4 },
      { col: 3, row: 4 },
      { col: 4, row: 4 },
    ]);
    expect(getOccupiedCells(defender)).toEqual([
      { col: 16, row: 4 },
      { col: 17, row: 4 },
    ]);
  });

  it('isOccupied blocks wider stacks', () => {
    const blocker = { ...baseStack(), stackId: 'b', side: 'defender' as const, col: 4, row: 4, size: 2 };
    const state = makeState([blocker]);
    expect(isOccupied(state, 3, 4)).toBe(true);
    expect(isOccupied(state, 4, 4)).toBe(true);
    expect(isOccupied(state, 5, 4)).toBe(false);
  });

  it('getReachableCells blocks wider stacks and path', () => {
    const stack = { ...baseStack(), col: 2, row: 4, size: 2 };
    const blocker = { ...baseStack(), stackId: 'blocker', side: 'defender' as const, col: 5, row: 4, size: 2 };
    const state = makeState([stack, blocker]);
    const cells = getReachableCells(state, stack);
    expect(cells.some((c) => c.col === 4 && c.row === 4)).toBe(false);
    expect(cells.some((c) => c.col === 5 && c.row === 4)).toBe(false);
  });

  it('isPathClear checks all occupied cells along the path', () => {
    const stack = { ...baseStack(), stackId: 'a', side: 'attacker' as const, col: 2, row: 4, size: 2 };
    const blocker = { ...baseStack(), stackId: 'b', side: 'defender' as const, col: 5, row: 4, size: 1 };
    const state = makeState([stack, blocker]);
    const path = linePath({ col: 2, row: 4 }, { col: 5, row: 4 })!;
    expect(isPathClear(state, path, stack)).toBe(false);
  });

  it('findApproachCell moves a blocked stack closer instead of away', () => {
    const attacker = { ...baseStack(), attackRange: 1, stackId: 'a' };
    placeStack(attacker, 2, 8);
    const target = { ...baseStack(), stackId: 't', side: 'defender' as const };
    placeStack(target, 30, 8);
    // Wall of blockers across every row just in front of the target, so no
    // firing cell (range 1 * 0.9) is reachable.
    const wall: BattleStack[] = [];
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      const b = { ...baseStack(), stackId: `w${r}`, side: 'defender' as const };
      placeStack(b, 28, r);
      wall.push(b);
    }
    const state = makeState([attacker, target, ...wall]);
    expect(findBestMoveToAttackCell(state, attacker, target)).toBeNull();
    const cell = findApproachCell(state, attacker, target)!;
    expect(cell).not.toBeNull();
    const before = absoluteDistanceVw(attacker, target);
    const after = absoluteDistanceVw(stackCenterVw({ ...attacker, col: cell.col, row: cell.row }), target);
    expect(after).toBeLessThan(before);
    expect(cell.col).toBeLessThan(28);
  });

  it('findApproachCell returns null when the stack cannot get any closer', () => {
    const attacker = { ...baseStack(), attackRange: 1, stackId: 'a' };
    placeStack(attacker, 27, 8);
    const target = { ...baseStack(), stackId: 't', side: 'defender' as const };
    placeStack(target, 30, 8);
    const blockers: BattleStack[] = [];
    for (const [c, r] of [[28, 7], [28, 8], [28, 9], [27, 7], [27, 9], [26, 7], [26, 8], [26, 9]]) {
      const b = { ...baseStack(), stackId: `b${c}-${r}`, side: 'defender' as const };
      placeStack(b, c, r);
      blockers.push(b);
    }
    const state = makeState([attacker, target, ...blockers]);
    expect(findApproachCell(state, attacker, target)).toBeNull();
  });
});

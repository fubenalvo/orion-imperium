import { describe, it, expect } from 'vitest';
import { BattleModelState, BattleStack, GridCell } from './battle.types';
import { BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS } from './battle.types';
import {
  cellDistance,
  getAttackTargetIds,
  getReachableCells,
  isInRange,
  isInBounds,
  isOccupied,
  linePath,
} from './battle-grid';

function baseStack(): BattleStack {
  return {
    stackId: 'attacker:fighter:0',
    side: 'attacker',
    typeId: 'fighter',
    typeName: 'Fighter',
    col: 2,
    row: 4,
    ships: [],
    tier: 1,
    moveApPerCell: 1,
    attackAp: 1,
    moveRange: 5,
    attackRange: 2,
    immobile: false,
    cellsMovedThisTurn: 0,
    attackedThisTurn: false,
    moving: false,
    firing: false,
    moveMs: 180,
    destroyed: false,
  };
}

function makeState(stacks: BattleStack[]): BattleModelState {
  return {
    round: 1,
    activeSide: 'attacker',
    ap: 10,
    apPerTurn: 10,
    stacks,
    phase: 'playerTurn',
    log: [],
    effect: null,
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
  it('bounds match the System View grid (18 x 7 cells)', () => {
    expect(BATTLE_GRID_COLUMNS).toBe(18);
    expect(BATTLE_GRID_ROWS).toBe(7);
    expect(isInBounds(1, 1)).toBe(true);
    expect(isInBounds(18, 7)).toBe(true);
    expect(isInBounds(0, 4)).toBe(false);
    expect(isInBounds(19, 4)).toBe(false);
    expect(isInBounds(1, 8)).toBe(false);
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

  it('getReachableCells stays within moveRange, AP budget, and clear paths', () => {
    const stack = { ...baseStack(), col: 2, row: 4, moveRange: 2, moveApPerCell: 1 };
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
    // beyond moveRange is not reachable
    expect(cells.some((c) => c.col === 5 && c.row === 4)).toBe(false);
  });

  it('getReachableCells is empty when AP is exhausted', () => {
    const stack = { ...baseStack(), col: 2, row: 4, moveRange: 5, moveApPerCell: 1 };
    const state = makeState([stack]);
    state.ap = 0;
    expect(getReachableCells(state, stack)).toHaveLength(0);
  });

  it('getAttackTargetIds returns enemy stacks within attack range', () => {
    const attacker = { ...baseStack(), attackRange: 2, col: 4, row: 4 };
    const state = makeState([
      attacker,
      { ...baseStack(), stackId: 'd1', side: 'defender', col: 5, row: 4 },
      { ...baseStack(), stackId: 'd2', side: 'defender', col: 9, row: 4 },
    ]);
    const targets = getAttackTargetIds(state, attacker);
    expect(targets).toContain('d1');
    expect(targets).not.toContain('d2');
    expect(targets).toHaveLength(1);
  });
});

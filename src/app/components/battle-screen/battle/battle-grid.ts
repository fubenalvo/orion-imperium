import type { BattleModelState, BattleStack, GridCell } from './battle.types';
import { BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS, BATTLE_CELL_SIZE_VW } from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — GRID HELPERS
 * =========================================================
 *
 * Pure grid math: bounds, occupancy, distance, and cell↔vw conversion.
 * The coordinate system mirrors the System View grid concepts:
 * 1-indexed cells and 5vw cell size (floor(vw / 5) + 1).
 */

export function isInBounds(col: number, row: number): boolean {
  return col >= 1 && col <= BATTLE_GRID_COLUMNS && row >= 1 && row <= BATTLE_GRID_ROWS;
}

/* Euclidean cell distance — matches the project-wide sensor-range convention. */
export function cellDistance(a: GridCell, b: GridCell): number {
  const dc = a.col - b.col;
  const dr = a.row - b.row;
  return Math.sqrt(dc * dc + dr * dr);
}

export function isInRange(a: GridCell, b: GridCell, range: number): boolean {
  const dc = a.col - b.col;
  const dr = a.row - b.row;
  return dc * dc + dr * dr <= range * range;
}

export function isOccupied(
  state: BattleModelState,
  col: number,
  row: number,
  excludeStackId?: string,
): boolean {
  return state.stacks.some(
    (s) => !s.destroyed && s.stackId !== excludeStackId && s.col === col && s.row === row,
  );
}

/* Stack at a cell, or null. */
export function getStackAt(state: BattleModelState, col: number, row: number): BattleStack | null {
  return (
    state.stacks.find((s) => !s.destroyed && s.col === col && s.row === row) ?? null
  );
}

export function getAliveStackCount(state: BattleModelState, side: 'attacker' | 'defender'): number {
  return state.stacks.filter((s) => !s.destroyed && s.side === side).length;
}

/* vw position of a cell centre, relative to the battle grid container. */
export function cellToVw(cell: GridCell): { x: number; y: number } {
  return {
    x: (cell.col - 0.5) * BATTLE_CELL_SIZE_VW,
    y: (cell.row - 0.5) * BATTLE_CELL_SIZE_VW,
  };
}

/*
 * Straight-line path from → to (orthogonal + diagonal steps). Returns
 * the list of intermediate cells (excluding the origin) or null when the
 * path is degenerate. Each step advances one cell along the dominant axis.
 */
export function linePath(from: GridCell, to: GridCell): GridCell[] | null {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  const steps = Math.max(Math.abs(dc), Math.abs(dr));
  if (steps === 0) {
    return null;
  }
  const cells: GridCell[] = [];
  for (let k = 1; k <= steps; k++) {
    cells.push({
      col: from.col + Math.round((dc / steps) * k),
      row: from.row + Math.round((dr / steps) * k),
    });
  }
  return cells;
}

/*
 * Cells a stack may legally move to right now: within its remaining
 * moveRange (already reduced by cells moved this turn) and its remaining
 * AP budget, in bounds, unoccupied, and reachable on a clear straight
 * line. Purely geometric — the caller decides who may actually act.
 */
export function getReachableCells(state: BattleModelState, stack: BattleStack): GridCell[] {
  if (stack.destroyed || stack.immobile) {
    return [];
  }
  const maxSteps = Math.min(
    stack.moveRange - stack.cellsMovedThisTurn,
    Math.floor(state.ap / stack.moveApPerCell),
  );
  if (maxSteps <= 0) {
    return [];
  }
  const origin: GridCell = { col: stack.col, row: stack.row };
  const cells: GridCell[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      if (c === stack.col && r === stack.row) {
        continue;
      }
      const steps = Math.max(Math.abs(c - stack.col), Math.abs(r - stack.row));
      if (steps > maxSteps) {
        continue;
      }
      if (isOccupied(state, c, r, stack.stackId)) {
        continue;
      }
      const path = linePath(origin, { col: c, row: r });
      if (!path || path.some((cell) => isOccupied(state, cell.col, cell.row, stack.stackId))) {
        continue;
      }
      cells.push({ col: c, row: r });
    }
  }
  return cells;
}

/* Enemy stacks within a stack's attack range (ids only). */
export function getAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  const origin: GridCell = { col: stack.col, row: stack.row };
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side && isInRange(origin, s, stack.attackRange))
    .map((s) => s.stackId);
}

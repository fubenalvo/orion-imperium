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

/*
 * =========================================================
 *  WEAPON EFFECTIVENESS
 *  =========================================================
 *
 * Every ship declares one attackType and one weakness in ship-data.json.
 * This table maps (attacker attackType, target weakness) to a per-volley
 * damage multiplier. The target's own weakness type is resisted (0.5x);
 * each attacker type also has one strong matchup (1.5x) and one neutral
 * matchup (1.0x). Pure and deterministic — no randomness, no per-ship
 * abilities, no ammo or cooldowns.
 */

export type WeaponType = 'kinetic' | 'energy' | 'missile';

const WEAPON_EFFECTIVENESS: Record<WeaponType, Record<WeaponType, number>> = {
  kinetic: { kinetic: 0.5, energy: 1.5, missile: 1.0 },
  energy: { kinetic: 1.0, energy: 0.5, missile: 1.5 },
  missile: { kinetic: 1.5, energy: 1.0, missile: 0.5 },
};

export function weaponMultiplier(attackerType: string, targetWeakness: string): number {
  const row = WEAPON_EFFECTIVENESS[attackerType as WeaponType];
  if (!row) {
    return 1.0;
  }
  return row[targetWeakness as WeaponType] ?? 1.0;
}

/*
 * Applies one shield-regen tick, capped at max. Kept as a single pure
 * helper so per-ship regen, shared planetary-pool regen, and Carrier Shield
 * Pulse cannot drift apart.
 */
export function applyShieldRegen(current: number, max: number, regen: number): number {
  if (regen <= 0 || max <= 0) {
    return current;
  }
  return Math.min(max, current + regen);
}

/*
 * =========================================================
 *  ROLE-AWARE TARGET SCORING
 *  =========================================================
 *
 * The tactical AI scores in-range enemy candidates before attacking. The
 * score is a pure, deterministic function of the attacker's role, the
 * target's role, and the target's existing combat stats — no new data,
 * no randomness, no lookahead.
 *
 *   score = rolePriority * 1000 + threatWeight * 10 + (maxRange - distance)
 *
 * Higher is better. Ties fall through to distance (nearest first) and
 * finally to stackId, so the choice is always unique.
 */

/* Coarse priority of target roles. Capital ships and fleet-support ships
 * are the most valuable; fragile support/immobile targets are the least.
 * Values are arbitrary constants — only their relative order matters. */
const TARGET_ROLE_PRIORITY: Record<string, number> = {
  'Capital Ship': 6,
  'Heavy Assault': 5,
  'Heavy Combat': 5,
  'Fleet Support': 5,
  'Anti-Ship': 4,
  'Line Ship': 4,
  'Escort': 3,
  'Light Combat': 3,
  'Interceptor': 2,
  'Recon': 2,
  'Colonizer': 1,
  'defense': 1,
};

/* Threat weight derived from the target's existing combat stats. Pure
 * read — no combat logic duplicated. */
function threatWeight(stack: BattleStack): number {
  const totalAttack = stack.ships.reduce((sum, s) => (s.alive ? sum + s.attack : sum), 0);
  const totalHp = stack.ships.reduce((sum, s) => (s.alive ? sum + s.hp : sum), 0);
  // 0..100 scale: attack dominates, HP is a secondary signal.
  const attackPart = Math.min(40, totalAttack * 0.5);
  const hpPart = Math.min(10, totalHp * 0.02);
  return Math.round(attackPart + hpPart);
}

export function computeTargetScore(
  attacker: BattleStack,
  target: BattleStack,
  distance: number,
): number {
  const rolePriority = TARGET_ROLE_PRIORITY[target.role ?? 'Light Combat'] ?? 3;
  const threat = threatWeight(target);
  // Prefer the attacker's own role class slightly: an Anti-Ship role
  // prefers high-value targets, an Interceptor prefers low-value ones.
  const attackerPriority = TARGET_ROLE_PRIORITY[attacker.role ?? 'Light Combat'] ?? 3;
  const roleBonus = attackerPriority >= 4 && rolePriority >= 4 ? 50 : 0;
  return rolePriority * 1000 + threat * 10 + roleBonus + (attacker.attackRange - distance);
}

export function isOccupied(
  state: BattleModelState,
  col: number,
  row: number,
  excludeStackId?: string,
): boolean {
  return state.stacks.some(
    (s) => !s.destroyed && s.stackId !== excludeStackId && occupiesCell(s, col, row),
  );
}

export function occupiesCell(stack: BattleStack, col: number, row: number): boolean {
  if (stack.row !== row) {
    return false;
  }
  const direction = stack.side === 'attacker' ? 1 : -1;
  for (let i = 0; i < stack.size; i++) {
    if (stack.col + i * direction === col) {
      return true;
    }
  }
  return false;
}

export function getOccupiedCells(stack: BattleStack): GridCell[] {
  const cells: GridCell[] = [];
  const direction = stack.side === 'attacker' ? 1 : -1;
  for (let i = 0; i < stack.size; i++) {
    cells.push({
      col: stack.col + i * direction,
      row: stack.row,
    });
  }
  if (stack.side === 'defender') {
    cells.reverse();
  }
  return cells;
}

/* Stack at a cell, or null. */
export function getStackAt(state: BattleModelState, col: number, row: number): BattleStack | null {
  return (
    state.stacks.find((s) => !s.destroyed && occupiesCell(s, col, row)) ?? null
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

/* Visual centre of a sized stack, accounting for side direction. */
export function stackCenterVw(stack: BattleStack): { x: number; y: number } {
  const offset = (stack.size - 1) / 2;
  const visualCol = stack.side === 'attacker' ? stack.col + offset : stack.col - offset;
  return {
    x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW,
    y: (stack.row - 0.5) * BATTLE_CELL_SIZE_VW,
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
      const destCols = occupiedCols(stack, c);
      if (destCols.some((dc) => !isInBounds(dc, r) || isOccupied(state, dc, r, stack.stackId))) {
        continue;
      }
      const path = linePath(origin, { col: c, row: r });
      if (!path || !isPathClear(state, path, stack)) {
        continue;
      }
      cells.push({ col: c, row: r });
    }
  }
  return cells;
}

function occupiedCols(stack: BattleStack, anchorCol: number): number[] {
  const cols: number[] = [];
  const direction = stack.side === 'attacker' ? 1 : -1;
  for (let i = 0; i < stack.size; i++) {
    cols.push(anchorCol + i * direction);
  }
  return cols;
}

export function isPathClear(
  state: BattleModelState,
  path: GridCell[],
  stack: BattleStack,
): boolean {
  for (const cell of path) {
    const cols = occupiedCols(stack, cell.col);
    if (cols.some((c) => !isInBounds(c, cell.row) || isOccupied(state, c, cell.row, stack.stackId))) {
      return false;
    }
  }
  return true;
}

/* Enemy stacks within a stack's attack range (ids only). */
export function getAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  const origin: GridCell = { col: stack.col, row: stack.row };
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side && isInRange(origin, s, stack.attackRange))
    .map((s) => s.stackId);
}

/*
 * Friendly stacks within a Carrier's attack range (ids only). Used by the
 * Shield Pulse action to highlight which allies would be restored. Pure
 * read of existing state — no combat logic duplicated here.
 */
export function computeCarrierBoostTargets(
  state: BattleModelState,
  carrier: BattleStack,
): string[] {
  if (carrier.typeId !== 'carrier' || carrier.destroyed) {
    return [];
  }
  const origin: GridCell = { col: carrier.col, row: carrier.row };
  return state.stacks
    .filter(
      (s) =>
        !s.destroyed &&
        s.side === carrier.side &&
        s.stackId !== carrier.stackId &&
        isInRange(origin, s, carrier.attackRange),
    )
    .map((s) => s.stackId);
}

/*
 * Cells from which a stack could attack a specific target stack.
 * Returns all unoccupied cells within the stack's moveRange that have
 * the target within attackRange and a clear straight-line path.
 */
export function getMoveToAttackCells(
  state: BattleModelState,
  stack: BattleStack,
  targetStack: BattleStack,
): GridCell[] {
  if (stack.destroyed || stack.immobile || targetStack.destroyed) {
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
      const destCols = occupiedCols(stack, c);
      if (destCols.some((dc) => !isInBounds(dc, r) || isOccupied(state, dc, r, stack.stackId))) {
        continue;
      }
      const path = linePath(origin, { col: c, row: r });
      if (!path || !isPathClear(state, path, stack)) {
        continue;
      }
      if (isInRange({ col: c, row: r }, targetStack, stack.attackRange)) {
        cells.push({ col: c, row: r });
      }
    }
  }
  return cells;
}

/*
 * Returns the single best cell for move-to-attack: closest to attacker
 * (minimizes move cost), breaking ties by closest to target.
 */
export function findBestMoveToAttackCell(
  state: BattleModelState,
  stack: BattleStack,
  targetStack: BattleStack,
): GridCell | null {
  const candidates = getMoveToAttackCells(state, stack, targetStack);
  if (candidates.length === 0) {
    return null;
  }
  const origin: GridCell = { col: stack.col, row: stack.row };
  return candidates.reduce((best, cell) => {
    const bestDist = Math.max(Math.abs(best.col - origin.col), Math.abs(best.row - origin.row));
    const cellDist = Math.max(Math.abs(cell.col - origin.col), Math.abs(cell.row - origin.row));
    if (cellDist < bestDist) {
      return cell;
    }
    if (cellDist === bestDist) {
      const bestToTarget = Math.max(Math.abs(best.col - targetStack.col), Math.abs(best.row - targetStack.row));
      const cellToTarget = Math.max(Math.abs(cell.col - targetStack.col), Math.abs(cell.row - targetStack.row));
      if (cellToTarget < bestToTarget) {
        return cell;
      }
    }
    return best;
  });
}

/*
 * Enemy stacks that are within (moveRange + attackRange) but outside direct attackRange.
 * These are valid move-to-attack targets.
 */
export function getMoveToAttackTargetIds(
  state: BattleModelState,
  stack: BattleStack,
): string[] {
  if (stack.destroyed || stack.immobile) {
    return [];
  }
  const maxMoveSteps = Math.min(
    stack.moveRange - stack.cellsMovedThisTurn,
    Math.floor(state.ap / stack.moveApPerCell),
  );
  if (maxMoveSteps <= 0) {
    return [];
  }
  const origin: GridCell = { col: stack.col, row: stack.row };
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side)
    .filter((s) => {
      const directDist = Math.max(Math.abs(s.col - origin.col), Math.abs(s.row - origin.row));
      if (directDist <= stack.attackRange) {
        return false; // Already in direct attack range
      }
      const minDistToAttack = Math.max(Math.abs(s.col - origin.col), Math.abs(s.row - origin.row)) - stack.attackRange;
      return minDistToAttack <= maxMoveSteps;
    })
    .filter((s) => {
      // Check if there's at least one valid move-to-attack cell
      return getMoveToAttackCells(state, stack, s).length > 0;
    })
    .map((s) => s.stackId);
}

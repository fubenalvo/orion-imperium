import type { BattleModelState, BattleStack, GridCell, BattleShieldPool } from './battle.types';
import {
  BATTLE_GRID_COLUMNS,
  BATTLE_GRID_ROWS,
  BATTLE_CELL_WIDTH_VW,
  BATTLE_CELL_HEIGHT_VW,
  BATTLE_CELL_SIZE_VW,
  AI_ACTION_INTERVAL_MS,
  SHIELD_REGEN_INTERVAL_MS,
  AI_MOVE_TO_ATTACK_RATIO,
  AI_DISPERSION_WEIGHT,
} from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — GRID HELPERS
 * =========================================================
 *
 * Pure grid math: bounds, occupancy, distance, and cell↔vw conversion.
 * The coordinate system mirrors the System View grid concepts:
 * 1-indexed cells and 4vw cell size.
 */

export { BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS, BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW, BATTLE_CELL_SIZE_VW };

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

export function absoluteDistanceVw(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function absoluteDistanceCells(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return absoluteDistanceVw(a, b) / BATTLE_CELL_SIZE_VW;
}

export function isAbsolutePositionInRange(
  from: { x: number; y: number },
  to: { x: number; y: number },
  range: number,
): boolean {
  const rangeVw = range * BATTLE_CELL_SIZE_VW;
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return dx * dx + dy * dy <= rangeVw * rangeVw;
}

export function isAbsoluteInRange(
  attacker: BattleStack,
  target: BattleStack,
  range: number,
): boolean {
  return isAbsolutePositionInRange(attacker, target, range);
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
  Escort: 3,
  'Light Combat': 3,
  Interceptor: 2,
  Recon: 2,
  Colonizer: 1,
  defense: 1,
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
  /*
   * Checks static physical occupancy — whether any living stack's
   * current grid position (col/row) covers the queried cell.
   * In-flight stacks (targetX/targetY set) are NOT checked here;
   * their destination reservation is handled by `isCellReserved`,
   * which `isPathClear` applies to destination cells only.
   */
  return state.stacks.some((s) => {
    if (s.destroyed || s.stackId === excludeStackId) return false;
    return occupiesCell(s, col, row);
  });
}

/*
 * Checks whether a cell is the reserved destination of an in-flight stack.
 * An in-flight stack (moving = true, targetX/targetY set) claims its
 * destination cell so that no other stack is sent to the same cell.
 * The excludeStackId guard lets a stack check without blocking itself.
 */
export function isCellReserved(
  state: BattleModelState,
  col: number,
  row: number,
  excludeStackId?: string,
): boolean {
  return state.stacks.some((s) => {
    if (s.destroyed || s.stackId === excludeStackId || !s.moving) return false;
    if (s.targetX == null || s.targetY == null) return false;
    const targetCell = vwToStackCell(s, s.targetX, s.targetY);
    return occupiesCell({ ...s, col: targetCell.col, row: targetCell.row }, col, row);
  });
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
  return state.stacks.find((s) => !s.destroyed && occupiesCell(s, col, row)) ?? null;
}

export function getAliveStackCount(state: BattleModelState, side: 'attacker' | 'defender'): number {
  return state.stacks.filter((s) => !s.destroyed && s.side === side).length;
}

/* vw position of a cell centre, relative to the battle grid container. */
export function cellToVw(cell: GridCell): { x: number; y: number } {
  return {
    x: (cell.col - 0.5) * BATTLE_CELL_WIDTH_VW,
    y: (cell.row - 0.5) * BATTLE_CELL_HEIGHT_VW,
  };
}

/* Visual centre of a sized stack, accounting for side direction. */
export function stackCenterVw(stack: BattleStack): { x: number; y: number } {
  const offset = (stack.size - 1) / 2;
  const visualCol = stack.side === 'attacker' ? stack.col + offset : stack.col - offset;
  return {
    x: (visualCol - 0.5) * BATTLE_CELL_WIDTH_VW,
    y: (stack.row - 0.5) * BATTLE_CELL_HEIGHT_VW,
  };
}

/* Convert vw coordinates to the anchor grid cell for a stack. */
export function vwToStackCell(stack: BattleStack, x: number, y: number): GridCell {
  const visualCol = x / BATTLE_CELL_WIDTH_VW + 0.5;
  const direction = stack.side === 'attacker' ? 1 : -1;
  const offset = (stack.size - 1) / 2;
  const anchorCol = Math.max(
    1,
    Math.min(BATTLE_GRID_COLUMNS, Math.round(visualCol - direction * offset)),
  );
  const row = Math.max(1, Math.min(BATTLE_GRID_ROWS, Math.round(y / BATTLE_CELL_HEIGHT_VW + 0.5)));
  return { col: anchorCol, row };
}

/*
 * Victory check: returns true if battle is over (one side has no alive stacks).
 * Sets state.winner and returns true if battle ended.
 */
export function checkVictory(state: BattleModelState): boolean {
  if (state.winner) {
    return true;
  }
  const attackerAlive = getAliveStackCount(state, 'attacker');
  const defenderAlive = getAliveStackCount(state, 'defender');
  if (attackerAlive === 0 || defenderAlive === 0) {
    state.winner = attackerAlive > 0 ? 'attacker' : 'defender';
    return true;
  }
  return false;
}

/*
 * Regenerate shields for all living ships on both sides + shared planetary shield pool.
 * Called periodically (every SHIELD_REGEN_INTERVAL_MS) by the game loop.
 */
export function regenerateAllShields(state: BattleModelState): void {
  for (const stack of state.stacks) {
    if (stack.destroyed) continue;
    for (const ship of stack.ships) {
      if (!ship.alive) continue;
      const regen = ship.shieldRegen ?? 0;
      if (regen <= 0) continue;
      const current = ship.shield ?? 0;
      const max = ship.maxShield ?? 0;
      ship.shield = applyShieldRegen(current, max, regen);
    }
  }
  // Shared planetary shield pool (planet battles only)
  const pool = state.defenderShieldPool;
  if (pool && pool.regen > 0) {
    pool.current = applyShieldRegen(pool.current, pool.max, pool.regen);
  }
}

/*
 * Update all stacks' positions toward their targets.
 * Called every frame by the game loop with scaled delta time (seconds).
 * Moves stacks at speed vw/s toward targetX/targetY.
 * When a stack reaches its target, snaps position and updates col/row.
 *
 * When deltaTime === 0 (battle paused), positions don't change and
 * stacks remain in 'moving' state so connection lines stay visible.
 */
export function updateStackPositions(
  state: BattleModelState,
  deltaTime: number,
  onComplete?: (stackId: string) => void,
): void {
  for (const stack of state.stacks) {
    const hasTarget = stack.targetX != null && stack.targetY != null;

    if (stack.destroyed) {
      if (hasTarget && onComplete) {
        onComplete(stack.stackId);
      }
      stack.targetX = null;
      stack.targetY = null;
      stack.moving = false;
      continue;
    }

    if (!hasTarget) {
      continue;
    }

    // At this point, targetX and targetY are guaranteed to be non-null
    const targetX = stack.targetX!;
    const targetY = stack.targetY!;

    const dx = targetX - stack.x;
    const dy = targetY - stack.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // When paused (deltaTime === 0), don't complete movement —
    // keep stack.moving = true so connection lines remain visible and animated.
    if (deltaTime <= 0) {
      if (dist > 0.01) {
        stack.moving = true;
      }
      continue;
    }

    if (dist <= 0.01) {
      stack.x = targetX;
      stack.y = targetY;
      stack.targetX = null;
      stack.targetY = null;
      const cell = vwToStackCell(stack, stack.x, stack.y);
      stack.col = cell.col;
      stack.row = cell.row;
      const wasMoving = stack.moving;
      stack.moving = false;
      if (wasMoving && onComplete) {
        onComplete(stack.stackId);
      }
    } else {
      const step = Math.min(stack.speed * deltaTime, dist);
      stack.x += (dx / dist) * step;
      stack.y += (dy / dist) * step;
      stack.moving = true;
    }
  }
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
 * Cells a stack may legally move to right now: in bounds, unoccupied,
 * and reachable on a clear straight line. No AP or moveRange limits.
 * Purely geometric — the caller decides who may actually act.
 */
export function getReachableCells(state: BattleModelState, stack: BattleStack): GridCell[] {
  if (stack.destroyed || stack.immobile) {
    return [];
  }
  const origin: GridCell = { col: stack.col, row: stack.row };
  const cells: GridCell[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      if (c === stack.col && r === stack.row) {
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

export function occupiedCols(stack: BattleStack, anchorCol: number): number[] {
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
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const cols = occupiedCols(stack, cell.col);
    if (
      cols.some((c) => !isInBounds(c, cell.row) || isOccupied(state, c, cell.row, stack.stackId))
    ) {
      return false;
    }
    // Destination cell: also reject if reserved by another in-flight stack
    // (prevents two stacks from being sent to the same cell). Intermediate
    // path cells are NOT checked for reservations — stacks may pass through
    // cells that are another stack's destination.
    if (i === path.length - 1 && cols.some((c) => isCellReserved(state, c, cell.row, stack.stackId))) {
      return false;
    }
  }
  return true;
}

/* Enemy stacks within a stack's current absolute attack range (ids only). */
export function getAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  return state.stacks
    .filter(
      (s) =>
        !s.destroyed && s.side !== stack.side && isAbsoluteInRange(stack, s, stack.attackRange),
    )
    .map((s) => s.stackId);
}

/*
 * Friendly stacks within a Carrier's current absolute attack range (ids only). Used by the
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
  return state.stacks
    .filter(
      (s) =>
        !s.destroyed &&
        s.side === carrier.side &&
        s.stackId !== carrier.stackId &&
        isAbsoluteInRange(carrier, s, carrier.attackRange),
    )
    .map((s) => s.stackId);
}

/*
   * Cells from which a stack could attack a specific target stack.
   * Returns all unoccupied cells whose visual center has the target's current
   * absolute position within `effectiveRange` and that have a clear
   * straight-line path. Defaults to the stack's full attackRange so UI
   * highlights stay at full range; the AI passes a shrunk value to close
   * only to AI_MOVE_TO_ATTACK_RATIO of its range before stopping.
   */
  export function getMoveToAttackCells(
    state: BattleModelState,
    stack: BattleStack,
    targetStack: BattleStack,
    effectiveRange: number = stack.attackRange,
  ): GridCell[] {
    if (stack.destroyed || stack.immobile || targetStack.destroyed) {
      return [];
    }
    const origin: GridCell = { col: stack.col, row: stack.row };
    const cells: GridCell[] = [];
    for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
      for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
        if (c === stack.col && r === stack.row) {
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
        const candidateCenter = stackCenterVw({ ...stack, col: c, row: r });
        if (isAbsolutePositionInRange(candidateCenter, targetStack, effectiveRange)) {
          cells.push({ col: c, row: r });
        }
      }
    }
    return cells;
  }

/*
   * Returns the single best cell for move-to-attack.
   *
   * The candidate zone is shrunk to AI_MOVE_TO_ATTACK_RATIO of the
   * attacker's attack range, so the AI stops at ~75% of its range instead
   * of closing to point-blank. Attack resolution itself still uses the
   * full attackRange — this only decides WHERE the stack moves to.
   *
   * Scoring: moveCost − AI_DISPERSION_WEIGHT × minDistanceToAllies.
   * Move cost is the soft primary (a stack still closes efficiently), but
   * dispersion is a scored term rather than a pure tie-break: a tie-break
   * never fires because candidate cells rarely share an exact move cost,
   * so every stack would independently pick the same nearest cell and pile
   * up on one flank. With dispersion scored, a stack willingly takes a
   * slightly farther cell if it lands it far from its nearest ally, so the
   * fleet fans around the target. The candidate zone bounds how far a
   * stack can stray from the target, so it never abandons the attack
   * position. Tune AI_DISPERSION_WEIGHT freely.
   */
  export function findBestMoveToAttackCell(
    state: BattleModelState,
    stack: BattleStack,
    targetStack: BattleStack,
  ): GridCell | null {
    const candidates = getMoveToAttackCells(
      state,
      stack,
      targetStack,
      stack.attackRange * AI_MOVE_TO_ATTACK_RATIO,
    );
    if (candidates.length === 0) {
      return null;
    }
    const origin: GridCell = { col: stack.col, row: stack.row };
    const allies = state.stacks.filter(
      (s) => !s.destroyed && s.stackId !== stack.stackId && s.side === stack.side,
    );
    return candidates.reduce((best, cell) => {
      // Scored: moveCost − AI_DISPERSION_WEIGHT × minDistanceToAllies.
      // Dispersion is scored, not a tie-break, because candidate cells
      // rarely share an exact move cost — a tie-break would never fire
      // and every stack would independently pick the same nearest cell,
      // piling up on one flank. Scored, a stack willingly takes a slightly
      // farther cell if it lands it far from its nearest ally, so the
      // fleet fans around the target. The candidate zone bounds how far
      // a stack can stray from the target, so it never abandons the
      // attack position. Move cost remains the soft primary.
      const cellScore =
        chebyshev(origin, cell) - AI_DISPERSION_WEIGHT * minDistanceToAllies(cell, allies);
      const bestScore =
        chebyshev(origin, best) - AI_DISPERSION_WEIGHT * minDistanceToAllies(best, allies);
      if (cellScore < bestScore) {
        return cell;
      }
      if (cellScore > bestScore) {
        return best;
      }
      // Tie-break: closest to the target.
      const bestCenter = stackCenterVw({ ...stack, col: best.col, row: best.row });
      const cellCenter = stackCenterVw({ ...stack, col: cell.col, row: cell.row });
      const bestToTarget = absoluteDistanceCells(bestCenter, targetStack);
      const cellToTarget = absoluteDistanceCells(cellCenter, targetStack);
      if (cellToTarget < bestToTarget) {
        return cell;
      }
      if (cellToTarget > bestToTarget) {
        return best;
      }
      // Final tie-break: stable ordering on the cell itself.
      return cell.col < best.col || (cell.col === best.col && cell.row < best.row)
        ? cell
        : best;
    });
  }

  /* Chebyshev (king-move) distance between two grid cells — matches the
   * straight-line path step count used by linePath. */
  function chebyshev(a: GridCell, b: GridCell): number {
    return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  }

  /* Minimum Chebyshev distance from a candidate cell to any friendly
   * stack. Mid-flight allies use their reserved destination (targetX/Y)
   * so the crowding picture is accurate; settled allies use col/row. */
  function minDistanceToAllies(cell: GridCell, allies: BattleStack[]): number {
    let min = Infinity;
    for (const a of allies) {
      const anchor: GridCell =
        a.moving && a.targetX != null && a.targetY != null
          ? vwToStackCell(a, a.targetX, a.targetY)
          : { col: a.col, row: a.row };
      const d = chebyshev(cell, anchor);
      if (d < min) {
        min = d;
      }
    }
    return min === Infinity ? 0 : min;
  }

/*
 * Enemy stacks that are outside the current absolute attackRange but reachable
 * via a clear path. These are valid move-to-attack targets.
 * No AP or moveRange limits.
 */
export function getMoveToAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  if (stack.destroyed || stack.immobile) {
    return [];
  }
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side)
    .filter((s) => {
      if (isAbsoluteInRange(stack, s, stack.attackRange)) {
        return false; // Already in direct attack range
      }
      // Check if there's at least one valid move-to-attack cell
      return getMoveToAttackCells(state, stack, s).length > 0;
    })
    .map((s) => s.stackId);
}

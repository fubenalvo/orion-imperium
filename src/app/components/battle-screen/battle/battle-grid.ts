import type { BattleModelState, BattleStack, GridCell } from './battle.types';
import { maneuverSpeedFactor } from './battle-heading';
import {
  BATTLE_GRID_COLUMNS,
  BATTLE_GRID_ROWS,
  BATTLE_CELL_WIDTH_VW,
  BATTLE_CELL_HEIGHT_VW,
  BATTLE_RANGE_UNIT_VW,
  AI_MOVE_TO_ATTACK_RATIO,
  ATTACK_RANGE_TOLERANCE,
} from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — GRID HELPERS
 * =========================================================
 *
 * Pure grid math: bounds, occupancy, distance, and cell↔vw conversion.
 *
 * Two coordinate systems coexist:
 *   - Grid cells (col/row, 1-indexed) drive movement, pathing, occupancy
 *     and click targets. Their size depends on the grid density.
 *   - Absolute vw positions (stack.x/y) drive rendering and combat range.
 *     Range is measured in BATTLE_RANGE_UNIT_VW, which is independent of
 *     the grid density, so changing the grid never changes weapon reach.
 *
 * Grid searches (reachable cells, move-to-attack cells) go through an
 * OccupancyMap built once per search. On the 38x16 grid a naive search is
 * O(cells × path length × stacks) and ran several times per frame.
 */

export { BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS, BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW };

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

/* Absolute distance expressed in range units — directly comparable to the
 * attackRange stat. */
export function absoluteDistanceRangeUnits(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return absoluteDistanceVw(a, b) / BATTLE_RANGE_UNIT_VW;
}

export function isAbsolutePositionInRange(
  from: { x: number; y: number },
  to: { x: number; y: number },
  range: number,
): boolean {
  const rangeVw = range * BATTLE_RANGE_UNIT_VW;
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

/* Effective reach (range units) used by the canAttack gate. The UI range
 * indicator must use this value too, so it shows what the stack can
 * actually hit. */
export function effectiveAttackRange(stack: BattleStack): number {
  return stack.attackRange + ATTACK_RANGE_TOLERANCE;
}

/*
 * Authoritative attack gate: absolute x/y distance within
 * attackRange + ATTACK_RANGE_TOLERANCE. Using absolute positions (not
 * col/row) keeps this safe even if col/row desyncs from x/y mid-flight.
 */
export function canAttack(attacker: BattleStack, target: BattleStack): boolean {
  return isAbsolutePositionInRange(attacker, target, effectiveAttackRange(attacker));
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
 *  ROLE-AWARE TARGET SCORING ('balanced' targeting mode)
 *  =========================================================
 *
 * Pure, deterministic function of the attacker's role, the target's role,
 * and the target's existing combat stats — no new data, no randomness.
 *
 *   score = rolePriority * 1000 + threatWeight * 10 + roleBonus + (range - distance)
 *
 * Higher is better. battle-targeting.ts breaks remaining ties by distance
 * and stackId so the choice is always unique.
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

/* Threat weight derived from the target's existing combat stats. */
function threatWeight(stack: BattleStack): number {
  const totalAttack = stack.ships.reduce((sum, s) => (s.alive ? sum + s.attack : sum), 0);
  const totalHp = stack.ships.reduce((sum, s) => (s.alive ? sum + s.hp : sum), 0);
  // 0..100 scale: attack dominates, HP is a secondary signal.
  const attackPart = Math.min(40, totalAttack * 0.5);
  const hpPart = Math.min(10, totalHp * 0.02);
  return Math.round(attackPart + hpPart);
}

/* distance is in range units (absoluteDistanceRangeUnits). */
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

/*
 * =========================================================
 *  OCCUPANCY
 *  =========================================================
 *
 * A stack occupies `size` consecutive cells in its row, growing right from
 * the anchor for attackers and left for defenders (ships face the enemy).
 *
 * Static occupancy uses each living stack's current col/row. In-flight
 * stacks additionally reserve their destination footprint (isCellReserved)
 * so two stacks are never sent to the same cell; reservations only block
 * destination cells, not cells a path passes through.
 */

export function isOccupied(
  state: BattleModelState,
  col: number,
  row: number,
  excludeStackId?: string,
): boolean {
  return state.stacks.some((s) => {
    if (s.destroyed || s.stackId === excludeStackId) return false;
    return occupiesCell(s, col, row);
  });
}

/* Anchor cell of an in-flight stack's destination, or null if it is not moving. */
function reservedAnchor(s: BattleStack): GridCell | null {
  if (!s.moving || s.targetX == null || s.targetY == null) {
    return null;
  }
  return vwToStackCell(s, s.targetX, s.targetY);
}

export function isCellReserved(
  state: BattleModelState,
  col: number,
  row: number,
  excludeStackId?: string,
): boolean {
  return state.stacks.some((s) => {
    if (s.destroyed || s.stackId === excludeStackId) return false;
    const anchor = reservedAnchor(s);
    if (!anchor) return false;
    return occupiesCell({ ...s, col: anchor.col, row: anchor.row }, col, row);
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

export function occupiedCols(stack: BattleStack, anchorCol: number): number[] {
  const cols: number[] = [];
  const direction = stack.side === 'attacker' ? 1 : -1;
  for (let i = 0; i < stack.size; i++) {
    cols.push(anchorCol + i * direction);
  }
  return cols;
}

/*
 * Snapshot of static occupancy and destination reservations, excluding one
 * stack (the one being planned). Indexed by (row - 1) * COLUMNS + (col - 1).
 * Only valid until any stack moves — build a fresh one per search.
 */
export interface OccupancyMap {
  occupied: Uint8Array;
  reserved: Uint8Array;
}

function cellIndex(col: number, row: number): number {
  return (row - 1) * BATTLE_GRID_COLUMNS + (col - 1);
}

function markFootprint(map: Uint8Array, stack: BattleStack, anchor: GridCell): void {
  for (const c of occupiedCols(stack, anchor.col)) {
    if (isInBounds(c, anchor.row)) {
      map[cellIndex(c, anchor.row)] = 1;
    }
  }
}

export function buildOccupancyMap(state: BattleModelState, excludeStackId?: string): OccupancyMap {
  const size = BATTLE_GRID_COLUMNS * BATTLE_GRID_ROWS;
  const occupied = new Uint8Array(size);
  const reserved = new Uint8Array(size);
  for (const s of state.stacks) {
    if (s.destroyed || s.stackId === excludeStackId) continue;
    markFootprint(occupied, s, { col: s.col, row: s.row });
    const anchor = reservedAnchor(s);
    if (anchor) {
      markFootprint(reserved, s, anchor);
    }
  }
  return { occupied, reserved };
}

/* True when the stack's footprint anchored at (col,row) is in bounds and
 * not statically occupied (and, if requested, not reserved). */
function footprintFree(
  map: OccupancyMap,
  stack: BattleStack,
  col: number,
  row: number,
  checkReserved: boolean,
): boolean {
  for (const c of occupiedCols(stack, col)) {
    if (!isInBounds(c, row)) return false;
    const idx = cellIndex(c, row);
    if (map.occupied[idx]) return false;
    if (checkReserved && map.reserved[idx]) return false;
  }
  return true;
}

function isPathClearOnMap(map: OccupancyMap, path: GridCell[], stack: BattleStack): boolean {
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    // Destination cell: also reject if reserved by another in-flight stack.
    // Intermediate cells may pass through other stacks' destinations.
    if (!footprintFree(map, stack, cell.col, cell.row, i === path.length - 1)) {
      return false;
    }
  }
  return true;
}

export function isPathClear(
  state: BattleModelState,
  path: GridCell[],
  stack: BattleStack,
): boolean {
  return isPathClearOnMap(buildOccupancyMap(state, stack.stackId), path, stack);
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
export function stackCenterVw(stack: Pick<BattleStack, 'side' | 'size' | 'col' | 'row'>): { x: number; y: number } {
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
 * Moves stacks at speed vw/s toward targetX/targetY, scaled down while the
 * hull is still turning onto the course (maneuverSpeedFactor, battle-heading.ts).
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
      // A completed player move order hands the stack back to AUTO.
      stack.manualMoveOrder = false;
      if (wasMoving && onComplete) {
        onComplete(stack.stackId);
      }
    } else {
      // Slowed while the hull still points away from its course (see
      // battle-heading.ts), so ships turn into a move instead of sliding.
      const speed = stack.speed * maneuverSpeedFactor(stack, dx, dy);
      const step = Math.min(speed * deltaTime, dist);
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

/* True when the stack can legally move from its anchor to (col,row) on the
 * given map: destination footprint free and straight-line path clear. */
function canReachOnMap(map: OccupancyMap, stack: BattleStack, col: number, row: number): boolean {
  if (!footprintFree(map, stack, col, row, false)) {
    return false;
  }
  const path = linePath({ col: stack.col, row: stack.row }, { col, row });
  return !!path && isPathClearOnMap(map, path, stack);
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
  const map = buildOccupancyMap(state, stack.stackId);
  const cells: GridCell[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      if (c === stack.col && r === stack.row) {
        continue;
      }
      if (canReachOnMap(map, stack, c, r)) {
        cells.push({ col: c, row: r });
      }
    }
  }
  return cells;
}

/* Enemy stacks within a stack's current attack reach (ids only). */
export function getAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side && canAttack(stack, s))
    .map((s) => s.stackId);
}

/*
 * Friendly stacks within a Carrier's current attack reach (ids only). Used by
 * the Shield Pulse action and to highlight which allies would be restored.
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
        canAttack(carrier, s),
    )
    .map((s) => s.stackId);
}

/*
 * Cells from which a stack could attack a specific target stack.
 * Returns all unoccupied cells whose visual center has the target's current
 * absolute position within `effectiveRange` and that have a clear
 * straight-line path. Defaults to the stack's full attackRange; the AI
 * passes a shrunk value to close only to AI_MOVE_TO_ATTACK_RATIO of its
 * range before stopping.
 *
 * The cheap range test runs before the occupancy/path test, which prunes
 * most of the grid before any path is traced.
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
  const map = buildOccupancyMap(state, stack.stackId);
  const cells: GridCell[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      const candidateCenter = stackCenterVw({ side: stack.side, size: stack.size, col: c, row: r });
      if (!isAbsolutePositionInRange(candidateCenter, targetStack, effectiveRange)) {
        continue;
      }
      if (c === stack.col && r === stack.row) {
        // The current cell is a valid candidate when it is already in range:
        // a stack that reached a firing position may "stay put" instead of
        // being forced elsewhere (which caused oscillation when both the
        // attacker and the target were moving).
        cells.push({ col: c, row: r });
        continue;
      }
      if (canReachOnMap(map, stack, c, r)) {
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
 * attacker's attack range, so stacks stop short of point-blank. Attack
 * resolution itself still uses the full reach — this only decides WHERE
 * the stack moves to.
 *
 * Selection order (each step only breaks ties):
 *   1. Cell farthest from the nearest friendly ally (fan out so stacks
 *      don't pile up on the same firing position).
 *   2. Closest cell to the attacker (minimum move cost).
 *   3. Closest cell to the target.
 *   4. Stable ordering on the cell itself.
 */
export function findBestMoveToAttackCell(
  state: BattleModelState,
  stack: BattleStack,
  targetStack: BattleStack,
): GridCell | null {
  if (stack.destroyed || stack.immobile || targetStack.destroyed) {
    return null;
  }
  const effectiveRange = stack.attackRange * AI_MOVE_TO_ATTACK_RATIO;
  const map = buildOccupancyMap(state, stack.stackId);
  const origin: GridCell = { col: stack.col, row: stack.row };
  const allies = state.stacks.filter(
    (s) => !s.destroyed && s.stackId !== stack.stackId && s.side === stack.side,
  );

  // Rank the cheap-to-evaluate candidates first and trace straight-line
  // paths only until the first reachable one. Equivalent to filtering by
  // reachability and then picking the best, but traces far fewer paths —
  // this runs for every chasing stack on each re-plan.
  const candidates: { cell: GridCell; ally: number; cost: number; toTarget: number; current: boolean }[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      const center = stackCenterVw({ side: stack.side, size: stack.size, col: c, row: r });
      if (!isAbsolutePositionInRange(center, targetStack, effectiveRange)) {
        continue;
      }
      const current = c === stack.col && r === stack.row;
      if (!current && !footprintFree(map, stack, c, r, false)) {
        continue;
      }
      const cell = { col: c, row: r };
      candidates.push({
        cell,
        ally: minDistanceToAllies(cell, allies),
        cost: chebyshev(origin, cell),
        toTarget: absoluteDistanceVw(center, targetStack),
        current,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      b.ally - a.ally ||
      a.cost - b.cost ||
      a.toTarget - b.toTarget ||
      a.cell.col - b.cell.col ||
      a.cell.row - b.cell.row,
  );
  for (const candidate of candidates) {
    // The current cell needs no path (see getMoveToAttackCells).
    if (candidate.current || canReachOnMap(map, stack, candidate.cell.col, candidate.cell.row)) {
      return candidate.cell;
    }
  }
  return null;
}

/*
 * Fallback when no free cell brings the target into range (blocked by other
 * stacks or the straight-line path rule): the reachable cell that gets the
 * stack strictly closer to the target, nearest to the target first, then
 * cheapest to reach. Returns null when no reachable cell is closer than the
 * current position. Replaces the old behaviour of retreating away from the
 * enemy, which made blocked stacks drift out of the fight.
 */
export function findApproachCell(
  state: BattleModelState,
  stack: BattleStack,
  targetStack: BattleStack,
): GridCell | null {
  if (stack.destroyed || stack.immobile || targetStack.destroyed) {
    return null;
  }
  const map = buildOccupancyMap(state, stack.stackId);
  const origin: GridCell = { col: stack.col, row: stack.row };
  // Require meaningful progress (half a cell) so a stack does not shuffle
  // back and forth between two nearly equidistant cells.
  const minGainVw = BATTLE_CELL_HEIGHT_VW / 2;
  const maxDist = absoluteDistanceVw(stackCenterVw(stack), targetStack) - minGainVw;
  const candidates: { cell: GridCell; dist: number; cost: number }[] = [];
  for (let c = 1; c <= BATTLE_GRID_COLUMNS; c++) {
    for (let r = 1; r <= BATTLE_GRID_ROWS; r++) {
      if (c === stack.col && r === stack.row) continue;
      const center = stackCenterVw({ side: stack.side, size: stack.size, col: c, row: r });
      const dist = absoluteDistanceVw(center, targetStack);
      if (dist > maxDist || !footprintFree(map, stack, c, r, false)) continue;
      const cell = { col: c, row: r };
      candidates.push({ cell, dist, cost: chebyshev(origin, cell) });
    }
  }
  // Nearest to the target first, then cheapest; trace paths only until
  // the first reachable candidate.
  candidates.sort((a, b) => a.dist - b.dist || a.cost - b.cost || a.cell.col - b.cell.col || a.cell.row - b.cell.row);
  for (const candidate of candidates) {
    if (canReachOnMap(map, stack, candidate.cell.col, candidate.cell.row)) {
      return candidate.cell;
    }
  }
  return null;
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
    const anchor: GridCell = reservedAnchor(a) ?? { col: a.col, row: a.row };
    const d = chebyshev(cell, anchor);
    if (d < min) {
      min = d;
    }
  }
  return min === Infinity ? 0 : min;
}

/*
 * Enemy stacks that are outside the current attack reach but reachable
 * via a clear path. These are valid move-to-attack targets.
 */
export function getMoveToAttackTargetIds(state: BattleModelState, stack: BattleStack): string[] {
  if (stack.destroyed || stack.immobile) {
    return [];
  }
  return state.stacks
    .filter((s) => !s.destroyed && s.side !== stack.side)
    .filter((s) => !canAttack(stack, s) && getMoveToAttackCells(state, stack, s).length > 0)
    .map((s) => s.stackId);
}

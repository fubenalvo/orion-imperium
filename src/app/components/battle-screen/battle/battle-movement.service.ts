import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell, BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW, BATTLE_GRID_COLUMNS, BATTLE_GRID_ROWS, SNAP_DEADBAND_VW } from './battle.types';
import {
  isInBounds,
  isPathClear,
  linePath,
  findBestMoveToAttackCell,
  canAttack,
  isCellReserved,
  isOccupied,
  occupiedCols,
  vwToStackCell,
  absoluteDistanceCells,
  stackCenterVw,
} from './battle-grid';
import { BattleAnimationService } from './battle-animation.service';
import { BattleCombatService } from './battle-combat.service';

/*
 * =========================================================
 * BATTLE MINIGAME — MOVEMENT SERVICE
 * =========================================================
 *
 * Real-time, speed-based movement. One command sets a stack's vw target;
 * the game loop (BattleScreenComponent) calls updateStackPositions() every
 * frame to interpolate the stack toward its target at `speed` vw/s.
 *
 * No AP costs, no moveRange limits. The only gate is the animation busy
 * lock during attacks — stacks can move while attacks are animating on
 * other stacks.
 *
 * Movement direction uses straight-line paths (orthogonal + diagonal),
 * matching the star-map fleet movement pattern. Each intermediate cell
 * must be in bounds and unoccupied — no pathfinding through obstacles.
 */

@Injectable({ providedIn: 'root' })
export class BattleMovementService {
  constructor(
    private anim: BattleAnimationService,
    private combat: BattleCombatService,
  ) {}

  private readonly movementWaiters = new Map<string, Array<() => void>>();

  async moveStack(
    state: BattleModelState,
    stackId: string,
    targetCol: number,
    targetRow: number,
  ): Promise<boolean> {
    const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
    if (!stack || state.winner || stack.immobile) {
      return false;
    }

    const from: GridCell = { col: stack.col, row: stack.row };
    const target: GridCell = { col: targetCol, row: targetRow };
    if (!isInBounds(target.col, target.row) || (target.col === stack.col && target.row === stack.row)) {
      return false;
    }

    const path = linePath(from, target);
    if (!path) {
      return false;
    }
    if (!isPathClear(state, path, stack)) {
      return false;
    }

    // Set target to the visual centre of the destination cell.
    this.resolveMovementWaiters(stackId);
    const targetVw = cellCenterVw(target, stack);
    stack.targetX = targetVw.x;
    stack.targetY = targetVw.y;
    stack.moving = true;
    console.log(`[MOVE-START] ${stackId} (${stack.side}) from (${from.col},${from.row}) -> (${target.col},${target.row})`);
    return true;
  }

  /*
   * Move to attack: find the best cell within attack range of the target,
   * then move there. When the stack arrives, the caller (player clicks or
   * AI tick) handles the attack separately.
   */
  async moveToAttack(
    state: BattleModelState,
    stackId: string,
    targetStackId: string,
  ): Promise<boolean> {
    const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
    const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
    if (!stack || !target || state.winner || stack.immobile) {
      return false;
    }
    if (stack.side === target.side) {
      return false;
    }

    const canAttackNow = canAttack(stack, target);
    console.log(`[MOVE-TO-ATTACK] ${stackId} (${stack.side}) @(${stack.col},${stack.row}) -> ${targetStackId} (${target.side}) @(${target.col},${target.row}) | canAttack=${canAttackNow} | dist=${absoluteDistanceCells(stack, target).toFixed(2)} | range=${stack.attackRange}`);

    if (canAttackNow) {
      console.log(`[MOVE-TO-ATTACK] -> DIRECT ATTACK (in range)`);
      return this.combat.attackStack(state, stackId, targetStackId);
    }

    const bestCell = findBestMoveToAttackCell(state, stack, target);
    if (!bestCell) {
      console.log(`[MOVE-TO-ATTACK] -> NO VALID CELL`);
      return false;
    }

    console.log(`[MOVE-TO-ATTACK] -> MOVE TO CELL (${bestCell.col},${bestCell.row})`);

    const moved = await this.moveStack(state, stackId, bestCell.col, bestCell.row);
    if (moved) {
      stack.moveToAttackTargetId = targetStackId;
    }
    return moved;
  }

  waitForMovement(stack: BattleStack): Promise<void> {
    if (!stack.moving || stack.targetX == null || stack.targetY == null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = this.movementWaiters.get(stack.stackId) ?? [];
      waiters.push(resolve);
      this.movementWaiters.set(stack.stackId, waiters);
    });
  }

  completeMovement(stackId: string): void {
    this.resolveMovementWaiters(stackId);
  }

  cancelPendingMovementWaits(): void {
    for (const stackId of this.movementWaiters.keys()) {
      this.resolveMovementWaiters(stackId);
    }
  }

  /*
   * Periodic re-computation of move-to-attack destinations.
   * Called every frame by the game loop.
   * For each stack moving toward a target, re-evaluates the destination cell
   * using the target's current absolute position. If the target is destroyed
   * or no valid cell exists (e.g., target now in range), the stack stops
   * and the caller handles the attack.
   */
  updateMoveToAttackTargets(state: BattleModelState): void {
    for (const stack of state.stacks) {
      if (!stack.moving || !stack.moveToAttackTargetId) {
        continue;
      }
      const target = state.stacks.find(
        (s) => !s.destroyed && s.stackId === stack.moveToAttackTargetId,
      );
      if (!target) {
        console.log(`[MOVE-REEVAL] ${stack.stackId} target destroyed -> snapToGrid | stack: col=${stack.col}, row=${stack.row} x=${stack.x.toFixed(2)}, y=${stack.y.toFixed(2)} targetX=${stack.targetX?.toFixed(2)}, targetY=${stack.targetY?.toFixed(2)}`);
        this.snapToGrid(stack, state);
        stack.moveToAttackTargetId = null;
        continue;
      }
      const bestCell = findBestMoveToAttackCell(state, stack, target);
      if (!bestCell) {
        // No free cell brings the stack into attack range at this moment.
        // This can happen transiently when the target moves. Instead of
        // retreating or snapping (which cancels in-progress movement), keep
        // the current destination and let the ship arrive. The AI will
        // re-evaluate on its next tick (every 800ms) and pick a new cell
        // if needed. This prevents the "move-attack loop" where a ship
        // repeatedly starts moving, gets snapped back, and starts again.
        console.log(`[MOVE-REEVAL] ${stack.stackId} NO CELL IN RANGE of ${target.stackId} -> KEEP CURRENT TARGET | stack: col=${stack.col}, row=${stack.row} x=${stack.x.toFixed(2)}, y=${stack.y.toFixed(2)} target: col=${target.col}, row=${target.row} x=${target.x.toFixed(2)}, y=${target.y.toFixed(2)} distCells=${absoluteDistanceCells({x:stack.x,y:stack.y}, {x:target.x,y:target.y}).toFixed(2)} attackRange=${stack.attackRange}`);
        continue;
      }
      const targetVw = cellCenterVw(bestCell, stack);
      // Only redirect if the best cell actually changed — prevents micro-jitter
      // when the enemy is near a cell boundary and the optimal cell flips
      // back and forth between adjacent cells.
      if (stack.targetX != null && stack.targetY != null) {
        const ddx = targetVw.x - stack.targetX;
        const ddy = targetVw.y - stack.targetY;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < 0.1) {
          continue;
        }
      }
      const currentCenter = { x: stack.x, y: stack.y };
      const distToTarget = absoluteDistanceCells(currentCenter, target);
      const logicalDist = absoluteDistanceCells(stackCenterVw(stack), stackCenterVw(target));
      console.log(`[MOVE-REEVAL] ${stack.stackId} redirect to (${bestCell.col},${bestCell.row}) target=${target.stackId}@(${target.col},${target.row}) | stack logical: col=${stack.col}, row=${stack.row} | stack visual: x=${stack.x.toFixed(2)}, y=${stack.y.toFixed(2)} | target visual: x=${target.x.toFixed(2)}, y=${target.y.toFixed(2)} | distCells(logical)=${logicalDist.toFixed(2)} | distCells(visual)=${distToTarget.toFixed(2)} | attackRange=${stack.attackRange} | effectiveRange=${(stack.attackRange * 0.8).toFixed(2)}`);
      stack.targetX = targetVw.x;
      stack.targetY = targetVw.y;
    }
  }

  /*
   * Smoothly aligns a stack to the nearest grid cell. Sets the cell center as
   * the stack's movement target and keeps moving = true, so updateStackPositions
   * interpolates the ship to the cell centre over time instead of teleporting.
   * col/row is updated immediately for path-finding. Called when movement is
   * interrupted mid-flight (e.g. move-to-attack target destroyed or brought
   * into range) so the stack settles on a grid-aligned position without a
   * visible snap. The caller is responsible for clearing moveToAttackTargetId;
   * completeMovement is deferred to updateStackPositions when the ship arrives.
   * If the nearest cell is already reserved by another in-flight stack, searches
   * in a diamond pattern for the nearest free cell — preventing two AI stacks
   * from being sent to the same cell simultaneously.
   */
  private snapToGrid(stack: BattleStack, state: BattleModelState): void {
    const cell = vwToStackCell(stack, stack.x, stack.y);
    console.log(`[SNAP-TO-GRID] ${stack.stackId} from visual (${stack.x.toFixed(2)},${stack.y.toFixed(2)}) -> cell (${cell.col},${cell.row}) | was moving=${stack.moving} | moveToAttackTargetId=${stack.moveToAttackTargetId ?? 'none'} | targetX=${stack.targetX?.toFixed(2)}, targetY=${stack.targetY?.toFixed(2)}`);
    stack.col = cell.col;
    stack.row = cell.row;

    const target = this.findNearestFreeCell(state, stack, cell);
    if (target) {
      const center = cellCenterVw(target, stack);
      // Deadband: if the stack is already close enough to this cell's
      // centre, don't re-target. Without this, a stack whose interpolated
      // x/y drifts a fraction of a cell off-centre every frame gets
      // re-snapped to the exact centre, then drifts again — an out-and-
      // back jitter that's most visible while the stack is firing.
      if (
        stack.targetX != null &&
        stack.targetY != null &&
        Math.abs(center.x - stack.targetX) < SNAP_DEADBAND_VW &&
        Math.abs(center.y - stack.targetY) < SNAP_DEADBAND_VW
      ) {
        console.log(`[SNAP-TO-GRID] ${stack.stackId} deadband hit, skipping re-target`);
        return;
      }
      stack.targetX = center.x;
      stack.targetY = center.y;
      stack.moving = true;
      console.log(`[SNAP-TO-GRID] ${stack.stackId} re-targeted to (${target.col},${target.row}) center=(${center.x.toFixed(2)},${center.y.toFixed(2)})`);
    } else {
      // No free cell found — stop at current position
      stack.moving = false;
      stack.targetX = null;
      stack.targetY = null;
      this.completeMovement(stack.stackId);
      console.log(`[SNAP-TO-GRID] ${stack.stackId} no free cell, stopped`);
    }
  }

  /*
   * Diamond search (increasing Manhattan distance) for the nearest unreserved
   * cell to the origin. Checks static occupancy via isOccupied and in-flight
   * reservations via isCellReserved. Returns null if none found.
   */
  private findNearestFreeCell(
    state: BattleModelState,
    stack: BattleStack,
    origin: GridCell,
  ): GridCell | null {
    const maxRadius = BATTLE_GRID_COLUMNS + BATTLE_GRID_ROWS;
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.abs(dc) + Math.abs(dr) !== radius) {
            continue;
          }
          const col = origin.col + dc;
          const row = origin.row + dr;
          if (!isInBounds(col, row)) {
            continue;
          }
          const destCols = occupiedCols(stack, col);
          if (!destCols.some((c) =>
            !isInBounds(c, row) ||
            isOccupied(state, c, row, stack.stackId) ||
            isCellReserved(state, c, row, stack.stackId)
          )) {
            return { col, row };
          }
        }
      }
    }
    return null;
  }

  private resolveMovementWaiters(stackId: string): void {
    const waiters = this.movementWaiters.get(stackId) ?? [];
    this.movementWaiters.delete(stackId);
    for (const resolve of waiters) {
      resolve();
    }
  }
}

/* Compute the vw centre of a cell adjusted for the stack's visual offset. */
function cellCenterVw(cell: GridCell, stack: { side: 'attacker' | 'defender'; size: number }): { x: number; y: number } {
  const offset = (stack.size - 1) / 2;
  const visualCol = stack.side === 'attacker' ? cell.col + offset : cell.col - offset;
  return {
    x: (visualCol - 0.5) * BATTLE_CELL_WIDTH_VW,
    y: (cell.row - 0.5) * BATTLE_CELL_HEIGHT_VW,
  };
}

import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell, BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW } from './battle.types';
import {
  isInBounds,
  isPathClear,
  linePath,
  findBestMoveToAttackCell,
  isAbsoluteInRange,
  vwToStackCell,
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

    if (isAbsoluteInRange(stack, target, stack.attackRange)) {
      return this.combat.attackStack(state, stackId, targetStackId);
    }

    const bestCell = findBestMoveToAttackCell(state, stack, target);
    if (!bestCell) {
      return false;
    }

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
        this.snapToGrid(stack);
        stack.moveToAttackTargetId = null;
        continue;
      }
      // Target already in range — smoothly align to nearest grid cell.
      if (isAbsoluteInRange(stack, target, stack.attackRange)) {
        this.snapToGrid(stack);
        stack.moveToAttackTargetId = null;
        continue;
      }
      const bestCell = findBestMoveToAttackCell(state, stack, target);
      if (!bestCell) {
        // No cell brings the stack into attack range. Instead of stopping,
        // redirect toward the enemy's current grid position so the stack
        // keeps closing distance. updateMoveToAttackTargets re-runs every
        // frame, so this path stays current as the enemy moves.
        const interceptPath = linePath(
          { col: stack.col, row: stack.row },
          { col: target.col, row: target.row },
        );
        let redirected = false;
        if (interceptPath) {
          for (let d = interceptPath.length; d >= 1; d--) {
            const dest = interceptPath[d - 1];
            const destPath = linePath({ col: stack.col, row: stack.row }, dest);
            if (destPath && isPathClear(state, destPath, stack)) {
              const targetVw = cellCenterVw(dest, stack);
              // Skip redirect if already close to this destination — prevents
              // micro-jitter when the enemy drifts near a cell boundary.
              if (stack.targetX != null && stack.targetY != null) {
                const ddx = targetVw.x - stack.targetX;
                const ddy = targetVw.y - stack.targetY;
                if (Math.sqrt(ddx * ddx + ddy * ddy) < 0.1) {
                  redirected = true;
                  break;
                }
              }
              stack.targetX = targetVw.x;
              stack.targetY = targetVw.y;
              redirected = true;
              break;
            }
          }
        }
        if (!redirected) {
          // No valid path — smoothly align to nearest cell and wait for the
          // AI to re-plan on its next tick.
          this.snapToGrid(stack);
          stack.moveToAttackTargetId = null;
        }
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
   */
  private snapToGrid(stack: BattleStack): void {
    const cell = vwToStackCell(stack, stack.x, stack.y);
    stack.col = cell.col;
    stack.row = cell.row;
    const center = cellCenterVw(cell, stack);
    stack.targetX = center.x;
    stack.targetY = center.y;
    stack.moving = true;
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

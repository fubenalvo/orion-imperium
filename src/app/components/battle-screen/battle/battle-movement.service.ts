import { Injectable } from '@angular/core';
import { ANIMATION_MS, BattleModelState, GridCell } from './battle.types';
import { isInBounds, isOccupied, linePath, findBestMoveToAttackCell, isInRange } from './battle-grid';
import { BattleAnimationService } from './battle-animation.service';
import { BattleCombatService } from './battle-combat.service';

/*
 * =========================================================
 * BATTLE MINIGAME — MOVEMENT SERVICE
 * =========================================================
 *
 * Tactical, grid-based movement controlled by AP. One command moves a
 * stack in a straight line (orthogonal + diagonal) to a target cell up
 * to its remaining moveRange away, costing `tier` AP per cell. Every
 * intermediate cell must be in bounds and unoccupied — no pathfinding.
 *
 * The stack's grid position is committed immediately and the CSS
 * transition on the stack element plays the tween; the busy lock holds
 * until the tween duration has elapsed.
 */

@Injectable({ providedIn: 'root' })
export class BattleMovementService {
  constructor(
    private anim: BattleAnimationService,
    private combat: BattleCombatService,
  ) {}

  async moveStack(
    state: BattleModelState,
    stackId: string,
    targetCol: number,
    targetRow: number,
  ): Promise<boolean> {
    const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
    if (!stack || state.winner || this.anim.isBusy) {
      return false;
    }
    if (state.activeSide !== stack.side || stack.immobile) {
      return false;
    }

    const from: GridCell = { col: stack.col, row: stack.row };
    const target: GridCell = { col: targetCol, row: targetRow };
    if (!isInBounds(target.col, target.row)) {
      return false;
    }
    if (from.col === target.col && from.row === target.row) {
      return false;
    }

    const steps = Math.max(Math.abs(target.col - from.col), Math.abs(target.row - from.row));
    if (stack.cellsMovedThisTurn + steps > stack.moveRange) {
      return false;
    }
    const cost = steps * stack.moveApPerCell;
    if (cost > state.ap) {
      return false;
    }

    const path = linePath(from, target);
    if (!path) {
      return false;
    }
    for (const cell of path) {
      if (isOccupied(state, cell.col, cell.row, stack.stackId)) {
        return false;
      }
    }

    // Commit the AP cost up-front; the busy lock prevents any concurrent
    // command from overdrawing the pool.
    state.ap -= cost;
    stack.cellsMovedThisTurn += steps;
    stack.moveMs = steps * ANIMATION_MS.move;

    await this.anim.run(async () => {
      stack.col = target.col;
      stack.row = target.row;
      stack.moving = true;
      this.anim.tick();
      await this.anim.wait(steps * ANIMATION_MS.move);
      stack.moving = false;
      this.anim.tick();
    });
    return true;
  }

  /*
   * Move-to-attack: move to the best attack position for a target,
   * then attack it. Both actions consume AP and must succeed atomically.
   * Returns true if both move and attack completed.
   */
  async moveToAttack(
    state: BattleModelState,
    stackId: string,
    targetStackId: string,
  ): Promise<boolean> {
    const stack = state.stacks.find((s) => s.stackId === stackId && !s.destroyed);
    const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
    if (!stack || !target || state.winner || this.anim.isBusy) {
      return false;
    }
    if (state.activeSide !== stack.side || stack.side === target.side || stack.immobile) {
      return false;
    }

    // Check if already in direct attack range
    const from: GridCell = { col: stack.col, row: stack.row };
    const to: GridCell = { col: target.col, row: target.row };
    if (isInRange(from, to, stack.attackRange)) {
      // Direct attack is possible - delegate to combat service
      return this.combat.attackStack(state, stackId, targetStackId);
    }

    // Find best attack position
    const bestCell = findBestMoveToAttackCell(state, stack, target);
    if (!bestCell) {
      return false; // No valid path to attack position
    }

    const moveSteps = Math.max(Math.abs(bestCell.col - from.col), Math.abs(bestCell.row - from.row));
    const moveCost = moveSteps * stack.moveApPerCell;
    const attackCost = stack.attackAp;
    const totalCost = moveCost + attackCost;

    if (totalCost > state.ap) {
      return false; // Insufficient AP for both move and attack
    }
    if (stack.cellsMovedThisTurn + moveSteps > stack.moveRange) {
      return false; // Exceeds move range
    }

    // Execute move
    const moveResult = await this.moveStack(state, stackId, bestCell.col, bestCell.row);
    if (!moveResult) {
      return false;
    }

    // Execute attack from new position
    const attackResult = await this.combat.attackStack(state, stackId, targetStackId);
    return attackResult;
  }
}

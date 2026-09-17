import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell } from './battle.types';
import { getStacks, isSidePlayerControlled } from './battle-state';
import { cellDistance, computeTargetScore, findBestMoveToAttackCell, isInRange, linePath } from './battle-grid';
import { BattleCombatService } from './battle-combat.service';
import { BattleMovementService } from './battle-movement.service';
import { BattleAnimationService } from './battle-animation.service';

/*
 * =========================================================
 * BATTLE MINIGAME — TACTICAL AI
 * =========================================================
 *
 * Deterministic greedy controller for the non-player side(s). Reads and
 * writes ONLY BattleModelState — it has no knowledge of the strategic
 * enemy-ai / strategy / goal / action layers, which is exactly why the
 * minigame stays self-contained.
 *
 * In the real-time model, the AI takes ONE action per tick (0.2s
 * configurable via AI_ACTION_INTERVAL_MS), driven by the game loop:
 *   1. attack with the first stack that has an enemy in range
 *   2. carrier shield boost if no attack but a carrier can boost
 *   3. move the nearest stack toward the nearest enemy
 *
 * The animation busy lock gates attacks — if a projectile is in flight,
 * the AI skips its action on that tick. Movement is never gated by the
 * lock; stacks move continuously in real-time.
 */

@Injectable({ providedIn: 'root' })
export class BattleAiService {
  constructor(
    private combat: BattleCombatService,
    private movement: BattleMovementService,
    private anim: BattleAnimationService,
  ) {}

  /*
   * One AI action per call. Returns true if an action was taken,
   * false if no action was possible (all stacks moving, no targets, etc).
   */
  async playAction(state: BattleModelState): Promise<boolean> {
    if (state.winner) {
      return false;
    }

    const aiStacks = this.getAiStacks(state);

    // 1. Attack with the first stack that has an in-range enemy target and is not animating.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.immobile || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      const target = this.bestTarget(state, stack);
      if (target) {
        const result = await this.combat.attackStack(state, stack.stackId, target.stackId);
        return result;
      }
    }

    // 2. Carrier Shield Pulse fallback: only when a Carrier has nothing
    //    better to do and at least one friendly ally in range needs shield.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.typeId !== 'carrier') {
        continue;
      }
      if (this.combat.carrierShieldBoost(state, stack.stackId)) {
        return true;
      }
    }

    // 3. Move the nearest AI stack toward the nearest enemy.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.immobile || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      const moved = await this.moveTowardNearestEnemy(state, stack);
      if (moved) {
        return true;
      }
    }

    return false;
  }

  private getAiStacks(state: BattleModelState): BattleStack[] {
    return state.stacks.filter(
      (s) => !s.destroyed && !isSidePlayerControlled(state, s.side),
    );
  }

  private bestTarget(state: BattleModelState, stack: BattleStack): BattleStack | null {
    const origin: GridCell = { col: stack.col, row: stack.row };
    const candidates = state.stacks.filter(
      (s) => !s.destroyed && s.side !== stack.side && isInRange(origin, s, stack.attackRange),
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, s) => {
      const bestScore = computeTargetScore(stack, best, cellDistance(origin, best));
      const score = computeTargetScore(stack, s, cellDistance(origin, s));
      if (score > bestScore) {
        return s;
      }
      if (score === bestScore && s.stackId < best.stackId) {
        return s;
      }
      return best;
    });
  }

  private async moveTowardNearestEnemy(state: BattleModelState, stack: BattleStack): Promise<boolean> {
    const origin: GridCell = { col: stack.col, row: stack.row };

    // Prefer move-to-attack: advance only as far as needed to bring a
    // target within attackRange, then stop. This keeps the stack at its
    // weapon's effective range instead of charging into point-blank range.
    const moveAttackTarget = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .filter((s) => !isInRange(origin, s, stack.attackRange))
      .sort(
        (a, b) =>
          cellDistance(origin, a) - cellDistance(origin, b) ||
          a.stackId.localeCompare(b.stackId),
      )[0];

    if (moveAttackTarget) {
      const bestCell = findBestMoveToAttackCell(state, stack, moveAttackTarget);
      if (bestCell) {
        return this.movement.moveStack(state, stack.stackId, bestCell.col, bestCell.row);
      }
    }

    // No target can be brought into range — fall back to moving
    // toward the nearest enemy.
    const enemy = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .sort(
        (a, b) =>
          cellDistance(origin, a) - cellDistance(origin, b) || a.stackId.localeCompare(b.stackId),
      )[0];
    if (!enemy) {
      return false;
    }

    const path = linePath(origin, { col: enemy.col, row: enemy.row });
    if (!path) {
      return false;
    }

    // Try the longest legal approach first; shrink the step count when
    // the straight line is blocked by an occupied cell.
    for (let d = path.length; d >= 1; d--) {
      const dest = path[d - 1];
      const result = await this.movement.moveStack(state, stack.stackId, dest.col, dest.row);
      if (result) {
        return true;
      }
    }
    return false;
  }
}

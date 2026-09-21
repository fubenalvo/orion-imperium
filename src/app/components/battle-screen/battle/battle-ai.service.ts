import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell } from './battle.types';
import { getStacks, isSidePlayerControlled } from './battle-state';
import {
  absoluteDistanceCells,
  computeTargetScore,
  isAbsoluteInRange,
  linePath,
} from './battle-grid';
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
 *   1b. carrier shield boost if a carrier has an ally below 50% shield (proactive)
 *   2. carrier shield boost if no attack is available but a carrier can boost
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
  async playAction(state: BattleModelState, includePlayerSides = false): Promise<boolean> {
    if (state.winner) {
      return false;
    }

    const aiStacks = this.getAiStacks(state, includePlayerSides);

    // 1. Attack with the first stack that has an in-range enemy target and is not animating.
    for (const stack of aiStacks) {
      if (stack.destroyed || stack.immobile || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      const target = this.bestTarget(state, stack);
      if (target) {
        const result = await this.combat.attackStack(state, stack.stackId, target.stackId);
        return result;
      }
    }

    // 2. Carrier Shield Pulse fallback: boost allies below 50% shield
    //    proactively, not only when no attack is available.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.typeId !== 'carrier') {
        continue;
      }
      if (this.hasLowShieldAlly(state, stack)) {
        if (this.combat.carrierShieldBoost(state, stack.stackId)) {
          return true;
        }
      }
    }

    // 2b. Carrier Shield Pulse fallback: only when a Carrier has nothing
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

  private getAiStacks(state: BattleModelState, includePlayerSides = false): BattleStack[] {
    if (includePlayerSides) {
      return state.stacks.filter((s) => !s.destroyed);
    }
    return state.stacks.filter(
      (s) => !s.destroyed && !isSidePlayerControlled(state, s.side),
    );
  }

  /* Check if any friendly stack within the carrier's absolute range has shield below 50%. */
  private hasLowShieldAlly(state: BattleModelState, carrier: BattleStack): boolean {
    return state.stacks.some((s) => {
      if (s.destroyed || s.side !== carrier.side || s.stackId === carrier.stackId) {
        return false;
      }
      if (!isAbsoluteInRange(carrier, s, carrier.attackRange)) {
        return false;
      }
      const totalMaxShield = s.ships.reduce((sum, sh) => sum + (sh.maxShield ?? 0), 0);
      if (totalMaxShield <= 0) {
        return false;
      }
      const totalShield = s.ships.reduce((sum, sh) => sum + (sh.shield ?? 0), 0);
      return totalShield / totalMaxShield < 0.5;
    });
  }

  private bestTarget(state: BattleModelState, stack: BattleStack): BattleStack | null {
    const candidates = state.stacks.filter(
      (s) => !s.destroyed && s.side !== stack.side && isAbsoluteInRange(stack, s, stack.attackRange),
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, s) => {
      const bestScore = computeTargetScore(stack, best, absoluteDistanceCells(stack, best));
      const score = computeTargetScore(stack, s, absoluteDistanceCells(stack, s));
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
    // target within absolute attack range, then stop. This keeps the stack at its
    // weapon's effective range instead of charging into point-blank range.
    const moveAttackTarget = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .filter((s) => !isAbsoluteInRange(stack, s, stack.attackRange))
      .sort(
        (a, b) =>
          absoluteDistanceCells(stack, a) - absoluteDistanceCells(stack, b) ||
          a.stackId.localeCompare(b.stackId),
      )[0];

    if (moveAttackTarget) {
      const success = await this.movement.moveToAttack(
        state,
        stack.stackId,
        moveAttackTarget.stackId,
      );
      if (success) {
        return true;
      }
    }

    // No target can be brought into range — fall back to moving
    // toward the nearest enemy.
    const enemy = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .sort(
        (a, b) =>
          absoluteDistanceCells(stack, a) - absoluteDistanceCells(stack, b) || a.stackId.localeCompare(b.stackId),
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
        // Set moveToAttackTargetId so updateMoveToAttackTargets re-evaluates
        // this stack's destination every frame as the enemy moves.
        stack.moveToAttackTargetId = enemy.stackId;
        return true;
      }
    }
    return false;
  }
}

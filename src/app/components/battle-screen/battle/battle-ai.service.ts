import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell, AI_ACTION_COOLDOWN_MS, FIRE_RATE_MULTIPLIER } from './battle.types';
import { getStacks, isSidePlayerControlled } from './battle-state';
import {
  absoluteDistanceCells,
  computeTargetScore,
  canAttack,
  linePath,
} from './battle-grid';
import { BattleCombatService } from './battle-combat.service';
import { BattleMovementService } from './battle-movement.service';
import { BattleAnimationService } from './battle-animation.service';
import { BattleTimeService } from './battle-time.service';

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
    private time: BattleTimeService,
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
    const now = this.time.battleElapsedMs;

    // 1. Attack with the first stack that has an in-range enemy target and is not animating.
    for (const stack of aiStacks) {
      if (stack.destroyed || stack.immobile || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      const onCooldown = this.onActionCooldown(stack);
      console.log(`[AI-COOLDOWN] ${stack.stackId} (${stack.side}) cooldownUntil=${stack.actionCooldownUntil?.toFixed(0) ?? 'none'} now=${now.toFixed(0)} onCooldown=${onCooldown} animBusy=${this.anim.isStackBusy(stack.stackId)}`);
      if (onCooldown) {
        continue;
      }
      const target = this.bestTarget(state, stack);
      if (target) {
        console.log(`[AI-ATTACK] ${stack.stackId} (${stack.side}) @(${stack.col},${stack.row}) -> ${target.stackId} (${target.side}) @(${target.col},${target.row})`);
        const result = await this.combat.attackStack(state, stack.stackId, target.stackId);
        console.log(`[AI-ATTACK-RESULT] ${stack.stackId} -> ${target.stackId}: result=${result} cooldownSet=${result}`);
        if (result) {
          // Lock the stack so the AI doesn't micro-manage for 3s.
          this.applyActionCooldown(stack);
        }
        return result;
      }
    }

    // 2. Carrier Shield Pulse fallback: boost allies below 50% shield
    //    proactively, not only when no attack is available.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.typeId !== 'carrier') {
        continue;
      }
      if (this.onActionCooldown(stack)) {
        continue;
      }
      if (this.hasLowShieldAlly(state, stack)) {
        if (this.combat.carrierShieldBoost(state, stack.stackId)) {
          this.applyActionCooldown(stack);
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
      if (this.onActionCooldown(stack)) {
        continue;
      }
      if (this.combat.carrierShieldBoost(state, stack.stackId)) {
        this.applyActionCooldown(stack);
        return true;
      }
    }

    // 3. Move the nearest AI stack toward the nearest enemy.
    for (const stack of aiStacks) {
      if (stack.moving || stack.destroyed || stack.immobile || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      if (this.onActionCooldown(stack)) {
        continue;
      }
      const moved = await this.moveTowardNearestEnemy(state, stack);
      if (moved) {
        console.log(`[AI-MOVE] ${stack.stackId} (${stack.side}) @(${stack.col},${stack.row}) initiated move-to-attack`);
        return true;
      }
    }

    return false;
  }

  /* Returns true if the AI has commanded this stack within the last
   * AI_ACTION_COOLDOWN_MS. Skips the stack so the AI doesn't micro-manage. */
  private onActionCooldown(stack: BattleStack): boolean {
    return !!(stack.actionCooldownUntil && stack.actionCooldownUntil > this.time.battleElapsedMs);
  }

  /* Sets the stack's action cooldown so the AI leaves it alone for
   * AI_ACTION_COOLDOWN_MS (scaled by FIRE_RATE_MULTIPLIER) after any
   * command (move, attack, or boost). */
  private applyActionCooldown(stack: BattleStack): void {
    stack.actionCooldownUntil = this.time.battleElapsedMs + AI_ACTION_COOLDOWN_MS * FIRE_RATE_MULTIPLIER;
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
      if (!canAttack(carrier, s)) {
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
      (s) => !s.destroyed && s.side !== stack.side && canAttack(stack, s),
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
    // target within attack range, then stop. This keeps the stack at its
    // weapon's effective range instead of charging into point-blank range.
    // Targets already attackable (canAttack, which tolerates a stack that
    // settled just outside absolute range) are excluded so the stack
    // doesn't re-plan a move for something it can already hit.
    const moveAttackTarget = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .filter((s) => !canAttack(stack, s))
      .sort(
        (a, b) =>
          absoluteDistanceCells(stack, a) - absoluteDistanceCells(stack, b) ||
          a.stackId.localeCompare(b.stackId),
      )[0];

    if (moveAttackTarget) {
      console.log(`[AI-MOVE-TARGET] ${stack.stackId} -> ${moveAttackTarget.stackId} (dist=${absoluteDistanceCells(stack, moveAttackTarget).toFixed(2)})`);
      const success = await this.movement.moveToAttack(
        state,
        stack.stackId,
        moveAttackTarget.stackId,
      );
      if (success) {
        // Lock the stack so the AI doesn't micro-manage for 3s.
        this.applyActionCooldown(stack);
        return true;
      }
    }

    // No free cell brings the target into range — RETREAT. The stack
    // steps away from the enemy along the straight line until it finds
    // a legal cell. If the nearest enemy is already attackable (canAttack,
    // which tolerates a stack that settled just outside absolute range),
    // do NOT move: step 1 (attack) will fire as soon as the animation
    // clears. Moving toward an attackable enemy triggers
    // updateMoveToAttackTargets to snap the stack back every frame,
    // producing jitter instead of combat.
    const enemy = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .sort(
        (a, b) =>
          absoluteDistanceCells(stack, a) - absoluteDistanceCells(stack, b) || a.stackId.localeCompare(b.stackId),
      )[0];
    if (!enemy || canAttack(stack, enemy)) {
      return false;
    }

    console.log(`[AI-RETREAT] ${stack.stackId} from ${enemy.stackId} (no valid attack cell)`);
    // No free cell brings the target into range — RETREAT. The stack
    // steps away from the enemy along the straight line until it finds
    // a legal cell. It never charges forward into a blocked position.
    const dx = origin.col - enemy.col;
    const dy = origin.row - enemy.row;
    const retreatTarget: GridCell = { col: origin.col + dx, row: origin.row + dy };
    const retreatPath = linePath(origin, retreatTarget);
    if (!retreatPath) {
      return false;
    }
    for (let d = retreatPath.length; d >= 1; d--) {
      const dest = retreatPath[d - 1];
      const result = await this.movement.moveStack(state, stack.stackId, dest.col, dest.row);
      if (result) {
        stack.moveToAttackTargetId = enemy.stackId;
        this.applyActionCooldown(stack);
        return true;
      }
    }
    return false;
  }
}

import { Injectable } from '@angular/core';
import {
  ANIMATION_MS,
  BattleModelState,
  BattleAttackEffect,
  BattleStack,
  FIRE_RATE_MULTIPLIER,
  battleDebug,
} from './battle.types';
import {
  checkVictory,
  computeCarrierBoostTargets,
  canAttack,
  weaponMultiplier,
  applyShieldRegen,
  absoluteDistanceRangeUnits,
} from './battle-grid';
import { rememberAutoTarget, selectFireTarget } from './battle-targeting';
import { BattleAnimationService } from './battle-animation.service';
import { BattleTimeService } from './battle-time.service';

/*
 * =========================================================
 *  BATTLE MINIGAME — COMBAT SERVICE
 * =========================================================
 *
 * One attack = the whole stack fires one volley. Total damage is the sum
 * of the firing stack's alive-ship attack values, reduced by the target
 * front ship's defense (per-ship semantics, not summed), scaled by weapon
 * effectiveness (attacker attackType vs front target weakness: 1.5x /
 * 1.0x / 0.5x), floored at 1. Damage is applied ship by ship in order;
 * each ship's shield absorbs first, overkill spills to the next ship.
 *
 * Fire control (runFireControl) is the ONLY place that decides when a
 * stack fires. It runs every frame for every living stack of both sides —
 * player, AUTO and enemy AI alike — so all stacks fire at the same cadence
 * of (1 / fireRate) s * FIRE_RATE_MULTIPLIER. Whom to shoot comes from
 * battle-targeting.ts. Player commands and the AI only set orders/movement.
 *
 * Planet-defense turrets are immobile but DO fire.
 *
 * The Carrier has one special action: Shield Pulse. It restores the
 * Carrier's shieldRegen to every friendly stack within its reach (capped at
 * each ship's maxShield) and consumes the Carrier's fire cooldown, so it
 * replaces one volley rather than being free.
 */

@Injectable({ providedIn: 'root' })
export class BattleCombatService {
  constructor(
    private anim: BattleAnimationService,
    private time: BattleTimeService,
  ) {}

  /* Milliseconds (battle time) between two volleys of a stack. */
  fireIntervalMs(stack: BattleStack): number {
    const fireRate = stack.fireRate > 0 ? stack.fireRate : 1.5;
    return (1000 / fireRate) * FIRE_RATE_MULTIPLIER;
  }

  /* True when the stack's fire cooldown has elapsed. */
  isFireReady(stack: BattleStack): boolean {
    return (stack.attackCooldownUntil ?? 0) <= this.time.battleElapsedMs;
  }

  /*
   * Per-frame fire control for every living stack on both sides. Also the
   * single place where orders pointing at destroyed stacks are cleaned up,
   * so no stack is ever left holding a dead target (which would block AUTO
   * from taking over again).
   */
  runFireControl(state: BattleModelState): void {
    if (state.winner) {
      return;
    }
    const now = this.time.battleElapsedMs;
    for (const stack of state.stacks) {
      if (stack.destroyed) {
        continue;
      }
      this.clearDeadOrders(state, stack);
      if ((stack.attackCooldownUntil ?? 0) > now || this.anim.isStackBusy(stack.stackId)) {
        continue;
      }
      if (!stack.ships.some((s) => s.alive && s.attack > 0)) {
        continue;
      }
      const target = selectFireTarget(state, stack);
      if (!target) {
        continue;
      }
      stack.attackCooldownUntil = now + this.fireIntervalMs(stack);
      rememberAutoTarget(stack, target);
      void this.attackStack(state, stack.stackId, target.stackId);
    }
  }

  private clearDeadOrders(state: BattleModelState, stack: BattleStack): void {
    const isDead = (id: string | null | undefined): boolean =>
      !!id && !state.stacks.some((s) => s.stackId === id && !s.destroyed);
    if (isDead(stack.explicitAttackTargetId)) {
      // Order completed: the stack returns to its automatic targeting mode.
      if (stack.moveToAttackTargetId === stack.explicitAttackTargetId) {
        stack.moveToAttackTargetId = null;
      }
      stack.explicitAttackTargetId = null;
    }
    if (isDead(stack.autoTargetId)) {
      stack.autoTargetId = null;
    }
  }

  /*
   * Resolves one volley with its projectile → impact/explosion animation.
   * Validates range at fire time only; the projectile does not track a
   * target that moves during the animation. Callers are responsible for
   * the fire cooldown (runFireControl sets it).
   */
  async attackStack(
    state: BattleModelState,
    attackerStackId: string,
    targetStackId: string,
  ): Promise<boolean> {
    const attacker = state.stacks.find((s) => s.stackId === attackerStackId && !s.destroyed);
    const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
    if (!attacker || !target || state.winner) {
      return false;
    }
    if (attacker.side === target.side) {
      return false;
    }

    const from = { x: attacker.x, y: attacker.y };
    const to = { x: target.x, y: target.y };
    const canAttackNow = canAttack(attacker, target);
    battleDebug(`[ATTACK] ${attackerStackId} -> ${targetStackId} | canAttack=${canAttackNow} | dist=${absoluteDistanceRangeUnits(attacker, target).toFixed(2)} | range=${attacker.attackRange}`);

    if (!canAttackNow) {
      return false;
    }

    await this.anim.run(async () => {
      attacker.firing = true;
      const effect: BattleAttackEffect = { phase: 'projectile', from, to, targetStackId: target.stackId, attackerStackId: attacker.stackId };
      state.effects.push(effect);
      this.anim.tick();
      await this.anim.wait(ANIMATION_MS.projectile);

      const totalAttack = attacker.ships
        .filter((s) => s.alive)
        .reduce((sum, s) => sum + s.attack, 0);
      // The target may have been destroyed by another stack while this
      // projectile was in flight; then there is no front ship and the
      // volley is wasted (no damage, no log entry).
      const front = target.ships.find((s) => s.alive);

      if (front) {
        const raw = totalAttack - front.defense;
        // The attacker's weapon type is taken from its front ship (stacks
        // are homogeneous by type per buildStacks).
        const attackerFront = attacker.ships.find((s) => s.alive);
        const multiplier = weaponMultiplier(
          attackerFront?.attackType ?? 'kinetic',
          front.weakness ?? 'energy',
        );
        const damage = Math.max(1, Math.floor(raw * multiplier));
        let remaining = damage;
        /*
         * Planet defense stacks are protected by the shared planetary
         * shield before their own per-ship shields. The pool absorbs the
         * whole defense line, so it applies to any immobile target stack
         * and only the overflow reaches hull / per-ship shield logic.
         */
        if (target.immobile && state.defenderShieldPool && state.defenderShieldPool.current > 0) {
          const absorbed = Math.min(state.defenderShieldPool.current, remaining);
          state.defenderShieldPool.current -= absorbed;
          remaining -= absorbed;
        }
        let kills = 0;
        for (const ship of target.ships) {
          if (!ship.alive || remaining <= 0) {
            continue;
          }
          const shieldHp = ship.shield ?? 0;
          const shieldDamage = Math.min(shieldHp, remaining);
          ship.shield = shieldHp - shieldDamage;
          remaining -= shieldDamage;
          if (remaining <= 0) {
            continue;
          }
          const applied = Math.min(ship.hp, remaining);
          ship.hp -= applied;
          remaining -= applied;
          if (ship.hp <= 0) {
            ship.hp = 0;
            ship.alive = false;
            kills++;
          }
        }
        const targetDestroyed = target.ships.every((s) => !s.alive);
        if (targetDestroyed) {
          target.destroyed = true;
        }
        state.log.push({
          round: state.round,
          side: attacker.side,
          attackerStack: attacker.stackId,
          defenderStack: target.stackId,
          damage,
          kills,
        });

        const effectIdx = state.effects.findIndex(e => e.attackerStackId === attacker.stackId);
        if (effectIdx >= 0) {
          state.effects[effectIdx] = {
            ...state.effects[effectIdx],
            phase: targetDestroyed ? 'explosion' : 'impact',
          };
        }
        this.anim.tick();
        await this.anim.wait(targetDestroyed ? ANIMATION_MS.explosion : ANIMATION_MS.hit);
      }

      const effectIdx = state.effects.findIndex(e => e.attackerStackId === attacker.stackId);
      if (effectIdx >= 0) {
        state.effects.splice(effectIdx, 1);
      }
      attacker.firing = false;
      checkVictory(state);
      this.anim.tick();
    }, attacker.stackId);
    return true;
  }

  /*
   * Whether a Shield Pulse would do anything right now: the Carrier is
   * alive, stationary, not animating, off cooldown, and at least one ally in
   * reach has missing shield. Pure read — used by the UI button and the AI.
   */
  canCarrierBoost(state: BattleModelState, carrierStackId: string): boolean {
    const carrier = state.stacks.find((s) => s.stackId === carrierStackId && !s.destroyed);
    if (!carrier || carrier.typeId !== 'carrier' || state.winner) {
      return false;
    }
    if (carrier.moving || carrier.immobile || carrier.firing || this.anim.isStackBusy(carrier.stackId)) {
      return false;
    }
    if (!this.isFireReady(carrier)) {
      return false;
    }
    const regen = carrier.ships.find((s) => s.alive)?.shieldRegen ?? 0;
    if (regen <= 0) {
      return false;
    }
    const targetIds = new Set(computeCarrierBoostTargets(state, carrier));
    return state.stacks.some(
      (s) =>
        targetIds.has(s.stackId) &&
        s.ships.some((ship) => ship.alive && (ship.maxShield ?? 0) > (ship.shield ?? 0)),
    );
  }

  /*
   * Carrier Shield Pulse. Restores the Carrier's front-ship shieldRegen to
   * every friendly ship within reach, capped at maxShield, and consumes the
   * Carrier's fire cooldown. Returns false (and costs nothing) when the
   * pulse would not restore any shield.
   */
  carrierShieldBoost(state: BattleModelState, carrierStackId: string): boolean {
    if (!this.canCarrierBoost(state, carrierStackId)) {
      return false;
    }
    const carrier = state.stacks.find((s) => s.stackId === carrierStackId)!;
    const regen = carrier.ships.find((s) => s.alive)?.shieldRegen ?? 0;

    const targetIds = new Set(computeCarrierBoostTargets(state, carrier));
    for (const stack of state.stacks) {
      if (!targetIds.has(stack.stackId)) {
        continue;
      }
      for (const ship of stack.ships) {
        if (!ship.alive) {
          continue;
        }
        const max = ship.maxShield ?? 0;
        if (max <= 0) {
          continue;
        }
        ship.shield = applyShieldRegen(ship.shield ?? 0, max, regen);
      }
    }
    carrier.attackCooldownUntil = this.time.battleElapsedMs + this.fireIntervalMs(carrier);
    return true;
  }
}

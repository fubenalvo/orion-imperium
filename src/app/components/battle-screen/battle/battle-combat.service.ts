import { Injectable } from '@angular/core';
import { ANIMATION_MS, BattleModelState } from './battle.types';
import {
  applyShieldRegen,
  computeCarrierBoostTargets,
  isInRange,
  stackCenterVw,
  weaponMultiplier,
} from './battle-grid';
import { BattleAnimationService } from './battle-animation.service';
import { BattleTurnService } from './battle-turn.service';

/*
 * =========================================================
 *  BATTLE MINIGAME — COMBAT SERVICE
 * =========================================================
 *
 * One attack command = the whole stack fires one volley. Total damage is
 * the sum of the firing stack's alive-ship attack values, reduced by the
 * target front ship's defense (per-ship semantics, not summed), floored
 * at 1 — the same max(1, attack - defense) rule the old auto-resolver
 * used, just aggregated over the stack.
 *
 * The raw (attack - defense) value is then scaled by weapon
 * effectiveness: the attacker's attackType vs the front target ship's
 * weakness. Same-type vs weakness = 1.5x, neutral = 1.0x, resistant =
 * 0.5x. Pure and deterministic.
 *
 * Damage is applied to the target stack's ships in order; overkill
 * spills to the next ship. Each ship's shield absorbs damage first; only
 * overflow reaches hull HP. A ship is destroyed only when its hull HP
 * reaches zero. Shield regeneration is applied by the turn lifecycle,
 * not here.
 *
 * The Carrier has one special action: Shield Pulse. It spends its attack
 * action (attackAp + attackedThisTurn) to restore shieldRegen to every
 * friendly stack within its attack range, capped at each ship's
 * maxShield. Deterministic, non-damage, and entirely additive — it does
 * not alter the basic attack, movement, or turn systems.
 */

@Injectable({ providedIn: 'root' })
export class BattleCombatService {
  constructor(
    private anim: BattleAnimationService,
    private turn: BattleTurnService,
  ) {}

  async attackStack(
    state: BattleModelState,
    attackerStackId: string,
    targetStackId: string,
  ): Promise<boolean> {
    const attacker = state.stacks.find((s) => s.stackId === attackerStackId && !s.destroyed);
    const target = state.stacks.find((s) => s.stackId === targetStackId && !s.destroyed);
    if (!attacker || !target || state.winner || this.anim.isBusy) {
      return false;
    }
    if (state.activeSide !== attacker.side || attacker.side === target.side) {
      return false;
    }
    if (attacker.attackedThisTurn || attacker.attackAp > state.ap) {
      return false;
    }

    const from = stackCenterVw(attacker);
    const to = stackCenterVw(target);
    if (!isInRange({ col: attacker.col, row: attacker.row }, { col: target.col, row: target.row }, attacker.attackRange)) {
      return false;
    }

    state.ap -= attacker.attackAp;
    attacker.attackedThisTurn = true;

    await this.anim.run(async () => {
      attacker.firing = true;
      state.effect = { phase: 'projectile', from, to, targetStackId: target.stackId };
      this.anim.tick();
      await this.anim.wait(ANIMATION_MS.projectile);

      const totalAttack = attacker.ships
        .filter((s) => s.alive)
        .reduce((sum, s) => sum + s.attack, 0);
      const front = target.ships.find((s) => s.alive);

      if (front) {
        const raw = totalAttack - front.defense;
        // Weapon effectiveness scales the raw (attack - defense) volley by
        // the attacker's weapon type vs the front target ship's weakness.
        // The attacker's type is taken from its front ship (stacks are
        // homogeneous by type per buildStacks).
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
          // Shield absorbs damage first; only overflow reaches hull HP.
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

        state.effect = {
          phase: targetDestroyed ? 'explosion' : 'impact',
          from,
          to,
          targetStackId: target.stackId,
        };
        this.anim.tick();
        await this.anim.wait(targetDestroyed ? ANIMATION_MS.explosion : ANIMATION_MS.hit);
      }

      state.effect = null;
      attacker.firing = false;
      this.turn.checkVictory(state);
      this.anim.tick();
    });
    return true;
  }

  /*
   * Carrier Shield Pulse. The Carrier spends its attack action to restore
   * its shieldRegen to every friendly stack within its attack range,
   * capped at each ship's maxShield. Deterministic, non-damage, and
   * additive — it reuses the same action gates (attackedThisTurn + attackAp)
   * as a normal attack so the turn lifecycle needs no changes.
   */
  carrierShieldBoost(state: BattleModelState, carrierStackId: string): boolean {
    const carrier = state.stacks.find((s) => s.stackId === carrierStackId && !s.destroyed);
    if (!carrier || carrier.typeId !== 'carrier') {
      return false;
    }
    if (state.winner || this.anim.isBusy) {
      return false;
    }
    if (state.activeSide !== carrier.side) {
      return false;
    }
    if (carrier.attackedThisTurn || carrier.attackAp > state.ap) {
      return false;
    }

    // The regen amount comes from the Carrier's own front alive ship.
    const carrierFront = carrier.ships.find((s) => s.alive);
    const regen = carrierFront?.shieldRegen ?? 0;
    if (regen <= 0) {
      return false;
    }

    state.ap -= carrier.attackAp;
    carrier.attackedThisTurn = true;

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

    this.turn.checkVictory(state);
    return true;
  }
}

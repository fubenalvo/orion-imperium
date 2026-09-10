import { Injectable } from '@angular/core';
import { ANIMATION_MS, BattleModelState, GridCell } from './battle.types';
import { isInRange, stackCenterVw } from './battle-grid';
import { BattleAnimationService } from './battle-animation.service';
import { BattleTurnService } from './battle-turn.service';

/*
 * =========================================================
 * BATTLE MINIGAME — COMBAT SERVICE
 * =========================================================
 *
 * One attack command = the whole stack fires one volley. Total damage is
 * the sum of the firing stack's alive-ship attack values, reduced by the
 * target front ship's defense (per-ship semantics, not summed), floored
 * at 1 — the same max(1, attack - defense) rule the old auto-resolver
 * used, just aggregated over the stack.
 *
 * Damage is applied to the target stack's ships in order; overkill
 * spills to the next ship. Weapon type effectiveness and shields are
 * intentionally not modelled (matching the current game).
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
        const damage = Math.max(1, totalAttack - front.defense);
        let remaining = damage;
        let kills = 0;
        for (const ship of target.ships) {
          if (!ship.alive || remaining <= 0) {
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
}

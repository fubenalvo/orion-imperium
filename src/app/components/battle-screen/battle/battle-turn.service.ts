import { Injectable } from '@angular/core';
import { BattleModelState, BattleSide } from './battle.types';
import { applyShieldRegen, getAliveStackCount } from './battle-grid';
import { isSidePlayerControlled } from './battle-state';
import { BattleAnimationService } from './battle-animation.service';

/*
 * =========================================================
 * BATTLE MINIGAME — TURN LIFECYCLE SERVICE
 * =========================================================
 *
 * Owns the ATTACKER → DEFENDER → ATTACKER turn loop: side flip, AP
 * refill, per-stack turn-counter reset, round increment, and victory
 * detection. endTurn() is rejected while an animation is in flight so
 * the END TURN button can never interrupt a moving ship or a travelling
 * projectile.
 */

@Injectable({ providedIn: 'root' })
export class BattleTurnService {
  constructor(private anim: BattleAnimationService) {}

  endTurn(state: BattleModelState): boolean {
    if (state.winner || this.anim.isBusy) {
      return false;
    }

    state.activeSide = state.activeSide === 'attacker' ? 'defender' : 'attacker';
    if (state.activeSide === 'attacker') {
      state.round++;
    }
    state.ap = state.apPerTurn;

    // The newly-active side's living ships regenerate shield before any
    // player or AI action. Runs only at this quiescent point — endTurn is
    // rejected while an animation is in flight, so regen never interrupts
    // a projectile, move, or explosion. Destroyed ships and the inactive
    // side are skipped.
    this.regenerateShields(state);
    this.regenerateSharedShield(state);

    for (const stack of state.stacks) {
      if (stack.side === state.activeSide) {
        stack.cellsMovedThisTurn = 0;
        stack.attackedThisTurn = false;
      }
    }

    state.phase = isSidePlayerControlled(state, state.activeSide) ? 'playerTurn' : 'aiTurn';
    this.checkVictory(state);
    return true;
  }

  /*
   * Regenerates the shared planetary shield pool at the start of the
   * defender's turn. The pool only exists in planet battles and only
   * protects immobile defense stacks; this is the turn-lifecycle half of
   * that contract. Attacker turns never touch it.
   */
  private regenerateSharedShield(state: BattleModelState): void {
    const pool = state.defenderShieldPool;
    if (!pool || state.activeSide !== 'defender' || pool.regen <= 0) {
      return;
    }
    pool.current = applyShieldRegen(pool.current, pool.max, pool.regen);
  }

  /*
   * Regenerates the shield of every living ship on the newly-active side,
   * using the shipData shieldRegen value copied into BattleShip at battle
   * creation. Shield is capped at maxShield; ships with no shield data
   * (maxShield 0) are unaffected. Pure state mutation — no combat logic.
   */
  private regenerateShields(state: BattleModelState): void {
    for (const stack of state.stacks) {
      if (stack.side !== state.activeSide || stack.destroyed) {
        continue;
      }
      for (const ship of stack.ships) {
        if (!ship.alive) {
          continue;
        }
        const regen = ship.shieldRegen ?? 0;
        if (regen <= 0) {
          continue;
        }
        const current = ship.shield ?? 0;
        const max = ship.maxShield ?? 0;
        ship.shield = applyShieldRegen(current, max, regen);
      }
    }
  }

  /*
   * Ends the battle when one side has no alive stacks. Returns true if
   * the battle is now over (including when it already was).
   */
  checkVictory(state: BattleModelState): boolean {
    if (state.winner) {
      return true;
    }
    const attackerAlive = getAliveStackCount(state, 'attacker');
    const defenderAlive = getAliveStackCount(state, 'defender');
    if (attackerAlive === 0 || defenderAlive === 0) {
      state.winner = attackerAlive > 0 ? 'attacker' : 'defender';
      state.phase = 'over';
      return true;
    }
    return false;
  }
}

export function otherSide(side: BattleSide): BattleSide {
  return side === 'attacker' ? 'defender' : 'attacker';
}

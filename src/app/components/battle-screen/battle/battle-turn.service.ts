import { Injectable } from '@angular/core';
import { BattleModelState, BattleSide } from './battle.types';
import { getAliveStackCount } from './battle-grid';
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

import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, GridCell } from './battle.types';
import { getStacks } from './battle-state';
import { cellDistance, isInRange, linePath } from './battle-grid';
import { BattleCombatService } from './battle-combat.service';
import { BattleMovementService } from './battle-movement.service';
import { BattleTurnService } from './battle-turn.service';

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
 * Turn plan:
 *   1. attack with every stack that already has an enemy in range
 *   2. move the remaining stacks toward the nearest enemy stack
 *   3. attack again with stacks that moved into range
 *   4. end the turn
 */

@Injectable({ providedIn: 'root' })
export class BattleAiService {
  constructor(
    private combat: BattleCombatService,
    private movement: BattleMovementService,
    private turn: BattleTurnService,
  ) {}

  async playTurn(state: BattleModelState): Promise<void> {
    if (state.winner || this.turn.checkVictory(state)) {
      return;
    }

    console.log('[BattleAI] playTurn start:', { activeSide: state.activeSide, ap: state.ap, animBusy: this.turn['anim']?.isBusy });

    const stacks = getStacks(state, state.activeSide);

    for (const stack of stacks) {
      if (state.winner) {
        break;
      }
      const target = this.bestTarget(state, stack);
      if (target) {
        console.log('[BattleAI] attacking:', stack.stackId, '->', target.stackId);
        await this.combat.attackStack(state, stack.stackId, target.stackId);
      }
    }

    for (const stack of stacks) {
      if (state.winner || stack.attackedThisTurn) {
        continue;
      }
      await this.moveTowardNearestEnemy(state, stack);
    }

    for (const stack of stacks) {
      if (state.winner || stack.attackedThisTurn) {
        continue;
      }
      const target = this.bestTarget(state, stack);
      if (target) {
        console.log('[BattleAI] post-move attacking:', stack.stackId, '->', target.stackId);
        await this.combat.attackStack(state, stack.stackId, target.stackId);
      }
    }

    if (!state.winner) {
      console.log('[BattleAI] ending turn');
      const ended = this.turn.endTurn(state);
      if (!ended) {
        console.error('[BattleAI] endTurn failed - anim.isBusy:', this.turn['anim']?.isBusy);
        throw new Error('AI turn could not end: animation lock still active');
      }
    }
    console.log('[BattleAI] playTurn complete');
  }

  private bestTarget(state: BattleModelState, stack: BattleStack): BattleStack | null {
    if (stack.attackedThisTurn || stack.attackAp > state.ap) {
      return null;
    }
    const origin: GridCell = { col: stack.col, row: stack.row };
    const candidates = state.stacks.filter(
      (s) => !s.destroyed && s.side !== stack.side && isInRange(origin, s, stack.attackRange),
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, s) => {
      const bestDist = cellDistance(origin, best);
      const dist = cellDistance(origin, s);
      if (dist < bestDist) {
        return s;
      }
      if (dist === bestDist && s.stackId < best.stackId) {
        return s;
      }
      return best;
    });
  }

  private async moveTowardNearestEnemy(state: BattleModelState, stack: BattleStack): Promise<void> {
    if (stack.immobile || stack.moveRange <= 0 || stack.cellsMovedThisTurn >= stack.moveRange) {
      return;
    }
    const origin: GridCell = { col: stack.col, row: stack.row };
    const enemy = state.stacks
      .filter((s) => !s.destroyed && s.side !== stack.side)
      .sort(
        (a, b) =>
          cellDistance(origin, a) - cellDistance(origin, b) || a.stackId.localeCompare(b.stackId),
      )[0];
    if (!enemy) {
      return;
    }

    const path = linePath(origin, { col: enemy.col, row: enemy.row });
    if (!path) {
      return;
    }
    const maxSteps = Math.min(stack.moveRange - stack.cellsMovedThisTurn, path.length);
    // Try the longest legal approach first; shrink the step count when the
    // straight line is blocked by an occupied cell.
    for (let d = maxSteps; d >= 1; d--) {
      const dest = path[d - 1];
      if (await this.movement.moveStack(state, stack.stackId, dest.col, dest.row)) {
        break;
      }
    }
  }
}

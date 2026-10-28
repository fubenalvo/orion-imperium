import { Injectable } from '@angular/core';
import { BattleModelState, BattleStack, AI_ACTION_COOLDOWN_MS, battleDebug } from './battle.types';
import { isSidePlayerControlled } from './battle-state';
import { absoluteDistanceRangeUnits, canAttack } from './battle-grid';
import { BattleCombatService } from './battle-combat.service';
import { BattleMovementService } from './battle-movement.service';
import { BattleTimeService } from './battle-time.service';

/*
 * =========================================================
 * BATTLE MINIGAME — TACTICAL AI
 * =========================================================
 *
 * Deterministic greedy controller. Reads and writes ONLY BattleModelState
 * — it has no knowledge of the strategic enemy-ai / strategy / goal /
 * action layers, which keeps the minigame self-contained.
 *
 * The AI decides movement and Carrier Shield Pulse only. It never fires:
 * firing is the shared per-stack fire control in BattleCombatService, which
 * gives both sides the same fire cadence regardless of fleet size.
 *
 * Every AI tick (AI_ACTION_INTERVAL_MS) each controlled stack whose
 * AI_ACTION_COOLDOWN_MS has expired gets at most one decision:
 *   1. Carrier: Shield Pulse if an ally in reach is below 50% shield.
 *   2. An enemy is already in reach: hold position (fire control shoots).
 *   3. Otherwise move toward the nearest enemy (move-to-attack, falling
 *      back to the closest reachable approach cell when no firing cell
 *      is free).
 *
 * The same controller drives AUTO battle for player stacks. Player stacks
 * holding a manual order (attack target or in-flight move) are never
 * touched — manual orders always win over AUTO.
 *
 * Immobile planet defenses are skipped (they cannot move; they still fire).
 */

@Injectable({ providedIn: 'root' })
export class BattleAiService {
  constructor(
    private combat: BattleCombatService,
    private movement: BattleMovementService,
    private time: BattleTimeService,
  ) {}

  /*
   * One AI decision pass. controlPlayerSides=false drives the non-player
   * side(s); true drives ONLY the player side (AUTO battle), so enabling
   * AUTO never gives the enemy extra decisions. Returns true if any stack
   * received a command.
   */
  async playAction(state: BattleModelState, controlPlayerSides = false): Promise<boolean> {
    if (state.winner) {
      return false;
    }
    let acted = false;
    for (const stack of this.getControlledStacks(state, controlPlayerSides)) {
      if (state.winner) {
        break;
      }
      if (stack.immobile || stack.moving || this.onActionCooldown(stack) || this.hasManualOrder(stack)) {
        continue;
      }
      if (await this.decide(state, stack)) {
        this.applyActionCooldown(stack);
        acted = true;
      }
    }
    return acted;
  }

  private async decide(state: BattleModelState, stack: BattleStack): Promise<boolean> {
    if (stack.typeId === 'carrier' && this.hasLowShieldAlly(state, stack)) {
      if (this.combat.carrierShieldBoost(state, stack.stackId)) {
        battleDebug(`[AI-PULSE] ${stack.stackId}`);
        return true;
      }
    }

    const enemies = state.stacks.filter((s) => !s.destroyed && s.side !== stack.side);
    if (enemies.some((e) => canAttack(stack, e))) {
      return false;
    }
    const nearest = enemies.sort(
      (a, b) =>
        absoluteDistanceRangeUnits(stack, a) - absoluteDistanceRangeUnits(stack, b) ||
        a.stackId.localeCompare(b.stackId),
    )[0];
    if (!nearest) {
      return false;
    }
    const moved = await this.movement.moveToAttack(state, stack.stackId, nearest.stackId);
    battleDebug(`[AI-MOVE] ${stack.stackId} -> ${nearest.stackId}: ${moved}`);
    return moved;
  }

  /* Player orders take priority over AUTO until completed or replaced. */
  private hasManualOrder(stack: BattleStack): boolean {
    return !!stack.explicitAttackTargetId || !!stack.manualMoveOrder;
  }

  private onActionCooldown(stack: BattleStack): boolean {
    return !!(stack.actionCooldownUntil && stack.actionCooldownUntil > this.time.battleElapsedMs);
  }

  private applyActionCooldown(stack: BattleStack): void {
    stack.actionCooldownUntil = this.time.battleElapsedMs + AI_ACTION_COOLDOWN_MS;
  }

  private getControlledStacks(state: BattleModelState, controlPlayerSides: boolean): BattleStack[] {
    return state.stacks.filter(
      (s) => !s.destroyed && isSidePlayerControlled(state, s.side) === controlPlayerSides,
    );
  }

  /* Any friendly stack within the carrier's reach below 50% total shield. */
  private hasLowShieldAlly(state: BattleModelState, carrier: BattleStack): boolean {
    return state.stacks.some((s) => {
      if (s.destroyed || s.side !== carrier.side || s.stackId === carrier.stackId) {
        return false;
      }
      if (!canAttack(carrier, s)) {
        return false;
      }
      const totalMaxShield = s.ships.reduce((sum, sh) => sum + (sh.alive ? sh.maxShield ?? 0 : 0), 0);
      if (totalMaxShield <= 0) {
        return false;
      }
      const totalShield = s.ships.reduce((sum, sh) => sum + (sh.alive ? sh.shield ?? 0 : 0), 0);
      return totalShield / totalMaxShield < 0.5;
    });
  }
}

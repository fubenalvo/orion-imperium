import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import {
  Battle,
  BattleModelState,
  BattleOutcome,
  BattleStack,
  DEFAULT_TARGETING_MODE,
  FIRE_RATE_MULTIPLIER,
  REFERENCE_FIRE_RATE,
  nextVolleyDueMs,
  SHIELD_REGEN_INTERVAL_MS,
} from './battle.types';
import { createBattleState } from './battle-state';
import { checkVictory, regenerateAllShields } from './battle-grid';
import { compareTargets } from './battle-targeting';
import { applyVolleyDamage } from './battle-combat.service';
import { buildBattleOutcome } from './battle-result';

/*
 * =========================================================
 * BATTLE MINIGAME — NON-INTERACTIVE AUTO-RESOLVER
 * =========================================================
 *
 * Resolves a Battle without the battle screen, for engagements the
 * player is not part of (AI fleets assaulting non-player planets) and for
 * the AI's own battle forecasts. Uses the same rules as the interactive
 * minigame wherever they do not depend on the grid:
 *  - stacks, ship stats, planet defense stacks and the shared planetary
 *    shield pool come from createBattleState (identical setup);
 *  - every stack fires on its own cadence (1 / fireRate s ×
 *    FIRE_RATE_MULTIPLIER, scheduled with nextVolleyDueMs so the 50 ms
 *    step does not round intervals up), like
 *    BattleCombatService.runFireControl minus its visual-only jitter;
 *  - volley damage is applyVolleyDamage, the exact function the animated
 *    battle uses;
 *  - targets are chosen with the stack's targeting mode via
 *    compareTargets (sticky target kept while alive);
 *  - shields regenerate every SHIELD_REGEN_INTERVAL_MS;
 *  - victory is checkVictory; the result is buildBattleOutcome, so the
 *    outcome is the same BattleOutcome the battle screen produces.
 *
 * Unavoidable simplifications (document them wherever results are shown):
 *  - No grid movement or range: every stack is treated as engaged with
 *    every enemy stack from the start (the minigame AI closes to range
 *    quickly; positioning skill is not modelled).
 *  - No laser bolts: every volley hits instantly. In the interactive battle
 *    bolts are aimed once and can miss a target that moves out of their
 *    path, so fast stacks at long range fare slightly better there.
 *  - Carrier Shield Pulse is not used.
 *  - A battle still undecided after `maxBattleMs` is a draw: the
 *    defender holds (winner 'defender', attacker not wiped out). The
 *    minigame itself has no time limit.
 */
export interface AutoResolveResult {
  outcome: BattleOutcome;
  timedOut: boolean;
  battleMs: number;
}

export const AUTO_RESOLVE_MAX_BATTLE_MS = 300_000;
const STEP_MS = 50;

export function autoResolveBattle(
  battle: Battle,
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
  maxBattleMs = AUTO_RESOLVE_MAX_BATTLE_MS,
): AutoResolveResult {
  const state = createBattleState(battle, shipService, planetBattleService);
  const nextFireAt = new Map<string, number>();
  let now = 0;
  let nextRegenAt = SHIELD_REGEN_INTERVAL_MS;

  checkVictory(state);
  while (!state.winner && now < maxBattleMs) {
    now += STEP_MS;
    if (now >= nextRegenAt) {
      regenerateAllShields(state);
      nextRegenAt += SHIELD_REGEN_INTERVAL_MS;
    }
    // Fixed stack order keeps the resolution deterministic.
    for (const stack of state.stacks) {
      if (stack.destroyed || state.winner) {
        continue;
      }
      if ((nextFireAt.get(stack.stackId) ?? 0) > now) {
        continue;
      }
      if (!stack.ships.some((s) => s.alive && s.attack > 0)) {
        continue;
      }
      const target = selectTarget(state, stack);
      if (!target) {
        continue;
      }
      nextFireAt.set(stack.stackId, nextVolleyDueMs(nextFireAt.get(stack.stackId), now, fireIntervalMs(stack)));
      stack.autoTargetId = target.stackId;
      applyVolleyDamage(state, stack, target);
      checkVictory(state);
    }
  }

  const timedOut = !state.winner;
  if (timedOut) {
    state.winner = 'defender';
  }
  return { outcome: buildBattleOutcome(state), timedOut, battleMs: now };
}

function fireIntervalMs(stack: BattleStack): number {
  const fireRate = stack.fireRate > 0 ? stack.fireRate : REFERENCE_FIRE_RATE;
  return (1000 / fireRate) * FIRE_RATE_MULTIPLIER;
}

/* Sticky target first (as in the minigame), otherwise the best enemy by mode, ignoring range. */
function selectTarget(state: BattleModelState, attacker: BattleStack): BattleStack | null {
  const sticky = state.stacks.find((s) => s.stackId === attacker.autoTargetId && !s.destroyed && s.side !== attacker.side);
  if (sticky) {
    return sticky;
  }
  const mode = attacker.targetingMode ?? DEFAULT_TARGETING_MODE;
  let best: BattleStack | null = null;
  for (const candidate of state.stacks) {
    if (candidate.destroyed || candidate.side === attacker.side) {
      continue;
    }
    if (!best || compareTargets(state, attacker, mode, candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

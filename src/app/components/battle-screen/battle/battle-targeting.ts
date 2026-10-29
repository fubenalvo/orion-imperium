import {
  BattleModelState,
  BattleStack,
  BattleTargetingMode,
  DEFAULT_TARGETING_MODE,
} from './battle.types';
import {
  absoluteDistanceRangeUnits,
  canAttack,
  computeTargetScore,
  weaponMultiplier,
} from './battle-grid';

/*
 * =========================================================
 * BATTLE MINIGAME — FIRE TARGET SELECTION
 * =========================================================
 *
 * Single source of truth for "whom does this stack shoot right now". Used by
 * BattleCombatService.runFireControl() for every stack on both sides, so
 * player stacks, AUTO-controlled stacks and enemy AI stacks all follow the
 * same rules. Pure: reads state, mutates only the stack's autoTargetId
 * bookkeeping in rememberAutoTarget().
 *
 * Priority:
 *   1. Manual order (explicitAttackTargetId) when that target is in reach.
 *   2. Sticky automatic target (autoTargetId) while it is alive and in reach.
 *      Avoids switching targets every volley; the sticky target is dropped
 *      when it dies, leaves reach, or the targeting mode changes.
 *   3. Best in-reach enemy for the stack's targetingMode.
 *
 * A manual target that is out of reach does NOT block step 2/3: the stack
 * fires opportunistically at whatever it can hit while the movement service
 * chases the ordered target. The manual order itself is never cleared here.
 *
 * Only enemies inside reach are ever candidates; choosing whom to approach
 * is a movement decision (BattleAiService / BattleMovementService).
 */

export const TARGETING_MODES: readonly BattleTargetingMode[] = [
  'balanced',
  'strongest',
  'weakest',
  'firepower',
];

export const TARGETING_MODE_LABELS: Record<BattleTargetingMode, string> = {
  balanced: 'BALANCED',
  strongest: 'STRONGEST',
  weakest: 'WEAKEST',
  firepower: 'FIREPOWER',
};

function aliveShips(stack: BattleStack) {
  return stack.ships.filter((s) => s.alive);
}

/* Remaining hull + shield of the stack, plus the shared planetary shield
 * pool for immobile planet defenses (the pool absorbs damage for them
 * first, see BattleCombatService). */
export function effectiveDurability(state: BattleModelState, stack: BattleStack): number {
  const own = aliveShips(stack).reduce((sum, s) => sum + s.hp + (s.shield ?? 0), 0);
  const pool = stack.immobile ? (state.defenderShieldPool?.current ?? 0) : 0;
  return own + pool;
}

/* Offensive output: total volley attack × volleys per second. */
export function firepower(stack: BattleStack): number {
  const attack = aliveShips(stack).reduce((sum, s) => sum + s.attack, 0);
  return attack * (stack.fireRate ?? 1.5);
}

/* Damage one volley of `attacker` would deal to `target`, using the same
 * formula as BattleCombatService.attackStack (front-ship defense and
 * weapon matchup, floor of 1). */
export function expectedVolleyDamage(attacker: BattleStack, target: BattleStack): number {
  const totalAttack = aliveShips(attacker).reduce((sum, s) => sum + s.attack, 0);
  const front = target.ships.find((s) => s.alive);
  if (!front) {
    return 0;
  }
  const attackerFront = attacker.ships.find((s) => s.alive);
  const multiplier = weaponMultiplier(attackerFront?.attackType ?? 'kinetic', front.weakness ?? 'energy');
  return Math.max(1, Math.floor((totalAttack - front.defense) * multiplier));
}

/* Volleys this attacker needs to destroy the target. Ignores shield regen
 * and spill-over of defense between ships — a ranking heuristic, not a
 * simulation. */
export function volleysToKill(state: BattleModelState, attacker: BattleStack, target: BattleStack): number {
  const damage = expectedVolleyDamage(attacker, target);
  if (damage <= 0) {
    return Infinity;
  }
  return Math.ceil(effectiveDurability(state, target) / damage);
}

/*
 * Returns <0 when `a` is the better target, >0 when `b` is. Every mode
 * ends with the same tie-breakers (nearer first, then stackId) so the
 * choice is deterministic.
 */
export function compareTargets(
  state: BattleModelState,
  attacker: BattleStack,
  mode: BattleTargetingMode,
  a: BattleStack,
  b: BattleStack,
): number {
  const distA = absoluteDistanceRangeUnits(attacker, a);
  const distB = absoluteDistanceRangeUnits(attacker, b);
  let primary = 0;
  switch (mode) {
    case 'strongest':
      primary =
        effectiveDurability(state, b) - effectiveDurability(state, a) ||
        firepower(b) - firepower(a);
      break;
    case 'weakest':
      primary =
        volleysToKill(state, attacker, a) - volleysToKill(state, attacker, b) ||
        effectiveDurability(state, a) - effectiveDurability(state, b);
      break;
    case 'firepower':
      primary =
        firepower(b) - firepower(a) ||
        // Among equally dangerous targets, kill the one that dies fastest.
        effectiveDurability(state, a) - effectiveDurability(state, b);
      break;
    case 'balanced':
    default:
      primary = computeTargetScore(attacker, b, distB) - computeTargetScore(attacker, a, distA);
      break;
  }
  if (primary !== 0 && Number.isFinite(primary)) {
    return primary;
  }
  return distA - distB || a.stackId.localeCompare(b.stackId);
}

/* Best in-reach enemy for the given mode, or null when nothing is in reach. */
export function selectBestTarget(
  state: BattleModelState,
  attacker: BattleStack,
  mode: BattleTargetingMode = attacker.targetingMode ?? DEFAULT_TARGETING_MODE,
): BattleStack | null {
  let best: BattleStack | null = null;
  for (const s of state.stacks) {
    if (s.destroyed || s.side === attacker.side || !canAttack(attacker, s)) {
      continue;
    }
    if (!best || compareTargets(state, attacker, mode, s, best) < 0) {
      best = s;
    }
  }
  return best;
}

function findLiveEnemy(state: BattleModelState, attacker: BattleStack, id: string | null | undefined): BattleStack | null {
  if (!id) {
    return null;
  }
  const s = state.stacks.find((c) => c.stackId === id);
  return s && !s.destroyed && s.side !== attacker.side ? s : null;
}

/* Whom this stack should shoot right now, following the priority above. */
export function selectFireTarget(state: BattleModelState, attacker: BattleStack): BattleStack | null {
  const manual = findLiveEnemy(state, attacker, attacker.explicitAttackTargetId);
  if (manual && canAttack(attacker, manual)) {
    return manual;
  }
  const sticky = findLiveEnemy(state, attacker, attacker.autoTargetId);
  if (sticky && canAttack(attacker, sticky)) {
    return sticky;
  }
  return selectBestTarget(state, attacker);
}

/* Records the automatic target after a volley so the next volley keeps it.
 * Manual-order volleys are not recorded: once the order ends, the stack
 * should pick fresh by its mode. */
export function rememberAutoTarget(attacker: BattleStack, target: BattleStack): void {
  if (attacker.explicitAttackTargetId === target.stackId) {
    return;
  }
  attacker.autoTargetId = target.stackId;
}

/* Changing the mode must take effect immediately, so the sticky target
 * chosen under the old mode is discarded. */
export function setTargetingMode(stack: BattleStack, mode: BattleTargetingMode): void {
  if (stack.targetingMode === mode) {
    return;
  }
  stack.targetingMode = mode;
  stack.autoTargetId = null;
}

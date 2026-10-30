import { BattleModelState, BattleSide, BattleStack } from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — SHIP HEADING (presentation only)
 * =========================================================
 *
 * Turns each ship icon toward where it is going, at a limited turn rate, so
 * movement reads as flight rather than sliding. BattleStack.heading is the
 * only output; nothing in movement, collision, range or targeting reads it.
 *
 * Rules:
 *   - A moving stack steers toward its current movement target
 *     (targetX/targetY). Final approaches shorter than STEER_MIN_DIST_VW do
 *     not steer, so grid snapping and tiny re-plans never make a ship twitch.
 *   - An idle stack eases back to its side's default facing (attacker →
 *     right, defender → left), i.e. toward the enemy.
 *   - Immobile stacks (planet turrets) always keep the default facing.
 *   - Turn rate depends on tier: light ships turn fast, capital ships slowly.
 *
 * Driven by scaled battle time from the game loop (after
 * updateStackPositions), so pausing freezes turning and battle speed scales it.
 * Angles are degrees in screen space (0 = right, 90 = down), kept in (-180, 180].
 */

/* Degrees per battle second, by tier (1 = scout/fighter … 5 = dreadnought). */
const TURN_RATE_BY_TIER: Record<number, number> = {
  1: 240,
  2: 180,
  3: 130,
  4: 100,
  5: 75,
};
const DEFAULT_TURN_RATE = 130;

/* Remaining distance (field units) below which a mover keeps its heading. */
const STEER_MIN_DIST_VW = 0.3;

export function defaultHeading(side: BattleSide): number {
  return side === 'attacker' ? 0 : 180;
}

/* Heading to draw for a stack; falls back to the side default before the first update. */
export function stackHeading(stack: BattleStack): number {
  return stack.heading ?? defaultHeading(stack.side);
}

/* Signed shortest rotation from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

function desiredHeading(stack: BattleStack): number {
  if (stack.immobile) {
    return defaultHeading(stack.side);
  }
  if (stack.moving && stack.targetX != null && stack.targetY != null) {
    const dx = stack.targetX - stack.x;
    const dy = stack.targetY - stack.y;
    if (Math.hypot(dx, dy) < STEER_MIN_DIST_VW) {
      return stackHeading(stack);
    }
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }
  return defaultHeading(stack.side);
}

export function updateStackHeadings(state: BattleModelState, deltaTime: number): void {
  if (deltaTime <= 0) {
    return;
  }
  for (const stack of state.stacks) {
    if (stack.destroyed) {
      continue;
    }
    const current = stackHeading(stack);
    const diff = angleDelta(current, desiredHeading(stack));
    const maxStep = (TURN_RATE_BY_TIER[stack.tier] ?? DEFAULT_TURN_RATE) * deltaTime;
    const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
    stack.heading = angleDelta(0, current + step);
  }
}

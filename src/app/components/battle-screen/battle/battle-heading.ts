import { BattleModelState, BattleSide, BattleStack } from './battle.types';

/*
 * =========================================================
 * BATTLE MINIGAME — SHIP HEADING AND MANEUVERING
 * =========================================================
 *
 * Turns each ship toward where it is going at a limited turn rate, and
 * slows a ship that is not yet pointing where it travels, so ships turn
 * into a course instead of sliding sideways or backwards at full speed.
 *
 * Heading rules:
 *   - A moving stack steers toward its current movement target
 *     (targetX/targetY). Final approaches shorter than STEER_MIN_DIST_VW do
 *     not steer, so grid snapping and tiny re-plans never make a ship twitch.
 *   - An idle stack eases back to its side's default facing (attacker →
 *     right, defender → left), i.e. toward the enemy.
 *   - Immobile stacks (planet turrets) always keep the default facing.
 *   - Turn rate depends on tier: light ships turn fast, capital ships slowly.
 *
 * Maneuver speed (maneuverSpeedFactor, applied in updateStackPositions):
 *   - Off-axis angle = |heading − direction of travel|.
 *   - ≤ FULL_THRUST_ANGLE (20°): full speed.
 *   - FULL_THRUST_ANGLE … MIN_THRUST_ANGLE (160°): eases down (smoothstep).
 *   - ≥ MIN_THRUST_ANGLE: tier floor (40% light … 20% dreadnought), never 0,
 *     so every move still completes and nothing can deadlock.
 *   - Final approaches under STEER_MIN_DIST_VW are not penalised (they do
 *     not steer either).
 *
 * This makes heading gameplay-relevant for travel TIME only: paths,
 * destinations, collision, range and targeting are unchanged.
 *
 * Driven by scaled battle time from the game loop, which updates headings
 * BEFORE positions each frame, so pausing freezes turning and battle speed
 * scales it. Angles are degrees in screen space (0 = right, 90 = down),
 * kept in (-180, 180].
 */

/* Off-axis angles (degrees) bounding the speed falloff. */
const FULL_THRUST_ANGLE = 20;
const MIN_THRUST_ANGLE = 160;

/* Speed share kept at ≥ MIN_THRUST_ANGLE, by tier: nimble light hulls keep
 * more way on while turning than capital ships. */
const MIN_THRUST_BY_TIER: Record<number, number> = {
  1: 0.4,
  2: 0.35,
  3: 0.3,
  4: 0.25,
  5: 0.2,
};
const DEFAULT_MIN_THRUST = 0.3;

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

/* Speed multiplier (0 < f ≤ 1) for a stack travelling by (dx, dy) this frame,
 * from how far its heading is off the direction of travel. */
export function maneuverSpeedFactor(stack: BattleStack, dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < STEER_MIN_DIST_VW) {
    return 1;
  }
  const travel = (Math.atan2(dy, dx) * 180) / Math.PI;
  const offAxis = Math.abs(angleDelta(stackHeading(stack), travel));
  const t = Math.min(1, Math.max(0, (offAxis - FULL_THRUST_ANGLE) / (MIN_THRUST_ANGLE - FULL_THRUST_ANGLE)));
  const eased = t * t * (3 - 2 * t);
  const floor = MIN_THRUST_BY_TIER[stack.tier] ?? DEFAULT_MIN_THRUST;
  return 1 - (1 - floor) * eased;
}

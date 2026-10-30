/*
 * =========================================================
 * BATTLE MINIGAME — BACKGROUND PARALLAX
 * =========================================================
 *
 * Drives the battle screen's layered starfield offset from the pointer (or
 * device tilt). Pure and framework-free so it can be unit tested.
 *
 * Why it exists: the old implementation wrote the raw pointer position
 * straight into the layer transforms and snapped back to the centre on
 * `mouseleave`. Leaving and re-entering therefore made the background jump
 * twice (to the centre, then to wherever the cursor re-entered). Here:
 *
 *  - input only sets a TARGET offset; the visible offset eases toward it
 *    with a frame-rate-independent exponential filter (step(), called every
 *    animation frame with REAL time, so it also eases while the battle is
 *    paused);
 *  - leaving the screen does nothing — the background stays where it is,
 *    and re-entering eases from there instead of snapping;
 *  - pointer coordinates are normalised against the element the listener is
 *    bound to (its bounding rect), not the window, so the maths stays
 *    correct if the screen is ever not full-viewport;
 *  - device-orientation events without data (desktop browsers emit one with
 *    null angles) are ignored instead of being read as "centre".
 *
 * Offsets are normalised to [-1, 1] on both axes; the component maps them to
 * per-layer translations.
 */

/* Seconds for the visible offset to cover ~63% of the distance to the
 * target. Large enough to hide input jitter, small enough to feel responsive. */
export const PARALLAX_SMOOTHING_TAU_S = 0.25;

/* Below this per-axis distance the offset is considered settled and snapped
 * exactly onto the target, so idle frames stop producing new transforms. */
const SETTLE_EPSILON = 0.0005;

export interface PointerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export class BattleParallax {
  private targetX = 0;
  private targetY = 0;
  private currentX = 0;
  private currentY = 0;

  get x(): number {
    return this.currentX;
  }

  get y(): number {
    return this.currentY;
  }

  get settled(): boolean {
    return this.currentX === this.targetX && this.currentY === this.targetY;
  }

  /* Pointer position relative to `rect`, mapped to [-1, 1]. Positions
   * outside the rect clamp to the edge rather than overshooting. */
  setPointer(clientX: number, clientY: number, rect: PointerRect): void {
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    this.targetX = clampUnit(((clientX - rect.left) / rect.width) * 2 - 1);
    this.targetY = clampUnit(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  /* Device tilt in degrees (DeviceOrientationEvent gamma: left/right,
   * beta: front/back). Null readings carry no information and are ignored. */
  setTilt(gamma: number | null, beta: number | null): void {
    if (gamma == null && beta == null) {
      return;
    }
    if (gamma != null) {
      this.targetX = clampUnit(gamma / 90);
    }
    if (beta != null) {
      this.targetY = clampUnit(beta / 45);
    }
  }

  /* Advances the eased offset by `realDeltaSec` of wall-clock time. */
  step(realDeltaSec: number): void {
    if (realDeltaSec <= 0 || this.settled) {
      return;
    }
    const k = 1 - Math.exp(-realDeltaSec / PARALLAX_SMOOTHING_TAU_S);
    this.currentX += (this.targetX - this.currentX) * k;
    this.currentY += (this.targetY - this.currentY) * k;
    if (Math.abs(this.targetX - this.currentX) < SETTLE_EPSILON) {
      this.currentX = this.targetX;
    }
    if (Math.abs(this.targetY - this.currentY) < SETTLE_EPSILON) {
      this.currentY = this.targetY;
    }
  }
}

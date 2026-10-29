/*
 * Fleet heading (render-only).
 *
 * Fleet markers rotate so the ship's nose points along its current movement
 * leg. Headings are presentation state only: they are never saved, never
 * read by gameplay code, and are rebuilt from scratch (default orientation)
 * after a load.
 *
 * Angles are SCREEN-space degrees, clockwise, 0 = pointing right (+x), as
 * consumed directly by CSS `rotate()`. Callers convert world deltas to
 * screen deltas first (the galaxy map scales x and y by different cell
 * sizes; the system view is uniform vw).
 *
 * Turning is an exponential approach along the shortest arc, driven by the
 * scaled game delta: frame-rate independent, frozen while paused, faster at
 * higher game speeds — consistent with the movement it illustrates.
 */

/*
 * Orientation of the hull artwork (public/fleet.svg) relative to +x. The
 * sprite is drawn side-on with its nose to the RIGHT and engines on the
 * left, so no offset is needed. Change this if the artwork is replaced.
 */
export const FLEET_SPRITE_FORWARD_DEG = 0;

/* Heading of a fleet that has never moved: the sprite's natural pose. */
export const DEFAULT_FLEET_HEADING_DEG = 0;

/*
 * Turn responsiveness (1/game second): ~95% of a turn completes in
 * 3 / rate ≈ 0.4 s at normal speed — quick enough to track route corners,
 * slow enough to read as a turn rather than a snap.
 */
export const FLEET_TURN_RATE_PER_SECOND = 7;

/* Below this residual (degrees) the heading snaps, so idle frames report no change. */
const HEADING_SNAP_DEG = 0.1;

/* Signed shortest rotation from `from` to `to`, in (-180, 180]. */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/* Normalizes an angle to [0, 360). */
export function normalizeAngle(angle: number): number {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
}

/*
 * Screen heading (CSS rotate degrees) of the sprite for a screen-space
 * direction, or null when the direction is degenerate (already there).
 */
export function headingForDirection(dx: number, dy: number): number | null {
  if (dx * dx + dy * dy < 1e-12) {
    return null;
  }
  return normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI - FLEET_SPRITE_FORWARD_DEG);
}

/* One smoothing step toward `desired` along the shortest arc. */
export function stepHeading(current: number, desired: number, dt: number, rate = FLEET_TURN_RATE_PER_SECOND): number {
  const delta = shortestAngleDelta(current, desired);
  if (Math.abs(delta) <= HEADING_SNAP_DEG) {
    return normalizeAngle(desired);
  }
  return normalizeAngle(current + delta * (1 - Math.exp(-rate * dt)));
}

/*
 * Per-view heading state, keyed by fleet id. One tracker per view because
 * a fleet's galaxy movement and its in-system movement are independent.
 * Allocation-free per frame apart from first-seen fleets.
 */
export class FleetHeadingTracker {
  private readonly headings = new Map<number, number>();

  get(fleetId: number): number {
    return this.headings.get(fleetId) ?? DEFAULT_FLEET_HEADING_DEG;
  }

  /*
   * Advances every fleet toward `desiredHeading(fleet)`; a null desired
   * heading (stationary) keeps the last meaningful orientation. Returns true
   * when any rendered heading changed, so the caller can redraw.
   */
  update<F extends { id: number }>(
    fleets: readonly F[],
    dt: number,
    desiredHeading: (fleet: F) => number | null,
  ): boolean {
    if (this.headings.size > fleets.length) {
      this.prune(fleets);
    }
    if (dt <= 0) {
      return false;
    }
    let changed = false;
    for (const fleet of fleets) {
      const desired = desiredHeading(fleet);
      if (desired === null) {
        continue;
      }
      const current = this.get(fleet.id);
      const next = stepHeading(current, desired, dt);
      if (next !== current) {
        this.headings.set(fleet.id, next);
        changed = true;
      }
    }
    return changed;
  }

  /* Drops state of fleets that no longer exist (destroyed, merged, disbanded). */
  private prune(fleets: readonly { id: number }[]): void {
    const alive = new Set(fleets.map((f) => f.id));
    for (const id of this.headings.keys()) {
      if (!alive.has(id)) this.headings.delete(id);
    }
  }

  clear(): void {
    this.headings.clear();
  }
}

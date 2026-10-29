import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLEET_HEADING_DEG,
  FleetHeadingTracker,
  headingForDirection,
  shortestAngleDelta,
  stepHeading,
} from './fleet-heading';

describe('fleet heading', () => {
  it('maps screen directions to CSS rotate degrees with the sprite nose pointing right', () => {
    expect(headingForDirection(1, 0)).toBeCloseTo(0);
    expect(headingForDirection(0, 1)).toBeCloseTo(90); // screen y grows downward
    expect(headingForDirection(-1, 0)).toBeCloseTo(180);
    expect(headingForDirection(0, -1)).toBeCloseTo(270);
    expect(headingForDirection(0, 0)).toBeNull();
  });

  it('turns along the shortest arc', () => {
    expect(shortestAngleDelta(350, 10)).toBeCloseTo(20);
    expect(shortestAngleDelta(10, 350)).toBeCloseTo(-20);
    expect(shortestAngleDelta(0, 180)).toBeCloseTo(180);
    // From 350° toward 10° the ship passes through 0°, not back through 180°.
    const next = stepHeading(350, 10, 0.05);
    expect(next > 350 || next < 10).toBe(true);
  });

  it('turns smoothly and converges, independent of frame splitting', () => {
    let a = 0;
    for (let i = 0; i < 6; i++) a = stepHeading(a, 90, 1 / 60);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(90);

    const one = stepHeading(0, 90, 0.2);
    let split = 0;
    for (let i = 0; i < 4; i++) split = stepHeading(split, 90, 0.05);
    expect(split).toBeCloseTo(one, 6);

    let settled = 0;
    for (let i = 0; i < 300; i++) settled = stepHeading(settled, 90, 1 / 60);
    expect(settled).toBe(90);
  });

  it('keeps the last orientation when stationary and the default for new fleets', () => {
    const tracker = new FleetHeadingTracker();
    const fleets = [{ id: 1, dir: 90 as number | null }, { id: 2, dir: null as number | null }];
    for (let i = 0; i < 300; i++) tracker.update(fleets, 1 / 60, (f) => f.dir);
    expect(tracker.get(1)).toBe(90);
    expect(tracker.get(2)).toBe(DEFAULT_FLEET_HEADING_DEG);

    fleets[0].dir = null; // stopped
    expect(tracker.update(fleets, 1 / 60, (f) => f.dir)).toBe(false);
    expect(tracker.get(1)).toBe(90);
  });

  it('does not turn while paused and reports changes only when headings move', () => {
    const tracker = new FleetHeadingTracker();
    const fleets = [{ id: 1 }];
    expect(tracker.update(fleets, 0, () => 120)).toBe(false);
    expect(tracker.get(1)).toBe(DEFAULT_FLEET_HEADING_DEG);
    expect(tracker.update(fleets, 1 / 60, () => 120)).toBe(true);
  });

  it('forgets fleets that no longer exist', () => {
    const tracker = new FleetHeadingTracker();
    tracker.update([{ id: 1 }, { id: 2 }], 1, () => 45);
    tracker.update([{ id: 2 }], 1, () => 45);
    expect(tracker.get(1)).toBe(DEFAULT_FLEET_HEADING_DEG);
    expect(tracker.get(2)).not.toBe(DEFAULT_FLEET_HEADING_DEG);
  });
});

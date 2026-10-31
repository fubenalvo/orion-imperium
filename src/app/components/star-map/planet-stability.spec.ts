import { describe, it, expect } from 'vitest';
import { PlanetStabilityState, planetStabilityNotices } from './planet-stability';

const state = (satisfaction: number, efficiency = 1, satisfactionDrift = 1): PlanetStabilityState => ({
  satisfaction,
  efficiency,
  satisfactionDrift,
});

describe('planetStabilityNotices', () => {
  it('announces an energy shortage once, and again only after it was fixed', () => {
    const announced = new Set<string>();
    const short = new Map([['Home', state(80, 0.9, 0.6)]]);
    expect(planetStabilityNotices(short, short, announced)).toEqual([
      'Home is 10% short on energy: output is reduced. Build power.',
    ]);
    expect(planetStabilityNotices(short, short, announced)).toEqual([]);

    const powered = new Map([['Home', state(80)]]);
    planetStabilityNotices(short, powered, announced);
    expect(announced.size).toBe(0);
    expect(planetStabilityNotices(powered, short, announced)).toHaveLength(1);
  });

  it('mentions falling satisfaction when the shortage drains it', () => {
    const lines = planetStabilityNotices(new Map(), new Map([['Home', state(80, 0.4, -1)]]), new Set());
    expect(lines[0]).toContain('satisfaction drops');
  });

  it('warns when satisfaction falls through 50% and 20%, reporting the lowest level crossed', () => {
    const announced = new Set<string>();
    expect(planetStabilityNotices(new Map([['Home', state(51)]]), new Map([['Home', state(49.5)]]), announced)).toEqual([
      'Home satisfaction is down to 50%. At 0% the planet rebels.',
    ]);
    expect(planetStabilityNotices(new Map([['Home', state(49)]]), new Map([['Home', state(48)]]), announced)).toEqual([]);
    expect(planetStabilityNotices(new Map([['Home', state(55)]]), new Map([['Home', state(15)]]), announced)).toEqual([
      'Home satisfaction is down to 20%. At 0% the planet rebels.',
    ]);
    // Rising satisfaction never warns.
    expect(planetStabilityNotices(new Map([['Home', state(15)]]), new Map([['Home', state(60)]]), announced)).toEqual([]);
  });

  it('announces a planet lost during the tick as a rebellion', () => {
    const announced = new Set(['Home']);
    const lines = planetStabilityNotices(new Map([['Home', state(0.5, 0.4, -1)]]), new Map(), announced);
    expect(lines).toEqual(['Home rebelled and declared independence.']);
    expect(announced.size).toBe(0);
  });
});

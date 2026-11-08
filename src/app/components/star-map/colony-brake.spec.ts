import { describe, it, expect } from 'vitest';
import { canSupportNewColony } from './ai-queries';
import { EconomyBreakdown } from './star-map.models';
import { marginalColonyCost } from '../../services/economy.service';

/*
 * AI colony brake with the starter buildings' upkeep (2026-11-08): a fresh
 * colony gets its first housing block and a mine at once, so their upkeep
 * counts — but only for a treasury that cannot carry it for the runway.
 */
const PLANETS = 12;
const STARTER = 12;
const breakdown = (net: number): EconomyBreakdown =>
  ({ incomePerSecond: 1000, netPerSecond: net, buildingUpkeepPerSecond: 0, shipUpkeepPerSecond: 0, stationUpkeepPerSecond: 0 }) as EconomyBreakdown;
/* A net that leaves exactly `margin` after the 13th planet's administration cost. */
const netWithMargin = (margin: number) => marginalColonyCost(breakdown(0), PLANETS) + margin;

describe('canSupportNewColony with starter upkeep', () => {
  it('blocks a colony whose starter buildings would push an empty treasury below zero', () => {
    expect(canSupportNewColony(breakdown(netWithMargin(5)), PLANETS, 0)).toBe(true);
    expect(canSupportNewColony(breakdown(netWithMargin(5)), PLANETS, 0, STARTER)).toBe(false);
    expect(canSupportNewColony(breakdown(netWithMargin(STARTER + 1)), PLANETS, 0, STARTER)).toBe(true);
  });

  it('ignores the starter upkeep when the treasury carries it for the runway (300 s)', () => {
    expect(canSupportNewColony(breakdown(netWithMargin(5)), PLANETS, STARTER * 300, STARTER)).toBe(true);
    // Below that the starter upkeep counts; the 7/s deficit it leaves is then judged by the
    // usual small-deficit runway (300 s of it = 2100 credits).
    expect(canSupportNewColony(breakdown(netWithMargin(5)), PLANETS, 2000, STARTER)).toBe(false);
    expect(canSupportNewColony(breakdown(netWithMargin(5)), PLANETS, 2100, STARTER)).toBe(true);
  });

  it('lets a faction without planets colonize regardless', () => {
    expect(canSupportNewColony(breakdown(0), 0, 0, 1000)).toBe(true);
  });
});

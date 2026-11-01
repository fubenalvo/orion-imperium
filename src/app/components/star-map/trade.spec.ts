import { describe, it, expect } from 'vitest';
import {
  TRADE_BUY_CREDITS_PER_RAW,
  TRADE_SELL_CREDITS_PER_RAW,
  TRADING_POST_NAME,
  executeTrade,
  quoteTrade,
  tradeBlocker,
} from './trade';
import { Faction, PlanetTile } from './star-map.models';
import planetData from './planet-data.json';
import researchTree from './research-tree.json';

const faction = (credits: number, raw: number): Faction => ({
  id: 'player',
  name: 'Player',
  color: '#fff',
  team: 1,
  ai: false,
  currencies: { credits, rawmaterials: raw, research: 0 },
});

const planet = (withPost = true, factionId = 'player'): PlanetTile => ({
  id: 1,
  index: 0,
  name: 'Home',
  factionId,
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'medium',
  population: 100,
  explored: true,
  buildings: withPost ? [{ name: TRADING_POST_NAME, size: 2, x: 0, y: 0 }] : [],
} as PlanetTile);

describe('Trading Post exchange', () => {
  it('is a 2x2 trade building unlocked by a starting technology', () => {
    const def = (planetData as { buildings: { id: string; name: string; size: number; role: string }[] }).buildings
      .find((b) => b.id === 'trading_post')!;
    expect(def).toMatchObject({ name: TRADING_POST_NAME, size: 2, role: 'trade' });
    const unlockedBy = (researchTree as { technologies: { id: string; unlocksBuildings: string[] }[] }).technologies
      .find((t) => t.unlocksBuildings.includes('trading_post'));
    expect(unlockedBy?.id).toBe('basic_industry');
  });

  it('prices purchases high and sales low (whole credits)', () => {
    expect(quoteTrade('buyRaw', 100).credits).toBe(100 * TRADE_BUY_CREDITS_PER_RAW);
    expect(quoteTrade('sellRaw', 100).credits).toBe(Math.floor(100 * TRADE_SELL_CREDITS_PER_RAW));
    // A round trip loses most of the value: it is a last resort.
    const back = quoteTrade('sellRaw', 100).credits;
    expect(back / quoteTrade('buyRaw', 100).credits).toBeLessThan(0.1);
  });

  it('buys and sells atomically', () => {
    const f = faction(1000, 500);
    const buy = executeTrade(f, planet(), 'buyRaw', 100);
    expect(buy.ok).toBe(true);
    expect(f.currencies).toMatchObject({ credits: 1000 - 100 * TRADE_BUY_CREDITS_PER_RAW, rawmaterials: 600 });

    const sell = executeTrade(f, planet(), 'sellRaw', 500);
    expect(sell.ok).toBe(true);
    expect(f.currencies).toMatchObject({ credits: 600 + 125, rawmaterials: 100 });
  });

  it('refuses without a post, on a foreign planet, or without the stock — and changes nothing', () => {
    const f = faction(100, 50);
    expect(tradeBlocker(f, planet(false), 'buyRaw', 10)).toBe('no_trading_post');
    expect(tradeBlocker(f, planet(true, 'enemy1'), 'buyRaw', 10)).toBe('not_owner');
    expect(tradeBlocker(f, planet(), 'buyRaw', 100)).toBe('insufficient_credits');
    expect(tradeBlocker(f, planet(), 'sellRaw', 100)).toBe('insufficient_raw');
    expect(tradeBlocker(f, planet(), 'sellRaw', 0)).toBe('invalid_amount');
    expect(tradeBlocker(f, planet(), 'sellRaw', 1.5)).toBe('invalid_amount');
    expect(executeTrade(f, planet(), 'buyRaw', 100).ok).toBe(false);
    expect(f.currencies).toMatchObject({ credits: 100, rawmaterials: 50 });
  });
});

import { Faction, PlanetTile } from './star-map.models';

/*
 * Trading Post exchange (docs/economy.md, "Trading Post").
 *
 * A planet with a Trading Post lets its owner swap credits and raw
 * materials. The rates are deliberately bad — a last resort, not an
 * economy: buying raw costs TRADE_BUY_CREDITS_PER_RAW credits per unit,
 * selling raw pays TRADE_SELL_CREDITS_PER_RAW. A round trip keeps only
 * 1/16 of the value. For comparison, a Mining Complex yields ~15 raw/s for
 * ~6 credits/s of upkeep (~0.4 credits per unit), and warships cost about
 * three times their credit price in raw materials.
 *
 * Rules (same for every faction; only the player uses it today — the AI
 * has no trade logic and never builds the post, see ai-pipeline.md):
 * - the planet must be owned by the trader and carry a Trading Post;
 * - a trade is atomic: it either happens in full or not at all;
 * - credits are whole units: a purchase rounds the price up, a sale rounds
 *   the proceeds down, so trading never creates fractional credits;
 * - the Trading Post is a building like any other (price, upkeep, energy,
 *   workforce); it does not need to be powered or staffed to trade.
 */

export const TRADING_POST_NAME = 'Trading Post';
export const TRADE_BUY_CREDITS_PER_RAW = 4;
export const TRADE_SELL_CREDITS_PER_RAW = 0.25;
/* Raw-material lot sizes the trade panel offers. */
export const TRADE_LOTS: readonly number[] = [100, 500, 1000];

export type TradeDirection = 'buyRaw' | 'sellRaw';

export type TradeRejection = 'no_trading_post' | 'not_owner' | 'invalid_amount' | 'insufficient_credits' | 'insufficient_raw';

export interface TradeQuote {
  direction: TradeDirection;
  /* Raw materials bought or sold. */
  raw: number;
  /* Credits paid (buyRaw) or received (sellRaw). */
  credits: number;
}

export function hasTradingPost(planet: PlanetTile | null | undefined): boolean {
  return (planet?.buildings ?? []).some((b) => b.name === TRADING_POST_NAME);
}

export function quoteTrade(direction: TradeDirection, raw: number): TradeQuote {
  const credits = direction === 'buyRaw'
    ? Math.ceil(raw * TRADE_BUY_CREDITS_PER_RAW)
    : Math.floor(raw * TRADE_SELL_CREDITS_PER_RAW);
  return { direction, raw, credits };
}

/* Why the trade cannot happen now, or null when it can. */
export function tradeBlocker(
  faction: Faction,
  planet: PlanetTile | null | undefined,
  direction: TradeDirection,
  raw: number,
): TradeRejection | null {
  if (!planet || !hasTradingPost(planet)) return 'no_trading_post';
  if (planet.factionId !== faction.id) return 'not_owner';
  if (!Number.isInteger(raw) || raw <= 0) return 'invalid_amount';
  const quote = quoteTrade(direction, raw);
  if (direction === 'buyRaw' && (faction.currencies['credits'] ?? 0) < quote.credits) return 'insufficient_credits';
  if (direction === 'sellRaw' && (faction.currencies['rawmaterials'] ?? 0) < raw) return 'insufficient_raw';
  return null;
}

/* Applies the trade to the faction's stock; returns the quote, or the reason it was refused. */
export function executeTrade(
  faction: Faction,
  planet: PlanetTile | null | undefined,
  direction: TradeDirection,
  raw: number,
): { ok: true; quote: TradeQuote } | { ok: false; reason: TradeRejection } {
  const reason = tradeBlocker(faction, planet, direction, raw);
  if (reason) return { ok: false, reason };
  const quote = quoteTrade(direction, raw);
  const credits = faction.currencies['credits'] ?? 0;
  const rawStock = faction.currencies['rawmaterials'] ?? 0;
  if (direction === 'buyRaw') {
    faction.currencies['credits'] = credits - quote.credits;
    faction.currencies['rawmaterials'] = rawStock + raw;
  } else {
    faction.currencies['credits'] = credits + quote.credits;
    faction.currencies['rawmaterials'] = rawStock - raw;
  }
  return { ok: true, quote };
}

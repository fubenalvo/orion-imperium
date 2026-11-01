import { Fleet, Trader } from './star-map.models';
import { ATTACK_REAIM_DISTANCE } from './fleet-attack-orders';

/*
 * Player raid orders against civilian traders (docs/trade-network.md#raids).
 *
 * A raid order is a pursuit: `Fleet.raidTraderId` names the trader, and the
 * fleet's galaxy target is re-aimed at the trader whenever it drifted
 * ATTACK_REAIM_DISTANCE away from the last aim point. Damage is NOT dealt
 * here — TradeNetworkService applies it to every fleet with a raid order
 * within raid range.
 *
 * The order ends (raidTraderId cleared; the fleet keeps flying to the last
 * aimed point) when the trader is gone (destroyed or removed), docks (docked
 * traders cannot be raided), may no longer be raided (e.g. its post was
 * captured by an ally), leaves the player's sensor picture, or becomes
 * unreachable. Any manual move, intercept or attack order replaces it.
 * Player fleets only: AI raids are steered by the AI's own fleet logic.
 */

export type RaidOrderEnd = 'gone' | 'docked' | 'not-allowed' | 'lost-contact' | 'no-route';

export interface RaidOrderHooks {
  getTrader(id: number): Trader | undefined;
  /* True when the trader is visible to the player (fog of war). */
  isVisible(trader: Trader): boolean;
  /* True when the raider's faction may raid this trader (trade-network.ts raidBlocker). */
  canRaid(raider: Fleet, trader: Trader): boolean;
  /* Sets the raider's galaxy target if a safe route exists; false if not. */
  retarget(raider: Fleet, x: number, y: number): boolean;
}

export interface RaidOrderEvent {
  raider: Fleet;
  traderId: number;
  reason: RaidOrderEnd;
}

export function updateRaidOrders(
  fleets: readonly Fleet[],
  hooks: RaidOrderHooks,
): { ended: RaidOrderEvent[]; retargeted: boolean } {
  const ended: RaidOrderEvent[] = [];
  let retargeted = false;
  for (const raider of fleets) {
    if (raider.raidTraderId == null || raider.factionId !== 'player') continue;
    const traderId = raider.raidTraderId;
    if (raider.destroyed) {
      raider.raidTraderId = null;
      continue;
    }
    const trader = hooks.getTrader(traderId);
    let reason: RaidOrderEnd | null = null;
    if (!trader) {
      reason = 'gone';
    } else if (trader.status !== 'travelling') {
      reason = 'docked';
    } else if (!hooks.canRaid(raider, trader)) {
      reason = 'not-allowed';
    } else if (!hooks.isVisible(trader)) {
      reason = 'lost-contact';
    } else {
      const drifted =
        raider.targetX === null ||
        raider.targetY === null ||
        Math.abs(raider.targetX - trader.x) >= ATTACK_REAIM_DISTANCE ||
        Math.abs(raider.targetY - trader.y) >= ATTACK_REAIM_DISTANCE;
      if (drifted) {
        if (hooks.retarget(raider, trader.x, trader.y)) {
          retargeted = true;
        } else {
          reason = 'no-route';
        }
      }
    }
    if (reason) {
      raider.raidTraderId = null;
      ended.push({ raider, traderId, reason });
    }
  }
  return { ended, retargeted };
}

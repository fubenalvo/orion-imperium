import { describe, it, expect } from 'vitest';
import { Fleet, Trader } from './star-map.models';
import { RaidOrderHooks, updateRaidOrders } from './fleet-raid-orders';

/* Player raid pursuit (docs/trade-network.md#raids). */
describe('updateRaidOrders', () => {
  const trader = (extra: Partial<Trader> = {}): Trader => ({
    id: 7, homePlanetId: 1, slot: 0, x: 20, y: 20, status: 'travelling', portPlanetId: 1,
    destinationPlanetId: 2, dockSeconds: 0, cargo: { credits: 500, goods: 'Alloys' }, hull: 300, ...extra,
  });
  const fleet = (extra: Partial<Fleet> = {}): Fleet =>
    ({ id: 1, name: 'ORION', factionId: 'player', x: 10, y: 10, targetX: null, targetY: null, speed: 8, system: null, ships: [], raidTraderId: 7, ...extra }) as Fleet;
  const hooks = (t: Trader | undefined, extra: Partial<RaidOrderHooks> = {}): RaidOrderHooks => ({
    getTrader: () => t,
    isVisible: () => true,
    canRaid: () => true,
    retarget: (raider, x, y) => {
      raider.targetX = x;
      raider.targetY = y;
      return true;
    },
    ...extra,
  });

  it('aims the raider at the trader and follows it once it drifted', () => {
    const f = fleet();
    const t = trader();
    expect(updateRaidOrders([f], hooks(t)).retargeted).toBe(true);
    expect([f.targetX, f.targetY]).toEqual([20, 20]);
    t.x = 20.2;
    expect(updateRaidOrders([f], hooks(t)).retargeted).toBe(false);
    t.x = 21;
    expect(updateRaidOrders([f], hooks(t)).retargeted).toBe(true);
    expect(f.raidTraderId).toBe(7);
  });

  it.each([
    ['gone', undefined, {}],
    ['docked', trader({ status: 'docked', destinationPlanetId: null }), {}],
    ['not-allowed', trader(), { canRaid: () => false }],
    ['lost-contact', trader(), { isVisible: () => false }],
    ['no-route', trader(), { retarget: () => false }],
  ] as const)('ends the order when the trader is %s', (reason, t, extra) => {
    const f = fleet();
    const { ended } = updateRaidOrders([f], hooks(t as Trader | undefined, extra as Partial<RaidOrderHooks>));
    expect(ended).toEqual([{ raider: f, traderId: 7, reason }]);
    expect(f.raidTraderId).toBeNull();
  });

  it('leaves AI fleets alone (their raids are steered by the AI)', () => {
    const ai = fleet({ factionId: 'enemy1' });
    expect(updateRaidOrders([ai], hooks(undefined))).toEqual({ ended: [], retargeted: false });
    expect(ai.raidTraderId).toBe(7);
  });
});

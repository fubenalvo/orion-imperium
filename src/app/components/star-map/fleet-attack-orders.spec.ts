import { describe, expect, it, vi } from 'vitest';
import { AttackOrderHooks, updateAttackOrders } from './fleet-attack-orders';
import { Fleet } from './star-map.models';

const fleet = (id: number, factionId: string, x: number, y: number): Fleet => ({
  id,
  name: `F${id}`,
  factionId,
  x,
  y,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  ships: [],
});

const hooks = (over: Partial<AttackOrderHooks> = {}): AttackOrderHooks => ({
  isVisible: () => true,
  isHostile: (a, b) => a.factionId !== b.factionId,
  retarget: (a, x, y) => {
    a.targetX = x;
    a.targetY = y;
    return true;
  },
  ...over,
});

describe('updateAttackOrders', () => {
  it('re-aims the attacker at the quarry only after it drifted noticeably', () => {
    const attacker = { ...fleet(1, 'player', 10, 10), attackFleetId: 2 };
    const quarry = fleet(2, 'enemy1', 20, 10);
    const retarget = vi.fn(hooks().retarget);

    let result = updateAttackOrders([attacker, quarry], hooks({ retarget }));
    expect(result.retargeted).toBe(true);
    expect([attacker.targetX, attacker.targetY]).toEqual([20, 10]);

    quarry.x = 20.2; // small drift: no replanning
    result = updateAttackOrders([attacker, quarry], hooks({ retarget }));
    expect(result.retargeted).toBe(false);
    expect(retarget).toHaveBeenCalledTimes(1);

    quarry.x = 22;
    updateAttackOrders([attacker, quarry], hooks({ retarget }));
    expect(attacker.targetX).toBe(22);
    expect(attacker.attackFleetId).toBe(2);
  });

  it('ends the order when the quarry is destroyed, gone, out of sight or unreachable', () => {
    const cases: [string, (q: Fleet) => Fleet[], Partial<AttackOrderHooks>, string][] = [
      ['destroyed', (q) => [{ ...q, destroyed: true }], {}, 'destroyed'],
      ['gone', () => [], {}, 'destroyed'],
      ['no longer hostile', (q) => [q], { isHostile: () => false }, 'destroyed'],
      ['out of sight', (q) => [q], { isVisible: () => false }, 'lost-contact'],
      ['unreachable', (q) => [q], { retarget: () => false }, 'no-route'],
    ];
    for (const [, others, over, reason] of cases) {
      const attacker = { ...fleet(1, 'player', 10, 10), targetX: 15, targetY: 10, attackFleetId: 2 };
      const result = updateAttackOrders([attacker, ...others(fleet(2, 'enemy1', 30, 10))], hooks(over));
      expect(attacker.attackFleetId).toBeNull();
      expect(result.ended.map((e) => e.reason)).toEqual([reason]);
      // The fleet keeps flying to the last aimed point.
      expect(attacker.targetX).toBe(15);
    }
  });

  it('leaves the encounter to battle detection once both share a cell', () => {
    const attacker = { ...fleet(1, 'player', 20.1, 10.2), attackFleetId: 2 };
    const quarry = fleet(2, 'enemy1', 20.9, 10.9);
    const retarget = vi.fn(() => true);
    updateAttackOrders([attacker, quarry], hooks({ retarget }));
    expect(retarget).not.toHaveBeenCalled();
    expect(attacker.attackFleetId).toBe(2);
  });

  it('ignores non-player fleets', () => {
    const ai = { ...fleet(1, 'enemy1', 10, 10), attackFleetId: 2 };
    const retarget = vi.fn(() => true);
    updateAttackOrders([ai, fleet(2, 'player', 20, 10)], hooks({ retarget }));
    expect(retarget).not.toHaveBeenCalled();
    expect(ai.attackFleetId).toBeNull();
  });
});

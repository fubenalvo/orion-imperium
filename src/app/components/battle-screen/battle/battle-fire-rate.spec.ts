import shipData from '../../star-map/ship-data.json';
import planetData from '../../star-map/planet-data.json';
import { BattleModelState, BattleShip, BattleStack, REFERENCE_FIRE_RATE, nextVolleyDueMs, volleyShare } from './battle.types';
import { applyVolleyDamage, fireJitter, shotScale } from './battle-combat.service';
import { firepower } from './battle-targeting';

function ship(overrides: Partial<BattleShip> = {}): BattleShip {
  return {
    shipId: 1,
    typeId: 'fighter',
    hp: 100,
    maxHp: 100,
    attack: 15,
    defense: 3,
    alive: true,
    shield: 0,
    maxShield: 0,
    attackType: 'kinetic',
    // No matchup entry → neutral 1.0x, so the expected numbers are plain.
    weakness: 'none',
    ...overrides,
  } as BattleShip;
}

function stack(id: string, fireRate: number, ships: BattleShip[], side: 'attacker' | 'defender' = 'attacker'): BattleStack {
  return { stackId: id, side, typeId: ships[0].typeId, fireRate, ships, immobile: false, destroyed: false } as BattleStack;
}

const freshState = () => ({ stacks: [], effects: [], projectiles: [] }) as unknown as BattleModelState;

/* Total damage `attacker` deals over `seconds` firing at its own cadence. */
function damageOver(attacker: BattleStack, seconds: number): number {
  const state = freshState();
  const target = stack('t', 1, [ship({ hp: 1e9, maxHp: 1e9, defense: 3 })], 'defender');
  const volleys = Math.round(seconds * attacker.fireRate);
  let total = 0;
  for (let i = 0; i < volleys; i++) {
    total += applyVolleyDamage(state, attacker, target).damage;
  }
  return total;
}

describe('per-class fire rate', () => {
  it('gives light classes a faster cadence than capital ships', () => {
    const rate = (id: string) => shipData.shipTypes.find((s) => s.id === id)!.fireRate;
    expect(rate('fighter')).toBeGreaterThan(rate('frigate'));
    expect(rate('frigate')).toBeGreaterThan(rate('cruiser'));
    expect(rate('cruiser')).toBeGreaterThan(rate('battleship'));
    expect(rate('battleship')).toBeGreaterThan(rate('dreadnought'));
    const turrets = (planetData as { buildings: { id: string; fireRate?: number }[] }).buildings;
    expect(turrets.find((b) => b.id === 'laser_turret')!.fireRate).toBeGreaterThan(
      turrets.find((b) => b.id === 'missile_turret')!.fireRate!,
    );
  });

  it('keeps damage per second equal to the reference cadence for every rate', () => {
    // Reference: 15 attack - 3 defense = 12 per reference volley at 1.5/s.
    const expectedPerSecond = 12 * REFERENCE_FIRE_RATE;
    for (const rate of [4, 3, 2.2, 1.5, 0.9, 0.5]) {
      const total = damageOver(stack('a' + rate, rate, [ship()]), 60);
      expect(Math.abs(total - expectedPerSecond * 60), `rate ${rate}`).toBeLessThanOrEqual(1);
    }
  });

  it('subtracts defense from the reference volley, not from each small shot', () => {
    // 4 shots/s with 15 attack vs defense 3: per-shot subtraction would leave
    // (15 * 0.375 - 3) = 2.6 per shot; the rule keeps 12 * 0.375 = 4.5.
    const total = damageOver(stack('f', 4, [ship()]), 10);
    expect(total).toBeCloseTo(4.5 * 40, -1);
  });

  it('is identical to the old single-volley damage at the reference rate', () => {
    const state = freshState();
    const target = stack('t', 1, [ship({ hp: 500, maxHp: 500, defense: 3 })], 'defender');
    expect(applyVolleyDamage(state, stack('r', REFERENCE_FIRE_RATE, [ship(), ship()]), target).damage).toBe(27);
    expect(state.damageCarry!['r']).toBe(0);
  });

  it('firepower ranking does not depend on fire rate', () => {
    expect(firepower(stack('a', 4, [ship()]))).toBe(firepower(stack('b', 0.5, [ship()])));
  });

  it('volleyShare splits a reference volley by fire rate', () => {
    expect(volleyShare({ fireRate: 3 })).toBeCloseTo(0.5, 10);
    expect(volleyShare({ fireRate: 0.75 })).toBeCloseTo(2, 10);
    expect(volleyShare({ fireRate: 0 })).toBe(1);
  });
});

describe('volley scheduling', () => {
  it('does not lose cadence to frame quantization during sustained fire', () => {
    const interval = 250; // fighter
    let due: number | undefined;
    let shots = 0;
    for (let now = 0; now <= 10_000; now += 1000 / 60) {
      if ((due ?? 0) <= now) {
        due = nextVolleyDueMs(due, now, interval);
        shots++;
      }
    }
    expect(shots).toBeGreaterThanOrEqual(40);
    expect(shots).toBeLessThanOrEqual(41);
  });

  it('restarts from now after an idle gap (no stored burst)', () => {
    expect(nextVolleyDueMs(1000, 5000, 250)).toBe(5250);
    expect(nextVolleyDueMs(undefined, 300, 250)).toBe(550);
  });

  it('jitters each volley slightly and deterministically', () => {
    const samples = Array.from({ length: 200 }, (_, i) => fireJitter('attacker:fighter:0', i * 250));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.92);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.08);
    expect(new Set(samples.map((v) => v.toFixed(3))).size).toBeGreaterThan(20);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(1, 1);
    expect(fireJitter('x', 1234)).toBe(fireJitter('x', 1234));
  });
});

describe('shot visual scale', () => {
  const classStack = (id: string) => {
    const t = shipData.shipTypes.find((s) => s.id === id)!;
    return stack(id, t.fireRate, [ship({ typeId: id, attack: t.attack })]);
  };

  it('draws light rapid shots small and capital shots large', () => {
    const order = ['fighter', 'frigate', 'cruiser', 'battleship', 'dreadnought'].map((id) => shotScale(classStack(id)));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
    expect(order[0]).toBeLessThan(0.7);
    expect(order[order.length - 1]).toBeGreaterThan(1.5);
    // A destroyer shot is about today's (medium-heavy) bolt size.
    expect(shotScale(classStack('destroyer'))).toBeGreaterThan(0.9);
    expect(shotScale(classStack('destroyer'))).toBeLessThan(1.15);
  });
});

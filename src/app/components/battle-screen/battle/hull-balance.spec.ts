import { TestBed } from '@angular/core/testing';
import { autoResolveBattle } from './battle-auto-resolve';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle } from './battle.types';
import { Fleet } from '../../star-map/star-map.models';

/*
 * Hull-class balance acceptance (docs/battle-rules.md#hull-classes): equal
 * credit budgets, auto-resolved with both side assignments. The counter
 * cycle light > heavy > medium > light must hold for every hull pair at
 * mid and large fleet sizes, and no hull may win every matchup.
 * The carrier is a support hull (shield aura) and is checked separately:
 * one carrier must improve a fleet of the same cost, and a carrier-only
 * fleet must not win.
 */
const LIGHT = ['fighter', 'corvette', 'frigate'];
const MEDIUM = ['destroyer', 'cruiser'];
const HEAVY = ['battleship', 'battlecruiser', 'dreadnought'];
const ALL = [...LIGHT, ...MEDIUM, ...HEAVY];
const BUDGETS = [6000, 14400];

describe('hull class balance (auto-resolve, equal budgets)', () => {
  let ships: ShipService;
  let planets: PlanetBattleService;
  let shipId = 1;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ships = TestBed.inject(ShipService);
    planets = TestBed.inject(PlanetBattleService);
  });

  const fleet = (id: number, type: string, budget: number): Fleet => ({
    id,
    name: `F${id}`,
    factionId: id === 1 ? 'a' : 'b',
    x: 0,
    y: 0,
    targetX: null,
    targetY: null,
    speed: 1,
    system: null,
    ships: Array.from({ length: Math.floor(budget / ships.getShipType(type)!.cost) }, () => ({ id: shipId++, name: type, type })),
  });

  /* Remaining budget share of `a` minus that of `b`, averaged over both side assignments (> 0: a wins). */
  const score = (a: string, b: string, budget: number): number => {
    let total = 0;
    for (const swap of [false, true]) {
      const fa = fleet(1, a, budget);
      const fb = fleet(2, b, budget);
      const battle = {
        fleet1: swap ? fb : fa,
        fleet2: swap ? fa : fb,
        attackerId: swap ? 2 : 1,
        defenderId: swap ? 1 : 2,
        type: 'fleet',
      } as unknown as Battle;
      const { outcome } = autoResolveBattle(battle, ships, planets);
      const left = (side: 'attacker' | 'defender', type: string) =>
        (outcome[side].survivors.length * ships.getShipType(type)!.cost) / budget;
      total += left(swap ? 'defender' : 'attacker', a) - left(swap ? 'attacker' : 'defender', b);
    }
    return total / 2;
  };

  const expectBeats = (winners: string[], losers: string[]) => {
    for (const budget of BUDGETS) {
      for (const w of winners) {
        for (const l of losers) {
          expect(score(w, l, budget), `${w} vs ${l} @ ${budget}`).toBeGreaterThan(0);
        }
      }
    }
  };

  it('light hulls beat heavy hulls', () => expectBeats(LIGHT, HEAVY));
  it('medium hulls beat light hulls', () => expectBeats(MEDIUM, LIGHT));
  it('heavy hulls beat medium hulls', () => expectBeats(HEAVY, MEDIUM));

  /* Remaining-cost share of `a` minus that of `b` for explicit rosters, both side assignments. */
  const rosterScore = (a: string[], b: string[]): number => {
    const cost = (types: string[]) => types.reduce((sum, t) => sum + ships.getShipType(t)!.cost, 0);
    const make = (id: number, types: string[]): Fleet => ({
      ...fleet(id, 'fighter', 0),
      ships: types.map((type) => ({ id: shipId++, name: type, type })),
    });
    let total = 0;
    for (const swap of [false, true]) {
      const fa = make(1, a);
      const fb = make(2, b);
      const battle = { fleet1: swap ? fb : fa, fleet2: swap ? fa : fb, attackerId: swap ? 2 : 1, defenderId: swap ? 1 : 2, type: 'fleet' } as unknown as Battle;
      const { outcome } = autoResolveBattle(battle, ships, planets);
      const left = (side: 'attacker' | 'defender', types: string[]) =>
        outcome[side].survivors.reduce((sum, s) => sum + ships.getShipType(s.typeId)!.cost, 0) / cost(types);
      total += left(swap ? 'defender' : 'attacker', a) - left(swap ? 'attacker' : 'defender', b);
    }
    return total / 2;
  };
  const n = (type: string, count: number): string[] => Array(count).fill(type);

  it('one carrier makes a fleet stronger than the same cost without it', () => {
    expect(rosterScore(['carrier', ...n('destroyer', 10)], n('destroyer', 12)), 'destroyers').toBeGreaterThan(0);
    expect(rosterScore(['carrier', ...n('cruiser', 6)], n('cruiser', 7)), 'cruisers').toBeGreaterThan(0);
    expect(rosterScore(['carrier', ...n('frigate', 20)], n('frigate', 23)), 'frigates').toBeGreaterThan(0);
    expect(rosterScore([...n('carrier', 2), ...n('destroyer', 16)], n('destroyer', 20)), 'two carriers').toBeGreaterThan(0);
  });

  it('a carrier-only fleet does not win (auras do not stack)', () => {
    for (const [type, count] of [['destroyer', 19], ['cruiser', 12], ['frigate', 27], ['dreadnought', 4]] as const) {
      expect(rosterScore(n('carrier', 10), n(type, count)), type).toBeLessThan(0);
    }
  });

  it('no hull wins every matchup', () => {
    for (const hull of ALL) {
      const losses = ALL.filter((other) => other !== hull && score(hull, other, 6000) < 0);
      expect(losses.length, hull).toBeGreaterThan(0);
    }
  });
});

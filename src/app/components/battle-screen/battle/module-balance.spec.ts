import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { autoResolveBattle } from './battle-auto-resolve';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle } from './battle.types';
import { Fleet } from '../../star-map/star-map.models';
import { EquipmentDefinition, getModule, getUpgradeModules } from '../../star-map/equipment';

/*
 * Equipment module balance (docs/ship-equipment.md, C.1 and roadmap 8b):
 * a refit must be worse per price than more hulls, or modules would replace
 * hulls. Auto-resolved mirror battles of one hull, both side assignments,
 * at equal resources (credits + raw materials): a fleet fitted with one
 * module against a plain fleet of the same hull, which gets the module's
 * price as extra hulls.
 *
 * Only "pure stat" pairings are held to the rule: modules that do not
 * change the hull's damage type or defense profile. A type change in a
 * mirror battle is a counter (a Kinetic Barrier resisting the other side's
 * own kinetic guns) and is meant to win; the damage-type table keeps those
 * effects at ±20%.
 *
 * Measured 2026-11-08 (before the Laser Cannon was toned down to +6 attack
 * and fire rate ×1.1, its ×1.2 version beat equal-resource cruisers and
 * dreadnoughts): every pure-stat pairing scores ≤ 0 at 14,400 and 43,200.
 * Budgets are large so the module price buys whole hulls on both sides.
 */
const HULLS = ['fighter', 'frigate', 'destroyer', 'cruiser', 'battleship', 'dreadnought'];
const BUDGETS = [14400, 43200];
/* Ties and rounding of whole ships allow a little slack. */
const TOLERANCE = 0.05;

describe('equipment module balance (auto-resolve, equal resources)', () => {
  let ships: ShipService;
  let planets: PlanetBattleService;
  let shipId = 1;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ships = TestBed.inject(ShipService);
    planets = TestBed.inject(PlanetBattleService);
  });

  const hullPrice = (type: string) => ships.getShipType(type)!.cost + (ships.getShipType(type)!.rawMaterialCost ?? 0);
  const modulePrice = (module: EquipmentDefinition) => module.price!.credits + module.price!.rawmaterials;

  const fleet = (id: number, type: string, count: number, module?: EquipmentDefinition): Fleet => ({
    id, name: `F${id}`, factionId: id === 1 ? 'a' : 'b', x: 0, y: 0, targetX: null, targetY: null, speed: 1, system: null,
    ships: Array.from({ length: count }, () => ({ id: shipId++, name: type, type, ...(module ? { equipment: { [module.slot]: module.id } } : {}) })),
  });

  /* Remaining resource share of the refit side minus the plain side, averaged over both side assignments (> 0: refit wins). */
  const score = (type: string, module: EquipmentDefinition, refitCount: number, plainCount: number, budget: number): number => {
    let total = 0;
    for (const swap of [false, true]) {
      const refit = fleet(1, type, refitCount, module);
      const plain = fleet(2, type, plainCount);
      const battle = {
        fleet1: swap ? plain : refit,
        fleet2: swap ? refit : plain,
        attackerId: swap ? 2 : 1,
        defenderId: swap ? 1 : 2,
        type: 'fleet',
      } as unknown as Battle;
      const { outcome } = autoResolveBattle(battle, ships, planets);
      const left = (side: 'attacker' | 'defender', unit: number) => (outcome[side].survivors.length * unit) / budget;
      total += left(swap ? 'defender' : 'attacker', hullPrice(type) + modulePrice(module)) - left(swap ? 'attacker' : 'defender', hullPrice(type));
    }
    return total / 2;
  };

  const pureStat = (type: string, module: EquipmentDefinition): boolean => {
    const hull = ships.getShipType(type)!;
    return (!module.attackType || module.attackType === hull.attackType) && (!module.resistType || module.resistType === hull.weakness);
  };

  const combatModules = () => getUpgradeModules().filter((m) => m.slot !== 'engine');

  it('makes a pure-stat refit worse per price than more hulls', () => {
    let checked = 0;
    for (const budget of BUDGETS) {
      for (const type of HULLS) {
        for (const module of combatModules()) {
          if (!pureStat(type, module)) continue;
          const refit = Math.floor(budget / (hullPrice(type) + modulePrice(module)));
          const plain = Math.floor(budget / hullPrice(type));
          expect(score(type, module, refit, plain, budget), `${module.id} on ${type} @ ${budget}`).toBeLessThanOrEqual(TOLERANCE);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('still makes a refitted fleet beat an equally large plain one', () => {
    for (const type of ['frigate', 'destroyer', 'cruiser']) {
      for (const module of combatModules()) {
        if (!pureStat(type, module)) continue;
        expect(score(type, module, 6, 6, 1), `${module.id} on ${type}, 6 vs 6`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the Laser Cannon at its toned-down values', () => {
    const laser = getModule('laser_cannon')!;
    expect(laser.fireRateFactor).toBe(1.1);
    expect(laser.modifiers).toEqual([{ stat: 'attack', add: 6 }]);
  });
});

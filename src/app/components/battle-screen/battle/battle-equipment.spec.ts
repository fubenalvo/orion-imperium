import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { ShipLoadout } from '../../star-map/equipment';
import { MIN_TURN_RATE } from '../../star-map/ship-stats';
import { autoResolveBattle } from './battle-auto-resolve';
import { createBattleState } from './battle-state';
import { turnRate } from './battle-heading';
import { firepower } from './battle-targeting';
import {
  BATTLE_SPEED_MULTIPLIER,
  Battle,
  BattleStack,
  CombatBonuses,
  FleetShip,
  damagePerSecondFactor,
  volleyShare,
} from './battle.types';

/*
 * Phase 3 of docs/ship-equipment.md: installed modules in battle. A
 * standard loadout must leave battles exactly as they were; modules add
 * their fixed values after research, stacks group by loadout, weapon fire
 * rate changes damage per second, engines change speed and turning.
 */

let nextId = 1;
const ships = (type: string, count: number, equipment?: ShipLoadout): FleetShip[] =>
  Array.from({ length: count }, () => ({ id: nextId++, name: 'Ship', type, ...(equipment ? { equipment: { ...equipment } } : {}) }));

const battleOf = (attacker: FleetShip[], defender: FleetShip[], combatBonuses?: CombatBonuses): Battle => ({
  fleet1: { id: 1, name: 'A', factionId: 'player', ships: attacker },
  fleet2: { id: 2, name: 'B', factionId: 'enemy1', ships: defender },
  faction1Name: 'A',
  faction1Color: '#fff',
  faction2Name: 'B',
  faction2Color: '#f00',
  attackerId: 1,
  defenderId: 2,
  type: 'fleet',
  ...(combatBonuses ? { combatBonuses } : {}),
});

describe('battle with equipment', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
    nextId = 1;
  });

  const state = (battle: Battle) => createBattleState(battle, shipService, planetBattleService);
  const sideStacks = (battle: Battle, side: 'attacker' | 'defender'): BattleStack[] =>
    state(battle).stacks.filter((s) => s.side === side);
  const type = (id: string) => shipService.getShipType(id)!;

  describe('standard loadouts', () => {
    it('build the same battle state as ships without the field', () => {
      for (const count of [3, 40]) {
        nextId = 1;
        const plain = state(battleOf(ships('cruiser', count), ships('fighter', count)));
        nextId = 1;
        const standard = state(
          battleOf(
            ships('cruiser', count, { engine: 'standard_engine', weapon: 'standard_weapon' }),
            ships('fighter', count, {}),
          ),
        );
        // Standard ships carry no equipment into the battle and their stacks no extra fields.
        expect(standard).toEqual(plain);
      }
    });

    it('add no equipment fields to stacks', () => {
      for (const stack of sideStacks(battleOf(ships('dreadnought', 2), ships('scout', 30)), 'defender')) {
        expect('loadout' in stack).toBe(false);
        expect('hullFireRate' in stack).toBe(false);
        expect('turnRateBonus' in stack).toBe(false);
      }
    });

    it('give the same auto-resolve outcome as ships without the field', () => {
      const run = (withField: boolean) => {
        nextId = 1;
        const eq = withField ? {} : undefined;
        return autoResolveBattle(
          battleOf(ships('destroyer', 8, eq), [...ships('frigate', 6, eq), ...ships('cruiser', 2, eq)]),
          shipService,
          planetBattleService,
        ).outcome;
      };
      expect(run(true)).toEqual(run(false));
    });
  });

  describe('ship values', () => {
    it('add fixed module values and replace damage type and profile', () => {
      const [stack] = sideStacks(battleOf(ships('cruiser', 1, { weapon: 'railgun', defense: 'kinetic_barrier' }), ships('scout', 1)), 'attacker');
      const [ship] = stack.ships;
      expect(ship.attack).toBe(type('cruiser').attack + 16);
      expect(ship.attackType).toBe('kinetic');
      expect(ship.defense).toBe(type('cruiser').defense + 6);
      expect(ship.weakness).toBe('kinetic');
      expect(ship.shield).toBe(type('cruiser').shield);
      expect(ship.equipment).toEqual({ weapon: 'railgun', defense: 'kinetic_barrier' });
    });

    it('apply research to the hull first and add the module after it', () => {
      const bonuses: CombatBonuses = { player: { attack: { cruiser: 1.25 }, shield: { cruiser: 1.2 } } };
      const battle = battleOf(ships('cruiser', 1, { weapon: 'railgun', defense: 'energy_shield' }), ships('scout', 1), bonuses);
      const [ship] = sideStacks(battle, 'attacker')[0].ships;
      expect(ship.attack).toBe(type('cruiser').attack * 1.25 + 16);
      expect(ship.shield).toBe(type('cruiser').shield * 1.2 + 40);
      expect(ship.maxShield).toBe(ship.shield);
    });

    it('ignore weapon and defense modules on civil hulls', () => {
      const [ship] = sideStacks(battleOf(ships('colonizer', 1, { weapon: 'railgun', defense: 'energy_shield' }), ships('scout', 1)), 'attacker')[0].ships;
      expect(ship.attack).toBe(type('colonizer').attack);
      expect(ship.equipment).toBeUndefined();
    });
  });

  describe('stacks', () => {
    it('give each small-fleet ship its own motion values', () => {
      const stacks = sideStacks(battleOf([...ships('scout', 1, { engine: 'ion_engine' }), ...ships('scout', 1)], ships('fighter', 1)), 'attacker');
      expect(stacks[0].speed).toBeCloseTo((type('scout').speed + 0.5) * BATTLE_SPEED_MULTIPLIER, 10);
      expect(stacks[0].turnRateBonus).toBe(-20);
      expect(stacks[0].loadout).toEqual({ engine: 'ion_engine' });
      expect(stacks[1].speed).toBe(type('scout').speed * BATTLE_SPEED_MULTIPLIER);
      expect(stacks[1].loadout).toBeUndefined();
    });

    it('split a large fleet by loadout, never mixing loadouts in one stack', () => {
      const fleet = [
        ...ships('destroyer', 12),
        ...ships('destroyer', 7, { weapon: 'missile_launcher' }),
        ...ships('destroyer', 11, { engine: 'warp_drive' }),
      ];
      const stacks = sideStacks(battleOf(fleet, ships('scout', 1)), 'attacker');
      expect(stacks.map((s) => s.ships.length)).toEqual([5, 5, 2, 5, 2, 5, 5, 1]);
      for (const stack of stacks) {
        const keys = new Set(stack.ships.map((s) => JSON.stringify(s.equipment ?? {})));
        expect(keys.size).toBe(1);
      }
      const missile = stacks.find((s) => s.loadout?.weapon === 'missile_launcher')!;
      expect(missile.attackRange).toBe(type('destroyer').range + 1);
      const warp = stacks.find((s) => s.loadout?.engine === 'warp_drive')!;
      expect(warp.speed).toBeCloseTo((type('destroyer').speed - 0.3) * BATTLE_SPEED_MULTIPLIER, 10);
      // Ids stay type-based and unique.
      expect(new Set(stacks.map((s) => s.stackId)).size).toBe(stacks.length);
      expect(stacks.every((s) => s.stackId.startsWith('attacker:destroyer:'))).toBe(true);
    });
  });

  describe('fire rate', () => {
    it('fires faster at the same damage per shot with a Laser Cannon', () => {
      const [laser, plain] = sideStacks(battleOf([...ships('dreadnought', 1, { weapon: 'laser_cannon' }), ...ships('dreadnought', 1)], ships('scout', 1)), 'attacker');
      expect(laser.fireRate).toBeCloseTo(type('dreadnought').fireRate! * 1.2, 10);
      expect(laser.hullFireRate).toBe(type('dreadnought').fireRate);
      expect(volleyShare(laser)).toBe(volleyShare(plain));
      expect(damagePerSecondFactor(laser)).toBeCloseTo(1.2, 10);
      expect(damagePerSecondFactor(plain)).toBe(1);
      // Targeting sees the extra damage per second.
      expect(firepower(laser) / firepower(plain)).toBeCloseTo((type('dreadnought').attack + 8) * 1.2 / type('dreadnought').attack, 10);
    });

    it('adds no hullFireRate for a weapon that keeps the hull rate', () => {
      const [railgun] = sideStacks(battleOf(ships('cruiser', 1, { weapon: 'railgun' }), ships('scout', 1)), 'attacker');
      expect(railgun.fireRate).toBe(type('cruiser').fireRate);
      expect('hullFireRate' in railgun).toBe(false);
    });
  });

  describe('turning', () => {
    it('adds the engine bonus to the tier turn rate with a floor', () => {
      expect(turnRate({ tier: 1 })).toBe(240);
      expect(turnRate({ tier: 5, turnRateBonus: 60 })).toBe(135);
      expect(turnRate({ tier: 5, turnRateBonus: -50 })).toBe(MIN_TURN_RATE);
    });
  });

  describe('outcomes', () => {
    it('lets the upgraded side of an otherwise equal fight win, on either side', () => {
      for (const upgradedAttacks of [true, false]) {
        nextId = 1;
        const upgraded = ships('destroyer', 6, { weapon: 'railgun' });
        const plain = ships('destroyer', 6);
        const battle = upgradedAttacks ? battleOf(upgraded, plain) : battleOf(plain, upgraded);
        const { outcome } = autoResolveBattle(battle, shipService, planetBattleService);
        expect(outcome.winnerSide).toBe(upgradedAttacks ? 'attacker' : 'defender');
        const winner = upgradedAttacks ? outcome.attacker : outcome.defender;
        expect(winner.wipedOut).toBe(false);
      }
    });

    it('deals more damage per second with a faster weapon: Laser cruisers beat plain cruisers', () => {
      nextId = 1;
      // Cruiser is energy already, so the Laser changes only attack (+8) and fire rate (×1.2).
      const { outcome } = autoResolveBattle(battleOf(ships('cruiser', 4), ships('cruiser', 4, { weapon: 'laser_cannon' })), shipService, planetBattleService);
      expect(outcome.winnerSide).toBe('defender');
    });
  });
});

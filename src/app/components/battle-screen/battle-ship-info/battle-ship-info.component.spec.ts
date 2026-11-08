import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { BattleShipInfoComponent } from './battle-ship-info.component';
import { BATTLE_SPEED_MULTIPLIER, BattleShip, BattleStack } from '../battle/battle.types';

const ship = (extra: Partial<BattleShip> = {}): BattleShip => ({
  shipId: 1, name: 'S', typeId: 'cruiser', hp: 280, maxHp: 280, shield: 160, maxShield: 160, shieldRegen: 5,
  attackType: 'energy', weakness: 'kinetic', attack: 66, defense: 14, alive: true, ...extra,
});

const stack = (extra: Partial<BattleStack> = {}): BattleStack =>
  ({
    stackId: 'defender:cruiser:0', side: 'defender', typeId: 'cruiser', typeName: 'Cruiser', role: 'Line Ship',
    col: 1, row: 1, ships: [ship()], size: 2, tier: 3, hullClass: 'medium', attackRange: 3, immobile: false,
    moving: false, firing: false, destroyed: false, speed: 3 * BATTLE_SPEED_MULTIPLIER, x: 0, y: 0,
    targetX: null, targetY: null, fireRate: 1.2, targetingMode: 'balanced', ...extra,
  }) as BattleStack;

describe('BattleShipInfoComponent', () => {
  const create = (target: BattleStack, viewer: BattleStack | null = null) => {
    const component = TestBed.createComponent(BattleShipInfoComponent).componentInstance;
    component.stack = target;
    component.viewer = viewer;
    return component;
  };

  it('lists the modules, standard ones included, and the fighting values', () => {
    const info = create(stack({ loadout: { weapon: 'laser_cannon' }, fireRate: 1.44, hullFireRate: 1.2 }));
    expect(info.slots.map((s) => [s.label, s.name, s.standard])).toEqual([
      ['Engine', 'Standard Engine', true],
      ['Weapon', 'Laser Cannon', false],
      ['Defense', 'Standard Defense', true],
    ]);
    const value = (label: string) => info.lines.find((l) => l.label === label)!.value;
    expect(value('Speed')).toBe('3');
    expect(value('Damage / s')).toBe('×1.20 of hull');
    expect(value('Resists')).toBe('kinetic · weak to missile');
  });

  it('shows no slots for static defenses and locks civil hull slots', () => {
    expect(create(stack({ hullClass: 'structure', immobile: true })).slots).toEqual([]);
    const civil = create(stack({ typeId: 'colonizer' }));
    expect(civil.slots.filter((s) => s.locked).map((s) => s.slot)).toEqual(['weapon', 'defense']);
  });

  it('gives the matchup both ways for an enemy seen from an own stack', () => {
    // Own heavy kinetic battleship vs enemy medium cruiser (profile kinetic, energy guns).
    const own = stack({
      side: 'attacker', typeId: 'battleship', typeName: 'Battleship', hullClass: 'heavy',
      ships: [ship({ attackType: 'kinetic', weakness: 'energy' })],
    });
    const m = create(stack(), own).matchup!;
    // Deals: kinetic vs kinetic profile 0.8 × heavy vs medium 1.35 = 1.08.
    expect(m.deals).toBe('×1.08');
    // Takes: energy vs energy profile 0.8 × medium vs heavy 0.75 = 0.6.
    expect(m.takes).toBe('×0.6');
    expect(m.takesTrend).toBe(1);
    expect(create(stack(), stack({ side: 'defender' })).matchup).toBeNull();
  });
});

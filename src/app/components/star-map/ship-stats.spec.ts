import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { getBattleShipStats } from '../battle-screen/battle/battle-ship-stats';
import { BATTLE_SPEED_MULTIPLIER } from '../battle-screen/battle/battle.types';
import { getUpgradeModules } from './equipment';
import { MIN_BATTLE_SPEED, effectiveFleetSpeed, resolveShipStats } from './ship-stats';

describe('ship-stats resolver', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
  });

  const type = (id: string) => shipService.getShipType(id)!;

  it('resolves a standard loadout to exactly the stats battle uses today, for every hull', () => {
    for (const shipType of shipService.getAllShipTypes()) {
      const resolved = resolveShipStats(shipType);
      const battle = getBattleShipStats(shipType.id, shipService, planetBattleService);
      const id = shipType.id;
      expect(resolved.attack, id).toBe(battle.attack);
      expect(resolved.attackType, id).toBe(battle.attackType);
      expect(resolved.defense, id).toBe(battle.defense);
      expect(resolved.weakness, id).toBe(battle.weakness);
      expect(resolved.shield, id).toBe(battle.shield);
      expect(resolved.shieldRegen, id).toBe(battle.shieldRegen);
      expect(resolved.range, id).toBe(battle.attackRange);
      expect(resolved.fireRate, id).toBe(battle.fireRate);
      expect(resolved.hullFireRate, id).toBe(battle.fireRate);
      expect(resolved.battleSpeed * BATTLE_SPEED_MULTIPLIER, id).toBe(battle.speed);
      expect(resolved.turnRateBonus, id).toBe(0);
      expect(resolved.strategicSpeedBonus, id).toBe(0);
    }
  });

  it('adds the same fixed value on every hull', () => {
    const fighter = resolveShipStats(type('fighter'), { weapon: 'railgun' });
    const dreadnought = resolveShipStats(type('dreadnought'), { weapon: 'railgun' });
    expect(fighter.attack - type('fighter').attack).toBe(16);
    expect(dreadnought.attack - type('dreadnought').attack).toBe(16);
    expect(fighter.attackType).toBe('kinetic');

    const cruiser = resolveShipStats(type('cruiser'), { defense: 'advanced_shield_generator' });
    expect(cruiser.shield).toBe(type('cruiser').shield + 60);
    expect(cruiser.shieldRegen).toBe(type('cruiser').shieldRegen + 3);
    expect(cruiser.weakness).toBe(type('cruiser').weakness);
  });

  it('applies research multipliers to the hull only, then the module', () => {
    const resolved = resolveShipStats(type('cruiser'), { weapon: 'railgun', defense: 'energy_shield' }, { attack: 1.25, shield: 1.2 });
    expect(resolved.attack).toBe(type('cruiser').attack * 1.25 + 16);
    expect(resolved.shield).toBe(type('cruiser').shield * 1.2 + 40);
  });

  it('applies research alone exactly like withCombatBonus does today', () => {
    const resolved = resolveShipStats(type('fighter'), undefined, { attack: 1.4, shield: 1.15 });
    expect(resolved.attack).toBe(type('fighter').attack * 1.4);
    expect(resolved.shield).toBe(type('fighter').shield * 1.15);
  });

  it('scales fire rate by the weapon factor and keeps the hull rate for damage per shot', () => {
    const laser = resolveShipStats(type('dreadnought'), { weapon: 'laser_cannon' });
    expect(laser.hullFireRate).toBe(type('dreadnought').fireRate);
    expect(laser.fireRate).toBeCloseTo(type('dreadnought').fireRate! * 1.2, 10);
    expect(laser.attackType).toBe('energy');

    const missiles = resolveShipStats(type('fighter'), { weapon: 'missile_launcher' });
    expect(missiles.fireRate).toBeCloseTo(type('fighter').fireRate! * 0.85, 10);
    expect(missiles.range).toBe(type('fighter').range + 1);
  });

  it('switches the defense profile with profile modules', () => {
    expect(resolveShipStats(type('scout'), { defense: 'kinetic_barrier' }).weakness).toBe('kinetic');
    expect(resolveShipStats(type('scout'), { defense: 'point_defense_array' }).weakness).toBe('missile');
    expect(resolveShipStats(type('cruiser'), { defense: 'energy_shield' }).weakness).toBe('energy');
  });

  it('sums engine, weapon and defense trade-offs and floors battle speed', () => {
    // Dreadnought speed 1: Railgun −0.3 and Kinetic Barrier −0.2 reach the floor exactly.
    const heavy = resolveShipStats(type('dreadnought'), { weapon: 'railgun', defense: 'kinetic_barrier' });
    expect(heavy.battleSpeed).toBeCloseTo(MIN_BATTLE_SPEED, 10);
    // Warp Drive pushes it below the floor, which holds.
    const slowest = resolveShipStats(type('dreadnought'), { engine: 'warp_drive', weapon: 'railgun', defense: 'kinetic_barrier' });
    expect(slowest.battleSpeed).toBe(MIN_BATTLE_SPEED);
    const ion = resolveShipStats(type('scout'), { engine: 'ion_engine' });
    expect(ion.battleSpeed).toBe(type('scout').speed + 0.5);
    expect(ion.turnRateBonus).toBe(-20);
    expect(ion.strategicSpeedBonus).toBe(0.5);
  });

  it('gives civil hulls engine effects only', () => {
    const colonizer = resolveShipStats(type('colonizer'), { engine: 'warp_drive', weapon: 'railgun', defense: 'energy_shield' });
    expect(colonizer.strategicSpeedBonus).toBe(1);
    expect(colonizer.attack).toBe(type('colonizer').attack);
    expect(colonizer.shield).toBe(type('colonizer').shield);
  });

  it('keeps every upgrade module usable on every combat hull', () => {
    for (const shipType of shipService.getAllShipTypes()) {
      for (const module of getUpgradeModules()) {
        const resolved = resolveShipStats(shipType, { [module.slot]: module.id });
        expect(resolved.attack, `${shipType.id}+${module.id}`).toBeGreaterThanOrEqual(1);
        expect(resolved.battleSpeed).toBeGreaterThanOrEqual(MIN_BATTLE_SPEED);
        expect(resolved.range).toBeGreaterThanOrEqual(1);
        expect(resolved.fireRate).toBeGreaterThan(0);
      }
    }
  });
});

describe('effectiveFleetSpeed', () => {
  const ship = (type: string, engine?: string, destroyed = false) => ({
    type,
    destroyed,
    equipment: engine ? { engine } : undefined,
  });

  it('returns the stored speed unchanged for standard engines', () => {
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('cruiser'), ship('fighter')] })).toBe(4);
    expect(effectiveFleetSpeed({ speed: 8, ships: [] })).toBe(8);
  });

  it('moves at the pace of the slowest engine among living ships', () => {
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('cruiser', 'warp_drive'), ship('fighter', 'warp_drive')] })).toBe(5);
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('cruiser', 'warp_drive'), ship('fighter', 'ion_engine')] })).toBe(4.5);
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('cruiser', 'warp_drive'), ship('fighter')] })).toBe(4);
  });

  it('ignores destroyed ships', () => {
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('cruiser', 'warp_drive'), ship('fighter', undefined, true)] })).toBe(5);
  });

  it('lets a civil hull carry a fast engine', () => {
    expect(effectiveFleetSpeed({ speed: 4, ships: [ship('colonizer', 'warp_drive')] })).toBe(5);
  });
});

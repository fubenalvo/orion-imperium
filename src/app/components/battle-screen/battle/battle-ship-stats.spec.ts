import { TestBed } from '@angular/core/testing';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { getBattleShipStats } from './battle-ship-stats';

describe('battle-ship-stats', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
  });

  const stats = (typeId: string) => getBattleShipStats(typeId, shipService, planetBattleService);

  it('maps every real ship type to its AP tier', () => {
    expect(stats('scout').tier).toBe(1);
    expect(stats('fighter').tier).toBe(1);
    expect(stats('colonizer').tier).toBe(1);
    expect(stats('corvette').tier).toBe(1);
    expect(stats('frigate').tier).toBe(2);
    expect(stats('destroyer').tier).toBe(2);
    expect(stats('cruiser').tier).toBe(3);
    expect(stats('carrier').tier).toBe(3);
    expect(stats('battleship').tier).toBe(4);
    expect(stats('battlecruiser').tier).toBe(4);
    expect(stats('dreadnought').tier).toBe(5);
  });

  it('uses the tier as both move AP per cell and attack AP', () => {
    for (const typeId of ['fighter', 'frigate', 'cruiser', 'battleship', 'dreadnought']) {
      const s = stats(typeId);
      expect(s.moveApPerCell).toBe(s.tier);
      expect(s.attackAp).toBe(s.tier);
    }
  });

  it('uses battleMoveRange for movement and range for attack range', () => {
    const fighter = stats('fighter');
    expect(fighter.moveRange).toBe(10); // battleMoveRange from ship-data.json
    expect(fighter.attackRange).toBe(2);
    expect(fighter.immobile).toBe(false);

    const dreadnought = stats('dreadnought');
    expect(dreadnought.moveRange).toBe(2); // battleMoveRange from ship-data.json
    expect(dreadnought.attackRange).toBe(5);
  });

  it('carries combat stats from the ship definition', () => {
    const frigate = stats('frigate');
    expect(frigate.maxHp).toBe(130);
    expect(frigate.attack).toBe(28);
    expect(frigate.defense).toBe(8);
  });

  it('carries weapon type and weakness from the ship definition', () => {
    const fighter = stats('fighter');
    expect(fighter.attackType).toBe('kinetic');
    expect(fighter.weakness).toBe('energy');
    expect(fighter.role).toBe('Interceptor');

    const corvette = stats('corvette');
    expect(corvette.attackType).toBe('energy');
    expect(corvette.weakness).toBe('kinetic');
    expect(corvette.role).toBe('Light Combat');

    const carrier = stats('carrier');
    expect(carrier.attackType).toBe('missile');
    expect(carrier.weakness).toBe('kinetic');
    expect(carrier.role).toBe('Fleet Support');

    const dreadnought = stats('dreadnought');
    expect(dreadnought.role).toBe('Capital Ship');
  });

  it('carries shield and shieldRegen from the ship definition', () => {
    const fighter = stats('fighter');
    expect(fighter.shield).toBe(30); // ship-data.json
    expect(fighter.shieldRegen).toBe(2);

    const frigate = stats('frigate');
    expect(frigate.shield).toBe(80);
    expect(frigate.shieldRegen).toBe(5);

    const dreadnought = stats('dreadnought');
    expect(dreadnought.shield).toBe(400);
    expect(dreadnought.shieldRegen).toBe(6);
  });

  it('marks virtual defense buildings immobile with fixed AP costs and data-driven range', () => {
    const laser = stats('laser_turret');
    expect(laser.immobile).toBe(true);
    expect(laser.moveRange).toBe(0);
    expect(laser.tier).toBe(3);
    expect(laser.moveApPerCell).toBe(3);
    expect(laser.attackAp).toBe(2);
    expect(laser.attackRange).toBe(3);
    expect(laser.attack).toBe(20);

    const missile = stats('missile_turret');
    expect(missile.immobile).toBe(true);
    expect(missile.attackRange).toBe(5);
    expect(missile.attack).toBe(35);
    expect(missile.shield).toBe(0); // turrets carry no shield
    expect(missile.shieldRegen).toBe(0);
    expect(missile.attackType).toBe('missile');
    expect(missile.weakness).toBe('energy');
    expect(missile.role).toBe('defense');

    expect(laser.attackType).toBe('energy');
    expect(laser.weakness).toBe('kinetic');
    expect(laser.role).toBe('defense');
  });

  it('falls back safely for unknown type ids', () => {
    const unknown = stats('no_such_type');
    expect(unknown.immobile).toBe(true);
    expect(unknown.maxHp).toBe(1);
    expect(unknown.attack).toBe(0);
    expect(unknown.attackRange).toBe(0);
    expect(unknown.shield).toBe(0);
    expect(unknown.shieldRegen).toBe(0);
    expect(unknown.attackType).toBe('kinetic');
    expect(unknown.weakness).toBe('energy');
    expect(unknown.role).toBe('Light Combat');
  });
});

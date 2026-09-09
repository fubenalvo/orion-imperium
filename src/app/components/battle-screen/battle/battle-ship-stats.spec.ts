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

  it('reuses the existing speed and range stats for movement and attack range', () => {
    const fighter = stats('fighter');
    expect(fighter.moveRange).toBe(5);
    expect(fighter.attackRange).toBe(2);
    expect(fighter.immobile).toBe(false);

    const dreadnought = stats('dreadnought');
    expect(dreadnought.moveRange).toBe(1);
    expect(dreadnought.attackRange).toBe(5);
  });

  it('carries combat stats from the ship definition', () => {
    const frigate = stats('frigate');
    expect(frigate.maxHp).toBe(130);
    expect(frigate.attack).toBe(28);
    expect(frigate.defense).toBe(8);
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
  });

  it('falls back safely for unknown type ids', () => {
    const unknown = stats('no_such_type');
    expect(unknown.immobile).toBe(true);
    expect(unknown.maxHp).toBe(1);
    expect(unknown.attack).toBe(0);
    expect(unknown.attackRange).toBe(0);
  });
});

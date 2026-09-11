import { TestBed } from '@angular/core/testing';
import { PlanetBattleService } from './planet-battle.service';
import { Fleet, PlanetTile } from '../components/star-map/star-map.models';

describe('PlanetBattleService', () => {
  let service: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlanetBattleService);
  });

  const planet = (
    buildings: { name: string; size: number; x: number; y: number }[],
  ): PlanetTile =>
    ({
      id: 7,
      index: 0,
      name: 'Mars',
      factionId: 'enemy1',
      x: 1,
      y: 1,
      type: 'marslike',
      size: 'medium',
      population: 0,
      buildings,
      explored: true,
    }) as unknown as PlanetTile;

  const garrison = (): Fleet =>
    ({
      id: 99,
      name: 'GARRISON',
      factionId: 'enemy1',
      x: 0,
      y: 0,
      targetX: null,
      targetY: null,
      speed: 0,
      system: null,
      ships: [{ id: 1, name: 'G1', type: 'fighter' }],
      destroyed: false,
    }) as unknown as Fleet;

  it('converts defense turrets into virtual ships and ignores non-defense buildings', () => {
    const fleet = service.createVirtualDefenseFleet(
      planet([
        { name: 'Laser Turret', size: 1, x: 0, y: 0 },
        { name: 'Laser Turret', size: 1, x: 1, y: 0 },
        { name: 'Missile Turret', size: 1, x: 2, y: 0 },
        { name: 'Small Residential', size: 1, x: 3, y: 0 },
      ]),
      null,
    );

    expect(fleet.id).toBe(-7);
    expect(fleet.name).toBe('Mars Defenses');
    expect(fleet.ships.map((s) => s.type)).toEqual([
      'laser_turret',
      'laser_turret',
      'missile_turret',
    ]);
    expect(fleet.ships.every((s) => s.destroyed === false)).toBe(true);
  });

  it('turns planetary shields into a shared pool instead of ships', () => {
    const fleet = service.createVirtualDefenseFleet(
      planet([
        { name: 'Laser Turret', size: 1, x: 0, y: 0 },
        { name: 'Planetary Shield', size: 2, x: 1, y: 0 },
      ]),
      null,
    );

    expect(fleet.ships.map((s) => s.type)).toEqual(['laser_turret']);
    expect(fleet.shieldPool).toBe(300);
    expect(fleet.shieldPoolRegen).toBe(15);
  });

  it('sums multiple shield buildings and keeps garrison ships out of the pool', () => {
    const fleet = service.createVirtualDefenseFleet(
      planet([
        { name: 'Planetary Shield', size: 2, x: 0, y: 0 },
        { name: 'Planetary Shield', size: 2, x: 2, y: 0 },
      ]),
      garrison(),
    );

    expect(fleet.shieldPool).toBe(600);
    expect(fleet.shieldPoolRegen).toBe(30);
    expect(fleet.ships).toHaveLength(1);
    expect(fleet.ships[0].type).toBe('fighter');
  });
});

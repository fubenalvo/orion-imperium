import { TestBed } from '@angular/core/testing';
import { PlanetBattleService } from './planet-battle.service';
describe('PlanetBattleService', () => {
    let service;
    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(PlanetBattleService);
    });
    const planet = (buildings) => ({
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
    });
    const garrison = () => ({
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
    });
    it('converts defense turrets into virtual ships and ignores non-defense buildings', () => {
        const fleet = service.createVirtualDefenseFleet(planet([
            { name: 'Laser Turret', size: 1, x: 0, y: 0 },
            { name: 'Laser Turret', size: 1, x: 1, y: 0 },
            { name: 'Missile Turret', size: 1, x: 2, y: 0 },
            { name: 'Small Residential', size: 1, x: 3, y: 0 },
        ]), null);
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
        const fleet = service.createVirtualDefenseFleet(planet([
            { name: 'Laser Turret', size: 1, x: 0, y: 0 },
            { name: 'Planetary Shield', size: 2, x: 1, y: 0 },
        ]), null);
        expect(fleet.ships.map((s) => s.type)).toEqual(['laser_turret']);
        expect(fleet.shieldPool).toBe(300);
        expect(fleet.shieldPoolRegen).toBe(15);
    });
    it('sums multiple shield buildings and keeps garrison ships out of the pool', () => {
        const fleet = service.createVirtualDefenseFleet(planet([
            { name: 'Planetary Shield', size: 2, x: 0, y: 0 },
            { name: 'Planetary Shield', size: 2, x: 2, y: 0 },
        ]), garrison());
        expect(fleet.shieldPool).toBe(600);
        expect(fleet.shieldPoolRegen).toBe(30);
        expect(fleet.ships).toHaveLength(1);
        expect(fleet.ships[0].type).toBe('fighter');
    });
    it('shield-only planet: no turrets, pool created but no ships', () => {
        const fleet = service.createVirtualDefenseFleet(planet([{ name: 'Planetary Shield', size: 2, x: 0, y: 0 }]), null);
        expect(fleet.ships).toHaveLength(0);
        expect(fleet.shieldPool).toBe(300);
        expect(fleet.shieldPoolRegen).toBe(15);
        expect(fleet.destroyed).toBe(false);
    });
    it('planet without shield: turrets present, no pool', () => {
        const fleet = service.createVirtualDefenseFleet(planet([{ name: 'Laser Turret', size: 1, x: 0, y: 0 }]), null);
        expect(fleet.ships).toHaveLength(1);
        expect(fleet.ships[0].type).toBe('laser_turret');
        expect(fleet.shieldPool).toBe(0);
        expect(fleet.shieldPoolRegen).toBe(0);
    });
    it('uses persisted shield value as starting pool (clamped to max)', () => {
        const p = planet([{ name: 'Planetary Shield', size: 2, x: 0, y: 0 }]);
        p.shieldPoolCurrent = 150;
        const fleet = service.createVirtualDefenseFleet(p, null);
        expect(fleet.shieldPool).toBe(150);
        expect(fleet.shieldPoolRegen).toBe(15);
    });
    it('clamps persisted shield above max to max', () => {
        const p = planet([{ name: 'Planetary Shield', size: 2, x: 0, y: 0 }]);
        p.shieldPoolCurrent = 500;
        const fleet = service.createVirtualDefenseFleet(p, null);
        expect(fleet.shieldPool).toBe(300);
        expect(fleet.shieldPoolRegen).toBe(15);
    });
    it('keeps a fully depleted persisted shield pool at zero', () => {
        const p = planet([{ name: 'Planetary Shield', size: 2, x: 0, y: 0 }]);
        p.shieldPoolCurrent = 0;
        const fleet = service.createVirtualDefenseFleet(p, null);
        expect(fleet.shieldPool).toBe(0);
        expect(fleet.shieldPoolRegen).toBe(15);
    });
    it('uses max when no persisted shield value', () => {
        const fleet = service.createVirtualDefenseFleet(planet([{ name: 'Planetary Shield', size: 2, x: 0, y: 0 }]), null);
        expect(fleet.shieldPool).toBe(300);
    });
});

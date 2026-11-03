import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Faction, FactionShipStock, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { FLEET_REPAIR_CONFIG, advanceFleetRepair } from './fleet-repair';
import { FleetRepairService } from './fleet-repair.service';
import { SpaceBaseService } from './space-base.service';
import { ShipService } from '../../services/ship.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { FleetOrganizationService } from '../../services/fleet-organization.service';

/*
 * Fleet repair (docs/fleet-organization.md, "Repair"): Spaceport and space
 * base sites, the research gate for bases, stationary fleets only, reserve
 * ships keeping and repairing their damage, and no repair beyond full hull.
 */

const FRIGATE_HP = 130;

function makeFactions(researched: string[] = []): Faction[] {
  return [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: {}, researchedTechnologies: researched },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: {} },
  ] as unknown as Faction[];
}

function system(id: string, x: number, y: number, owner: string, spaceport: boolean): StarSystem {
  const planet = {
    id: x * 1000 + y, index: 0, name: 'P', factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium',
    population: 50, explored: true,
    buildings: spaceport ? [{ name: 'Spaceport', x: 0, y: 0 }] : [],
  } as unknown as PlanetTile;
  return { id, name: id, x, y, planets: 1, color: '#fff', planetsTiles: [planet], explored: true };
}

function damagedFleet(id: number, factionId: string, x: number, y: number, hp: number): Fleet {
  return {
    id, name: `Fleet ${id}`, factionId, x, y, targetX: null, targetY: null, speed: 4, system: null,
    ships: [
      { id: id * 10, name: 'Frigate', type: 'frigate', currentHp: hp },
      { id: id * 10 + 1, name: 'Frigate', type: 'frigate' },
    ],
  };
}

describe('fleet repair', () => {
  let service: FleetRepairService;
  let bases: SpaceBaseService;

  beforeEach(() => {
    service = TestBed.inject(FleetRepairService);
    bases = TestBed.inject(SpaceBaseService);
    bases.restore([]);
  });

  it('the frigate HP the tests assume matches the ship data', () => {
    expect(TestBed.inject(ShipService).getShipType('frigate')!.hitPoints).toBe(FRIGATE_HP);
  });

  it('a stopped fleet in a system with its own Spaceport repairs at the Spaceport rate, never above full', () => {
    const fleets = [damagedFleet(1, 'player', 20, 20, 30)];
    const world = { fleets, factions: makeFactions(), starSystems: [system('home', 20, 20, 'player', true)] };
    const result = service.step(world, 2);
    expect(result.repairing.get(1)).toBe('spaceport');
    expect(result.changed).toBe(true);
    expect(fleets[0].ships[0].currentHp).toBeCloseTo(30 + FRIGATE_HP * FLEET_REPAIR_CONFIG.spaceportRate * 2);
    // The undamaged ship is untouched (missing hull = full).
    expect(fleets[0].ships[1].currentHp).toBeUndefined();

    service.step(world, 1000);
    expect(fleets[0].ships[0].currentHp).toBe(FRIGATE_HP);
    const after = service.step(world, 1);
    expect(after.repairing.size).toBe(0);
    expect(after.changed).toBe(false);
  });

  it('no repair at a foreign Spaceport, in a system without one, or while moving', () => {
    const foreign = damagedFleet(1, 'player', 20, 20, 30);
    const plain = damagedFleet(2, 'player', 40, 40, 30);
    const moving = { ...damagedFleet(3, 'player', 60, 60, 30), targetX: 90, targetY: 90 };
    const world = {
      fleets: [foreign, plain, moving],
      factions: makeFactions(),
      starSystems: [system('vex', 20, 20, 'enemy1', true), system('free', 40, 40, 'player', false), system('own', 60, 60, 'player', true)],
    };
    const result = service.step(world, 5);
    expect(result.repairing.size).toBe(0);
    expect([foreign, plain, moving].map((f) => f.ships[0].currentHp)).toEqual([30, 30, 30]);
  });

  it('space bases repair only with Orbital Repair Docks, only when complete, and slower than a Spaceport', () => {
    bases.restore([
      { id: 1, name: 'Base', factionId: 'player', x: 30, y: 30 },
      { id: 2, name: 'Site', factionId: 'player', x: 50, y: 50, constructionRemaining: 20 },
    ]);
    const atBase = damagedFleet(1, 'player', 30.5, 30.5, 30);
    const atSite = damagedFleet(2, 'player', 50.5, 50.5, 30);

    const without = service.step({ fleets: [atBase, atSite], factions: makeFactions(), starSystems: [] }, 2);
    expect(without.repairing.size).toBe(0);
    expect(atBase.ships[0].currentHp).toBe(30);

    const withTech = service.step(
      { fleets: [atBase, atSite], factions: makeFactions(['orbital_repair_docks']), starSystems: [] },
      2,
    );
    expect(withTech.repairing.get(1)).toBe('base');
    expect(withTech.repairing.has(2)).toBe(false);
    expect(atBase.ships[0].currentHp).toBeCloseTo(30 + FRIGATE_HP * FLEET_REPAIR_CONFIG.baseRate * 2);
    expect(atSite.ships[0].currentHp).toBe(30);
    expect(FLEET_REPAIR_CONFIG.baseRate).toBeLessThan(FLEET_REPAIR_CONFIG.spaceportRate);
  });

  it('another faction’s base does not repair the fleet', () => {
    bases.restore([{ id: 1, name: 'Base', factionId: 'enemy1', x: 30, y: 30 }]);
    const fleet = damagedFleet(1, 'player', 30.5, 30.5, 30);
    service.step({ fleets: [fleet], factions: makeFactions(['orbital_repair_docks']), starSystems: [] }, 5);
    expect(fleet.ships[0].currentHp).toBe(30);
  });

  it('reserve ships repair while the faction owns a Spaceport, and not without one', () => {
    const stock: FactionShipStock[] = [
      { factionId: 'player', ships: [{ id: 1, type: 'frigate', name: 'Frigate', currentHp: 10 }] },
      { factionId: 'enemy1', ships: [{ id: 2, type: 'frigate', name: 'Frigate', currentHp: 10 }] },
    ];
    service.step({ fleets: [], shipStock: stock, factions: makeFactions(), starSystems: [system('home', 20, 20, 'player', true)] }, 2);
    expect(stock[0].ships[0].currentHp).toBeCloseTo(10 + FRIGATE_HP * FLEET_REPAIR_CONFIG.spaceportRate * 2);
    expect(stock[1].ships[0].currentHp).toBe(10);
  });

  it('pure rule: a destroyed ship is never repaired', () => {
    const fleet = damagedFleet(1, 'player', 0, 0, 30);
    fleet.ships[0].destroyed = true;
    const result = advanceFleetRepair(
      { fleets: [fleet], factionsWithSpaceport: new Set(), siteFor: () => 'spaceport', maxHp: () => FRIGATE_HP },
      5,
    );
    expect(result.repairing.size).toBe(0);
    expect(fleet.ships[0].currentHp).toBe(30);
  });

  describe('damage travels through the reserve', () => {
    it('disbanding keeps the damage in the stock, and redeploying brings it back', () => {
      const data = { fleets: [damagedFleet(1, 'player', 20, 20, 30)], shipStock: [] as FactionShipStock[] };
      TestBed.inject(ShipStockService).disbandFleet(data, data.fleets[0]);
      const stock = TestBed.inject(ShipStockService).getStock(data, 'player');
      expect(stock.map((e) => e.currentHp)).toEqual([30, undefined]);

      const starSystems = [system('home', 20, 20, 'player', true)];
      const result = TestBed.inject(FleetAssemblyService).createFleet(data, starSystems, {
        factionId: 'player',
        fleetName: 'Redeployed',
        systemId: 'home',
        planetId: starSystems[0].planetsTiles[0].id,
        composition: [{ typeId: 'frigate', count: 2 }],
      }) as unknown as { ok: boolean; fleet?: Fleet };
      expect(result.ok).toBe(true);
      expect(result.fleet!.ships.map((s) => s.currentHp).sort()).toEqual([30, FRIGATE_HP].sort());
    });

    it('fleet → reserve → fleet through Fleet Command keeps the hull', () => {
      const starSystems = [system('home', 20, 20, 'player', true)];
      const fleet = damagedFleet(1, 'player', 20, 20, 30);
      const data = { fleets: [fleet], shipStock: [] as FactionShipStock[] };
      const organization = TestBed.inject(FleetOrganizationService);
      const toReserve = organization.applyPlan(data, starSystems, {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: fleet.name, shipIds: [11] }],
        reserveShipIds: [10],
      });
      expect(toReserve.ok).toBe(true);
      expect(TestBed.inject(ShipStockService).getStock(data, 'player')[0]).toMatchObject({ id: 10, currentHp: 30 });

      const back = organization.applyPlan(data, starSystems, {
        factionId: 'player',
        sourceFleetIds: [1],
        fleets: [{ fleetId: 1, originFleetId: 1, name: fleet.name, shipIds: [10, 11] }],
        reserveShipIds: [],
      });
      expect(back.ok).toBe(true);
      expect(fleet.ships.find((s) => s.id === 10)!.currentHp).toBe(30);
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Faction,
  FactionEquipmentInventory,
  FactionProduction,
  FactionShipStock,
  Fleet,
  FleetShip,
  PlanetTile,
  StarSystem,
} from '../components/star-map/star-map.models';
import { getUpgradeModules } from '../components/star-map/equipment';
import { addToInventory, inventoryCount, takeFromInventory } from '../components/star-map/equipment-inventory';
import { SYSTEM_CELL_SIZE_VW } from '../components/star-map/system-grid';
import { ProductionService } from './production.service';
import { ResearchService } from './research.service';
import { SAVE_VERSION, validateSaveData } from './save-validation';
import { ShipEquipmentService } from './ship-equipment.service';
import { SpaceportService } from './spaceport.service';

/*
 * Phase 5 of docs/ship-equipment.md: modules are built in Spaceship
 * Factories into the empire inventory, unlocked by research, and installed
 * or removed for free near an own Spaceport planet.
 */

/* vw position of the centre of a 1-indexed system cell. */
const cellVw = (col: number, row: number) => ({
  x: (col - 1) * SYSTEM_CELL_SIZE_VW + SYSTEM_CELL_SIZE_VW / 2,
  y: (row - 1) * SYSTEM_CELL_SIZE_VW + SYSTEM_CELL_SIZE_VW / 2,
});

/* Planet footprint: cells 10–11 × 5–6. */
const planetTile = (extra: Partial<PlanetTile> = {}): PlanetTile =>
  ({
    id: 1,
    index: 0,
    name: 'Home',
    factionId: 'player',
    x: 10,
    y: 5,
    type: 'earthlike',
    size: 'medium',
    population: 1000,
    buildings: [{ name: 'Spaceport' }, { name: 'Spaceship Factory' }],
    explored: true,
    ...extra,
  }) as PlanetTile;

const systemWith = (planet: PlanetTile, extra: Partial<StarSystem> = {}): StarSystem =>
  ({ id: 'sol', name: 'Sol', x: 10, y: 20, planets: 1, color: '#fff', planetsTiles: [planet], ...extra }) as unknown as StarSystem;

const fleetAt = (col: number, row: number, ships: FleetShip[], extra: Partial<Fleet> = {}): Fleet => {
  const pos = cellVw(col, row);
  return {
    id: 1,
    name: 'F',
    factionId: 'player',
    x: 10.5,
    y: 20.5,
    targetX: null,
    targetY: null,
    speed: 4,
    system: { id: 'sol', x: pos.x, y: pos.y, targetX: null, targetY: null },
    ships,
    ...extra,
  };
};

const faction = (researched: string[] = [], credits = 10000, raw = 10000): Faction =>
  ({ id: 'player', name: 'P', color: '#fff', team: 1, currencies: { credits, rawmaterials: raw }, researchedTechnologies: researched }) as Faction;

describe('equipment unlocks (research)', () => {
  let research: ResearchService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    research = TestBed.inject(ResearchService);
  });

  it('unlocks every upgrade module by exactly one technology, and no standard module', () => {
    for (const module of getUpgradeModules()) {
      const techs = research.getAllTechnologies().filter((t) => (t.unlocksEquipment ?? []).includes(module.id));
      expect(techs.length, module.id).toBe(1);
    }
    expect(research.getValidationErrors()).toEqual([]);
  });

  it('tells which modules a faction may build and names them in the effects', () => {
    const f = faction(['basic_engineering', 'military_engineering']);
    expect(research.isEquipmentUnlocked(f, 'railgun')).toBe(true);
    expect(research.isEquipmentUnlocked(f, 'energy_shield')).toBe(true);
    expect(research.isEquipmentUnlocked(f, 'warp_drive')).toBe(false);
    expect(research.describeEffects(research.getTechnology('military_engineering')!)).toContain('Unlocks ship equipment: Railgun, Energy Shield');
  });
});

describe('equipment inventory helpers', () => {
  it('counts, adds and takes modules, ignoring standard and unknown ids', () => {
    const data: { equipmentInventory?: FactionEquipmentInventory[] } = {};
    expect(inventoryCount(data, 'player', 'railgun')).toBe(0);
    expect(data.equipmentInventory).toBeUndefined();
    expect(addToInventory(data, 'player', 'railgun', 2)).toBe(true);
    expect(addToInventory(data, 'player', 'standard_weapon')).toBe(false);
    expect(addToInventory(data, 'player', 'nope')).toBe(false);
    expect(inventoryCount(data, 'player', 'railgun')).toBe(2);
    expect(takeFromInventory(data, 'player', 'railgun')).toBe(true);
    expect(takeFromInventory(data, 'player', 'railgun')).toBe(true);
    expect(takeFromInventory(data, 'player', 'railgun')).toBe(false);
    expect(data.equipmentInventory).toEqual([{ factionId: 'player', modules: {} }]);
  });

  it('reads malformed counts as zero', () => {
    const data = { equipmentInventory: [{ factionId: 'player', modules: { railgun: -3, laser_cannon: 1.5 } }] };
    expect(inventoryCount(data, 'player', 'railgun')).toBe(0);
    expect(inventoryCount(data, 'player', 'laser_cannon')).toBe(0);
  });
});

describe('ProductionService equipment orders', () => {
  let production: ProductionService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    production = TestBed.inject(ProductionService);
  });

  const setup = (researched = ['basic_engineering', 'military_engineering']) => {
    const planet = planetTile();
    const systems = [systemWith(planet)];
    const factions = [faction(researched)];
    const data: { production?: FactionProduction[]; shipStock?: FactionShipStock[]; equipmentInventory?: FactionEquipmentInventory[] } = {};
    return { planet, systems, factions, data };
  };

  const run = (ctx: ReturnType<typeof setup>, seconds: number, step = 0.5) => {
    const results = [];
    for (let t = 0; t < seconds; t += step) {
      results.push(production.tick(step, ctx.data, ctx.systems, [], ctx.factions));
    }
    return results;
  };

  it('charges the module price and queues single-module orders', () => {
    const ctx = setup();
    const result = production.queueEquipmentOrder(ctx.data, 'player', 1, 'railgun', 2, ctx.systems, ctx.factions);
    expect(result.ok).toBe(true);
    expect(ctx.factions[0].currencies['credits']).toBe(10000 - 600);
    expect(ctx.factions[0].currencies['rawmaterials']).toBe(10000 - 500);
    const queue = ctx.data.production![0].ordersByPlanet[1];
    expect(queue.map((o) => [o.equipmentId, o.shipTypeId, o.quantity, o.paid])).toEqual([
      ['railgun', '', 1, { credits: 300, rawmaterials: 250 }],
      ['railgun', '', 1, { credits: 300, rawmaterials: 250 }],
    ]);
  });

  it('refuses locked, standard and unknown modules, missing factories and short funds, charging nothing', () => {
    const cases: [ReturnType<typeof setup>, string, string][] = [
      [setup(['basic_engineering']), 'railgun', 'locked'],
      [setup(), 'standard_weapon', 'invalid_type'],
      [setup(), 'future_gun', 'invalid_type'],
    ];
    for (const [ctx, moduleId, reason] of cases) {
      expect(production.queueEquipmentOrder(ctx.data, 'player', 1, moduleId, 1, ctx.systems, ctx.factions).reason).toBe(reason);
      expect(ctx.factions[0].currencies['credits']).toBe(10000);
    }
    const noFactory = setup();
    noFactory.planet.buildings = [{ name: 'Spaceport' }] as never;
    expect(production.queueEquipmentOrder(noFactory.data, 'player', 1, 'railgun', 1, noFactory.systems, noFactory.factions).reason).toBe('no_factory');
    const poor = setup();
    poor.factions[0].currencies['rawmaterials'] = 100;
    expect(production.queueEquipmentOrder(poor.data, 'player', 1, 'railgun', 1, poor.systems, poor.factions).reason).toBe('insufficient_resources');
    expect(poor.factions[0].currencies['credits']).toBe(10000);
    expect(poor.data.production ?? []).toEqual([]);
  });

  it('builds a module into the inventory, not the ship stock, at the factory power', () => {
    const ctx = setup();
    production.queueEquipmentOrder(ctx.data, 'player', 1, 'railgun', 1, ctx.systems, ctx.factions);
    const order = ctx.data.production![0].ordersByPlanet[1][0];
    // Railgun: 30 s at power 1, one factory gives 0.5 → 60 s.
    expect(production.getOrderEta(order, ctx.planet, ctx.factions[0])).toBeCloseTo(60, 6);
    run(ctx, 59.5);
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(0);
    // Progress adds up in float steps, so completion may land one step after 60 s (as for ships).
    const last = run(ctx, 1).find((r) => r.producedModules.length > 0)!;
    expect(last.producedModules).toEqual([{ factionId: 'player', planetId: 1, moduleId: 'railgun', count: 1 }]);
    expect(last.producedShips).toEqual([]);
    expect(last.refundedOrders).toEqual([]);
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(1);
    expect(ctx.data.shipStock ?? []).toEqual([]);
  });

  it('shares the queue with ships in order', () => {
    const ctx = setup();
    production.queueOrder(ctx.data, 'player', 1, 'scout', 1, ctx.systems, ctx.factions);
    production.queueEquipmentOrder(ctx.data, 'player', 1, 'energy_shield', 1, ctx.systems, ctx.factions);
    // Scout 5 s / 0.5 = 10 s, then Energy Shield 20 s / 0.5 = 40 s.
    const results = run(ctx, 51);
    const shipTime = results.findIndex((r) => r.producedShips.length > 0);
    const moduleTime = results.findIndex((r) => r.producedModules.length > 0);
    expect(shipTime).toBeGreaterThanOrEqual(0);
    expect(moduleTime).toBeGreaterThan(shipTime);
    expect(inventoryCount(ctx.data, 'player', 'energy_shield')).toBe(1);
  });

  it('refunds the unbuilt share on cancel and when the planet changes hands', () => {
    const ctx = setup();
    production.queueEquipmentOrder(ctx.data, 'player', 1, 'railgun', 2, ctx.systems, ctx.factions);
    run(ctx, 30); // first order half built
    const [first, second] = ctx.data.production![0].ordersByPlanet[1];
    production.cancelOrder(ctx.data, 'player', 1, first.id, ctx.factions);
    expect(ctx.factions[0].currencies['credits']).toBe(10000 - 600 + 150);
    ctx.planet.factionId = 'enemy1';
    const [result] = run(ctx, 0.5);
    expect(result.refundedOrders.map((r) => r.orderId)).toEqual([second.id]);
    expect(ctx.factions[0].currencies['credits']).toBe(10000 - 600 + 150 + 300);
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(0);
  });

  it('refunds an order whose module is unknown, and never splits equipment orders on load', () => {
    const ctx = setup();
    ctx.data.production = [{
      factionId: 'player',
      ordersByPlanet: {
        1: [
          { id: 1, shipTypeId: '', equipmentId: 'future_gun', quantity: 1, progress: 0, startedAtTick: 0, paid: { credits: 100, rawmaterials: 0 } },
          { id: 2, shipTypeId: '', equipmentId: 'railgun', quantity: 2, progress: 0, startedAtTick: 0, paid: { credits: 600, rawmaterials: 500 } },
        ],
      },
    }];
    production.rebaseFromSave(ctx.data.production);
    expect(ctx.data.production[0].ordersByPlanet[1].length).toBe(2);
    const [result] = run(ctx, 0.5);
    expect(result.refundedOrders.map((r) => r.orderId)).toEqual([1]);
    expect(ctx.factions[0].currencies['credits']).toBe(10100);
    // The 2-module order still builds both modules (twice the time).
    run(ctx, 121);
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(2);
  });
});

describe('equipment orders in saves', () => {
  const save = (order: Record<string, unknown>) => ({
    saveVersion: SAVE_VERSION,
    factions: [],
    map: { width: 10, height: 10, cellSizeVw: 2, cellSizeVh: 2 },
    starSystems: [],
    fleets: [],
    production: [{ factionId: 'player', ordersByPlanet: { 1: [{ id: 1, quantity: 1, progress: 0, startedAtTick: 0, ...order }] } }],
  });
  const orderCodes = (order: Record<string, unknown>) => {
    const result = validateSaveData(save(order));
    return [...result.errors, ...result.warnings].map((i) => i.code).filter((c) => c.startsWith('order_'));
  };

  it('accepts equipment orders with an empty shipTypeId and checks the module id', () => {
    expect(orderCodes({ shipTypeId: '', equipmentId: 'railgun' })).toEqual([]);
    expect(orderCodes({ shipTypeId: '', equipmentId: 'future_gun' })).toEqual(['order_equipment_unknown']);
    expect(orderCodes({ shipTypeId: '', equipmentId: '' })).toEqual(['order_equipment_invalid']);
    expect(orderCodes({ shipTypeId: '' })).toEqual(['order_ship_type_invalid']);
  });
});

describe('SpaceportService.spaceportPlanetNear', () => {
  let spaceports: SpaceportService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    spaceports = TestBed.inject(SpaceportService);
  });

  const near = (col: number, row: number, planet = planetTile(), extra: Partial<Fleet> = {}) =>
    spaceports.spaceportPlanetNear('player', fleetAt(col, row, [], extra), [systemWith(planet)]) !== null;

  it('accepts a fleet within 2 cells of the footprint, diagonals included', () => {
    expect(near(10, 5)).toBe(true); // on the planet
    expect(near(11, 6)).toBe(true); // on the planet
    expect(near(13, 5)).toBe(true); // 2 right of the footprint
    expect(near(8, 3)).toBe(true); // 2 diagonal
    expect(near(11, 8)).toBe(true); // 2 below
  });

  it('rejects a fleet 3 cells away', () => {
    expect(near(14, 5)).toBe(false);
    expect(near(7, 5)).toBe(false);
    expect(near(10, 9)).toBe(false);
  });

  it('rejects unfinished or foreign Spaceports, other systems and fleets without an in-system position', () => {
    expect(near(10, 5, planetTile({ buildings: [{ name: 'Spaceport', constructionRemaining: 10 }] as never }))).toBe(false);
    expect(near(10, 5, planetTile({ factionId: 'enemy1' }))).toBe(false);
    expect(near(10, 5, planetTile(), { system: { id: 'other', x: 26.25, y: 11.25, targetX: null, targetY: null } })).toBe(false);
    expect(near(10, 5, planetTile(), { system: null })).toBe(false);
    expect(near(10, 5, planetTile(), { x: 30.5 })).toBe(false);
  });
});

describe('ShipEquipmentService install / uninstall', () => {
  let service: ShipEquipmentService;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ShipEquipmentService);
  });

  const setup = (col = 12, row = 5) => {
    const ships: FleetShip[] = [
      { id: 1, name: 'S', type: 'cruiser' },
      { id: 2, name: 'S', type: 'colonizer' },
      { id: 3, name: 'S', type: 'cruiser', destroyed: true },
    ];
    const fleet = fleetAt(col, row, ships);
    const data: { fleets: Fleet[]; shipStock: FactionShipStock[]; equipmentInventory?: FactionEquipmentInventory[] } = {
      fleets: [fleet],
      shipStock: [{ factionId: 'player', ships: [{ id: 10, type: 'destroyer', name: 'S' }] }],
    };
    addToInventory(data, 'player', 'railgun', 2);
    addToInventory(data, 'player', 'laser_cannon', 1);
    addToInventory(data, 'player', 'warp_drive', 1);
    return { data, fleet, systems: [systemWith(planetTile())] };
  };
  const install = (ctx: ReturnType<typeof setup>, shipId: number, moduleId: string, factionId = 'player') =>
    service.install(ctx.data, ctx.systems, { factionId, shipId, moduleId });
  const snapshot = (ctx: ReturnType<typeof setup>) => JSON.stringify(ctx.data);

  it('installs from the inventory, swaps returning the old module, and uninstalls back', () => {
    const ctx = setup();
    expect(install(ctx, 1, 'railgun').ok).toBe(true);
    expect(ctx.fleet.ships[0].equipment).toEqual({ weapon: 'railgun' });
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(1);

    expect(install(ctx, 1, 'laser_cannon').ok).toBe(true);
    expect(ctx.fleet.ships[0].equipment).toEqual({ weapon: 'laser_cannon' });
    expect(inventoryCount(ctx.data, 'player', 'railgun')).toBe(2);
    expect(inventoryCount(ctx.data, 'player', 'laser_cannon')).toBe(0);

    expect(service.uninstall(ctx.data, ctx.systems, { factionId: 'player', shipId: 1, slot: 'weapon' }).ok).toBe(true);
    expect(ctx.fleet.ships[0].equipment).toBeUndefined();
    expect(inventoryCount(ctx.data, 'player', 'laser_cannon')).toBe(1);
  });

  it('lets civil hulls take engines only', () => {
    const ctx = setup();
    expect(install(ctx, 2, 'railgun').reason).toBe('slot_locked');
    expect(install(ctx, 2, 'warp_drive').ok).toBe(true);
    expect(ctx.fleet.ships[1].equipment).toEqual({ engine: 'warp_drive' });
  });

  it('changes nothing on any failure', () => {
    const cases: [ReturnType<typeof setup>, () => ReturnType<ShipEquipmentService['install']>, string][] = [];
    const far = setup(15, 5);
    cases.push([far, () => install(far, 1, 'railgun'), 'not_at_spaceport']);
    const none = setup();
    cases.push([none, () => install(none, 1, 'energy_shield'), 'not_in_inventory']);
    const wreck = setup();
    cases.push([wreck, () => install(wreck, 3, 'railgun'), 'ship_not_found']);
    const foreign = setup();
    cases.push([foreign, () => install(foreign, 1, 'railgun', 'enemy1'), 'ship_not_found']);
    const standard = setup();
    cases.push([standard, () => install(standard, 1, 'standard_weapon'), 'unknown_module']);
    const twice = setup();
    install(twice, 1, 'railgun');
    cases.push([twice, () => install(twice, 1, 'railgun'), 'already_installed']);
    const empty = setup();
    cases.push([empty, () => service.uninstall(empty.data, empty.systems, { factionId: 'player', shipId: 1, slot: 'engine' }), 'nothing_installed']);
    for (const [ctx, action, reason] of cases) {
      const before = snapshot(ctx);
      expect(action().reason).toBe(reason);
      expect(snapshot(ctx)).toBe(before);
    }
  });

  it('refuses to uninstall away from a Spaceport', () => {
    const ctx = setup();
    install(ctx, 1, 'railgun');
    ctx.fleet.system = { id: 'sol', ...cellVw(20, 10), targetX: null, targetY: null };
    expect(service.uninstall(ctx.data, ctx.systems, { factionId: 'player', shipId: 1, slot: 'weapon' }).reason).toBe('not_at_spaceport');
    expect(ctx.fleet.ships[0].equipment).toEqual({ weapon: 'railgun' });
  });

  it('refits reserve ships while the faction owns a Spaceport', () => {
    const ctx = setup(30, 12);
    expect(install(ctx, 10, 'railgun').ok).toBe(true);
    expect(ctx.data.shipStock[0].ships[0].equipment).toEqual({ weapon: 'railgun' });
    ctx.systems[0].planetsTiles[0].buildings = [];
    expect(service.uninstall(ctx.data, ctx.systems, { factionId: 'player', shipId: 10, slot: 'weapon' }).reason).toBe('not_at_spaceport');
  });

  it('leaves quarantined unknown ids alone and replaces them without inventing modules', () => {
    const ctx = setup();
    ctx.fleet.ships[0].equipment = { weapon: 'future_gun' };
    expect(service.uninstall(ctx.data, ctx.systems, { factionId: 'player', shipId: 1, slot: 'weapon' }).reason).toBe('nothing_installed');
    expect(install(ctx, 1, 'railgun').ok).toBe(true);
    expect(ctx.data.equipmentInventory![0].modules).toEqual({ railgun: 1, laser_cannon: 1, warp_drive: 1 });
  });

  it('conserves modules across random install / uninstall sequences', () => {
    const ctx = setup();
    const ids = ['railgun', 'laser_cannon', 'warp_drive', 'energy_shield'];
    const total = (moduleId: string) =>
      inventoryCount(ctx.data, 'player', moduleId) +
      [...ctx.fleet.ships.filter((s) => !s.destroyed), ...ctx.data.shipStock[0].ships]
        .filter((s) => Object.values(s.equipment ?? {}).includes(moduleId)).length;
    const start = Object.fromEntries(ids.map((id) => [id, total(id)]));
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
    for (let i = 0; i < 300; i++) {
      const shipId = [1, 2, 10][rand(3)];
      if (rand(2) === 0) {
        install(ctx, shipId, ids[rand(ids.length)]);
      } else {
        service.uninstall(ctx.data, ctx.systems, { factionId: 'player', shipId, slot: (['engine', 'weapon', 'defense'] as const)[rand(3)] });
      }
      for (const id of ids) {
        expect(total(id)).toBe(start[id]);
      }
    }
  });
});

import { TestBed } from '@angular/core/testing';
import {
  ADMINISTRATION_MAX_SHARE,
  ADMINISTRATION_SHARE_PER_PLANET,
  EconomyService,
  RESERVE_SHIP_UPKEEP_FACTOR,
  UPKEEP_CREDITS_PER_POINT,
  administrationShare,
} from './economy.service';
import { ProductionService } from './production.service';
import { FleetAssemblyService } from './fleet-assembly.service';
import { ShipService } from './ship.service';
import { SaveGameService } from './save-game.service';
import { buildingCost, canAffordCost, payCost, shipCost } from './resource-cost';
import planetData from '../components/star-map/planet-data.json';
import {
  Faction,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  StarMapData,
  StarSystem,
} from '../components/star-map/star-map.models';

/*
 * Resource accounting of the economy (docs/economy.md): upkeep is charged
 * once per economy tick, the breakdown the HUD shows is what the balance
 * does, purchases charge credits + raw materials exactly once, and refunds
 * never exceed what was paid — including orders from legacy saves.
 */

const faction = (overrides: Partial<Faction> = {}): Faction => ({
  id: 'player',
  name: 'Player',
  color: '#8cc4ff',
  team: 1,
  ai: false,
  currencies: { credits: 10000, rawmaterials: 10000, research: 0 },
  ...overrides,
});

const homeworld = (overrides: Partial<PlanetTile> = {}): PlanetTile => ({
  id: 1,
  index: 0,
  name: 'Home',
  factionId: 'player',
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'medium',
  population: 700,
  satisfaction: 100,
  explored: true,
  buildings: [
    { name: 'Large Residential Block', size: 3, x: 0, y: 0 },
    { name: 'Fusion Power Plant', size: 3, x: 3, y: 0 },
    { name: 'Spaceship Factory', size: 3, x: 6, y: 0 },
    { name: 'Spaceport', size: 4, x: 0, y: 3 },
  ],
  ...overrides,
});

const system = (planets: PlanetTile[]): StarSystem => ({
  id: 'sys1',
  name: 'Sys',
  x: 1,
  y: 1,
  planets: planets.length,
  color: '#fff',
  planetsTiles: planets,
  explored: true,
});

const fleet = (ships: { type: string; destroyed?: boolean }[], overrides: Partial<Fleet> = {}): Fleet => ({
  id: 1,
  name: 'ALPHA',
  factionId: 'player',
  x: 1,
  y: 1,
  targetX: null,
  targetY: null,
  speed: 4,
  system: null,
  ships: ships.map((s, i) => ({ id: 100 + i, name: s.type, ...s })),
  ...overrides,
});

const upkeepPoints = (name: string): number =>
  (planetData as { buildings: { name: string; maintenanceCost: number }[] }).buildings.find((b) => b.name === name)!.maintenanceCost;

describe('Economy accounting — upkeep and the economy tick', () => {
  let economy: EconomyService;
  let ships: ShipService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    economy = TestBed.inject(EconomyService);
    ships = TestBed.inject(ShipService);
  });

  it('breaks upkeep into buildings, fleet ships and reserve ships, converted to credits', () => {
    const f = faction();
    const planet = homeworld();
    const fleets = [fleet([{ type: 'cruiser' }, { type: 'cruiser', destroyed: true }, { type: 'frigate' }])];
    const stock: FactionShipStock[] = [{ factionId: 'player', ships: [{ id: 900, type: 'cruiser', name: 'Cruiser' }] }];

    const breakdown = economy.calculateEconomy('player', [f], [system([planet])], fleets, stock);

    const buildingPoints = planet.buildings.reduce((sum, b) => sum + upkeepPoints(b.name), 0);
    const cruiser = ships.getShipType('cruiser')!.maintenanceCost;
    const frigate = ships.getShipType('frigate')!.maintenanceCost;
    expect(breakdown.buildingUpkeepPerSecond).toBeCloseTo(buildingPoints * UPKEEP_CREDITS_PER_POINT, 6);
    // Destroyed ships cost nothing; the stocked cruiser pays the reserve rate.
    expect(breakdown.shipUpkeepPerSecond).toBeCloseTo(
      (cruiser + frigate + cruiser * RESERVE_SHIP_UPKEEP_FACTOR) * UPKEEP_CREDITS_PER_POINT,
      6,
    );
    expect(breakdown.administrationPerSecond).toBe(0); // a single planet pays no administration
    expect(breakdown.expensePerSecond).toBeCloseTo(breakdown.buildingUpkeepPerSecond + breakdown.shipUpkeepPerSecond, 6);
    expect(breakdown.netPerSecond).toBeCloseTo(breakdown.incomePerSecond - breakdown.expensePerSecond, 6);
    // The HUD credit row is the same number.
    expect(breakdown.net['credits']).toBeCloseTo(breakdown.netPerSecond, 6);
  });

  it('charges upkeep exactly once per tick: the balance moves by the HUD net rate', () => {
    const f = faction();
    const systems = [system([homeworld()])];
    const fleets = [fleet([{ type: 'cruiser' }, { type: 'cruiser' }])];
    const before = f.currencies['credits']!;
    const hud = economy.calculateEconomy('player', [f], systems, fleets, []);

    economy.applyEconomyDelta('player', [f], systems, fleets, 1, [], []);

    expect(Math.abs(f.currencies['credits']! - before - hud.netPerSecond)).toBeLessThan(1);
    expect(hud.expensePerSecond).toBeGreaterThan(0);
  });

  it('is frame-rate independent: many small ticks equal one large tick (within rounding)', () => {
    const run = (deltas: number[]): number => {
      const f = faction();
      const systems = [system([homeworld()])];
      const fleets = [fleet([{ type: 'destroyer' }])];
      for (const dt of deltas) economy.applyEconomyDelta('player', [f], systems, fleets, dt, [], []);
      return f.currencies['credits']!;
    };
    // A fresh service per run so the fractional credit carry starts at 0.
    const once = run([10]);
    economy = new EconomyService(ships);
    const split = run(Array.from({ length: 40 }, () => 0.25));
    expect(Math.abs(once - split)).toBeLessThanOrEqual(1);
  });

  it('a paused tick (delta 0) charges nothing', () => {
    const f = faction();
    economy.applyEconomyDelta('player', [f], [system([homeworld()])], [fleet([{ type: 'cruiser' }])], 0, [], []);
    expect(f.currencies['credits']).toBe(10000);
  });

  it('only the owner pays for a fleet, and destroyed fleets cost nothing', () => {
    const f = faction();
    const enemy = faction({ id: 'enemy1', name: 'E', team: 2, ai: true });
    const fleets = [
      fleet([{ type: 'dreadnought' }], { id: 1, factionId: 'enemy1' }),
      fleet([{ type: 'dreadnought' }], { id: 2, destroyed: true }),
    ];
    const breakdown = economy.calculateEconomy('player', [f, enemy], [system([homeworld()])], fleets, []);
    expect(breakdown.shipUpkeepPerSecond).toBe(0);
    expect(breakdown.fleetExpenses).toEqual([]);
  });

  it('a planet that changed owner stops costing upkeep immediately', () => {
    const f = faction();
    const planet = homeworld();
    const systems = [system([planet])];
    const before = economy.calculateEconomy('player', [f], systems, [], []);
    planet.factionId = 'enemy1';
    const after = economy.calculateEconomy('player', [f], systems, [], []);
    expect(before.buildingUpkeepPerSecond).toBeGreaterThan(0);
    expect(after.buildingUpkeepPerSecond).toBe(0);
  });

  it('arrears: credits stop at 0, the unpaid share is reported and costs satisfaction', () => {
    // No population → no income; buildings and a fleet still cost upkeep.
    const planet = homeworld({ population: 0, satisfaction: 80 });
    const f = faction({ currencies: { credits: 5, rawmaterials: 0, research: 0 } });
    const fleets = [fleet([{ type: 'battleship' }])];

    const breakdown = economy.applyEconomyDelta('player', [f], [system([planet])], fleets, 1, [], []);

    expect(f.currencies['credits']).toBe(0);
    expect(breakdown.unpaidUpkeepPerSecond).toBeGreaterThan(0);
    // +1 energy drift, then nearly the full ARREARS_MORALE_PENALTY (almost all upkeep unpaid).
    expect(planet.satisfaction!).toBeLessThan(80);
    expect(planet.satisfaction!).toBeGreaterThan(80 + 1 - EconomyService.ARREARS_MORALE_PENALTY - 0.5);
  });

  it('a solvent faction never enters arrears and keeps its satisfaction', () => {
    const planet = homeworld({ satisfaction: 90 });
    const f = faction();
    const breakdown = economy.applyEconomyDelta('player', [f], [system([planet])], [], 1, [], []);
    expect(breakdown.unpaidUpkeepPerSecond).toBe(0);
    expect(planet.satisfaction).toBeGreaterThanOrEqual(90);
  });

  it('colony administration grows with the number of planets and is capped', () => {
    expect(administrationShare(1)).toBe(0);
    expect(administrationShare(4)).toBeCloseTo(3 * ADMINISTRATION_SHARE_PER_PLANET, 9);
    expect(administrationShare(100)).toBe(ADMINISTRATION_MAX_SHARE);

    const f = faction();
    const planets = [1, 2, 3].map((id) => homeworld({ id, name: `P${id}` }));
    const breakdown = economy.calculateEconomy('player', [f], [system(planets)], [], []);
    expect(breakdown.administrationPerSecond).toBeCloseTo(breakdown.incomePerSecond * administrationShare(3), 6);
    // Administration is part of the expense the HUD shows and the tick charges.
    expect(breakdown.expensePerSecond).toBeCloseTo(
      breakdown.buildingUpkeepPerSecond + breakdown.administrationPerSecond + breakdown.shipUpkeepPerSecond,
      6,
    );
  });

  it('a populated planet yields a small raw-material trickle even without industry', () => {
    const planet = homeworld({ buildings: [{ name: 'Large Residential Block', size: 3, x: 0, y: 0 }, { name: 'Solar Array', size: 2, x: 3, y: 0 }] });
    const f = faction({ currencies: { credits: 10000, rawmaterials: 0, research: 0 } });
    economy.applyEconomyDelta('player', [f], [system([planet])], [], 10, [], []);
    expect(f.currencies['rawmaterials']).toBeGreaterThan(0);
  });
});

describe('Economy accounting — purchases, production and refunds', () => {
  let production: ProductionService;
  let assembly: FleetAssemblyService;
  let ships: ShipService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    production = TestBed.inject(ProductionService);
    assembly = TestBed.inject(FleetAssemblyService);
    ships = TestBed.inject(ShipService);
  });

  const world = () => {
    const f = faction();
    const systems = [system([homeworld()])];
    const data: { production: FactionProduction[]; shipStock: FactionShipStock[]; fleets: Fleet[] } = {
      production: [],
      shipStock: [],
      fleets: [],
    };
    return { f, systems, data };
  };

  it('payCost is all-or-nothing', () => {
    const f = faction({ currencies: { credits: 5000, rawmaterials: 10 } });
    expect(canAffordCost(f, { credits: 100, rawmaterials: 50 })).toBe(false);
    expect(payCost(f, { credits: 100, rawmaterials: 50 })).toBe(false);
    expect(f.currencies).toEqual({ credits: 5000, rawmaterials: 10 });
  });

  it('every building has a price and a raw-material cost, and they are differentiated', () => {
    const defs = (planetData as { buildings: { id: string; price: number; rawMaterialCost?: number }[] }).buildings;
    for (const def of defs) {
      expect(def.price, def.id).toBeGreaterThan(0);
      expect(def.rawMaterialCost ?? 0, def.id).toBeGreaterThan(0);
    }
    const price = (id: string) => buildingCost(defs.find((d) => d.id === id)!).credits;
    expect(price('small_residential')).toBeLessThan(price('medium_residential'));
    expect(price('medium_residential')).toBeLessThan(price('large_residential'));
    expect(price('solar_array')).toBeLessThan(price('fusion_plant'));
    expect(price('small_research_lab')).toBeLessThan(price('research_lab'));
    expect(price('spaceship_factory')).toBeLessThan(price('spaceport'));
  });

  it('queueOrder charges credits and raw materials once and records what was paid', () => {
    const { f, systems, data } = world();
    const cruiser = ships.getShipType('cruiser')!;
    const result = production.queueOrder(data, 'player', 1, 'cruiser', 2, systems, [f]);
    expect(result.ok).toBe(true);
    expect(f.currencies['credits']).toBe(10000 - 2 * cruiser.cost);
    expect(f.currencies['rawmaterials']).toBe(10000 - 2 * cruiser.rawMaterialCost!);
    expect(result.order!.paid).toEqual(shipCost(cruiser, 2));
  });

  it('insufficient raw materials reject the order without charging anything', () => {
    const { systems, data } = world();
    const f = faction({ currencies: { credits: 10000, rawmaterials: 10, research: 0 } });
    const result = production.queueOrder(data, 'player', 1, 'cruiser', 1, systems, [f]);
    expect(result).toEqual({ ok: false, reason: 'insufficient_resources' });
    expect(f.currencies['credits']).toBe(10000);
    expect(f.currencies['rawmaterials']).toBe(10);
    expect(production.getQueue(data, 'player', 1)).toHaveLength(0);
  });

  it('completion moves ships to the stock without a second charge; assembling a fleet charges nothing', () => {
    const { f, systems, data } = world();
    production.queueOrder(data, 'player', 1, 'fighter', 1, systems, [f]);
    const afterQueue = { ...f.currencies };
    for (let i = 0; i < 2000; i++) production.tick(0.1, data, systems, data.fleets, [f]);
    expect(data.shipStock.find((s) => s.factionId === 'player')!.ships).toHaveLength(1);
    expect(f.currencies).toEqual(afterQueue);

    const created = assembly.createFleet(data, systems, {
      factionId: 'player', fleetName: 'NEW', systemId: 'sys1', planetId: 1, composition: [{ typeId: 'fighter', count: 1 }],
    });
    expect(created.ok).toBe(true);
    expect(f.currencies).toEqual(afterQueue);
  });

  it('cancel refunds the un-built share of both resources, exactly once', () => {
    const { f, systems, data } = world();
    const order = production.queueOrder(data, 'player', 1, 'cruiser', 1, systems, [f]).order!;
    order.progress = 0.25;
    const refund = production.cancelOrder(data, 'player', 1, order.id, [f]);
    const cruiser = ships.getShipType('cruiser')!;
    expect(refund.refunded).toEqual({
      credits: Math.round(cruiser.cost * 0.75),
      rawmaterials: Math.round(cruiser.rawMaterialCost! * 0.75),
      research: 0,
    });
    // A second cancel finds nothing and refunds nothing.
    const again = production.cancelOrder(data, 'player', 1, order.id, [f]);
    expect(again.ok).toBe(false);
    expect(f.currencies['credits']).toBe(10000 - cruiser.cost + Math.round(cruiser.cost * 0.75));
  });

  it('refunds follow what was paid, not the current price', () => {
    const { f, systems, data } = world();
    const order = production.queueOrder(data, 'player', 1, 'fighter', 1, systems, [f]).order!;
    order.paid = { credits: 10, rawmaterials: 4 }; // e.g. queued before a price rebalance
    production.cancelOrder(data, 'player', 1, order.id, [f]);
    const fighter = ships.getShipType('fighter')!;
    expect(f.currencies['credits']).toBe(10000 - fighter.cost + 10);
    expect(f.currencies['rawmaterials']).toBe(10000 - fighter.rawMaterialCost! + 4);
  });

  it('a legacy order (saved before raw-material costs) refunds credits only', () => {
    const { f, systems, data } = world();
    data.production = [{ factionId: 'player', ordersByPlanet: { 1: [{ id: 7, shipTypeId: 'cruiser', quantity: 1, progress: 0, startedAtTick: 0 }] } }];
    production.rebaseFromSave(data.production);
    const result = production.cancelOrder(data, 'player', 1, 7, [f]);
    expect(result.refunded).toEqual({ credits: ships.getShipType('cruiser')!.cost, rawmaterials: 0, research: 0 });
    expect(f.currencies['rawmaterials']).toBe(10000);
  });

  it('a malformed paid record falls back to the legacy refund instead of NaN', () => {
    const { f, data } = world();
    data.production = [{
      factionId: 'player',
      ordersByPlanet: { 1: [{ id: 8, shipTypeId: 'fighter', quantity: 1, progress: 0, startedAtTick: 0, paid: { credits: 'x' as never, rawmaterials: 1 } }] },
    }];
    production.cancelOrder(data, 'player', 1, 8, [f]);
    expect(f.currencies['credits']).toBe(10000 + ships.getShipType('fighter')!.cost);
    expect(Number.isFinite(f.currencies['rawmaterials'])).toBe(true);
  });

  it('a save/load round trip neither charges nor refunds an order again', () => {
    const { f, systems, data } = world();
    production.queueOrder(data, 'player', 1, 'frigate', 1, systems, [f]);
    const afterQueue = { ...f.currencies };
    const loaded = JSON.parse(JSON.stringify({ data, f }));
    production.rebaseFromSave(loaded.data.production);
    expect(loaded.f.currencies).toEqual(afterQueue);
    expect(loaded.data.production[0].ordersByPlanet[1][0].paid).toEqual(shipCost(ships.getShipType('frigate')!));
    for (let i = 0; i < 2000; i++) production.tick(0.1, loaded.data, systems, loaded.data.fleets, [loaded.f]);
    expect(loaded.f.currencies).toEqual(afterQueue);
    expect(loaded.data.shipStock[0].ships).toHaveLength(1);
  });
});

describe('Economy accounting — legacy save compatibility', () => {
  it('a save written before the economy rework loads unchanged (no paid records, credits-only currencies)', () => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    const service = new SaveGameService();
    const legacy: StarMapData = {
      factions: [
        { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: { credits: 1234 } } as Faction,
        { id: 'enemy1', name: 'E', color: '#d65757', team: 2, ai: true, currencies: { credits: 99, rawmaterials: 5, research: 7 } } as Faction,
      ],
      map: { width: 100, height: 60, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [system([homeworld()])],
      fleets: [],
      production: [{ factionId: 'player', ordersByPlanet: { 1: [{ id: 3, shipTypeId: 'cruiser', quantity: 2, progress: 0.5, startedAtTick: 12 }] } }],
      shipStock: [{ factionId: 'player', ships: [{ id: 50, type: 'fighter', name: 'Fighter' }] }],
    };
    expect(service.saveToSlot(1, legacy)).toBe(true);
    const loaded = service.loadFromSlot(1)!;
    expect(loaded).not.toBeNull();
    // Balances are not reset or topped up; missing resources read as 0 in every rule.
    expect(loaded.factions.find((f) => f.id === 'player')!.currencies['credits']).toBe(1234);
    expect(loaded.factions.find((f) => f.id === 'enemy1')!.currencies).toEqual({ credits: 99, rawmaterials: 5, research: 7 });
    expect(loaded.production![0].ordersByPlanet[1][0].paid).toBeUndefined();
    expect(loaded.shipStock![0].ships).toHaveLength(1);
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });
});

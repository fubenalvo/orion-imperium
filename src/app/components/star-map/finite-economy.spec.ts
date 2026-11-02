import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Faction,
  FactionProduction,
  FactionShipStock,
  Fleet,
  PlanetTile,
  StarMapData,
  StarSystem,
} from './star-map.models';
import { EconomyService, POPULATION_RAW_RATE } from '../../services/economy.service';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { buildingCost, payCost, shipCost } from '../../services/resource-cost';
import { StarMapMovementService } from './star-map-movement.service';
import { SpaceBaseService } from './space-base.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyMiningService } from './enemy-mining.service';
import { normalizeRelations } from './diplomacy';
import { OUTPOST_SHIP_TYPE } from './space-base';
import {
  PLANET_DEPOSIT_CONFIG,
  ensurePlanetDeposits,
  generatePlanetDeposit,
  minedDepositsOf,
  planetDepositView,
  rawOutlook,
  rawSupplyPressure,
} from './raw-deposits';
import { asteroidExtractionRate, ensureSystemAsteroidBelts, generateSystemAsteroidBelt } from './system-asteroids';
import { extractMiningStations, stationExtractionRate } from './mining-station';
import planetData from './planet-data.json';
import shipData from './ship-data.json';

/*
 * Finite raw-material economy (docs/economy.md, "Finite deposits"): planet
 * and asteroid reserves, extraction in the economy tick, depletion, save
 * compatibility, the cost structure (ships mostly raw, buildings mostly
 * credits) and the AI following the same rules (mining, deposit-aware
 * expansion, asteroid mining with outpost ships).
 */

const W = 120;
const H = 80;

function factions(): Faction[] {
  const list = [
    { id: 'player', name: 'Terrans', color: '#3cf', team: 1, currencies: { credits: 0, rawmaterials: 0, research: 0 }, researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'] },
    { id: 'enemy1', name: 'Vex', color: '#f44', team: 2, ai: true, currencies: { credits: 0, rawmaterials: 0, research: 0 }, researchedTechnologies: ['basic_engineering', 'basic_science', 'basic_industry', 'basic_power'] },
    { id: 'unhabited', name: 'Uninhabited', color: '#666', team: 0, currencies: {} },
  ] as unknown as Faction[];
  normalizeRelations(list);
  return list;
}

const b = (name: string, x = 0, y = 0) => {
  const def = (planetData as { buildings: { name: string; size: number }[] }).buildings.find((d) => d.name === name)!;
  return { name, size: def.size, x, y };
};

/*
 * A staffed, powered mining planet: 2 × Large Residential, Fusion Plant,
 * Mining Complex. Population 0 (no trickle) unless a test sets it; at
 * HOUSING_CAPACITY the population no longer grows, so the trickle is constant.
 */
const HOUSING_CAPACITY = 1400;
const TRICKLE_AT_CAPACITY = HOUSING_CAPACITY * POPULATION_RAW_RATE;
function miningPlanet(id: number, owner: string, deposit: { total: number; remaining: number; richness: number }, extra: ReturnType<typeof b>[] = []): PlanetTile {
  return {
    id, index: 0, name: `P${id}`, factionId: owner, x: 1, y: 1, type: 'earthlike', size: 'medium',
    population: 0, satisfaction: 100, explored: true,
    buildings: [b('Large Residential Block'), b('Large Residential Block', 3), b('Fusion Power Plant', 6), b('Mining Complex', 0, 3), ...extra],
    resourceTiles: [{ type: 'rawmaterial', x: 0, y: 6 }],
    rawDeposit: { ...deposit },
  };
}

function system(id: string, x: number, y: number, planets: PlanetTile[]): StarSystem {
  return { id, name: id, x, y, planets: planets.length, color: '#fff', planetsTiles: planets, explored: true };
}

describe('finite raw-material deposits', () => {
  let economy: EconomyService;

  beforeEach(() => {
    economy = TestBed.inject(EconomyService);
  });

  describe('planet deposits', () => {
    it('mining reduces the planet reserve by exactly what is credited (1)', () => {
      const f = factions();
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 40000, richness: 1 });
      const systems = [system('home', 30, 30, [planet])];
      const breakdown = economy.calculateEconomy('player', f, systems, []);
      expect(breakdown.planets[0].miningRate).toBeCloseTo(15, 6);
      expect(breakdown.depositMiningPerSecond).toBeCloseTo(15, 6);

      economy.applyEconomyDelta('player', f, systems, [], 10);
      expect(planet.rawDeposit!.remaining).toBeCloseTo(40000 - 150, 6);
      expect(f[0].currencies['rawmaterials']).toBeCloseTo(150, 6);
    });

    it('mining stops automatically at zero; the mine stays but produces nothing (3)', () => {
      const f = factions();
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 40, richness: 1 });
      planet.population = HOUSING_CAPACITY;
      const systems = [system('home', 30, 30, [planet])];
      economy.applyEconomyDelta('player', f, systems, [], 10);
      expect(planet.rawDeposit!.remaining).toBe(0);
      // Never more than the deposit held (plus the population trickle).
      expect(f[0].currencies['rawmaterials']).toBeCloseTo(40 + TRICKLE_AT_CAPACITY * 10, 6);

      economy.applyEconomyDelta('player', f, systems, [], 10);
      expect(f[0].currencies['rawmaterials']).toBeCloseTo(40 + TRICKLE_AT_CAPACITY * 20, 6);
      expect(planet.buildings.some((x) => x.name === 'Mining Complex')).toBe(true);
      const after = economy.calculateEconomy('player', f, systems, []);
      expect(after.planets[0].miningRate).toBe(0);
      expect(after.depositMiningPerSecond).toBe(0);
      expect(after.net['rawmaterials'] ?? 0).toBeCloseTo(TRICKLE_AT_CAPACITY, 6);
      expect(planetDepositView(planet, 0)?.status).toBe('depleted');
    });

    it('the population trickle is the only raw source that keeps flowing after depletion', () => {
      const f = factions();
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 0, richness: 1 });
      planet.population = 1000;
      const systems = [system('home', 30, 30, [planet])];
      economy.applyEconomyDelta('player', f, systems, [], 10);
      expect(f[0].currencies['rawmaterials']).toBeGreaterThan(0);
      expect(planet.rawDeposit!.remaining).toBe(0);
    });

    it('different deposits have different reserves and extraction rates (5)', () => {
      const deposits = Array.from({ length: 40 }, (_, i) => generatePlanetDeposit({ id: i + 1, size: 'medium' }));
      expect(new Set(deposits.map((d) => d.total)).size).toBeGreaterThan(5);
      expect(new Set(deposits.map((d) => d.richness)).size).toBeGreaterThan(5);
      for (const d of deposits) {
        expect(d.remaining).toBe(d.total);
        expect(d.richness).toBeGreaterThanOrEqual(PLANET_DEPOSIT_CONFIG.richness.min);
        expect(d.richness).toBeLessThanOrEqual(PLANET_DEPOSIT_CONFIG.richness.max);
      }
      // Bigger planets hold more on average.
      const avg = (size: PlanetTile['size']) =>
        Array.from({ length: 40 }, (_, i) => generatePlanetDeposit({ id: i + 1, size }).total).reduce((a, x) => a + x, 0) / 40;
      expect(avg('huge')).toBeGreaterThan(avg('medium'));
      expect(avg('medium')).toBeGreaterThan(avg('tiny'));

      // Richness scales the mine's output.
      const f = factions();
      const rich = miningPlanet(1, 'player', { total: 40000, remaining: 40000, richness: 1.2 });
      const poor = miningPlanet(2, 'player', { total: 40000, remaining: 40000, richness: 0.8 });
      const rates = economy.calculateEconomy('player', f, [system('a', 10, 10, [rich]), system('b', 50, 50, [poor])], []).planets;
      expect(rates[0].miningRate / rates[1].miningRate).toBeCloseTo(1.5, 6);
    });

    it('deposits are generated exactly for planets with deposit tiles and never refilled', () => {
      const withTiles = { ...miningPlanet(1, 'player', { total: 1, remaining: 1, richness: 1 }) };
      delete withTiles.rawDeposit;
      const noTiles = { ...miningPlanet(2, 'player', { total: 5, remaining: 5, richness: 1 }), resourceTiles: [] };
      const depleted = miningPlanet(3, 'player', { total: 30000, remaining: 0, richness: 1.1 });
      ensurePlanetDeposits([withTiles, noTiles, depleted]);
      expect(withTiles.rawDeposit).toEqual(generatePlanetDeposit(withTiles));
      expect(noTiles.rawDeposit).toBeUndefined();
      expect(depleted.rawDeposit).toEqual({ total: 30000, remaining: 0, richness: 1.1 });
    });

    it('a depleted deposit refuses a new mine (player rule, AI rule)', async () => {
      const f = factions();
      f[1].currencies = { credits: 50000, rawmaterials: 50000, research: 0 };
      const dead = miningPlanet(1, 'enemy1', { total: 40000, remaining: 0, richness: 1 });
      dead.buildings = dead.buildings.filter((x) => x.name !== 'Mining Complex');
      const live = miningPlanet(2, 'enemy1', { total: 40000, remaining: 40000, richness: 1 });
      live.buildings = live.buildings.filter((x) => x.name !== 'Mining Complex');
      const { depositMiningBlocker } = await import('./raw-deposits');
      expect(depositMiningBlocker(dead)).toBe('depleted');
      expect(depositMiningBlocker(live)).toBeNull();
    });
  });

  describe('asteroid deposits', () => {
    it('each asteroid has its own original reserve and extraction rate (2, 5)', () => {
      const sys = system('belt', 30, 30, []);
      const belt = generateSystemAsteroidBelt(7, sys);
      const deposits = belt.asteroids.filter((a) => a.rawMaterials > 0);
      expect(deposits.length).toBeGreaterThan(0);
      for (const a of belt.asteroids) {
        expect(a.totalRawMaterials).toBe(a.rawMaterials);
        expect(a.extractionRate).toBe(asteroidExtractionRate(7, 'belt', a.col, a.row));
      }
      expect(new Set(belt.asteroids.map((a) => a.extractionRate)).size).toBeGreaterThan(2);
    });

    it('a station drains its asteroid at that asteroid\'s rate and stops at zero (2, 3)', () => {
      const sys = system('belt', 30, 30, []);
      sys.asteroidBelt = { version: 2, radiusVw: 40, asteroids: [
        { col: 3, row: 3, rawMaterials: 100, totalRawMaterials: 4000, extractionRate: 7, surveyed: true, miningStation: { factionId: 'player' } },
        { col: 5, row: 3, rawMaterials: 4000, totalRawMaterials: 4000, extractionRate: 3, surveyed: true, miningStation: { factionId: 'player' } },
      ] };
      const [fast, slow] = sys.asteroidBelt.asteroids;
      expect(stationExtractionRate(fast)).toBe(7);
      expect(extractMiningStations('player', [sys], 10, 1)).toBeCloseTo(70 + 30, 6);
      expect(fast.rawMaterials).toBeCloseTo(30, 6);
      expect(slow.rawMaterials).toBeCloseTo(3970, 6);
      expect(extractMiningStations('player', [sys], 10, 1)).toBeCloseTo(30 + 30, 6);
      expect(fast.rawMaterials).toBe(0);
      expect(extractMiningStations('player', [sys], 10, 1)).toBeCloseTo(30, 6);
      expect(fast.miningStation).toEqual({ factionId: 'player' });
    });

    it('lists exactly the deposits being mined, so depletion can be announced once', () => {
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 5, richness: 1 });
      const systems = [system('home', 30, 30, [planet])];
      const tracked = minedDepositsOf('player', systems);
      expect(tracked).toHaveLength(1);
      economy.applyEconomyDelta('player', factions(), systems, [], 2);
      expect(tracked[0].isEmpty()).toBe(true);
      expect(minedDepositsOf('player', systems)).toHaveLength(0);
    });
  });

  describe('real-time consistency (14)', () => {
    it('a paused game (delta 0) extracts nothing', () => {
      const f = factions();
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 40000, richness: 1 });
      const systems = [system('home', 30, 30, [planet])];
      economy.applyEconomyDelta('player', f, systems, [], 0);
      expect(planet.rawDeposit!.remaining).toBe(40000);
      expect(f[0].currencies['rawmaterials']).toBe(0);
    });

    it('many small ticks extract the same as one large tick (game speed independence)', () => {
      const run = (ticks: number, dt: number) => {
        const f = factions();
        const planet = miningPlanet(1, 'player', { total: 40000, remaining: 40000, richness: 1.1 });
        planet.population = HOUSING_CAPACITY;
        const systems = [system('home', 30, 30, [planet])];
        for (let i = 0; i < ticks; i++) economy.applyEconomyDelta('player', f, systems, [], dt);
        return { remaining: planet.rawDeposit!.remaining, raw: f[0].currencies['rawmaterials']! };
      };
      const one = run(1, 20);
      const many = run(20, 1);
      const fast = run(5, 4); // speed ×4 with 1 s real ticks
      expect(many.remaining).toBeCloseTo(one.remaining, 6);
      expect(many.raw).toBeCloseTo(one.raw, 6);
      expect(fast.remaining).toBeCloseTo(one.remaining, 6);
    });
  });

  describe('save / load (4, 13)', () => {
    const save = (systems: StarSystem[], f: Faction[]): StarMapData => ({
      saveVersion: SAVE_VERSION,
      factions: f,
      map: { width: W, height: H, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: systems,
      fleets: [],
    });

    it('depleted and partly mined deposits survive a save slot round trip unchanged', () => {
      const planet = miningPlanet(1, 'player', { total: 40000, remaining: 0, richness: 0.9 });
      const partial = miningPlanet(2, 'player', { total: 30000, remaining: 12345.5, richness: 1.2 });
      const sys = system('home', 30, 30, [planet, partial]);
      sys.asteroidBelt = { version: 2, radiusVw: 40, asteroids: [
        { col: 3, row: 3, rawMaterials: 0, totalRawMaterials: 5000, extractionRate: 6, surveyed: true, surveyedBy: ['enemy1'], miningStation: { factionId: 'player' } },
      ] };
      const saves = TestBed.inject(SaveGameService);
      saves.saveToSlot(1, save([sys], factions()));
      const loaded = saves.loadFromSlot(1)!;
      const [p1, p2] = loaded.starSystems[0].planetsTiles;
      expect(p1.rawDeposit).toEqual({ total: 40000, remaining: 0, richness: 0.9 });
      expect(p2.rawDeposit).toEqual({ total: 30000, remaining: 12345.5, richness: 1.2 });
      expect(loaded.starSystems[0].asteroidBelt!.asteroids[0]).toMatchObject({
        rawMaterials: 0, totalRawMaterials: 5000, extractionRate: 6, surveyedBy: ['enemy1'], miningStation: { factionId: 'player' },
      });
      saves.clearSlot(1);
    });

    it('loading repairs missing deposit reserves with full reserves and keeps all progress', () => {
      const f = factions();
      f[0].currencies = { credits: 12345, rawmaterials: 678, research: 910 };
      const planet = miningPlanet(1, 'player', { total: 0, remaining: 0, richness: 1 });
      delete planet.rawDeposit;
      const barren = { ...miningPlanet(2, 'player', { total: 0, remaining: 0, richness: 1 }), resourceTiles: [] };
      delete barren.rawDeposit;
      const sys = system('home', 30, 30, [planet, barren]);
      // A version-1 belt with a station that was already mining before the update.
      const legacy = generateSystemAsteroidBelt(99, sys, 1);
      const rich = legacy.asteroids.find((a) => a.rawMaterials > 0)!;
      const original = rich.rawMaterials;
      for (const a of legacy.asteroids) {
        delete a.totalRawMaterials;
        delete a.extractionRate;
      }
      rich.rawMaterials = original - 500;
      rich.miningStation = { factionId: 'player' };
      sys.asteroidBelt = legacy;
      const data = save([sys], f);
      data.galaxy = { size: 'small', seed: 99, generatorVersion: 3 };

      const migrated = TestBed.inject(SaveGameService).normalizeSave(data);
      const [p1, p2] = migrated.starSystems[0].planetsTiles;
      expect(p1.rawDeposit).toEqual(generatePlanetDeposit(p1));
      expect(p1.rawDeposit!.remaining).toBe(p1.rawDeposit!.total);
      expect(p2.rawDeposit).toBeUndefined();
      expect(p1.buildings.map((x) => x.name)).toContain('Mining Complex');
      expect(migrated.factions[0].currencies).toEqual({ credits: 12345, rawmaterials: 678, research: 910 });
      const migratedRich = migrated.starSystems[0].asteroidBelt!.asteroids.find((a) => a.col === rich.col && a.row === rich.row)!;
      expect(migratedRich.rawMaterials).toBe(original - 500);
      expect(migratedRich.totalRawMaterials).toBe(original);
      expect(migratedRich.extractionRate).toBe(asteroidExtractionRate(99, 'home', rich.col, rich.row));
      // Idempotent: a second load changes nothing.
      const again = JSON.parse(JSON.stringify(migrated));
      TestBed.inject(SaveGameService).normalizeSave(again);
      expect(again.starSystems).toEqual(JSON.parse(JSON.stringify(migrated.starSystems)));
      ensureSystemAsteroidBelts(again.starSystems, 99);
      expect(again.starSystems).toEqual(JSON.parse(JSON.stringify(migrated.starSystems)));
    });
  });

  describe('cost structure (6, 7)', () => {
    const ships = (shipData as { shipTypes: { id: string; role: string; cost: number; rawMaterialCost: number }[] }).shipTypes;
    // Core buildings (colony-core.ts) are free and never bought.
    const buildings = (planetData as { buildings: { id: string; name: string; price: number; rawMaterialCost: number; autoPlaced?: boolean }[] }).buildings
      .filter((b) => !b.autoPlaced);

    it('warships cost mostly raw materials, buildings mostly credits', () => {
      for (const ship of ships.filter((s) => !['colonizer', 'outpost_ship'].includes(s.id))) {
        const share = ship.rawMaterialCost / (ship.rawMaterialCost + ship.cost);
        expect(share, ship.id).toBeGreaterThanOrEqual(0.7);
      }
      for (const building of buildings) {
        const share = building.rawMaterialCost / (building.rawMaterialCost + building.price);
        expect(share, building.id).toBeGreaterThan(0.1);
        expect(share, building.id).toBeLessThanOrEqual(0.25);
      }
      // Heavier hulls need more raw materials.
      const raw = (id: string) => ships.find((s) => s.id === id)!.rawMaterialCost;
      expect(raw('scout')).toBeLessThan(raw('frigate'));
      expect(raw('frigate')).toBeLessThan(raw('cruiser'));
      expect(raw('cruiser')).toBeLessThan(raw('battleship'));
      expect(raw('battleship')).toBeLessThan(raw('dreadnought'));
    });

    it('queuing ships charges exactly their credits and raw materials', () => {
      const f = factions();
      f[0].currencies = { credits: 10000, rawmaterials: 10000, research: 0 };
      const factory = { ...miningPlanet(1, 'player', { total: 1, remaining: 1, richness: 1 }), buildings: [b('Spaceship Factory')] };
      const systems = [system('home', 30, 30, [factory])];
      const production: FactionProduction[] = [];
      const result = TestBed.inject(ProductionService).queueOrder({ production }, 'player', 1, 'scout', 3, systems, f);
      expect(result.ok).toBe(true);
      const scout = TestBed.inject(ShipService).getShipType('scout')!;
      expect(f[0].currencies['credits']).toBe(10000 - 3 * scout.cost);
      expect(f[0].currencies['rawmaterials']).toBe(10000 - 3 * scout.rawMaterialCost!);
      // Enough credits but not enough raw materials: nothing is charged.
      f[0].currencies = { credits: 100000, rawmaterials: 10, research: 0 };
      expect(TestBed.inject(ProductionService).queueOrder({ production }, 'player', 1, 'scout', 1, systems, f).ok).toBe(false);
      expect(f[0].currencies).toEqual({ credits: 100000, rawmaterials: 10, research: 0 });
    });

    it('buildings charge their credits and raw materials together, or nothing', () => {
      const def = buildings.find((d) => d.id === 'mining_complex')!;
      const f = factions()[0];
      f.currencies = { credits: def.price, rawmaterials: def.rawMaterialCost };
      expect(payCost(f, buildingCost(def))).toBe(true);
      expect(f.currencies).toEqual({ credits: 0, rawmaterials: 0 });
      f.currencies = { credits: 99999, rawmaterials: def.rawMaterialCost - 1 };
      expect(payCost(f, buildingCost(def))).toBe(false);
      expect(f.currencies['credits']).toBe(99999);
    });
  });
});

describe('AI under the finite economy (11, 12)', () => {
  beforeEach(() => {
    TestBed.inject(StarMapMovementService).initialize(2, 2, W, H);
    TestBed.inject(SpaceBaseService).restore([]);
  });

  const context = (f: Faction[], fleets: Fleet[] = []) => ({
    fleets,
    shipStock: [] as FactionShipStock[],
    production: [] as FactionProduction[],
    factions: f,
  });

  it('raw-supply pressure rises as the mined deposits run out', () => {
    const healthy = [system('a', 10, 10, [miningPlanet(1, 'enemy1', { total: 60000, remaining: 60000, richness: 1 })])];
    const dying = [system('a', 10, 10, [miningPlanet(1, 'enemy1', { total: 60000, remaining: 3000, richness: 1 })])];
    const dead = [system('a', 10, 10, [miningPlanet(1, 'enemy1', { total: 60000, remaining: 0, richness: 1 })])];
    expect(rawSupplyPressure(rawOutlook('enemy1', healthy))).toBeLessThan(1);
    expect(rawSupplyPressure(rawOutlook('enemy1', dying))).toBe(2);
    expect(rawSupplyPressure(rawOutlook('enemy1', dead))).toBe(2);
    expect(rawOutlook('enemy1', dead).extractionPerSecond).toBe(0);
  });

  it('builds a mine on a live deposit, never on a depleted one, and never overspends', () => {
    const ai = TestBed.inject(EnemyEconomyService);
    const f = factions();
    f[1].currencies = { credits: 100000, rawmaterials: 400, research: 0 };
    const strip = (p: PlanetTile) => ({ ...p, buildings: p.buildings.filter((x) => x.name !== 'Mining Complex') });
    const dead = strip(miningPlanet(1, 'enemy1', { total: 40000, remaining: 0, richness: 1 }, [b('Spaceship Factory', 9, 0), b('Spaceport', 9, 4)]));
    const systems = [system('a', 10, 10, [dead])];
    for (let i = 0; i < 5; i++) ai.tryConstruct(f[1], systems, context(f)), ai.advanceConstructionClock('enemy1', 2);
    expect(dead.buildings.some((x) => x.name === 'Mining Complex')).toBe(false);
    expect(f[1].currencies['rawmaterials']).toBeGreaterThanOrEqual(0);

    const live = strip(miningPlanet(2, 'enemy1', { total: 40000, remaining: 40000, richness: 1 }));
    systems.push(system('b', 40, 40, [live]));
    ai.reset();
    ai.tryConstruct(f[1], systems, context(f));
    expect(live.buildings.filter((x) => x.name === 'Mining Complex')).toHaveLength(1);
    expect(f[1].currencies['rawmaterials']).toBe(400 - 375);
  });

  it('with plenty of credits but no raw materials it queues no warship (same limits as the player)', () => {
    const ai = TestBed.inject(EnemyEconomyService);
    const f = factions();
    f[1].currencies = { credits: 1_000_000, rawmaterials: 100, research: 0 };
    const home = miningPlanet(1, 'enemy1', { total: 40000, remaining: 0, richness: 1 }, [b('Spaceship Factory', 9, 0), b('Spaceport', 9, 4)]);
    const ctx = context(f);
    expect(ai.isRawConstrained(f[1])).toBe(true);
    for (let t = 0; t < 20; t++) ai.tick(1, f[1], [system('a', 10, 10, [home])], ctx);
    const orders = ctx.production.flatMap((p) => Object.values(p.ordersByPlanet).flat());
    expect(orders).toHaveLength(0);
    expect(f[1].currencies['rawmaterials']).toBeGreaterThanOrEqual(0);
  });

  it('prefers colonizing a planet with a deposit when its own deposits are exhausted', () => {
    const goals = TestBed.inject(EnemyGoalService);
    goals.reset();
    const f = factions();
    const home = miningPlanet(1, 'enemy1', { total: 40000, remaining: 0, richness: 1 });
    const target = (id: number, deposit: boolean): PlanetTile => ({
      id, index: 0, name: `T${id}`, factionId: 'unhabited', x: 1, y: 1, type: 'earthlike', size: 'medium',
      population: 0, buildings: [], explored: true,
      resourceTiles: deposit ? [{ type: 'rawmaterial', x: 2, y: 2 }] : [],
      ...(deposit ? { rawDeposit: { total: 40000, remaining: 40000, richness: 1 } } : {}),
    });
    // Same distance; the plain planet has the lower id and would win a tie.
    const systems = [
      system('home', 20, 20, [home]),
      system('plain', 28, 20, [target(5, false)]),
      system('ore', 12, 20, [target(9, true)]),
    ];
    const fleets: Fleet[] = [{ id: 1, name: 'F', factionId: 'enemy1', x: 20, y: 20, targetX: null, targetY: null, speed: 5, system: null, ships: [{ id: 1, name: 's', type: 'frigate' }] }];
    goals.tick(3, 'expand', 'enemy1', fleets, f, systems);
    expect((goals.getGoal('enemy1') as { targetPlanetId?: number }).targetPlanetId).toBe(9);
  });

  it('builds an outpost ship, surveys an asteroid belt and deploys a mining station when its deposits run dry', () => {
    const mining = TestBed.inject(EnemyMiningService);
    const movement = TestBed.inject(StarMapMovementService);
    const production = TestBed.inject(ProductionService);
    mining.reset();
    const f = factions();
    f[1].currencies = { credits: 50000, rawmaterials: 5000, research: 0 };
    const home = miningPlanet(1, 'enemy1', { total: 40000, remaining: 0, richness: 1 }, [b('Spaceship Factory', 9, 0), b('Spaceport', 9, 4)]);
    home.population = 1400;
    const sys = system('home', 30, 30, [home]);
    sys.asteroidBelt = generateSystemAsteroidBelt(5, sys);
    const deposits = sys.asteroidBelt.asteroids.filter((a) => a.rawMaterials > 0);
    expect(deposits.length).toBeGreaterThan(0);
    const data = { factions: f, starSystems: [sys], fleets: [] as Fleet[], shipStock: [] as FactionShipStock[], production: [] as FactionProduction[] };
    const view = { starSystems: data.starSystems, fleets: data.fleets };

    // 1. Queues one outpost ship (paid like the player's).
    mining.tick(EnemyMiningService.DECISION_INTERVAL, f[1], data, view);
    const orders = data.production.flatMap((p) => Object.values(p.ordersByPlanet).flat());
    expect(orders.map((o) => o.shipTypeId)).toEqual([OUTPOST_SHIP_TYPE]);
    const outpost = TestBed.inject(ShipService).getShipType(OUTPOST_SHIP_TYPE)!;
    expect(f[1].currencies['credits']).toBe(50000 - outpost.cost);
    expect(f[1].currencies['rawmaterials']).toBe(5000 - shipCost(outpost).rawmaterials);
    mining.tick(EnemyMiningService.DECISION_INTERVAL, f[1], data, view);
    expect(data.production.flatMap((p) => Object.values(p.ordersByPlanet).flat())).toHaveLength(1); // only one at a time

    // 2. Production completes; the ship is assembled at the Spaceport.
    for (let t = 0; t < 120; t++) production.tick(1, data, data.starSystems, data.fleets, f);
    mining.tick(EnemyMiningService.DECISION_INTERVAL, f[1], data, view);
    const fleet = data.fleets.find((x) => x.factionId === 'enemy1')!;
    expect(fleet).toBeDefined();
    expect(EnemyMiningService.isMiningFleet(fleet)).toBe(true);

    // 3. It sweeps the belt, surveying as it goes, and deploys on a deposit.
    let deployed = false;
    for (let t = 0; t < 3000 && !deployed; t++) {
      movement.updateFleets(data.fleets, data.starSystems, null, 'map', 0.5, () => {}, (id) => {
        const leaving = data.fleets.find((x) => x.id === id);
        if (leaving) leaving.system = null;
      });
      mining.tick(0.5, f[1], data, view);
      deployed = sys.asteroidBelt.asteroids.some((a) => a.miningStation?.factionId === 'enemy1');
    }
    expect(deployed).toBe(true);
    const station = sys.asteroidBelt.asteroids.find((a) => a.miningStation)!;
    expect(station.rawMaterials).toBeGreaterThan(0);
    expect(station.surveyedBy).toContain('enemy1');
    expect(station.surveyed).toBe(false); // the AI's survey is not the player's
    expect(fleet.destroyed).toBe(true); // the outpost ship was consumed
    expect(rawOutlook('enemy1', data.starSystems).extractionPerSecond).toBeGreaterThan(0);
  });

  it('builds no outpost ship while its raw supply is healthy, or when it cannot pay for one', () => {
    const mining = TestBed.inject(EnemyMiningService);
    mining.reset();
    const f = factions();
    f[1].currencies = { credits: 50000, rawmaterials: 5000, research: 0 };
    const healthy = miningPlanet(1, 'enemy1', { total: 60000, remaining: 60000, richness: 1 }, [b('Spaceship Factory', 9, 0), b('Spaceport', 9, 4)]);
    const sys = system('home', 30, 30, [healthy]);
    sys.asteroidBelt = generateSystemAsteroidBelt(5, sys);
    const data = { factions: f, starSystems: [sys], fleets: [] as Fleet[], shipStock: [] as FactionShipStock[], production: [] as FactionProduction[] };
    mining.tick(EnemyMiningService.DECISION_INTERVAL, f[1], data, data);
    expect(data.production).toHaveLength(0);

    healthy.rawDeposit!.remaining = 0;
    f[1].currencies = { credits: 50000, rawmaterials: 10, research: 0 };
    mining.tick(EnemyMiningService.DECISION_INTERVAL, f[1], data, data);
    expect(data.production.flatMap((p) => Object.values(p.ordersByPlanet).flat())).toHaveLength(0);
    expect(f[1].currencies).toEqual({ credits: 50000, rawmaterials: 10, research: 0 });
  });
});

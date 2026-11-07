import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import planetData from './planet-data.json';
import {
  CONSTRUCTION_SPEED_CONFIG,
  advanceBuildingConstruction,
  buildingConstructionProgress,
  cancelAllConstruction,
  cancelBuildingConstruction,
  constructionRefund,
  constructionSecondsFor,
  constructionSecondsLeft,
  constructionSites,
  isBuildingComplete,
  normalizeBuildingConstruction,
  operationalBuildings,
  planetConstructionSpeed,
  startBuildingConstruction,
  withConstructionComplete,
} from './building-construction';
import { Faction, PlanetBuilding, PlanetTile, StarSystem } from './star-map.models';
import { EconomyService } from '../../services/economy.service';
import { ResearchService } from '../../services/research.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { buildingCost } from '../../services/resource-cost';
import { checkBuildingPlacement, isBuildingLimitReached } from './building-placement';
import { hasTradingPost, ownsTradingPost } from './trade';
import { planetHasMine } from './raw-deposits';

/*
 * Planetary building construction (docs/planet-construction.md): durations,
 * the scaled clock (pause / speed), completion, the "no effect before
 * completion" rule for every consumer, speed modifiers, cancellation refunds,
 * ownership change and save/load.
 */

type Def = PlanetBuilding & {
  id: string; role: string; price: number; rawMaterialCost?: number; constructionSeconds?: number;
  maxPerPlanet?: number; requiresOreProximity?: boolean; autoPlaced?: boolean;
};
const DEFS = (planetData as unknown as { buildings: Def[] }).buildings;
const def = (id: string) => DEFS.find((d) => d.id === id)!;

const planet = (buildings: PlanetBuilding[] = [], overrides: Partial<PlanetTile> = {}): PlanetTile => ({
  id: 7,
  index: 0,
  name: 'Forge',
  factionId: 'player',
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'medium',
  population: 1000,
  satisfaction: 100,
  explored: true,
  buildings,
  ...overrides,
} as PlanetTile);

const done = (id: string, x: number, y = 0): PlanetBuilding => ({ name: def(id).name, size: def(id).size, x, y });
const system = (...planets: PlanetTile[]): StarSystem => ({ id: 'sys', name: 'Sys', planetsTiles: planets } as unknown as StarSystem);

const faction = (id = 'player', researched: string[] = []): Faction => ({
  id, name: id, color: '#fff', team: 1, ai: id !== 'player',
  currencies: { credits: 0, rawmaterials: 0, research: 0 },
  researchedTechnologies: researched,
} as Faction);

/* Places a paid site of `id` at (x, y). */
const site = (p: PlanetTile, id: string, x: number, y = 0): PlanetBuilding =>
  startBuildingConstruction(p, def(id), x, y, buildingCost(def(id)));

describe('building construction times', () => {
  it('every buildable building has its own construction time; colony cores are instant', () => {
    for (const d of DEFS) {
      if (d.autoPlaced) {
        expect(constructionSecondsFor(d), d.id).toBe(0);
      } else {
        expect(constructionSecondsFor(d), d.id).toBeGreaterThanOrEqual(15);
        expect(constructionSecondsFor(d), d.id).toBeLessThanOrEqual(300);
      }
    }
  });

  it('times differ within a category and grow with the building', () => {
    const byRole = new Map<string, number[]>();
    for (const d of DEFS.filter((b) => !b.autoPlaced)) byRole.set(d.role, [...(byRole.get(d.role) ?? []), d.constructionSeconds!]);
    for (const [role, times] of byRole) {
      if (times.length > 1) expect(new Set(times).size, role).toBeGreaterThan(1);
    }
    expect(def('small_residential').constructionSeconds!).toBeLessThan(def('medium_residential').constructionSeconds!);
    expect(def('medium_residential').constructionSeconds!).toBeLessThan(def('large_residential').constructionSeconds!);
    expect(def('solar_array').constructionSeconds!).toBeLessThan(def('fusion_plant').constructionSeconds!);
    expect(def('small_research_lab').constructionSeconds!).toBeLessThan(def('research_lab').constructionSeconds!);
  });
});

describe('construction sites', () => {
  it('a placed building is a site with its full time and the price paid', () => {
    const p = planet();
    const b = site(p, 'fusion_plant', 0);
    expect(p.buildings).toContain(b);
    expect(isBuildingComplete(b)).toBe(false);
    expect(b.constructionRemaining).toBe(def('fusion_plant').constructionSeconds);
    expect(b.constructionTotal).toBe(def('fusion_plant').constructionSeconds);
    expect(b.constructionPaid).toEqual(buildingCost(def('fusion_plant')));
    expect(buildingConstructionProgress(b)).toBe(0);
  });

  it('a building without construction time (colony core) is complete at once', () => {
    const p = planet();
    const core = startBuildingConstruction(p, def('colony_center'), 0, 0, { credits: 0, rawmaterials: 0 });
    expect(isBuildingComplete(core)).toBe(true);
    expect(core.constructionRemaining).toBeUndefined();
  });

  it('occupies its cells and counts toward the per-planet limit', () => {
    const p = planet();
    site(p, 'trading_post', 2, 2);
    expect(checkBuildingPlacement(p, 20, def('solar_array'), 2, 2)).not.toBeNull();
    expect(isBuildingLimitReached(p, def('trading_post'))).toBe(true);
  });
});

describe('construction clock', () => {
  const fullSpeed = () => 1;

  it('progresses with scaled game time, stops while paused and runs faster at higher game speed', () => {
    const p = planet();
    const b = site(p, 'solar_array', 0);
    const total = b.constructionRemaining!;
    advanceBuildingConstruction([system(p)], 0, fullSpeed);
    expect(b.constructionRemaining).toBe(total);
    advanceBuildingConstruction([system(p)], 5, fullSpeed);
    expect(b.constructionRemaining).toBeCloseTo(total - 5, 9);
    // Game speed 2× doubles the scaled delta GameTimeService hands out.
    advanceBuildingConstruction([system(p)], 5 * 2, fullSpeed);
    expect(b.constructionRemaining).toBeCloseTo(total - 15, 9);
  });

  it('completes after exactly its time, clears the construction state and reports it once', () => {
    const p = planet();
    const b = site(p, 'solar_array', 0);
    const total = b.constructionRemaining!;
    expect(advanceBuildingConstruction([system(p)], total - 1, fullSpeed)).toHaveLength(0);
    const completed = advanceBuildingConstruction([system(p)], 1, fullSpeed);
    expect(completed.map((c) => c.building)).toEqual([b]);
    expect(isBuildingComplete(b)).toBe(true);
    expect(b.constructionTotal).toBeUndefined();
    expect(b.constructionPaid).toBeUndefined();
    expect(advanceBuildingConstruction([system(p)], 10, fullSpeed)).toHaveLength(0);
  });

  it('many small steps equal one large step (frame-rate independent)', () => {
    const a = planet();
    const b = planet();
    const sa = site(a, 'fusion_plant', 0);
    const sb = site(b, 'fusion_plant', 0);
    for (let i = 0; i < 600; i++) advanceBuildingConstruction([system(a)], 1 / 60, fullSpeed);
    advanceBuildingConstruction([system(b)], 10, fullSpeed);
    expect(sa.constructionRemaining).toBeCloseTo(sb.constructionRemaining!, 6);
  });

  it('builds several sites of a planet in parallel', () => {
    const p = planet();
    const a = site(p, 'solar_array', 0);
    const b = site(p, 'small_residential', 4);
    advanceBuildingConstruction([system(p)], 10, fullSpeed);
    expect(a.constructionRemaining).toBe(def('solar_array').constructionSeconds! - 10);
    expect(b.constructionRemaining).toBe(def('small_residential').constructionSeconds! - 10);
  });

  it('the planet speed scales the work and the countdown', () => {
    const p = planet();
    const b = site(p, 'research_lab', 0);
    const total = b.constructionRemaining!;
    advanceBuildingConstruction([system(p)], 10, () => 2);
    expect(b.constructionRemaining).toBeCloseTo(total - 20, 9);
    expect(constructionSecondsLeft(b, 2)).toBe(Math.ceil((total - 20) / 2));
  });
});

describe('construction speed', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('the colony core sets the base: Capital faster than a Colony Center', () => {
    expect(planetConstructionSpeed(planet([done('capital', 0)]))).toBe(CONSTRUCTION_SPEED_CONFIG.coreSpeed['Capital']);
    expect(planetConstructionSpeed(planet([done('colony_center', 0)]))).toBe(1);
    expect(planetConstructionSpeed(planet([]))).toBe(1);
    expect(CONSTRUCTION_SPEED_CONFIG.coreSpeed['Capital']).toBeGreaterThan(1);
  });

  it('construction technologies add up and multiply with the core', () => {
    const research = TestBed.inject(ResearchService);
    const none = research.getModifiers(faction('player', ['basic_engineering'])).buildingConstructionSpeed;
    const one = research.getModifiers(faction('player', ['advanced_construction'])).buildingConstructionSpeed;
    const both = research.getModifiers(faction('player', ['advanced_construction', 'urban_infrastructure'])).buildingConstructionSpeed;
    expect(none).toBe(1);
    expect(one).toBeCloseTo(1.2, 9);
    expect(both).toBeCloseTo(1.4, 9);
    expect(planetConstructionSpeed(planet([done('capital', 0)]), both)).toBeCloseTo(1.25 * 1.4, 9);
  });
});

describe('no effect before completion', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('a site adds no energy, output, housing, workforce, comfort or upkeep; the finished building does', () => {
    const economy = TestBed.inject(EconomyService);
    const p = planet([done('capital', 0)]);
    const before = economy.calculatePlanetEconomy(p);
    const fusion = site(p, 'fusion_plant', 4);
    site(p, 'large_residential', 8);
    site(p, 'small_research_lab', 12);
    site(p, 'hospital', 14);
    const during = economy.calculatePlanetEconomy(p);
    expect(during.energyProduction).toBe(before.energyProduction);
    expect(during.energyConsumption).toBe(before.energyConsumption);
    expect(during.production['research'] ?? 0).toBe(before.production['research'] ?? 0);
    expect(during.workforceAvailable).toBe(before.workforceAvailable);
    expect(during.workforceRequired).toBe(before.workforceRequired);
    expect(during.comfortProvided).toBe(before.comfortProvided);
    expect(economy.getPopulationCapacity(p)).toBe(economy.getPopulationCapacity(planet([done('capital', 0)])));

    advanceBuildingConstruction([system(p)], 1000, () => 1);
    expect(isBuildingComplete(fusion)).toBe(true);
    const after = economy.calculatePlanetEconomy(p);
    expect(after.energyProduction).toBeGreaterThan(before.energyProduction);
    expect(after.production['research'] ?? 0).toBeGreaterThan(before.production['research'] ?? 0);
    expect(economy.getPopulationCapacity(p)).toBeGreaterThan(economy.getPopulationCapacity(planet([done('capital', 0)])));
  });

  it('sites pay no building upkeep until complete', () => {
    const economy = TestBed.inject(EconomyService);
    const p = planet([done('capital', 0)]);
    const systems = [system(p)];
    const owner = faction();
    const base = economy.calculateEconomy('player', [owner], systems, []).buildingUpkeepPerSecond;
    site(p, 'spaceport', 4);
    expect(economy.calculateEconomy('player', [owner], systems, []).buildingUpkeepPerSecond).toBe(base);
    advanceBuildingConstruction(systems, 1000, () => 1);
    expect(economy.calculateEconomy('player', [owner], systems, []).buildingUpkeepPerSecond).toBeGreaterThan(base);
  });

  it('factory, Spaceport, Trading Post, turrets, shield and mine only work once complete', () => {
    const production = TestBed.inject(ProductionService);
    const spaceports = TestBed.inject(SpaceportService);
    const battle = TestBed.inject(PlanetBattleService);
    const p = planet([done('capital', 0)]);
    const systems = [system(p)];
    site(p, 'spaceship_factory', 3);
    site(p, 'spaceport', 6);
    site(p, 'trading_post', 10);
    site(p, 'laser_turret', 12);
    site(p, 'planetary_shield', 13);
    site(p, 'mining_complex', 15);

    expect(production.getPlanetCapacity(p)).toBe(0);
    expect(spaceports.isSpaceportPlanet(p)).toBe(false);
    expect(hasTradingPost(p)).toBe(false);
    expect(ownsTradingPost('player', systems)).toBe(false);
    expect(battle.hasPlanetDefenses(p)).toBe(false);
    expect(planetHasMine(p)).toBe(false);

    advanceBuildingConstruction(systems, 1000, () => 1);
    expect(production.getPlanetCapacity(p)).toBeGreaterThan(0);
    expect(spaceports.isSpaceportPlanet(p)).toBe(true);
    expect(hasTradingPost(p)).toBe(true);
    expect(ownsTradingPost('player', systems)).toBe(true);
    expect(battle.hasPlanetDefenses(p)).toBe(true);
    expect(planetHasMine(p)).toBe(true);
  });

  it('the AI planning view counts sites as finished without touching the planet', () => {
    const p = planet([done('capital', 0)]);
    const s = site(p, 'fusion_plant', 4);
    const planned = withConstructionComplete(p);
    expect(operationalBuildings(planned)).toHaveLength(2);
    expect(operationalBuildings(p)).toHaveLength(1);
    expect(isBuildingComplete(s)).toBe(false);
  });
});

describe('cancellation and refunds', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('a fresh site refunds its full price; a half-built one half of it (rounded down)', () => {
    const p = planet();
    const owner = faction();
    const fresh = site(p, 'research_lab', 0);
    expect(constructionRefund(fresh)).toEqual(buildingCost(def('research_lab')));

    const half = site(p, 'spaceport', 4);
    half.constructionRemaining = half.constructionTotal! / 2;
    const refund = cancelBuildingConstruction(p, half, owner)!;
    expect(refund).toEqual({ credits: Math.floor(def('spaceport').price / 2), rawmaterials: Math.floor(def('spaceport').rawMaterialCost! / 2) });
    expect(owner.currencies).toMatchObject({ credits: refund.credits, rawmaterials: refund.rawmaterials });
    expect(p.buildings).not.toContain(half);
    expect(constructionSites(p)).toEqual([fresh]);
  });

  it('a complete building cannot be cancelled', () => {
    const p = planet([done('solar_array', 0)]);
    expect(cancelBuildingConstruction(p, p.buildings[0], faction())).toBeNull();
    expect(p.buildings).toHaveLength(1);
  });

  it('never refunds more than was paid', () => {
    const p = planet();
    const b = site(p, 'bank', 0);
    b.constructionRemaining = 10 * b.constructionTotal!;
    expect(constructionRefund(b).credits).toBeLessThanOrEqual(b.constructionPaid!.credits);
  });

  it('a planet changing hands cancels the loser’s sites and refunds the loser', () => {
    const ownership = TestBed.inject(PlanetOwnershipService);
    const loser = faction('player');
    const taker = faction('enemy1');
    const p = planet([done('colony_center', 0)]);
    site(p, 'fusion_plant', 4);
    ownership.transferPlanet({ factions: [loser, taker] }, p, 'enemy1', 'captured');
    expect(constructionSites(p)).toHaveLength(0);
    expect(loser.currencies['credits']).toBe(def('fusion_plant').price);
    expect(taker.currencies['credits']).toBe(0);
  });

  it('cancelAllConstruction without a payee just removes the sites', () => {
    const p = planet();
    site(p, 'solar_array', 0);
    site(p, 'solar_array', 3);
    expect(cancelAllConstruction(p, null)).toBe(2);
    expect(p.buildings).toHaveLength(0);
  });
});

describe('save / load', () => {
  it('a site survives a JSON round trip with its remaining time', () => {
    const p = planet();
    const b = site(p, 'research_lab', 0);
    advanceBuildingConstruction([system(p)], 33, () => 1);
    const loaded = JSON.parse(JSON.stringify([system(p)])) as StarSystem[];
    normalizeBuildingConstruction(loaded);
    const restored = loaded[0].planetsTiles[0].buildings[0];
    expect(restored.constructionRemaining).toBeCloseTo(b.constructionRemaining!, 9);
    expect(restored.constructionTotal).toBe(b.constructionTotal);
    expect(restored.constructionPaid).toEqual(b.constructionPaid);
    expect(buildingConstructionProgress(restored)).toBeCloseTo(buildingConstructionProgress(b), 9);
  });

  it('old saves (no construction fields) load as complete buildings', () => {
    const p = planet([done('fusion_plant', 0)]);
    normalizeBuildingConstruction([system(p)]);
    expect(isBuildingComplete(p.buildings[0])).toBe(true);
    expect(Object.keys(p.buildings[0]).sort()).toEqual(['name', 'size', 'x', 'y']);
  });

  it('malformed construction state is cleaned up instead of breaking the game', () => {
    const p = planet([
      { ...done('solar_array', 0), constructionRemaining: Number.NaN, constructionTotal: 40 },
      { ...done('bank', 3), constructionRemaining: -5 },
      { ...done('school', 6), constructionRemaining: 30, constructionTotal: 'x' as unknown as number, constructionPaid: { credits: -1 } as never },
    ]);
    normalizeBuildingConstruction([system(p)]);
    expect(isBuildingComplete(p.buildings[0])).toBe(true);
    expect(p.buildings[0].constructionTotal).toBeUndefined();
    expect(isBuildingComplete(p.buildings[1])).toBe(true);
    const school = p.buildings[2];
    expect(isBuildingComplete(school)).toBe(false);
    expect(school.constructionTotal).toBe(def('school').constructionSeconds);
    expect(school.constructionPaid).toBeUndefined();
    // Without a valid paid record the refund falls back to the list price share.
    expect(constructionRefund(school).credits).toBe(Math.floor(def('school').price * (30 / def('school').constructionSeconds!)));
  });
});

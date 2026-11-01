import { describe, it, expect } from 'vitest';
import planetData from './planet-data.json';
import { CAPITAL_ID, COLONY_CENTER, ensureColonyCore, hasColonyCore, isCoreBuildingName, isCoreOwner } from './colony-core';
import { PlanetTile } from './star-map.models';
import { encodeBlockedMask, getBlockedMask, getPlanetGridSize, isFootprintBlocked } from './planet-surface/planet-surface';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { ProductionService } from '../../services/production.service';
import { ShipService } from '../../services/ship.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { EconomyService } from '../../services/economy.service';
import { addPlayer, createDefaultNewGameConfig } from '../../services/new-game-config';

const planet = (overrides: Partial<PlanetTile> = {}): PlanetTile => ({
  id: 1,
  index: 0,
  name: 'P',
  factionId: 'player',
  x: 0,
  y: 0,
  type: 'earthlike',
  size: 'small', // 14×14 grid
  population: 0,
  buildings: [],
  explored: true,
  ...overrides,
} as PlanetTile);

const cores = (p: PlanetTile) => p.buildings.filter((b) => isCoreBuildingName(b.name));

describe('colony cores', () => {
  it('are defined in planet-data.json as free, auto-placed, one per planet', () => {
    const defs = (planetData as { buildings: { id: string; role: string; price: number; rawMaterialCost: number; maintenanceCost: number; autoPlaced?: boolean; maxPerPlanet?: number }[] }).buildings
      .filter((b) => b.role === 'core');
    expect(defs.map((b) => b.id).sort()).toEqual(['capital', 'colony_center']);
    for (const def of defs) {
      expect(def.price).toBe(0);
      expect(def.rawMaterialCost).toBe(0);
      expect(def.maintenanceCost).toBe(0);
      expect(def.autoPlaced).toBe(true);
      expect(def.maxPerPlanet).toBe(1);
    }
  });

  it('places a Colony Center in the middle of an empty grid', () => {
    const p = planet();
    expect(ensureColonyCore(p)).toBe(true);
    expect(cores(p)).toEqual([{ name: 'Colony Center', size: 2, x: 6, y: 6 }]);
  });

  it('is idempotent and never adds a second core', () => {
    const p = planet({ buildings: [{ name: 'Capital', size: 3, x: 0, y: 0 }] });
    expect(ensureColonyCore(p)).toBe(false);
    expect(ensureColonyCore(planet({ buildings: [] }), CAPITAL_ID)).toBe(true);
    expect(cores(p)).toHaveLength(1);
  });

  it('avoids existing buildings and deposit tiles', () => {
    const p = planet({
      buildings: [{ name: 'Large Residential Block', size: 3, x: 5, y: 5 }],
      resourceTiles: [{ x: 8, y: 6 }] as PlanetTile['resourceTiles'],
    });
    ensureColonyCore(p);
    const core = cores(p)[0];
    const overlaps = (x: number, y: number, size: number) =>
      core.x < x + size && core.x + core.size > x && core.y < y + size && core.y + core.size > y;
    expect(overlaps(5, 5, 3)).toBe(false);
    expect(overlaps(8, 6, 1)).toBe(false);
  });

  it('prefers buildable ground and clears terrain only when nothing else is free', () => {
    const n = getPlanetGridSize(planet());
    const mask = new Uint8Array(n * n);
    // Block a band through the center: the core goes next to it, terrain untouched.
    for (let y = 5; y < 9; y++) for (let x = 0; x < n; x++) mask[y * n + x] = 1;
    const surface = { version: 1, seed: 1, gridSize: n, intrusion: 1, blocked: encodeBlockedMask(mask, n) };
    const p = planet({ surface: { ...surface } });
    ensureColonyCore(p);
    const core = cores(p)[0];
    expect(isFootprintBlocked(p, core.x, core.y, core.size)).toBe(false);
    expect(p.surface!.blocked).toBe(surface.blocked);

    // Everything blocked: the central spot is cleared of terrain.
    const full = new Uint8Array(n * n).fill(1);
    const q = planet({ surface: { ...surface, blocked: encodeBlockedMask(full, n) } });
    expect(ensureColonyCore(q)).toBe(true);
    const qc = cores(q)[0];
    expect(isFootprintBlocked(q, qc.x, qc.y, qc.size)).toBe(false);
    expect(getBlockedMask(q)!.reduce((a, b) => a + b, 0)).toBe(n * n - COLONY_CENTER.size ** 2);
  });

  it('gives up only when the grid is completely built over', () => {
    const p = planet({ size: 'tiny' }); // 10×10
    p.buildings = [];
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) p.buildings.push({ name: 'Small Residential Block', size: 1, x, y });
    expect(ensureColonyCore(p)).toBe(false);
    expect(hasColonyCore(p)).toBe(false);
  });
});

describe('colony cores and ownership', () => {
  const ownership = () => new PlanetOwnershipService(new ProductionService(new ShipService(), new ShipStockService()));

  it('colonizing or capturing a planet without a core gives it a Colony Center', () => {
    const service = ownership();
    const colonized = planet({ factionId: '' });
    service.transferPlanet({}, colonized, 'player', 'colonized');
    expect(cores(colonized).map((b) => b.name)).toEqual(['Colony Center']);

    const civilization = planet({ factionId: 'independent', buildings: [{ name: 'Large Residential Block', size: 3, x: 5, y: 5 }] });
    service.transferPlanet({}, civilization, 'enemy1', 'battle_won');
    expect(cores(civilization)).toHaveLength(1);
  });

  it('a core stays through rebellion and recapture, and a captured Capital stays a Capital', () => {
    const service = ownership();
    const home = planet({ buildings: [{ name: 'Capital', size: 3, x: 5, y: 5 }] });
    service.transferPlanet({}, home, 'independent', 'rebellion');
    expect(cores(home).map((b) => b.name)).toEqual(['Capital']);
    service.transferPlanet({}, home, 'enemy1', 'captured');
    expect(cores(home).map((b) => b.name)).toEqual(['Capital']);
  });

  it('a rebel planet without a core does not get one', () => {
    const p = planet({ buildings: [] });
    ownership().transferPlanet({}, p, 'independent', 'rebellion');
    expect(hasColonyCore(p)).toBe(false);
  });
});

describe('colony cores in generated galaxies', () => {
  it('every faction planet starts with exactly one core; homeworlds with the Capital', () => {
    const economy = new EconomyService(new ShipService());
    let config = createDefaultNewGameConfig('small');
    while (config.players.length < 3) config = addPlayer(config);
    for (const seed of [11, 4242, 90001]) {
      const data = new GalaxyGeneratorService().generate(config, seed);
      for (const p of data.starSystems.flatMap((s) => s.planetsTiles)) {
        if (!isCoreOwner(p.factionId)) {
          expect(hasColonyCore(p), `planet ${p.id}`).toBe(false);
          continue;
        }
        expect(cores(p), `planet ${p.id}`).toHaveLength(1);
        expect(p.population).toBeLessThanOrEqual(economy.getPopulationCapacity(p));
      }
      for (const faction of data.factions.filter((f) => isCoreOwner(f.id))) {
        const owned = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
        if (owned.length === 0) continue;
        expect(owned.filter((p) => cores(p)[0]?.name === 'Capital'), faction.id).toHaveLength(1);
      }
    }
  });
});

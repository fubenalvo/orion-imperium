import { describe, expect, it } from 'vitest';
import { PlanetTile } from '../star-map.models';
import {
  centerOutPlacementOrder,
  decodeBlockedMask,
  encodeBlockedMask,
  getBlockedMask,
  getPlanetGridSize,
  isFootprintBlocked,
  isSurfaceCellBlocked,
  isWellFormedBlockedMask,
  legacyPlanetGridSize,
  planetSurfaceSeed,
} from './planet-surface';
import {
  centerLayout,
  computeBlockedMask,
  generatePlanetSurface,
  occupiedCells,
  pickResourceDeposits,
} from './planet-surface-generator';
import { PlanetSurfaceField, createSurfaceRng } from './planet-surface-field';
import { computeSettlementLayout } from './planet-settlement';

const TYPES = ['earthlike', 'marslike', 'venuslike', 'gasgiant', 'ice', 'desert'] as const;
const SIZES = ['tiny', 'small', 'medium', 'big', 'huge'] as const;

function planet(overrides: Partial<PlanetTile> = {}): PlanetTile {
  return {
    id: 1,
    index: 1,
    name: 'Test',
    factionId: 'player',
    x: 0,
    y: 0,
    type: 'earthlike',
    size: 'medium',
    population: 0,
    buildings: [],
    explored: true,
    resourceTiles: [],
    ...overrides,
  };
}

function blockedCount(p: PlanetTile): number {
  return getBlockedMask(p)!.reduce((sum, v) => sum + v, 0);
}

describe('planet surface grid', () => {
  it('doubles every size category and keeps their progression', () => {
    for (const size of SIZES) {
      expect(getPlanetGridSize({ size })).toBe(legacyPlanetGridSize({ size }) * 2);
    }
    expect(SIZES.map((size) => getPlanetGridSize({ size }))).toEqual([10, 14, 18, 22, 22]);
  });

  it('round-trips blocked masks for every grid size', () => {
    const rng = createSurfaceRng(99);
    for (const n of [10, 14, 18, 22]) {
      const mask = new Uint8Array(n * n).map(() => (rng() < 0.3 ? 1 : 0));
      const encoded = encodeBlockedMask(mask, n);
      expect(isWellFormedBlockedMask(encoded, n)).toBe(true);
      expect(Array.from(decodeBlockedMask(encoded, n))).toEqual(Array.from(mask));
    }
    expect(isWellFormedBlockedMask('zz', 10)).toBe(false);
  });

  it('ignores a surface generated for a different grid size', () => {
    const p = planet({ size: 'tiny' });
    const mask = new Uint8Array(18 * 18).fill(1);
    p.surface = { version: 1, seed: 1, gridSize: 18, intrusion: 1, blocked: encodeBlockedMask(mask, 18) };
    expect(getBlockedMask(p)).toBeNull();
    expect(isFootprintBlocked(p, 0, 0, 3)).toBe(false);
  });

  it('checks every cell of a footprint against the mask', () => {
    const p = planet({ size: 'tiny' });
    const mask = new Uint8Array(100);
    mask[5 * 10 + 6] = 1;
    p.surface = { version: 1, seed: 1, gridSize: 10, intrusion: 1, blocked: encodeBlockedMask(mask, 10) };
    expect(isSurfaceCellBlocked(p, 6, 5)).toBe(true);
    expect(isFootprintBlocked(p, 4, 4, 3)).toBe(true);
    expect(isFootprintBlocked(p, 4, 4, 2)).toBe(false);
  });

  it('orders placements from the center outward, covering every position once', () => {
    const order = centerOutPlacementOrder(10, 2);
    expect(order[0]).toEqual({ x: 4, y: 4 });
    expect(new Set(order.map((p) => `${p.x},${p.y}`)).size).toBe(81);
  });

  it('derives distinct, stable seeds per planet', () => {
    expect(planetSurfaceSeed(5, 1)).toBe(planetSurfaceSeed(5, 1));
    expect(planetSurfaceSeed(5, 1)).not.toBe(planetSurfaceSeed(5, 2));
    expect(planetSurfaceSeed(5, 1)).not.toBe(planetSurfaceSeed(6, 1));
  });
});

describe('planet surface generator', () => {
  it('is deterministic', () => {
    const a = generatePlanetSurface(planet({ id: 12, type: 'marslike', size: 'big' }), 77);
    const b = generatePlanetSurface(planet({ id: 12, type: 'marslike', size: 'big' }), 77);
    expect(a).toEqual(b);
    expect(a.gridSize).toBe(22);
  });

  it('keeps blocked terrain within budget and never reaches the grid core', () => {
    for (let id = 1; id <= 120; id++) {
      const p = planet({ id, type: TYPES[id % TYPES.length], size: SIZES[id % SIZES.length] });
      p.surface = generatePlanetSurface(p, 4242);
      const n = getPlanetGridSize(p);
      expect(blockedCount(p)).toBeLessThanOrEqual(n * n * 0.2);
      const field = new PlanetSurfaceField(p.surface.seed, p.type, n, undefined, p.surface.intrusion);
      const mask = getBlockedMask(p)!;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const depth = -field.gridDistance(field.margin + x + 0.5, field.margin + y + 0.5);
          if (mask[y * n + x]) expect(depth).toBeLessThanOrEqual(field.maxReach() + 0.75);
        }
      }
    }
  });

  it('frames most planets with obstacles that cut into the grid', () => {
    let withObstacles = 0;
    for (let id = 1; id <= 60; id++) {
      const p = planet({ id, type: TYPES[id % TYPES.length], size: SIZES[id % SIZES.length] });
      p.surface = generatePlanetSurface(p, 9);
      if (blockedCount(p) > 0) withObstacles++;
    }
    expect(withObstacles).toBeGreaterThan(40);
  });

  it('never blocks cells under existing buildings or deposits', () => {
    for (let id = 1; id <= 60; id++) {
      const n = getPlanetGridSize({ size: SIZES[id % SIZES.length] });
      // A ring of 1×1 buildings along the whole grid border, where terrain
      // is most likely, plus a deposit in a corner.
      const buildings = [];
      for (let k = 0; k < n; k++) {
        buildings.push({ name: 'Laser Turret', size: 1, x: k, y: 0 }, { name: 'Laser Turret', size: 1, x: k, y: n - 1 });
      }
      const p = planet({
        id,
        type: TYPES[id % TYPES.length],
        size: SIZES[id % SIZES.length],
        buildings,
        resourceTiles: [{ type: 'rawmaterial', x: 0, y: 5 }],
      });
      p.surface = generatePlanetSurface(p, 31337);
      for (const b of p.buildings) expect(isFootprintBlocked(p, b.x, b.y, b.size)).toBe(false);
      expect(isSurfaceCellBlocked(p, 0, 5)).toBe(false);
    }
  });

  it('returns an empty mask when intrusions are disabled', () => {
    const field = new PlanetSurfaceField(1, 'earthlike', 14, undefined, 0);
    expect(computeBlockedMask(field, new Set()).every((v) => v === 0)).toBe(true);
  });

  it('centers a template layout on the grid', () => {
    const layout = centerLayout(
      [
        { name: 'A', size: 3, x: 0, y: 0 },
        { name: 'B', size: 2, x: 3, y: 1 },
      ],
      18,
    );
    // Template spans 5×3 → offset (6, 7).
    expect(layout.map((b) => [b.x, b.y])).toEqual([
      [6, 7],
      [9, 8],
    ]);
  });

  it('places deposits on free, buildable ground', () => {
    for (let id = 1; id <= 60; id++) {
      const p = planet({ id, type: TYPES[id % TYPES.length], size: SIZES[id % SIZES.length] });
      p.buildings = centerLayout([{ name: 'Large Residential Block', size: 3, x: 0, y: 0 }], getPlanetGridSize(p));
      p.surface = generatePlanetSurface(p, 5);
      const deposits = pickResourceDeposits(p, getPlanetGridSize(p), createSurfaceRng(id));
      expect(deposits.length).toBeGreaterThan(0);
      const occupied = occupiedCells({ ...p, resourceTiles: [] });
      for (const d of deposits) {
        expect(isSurfaceCellBlocked(p, d.x, d.y)).toBe(false);
        expect(occupied.has(d.y * getPlanetGridSize(p) + d.x)).toBe(false);
      }
    }
  });
});

describe('settlement layout', () => {
  /* Union-find over street lattice nodes, to check the network is connected. */
  function components(streets: string, side: number, margin: number): (node: number) => number {
    const parent = Array.from({ length: side * side }, (_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    const re = /M(\d+) (\d+)([HV])(\d+)/g;
    for (const match of streets.matchAll(re)) {
      const x = Number(match[1]) - margin;
      const y = Number(match[2]) - margin;
      const end = Number(match[4]) - margin;
      for (let k = match[3] === 'H' ? x : y; k < end; k++) {
        const a = match[3] === 'H' ? y * side + k : k * side + x;
        const b = match[3] === 'H' ? y * side + k + 1 : (k + 1) * side + x;
        parent[find(a)] = find(b);
      }
    }
    return find;
  }

  it('connects every building into one street network', () => {
    const n = 18;
    const buildings = [
      { name: 'A', size: 3, x: 2, y: 2 },
      { name: 'B', size: 2, x: 12, y: 3 },
      { name: 'C', size: 1, x: 8, y: 14 },
      { name: 'D', size: 4, x: 11, y: 11 },
    ];
    const layout = computeSettlementLayout(buildings, n, null, 14);
    const find = components(layout.streets, n + 1, 14);
    // Lattice components touched by each building's perimeter nodes; one
    // component must be shared by all of them.
    const reach = (b: (typeof buildings)[number]) => {
      const nodes: number[] = [];
      for (let k = 0; k <= b.size; k++) {
        nodes.push(b.y * (n + 1) + b.x + k, (b.y + b.size) * (n + 1) + b.x + k);
        nodes.push((b.y + k) * (n + 1) + b.x, (b.y + k) * (n + 1) + b.x + b.size);
      }
      return new Set(nodes.map(find));
    };
    const shared = [...reach(buildings[0])].filter((root) => buildings.every((b) => reach(b).has(root)));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('never routes streets through a building or across fully blocked terrain', () => {
    const n = 10;
    const mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < 3; x++) mask[y * n + x] = 1;
    const buildings = [
      { name: 'A', size: 3, x: 4, y: 1 },
      { name: 'B', size: 2, x: 6, y: 7 },
    ];
    const layout = computeSettlementLayout(buildings, n, mask, 0);
    for (const match of layout.streets.matchAll(/M(\d+) (\d+)([HV])(\d+)/g)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      const end = Number(match[4]);
      for (let k = match[3] === 'H' ? x : y; k < end; k++) {
        // Cells on both sides of this unit edge.
        const [ax, ay, bx, by] = match[3] === 'H' ? [k, y - 1, k, y] : [x - 1, k, x, k];
        const open = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < n && cy < n && !mask[cy * n + cx];
        expect(open(ax, ay) || open(bx, by)).toBe(true);
        const inside = (cx: number, cy: number) =>
          buildings.findIndex((b) => cx >= b.x && cx < b.x + b.size && cy >= b.y && cy < b.y + b.size);
        const owner = inside(ax, ay);
        expect(owner >= 0 && owner === inside(bx, by)).toBe(false);
      }
    }
  });

  it('is empty without buildings', () => {
    expect(computeSettlementLayout([], 10, null, 14)).toEqual({ streets: '', accessRoads: [], plots: [], lights: [] });
  });
});

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Fleet, PlanetTile, StarMapData, StarSystem } from './star-map.models';
import {
  SYSTEM_ASTEROID_CONFIG,
  ensureSystemAsteroidBelts,
  generateSystemAsteroidBelt,
  surveySystemAsteroids,
} from './system-asteroids';
import {
  SYSTEM_GRID_COLUMNS,
  SYSTEM_GRID_ROWS,
  planetFootprintCenterVw,
  planetFootprintOrigin,
  systemCellCenterVw,
} from './system-grid';
import { StarMapMovementService } from './star-map-movement.service';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION } from '../../services/save-validation';

/*
 * In-system asteroid belts and the doubled system grid
 * (system-asteroids.ts, system-grid.ts).
 */

const LAYOUT = [
  { x: 23, y: 5 },
  { x: 19, y: 9 },
  { x: 15, y: 7 },
  { x: 11, y: 3 },
  { x: 7, y: 11 },
  { x: 3, y: 5 },
];

function planet(index: number, pos = LAYOUT[index - 1]): PlanetTile {
  return {
    id: 100 + index,
    index,
    name: `P${index}`,
    factionId: 'unhabited',
    x: pos.x,
    y: pos.y,
    type: 'earthlike',
    size: 'medium',
    population: 0,
    buildings: [],
    explored: false,
  };
}

function system(id: string, planetCount: number): StarSystem {
  const planetsTiles = Array.from({ length: planetCount }, (_, i) => planet(i + 1));
  return { id, name: id.toUpperCase(), x: 10, y: 10, planets: planetCount, color: '#fff', planetsTiles };
}

function fleetAt(id: number, factionId: string, systemId: string, x: number, y: number): Fleet {
  return {
    id,
    name: `F${id}`,
    factionId,
    x: 10,
    y: 10,
    targetX: null,
    targetY: null,
    speed: 4,
    system: { id: systemId, x, y, targetX: null, targetY: null },
    ships: [{ id: id * 10, name: 's', type: 'scout' }],
  } as Fleet;
}

describe('system grid', () => {
  it('keeps every planet at its old screen position after the grid doubled', () => {
    const legacy = [
      { x: 12, y: 3 },
      { x: 10, y: 5 },
      { x: 8, y: 4 },
      { x: 6, y: 2 },
      { x: 4, y: 6 },
      { x: 2, y: 3 },
    ];
    legacy.forEach((old, i) => {
      const center = planetFootprintCenterVw(planet(i + 1));
      expect(center).toEqual({ x: (old.x - 0.5) * 5, y: (old.y - 0.5) * 5 });
    });
  });

  it('treats all four footprint cells as the planet', () => {
    const movement = new StarMapMovementService();
    const p = planet(1);
    const hits: string[] = [];
    for (let c = p.x - 1; c <= p.x + 2; c++) {
      for (let r = p.y - 1; r <= p.y + 2; r++) {
        if (movement.isSystemCellOnPlanet(p, c, r)) hits.push(`${c},${r}`);
      }
    }
    expect(hits.sort()).toEqual(['23,5', '23,6', '24,5', '24,6']);
    // A fleet ordered onto the planet stops on its center, which is on the footprint.
    const center = movement.getPlanetCellCenter(p);
    expect(movement.isSystemPointOnPlanet(p, center.x, center.y)).toBe(true);
  });
});

describe('system asteroid belts', () => {
  it('is deterministic for the same seed and system', () => {
    const a = generateSystemAsteroidBelt(42, system('vega', 4));
    const b = generateSystemAsteroidBelt(42, system('vega', 4));
    expect(a).toEqual(b);
    expect(generateSystemAsteroidBelt(43, system('vega', 4))).not.toEqual(a);
  });

  it('places a belt in every system, inside the grid and clear of planets', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (let count = 1; count <= 6; count++) {
        const sys = system(`s${seed}-${count}`, count);
        const belt = generateSystemAsteroidBelt(seed, sys);
        expect(belt.asteroids.length).toBeGreaterThan(0);
        const cells = new Set<string>();
        for (const a of belt.asteroids) {
          expect(a.col).toBeGreaterThanOrEqual(1);
          expect(a.col).toBeLessThanOrEqual(SYSTEM_GRID_COLUMNS);
          expect(a.row).toBeGreaterThanOrEqual(1);
          expect(a.row).toBeLessThanOrEqual(SYSTEM_GRID_ROWS);
          expect(a.surveyed).toBe(false);
          cells.add(`${a.col},${a.row}`);
          for (const p of sys.planetsTiles) {
            const o = planetFootprintOrigin(p);
            const nearPlanet = a.col >= o.col - 1 && a.col <= o.col + 2 && a.row >= o.row - 1 && a.row <= o.row + 2;
            expect(nearPlanet).toBe(false);
          }
        }
        expect(cells.size).toBe(belt.asteroids.length);
      }
    }
  });

  it('forms a ring around the star (every asteroid near the belt line)', () => {
    const belt = generateSystemAsteroidBelt(7, system('ring', 3));
    for (const a of belt.asteroids) {
      const c = systemCellCenterVw(a.col, a.row);
      const d = Math.hypot(c.x - 95, c.y - 17.5);
      expect(Math.abs(d - belt.radiusVw)).toBeLessThanOrEqual(SYSTEM_ASTEROID_CONFIG.halfWidthVw * 1.25 + 0.01);
    }
  });

  it('gives one asteroid in ten (at least one) a large deposit', () => {
    let total = 0;
    let rich = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const belt = generateSystemAsteroidBelt(seed, system(`r${seed}`, 1 + (seed % 6)));
      const deposits = belt.asteroids.filter((a) => a.rawMaterials > 0);
      expect(deposits.length).toBe(Math.max(1, Math.round(belt.asteroids.length * 0.1)));
      for (const d of deposits) {
        expect(d.rawMaterials).toBeGreaterThanOrEqual(SYSTEM_ASTEROID_CONFIG.richRawMaterials.min);
        expect(d.rawMaterials).toBeLessThanOrEqual(SYSTEM_ASTEROID_CONFIG.richRawMaterials.max);
      }
      total += belt.asteroids.length;
      rich += deposits.length;
    }
    expect(rich / total).toBeGreaterThan(0.07);
    expect(rich / total).toBeLessThan(0.15);
  });

  it('ensureSystemAsteroidBelts keeps existing belts and their survey state', () => {
    const sys = system('keep', 2);
    ensureSystemAsteroidBelts([sys], 5);
    const belt = sys.asteroidBelt!;
    belt.asteroids[0].surveyed = true;
    ensureSystemAsteroidBelts([sys], 999);
    expect(sys.asteroidBelt).toBe(belt);
    expect(sys.asteroidBelt!.asteroids[0].surveyed).toBe(true);
  });
});

describe('asteroid survey', () => {
  const setup = () => {
    const sys = system('vega', 3);
    ensureSystemAsteroidBelts([sys], 11);
    const belt = sys.asteroidBelt!;
    const rich = belt.asteroids.find((a) => a.rawMaterials > 0)!;
    const barren = belt.asteroids.find((a) => a.rawMaterials === 0)!;
    return { sys, rich, barren };
  };

  it('surveys the asteroid under a player fleet exactly once', () => {
    const { sys, rich } = setup();
    const at = systemCellCenterVw(rich.col, rich.row);
    const fleets = [fleetAt(1, 'player', sys.id, at.x, at.y)];

    const first = surveySystemAsteroids(fleets, [sys]);
    expect(first.map((r) => r.asteroid)).toEqual([rich]);
    expect(rich.surveyed).toBe(true);
    expect(surveySystemAsteroids(fleets, [sys])).toEqual([]);
  });

  it('counts a fleet flying through the cell (no stop needed)', () => {
    const { sys, barren } = setup();
    const at = systemCellCenterVw(barren.col, barren.row);
    const moving = fleetAt(1, 'player', sys.id, at.x, at.y);
    moving.system!.targetX = 0;
    moving.system!.targetY = 0;
    expect(surveySystemAsteroids([moving], [sys]).length).toBe(1);
    expect(barren.surveyed).toBe(true);
  });

  it('ignores AI fleets, destroyed fleets and fleets in other systems', () => {
    const { sys, rich } = setup();
    const at = systemCellCenterVw(rich.col, rich.row);
    const ai = fleetAt(1, 'enemy1', sys.id, at.x, at.y);
    const dead = { ...fleetAt(2, 'player', sys.id, at.x, at.y), destroyed: true };
    const elsewhere = fleetAt(3, 'player', 'other', at.x, at.y);
    expect(surveySystemAsteroids([ai, dead, elsewhere], [sys])).toEqual([]);
    expect(rich.surveyed).toBe(false);
  });
});

describe('save migration v8', () => {
  const legacySave = (): StarMapData =>
    ({
      saveVersion: 7,
      factions: [{ id: 'player', name: 'P', color: '#fff', team: 1, currencies: {} }],
      map: { width: 60, height: 40, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [
        {
          ...system('old', 2),
          planetsTiles: [planet(1, { x: 12, y: 3 }), planet(2, { x: 10, y: 5 })],
        },
      ],
      fleets: [],
    }) as unknown as StarMapData;

  it('converts planet positions to the doubled grid once and adds belts', () => {
    const saves = TestBed.inject(SaveGameService);
    const migrated = saves.migrateSave(legacySave());
    const planets = migrated.starSystems[0].planetsTiles;
    expect(planets.map((p) => [p.x, p.y])).toEqual([
      [23, 5],
      [19, 9],
    ]);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.starSystems[0].asteroidBelt?.asteroids.length).toBeGreaterThan(0);

    // Idempotent: a second pass changes nothing.
    const again = saves.migrateSave(structuredClone(migrated));
    expect(again.starSystems[0].planetsTiles.map((p) => [p.x, p.y])).toEqual([
      [23, 5],
      [19, 9],
    ]);
    expect(again.starSystems[0].asteroidBelt).toEqual(migrated.starSystems[0].asteroidBelt);
  });
});

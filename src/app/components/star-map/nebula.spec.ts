import { TestBed } from '@angular/core/testing';
import {
  NEBULA_CONFIG,
  NebulaField,
  generateNebulae,
  isPointInNebula,
  isWellFormedNebula,
  nebulaOuterRadius,
  nebulaRadiusAt,
} from './nebula';
import { createMulberry32 } from './star-map-resources.util';
import { Faction, Fleet, Nebula } from './star-map.models';
import { StarMapTerrainService } from './star-map-terrain.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapSensorService } from './star-map-sensor.service';
import { EnemyIntelService } from './enemy-intel.service';
import { GameSettingsService } from '../../services/game-settings.service';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { validateGeneratedGalaxy } from '../../services/galaxy-validation';
import { NewGameConfig } from '../../services/new-game.models';

/* A round nebula (all lobes 1) makes distances in tests exact. */
const roundNebula = (x: number, y: number, radius: number, id = 1): Nebula => ({
  id,
  x,
  y,
  radius,
  lobes: [1, 1, 1, 1, 1, 1],
  rotation: 0,
  color: '#7c5cd6',
});

describe('nebula generation', () => {
  const homes = [
    { x: 30, y: 30 },
    { x: 150, y: 80 },
  ];
  const obstacles = [{ x: 90.5, y: 54.5, radius: 4 }];
  const generate = (seed: number) =>
    generateNebulae(createMulberry32(seed), {
      width: 180,
      height: 108,
      count: 4,
      homes,
      obstacles,
    });

  it('creates several valid, irregular nebulae inside the map', () => {
    const nebulae = generate(42);
    expect(nebulae.length).toBeGreaterThanOrEqual(3);
    for (const n of nebulae) {
      expect(isWellFormedNebula(n)).toBe(true);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThanOrEqual(180);
      expect(n.y).toBeLessThanOrEqual(108);
      // Irregular: the edge distance varies around the cloud.
      const radii = Array.from({ length: 24 }, (_, i) => nebulaRadiusAt(n, (i / 24) * Math.PI * 2));
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(n.radius * 0.1);
    }
    // Not copies of one shape.
    expect(new Set(nebulae.map((n) => n.lobes.join(','))).size).toBe(nebulae.length);
  });

  it('never covers a home system or the black hole', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      for (const n of generate(seed)) {
        for (const home of homes) {
          expect(isPointInNebula(n, home.x, home.y)).toBe(false);
          expect(Math.hypot(home.x - n.x, home.y - n.y)).toBeGreaterThan(nebulaOuterRadius(n));
        }
        expect(Math.hypot(obstacles[0].x - n.x, obstacles[0].y - n.y)).toBeGreaterThan(
          nebulaOuterRadius(n) + obstacles[0].radius,
        );
      }
    }
  });

  it('spreads nebulae across the map instead of one cluster', () => {
    const nebulae = generate(7);
    const xs = nebulae.map((n) => n.x);
    const ys = nebulae.map((n) => n.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(180 * 0.3);
    expect(Math.max(...ys) - Math.min(...ys) + Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
      80,
    );
  });

  it('is reproducible for the same seed', () => {
    expect(generate(2024)).toEqual(generate(2024));
    expect(generate(2024)).not.toEqual(generate(2025));
  });

  it('is part of New Game generation, validated and not dependent on load', () => {
    TestBed.configureTestingModule({});
    const generator = TestBed.inject(GalaxyGeneratorService);
    const config: NewGameConfig = {
      galaxySize: 'small',
      seed: 77,
      players: [
        { name: 'Human', color: '#8cc4ff', controller: 'human', difficulty: 'normal' },
        { name: 'Bot', color: '#d65757', controller: 'ai', difficulty: 'normal' },
      ],
    };
    const data = generator.generate(config, 77);
    expect(data.nebulae!.length).toBeGreaterThanOrEqual(2);
    expect(validateGeneratedGalaxy(data, config).errors).toEqual([]);
    expect(generator.generate(config, 77).nebulae).toEqual(data.nebulae);
    // A JSON round trip (save/load) keeps the exact same clouds.
    expect(JSON.parse(JSON.stringify(data)).nebulae).toEqual(data.nebulae);
  });

  it('reliably produces several valid nebulae for every galaxy size', () => {
    TestBed.configureTestingModule({});
    const generator = TestBed.inject(GalaxyGeneratorService);
    for (const galaxySize of ['small', 'medium', 'large'] as const) {
      const config: NewGameConfig = {
        galaxySize,
        players: [
          { name: 'Human', color: '#8cc4ff', controller: 'human', difficulty: 'normal' },
          { name: 'Bot A', color: '#d65757', controller: 'ai', difficulty: 'normal' },
          { name: 'Bot B', color: '#39b8a8', controller: 'ai', difficulty: 'hard' },
        ],
      };
      for (let seed = 1; seed <= 40; seed++) {
        let data;
        try {
          data = generator.generate(config, seed);
        } catch {
          continue; // Layout failures are retried by NewGameService; not a nebula concern.
        }
        expect(data.nebulae!.length).toBeGreaterThanOrEqual(2);
        expect(
          validateGeneratedGalaxy(data, config).errors.filter((e) => e.includes('nebula')),
        ).toEqual([]);
      }
    }
  });
});

describe('nebula movement penalty', () => {
  let movement: StarMapMovementService;
  let terrain: StarMapTerrainService;

  const fleet = (x: number, targetX: number): Fleet => ({
    id: 1,
    name: 'F',
    factionId: 'player',
    x,
    y: 50,
    targetX,
    targetY: 50,
    speed: 8,
    system: null,
    ships: [],
  });

  const timeToArrive = (f: Fleet): number => {
    const dt = 0.05;
    let t = 0;
    while (f.targetX !== null && t < 10_000) {
      movement.updateFleets(
        [f],
        [],
        null,
        'map',
        dt,
        () => {},
        () => {},
      );
      t += dt;
    }
    return t;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    terrain = TestBed.inject(StarMapTerrainService);
    movement = TestBed.inject(StarMapMovementService);
    movement.initialize(2, 2, 200, 100);
  });

  it('slows a fleet only for the distance flown inside the nebula', () => {
    // 60-cell trip at 0.4 cells/s; 20 cells (x 70..90) are inside the nebula.
    terrain.configure({ nebulae: [roundNebula(80, 50, 10)], width: 200, height: 100 });
    const open = 40 / 0.4;
    const inside = 20 / (0.4 * NEBULA_CONFIG.speedMultiplier);
    const t = timeToArrive(fleet(50, 110));
    expect(t).toBeGreaterThan(open + inside - 1.5);
    expect(t).toBeLessThan(open + inside + 1.5);
  });

  it('matches the ETA shown to the player', () => {
    terrain.configure({ nebulae: [roundNebula(80, 50, 10)], width: 200, height: 100 });
    const f = fleet(50, 110);
    const eta = movement.estimateRemainingTravelSeconds(f)!;
    expect(timeToArrive(f)).toBeCloseTo(eta, 0);
  });

  it('does not multiply the penalty for overlapping nebulae', () => {
    terrain.configure({
      nebulae: [roundNebula(80, 50, 10, 1), roundNebula(80, 50, 10, 2)],
      width: 200,
      height: 100,
    });
    const doubled = timeToArrive(fleet(50, 110));
    terrain.configure({ nebulae: [roundNebula(80, 50, 10)], width: 200, height: 100 });
    expect(timeToArrive(fleet(50, 110))).toBeCloseTo(doubled, 1);
  });

  it('keeps open-space movement unchanged', () => {
    terrain.configure({ nebulae: [roundNebula(80, 50, 10)], width: 200, height: 100 });
    const f: Fleet = { ...fleet(10, 30), y: 10, targetY: 10 };
    expect(timeToArrive(f)).toBeCloseTo(20 / 0.4, 0);
  });

  it('integrates the slowdown in the travel estimate proportionally', () => {
    const field = new NebulaField([roundNebula(80, 50, 10)], 200, 100);
    const half = field.legTravelSeconds({ x: 70, y: 50 }, { x: 80, y: 50 }, 1);
    const full = field.legTravelSeconds({ x: 70, y: 50 }, { x: 90, y: 50 }, 1);
    expect(full).toBeCloseTo(2 * half, 1);
    expect(full).toBeCloseTo(20 / NEBULA_CONFIG.speedMultiplier, 0);
  });
});

describe('nebula sensor penalty (player and AI)', () => {
  let terrain: StarMapTerrainService;
  let sensors: StarMapSensorService;

  const factions: Faction[] = [
    { id: 'player', name: 'P', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    {
      id: 'enemy1',
      name: 'E',
      color: '#d65757',
      team: 2,
      ai: true,
      aiDifficulty: 'normal',
      currencies: {},
    },
  ];
  const fleetAt = (id: number, factionId: string, x: number, y: number): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    sensorRange: 10,
    ships: [{ id, name: 's', type: 'fighter' }],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    terrain = TestBed.inject(StarMapTerrainService);
    sensors = TestBed.inject(StarMapSensorService);
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(true);
    // Nebula covering x 60..80 around y 50.
    terrain.configure({ nebulae: [roundNebula(70, 50, 10)], width: 200, height: 100 });
  });

  it('a source outside cannot see deep into a nebula at normal range', () => {
    const source = { x: 52, y: 50, r: 10 };
    expect(sensors.isGalaxyCellSensed(42, 50, source)).toBe(true); // 10 cells, open space
    expect(sensors.isGalaxyCellSensed(62, 50, source)).toBe(false); // 10 cells, inside the nebula
    expect(sensors.isGalaxyCellSensed(57, 50, source)).toBe(true); // 5 cells, outside
    expect(sensors.isGalaxyCellSensed(61, 50, source)).toBe(false); // 9 > 10 × 0.6
    expect(sensors.isGalaxyCellSensed(60, 50, source)).toBe(false); // nebula edge cell: 8 > 6
  });

  it('a fleet inside a nebula has a reduced sensor range in every direction', () => {
    const player = fleetAt(1, 'player', 70, 50);
    const layer = sensors.computeGalaxySensorCells([player], [], factions, 200, 100);
    const range = sensors.getFleetSensorRange(player, factions[0]);
    expect(layer.cells.has(`70-${50 + Math.floor(range * NEBULA_CONFIG.sensorMultiplier)}`)).toBe(
      true,
    );
    expect(
      layer.cells.has(`70-${50 + Math.floor(range * NEBULA_CONFIG.sensorMultiplier) + 1}`),
    ).toBe(false);
    // Same fleet in open space sees its full range.
    const open = sensors.computeGalaxySensorCells(
      [fleetAt(1, 'player', 150, 50)],
      [],
      factions,
      200,
      100,
    );
    expect(open.cells.has(`150-${50 + range}`)).toBe(true);
  });

  it('applies the same rule to the AI fog of war', () => {
    const intel = TestBed.inject(EnemyIntelService);
    const aiScout = fleetAt(10, 'enemy1', 52, 50);
    const hiddenPlayer = fleetAt(1, 'player', 63, 50); // 11 cells away, inside the nebula
    const openPlayer = fleetAt(2, 'player', 41, 50); // 11 cells away, open space... beyond 10
    const nearPlayer = fleetAt(3, 'player', 43, 50); // 9 cells, open space
    intel.tick(1, factions[1], factions, [], [aiScout, hiddenPlayer, openPlayer, nearPlayer]);

    expect(intel.isVisible('enemy1', 3)).toBe(true);
    expect(intel.isVisible('enemy1', 1)).toBe(false);
    expect(intel.isPointSensed('enemy1', 43, 50)).toBe(true);
    expect(intel.isPointSensed('enemy1', 61, 50)).toBe(false);
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { DriftingAsteroidService } from './drifting-asteroid.service';
import { buildNavObstacles, distance } from './fleet-navigation';
import { isPointInAnyNebula } from './nebula';
import { beltAxisDistance, beltNavigationRadius } from './asteroid-belts';
import { StarMapTerrainService } from './star-map-terrain.service';
import { ASTEROID_CONFIG } from './drifting-asteroids';
import { DriftingAsteroid } from './star-map.models';

/*
 * StarMap-level integration of the galaxy terrain features
 * (docs/star-map-terrain.md): player feedback for blocked moves, black hole
 * avoidance in the real game loop, and save/load of nebulae and asteroids.
 */
describe('StarMap terrain integration', () => {
  const SLOT = 1;

  const createStarMap = (): StarMap => {
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };

  const run = (map: StarMap, seconds: number, dt = 0.1): void => {
    for (let t = 0; t < seconds; t += dt) {
      map['gameLoopCallback'](dt);
    }
  };

  const startGame = (): StarMap => {
    TestBed.inject(NewGameService).startNewGame(
      { ...createDefaultNewGameConfig('small'), seed: 2026 },
      SLOT,
    );
    const map = createStarMap();
    map.currentView = 'map';
    return map;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [
        {
          provide: StarMapGameLoopService,
          useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() },
        },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('rejects a player move into the black hole with feedback and keeps the fleet in place', () => {
    const map = startGame();
    const [hole] = buildNavObstacles(map.specialObjects);
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    const start = { x: fleet.x, y: fleet.y };
    map.selectFleet(fleet);

    map.moveSelectedFleet(Math.round(hole.x), Math.round(hole.y));

    expect(map.fleetMoveError).toContain('black hole');
    expect(fleet.targetX).toBeNull();
    run(map, 2);
    expect({ x: fleet.x, y: fleet.y }).toEqual(start);
  });

  it('flies a player fleet across the map around the black hole', () => {
    const map = startGame();
    const [hole] = buildNavObstacles(map.specialObjects);
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    // Put the fleet left of the hole and order it straight through to the right.
    fleet.x = hole.x - 12;
    fleet.y = hole.y;
    map.selectFleet(fleet);
    map.moveSelectedFleet(Math.round(hole.x + 12), Math.round(hole.y));
    expect(map.fleetMoveError).toBeNull();

    let closest = Infinity;
    for (let t = 0; t < 200 && fleet.targetX !== null; t += 0.1) {
      map['gameLoopCallback'](0.1);
      closest = Math.min(closest, distance(fleet, hole));
    }
    expect(closest).toBeGreaterThanOrEqual(hole.radius - 1e-6);
    expect(fleet.targetX).toBeNull();
    expect(Math.round(fleet.x)).toBe(Math.round(hole.x + 12));
  });

  it('generates nebulae at New Game and keeps them unchanged across save/load', () => {
    const map = startGame();
    const nebulae = structuredClone(map.nebulae);
    expect(nebulae.length).toBeGreaterThan(1);
    expect(map.nebulaViews.length).toBe(nebulae.length);

    map['saveGame']();
    const reloaded = createStarMap();
    expect(reloaded.nebulae).toEqual(nebulae);
    // Homeworld systems are never inside a nebula.
    const homes = reloaded.starSystems.filter((s) =>
      s.planetsTiles.some((p) => p.factionId === 'player' || p.factionId.startsWith('enemy')),
    );
    for (const home of homes) {
      expect(isPointInAnyNebula(nebulae, home.x, home.y)).toBe(false);
    }
  });

  it('restores active asteroids after save/load and never brings back a collected one', () => {
    const map = startGame();
    const asteroids = TestBed.inject(DriftingAsteroidService);
    const rock: DriftingAsteroid = {
      id: 50,
      type: 'crystal',
      startX: 0.5,
      startY: 30,
      dirX: 1,
      dirY: 0,
      speed: 0.15,
      traveled: 40,
      length: 180,
      reward: { research: 260 },
    };
    asteroids.restore({ nextId: 51, spawnTimer: 9999, rngState: 5, active: [rock] }, 1, map.fleets);
    map['saveGame']();

    const reloaded = createStarMap();
    const restored = TestBed.inject(DriftingAsteroidService).getAsteroid(50)!;
    expect(restored).toEqual(rock);

    // A player fleet sits on the asteroid's track: it collects it once.
    const player = reloaded.factions.find((f) => f.id === 'player')!;
    const before = player.currencies['research'];
    const fleet = reloaded.fleets.find((f) => f.factionId === 'player')!;
    fleet.x = 41;
    fleet.y = 30;
    fleet.targetX = null;
    fleet.targetY = null;
    run(reloaded, 0.5);
    expect(player.currencies['research']).toBe(before + 260);
    expect(TestBed.inject(DriftingAsteroidService).getAsteroid(50)).toBeUndefined();

    // The collection was autosaved at once: reloading cannot restore it.
    const saved = TestBed.inject(SaveGameService).loadFromSlot(SaveSlotId.AUTOSAVE)!;
    expect(saved.asteroidEvents!.active.some((a) => a.id === 50)).toBe(false);
    const again = createStarMap();
    expect(TestBed.inject(DriftingAsteroidService).getAsteroid(50)).toBeUndefined();
    expect(again.factions.find((f) => f.id === 'player')!.currencies['research']).toBe(
      before + 260,
    );
  });

  it('freezes asteroids while the game is paused (zero game delta)', () => {
    const map = startGame();
    const asteroids = TestBed.inject(DriftingAsteroidService);
    asteroids.restore(
      {
        nextId: 2,
        spawnTimer: 9999,
        rngState: 5,
        active: [
          {
            id: 1,
            type: 'ore',
            startX: 0.5,
            startY: 90,
            dirX: 1,
            dirY: 0,
            speed: 0.2,
            traveled: 10,
            length: 180,
            reward: { rawmaterials: 300 },
          },
        ],
      },
      1,
    );
    run(map, 5, 0.1);
    const moved = asteroids.getAsteroid(1)!.traveled;
    expect(moved).toBeCloseTo(11, 1);
    for (let i = 0; i < 50; i++) map['gameLoopCallback'](0);
    expect(asteroids.getAsteroid(1)!.traveled).toBe(moved);
  });

  it('generates asteroid belts at New Game and keeps them identical across save/load', () => {
    const map = startGame();
    const belts = structuredClone(map.asteroidBelts);
    expect(belts.length).toBeGreaterThan(0);
    expect(map.beltViews.length).toBe(belts.length);
    map['saveGame']();
    const reloaded = createStarMap();
    expect(reloaded.asteroidBelts).toEqual(belts);
    // Reloading twice does not duplicate obstacles.
    const obstacleCount = TestBed.inject(StarMapTerrainService).obstacles.filter(
      (o) => o.kind === 'belt',
    ).length;
    createStarMap();
    expect(
      TestBed.inject(StarMapTerrainService).obstacles.filter((o) => o.kind === 'belt').length,
    ).toBe(obstacleCount);
  });

  it('rejects a player move into an asteroid belt and routes a crossing order around it', () => {
    const map = startGame();
    const wall = map.asteroidBelts[0];
    const [a, b] = [wall.points[0], wall.points[wall.points.length - 1]];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const fleet = map.fleets.find((f) => f.factionId === 'player')!;
    map.selectFleet(fleet);

    map.moveSelectedFleet(Math.round(wall.points[0].x), Math.round(wall.points[0].y));
    expect(map.fleetMoveError).toContain('asteroid belt');
    expect(fleet.targetX).toBeNull();

    // Place the fleet beside the belt middle and order it straight across.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const off = beltNavigationRadius(wall) + 3;
    fleet.x = mid.x + n.x * off;
    fleet.y = mid.y + n.y * off;
    map.moveSelectedFleet(mid.x - n.x * off, mid.y - n.y * off);
    expect(map.fleetMoveError).toBeNull();
    expect(map['movementService'].getActiveRoute(fleet)!.waypoints.length).toBeGreaterThan(0);
    let clearance = Infinity;
    for (let t = 0; t < 1500 && fleet.targetX !== null && !fleet.destroyed; t += 0.1) {
      map['gameLoopCallback'](0.1);
      if (map.currentView !== 'map') break; // a battle may start; movement checks end here
      clearance = Math.min(
        clearance,
        ...map.asteroidBelts.map((bl) => beltAxisDistance(bl, fleet) - beltNavigationRadius(bl)),
      );
    }
    expect(clearance).toBeGreaterThanOrEqual(-1e-6);
    expect(clearance).toBeLessThan(Infinity); // the flight was actually simulated
  });

  it('still spawns drifting asteroids regularly on a map with belts', () => {
    const map = startGame();
    const asteroids = TestBed.inject(DriftingAsteroidService);
    asteroids.restore({ nextId: 1, spawnTimer: 0, rngState: 99, active: [] }, 1);
    let spawned = 0;
    let lastId = 0;
    for (let t = 0; t < 3000; t += 1) {
      asteroids.tick(1, [], map.factions, map.mapWidth, map.mapHeight);
      for (const a of asteroids.active) {
        if (a.id > lastId) {
          spawned++;
          lastId = a.id;
        }
      }
    }
    // ~23 spawn attempts in 3000 s; most must find a belt-free track.
    expect(spawned).toBeGreaterThanOrEqual(10);
    expect(ASTEROID_CONFIG.maxActive).toBeGreaterThan(0);
  });
});

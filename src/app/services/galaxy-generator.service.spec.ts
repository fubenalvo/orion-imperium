import { describe, it, expect } from 'vitest';
import legacyMap from '../components/star-map/star-map-data.json';
import { StarMapData, GalaxySize } from '../components/star-map/star-map.models';
import { EconomyService } from './economy.service';
import { ShipService } from './ship.service';
import {
  BLACK_HOLE_SIZE,
  GalaxyGeneratorService,
  GalaxyGenerationError,
  mapCenter,
} from './galaxy-generator.service';
import { validateGeneratedGalaxy } from './galaxy-validation';
import { GALAXY_SIZE_PRESETS, NewGameConfig, PLAYER_COLOR_PALETTE } from './new-game.models';
import { addPlayer, createDefaultNewGameConfig, setGalaxySize } from './new-game-config';

const generator = new GalaxyGeneratorService();
const SIZES: GalaxySize[] = ['small', 'medium', 'large'];
const SEEDS = Array.from({ length: 25 }, (_, i) => 1000 + i * 7919);

function configFor(size: GalaxySize, playerCount = 3): NewGameConfig {
  let config = setGalaxySize(createDefaultNewGameConfig(size), size);
  while (config.players.length < playerCount) config = addPlayer(config);
  config = { ...config, players: config.players.slice(0, playerCount) };
  return config;
}

function planetCount(data: StarMapData): number {
  return data.starSystems.reduce((sum, s) => sum + s.planetsTiles.length, 0);
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe('GalaxyGeneratorService', () => {
  it('generates valid galaxies for every size, seed, and min/max player count', () => {
    for (const size of SIZES) {
      for (const players of [2, GALAXY_SIZE_PRESETS[size].maxPlayers]) {
        const config = configFor(size, players);
        for (const seed of SEEDS) {
          const data = generator.generate(config, seed);
          const result = validateGeneratedGalaxy(data, config);
          expect(result.errors, `${size}/${players}p/seed ${seed}`).toEqual([]);
        }
      }
    }
  });

  it('produces galaxies that differ in dimensions and content per size', () => {
    const stats = SIZES.map((size) => {
      const config = configFor(size, 2);
      const maps = SEEDS.map((seed) => generator.generate(config, seed));
      return {
        width: maps[0].map.width,
        height: maps[0].map.height,
        systems: maps[0].starSystems.length,
        planets: average(maps.map(planetCount)),
      };
    });
    const [small, medium, large] = stats;
    expect(small.width).toBeLessThan(medium.width);
    expect(medium.width).toBeLessThan(large.width);
    expect(small.height).toBeLessThan(medium.height);
    expect(medium.height).toBeLessThan(large.height);
    expect(small.systems).toBeLessThan(medium.systems);
    expect(medium.systems).toBeLessThan(large.systems);
    expect(small.planets).toBeLessThan(medium.planets);
    expect(medium.planets).toBeLessThan(large.planets);
  });

  it('keeps the Large galaxy at the scale of the legacy star-map-data.json', () => {
    const reference = legacyMap as unknown as StarMapData;
    const referencePlanets = planetCount(reference);
    const config = configFor('large', 3);
    const maps = SEEDS.map((seed) => generator.generate(config, seed));

    for (const data of maps) {
      expect(data.map.width).toBe(reference.map.width);
      expect(data.map.height).toBe(reference.map.height);
      expect(data.map.cellSizeVw).toBe(reference.map.cellSizeVw);
      expect(data.starSystems.length).toBe(reference.starSystems.length);
      const maxPlanets = Math.max(...reference.starSystems.map((s) => s.planetsTiles.length));
      for (const system of data.starSystems) {
        expect(system.planetsTiles.length).toBeGreaterThanOrEqual(1);
        expect(system.planetsTiles.length).toBeLessThanOrEqual(maxPlanets);
      }
    }
    const avgPlanets = average(maps.map(planetCount));
    expect(avgPlanets).toBeGreaterThan(referencePlanets * 0.75);
    expect(avgPlanets).toBeLessThan(referencePlanets * 1.35);

    // Same schema: every key used by the legacy systems/planets/fleets exists.
    const sample = maps[0];
    for (const key of ['id', 'name', 'x', 'y', 'planets', 'color', 'explored', 'planetsTiles']) {
      expect(sample.starSystems[0]).toHaveProperty(key);
    }
    for (const key of Object.keys(reference.starSystems[1].planetsTiles[0])) {
      expect(sample.starSystems[1].planetsTiles[0]).toHaveProperty(key);
    }
    for (const key of Object.keys(reference.fleets[0])) {
      expect(sample.fleets[0]).toHaveProperty(key);
    }
  });

  it('always places a real black hole special object at the exact map center', () => {
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const data = generator.generate(configFor(size), seed);
        const holes = data.specialObjects!.filter((o) => o.type === 'blackhole');
        expect(holes).toHaveLength(1);
        const hole = holes[0];
        expect(hole.component).toBe('blackhole');
        expect(hole.width).toBe(BLACK_HOLE_SIZE.width);
        expect(hole.height).toBe(BLACK_HOLE_SIZE.height);
        // Cells x..x+w-1 must be symmetric around the map midpoint.
        expect(hole.x - 1).toBe(data.map.width - (hole.x + hole.width - 1));
        expect(hole.y - 1).toBe(data.map.height - (hole.y + hole.height - 1));
        const center = mapCenter(data.map.width, data.map.height);
        expect(hole.x + (hole.width - 1) / 2).toBe(center.x);
        expect(hole.y + (hole.height - 1) / 2).toBe(center.y);
      }
    }
  });

  it('keeps systems and fleets clear of the black hole and inside the map', () => {
    for (const size of SIZES) {
      const preset = GALAXY_SIZE_PRESETS[size];
      for (const seed of SEEDS) {
        const data = generator.generate(configFor(size, preset.maxPlayers), seed);
        const center = mapCenter(data.map.width, data.map.height);
        for (const p of [...data.starSystems, ...data.fleets]) {
          expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeGreaterThanOrEqual(preset.blackHoleClearance);
          expect(p.x).toBeGreaterThanOrEqual(1);
          expect(p.x).toBeLessThanOrEqual(data.map.width);
          expect(p.y).toBeGreaterThanOrEqual(1);
          expect(p.y).toBeLessThanOrEqual(data.map.height);
        }
      }
    }
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const config = configFor('medium');
    const a = generator.generate(config, 42);
    const b = generator.generate(config, 42);
    const c = generator.generate(config, 43);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.starSystems)).not.toBe(JSON.stringify(c.starSystems));
    expect(a.galaxy).toEqual({ size: 'medium', seed: 42, requestedSeed: null, generatorVersion: 2 });
  });

  it('generates unique ids and names with valid references', () => {
    const data = generator.generate(configFor('large', 6), 7);
    const planets = data.starSystems.flatMap((s) => s.planetsTiles);
    const ships = data.fleets.flatMap((f) => f.ships);
    const factionIds = new Set(data.factions.map((f) => f.id));
    expect(new Set(data.starSystems.map((s) => s.id)).size).toBe(data.starSystems.length);
    expect(new Set(planets.map((p) => p.id)).size).toBe(planets.length);
    expect(new Set(planets.map((p) => p.name)).size).toBe(planets.length);
    expect(new Set(data.fleets.map((f) => f.id)).size).toBe(data.fleets.length);
    expect(new Set(ships.map((s) => s.id)).size).toBe(ships.length);
    expect(factionIds.size).toBe(data.factions.length);
    for (const planet of planets) expect(factionIds.has(planet.factionId)).toBe(true);
    for (const fleet of data.fleets) expect(factionIds.has(fleet.factionId)).toBe(true);
  });

  it('applies player names, colors, controllers and AI difficulty to factions', () => {
    const config: NewGameConfig = {
      galaxySize: 'large',
      seed: 5,
      players: [
        { name: 'Bot One', color: PLAYER_COLOR_PALETTE[1].value, controller: 'ai', difficulty: 'hard' },
        { name: 'Me', color: PLAYER_COLOR_PALETTE[4].value, controller: 'human', difficulty: 'normal' },
        { name: 'Bot Two', color: PLAYER_COLOR_PALETTE[6].value, controller: 'ai', difficulty: 'easy' },
      ],
    };
    const data = generator.generate(config, 5);
    const byId = new Map(data.factions.map((f) => [f.id, f]));

    expect(byId.get('player')).toMatchObject({ name: 'Me', color: '#7bd66b', ai: false, team: 1 });
    expect(byId.get('player')!.aiDifficulty).toBeUndefined();
    expect(byId.get('enemy1')).toMatchObject({ name: 'Bot One', color: '#d65757', ai: true, team: 2, aiDifficulty: 'hard' });
    expect(byId.get('enemy2')).toMatchObject({ name: 'Bot Two', color: '#ff6fcf', ai: true, team: 2, aiDifficulty: 'easy' });
    expect(byId.has('independent')).toBe(true);
    expect(byId.has('unhabited')).toBe(true);
    expect(data.factions.filter((f) => f.ai === false && f.team === 1)).toHaveLength(1);
    expect(data.galaxy!.requestedSeed).toBe(5);
  });

  it('gives every participant a homeworld, starting fleet, resources and tech', () => {
    const data = generator.generate(configFor('large', 4), 99);
    const participants = data.factions.filter((f) => f.team !== 0);
    expect(participants).toHaveLength(4);
    for (const faction of participants) {
      const owned = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id);
      expect(owned.length).toBeGreaterThanOrEqual(1);
      expect(owned.some((p) => p.buildings.length > 0 && p.population > 0)).toBe(true);
      expect(data.fleets.some((f) => f.factionId === faction.id && f.ships.length > 0)).toBe(true);
      expect(faction.currencies['credits']).toBeGreaterThan(0);
      expect(faction.researchedTechnologies).toContain('basic_engineering');
    }
    // The game starts on the human homeworld, which is explored.
    const home = data.starSystems.find((s) => s.id === data.defaultView!.systemId)!;
    const homeworld = home.planetsTiles.find((p) => p.id === data.defaultView!.planetId)!;
    expect(data.defaultView!.type).toBe('planet');
    expect(homeworld.factionId).toBe('player');
    expect(homeworld.explored).toBe(true);
    // Star positions are known; cell fog and planet details are not.
    expect(data.exploredGridCells).toEqual([]);
    expect(data.starSystems.every((s) => s.explored)).toBe(true);
    const explored = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.explored);
    expect(explored.map((p) => p.id)).toEqual([homeworld.id]);
  });

  it('starts every homeworld energy-positive so no faction rebels immediately', () => {
    const economy = new EconomyService(new ShipService());
    const data = generator.generate(configFor('large', 3), 3);
    for (const faction of data.factions.filter((f) => f.team !== 0)) {
      const breakdown = economy.calculateEconomy(faction.id, data.factions, data.starSystems, data.fleets);
      for (const planet of breakdown.planets) {
        expect(planet.efficiency).toBe(1);
      }
    }
  });

  it('scales AI starting resources, colonies and fleets with difficulty', () => {
    const base = configFor('large', 3);
    const withDifficulty = (difficulty: 'easy' | 'normal' | 'hard') => {
      const config: NewGameConfig = {
        ...base,
        players: base.players.map((p) => (p.controller === 'ai' ? { ...p, difficulty } : p)),
      };
      const data = generator.generate(config, 11);
      const ai = data.factions.find((f) => f.id === 'enemy1')!;
      return {
        credits: ai.currencies['credits'],
        planets: data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === 'enemy1').length,
        ships: data.fleets.filter((f) => f.factionId === 'enemy1').flatMap((f) => f.ships).length,
        playerShips: data.fleets.filter((f) => f.factionId === 'player').flatMap((f) => f.ships).length,
      };
    };
    const easy = withDifficulty('easy');
    const normal = withDifficulty('normal');
    const hard = withDifficulty('hard');
    expect(easy.credits).toBeLessThan(normal.credits);
    expect(normal.credits).toBeLessThan(hard.credits);
    expect(easy.planets).toBeLessThan(normal.planets);
    expect(normal.planets).toBeLessThan(hard.planets);
    expect(easy.ships).toBeLessThan(normal.ships);
    expect(normal.ships).toBeLessThan(hard.ships);
    // Normal AI mirrors the human start; the human start never changes.
    expect(normal.ships).toBe(normal.playerShips);
    expect(easy.playerShips).toBe(hard.playerShips);
  });

  it('throws a GalaxyGenerationError for impossible configurations', () => {
    const config = { ...configFor('small'), galaxySize: 'gigantic' as GalaxySize };
    expect(() => generator.generate(config, 1)).toThrow(GalaxyGenerationError);
  });
});

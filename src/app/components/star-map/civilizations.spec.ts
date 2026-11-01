import { describe, it, expect } from 'vitest';
import { GalaxyGeneratorService } from '../../services/galaxy-generator.service';
import { validateGeneratedGalaxy } from '../../services/galaxy-validation';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { GALAXY_SIZE_PRESETS } from '../../services/new-game.models';
import { EconomyService } from '../../services/economy.service';
import { ShipService } from '../../services/ship.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { ProductionService } from '../../services/production.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CIVILIZATION_CONFIG } from './civilizations';
import { GalaxySize, StarMapData, StarSystem } from './star-map.models';
import { tradePosts } from './trade-network';

/*
 * Independent civilizations (docs/trade-network.md#independent-civilizations):
 * extra neutral systems with a Bank and a Trading Post, conquerable, never
 * blocking victory.
 */
const generator = new GalaxyGeneratorService();
const SIZES: GalaxySize[] = ['small', 'medium', 'large'];
const SEEDS = [11, 2024, 31337, 4242, 90001];

const isCivilizationSystem = (s: StarSystem) => s.planetsTiles.some((p) => p.civilization !== undefined);

function generate(size: GalaxySize, seed: number, civilizations = true): StarMapData {
  return generator.generate(createDefaultNewGameConfig(size), seed, { civilizations });
}

describe('independent civilization generation', () => {
  it('adds up to the configured number of civilization systems; every galaxy stays valid', () => {
    for (const size of SIZES) {
      for (const seed of SEEDS) {
        const data = generate(size, seed);
        const civilizationSystems = data.starSystems.filter(isCivilizationSystem);
        expect(civilizationSystems.length, `${size}/${seed}`).toBeGreaterThanOrEqual(1);
        expect(civilizationSystems.length).toBeLessThanOrEqual(CIVILIZATION_CONFIG.systemsBySize[size]);
        expect(data.starSystems.length - civilizationSystems.length).toBe(GALAXY_SIZE_PRESETS[size].systemCount);
        const validation = validateGeneratedGalaxy(data, createDefaultNewGameConfig(size));
        expect(validation.errors, `${size}/${seed}`).toEqual([]);
      }
    }
  });

  it('usually places the full number of civilizations', () => {
    for (const size of SIZES) {
      const counts = SEEDS.map((seed) => generate(size, seed).starSystems.filter(isCivilizationSystem).length);
      const average = counts.reduce((a, b) => a + b, 0) / counts.length;
      expect(average, `${size}: ${counts.join(',')}`).toBeGreaterThanOrEqual(CIVILIZATION_CONFIG.systemsBySize[size] - 1);
    }
  });

  it('settles civilizations as independent worlds with a Bank and a Trading Post, away from every empire', () => {
    const data = generate('medium', 31337);
    const homes = data.starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === 'player' || p.factionId.startsWith('enemy')));
    const spacing = GALAXY_SIZE_PRESETS.medium.minSystemSpacing * CIVILIZATION_CONFIG.homeDistanceFactor;
    for (const system of data.starSystems.filter(isCivilizationSystem)) {
      const capital = system.planetsTiles[0];
      expect(capital.factionId).toBe('independent');
      expect(capital.civilization).toBeTruthy();
      expect(capital.population).toBeGreaterThan(0);
      expect(capital.buildings.map((b) => b.name)).toEqual(expect.arrayContaining(['Bank', 'Trading Post']));
      expect(capital.surface).toBeDefined();
      for (const planet of system.planetsTiles) {
        expect(['independent', 'unhabited']).toContain(planet.factionId);
        if (planet.civilization) expect(planet.civilization).toBe(capital.civilization);
      }
      for (const home of homes) {
        expect(Math.hypot(home.x - system.x, home.y - system.y)).toBeGreaterThanOrEqual(spacing);
      }
    }
    const names = data.starSystems.filter(isCivilizationSystem).map((s) => s.planetsTiles[0].civilization);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is deterministic and leaves the rest of the galaxy exactly as without civilizations', () => {
    const a = generate('large', 4242);
    const b = generate('large', 4242);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plain = generate('large', 4242, false);
    const regular = a.starSystems.filter((s) => !isCivilizationSystem(s));
    expect(regular).toEqual(plain.starSystems);
    expect(a.fleets).toEqual(plain.fleets);
    expect(a.asteroidBelts).toEqual(plain.asteroidBelts);
    expect(a.nebulae).toEqual(plain.nebulae);
  });

  it('makes every civilization capital a node of the trade network', () => {
    const data = generate('medium', 2024);
    const nodes = tradePosts(data.starSystems).map((n) => n.planet.id);
    for (const system of data.starSystems.filter(isCivilizationSystem)) {
      expect(nodes).toContain(system.planetsTiles[0].id);
    }
  });
});

describe('conquering a civilization', () => {
  it('a captured capital is powered and staffed for its new owner', () => {
    const data = generate('medium', 2024);
    const capital = data.starSystems.filter(isCivilizationSystem)[0].planetsTiles[0];
    capital.factionId = 'player';
    const economy = new EconomyService(new ShipService()).calculatePlanetEconomy(capital, data.factions.find((f) => f.id === 'player'));
    expect(economy.efficiency).toBe(1);
    expect(economy.workforceEfficiency).toBe(1);
    expect(economy.production['credits'] ?? 0).toBeGreaterThan(0);
  });

  it('any ownership change removes the civilization tag', () => {
    const data = generate('small', 11);
    const capital = data.starSystems.filter(isCivilizationSystem)[0].planetsTiles[0];
    const ownership = new PlanetOwnershipService(new ProductionService(new ShipService(), new ShipStockService()));
    ownership.transferPlanet({ factions: data.factions }, capital, 'enemy1', 'battle_won');
    expect(capital.civilization).toBeUndefined();
    expect(capital.satisfaction).toBe(CIVILIZATION_CONFIG.satisfaction);
  });

  it('civilization worlds never block a conquest victory; a captured one counts as usual', () => {
    const data = generate('small', 11);
    // The player owns every regular inhabited planet and no AI fleet is left.
    for (const planet of data.starSystems.flatMap((s) => s.planetsTiles)) {
      if (planet.factionId.startsWith('enemy')) planet.factionId = 'player';
    }
    const fleets = data.fleets.filter((f) => f.factionId === 'player');
    const outcome = new GameOutcomeService();
    expect(outcome.evaluateOutcome(data.factions, data.starSystems, fleets)).toBe('victory');

    // An ordinary rebel planet (no tag) still blocks it.
    const capital = data.starSystems.filter(isCivilizationSystem)[0].planetsTiles[0];
    delete capital.civilization;
    expect(new GameOutcomeService().evaluateOutcome(data.factions, data.starSystems, fleets)).toBe('inProgress');
  });
});

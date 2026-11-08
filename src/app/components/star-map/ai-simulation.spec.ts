import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../services/ship.service';
import { getRelationKind } from './diplomacy';
import { getAiPersonalityProfile } from './ai-personality';
import {
  ScenarioOptions,
  expectHealthyAiFactions,
  ownedPlanets,
  runScenario,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation (headless multi-minute games)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with independent civilizations the AIs stay healthy; captured civilization worlds lose their tag', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true, civilizations: true };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const planets = result.data.starSystems.flatMap((s) => s.planetsTiles);
    // A tag survives only on a planet the civilization still holds.
    expect(planets.filter((p) => p.civilization !== undefined).every((p) => p.factionId === 'independent')).toBe(true);
    // Every capture of a civilization world went through the ownership pathway, which drops the tag.
    for (const change of result.ownershipChanges.filter((c) => c.from === 'independent')) {
      expect(planets.find((p) => p.id === change.planetId)?.civilization).toBeUndefined();
    }
  });

  /*
   * docs/trade-network.md#ai. Seed 31339 gives a technologist and a balanced
   * AI (both build commerce without a surplus); 31337 an expansionist and a
   * militarist. Not a health check: over 20 minutes the AIs may fight each other.
   */
  it.each([31339, 31337])('AIs invest in Banks and Trading Posts by personality, respect the civilization gate and raid only allowed traders (seed %i)', (seed) => {
    const civilizationPlanets = new Set<number>();
    const options: ScenarioOptions = {
      size: 'medium', aiCount: 2, seconds: 1200, dt: 1 / 60, removePlayerFleets: true, civilizations: true, seed,
      prepare: (data) => {
        for (const planet of data.starSystems.flatMap((s) => s.planetsTiles)) {
          if (planet.civilization !== undefined) civilizationPlanets.add(planet.id);
        }
      },
    };
    const result = runScenario(options);
    const planets = result.data.starSystems.flatMap((s) => s.planetsTiles);
    const owned = (factionId: string, building: string) =>
      planets.filter((p) => p.factionId === factionId && p.buildings.some((b) => b.name === building)).length;
    for (const faction of result.data.factions.filter((f) => f.ai)) {
      const profile = getAiPersonalityProfile(faction);
      // Every personality that builds Trading Posts without a surplus has one,
      // and so do those that build Banks. A militarist builds a post only
      // from a large surplus, which the slower economy since the colony
      // cores (2026-11) no longer reaches within 20 minutes.
      if (profile.commerce.tradingPosts >= 1) {
        expect(owned(faction.id, 'Trading Post'), `${faction.id} (${faction.aiPersonality}) trading posts`).toBeGreaterThanOrEqual(1);
      }
      if (profile.commerce.bankShare >= 0.5) {
        expect(owned(faction.id, 'Bank'), `${faction.id} (${faction.aiPersonality}) banks`).toBeGreaterThanOrEqual(1);
      }
    }
    // No civilization world falls before its captor's civilizationAssaultAfter.
    for (const change of result.ownershipChanges.filter((c) => civilizationPlanets.has(c.planetId) && c.from === 'independent')) {
      const captor = result.data.factions.find((f) => f.id === change.to);
      expect(change.time, `${change.to} took a civilization world`).toBeGreaterThanOrEqual(getAiPersonalityProfile(captor).civilizationAssaultAfter);
    }
    // AI raids only hit civilian traders or a war enemy's.
    for (const raid of result.traderRaids) {
      const raider = result.data.factions.find((f) => f.id === raid.raiderFactionId)!;
      const owner = raid.ownerId ? result.data.factions.find((f) => f.id === raid.ownerId) : undefined;
      if (owner) expect(getRelationKind(raider, owner), `${raider.id} raided ${owner.id}`).not.toBe('peace');
    }
  }, 120_000);

  it('two AIs on a medium map without player fleets develop infrastructure and colonize', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      const planets = ownedPlanets(result.data, factionId);
      const buildings = planets.flatMap((p) => p.buildings.map((b) => b.name));
      expect(buildings, `${factionId} factory`).toContain('Spaceship Factory');
      expect(buildings, `${factionId} spaceport`).toContain('Spaceport');
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      expect(planets.length).toBe(trace.startPlanets + trace.colonizations);
    }
  });

  it('two AIs on a medium map with player fleets present keep progressing', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60 };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('hard AIs on a small map with variable frame times colonize and stay stable', () => {
    const options: ScenarioOptions = { size: 'small', aiCount: 2, seconds: 600, dt: 'jitter', difficulty: 'hard' };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('five AIs on a large map are each processed and colonize', () => {
    // 12 minutes: since the colony cores (2026-11) the first colonizer leaves
    // ~50 s later, and on a large map its trip can exceed the old 10 minutes.
    const options: ScenarioOptions = { size: 'large', aiCount: 5, seconds: 720, dt: 1 / 60 };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('AIs keep progressing after a mid-game save/load', () => {
    const options: ScenarioOptions = {
      size: 'medium',
      aiCount: 2,
      seconds: 600,
      dt: 1 / 60,
      removePlayerFleets: true,
      saveLoadAtSecond: 40,
    };
    const result = runScenario(options);

    expectHealthyAiFactions(result, options);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
    }
  });

  it('each colonization consumes exactly one colonizer and claims the planet once', () => {
    const options: ScenarioOptions = { size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true };
    const result = runScenario(options);

    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      const livingColonizers =
        result.data.fleets
          .filter((f) => f.factionId === factionId && !f.destroyed)
          .flatMap((f) => f.ships)
          .filter((s) => s.type === 'colonizer' && !s.destroyed).length +
        (result.data.shipStock?.find((s) => s.factionId === factionId)?.ships ?? []).filter((s) => s.type === 'colonizer')
          .length;
      // Every produced colonizer is either still alive or was spent on exactly one colony.
      expect(trace.colonizersProduced, `${factionId} colonizer accounting`).toBe(trace.colonizations + livingColonizers);
      // Colonized planets are only ever claimed once (no ownership flip-flop).
      expect(trace.lostPlanets).toBe(0);
    }
  });

  it('fleet strength ignores destroyed ships', () => {
    const shipService = TestBed.inject(ShipService);
    const living = shipService.calculateFleetStrength([{ type: 'cruiser' }]);
    const withWreck = shipService.calculateFleetStrength([
      { type: 'cruiser' },
      { type: 'cruiser', destroyed: true },
    ]);
    expect(living).toBeGreaterThan(0);
    expect(withWreck).toBe(living);
  });
});

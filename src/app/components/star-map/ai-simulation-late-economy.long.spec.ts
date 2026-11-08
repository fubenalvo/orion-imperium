import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EconomyService } from '../../services/economy.service';
import {
  ECONOMY_SCENARIOS,
  runEconomyScenario,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation — late economy', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('large map, 4 personalities, 90 minutes: lower late surplus, no stuck AI', () => {
    const { result, samples, summaries } = runEconomyScenario(ECONOMY_SCENARIOS['large/4']);
    const economy = TestBed.inject(EconomyService);
    for (const s of summaries) {
      const label = `${s.who}/${s.personality}`;
      expect(s.arrearsTicks, `${label} arrears`).toBeLessThanOrEqual(10);
      expect(s.rebellions, `${label} rebellions`).toBe(0);
      expect(s.failedOrders, `${label} rejected orders`).toBe(0);
      expect(s.longestNegativeNet, `${label} negative-net streak (s)`).toBeLessThanOrEqual(300);
      expect(s.techs, `${label} technologies`).toBeGreaterThanOrEqual(20);
      expect(s.warships, `${label} warships`).toBeGreaterThan(0);
      expect(s.colonizations, `${label} colonies`).toBeGreaterThanOrEqual(3);
    }
    for (const s of samples.filter((x) => x.minute === 90)) {
      // 0.25 since building construction time (2026-11): a slower build-up
      // leaves a little more unspent at minute 90 (measured up to ~0.23).
      // 0.30 since AI ship equipment (2026-11-08): refitted navies win more,
      // and modules carry no upkeep, so a richer technologist measured 0.27
      // (income 3,087/s, 704k credits). Modules cannot lower this ratio; the
      // late hoard at the ship cap stays an open point (docs/late-economy.md).
      expect(s.net / s.income, `${s.who} late net share`).toBeLessThanOrEqual(0.3);
    }
    // The rule bites: every AI has planets that need comfort by minute 90.
    for (const f of result.data.factions.filter((x) => x.ai)) {
      const owned = result.data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === f.id);
      expect(owned.some((p) => economy.calculatePlanetEconomy(p, f).comfortNeed > 0), `${f.id} comfort need`).toBe(true);
    }
  }, 900_000);
});

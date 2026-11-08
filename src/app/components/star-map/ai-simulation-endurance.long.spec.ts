import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PIRATE_CONFIG, PIRATE_FACTION_ID } from './pirate-incursion';
import {
  EconomyRow,
  ScenarioOptions,
  ScenarioResult,
  economyRows,
  expectHealthyAiFactions,
  longRun,
  runScenario,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation — Phase 6 long-duration stability and performance', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AT-12: 40-minute games on small, medium and large maps stay healthy and keep progressing', () => {
    longRun({ size: 'small', aiCount: 2, seconds: 2400, dt: 1 / 30, difficulty: 'hard' });
    longRun({ size: 'medium', aiCount: 3, seconds: 2400, dt: 1 / 30 });
    longRun({ size: 'large', aiCount: 5, seconds: 2400, dt: 1 / 30, seed: 4242, difficulty: 'easy' });
  }, 120_000);

});

describe('AI simulation — economy validation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('long multi-faction games: factions expand, spend a meaningful share of income and research steadily', () => {
    const configs: ScenarioOptions[] = [
      // The passive stand-in player can be eliminated mid-run; the AIs keep playing.
      { size: 'medium', aiCount: 3, seconds: 1800, dt: 1 / 30, continueAfterOutcome: true },
      { size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30, seed: 4242, continueAfterOutcome: true },
    ];
    const rows: EconomyRow[] = [];
    for (const options of configs) {
      const result = runScenario(options);
      expectHealthyAiFactions(result, options);
      rows.push(...economyRows(result, `${options.size}/${options.aiCount}`));
    }
    // Printed before the assertions so a failing run still reports its numbers.
    // console.log is mocked in these suites and console.info is swallowed by
    // the Angular test builder, so the report goes straight to stdout.
    (globalThis as any).process?.stdout?.write(`ECONOMY METRICS ${JSON.stringify(rows)}\n`);
    for (const row of rows) {
      // Expansion stays viable under upkeep and administration costs.
      expect(Number(row.planets.split('->')[1]), `${row.who} planets`).toBeGreaterThan(Number(row.planets.split('->')[0]));
      // Purchases are a real share of income (the old economy: 3–5%), and
      // purchases + upkeep consume most of it (the old economy: 3–5% total).
      expect(row.spendShare, `${row.who} purchase share of gross income %`).toBeGreaterThanOrEqual(8);
      expect((row.spent + row.upkeep) / row.grossIncome, `${row.who} total outflow share`).toBeGreaterThan(0.6);
      // The AI's own spending never drives it into persistent arrears.
      expect(row.arrearsTicks, `${row.who} ticks in arrears`).toBeLessThanOrEqual(10);
      // Raw materials are consumed, and production orders are only placed when affordable.
      expect(row.rawSpent, `${row.who} raw materials spent`).toBeGreaterThan(0);
      expect(row.failedOrders, `${row.who} rejected production orders`).toBe(0);
      // Research is long-term: the 20th technology takes more than 10 minutes
      // (the old economy: ~3.5 minutes for the whole tree).
      if (row.tech20At !== null) {
        expect(row.tech20At, `${row.who} 20th technology time`).toBeGreaterThan(600);
      }
      // Research progression: early technologies arrive within the first
      // ~15 minutes, the full tree takes a long session (not minutes).
      // Warlike personalities (militarist, expansionist) stay at war most of
      // the run and spend more on warships, so they research a little less.
      const warlike = /\((militarist|expansionist)\)/.test(row.who);
      expect(row.techs, `${row.who} technologies after 30 minutes`).toBeGreaterThanOrEqual(warlike ? 10 : 12);
      if (row.treeDoneAt !== null) {
        expect(row.treeDoneAt, `${row.who} full tree time`).toBeGreaterThan(1200);
      }
    }
    // Personalities research differently: not every faction picks the same first technologies.
    expect(new Set(rows.map((r) => r.firstPicks)).size, 'distinct research openings').toBeGreaterThan(1);
  }, 180_000);

  it('with independent civilizations no AI expands or conquers into lasting upkeep arrears', () => {
    // QA 2026-11-01 on this setup: the expansionist kept colonizing at ~0 net
    // income, and later the militarist conquered its way to ~-200 credits/s
    // for the rest of the game. The colony and conquest brakes
    // (canSupportNewColony, canSupportCapture) keep every AI solvent while
    // conquest itself still happens.
    const options: ScenarioOptions = {
      // 10 fps keeps this 60-minute run light enough not to starve the
      // parallel suites (at 20 fps they hit their 5 s timeouts).
      size: 'medium', aiCount: 3, seconds: 3600, dt: 1 / 10, civilizations: true,
      resolvePlayerFleetBattles: true, continueAfterOutcome: true,
    };
    const result = runScenario(options);
    expect([...result.traces.values()].some((t) => t.personality === 'expansionist'), 'an expansionist plays').toBe(true);
    for (const row of economyRows(result, 'civ')) {
      expect(row.arrearsTicks, `${row.who} ticks in arrears`).toBeLessThanOrEqual(60);
      expect(Number(row.planets.split('->')[1]), `${row.who} planets`).toBeGreaterThan(Number(row.planets.split('->')[0]));
    }
    const aiIds = new Set(result.traces.keys());
    const captures = result.ownershipChanges.filter((c) => aiIds.has(c.to) && c.from !== 'unhabited').length;
    expect(captures, 'AI captures still happen').toBeGreaterThanOrEqual(3);
  }, 180_000);
});

describe('AI simulation — pirate incursion', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /*
   * Pacing report and safety net for docs/pirate-incursion.md: when the
   * event fires in real AI games, what it does, and that it never breaks an
   * empire. The printed PIRATE METRICS line is the input for tuning
   * PIRATE_CONFIG.firstAfter / quietSeconds.
   */
  it('long games: incursions start only in quiet stretches, raid, end, and never break an empire', () => {
    const configs: ScenarioOptions[] = [
      { size: 'small', aiCount: 2, seconds: 3600, dt: 1 / 10, continueAfterOutcome: true, resolvePlayerFleetBattles: true, pirates: true },
      { size: 'medium', aiCount: 3, seconds: 3600, dt: 1 / 10, continueAfterOutcome: true, resolvePlayerFleetBattles: true, pirates: true, seed: 777 },
    ];
    const report: unknown[] = [];
    const results: { options: ScenarioOptions; result: ScenarioResult }[] = [];
    for (const options of configs) {
      const result = runScenario(options);
      const quietGaps: number[] = [];
      const times = [
        ...result.ownershipChanges.map((c) => c.time),
        ...result.playerBattles.map((b) => b.time),
      ].sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) quietGaps.push(Math.round(times[i] - times[i - 1]));
      report.push({
        scenario: `${options.size}/${options.aiCount}`,
        aiBattles: result.aiBattles,
        ownershipChanges: result.ownershipChanges.length,
        longestOwnershipGap: Math.max(0, ...quietGaps),
        log: result.pirateLog.map((e) => `${Math.round(e.time / 60)}m ${e.text}`),
        arrears: [...result.traces].map(([id, t]) => `${id}:${t.arrearsTicks}`),
      });
      results.push({ options, result });
    }
    (globalThis as any).process?.stdout?.write(`PIRATE METRICS ${JSON.stringify(report)}\n`);
    for (const { options, result } of results) {
      // Pirates never own planets and no empire is driven into lasting arrears.
      expect(result.data.starSystems.flatMap((s) => s.planetsTiles).some((p) => p.factionId === PIRATE_FACTION_ID)).toBe(false);
      // Arrears only on the small map: the medium seed-777 game has two AIs in
      // arrears (~170 and ~450 ticks) with or without pirates (measured
      // 2026-11-03 with the event never firing), an open AI economy issue.
      if (options.size === 'small') {
        for (const [id, trace] of result.traces) expect(trace.arrearsTicks, `${options.size} ${id} ticks in arrears`).toBeLessThanOrEqual(60);
      }
      // The event does fire in an hour of AI play.
      expect(result.pirateLog.some((e) => e.text.includes('entered the galaxy')), `${options.size} incursion started`).toBe(true);
      // An incursion never starts before PIRATE_CONFIG.firstAfter.
      for (const entry of result.pirateLog.filter((e) => e.text.includes('entered the galaxy'))) {
        expect(entry.time).toBeGreaterThanOrEqual(PIRATE_CONFIG.firstAfter);
      }
    }
  }, 600_000);
});

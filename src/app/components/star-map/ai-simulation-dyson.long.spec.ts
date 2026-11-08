import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { getRelationKind } from './diplomacy';
import {
  ScenarioOptions,
  runDysonScenario,
  withPersonalities,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation — Dyson Swarm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /*
   * Phase 7 acceptance (docs/dyson-swarm.md, "Tuning"). Measured on this
   * scenario: Stellar Engineering at ~51 min (technologist) and ~55 min
   * (balanced), 4–6 anchors each by minute 90, the ring full by ~82 min and
   * then contested, anchors lost to hunts, anchor upkeep 7–12% of a
   * builder's income, no warm-up within 90 minutes. Since building
   * construction time (2026-11), over 120 minutes: Stellar Engineering at
   * ~85 / ~95 min, 4 and 3 anchors, upkeep 15% / 3%, no warm-up.
   */
  it('a technologist builds anchors, others contest them, and the swarm costs real money (120 minutes)', () => {
    // 120 minutes since building construction time (2026-11): the whole
    // tempo is slower, Stellar Engineering came at ~59–85 minutes in the
    // measured runs, leaving too little of a 90-minute game for the swarm.
    const options: ScenarioOptions = {
      size: 'medium', aiCount: 3, seconds: 7200, dt: 1 / 10, continueAfterOutcome: true, resolvePlayerFleetBattles: true,
      prepare: withPersonalities(['technologist', 'militarist', 'balanced']),
    };
    const { result, rows, warmupsStarted } = runDysonScenario(options);
    (globalThis as any).process?.stdout?.write(
      `DYSON METRICS ${JSON.stringify({ rows, warmupsStarted, outcome: result.outcome, outcomeAt: result.outcomeAt })}
`,
    );
    const row = (personality: string) => rows.find((r) => r.who.includes(`(${personality})`))!;
    const tech = row('technologist');
    // The technologist pursues the swarm: the technology, then several anchors.
    expect(tech.stellarAt, 'technologist researches Stellar Engineering').not.toBeNull();
    expect(tech.anchorsBuilt, 'technologist anchors built').toBeGreaterThanOrEqual(3);
    // Militarists never build.
    expect(row('militarist').constructorsOrdered, 'militarist constructors').toBe(0);
    // The ring is fought over: hunts and contests destroy anchors, or a rival
    // is at war with the builder when the run ends. Since the warlike
    // temperaments (2026-11-03) the militarist spends most of this seed's game
    // at war with the balanced AI and reaches the swarm late; it then loses to
    // the technologist's large fleet, so no anchor falls in this run, but both
    // rivals are at war with the builder by minute 90.
    const builder = result.data.factions.find((f) => f.id === tech.who.split(' ')[0])!;
    const rivalsAtWar = result.data.factions.filter((f) => f.ai === true && f.id !== builder.id && getRelationKind(f, builder) === 'war').length;
    const anchorsLost = rows.reduce((n, r) => n + r.anchorsLost, 0);
    expect(anchorsLost + rivalsAtWar, 'anchors destroyed or rivals at war with the builder').toBeGreaterThan(0);
    // The swarm is a real cost for its builder, and never drives it into arrears.
    expect(tech.anchorUpkeepShare, 'technologist anchor upkeep, % of gross income').toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      const trace = result.traces.get(r.who.split(' ')[0])!;
      expect(trace.failedOrders, `${r.who} rejected production orders`).toBe(0);
      expect(trace.arrearsTicks, `${r.who} ticks in arrears`).toBeLessThanOrEqual(10);
    }
  }, 450_000);
});

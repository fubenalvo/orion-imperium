import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AiActionLedger, AiActionReport } from './ai-action-ledger';
import {
  APM_AI_COUNT,
  APM_DIFFICULTIES,
  APM_MINUTES,
  APM_PERSONALITIES,
  APM_SEEDS,
  APM_SIZES,
  ECONOMY_SCENARIOS,
  runEconomyScenario,
  runScenario,
  withPersonalities,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe.runIf((globalThis as any).process?.env?.['ORION_ECONOMY_REPORT'] === '1')('AI simulation — late economy report (opt-in)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [label, options] of Object.entries(ECONOMY_SCENARIOS)) {
    it(`report: ${label}, 90 minutes`, () => {
      const { samples, summaries } = runEconomyScenario(options);
      (globalThis as any).process?.stdout?.write(`ECONOMY REPORT ${label} ${JSON.stringify({ samples, summaries })}\n`);
    }, 900_000);
  }
});

describe.runIf((globalThis as any).process?.env?.['ORION_APM_REPORT'] === '1')('AI simulation — action rate report (opt-in)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const size of APM_SIZES) {
    for (const difficulty of APM_DIFFICULTIES) {
      APM_SEEDS.forEach((seed, seedIndex) => {
        const label = `${size}/${difficulty}/${seed}`;
        it(`report: ${label}, ${APM_MINUTES} minutes`, () => {
          const aiCount = APM_AI_COUNT[size];
          const personalities = Array.from({ length: aiCount }, (_, i) => APM_PERSONALITIES[(i + seedIndex * aiCount) % APM_PERSONALITIES.length]);
          // The harness resets the AI pipeline after every AI assault on a
          // player planet (an old stand-in for the battle-screen reload; the
          // game now resumes AI memory there), which would also clear the
          // ledger mid-game. Only the first reset (the new game) is kept, so
          // the report covers the whole game. The ledger never feeds back into
          // the AI, so this changes nothing else.
          const ledger = TestBed.inject(AiActionLedger);
          const resetLedger = ledger.reset.bind(ledger);
          let resets = 0;
          vi.spyOn(ledger, 'reset').mockImplementation(() => {
            if (resets++ === 0) resetLedger();
          });
          runScenario({
            size, aiCount, difficulty, seed, seconds: APM_MINUTES * 60, dt: 1 / 10,
            continueAfterOutcome: true, resolvePlayerFleetBattles: true,
            prepare: withPersonalities(personalities),
          });
          const report: AiActionReport = TestBed.inject(AiActionLedger).report();
          const scenario = { size, difficulty, seed, minutes: APM_MINUTES, aiCount, personalities };
          (globalThis as any).process?.stdout?.write(`APM REPORT ${label} ${JSON.stringify({ scenario, report })}\n`);
        }, 1_800_000);
      });
    }
  }
});

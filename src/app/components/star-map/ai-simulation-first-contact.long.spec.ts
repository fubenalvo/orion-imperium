import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ScenarioOptions, expectHealthyAiFactions, runScenario } from './ai-simulation.harness';
import { isWarlikeFaction } from './ai-personality';

// Each scenario simulates 30 minutes of game time.
vi.setConfig({ testTimeout: 30_000 });

/*
 * First contact in skirmish (docs/first-contact.md, "Skirmish balance"):
 * real new games where nobody has met at the start. Measures when empires
 * meet, how often a meeting ends in war, and how much of the game warlike
 * and peaceful AIs spend at war, and checks the AIs stay healthy.
 * The report is printed to stdout before the assertions.
 */
describe('AI simulation — first contact (skirmish balance)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('empires meet in the first minutes, warlike meetings end in war, and every AI stays healthy', () => {
    const configs: ScenarioOptions[] = [
      { size: 'medium', aiCount: 3, seconds: 1800, dt: 1 / 30, firstContact: true, continueAfterOutcome: true },
      { size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30, seed: 4242, firstContact: true, continueAfterOutcome: true },
    ];
    const lines: string[] = [];
    const checks: { label: string; ok: boolean }[] = [];
    for (const options of configs) {
      const result = runScenario(options);
      expectHealthyAiFactions(result, options);
      const label = `${options.size}/${options.aiCount}`;
      const factions = new Map(result.data.factions.map((f) => [f.id, f]));
      const aiIds = result.data.factions.filter((f) => f.ai).map((f) => f.id);
      for (const c of result.firstContacts) {
        const tag = (id: string) => `${id}(${factions.get(id)?.aiPersonality ?? 'human'})`;
        lines.push(`${label} contact t=${Math.round(c.time / 60)}min ${tag(c.a)} – ${tag(c.b)}: ${c.state}`);
      }
      for (const id of aiIds) {
        const trace = result.traces.get(id)!;
        const firstMeeting = result.firstContacts.filter((c) => c.a === id || c.b === id).map((c) => c.time)[0];
        lines.push(`${label} ${id} ${trace.personality}: first contact ${firstMeeting === undefined ? 'never' : Math.round(firstMeeting / 60) + 'min'}, AI war ${Math.round(trace.aiWarSeconds / 60)}min, peak exhaustion ${Math.round(trace.peakExhaustion)}`);
        checks.push({ label: `${label} ${id} met someone within 20 minutes`, ok: firstMeeting !== undefined && firstMeeting <= 1200 });
      }
      const warlikePairs = result.firstContacts.filter((c) => c.a !== 'player' && c.b !== 'player'
        && isWarlikeFaction(factions.get(c.a)) && isWarlikeFaction(factions.get(c.b)));
      if (warlikePairs.length > 0) {
        checks.push({ label: `${label} warlike–warlike meetings end in war`, ok: warlikePairs.filter((c) => c.state === 'war').length >= Math.ceil(warlikePairs.length * 0.8) });
      }
      checks.push({ label: `${label} some AI war happens`, ok: aiIds.some((id) => result.traces.get(id)!.aiWarSeconds > 0) });
    }
    // console.log is mocked in these suites; the report goes straight to stdout.
    (globalThis as any).process?.stdout?.write(`\nFIRST CONTACT REPORT\n${lines.join('\n')}\n`);
    for (const check of checks) expect(check.ok, check.label).toBe(true);
  }, 600_000);
});

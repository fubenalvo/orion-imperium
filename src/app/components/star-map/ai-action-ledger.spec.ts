import { TestBed } from '@angular/core/testing';
import { AiActionLedger } from './ai-action-ledger';
import { Faction } from './star-map.models';

const ai = (id: string, extra: Partial<Faction> = {}): Faction =>
  ({ id, name: id.toUpperCase(), ai: true, currencies: { credits: 1000, rawmaterials: 50, research: 7 }, ...extra }) as Faction;

/*
 * Plays the same scripted actions (game-time stamps) with a given frame
 * length, as the AI tick feeds the ledger: one advance() per frame with the
 * saved game clock, actions recorded inside the frame.
 */
function play(ledger: AiActionLedger, dt: number, seconds: number, actionsAt: number[], faction: Faction): void {
  const pending = [...actionsAt].sort((a, b) => a - b);
  const frames = Math.ceil(seconds / dt - 1e-9);
  ledger.advance(0, 0);
  for (let frame = 1; frame <= frames; frame++) {
    // From the frame index, not a running sum, so every run ends exactly at `seconds`.
    const time = Math.min(seconds, frame * dt);
    ledger.advance(dt, time);
    while (pending.length > 0 && pending[0] <= time + 1e-9) {
      pending.shift();
      ledger.record(faction, 'building_placed');
    }
  }
}

describe('AiActionLedger', () => {
  let ledger: AiActionLedger;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ledger = TestBed.inject(AiActionLedger);
    ledger.reset();
  });

  it('counts per category and reports the rolling rate over the last 60 game seconds', () => {
    const faction = ai('a');
    ledger.advance(0, 0);
    ledger.advance(10, 10);
    ledger.record(faction, 'building_placed');
    ledger.record(faction, 'fleet_order');
    ledger.record(faction, 'tech_purchased');
    ledger.advance(60, 70);
    ledger.record(faction, 'fleet_order');
    ledger.record(faction, 'peace_offered');

    const snap = ledger.snapshot('a');
    // The actions at 10 s left the window (11..70]; the two at 70 s remain.
    expect(snap.byCategory).toEqual({ economy: 0, military: 1, research: 0, expansion: 0, diplomacy: 1 });
    expect(snap.apm).toBe(2);
    expect(snap.total).toBe(5);
    expect(snap.averageApm).toBeCloseTo((5 / 70) * 60, 1);
  });

  it('gives the same numbers at 1x and 3x speed and for any frame length', () => {
    // Off whole seconds, so the longest frame (0.5 s) records each action in the same second.
    const times = [0.5, 3.25, 3.5, 12.5, 59.25, 61.5, 75.5, 119.25, 150.5, 171.5, 178.25];
    const results = [1 / 60, 3 / 60, 1 / 20, 0.5].map((dt) => {
      ledger.reset();
      play(ledger, dt, 180, times, ai('a'));
      const report = ledger.report().factions[0];
      return { snapshot: ledger.snapshot('a'), perMinute: report.perMinute, phases: report.phases };
    });
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
    expect(results[0].perMinute.map((m) => m.economy)).toEqual([5, 3, 3]);
  });

  it('scales a window shorter than a minute up to a per-minute rate', () => {
    const faction = ai('a');
    ledger.advance(0, 0);
    ledger.advance(30, 30);
    ledger.record(faction, 'warship_queued');
    expect(ledger.snapshot('a').apm).toBe(2);
  });

  it('ignores human factions and unknown factions', () => {
    ledger.advance(1, 1);
    ledger.record({ id: 'player', name: 'You', ai: false, currencies: {} } as unknown as Faction, 'building_placed');
    ledger.record(undefined, 'building_placed');
    ledger.reject({ id: 'player', name: 'You', currencies: {} } as unknown as Faction, 'building_placed', 'x');
    expect(ledger.report().factions).toEqual([]);
    expect(ledger.snapshot('player').total).toBe(0);
  });

  it('counts a repeated rejection once per dedupe window, separately from actions', () => {
    const faction = ai('a');
    ledger.advance(0, 0);
    for (let frame = 0; frame < 300; frame++) {
      ledger.advance(1 / 60, frame / 60);
      ledger.reject(faction, 'colonizer_queued', 'no_factory');
    }
    ledger.reject(faction, 'colonizer_queued', 'insufficient_resources');
    const report = ledger.report().factions[0];
    // 5 s of retries every frame: one rejection per 2 s window (0, 2, 4) + the other reason.
    expect(report.rejectedByKind).toEqual({ colonizer_queued: 4 });
    expect(report.rejectionReasons).toEqual({ 'colonizer_queued:no_factory': 3, 'colonizer_queued:insufficient_resources': 1 });
    expect(report.total).toBe(0);
  });

  it('keeps quantities apart from action counts', () => {
    const faction = ai('a');
    ledger.advance(1, 1);
    ledger.record(faction, 'ships_deployed', 4);
    ledger.record(faction, 'ships_deployed', 2);
    const report = ledger.report().factions[0];
    expect(report.totalsByKind).toEqual({ ships_deployed: 2 });
    expect(report.quantitiesByKind).toEqual({ ships_deployed: 6 });
  });

  it('reports difficulty and personality as read at record time', () => {
    const faction = ai('a', { aiDifficulty: 'hard', aiPersonality: 'militarist' });
    ledger.advance(1, 1);
    ledger.record(faction, 'fleet_order');
    expect(ledger.report().factions[0]).toEqual(
      expect.objectContaining({ factionId: 'a', name: 'A', difficulty: 'hard', personality: 'militarist' }),
    );
    // Factions without settings use the reference profiles.
    ledger.record(ai('b'), 'fleet_order');
    expect(ledger.report().factions[1]).toEqual(expect.objectContaining({ difficulty: 'normal', personality: 'balanced' }));
  });

  it('summarises phases over the observed time only (a load mid-game starts a new observation)', () => {
    const faction = ai('a');
    // Observation starts at minute 20 (e.g. a save loaded there).
    ledger.advance(0.1, 1200);
    ledger.advance(600, 1800);
    for (let i = 0; i < 20; i++) ledger.record(faction, 'fleet_order');
    ledger.advance(600, 2400);
    const phases = ledger.report().factions[0].phases;
    expect(phases.map((p) => p.label)).toEqual(['early', 'middle', 'late']);
    expect(phases[0].observedMinutes).toBe(0);
    expect(phases[1].observedMinutes).toBeCloseTo(10, 1);
    expect(phases[2].observedMinutes).toBeCloseTo(10, 1);
    expect(phases[2].apm).toBe(2);
    expect(phases[1].apm).toBe(0);
  });

  it('samples resources once per game minute', () => {
    const faction = ai('a');
    const systems = [{ planetsTiles: [{ factionId: 'a' }, { factionId: 'a' }, { factionId: 'b' }] }] as never;
    const fleets = [{ factionId: 'a', destroyed: false, ships: [{ destroyed: false }, { destroyed: true }] }] as never;
    for (let t = 0; t <= 150; t += 0.5) {
      ledger.advance(0.5, t);
      ledger.sampleIfDue([faction, { id: 'player', ai: false, currencies: {} } as unknown as Faction], systems, fleets);
    }
    const resources = ledger.report().factions[0].resources;
    expect(resources.map((r) => r.minute)).toEqual([0, 1, 2]);
    expect(resources[0]).toEqual({ minute: 0, credits: 1000, rawmaterials: 50, research: 7, planets: 2, fleetShips: 1 });
  });

  it('keeps its memory bounded in very long games', () => {
    const faction = ai('a');
    for (let minute = 0; minute < 300; minute++) {
      ledger.advance(60, minute * 60);
      ledger.record(faction, 'fleet_order');
      ledger.sampleIfDue([faction], [], []);
    }
    const report = ledger.report().factions[0];
    expect(report.perMinute.length).toBe(AiActionLedger.MAX_MINUTES);
    expect(report.resources.length).toBe(AiActionLedger.MAX_MINUTES);
    expect(report.perMinute[0].minute).toBe(300 - AiActionLedger.MAX_MINUTES);
    expect(report.total).toBe(300);
  });

  it('reset clears every faction and the observation start', () => {
    const faction = ai('a');
    ledger.advance(5, 5);
    ledger.record(faction, 'tech_purchased');
    ledger.reset();
    expect(ledger.report().factions).toEqual([]);
    expect(ledger.observedSeconds).toBe(0);
  });
});

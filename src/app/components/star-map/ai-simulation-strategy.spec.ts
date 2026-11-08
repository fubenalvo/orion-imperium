import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { EnemyResearchService } from './enemy-research.service';
import { EnemyPlanService } from './enemy-plan.service';
import { EnemyProgressService } from './enemy-progress.service';
import { EnemyReachService } from './enemy-reach.service';
import { AiActionLedger } from './ai-action-ledger';
import {
  LEDGER_CHECK_OPTIONS,
  LeagueRow,
  NoopActionLedger,
  ScenarioOptions,
  expectHealthyAiFactions,
  gameFingerprint,
  homeSystemOf,
  leagueRows,
  longRun,
  near,
  playerFleet,
  runScenario,
  withPersonalities,
} from './ai-simulation.harness';

// Each scenario simulates minutes of game time; the default 5 s limit is
// too tight when the whole suite runs in parallel on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

describe('AI simulation — Phase 5 strategy, multiple objectives and evaluation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps colonizing while defending against a significant threat (parallel objectives)', () => {
    const options: ScenarioOptions = {
      // Premise: the AIs act against the player/neutrals, not each other.
      aiAlliance: true,
      // 20 minutes: Normal AIs start with 2 frigates only (2026-11), so
      // the defense against the two cruisers takes longer to build, and
      // construction time (docs/planet-construction.md) delays the second
      // colonizer's factory and Spaceport.
      size: 'medium', aiCount: 2, seconds: 1200, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        withPersonalities(['balanced'])(data);
        // This scenario is about objective handling, not the economy: a
        // stockpile lets the AI build its defense at the pace the scenario was
        // calibrated for before finite raw materials and pricier colonizers
        // and research (docs/economy.md) made fleets grow more slowly.
        // 30000 credits since the colony cores (2026-11): pricier housing used
        // up 20000 before the second colonizer.
        for (const faction of data.factions.filter((x) => x.ai)) {
          faction.currencies['rawmaterials'] = 20000;
          faction.currencies['credits'] = 30000;
        }
        // A cruiser parked 4 cells from enemy1's home: a 'defend' strategy
        // trigger. One cruiser outguns the Normal AI's 2 starting frigates
        // (2026-11); two made the threat so large that defense took most of
        // the run.
        const home = homeSystemOf(data, 'enemy1');
        const pos = near(data, home, 4, 0);
        data.fleets.push(playerFleet(pos.x, pos.y, 'cruiser', 1));
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const trace = result.traces.get('enemy1')!;
    // The pipeline spent time in 'defend' (the strategy that used to cancel colonization).
    expect(trace.strategies.filter((st) => st === 'defend').length, 'defend strategy active').toBeGreaterThan(0);
    expect(trace.colonizations, 'enemy1 colonized in parallel').toBeGreaterThanOrEqual(2);
    // The defense objective ran too: the intruder was engaged.
    expect(trace.contacts.length, 'enemy1 engaged the intruder').toBeGreaterThan(0);
  });

  it('detects a fleet that cannot complete its order and replans instead of waiting forever', () => {
    const options: ScenarioOptions = {
      // 10 minutes: with building construction time the AI's first orders
      // for its fleets come later (2026-11); 5 minutes no longer reached them.
      size: 'medium', aiCount: 2, seconds: 600, dt: 1 / 60, removePlayerFleets: true,
      prepare: (data) => {
        // A crippled fleet (speed 0) away from home will be ordered to garrison but can never move.
        const fleet = data.fleets.find((f) => f.factionId === 'enemy1')!;
        fleet.speed = 0;
        fleet.x += 9;
      },
    };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const stuck = TestBed.inject(EnemyProgressService).getEvents().filter((e) => e.factionId === 'enemy1' && e.type === 'stuck_fleet');
    expect(stuck.length, 'stuck fleet detected').toBeGreaterThan(0);
    // Detection is throttled (one per stuck window), not every frame.
    expect(stuck.length).toBeLessThanOrEqual(600 / 30 + 1);
    // The rest of the faction keeps making progress.
    expect(result.traces.get('enemy1')!.colonizations).toBeGreaterThanOrEqual(1);
  });

  it('evaluation league: every faction stays active, grows, researches and avoids deadlocks across sizes, difficulties and counts', () => {
    const configs: ScenarioOptions[] = [
      { size: 'small', aiCount: 2, seconds: 900, dt: 1 / 30, difficulty: 'easy' },
      { size: 'small', aiCount: 2, seconds: 900, dt: 1 / 30, difficulty: 'hard' },
      { size: 'medium', aiCount: 3, seconds: 1200, dt: 1 / 30 },
      { size: 'large', aiCount: 5, seconds: 900, dt: 1 / 30, seed: 4242 },
    ];
    const totals = new Map<string, number>();
    for (const options of configs) {
      const result = runScenario({ resolvePlayerFleetBattles: true, ...options });
      expectHealthyAiFactions(result, options);
      const rows = leagueRows(result, options);
      const label = `${options.size}/${options.aiCount}/${options.difficulty ?? 'normal'}`;
      for (const row of rows) {
        const who = `${label} ${row.factionId} (${row.personality})`;
        expect(row.inactiveWindows, `${who} inactive 5-minute windows`).toBe(0);
        expect(row.planetsEnd, `${who} planet growth`).toBeGreaterThan(row.planetsStart);
        // Research costs are balanced for a long tree (research-tree.json) and
        // cost 4 credits per point, so short runs see few technologies (an
        // Easy militarist on a small map: 4).
        expect(row.techs, `${who} technologies`).toBeGreaterThanOrEqual(4);
        expect(row.deadlocks, `${who} deadlock replans`).toBeLessThanOrEqual(3);
        expect(row.creditsSpent, `${who} spends resources`).toBeGreaterThan(0);
      }
      // End state, not effort: Easy starts with fewer ships and therefore builds more.
      totals.set(label, rows.reduce((sum, r) => sum + r.planetsEnd * 10 + r.techs + r.livingStrength / 50, 0));
    }
    // Same map and seed: Hard (better judgment + income) outperforms Easy.
    expect(totals.get('small/2/hard')!).toBeGreaterThan(totals.get('small/2/easy')!);
  });

  it('regression: on a sparse large map every faction keeps expanding (adaptive reach)', () => {
    // Seed 4242 (large, 5 AIs) left two factions with nothing in the fixed
    // 60-cell reach: one colony each in 15 minutes, then 'develop' forever.
    // The passive stand-in player can be eliminated mid-run; the AIs keep playing.
    // 25 minutes: the reach widens in steps over time, and since the colony
    // cores (2026-11) the sparse faction needs the full widening (reached
    // ~20–25 minutes in). 30 minutes since building construction time
    // (2026-11) slowed every faction's expansion and so the widening.
    const options: ScenarioOptions = { size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30, seed: 4242, continueAfterOutcome: true };
    const result = runScenario(options);
    expectHealthyAiFactions(result, options);
    const reach = TestBed.inject(EnemyReachService);
    for (const [factionId, trace] of result.traces) {
      expect(trace.colonizations, `${factionId} colonizations`).toBeGreaterThanOrEqual(1);
      // Since the colony cores (2026-11) the neighbours expand faster and can
      // take every planet in the sparse faction's reach (measured: enemy2's
      // nearest free system 127 cells away, maximum reach 120). A faction
      // with fewer than two colonies must therefore not be stuck: either it
      // widened its reach all the way, or it has a target in reach again
      // (expansion score > 0). Since building construction time (2026-11)
      // the second case is common: enemy2 widened to 1.25, found targets and
      // simply colonizes more slowly.
      if (trace.colonizations < 2) {
        const posture = TestBed.inject(EnemyPlanService).getPosture(result.data.factions.find((f) => f.id === factionId));
        const widenedFully = reach.getBonus(factionId) === EnemyReachService.MAX_BONUS;
        expect(widenedFully || posture.scores.expansion > 0, `${factionId} has a target in reach or widened its reach fully`).toBe(true);
      }
    }
    expect([...result.traces.keys()].some((id) => reach.getBonus(id) > 1), 'some faction widened its reach').toBe(true);
  });

  it('personalities produce different, valid strategies on the same map', () => {
    const run = (personality: string) => {
      const options: ScenarioOptions = {
        // Compares personalities in isolation: a war between the two AIs
        // (random winner, lost colonies) would dominate the differences.
        aiAlliance: true,
        size: 'medium', aiCount: 2, seconds: 900, dt: 1 / 30, removePlayerFleets: true,
        prepare: withPersonalities([personality]),
      };
      const result = runScenario(options);
      expectHealthyAiFactions(result, options);
      return leagueRows(result, options);
    };
    const militarist = run('militarist');
    const expansionist = run('expansionist');
    const technologist = run('technologist');
    const sum = (rows: LeagueRow[], key: keyof LeagueRow) => rows.reduce((total, r) => total + (r[key] as number), 0);

    expect(sum(militarist, 'combatBuilt'), 'militarists build more warships').toBeGreaterThan(sum(expansionist, 'combatBuilt'));
    expect(sum(expansionist, 'colonizations'), 'expansionists colonize at least as much').toBeGreaterThanOrEqual(sum(militarist, 'colonizations'));
    // Research cost grows with every technology and credits (4 per point)
    // are every faction's research bottleneck, so the number of technologies
    // rewards buying cheap ones. Research volume (base cost acquired) is the
    // measure of research investment: technologists fund research before
    // expansion and keep a smaller navy (fundsResearchFirst, militaryTarget),
    // and must clearly out-research militarists.
    expect(sum(technologist, 'researchVolume'), 'technologists research clearly more')
      .toBeGreaterThanOrEqual(1.1 * sum(militarist, 'researchVolume'));
  });
});

describe('AI simulation — Phase 6 long-duration stability and performance', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AT-15: performance with the maximum number of factions and entities', () => {
    const { result } = longRun({ size: 'large', aiCount: 5, seconds: 1800, dt: 1 / 30 });
    const ships = result.data.fleets.filter((f) => !f.destroyed).reduce((n, f) => n + f.ships.filter((s) => !s.destroyed).length, 0);
    const planets = result.data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId !== 'unhabited').length;
    // Navies are smaller since ship upkeep grows with hull size (2026-11),
    // and again since the colony cores (more colonies, credits bind): ~90
    // ships and ~36 planets at 30 minutes (116 and 32 before). Building
    // construction time (2026-11) slows the build-up again: ~72 ships.
    expect(ships, 'entity count reached').toBeGreaterThan(60);
    expect(planets).toBeGreaterThan(15);
    // Measured AI cost per frame (all five factions together).
    expect(result.aiTickMs.perFrame, 'average AI ms per frame').toBeLessThan(2);
    expect(result.aiTickMs.max, 'worst AI frame (ms)').toBeLessThan(100);
  }, 60_000);
});

describe('AI simulation — action ledger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is observational: a game with a no-op ledger ends in exactly the same state', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const measured = runScenario(LEDGER_CHECK_OPTIONS);
    const report = TestBed.inject(AiActionLedger).report();
    const research = new Map(measured.data.factions.filter((f) => f.ai).map((f) => [f.id, TestBed.inject(EnemyResearchService).getResearchHistory(f.id).length] as const));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AiActionLedger, useClass: NoopActionLedger }] });
    const unmeasured = runScenario(LEDGER_CHECK_OPTIONS);

    expect(gameFingerprint(unmeasured.data)).toBe(gameFingerprint(measured.data));

    // Counted once per commit: the ledger agrees with independent counts.
    expect(report.factions.length).toBe(3);
    for (const faction of report.factions) {
      const trace = measured.traces.get(faction.factionId)!;
      const who = `${faction.factionId} (${faction.personality})`;
      expect(faction.totalsByKind.tech_purchased ?? 0, `${who} technologies`).toBe(research.get(faction.factionId));
      expect(faction.totalsByKind.colonized ?? 0, `${who} colonizations`).toBe(trace.colonizations);
      // A living economy, navy and research program show up in every category but diplomacy.
      for (const category of ['economy', 'military', 'research', 'expansion'] as const) {
        expect(faction.totalsByCategory[category], `${who} ${category} actions`).toBeGreaterThan(0);
      }
      expect(faction.observedSeconds).toBeCloseTo(LEDGER_CHECK_OPTIONS.seconds, 0);
      // One sample per game minute (the last frame may end just before the final minute starts).
      expect(faction.resources.length).toBeGreaterThanOrEqual(LEDGER_CHECK_OPTIONS.seconds / 60);
    }
  }, 600_000);
});

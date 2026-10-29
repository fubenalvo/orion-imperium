import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { createDefaultNewGameConfig } from '../../services/new-game-config';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { EnemyIntelService } from './enemy-intel.service';
import { EnemyFleetService } from './enemy-fleet.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyInvasionService } from './enemy-invasion.service';
import { Battle } from '../battle-screen/battle/battle.types';

/*
 * Regression: returning from the battle screen recreates StarMap, which
 * reloads the autosave. That reload used to reset the whole AI pipeline, so
 * every battle erased AI exploration, sightings, assaults and failed-target
 * memory. A battle return must keep it; genuine loads must still reset it.
 */
describe('StarMap battle return keeps AI memory', () => {
  const NEW_GAME_SLOT = 1;

  const createStarMap = (): StarMap => {
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };

  const run = (map: StarMap, seconds: number, dt = 0.1): void => {
    for (let t = 0; t < seconds; t += dt) {
      map['gameLoopCallback'](dt);
    }
  };

  const aiIds = (map: StarMap) => map.factions.filter((f) => f.ai).map((f) => f.id);

  // Private AI memory read the same way ai-simulation.spec.ts measures state sizes.
  const fleetOps = () => TestBed.inject(EnemyFleetService) as any;
  const goals = () => TestBed.inject(EnemyGoalService) as any;
  const knownSystems = (map: StarMap) =>
    aiIds(map).map((id) => TestBed.inject(EnemyIntelService).summary(id, map.starSystems.length).knownSystems);

  /* Plays four minutes, then seeds remembered failures with known retry times. */
  const playAndRemember = (): StarMap => {
    TestBed.inject(NewGameService).startNewGame({ ...createDefaultNewGameConfig('medium'), seed: 4711 }, NEW_GAME_SLOT);
    const map = createStarMap();
    run(map, 240);
    fleetOps().failedAssaults.set('enemy1:990001', 777);
    goals().failedColonizeTargets.set('enemy1', new Map([[990002, 888]]));
    return map;
  };

  /* The real battle-screen round trip: enterBattleScreen, then a new StarMap on /star-map. */
  const battleRoundTrip = (map: StarMap): StarMap => {
    map['enterBattleScreen']();
    return createStarMap();
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps exploration, goals, failed targets and their retry timers across a battle return', () => {
    const first = playAndRemember();
    const charted = knownSystems(first);
    expect(charted.some((n) => n > 1), 'AI explored beyond its home').toBe(true);
    const goalsBefore = aiIds(first).map((id) => TestBed.inject(EnemyGoalService).getGoal(id));
    const fleetClock = fleetOps().clocks.get('enemy1');

    const second = battleRoundTrip(first);

    expect(knownSystems(second)).toEqual(charted);
    expect(aiIds(second).map((id) => TestBed.inject(EnemyGoalService).getGoal(id))).toEqual(goalsBefore);
    expect(fleetOps().failedAssaults.get('enemy1:990001'), 'failed assault + retry time').toBe(777);
    expect(goals().failedColonizeTargets.get('enemy1')?.get(990002), 'failed colonization + retry time').toBe(888);
    // The retry timers expire on the same clock: it continues, it is not restarted.
    expect(fleetOps().clocks.get('enemy1')).toBe(fleetClock);

    // The AI keeps running on the reloaded objects, not on the previous load's.
    run(second, 10);
    const intel = TestBed.inject(EnemyIntelService);
    for (const faction of second.factions.filter((f) => f.ai)) {
      const own = intel.getView(faction, second.starSystems, second.fleets).fleets.filter((f) => f.factionId === faction.id);
      expect(own.length, `${faction.id} own fleets in view`).toBeGreaterThan(0);
      expect(own.every((f) => second.fleets.includes(f)), `${faction.id} view uses reloaded fleets`).toBe(true);
    }
    knownSystems(second).forEach((n, i) => expect(n).toBeGreaterThanOrEqual(charted[i]));
  });

  it('still resets AI memory for a genuine load and for a new game', () => {
    const first = playAndRemember();
    const second = battleRoundTrip(first);
    expect(fleetOps().failedAssaults.get('enemy1:990001')).toBe(777);

    // Pause-menu load of a manual slot: a different session state.
    second.loadFromMenu(NEW_GAME_SLOT);
    expect(fleetOps().failedAssaults.size).toBe(0);
    expect(goals().failedColonizeTargets.size).toBe(0);
    expect(knownSystems(second).every((n) => n === 0)).toBe(true);

    // Re-entering the map without a battle (e.g. Continue from the main menu).
    run(second, 60);
    fleetOps().failedAssaults.set('enemy1:990001', 777);
    createStarMap();
    expect(fleetOps().failedAssaults.size).toBe(0);

    // A new game started after a battle return.
    const third = battleRoundTrip(createStarMap());
    fleetOps().failedAssaults.set('enemy1:990001', 777);
    TestBed.inject(NewGameService).startNewGame({ ...createDefaultNewGameConfig('small'), seed: 99 }, 2);
    const fresh = createStarMap();
    expect(fleetOps().failedAssaults.size).toBe(0);
    expect(knownSystems(fresh).every((n) => n === 0)).toBe(true);
    expect(third).toBeDefined();
  });

  it('re-queues player battles that were queued but not fought before the battle screen opened', () => {
    const invasion = TestBed.inject(EnemyInvasionService) as any;
    const fleets = fleetOps();
    invasion.pendingPlayerBattles.push({ planetId: 42 } as Battle);
    fleets.assignments.set(7, { role: 'assault', planetId: 42, launched: true, since: 0 });
    // The battle that was just fought is no longer queued; its result must still be read.
    fleets.assignments.set(8, { role: 'assault', planetId: 43, launched: true, since: 0 });

    TestBed.inject(StarMapAiTickService).resumeAfterBattle();

    expect(invasion.hasPendingBattleFor(42), 'stale Battle object dropped').toBe(false);
    expect(fleets.assignments.get(7).launched, 'unfought assault launches again').toBe(false);
    expect(fleets.assignments.get(8).launched, 'fought assault reads its result').toBe(true);
  });
});

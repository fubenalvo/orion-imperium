import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { StarMap } from './star-map';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { SaveGameService } from '../../services/save-game.service';
import { NewGameService } from '../../services/new-game.service';
import { addPlayer, createDefaultNewGameConfig } from '../../services/new-game-config';
import { NewGameConfig } from '../../services/new-game.models';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { EnemyActionService } from './enemy-action.service';
import { EnemyGoalService } from './enemy-goal.service';
import { EnemyIntelService } from './enemy-intel.service';
import { EnemyDebugService } from './enemy-debug.service';

/*
 * =========================================================
 * AI ACCEPTANCE — REAL STAR MAP SESSIONS
 * =========================================================
 *
 * End-to-end checks through the real StarMap component, NewGameService
 * and SaveGameService (localStorage). The frame loop is driven by calling
 * StarMap.gameLoopCallback directly; battle-screen navigation is stubbed
 * (a hostile contact would open the battle screen). Long multi-faction
 * behavior is covered by ai-simulation.spec.ts; this file covers what only
 * a real session exercises: new-game setup, the real save/load path, the
 * dirty/autosave cadence and the debug panel.
 */
describe('AI acceptance (real StarMap sessions)', () => {
  let saves: SaveGameService;

  const createStarMap = (): StarMap => {
    const fixture = TestBed.createComponent(StarMap);
    const map = fixture.componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    vi.spyOn(map as any, 'enterBattleScreen').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };

  const startGame = (config: NewGameConfig): void => {
    const result = TestBed.inject(NewGameService).startNewGame(config, 1);
    expect(result.ok).toBe(true);
  };

  const run = (map: StarMap, seconds: number, dt = 0.05): void => {
    for (let t = 0; t < seconds; t += dt) {
      map['gameLoopCallback'](dt);
    }
  };

  const aiIds = (map: StarMap) => map.factions.filter((f) => f.ai).map((f) => f.id);

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    saves = TestBed.inject(SaveGameService);
    saves.currentSlot = null;
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('AT-01/02: a new game with five AI factions initializes, and every faction plans independently', () => {
    let config: NewGameConfig = { ...createDefaultNewGameConfig('large'), seed: 777 };
    while (config.players.length < 6) config = addPlayer(config);
    const difficulties = ['easy', 'normal', 'hard', 'hard', 'normal'] as const;
    config.players.filter((p) => p.controller === 'ai').forEach((p, i) => (p.difficulty = difficulties[i]));
    startGame(config);
    const map = createStarMap();

    const ai = map.factions.filter((f) => f.ai);
    expect(ai.map((f) => f.aiDifficulty)).toEqual([...difficulties]);
    expect(new Set(ai.map((f) => f.aiPersonality)).size).toBeGreaterThanOrEqual(3);
    for (const faction of ai) {
      expect(map.starSystems.flatMap((s) => s.planetsTiles).some((p) => p.factionId === faction.id), `${faction.id} homeworld`).toBe(true);
      expect(map.fleets.some((f) => f.factionId === faction.id), `${faction.id} fleets`).toBe(true);
    }

    run(map, 60);

    const goals = TestBed.inject(EnemyGoalService);
    const actions = TestBed.inject(EnemyActionService);
    const intel = TestBed.inject(EnemyIntelService);
    for (const faction of ai) {
      expect(goals.getGoal(faction.id) ?? goals.getColonizationGoal(faction.id), `${faction.id} goal`).toBeDefined();
      expect(actions.getAction(faction.id), `${faction.id} action`).toBeDefined();
      expect(intel.summary(faction.id, map.starSystems.length).knownSystems, `${faction.id} charted`).toBeGreaterThanOrEqual(1);
    }
    // Independent decisions: over a few minutes each faction's decision state
    // (priority, goals, actions, fleet roles — faction-specific ids removed)
    // differs from at least one other faction's, and no two factions ever
    // pursue the same colonization target.
    const debug = TestBed.inject(EnemyDebugService);
    const states = new Set<string>();
    for (let minute = 0; minute < 4; minute++) {
      run(map, 60);
      const snapshots = debug.snapshots(map);
      for (const s of snapshots) {
        states.add(JSON.stringify([s.priority, s.strategy, s.goal.split(' ')[0], s.action.split(' ')[0], s.fleets.map((f) => f.role).sort()]));
      }
      const targets = ai
        .flatMap((f) => [goals.getGoal(f.id), goals.getColonizationGoal(f.id)])
        .filter((g) => g?.type === 'colonize')
        .map((g) => (g as { targetPlanetId: number }).targetPlanetId);
      expect(new Set(targets).size, 'distinct colonization targets').toBe(targets.length);
    }
    expect(states.size).toBeGreaterThan(1);
  });

  it('AT-11: save/load during AI activity resumes without duplicates or lost progress', () => {
    startGame({ ...createDefaultNewGameConfig('medium'), seed: 4711 });
    const first = createStarMap();
    run(first, 240);
    first['saveGame']();
    const before = {
      buildings: new Map(aiIds(first).map((id) => [id, first.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === id).reduce((n, p) => n + p.buildings.length, 0)] as const)),
      shipIds: first.fleets.flatMap((f) => f.ships.map((s) => s.id)),
    };

    // Re-open the session from the autosave (fresh component, AI pipeline reset).
    const second = createStarMap();
    expect(second.fleets.flatMap((f) => f.ships.map((s) => s.id))).toEqual(before.shipIds);
    run(second, 10);
    const actions = TestBed.inject(EnemyActionService);
    for (const id of aiIds(second)) {
      expect(actions.getAction(id), `${id} resumed within 10 s`).toBeDefined();
    }
    run(second, 290);

    const ships = [...second.fleets.flatMap((f) => f.ships), ...second.shipStock.flatMap((s) => s.ships)].map((s) => s.id);
    expect(new Set(ships).size, 'unique ship ids').toBe(ships.length);
    const fleetIds = second.fleets.map((f) => f.id);
    expect(new Set(fleetIds).size, 'unique fleet ids').toBe(fleetIds.length);
    const orderIds = second.production.flatMap((p) => Object.values(p.ordersByPlanet).flat()).map((o) => o.id);
    expect(new Set(orderIds).size, 'unique production orders').toBe(orderIds.length);
    for (const faction of second.factions.filter((f) => f.ai)) {
      const techs = faction.researchedTechnologies ?? [];
      expect(new Set(techs).size, `${faction.id} unique techs`).toBe(techs.length);
      expect(faction.currencies['credits'], `${faction.id} credits`).toBeGreaterThanOrEqual(0);
      const buildingsNow = second.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === faction.id).reduce((n, p) => n + p.buildings.length, 0);
      expect(buildingsNow, `${faction.id} kept developing after the load`).toBeGreaterThan(before.buildings.get(faction.id)!);
      // Every owned planet still belongs to a real faction.
    }
    const factionIds = new Set(second.factions.map((f) => f.id));
    expect(second.starSystems.flatMap((s) => s.planetsTiles).every((p) => factionIds.has(p.factionId))).toBe(true);
  });

  it('AT-11: unchanged AI state does not keep the save dirty (autosave cadence)', () => {
    startGame({ ...createDefaultNewGameConfig('small'), seed: 99 });
    const map = createStarMap();
    run(map, 600, 0.1);
    const aiTick = TestBed.inject(StarMapAiTickService);
    const tick = aiTick.tick.bind(aiTick);
    let changedFrames = 0;
    let frames = 0;
    vi.spyOn(aiTick, 'tick').mockImplementation((dt, data) => {
      frames++;
      const changed = tick(dt, data);
      if (changed) changedFrames++;
      return changed;
    });
    run(map, 120, 0.1);
    expect(frames).toBeGreaterThan(1000);
    // Late game: the AI reports a state change on a small minority of frames.
    expect(changedFrames / frames).toBeLessThan(0.05);
  });

  it('AT-14: the AI view of a real game hides player fleets outside its sensors', () => {
    startGame({ ...createDefaultNewGameConfig('medium'), seed: 31337 });
    const map = createStarMap();
    run(map, 2);
    const intel = TestBed.inject(EnemyIntelService);
    expect(intel.enabled).toBe(true);
    const enemy1 = map.factions.find((f) => f.id === 'enemy1')!;
    const view = intel.getView(enemy1, map.starSystems, map.fleets);
    const playerFleets = map.fleets.filter((f) => f.factionId === 'player');
    expect(playerFleets.length).toBeGreaterThan(0);
    for (const fleet of playerFleets) {
      expect(view.fleets.includes(fleet)).toBe(intel.isVisible('enemy1', fleet.id));
    }
    expect(view.fleets.some((f) => f.factionId === 'player')).toBe(false);
    expect(intel.summary('enemy1', map.starSystems.length).knownSystems).toBeLessThan(map.starSystems.length);
  });

  it('AI debug panel: F9 toggles it and snapshots expose every faction\'s state', () => {
    startGame({ ...createDefaultNewGameConfig('medium'), seed: 4711 });
    const map = createStarMap();
    // Long enough for a first completed action under the economy rules
    // (the first factory is affordable after ~40 s).
    run(map, 90);
    expect(map.aiDebugVisible).toBe(false);
    map.handleKeyboard(new KeyboardEvent('keydown', { key: 'F9' }));
    expect(map.aiDebugVisible).toBe(true);
    expect(map.aiDebugSnapshots.map((s) => s.factionId)).toEqual(aiIds(map));
    const snapshot = map.aiDebugSnapshots[0];
    for (const key of ['priority', 'strategy', 'goal', 'action', 'colonizationGoal', 'fleets', 'shortages', 'recentReplans', 'secondsSinceProgress', 'intel'] as const) {
      expect(snapshot[key], key).toBeDefined();
    }
    expect(snapshot.lastCompleted, 'last completed action').toBeDefined();
    // Console output is off by default.
    expect(TestBed.inject(EnemyDebugService).consoleEnabled).toBe(false);
    map.handleKeyboard(new KeyboardEvent('keydown', { key: 'F9' }));
    expect(map.aiDebugVisible).toBe(false);
  });
});

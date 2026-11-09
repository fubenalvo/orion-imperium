import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../components/star-map/star-map';
import { StarMapGameLoopService } from '../components/star-map/star-map-game-loop.service';
import { SaveGameService, SaveSlotId } from '../services/save-game.service';
import { GameOutcomeService } from '../services/game-outcome.service';
import { ResearchService } from '../services/research.service';
import { PirateIncursionService } from '../components/star-map/pirate-incursion';
import { GameTimeService } from '../services/game-time.service';
import { CampaignMissionService } from './campaign-mission.service';
import { CampaignService } from './campaign.service';
import { CampaignProgressService } from './campaign-progress.service';
import { buildMission } from './mission-builder';
import { M0_FIXTURE } from './missions/m0-fixture';

/*
 * The campaign engine in a real StarMap session (docs/campaign-design.md,
 * Phase 1a acceptance): start from the mission service, objectives through
 * state changes and events, save/load, the battle-screen round trip, the
 * mission outcome, and normal games left untouched.
 */
describe('Campaign session in StarMap', () => {
  const SLOT = 1;

  const createStarMap = (): StarMap => {
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };
  const run = (map: StarMap, seconds: number, dt = 0.25): void => {
    for (let t = 0; t < seconds; t += dt) map['gameLoopCallback'](dt);
  };
  const autosave = () => TestBed.inject(SaveGameService).loadFromSlot(SaveSlotId.AUTOSAVE)!;
  const campaign = () => TestBed.inject(CampaignService);
  const start = (): StarMap => {
    const result = TestBed.inject(CampaignMissionService).startMission('m0_fixture', 'normal', SLOT);
    expect(result.ok).toBe(true);
    return createStarMap();
  };
  const chartProxima = (map: StarMap) => map['exploredGridCells'].add('70-26');
  const killSentinel = (map: StarMap) => {
    const sentinel = map.fleets.find((f) => f.name === 'SENTINEL')!;
    sentinel.ships.forEach((s) => (s.destroyed = true));
    sentinel.destroyed = true;
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
    TestBed.inject(GameOutcomeService).reset();
  });

  afterEach(() => {
    campaign().leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('does not end a mission without AI empires on the first frames (the standard victory would)', () => {
    const map = start();
    expect(campaign().active).toBe(true);
    run(map, 5);
    expect(map.gameOutcome).toBe('inProgress');
    // The standard rules alone would call this a victory: every inhabited planet is the player's.
    const data = autosave();
    expect(TestBed.inject(GameOutcomeService).evaluateOutcome(data.factions, data.starSystems, data.fleets)).toBe('victory');
  });

  it('completes objectives from the world, saves them at once and keeps them across a reload', () => {
    const map = start();
    run(map, 2);
    chartProxima(map);
    run(map, 1.5);
    expect(campaign().state!.objectives['chart_proxima'].status).toBe('done');
    expect(autosave().campaign!.objectives['chart_proxima'].status, 'saved immediately').toBe('done');

    const reloaded = createStarMap();
    expect(campaign().state!.objectives['chart_proxima'].status).toBe('done');
    expect(campaign().state!.objectives['destroy_sentinel'].status).toBe('active');
    run(reloaded, 2);
    expect(reloaded.gameOutcome).toBe('inProgress');
  });

  it('survives the battle-screen round trip without replaying rewards', () => {
    const map = start();
    run(map, 2);
    const player = () => map.factions.find((f) => f.id === 'player')!;
    player().researchedTechnologies!.push('basic_radar');
    run(map, 1.5);
    const credits = autosave().factions.find((f) => f.id === 'player')!.currencies['credits'];
    expect(campaign().state!.objectives['research_radar'].status).toBe('done');

    map['enterBattleScreen']();
    const after = createStarMap();
    run(after, 3);
    expect(campaign().state!.objectives['research_radar'].status).toBe('done');
    const creditsAfter = after.factions.find((f) => f.id === 'player')!.currencies['credits'];
    // Income keeps flowing, but the 500-credit reward must not be paid a second time.
    expect(creditsAfter - credits).toBeLessThan(500);
  });

  it('wins through the event choice, records progress and shows the mission ending', () => {
    const map = start();
    run(map, 2);
    chartProxima(map);
    run(map, 1.5);
    killSentinel(map);
    run(map, 1.5);
    expect(campaign().pendingEvent?.id).toBe('sentinel_down');

    const result = campaign().chooseEventOption('sentinel_down', 'report', map['campaignWorld']());
    map['applyCampaignResult'](result);
    expect(map.gameOutcome).toBe('victory');
    expect(autosave().gameOutcome).toBe('victory');
    expect(map.campaignEndText).toBe('Range Cleared. The engine works.');
    expect(TestBed.inject(CampaignProgressService).getRecord('m0_fixture')?.endingId).toBe('cleared');
  });

  it('loses through a mission defeat condition', () => {
    const map = start();
    run(map, 2);
    (campaign().state as any).flags['force_defeat'] = true;
    run(map, 1.5);
    expect(map.gameOutcome).toBe('defeat');
    expect(map.campaignEndText).toBe('Test defeat.');
  });

  it('switches pirates off and applies the research horizon in the mission', () => {
    const tick = vi.spyOn(TestBed.inject(PirateIncursionService), 'tick');
    const map = start();
    run(map, 2);
    expect(tick).not.toHaveBeenCalled();
    const research = TestBed.inject(ResearchService);
    const player = map.factions.find((f) => f.id === 'player')!;
    expect(research.getResearchBlocker(player, 'advanced_engineering')).toBe('outside_horizon');
  });

  it('counts a battle the player won', () => {
    const map = start();
    run(map, 1);
    const orion = map.fleets.find((f) => f.name === 'ORION')!;
    const sentinel = map.fleets.find((f) => f.name === 'SENTINEL')!;
    map['notifyCampaignBattle']({
      winnerSide: 'attacker', winnerFleetId: orion.id, loserFleetId: sentinel.id,
      attacker: { fleetId: orion.id } as any, defender: { fleetId: sentinel.id } as any,
      rounds: 1, battleType: 'fleet',
    });
    run(map, 1.5);
    expect(campaign().state!.counters.battle_won).toBe(1);
  });

  it('opens the story message paused, and resumes the game after the answer', () => {
    const map = start();
    run(map, 2);
    chartProxima(map);
    run(map, 1.5);
    killSentinel(map);
    run(map, 1.5);
    const time = TestBed.inject(GameTimeService);
    expect(map.campaignMessage?.eventId).toBe('sentinel_down');
    expect(map.campaignMessage?.speakerName).toBe('Mission Control');
    expect(time.isPaused).toBe(true);
    map.onCampaignChoice('report');
    expect(map.campaignMessage).toBeNull();
    expect(map.gameOutcome).toBe('victory');
    expect(map.nextMissionId, 'the fixture unlocks no story mission').toBeNull();
  });

  it('re-opens a pending message after a reload', () => {
    const map = start();
    run(map, 2);
    chartProxima(map);
    run(map, 1.5);
    killSentinel(map);
    run(map, 1.5);
    const reloaded = createStarMap();
    expect(reloaded.campaignMessage).toBeNull();
    run(reloaded, 0.25);
    expect(reloaded.campaignMessage?.eventId).toBe('sentinel_down');
  });

  it('refreshes the objective tracker on the economy tick', () => {
    const map = start();
    run(map, 2);
    expect(map.campaignObjectives.map((o) => o.id)).toEqual(['chart_proxima', 'research_radar']);
    expect(map.campaignMissionTitle).toBe('Proving Ground');
  });

  it('after a defeat: lists the saves of this mission, loads one, or restarts the mission', () => {
    const map = start();
    run(map, 2);
    (campaign().state as any).flags['force_defeat'] = true;
    run(map, 1.5);
    expect(map.gameOutcome).toBe('defeat');
    expect(map.campaignSaveSlots.map((s) => s.index)).toEqual([SLOT]);

    map.loadMissionSave(SLOT);
    expect(map.gameOutcome).toBe('inProgress');
    expect(campaign().state!.flags['force_defeat']).toBeUndefined();

    (campaign().state as any).flags['force_defeat'] = true;
    run(map, 1.5);
    expect(map.gameOutcome).toBe('defeat');
    map.restartMission();
    expect(map.gameOutcome).toBe('inProgress');
    expect(campaign().state!.missionId).toBe('m0_fixture');
    expect(autosave().gameSeconds).toBe(0);
  });

  it('leaves a normal game without campaign rules after a campaign was played', () => {
    start();
    const skirmish = buildMission(M0_FIXTURE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });
    delete skirmish.campaign;
    TestBed.inject(SaveGameService).saveToSlot(2, skirmish);
    TestBed.inject(SaveGameService).activateSlot(2);
    createStarMap();
    expect(campaign().active).toBe(false);
    expect(TestBed.inject(ResearchService).hasCampaignHorizon()).toBe(false);
  });
});

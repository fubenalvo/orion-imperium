import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph } from '../../components/star-map/fleet-navigation';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { TutorialService } from '../../services/tutorial.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateMission } from '../mission-validation';
import { M1_DISCOVERY } from './m1-discovery';

/* Mission 1 — The Discovery: its map rules, and a scripted playthrough. */
describe('Mission 1: The Discovery', () => {
  const build = () => buildMission(M1_DISCOVERY, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map', () => {
    it('is valid and has the design counts: 3 systems, 5 planets, 1 anomaly, 1 belt, 1 wormhole, no empire', () => {
      expect(validateMission(M1_DISCOVERY)).toEqual([]);
      const data = build();
      expect(data.starSystems.length).toBe(3);
      expect(data.starSystems.flatMap((s) => s.planetsTiles).length).toBe(5);
      expect(data.anomalies?.anomalies.map((a) => [a.key, a.type, a.status])).toEqual([['m1_probe', 'probe_wreck', 'hidden']]);
      expect(data.asteroidBelts?.length).toBe(1);
      expect(data.wormholes?.map((w) => w.id)).toEqual(['kepler_lens']);
      expect(data.factions.filter((f) => f.ai)).toEqual([]);
      expect(data.specialObjects, 'no black hole: Dyson off').toEqual([]);
      expect(data.tutorial).toEqual({ enabled: true, done: [] });
    });

    it('forces the route from Sol to Kepler Deep around the belt', () => {
      const graph = new NavGraph(beltObstacles(M1_DISCOVERY.map.asteroidBelts), { width: 100, height: 60 });
      const plan = graph.plan({ x: 22, y: 34 }, { x: 80, y: 38 });
      expect(plan.ok).toBe(true);
      expect(plan.ok && plan.waypoints.length, 'a detour, not a straight line').toBeGreaterThan(0);
    });

    it('puts the sentinel on the lens mouth, inside the area the probe reveals', () => {
      const data = build();
      const sentinel = data.fleets.find((f) => f.name === 'SENTINEL')!;
      const mouth = data.wormholes![0].mouths[0];
      expect([sentinel.x, sentinel.y]).toEqual([mouth.x, mouth.y]);
      expect(data.factions.find((f) => f.id === sentinel.factionId)?.outlaw).toBe(true);
      expect(Math.hypot(mouth.x - 82, mouth.y - 39)).toBeLessThanOrEqual(6);
    });
  });

  describe('playthrough in StarMap', () => {
    const createStarMap = (): StarMap => {
      const map = TestBed.createComponent(StarMap).componentInstance;
      vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
      map.ngOnInit();
      return map;
    };
    const run = (map: StarMap, seconds: number, dt = 0.25) => {
      for (let t = 0; t < seconds; t += dt) map['gameLoopCallback'](dt);
    };
    const status = (id: string) => TestBed.inject(CampaignService).state!.objectives[id].status;
    const earth = (map: StarMap) => map.starSystems[0].planetsTiles[0];
    const orion = (map: StarMap) => map.fleets.find((f) => f.name === 'ORION')!;
    const putFleet = (map: StarMap, x: number, y: number) => {
      const fleet = orion(map);
      fleet.system = null;
      fleet.x = x;
      fleet.y = y;
      fleet.targetX = null;
      fleet.targetY = null;
    };
    const addShips = (map: StarMap, type: string, count: number) => {
      for (let i = 0; i < count; i++) orion(map).ships.push({ id: 9000 + orion(map).ships.length, name: `${type}-${i}`, type });
    };
    const answerMessage = (map: StarMap, expected: string, choice: string | null = null) => {
      expect(map.campaignMessage?.eventId).toBe(expected);
      map.onCampaignChoice(choice);
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
      TestBed.inject(CampaignService).leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('can be completed: build, research, scout, probe, strike group, sentinel, expedition', () => {
      expect(TestBed.inject(CampaignMissionService).startMission('m1_discovery', 'normal', 1).ok).toBe(true);
      const map = createStarMap();
      expect(TestBed.inject(TutorialService).enabled(), 'tutorial on in M1').toBe(true);

      run(map, 1.5);
      expect(status('start_clock')).toBe('done');
      answerMessage(map, 'sol_command');

      // Construction (completed buildings stand in for placing and waiting).
      earth(map).buildings.push(
        { name: 'Mining Complex', size: 2, x: 0, y: 0 },
        { name: 'Spaceship Factory', size: 3, x: 0, y: 3 },
        { name: 'Spaceport', size: 3, x: 0, y: 7 },
      );
      map.factions.find((f) => f.id === 'player')!.researchedTechnologies!.push('basic_radar');
      run(map, 1.5);
      expect(['build_mine', 'build_shipyard', 'research_radar'].map(status)).toEqual(['done', 'done', 'done']);

      // Scouting Proxima and the probe wreck, through the real anomaly pipeline.
      map['exploredGridCells'].add('52-16');
      putFleet(map, 52, 16);
      run(map, 1.5);
      expect(status('scout_proxima')).toBe('done');
      expect(map.anomalyEvent?.name).toBe('Wreck of the Far Reach');
      map.onAnomalyChoice('download');
      run(map, 1.5);
      expect(status('investigate_probe')).toBe('done');
      expect(TestBed.inject(CampaignService).state!.flags['m1_probe_logs']).toBe(true);
      expect(map['exploredGridCells'].has('86-40'), 'the probe charts the lens').toBe(true);
      expect(map.wormholeViews.map((w) => w.key)).toEqual(['kepler_lens-0']);
      expect(TestBed.inject(CampaignService).state!.firedEvents).toContain('lens_sighted');

      // Strike group and the sentinel.
      addShips(map, 'fighter', 2);
      run(map, 1.5);
      expect(status('strike_group')).toBe('done');
      const sentinel = map.fleets.find((f) => f.name === 'SENTINEL')!;
      sentinel.ships.forEach((s) => (s.destroyed = true));
      sentinel.destroyed = true;
      run(map, 1.5);
      expect(status('destroy_sentinel')).toBe('done');
      answerMessage(map, 'stable_wormhole');

      // The expedition: a Colonizer escorted by a warship, on the lens.
      addShips(map, 'colonizer', 1);
      putFleet(map, 86, 40);
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(map.campaignEndText).toContain('Through the Gate');
      expect(TestBed.inject(CampaignProgressService).getRecord('m1_discovery')?.endingId).toBe('through_the_gate');
      expect(TestBed.inject(SaveGameService).loadFromSlot(SaveSlotId.AUTOSAVE)?.gameOutcome).toBe('victory');
    });

    it('does not count a colonizer without a warship as the expedition', () => {
      TestBed.inject(CampaignMissionService).startMission('m1_discovery', 'normal', 1);
      const map = createStarMap();
      const campaign = TestBed.inject(CampaignService);
      for (const id of Object.keys(campaign.state!.objectives)) {
        if (id !== 'expedition') (campaign.state as any).objectives[id].status = 'done';
      }
      orion(map).ships = [{ id: 1, name: 'C', type: 'colonizer' }, { id: 2, name: 'S', type: 'scout' }];
      putFleet(map, 86, 40);
      map.fleets.find((f) => f.name === 'SENTINEL')!.destroyed = true;
      run(map, 1.5);
      expect(map.gameOutcome).toBe('inProgress');
    });

    it('hides the Diplomacy hint, and the lens until it is explored', () => {
      TestBed.inject(CampaignMissionService).startMission('m1_discovery', 'normal', 1);
      const map = createStarMap();
      run(map, 0.5);
      expect(TestBed.inject(TutorialService).candidates().some((s) => s.id === 'diplomacy')).toBe(false);
      expect(map.wormholeViews).toEqual([]);
    });
  });
});

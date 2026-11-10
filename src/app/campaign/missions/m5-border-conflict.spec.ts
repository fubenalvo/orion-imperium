import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph } from '../../components/star-map/fleet-navigation';
import { getRelation } from '../../components/star-map/diplomacy';
import { AI_PERSONALITIES, AI_PERSONALITY_PROFILES, isAiPersonality } from '../../components/star-map/ai-personality';
import { PlanetTile } from '../../components/star-map/star-map.models';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M5_BORDER_CONFLICT } from './m5-border-conflict';

/* Mission 5 — The Border Conflict: the mercantile League, the scripted border war, the four roles and every ending. */
describe('Mission 5: The Border Conflict', () => {
  const build = () => buildMission(M5_BORDER_CONFLICT, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map and personality', () => {
    it('is valid, follows Mission 4, and has the design counts', () => {
      expect(validateMission(M5_BORDER_CONFLICT)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(11);
      expect(planets.length).toBe(22);
      expect(planets.filter((p) => p.factionId !== 'unhabited').length).toBe(6);
      expect(data.factions.filter((f) => f.ai).map((f) => `${f.id}:${f.aiPersonality}`)).toEqual([
        'concordium:technologist', 'varkon:militarist', 'meridian:mercantile',
      ]);
      expect(data.wormholes?.[0]).toMatchObject({ id: 'kessan_gate', state: 'active' });
      expect(data.spaceBases?.map((b) => `${b.name}:${b.factionId}`)).toEqual(["Garrow's Gate:varkon"]);
    });

    it('keeps the mercantile personality out of generated games, but valid in saves', () => {
      expect(AI_PERSONALITIES).toEqual(['balanced', 'expansionist', 'militarist', 'technologist']);
      expect(isAiPersonality('mercantile')).toBe(true);
      const merchant = AI_PERSONALITY_PROFILES.mercantile;
      expect(merchant.raids).toBe(false);
      expect(merchant.civilizationAssaultAfter).toBe(Number.POSITIVE_INFINITY);
      expect(merchant.commerce.tradingPosts).toBe(3);
    });

    it('reaches the Reach from Westmarch through the western gap and every capital', () => {
      const graph = new NavGraph(beltObstacles(M5_BORDER_CONFLICT.map.asteroidBelts), { width: 240, height: 144 });
      for (const [x, y] of [[104, 62], [136, 62], [120, 86]]) {
        for (const [sx, sy] of [[30, 72], [120, 18], [120, 128], [210, 72]]) expect(graph.plan({ x: sx, y: sy }, { x, y }).ok).toBe(true);
      }
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
    const campaign = () => TestBed.inject(CampaignService);
    const status = (id: string) => campaign().state!.objectives[id].status;
    const planet = (map: StarMap, name: string): PlanetTile => map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === name)!;
    const faction = (map: StarMap, id: string) => map.factions.find((f) => f.id === id)!;
    const relation = (map: StarMap, a: string, b: string) => getRelation(faction(map, a), faction(map, b))!;
    const start = (carry: Record<string, string> = {}): StarMap => {
      TestBed.inject(CampaignProgressService).recordCompletion('m4_meridian_exchange', { endingId: 'm4_exchange', difficulty: 'normal', records: carry, researchedTechnologies: [] });
      expect(TestBed.inject(CampaignMissionService).startMission('m5_border_conflict', 'normal', 1).ok).toBe(true);
      const map = createStarMap();
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('arrival');
      map.onCampaignChoice(null);
      run(map, 1.5);
      return map;
    };
    const skipTo = (map: StarMap, seconds: number) => {
      map['gameSeconds'] = seconds;
      run(map, 1.5);
    };
    /* The border war starts; the player picks a role. */
    const war = (map: StarMap, role: 'ally' | 'mediator' | 'partner' | 'opportunist', at = 600) => {
      skipTo(map, at);
      expect(map.campaignMessage?.eventId).toBe('border_war');
      map.onCampaignChoice(null);
      run(map, 0.5);
      expect(map.campaignMessage?.eventId).toBe('choose_role');
      map.onCampaignChoice(role);
      run(map, 1.5);
    };
    /* The player settles two Reach systems. */
    const settleReach = (map: StarMap) => {
      planet(map, 'Kessan Alpha').factionId = 'player';
      planet(map, 'Kessan Beta').factionId = 'player';
      map['territoryService'].invalidate();
      run(map, 1.5);
      expect(status('reach_presence')).toBe('done');
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
      for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact']) {
        TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
      }
    });

    afterEach(() => {
      campaign().leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('starts the border war at minute 10, and holds both empires back from each other until then', () => {
      const map = start();
      expect(campaign().restrains('varkon', 'concordium')).toBe(true);
      war(map, 'opportunist');
      expect(relation(map, 'concordium', 'varkon').state).toBe('war');
      expect(campaign().restrains('varkon', 'concordium')).toBe(false);
      expect(campaign().state!.flags['m5_role']).toBe('opportunist');
    });

    it('starts it at minute 15 when the player paid Varkon in Mission 3', () => {
      TestBed.inject(CampaignProgressService).recordCompletion('m3_first_contact', { endingId: 'm3_appeasement', difficulty: 'normal', records: { m3_alignment: 'varkon' }, researchedTechnologies: [] });
      const map = start();
      skipTo(map, 700);
      expect(relation(map, 'concordium', 'varkon').state).toBe('peace');
      war(map, 'partner', 900);
      expect(campaign().hasTributePact('varkon', 'player')).toBe(true);
    });

    it('turns the League cold after market dominance at the Exchange', () => {
      const map = start({ m4_path: 'dominance' });
      expect(relation(map, 'meridian', 'player').opinion).toBeLessThanOrEqual(-10);
    });

    it('Mediator: brokers a white peace once both sides are worn down', () => {
      const map = start();
      war(map, 'mediator');
      settleReach(map);
      relation(map, 'concordium', 'varkon').warExhaustion = 35;
      relation(map, 'varkon', 'concordium').warExhaustion = 32;
      for (const [a, b] of [['concordium', 'varkon'], ['varkon', 'concordium']]) relation(map, a, b).lockRemaining = 0;
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('mediation');
      map.onCampaignChoice('mediate');
      expect(relation(map, 'concordium', 'varkon').state).toBe('peace');
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m5_border_conflict')).toMatchObject({
        endingId: 'm5_mediated', records: { m5_role: 'mediator', m5_reach_controller: 'shared' },
      });
    });

    it('Partner or opportunist: peace with Varkon while humanity holds the Reach for 5 minutes', () => {
      const map = start();
      war(map, 'opportunist');
      settleReach(map);
      expect(map.gameOutcome).toBe('inProgress');
      campaign().state!.heldTimers['human_settlement'] = 299;
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m5_border_conflict')).toMatchObject({
        endingId: 'm5_human_reach', records: { m5_role: 'opportunist', m5_reach_controller: 'player' },
      });
    });

    it('Ally: war with Varkon, its exhaustion at 60, then peace', () => {
      const map = start();
      war(map, 'ally');
      expect(relation(map, 'player', 'varkon').state).toBe('war');
      settleReach(map);
      relation(map, 'varkon', 'player').warExhaustion = 62;
      run(map, 1.5);
      expect(campaign().state!.values['war_exhaustion:varkon']).toBe(62);
      for (const [a, b] of [['player', 'varkon'], ['varkon', 'player']]) relation(map, a, b).lockRemaining = 0;
      map['applyCampaignResult'](campaign().applyExternalEffects([{ kind: 'start_peace', a: 'varkon', b: 'player' }], map['campaignWorld']()));
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m5_border_conflict')).toMatchObject({
        endingId: 'm5_dominion_broken', records: { m5_role: 'ally' },
      });
    });

    it('fails when Varkon holds all three Reach systems for 10 minutes', () => {
      const map = start();
      for (const name of ['Kessan Alpha', 'Kessan Beta', 'Kessan Heart']) planet(map, name).factionId = 'varkon';
      map['territoryService'].invalidate();
      run(map, 1.5);
      campaign().state!.heldTimers['varkon_reach'] = 599;
      run(map, 1.5);
      expect(map.gameOutcome).toBe('defeat');
    });

    it('fails on the second lost planet', () => {
      const map = start();
      planet(map, 'Westmarch Moon').factionId = 'player';
      run(map, 1.5);
      planet(map, 'Westmarch Moon').factionId = 'varkon';
      run(map, 1.5);
      expect(map.gameOutcome).toBe('inProgress');
      planet(map, 'Westmarch').factionId = 'varkon';
      run(map, 1.5);
      expect(map.gameOutcome).toBe('defeat');
    });
  });
});

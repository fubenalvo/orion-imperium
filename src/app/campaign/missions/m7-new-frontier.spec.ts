import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { SpaceBaseService } from '../../components/star-map/space-base.service';
import { DysonRingService } from '../../components/star-map/dyson-ring.service';
import { DysonVictoryService } from '../../components/star-map/dyson-victory.service';
import { EnemyDysonService } from '../../components/star-map/enemy-dyson.service';
import { buildDysonRing } from '../../components/star-map/dyson-ring';
import { DysonBonusId } from '../../components/star-map/dyson-anchor';
import { SpaceBase } from '../../components/star-map/star-map.models';
import { getRelation } from '../../components/star-map/diplomacy';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M7_NEW_FRONTIER } from './m7-new-frontier';

/* Mission 7 — The New Frontier: the ring, instability, the Dyson plans and every ending. */
describe('Mission 7: The New Frontier', () => {
  const build = () => buildMission(M7_NEW_FRONTIER, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map', () => {
    it('is valid, follows Mission 6, and has the design counts', () => {
      expect(validateMission(M7_NEW_FRONTIER)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(14);
      expect(planets.length).toBe(35);
      expect(planets.filter((p) => p.factionId !== 'unhabited').length).toBe(9);
      expect(data.factions.filter((f) => f.ai).map((f) => `${f.id}:${f.aiPersonality}`)).toEqual([
        'concordium:technologist', 'varkon:militarist', 'meridian:mercantile', 'observers:guardian',
      ]);
      const ring = buildDysonRing(data.specialObjects);
      expect(ring?.slots.length).toBe(8);
      expect(data.wormholes?.map((w) => `${w.id}:${w.state}:${w.mouths.length}`)).toEqual(['alpha:active:2', 'omega:active:2']);
      expect(M7_NEW_FRONTIER.researchHorizon).toContain('stellar_engineering');
      expect(M7_NEW_FRONTIER.researchHorizon).not.toContain('remnant_drive');
    });
  });

  describe('playthrough in StarMap', () => {
    const createStarMap = (): StarMap => {
      const map = TestBed.createComponent(StarMap).componentInstance;
      vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
      map.ngOnInit();
      return map;
    };
    const run = (map: StarMap, seconds: number, dt = 0.5) => {
      for (let t = 0; t < seconds; t += dt) map['gameLoopCallback'](dt);
    };
    const campaign = () => TestBed.inject(CampaignService);
    const faction = (map: StarMap, id: string) => map.factions.find((f) => f.id === id)!;
    const value = (key: string) => campaign().state!.values[key] ?? 0;
    const record = () => TestBed.inject(CampaignProgressService).getRecord('m7_new_frontier');
    /* Completed anchors on the ring: one entry per slot, [owner, bonus]. */
    const anchors = (owners: [string, DysonBonusId][]) => {
      const ring = TestBed.inject(DysonRingService).ring!;
      const bases: SpaceBase[] = owners.map(([factionId, bonus], i) => ({
        id: 100 + i, name: `Dyson Anchor ${i + 1}`, factionId, x: ring.slots[i].col, y: ring.slots[i].row, kind: 'dyson', dysonSlot: i, dysonBonus: bonus,
      }));
      TestBed.inject(SpaceBaseService).restore(bases);
    };
    const start = (records: Record<string, string> = {}): StarMap => {
      TestBed.inject(CampaignProgressService).recordCompletion('m6_silent_remnant', { endingId: 'm6_core', difficulty: 'normal', records, researchedTechnologies: [] });
      expect(TestBed.inject(CampaignMissionService).startMission('m7_new_frontier', 'normal', 1).ok).toBe(true);
      const map = createStarMap();
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('arrival');
      map.onCampaignChoice(null);
      run(map, 1.5);
      return map;
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
      for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact', 'm4_meridian_exchange', 'm5_border_conflict']) {
        TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
      }
    });

    afterEach(() => {
      campaign().leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('carries Mission 6: the shared core, and the archives an AI empire took', () => {
      const map = start({ m6_shared_with: 'observers', 'site:archive_2': 'varkon', 'site:archive_1': 'player', 'site:archive_3': 'player' });
      expect(getRelation(faction(map, 'observers'), faction(map, 'player'))!.opinion).toBeGreaterThanOrEqual(20);
      expect(faction(map, 'varkon').researchedTechnologies).toContain('remnant_shield_matrix');
      expect(faction(map, 'concordium').researchedTechnologies).not.toContain('remnant_shield_matrix');
    });

    it('applies the campaign Dyson plans: Observers build Dampeners, the Concordium only after the Charter', () => {
      const map = start();
      const dyson = TestBed.inject(EnemyDysonService);
      expect(dyson.planOf(faction(map, 'observers'))).toMatchObject({ build: 'always', bonus: 'dampener', maxAnchors: 4, openersOnly: true });
      expect(dyson.planOf(faction(map, 'concordium')).build).toBe('never');
      campaign().applyExternalEffects([{ kind: 'flag', flag: 'm7_union_charter', value: true }], map['campaignWorld']());
      expect(dyson.planOf(faction(map, 'concordium'))).toMatchObject({ build: 'always', maxAnchors: 3 });
    });

    it('moves instability with the ring: openers raise it (the player\'s at half), Dampeners lower it', () => {
      const map = start();
      anchors([['varkon', 'stellar_power'], ['varkon', 'orbital_foundries'], ['player', 'stellar_power'], ['player', 'swarm_observatory']]);
      run(map, 60);
      // Per minute: 2 × 1.5 (Varkon) + 2 × 0.75 (player) = 4.5.
      expect(value('instability')).toBeCloseTo(4.5, 0);
      anchors([['observers', 'dampener'], ['observers', 'dampener'], ['observers', 'dampener'], ['varkon', 'stellar_power']]);
      run(map, 60);
      expect(value('instability')).toBeLessThan(4.5);
    });

    it('fails when instability reaches 100', () => {
      const map = start();
      anchors([['varkon', 'stellar_power']]);
      campaign().state!.values['instability'] = 99.99;
      run(map, 2);
      expect(map.gameOutcome).toBe('defeat');
      expect(map.campaignEndText).toBe('The network cascaded. The Silent Frontier went silent again.');
    });

    it('Human Dominion: the player\'s own warm-up, under pressure', () => {
      const map = start();
      anchors(Array.from({ length: 8 }, () => ['player', 'stellar_power'] as [string, DysonBonusId]));
      run(map, 2);
      expect(TestBed.inject(DysonVictoryService).warmup?.factionId).toBe('player');
      expect(campaign().state!.firedEvents).toContain('dominion_pressure');
      expect(campaign().state!.fleetTags['observer_reinforcement']?.length).toBe(1);
      TestBed.inject(DysonVictoryService).restore({ factionId: 'player', remaining: 1 });
      run(map, 3);
      expect(map.gameOutcome).toBe('victory');
      expect(record()).toMatchObject({ endingId: 'm7_human_dominion', records: { m7_ending: 'human_dominion' } });
    });

    it('Galactic Union: the Charter, then the ring completed together', () => {
      const map = start();
      for (const id of ['concordium', 'meridian']) faction(map, id).relations!['player'].opinion = 55;
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('union_charter');
      map.onCampaignChoice('sign');
      run(map, 1.5);
      expect(TestBed.inject(DysonVictoryService).activeCoalition?.members).toEqual(['player', 'concordium', 'meridian']);
      anchors([
        ['player', 'stellar_power'], ['player', 'stellar_power'],
        ['concordium', 'swarm_observatory'], ['concordium', 'swarm_observatory'], ['concordium', 'swarm_observatory'],
        ['meridian', 'orbital_foundries'], ['meridian', 'orbital_foundries'], ['meridian', 'orbital_foundries'],
      ]);
      run(map, 2);
      expect(TestBed.inject(DysonVictoryService).warmup?.factionId).toBe('coalition:union');
      expect(map.dysonCountdown?.ownerName).toBe('The Galactic Union');
      TestBed.inject(DysonVictoryService).restore({ factionId: 'coalition:union', remaining: 1 });
      run(map, 3);
      expect(map.gameOutcome).toBe('victory');
      expect(record()?.endingId).toBe('m7_galactic_union');
    });

    it('The Observers\' Accord: a quiet Heart, then all four gate mouths sealed', () => {
      const map = start({ m6_shared_with: 'observers' });
      faction(map, 'observers').relations!['player'].opinion = 45;
      anchors([['observers', 'dampener'], ['observers', 'dampener'], ['player', 'dampener'], ['player', 'dampener']]);
      run(map, 2);
      const sites = campaign().siteEntries();
      expect(sites.every((s) => s.state.active)).toBe(true);
      for (const site of sites) site.state.claimedBy = site.def.id.includes('alpha') ? 'player' : 'observers';
      run(map, 2);
      expect(map.gameOutcome).toBe('victory');
      expect(record()?.endingId).toBe('m7_observers_accord');
    });

    it('keeps the seals closed while an opener anchor stands', () => {
      const map = start({ m6_shared_with: 'observers' });
      faction(map, 'observers').relations!['player'].opinion = 45;
      anchors([['observers', 'dampener'], ['observers', 'dampener'], ['player', 'dampener'], ['player', 'dampener'], ['varkon', 'stellar_power']]);
      run(map, 2);
      expect(campaign().siteEntries().some((s) => s.state.active)).toBe(false);
    });

    it('fails when Varkon\'s warm-up completes', () => {
      const map = start();
      anchors(Array.from({ length: 8 }, () => ['varkon', 'stellar_power'] as [string, DysonBonusId]));
      TestBed.inject(DysonVictoryService).restore({ factionId: 'varkon', remaining: 1 });
      run(map, 3);
      expect(map.gameOutcome).toBe('defeat');
    });

    it('brings the Observers in at the first pulse and Remnant sentinels at the second', () => {
      const map = start();
      map['gameSeconds'] = 720;
      run(map, 1.5);
      // The pulse's forced contact and its message both open; either may come first.
      let met = false;
      for (let i = 0; i < 4 && (map.campaignMessage || map.contactDialogue); i++) {
        if (map.contactDialogue) {
          expect(map.contactDialogue.factionId).toBe('observers');
          map.onContactAnswer({ replies: [0, 0], stance: 'welcome', giftTier: 0 });
          map.onContactClose();
          met = true;
        } else {
          expect(map.campaignMessage!.eventId).toBe('pulse_1');
          map.onCampaignChoice(null);
        }
        run(map, 1.5);
      }
      expect(met).toBe(true);
      expect(campaign().state!.firedEvents).toContain('pulse_1');
      map['gameSeconds'] = 1440;
      run(map, 1.5);
      const tag = campaign().state!.fleetTags['pulse_2'];
      expect(tag?.length).toBe(1);
      expect(map.fleets.find((f) => f.id === tag![0])?.factionId).toBe('remnant');
    });
  });
});

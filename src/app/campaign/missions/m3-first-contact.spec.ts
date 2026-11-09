import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph } from '../../components/star-map/fleet-navigation';
import { getRelation, inContact } from '../../components/star-map/diplomacy';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M3_FIRST_CONTACT } from './m3-first-contact';

/* Mission 3 — First Contact: its map rules, the scripted Varkon pressure and every ending. */
describe('Mission 3: First Contact', () => {
  const build = () => buildMission(M3_FIRST_CONTACT, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map', () => {
    it('is valid, follows Mission 2, and has the design counts', () => {
      expect(validateMission(M3_FIRST_CONTACT)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(8);
      expect(planets.length).toBe(15);
      expect(planets.filter((p) => p.factionId !== 'unhabited').map((p) => `${p.name}:${p.factionId}`)).toEqual([
        'Haven:player', 'Concord:concordium', 'Varkos:varkon', 'Saffra:independent',
      ]);
      expect(data.factions.filter((f) => f.ai).map((f) => `${f.id}:${f.aiPersonality}`)).toEqual(['concordium:technologist', 'varkon:militarist']);
      expect(data.wormholes?.[0]).toMatchObject({ id: 'ostra_gate', state: 'dormant' });
      expect(data.wormholes?.[0].mouths.length).toBe(2);
      expect(data.anomalies?.anomalies[0]).toMatchObject({ key: 'm3_distress', type: 'distress_signal', factionId: 'concordium' });
    });

    it('starts with both empires unknown to the player, and known to each other', () => {
      const factions = build().factions;
      const f = (id: string) => factions.find((x) => x.id === id)!;
      expect(inContact(f('player'), f('concordium'))).toBe(false);
      expect(inContact(f('player'), f('varkon'))).toBe(false);
      expect(inContact(f('concordium'), f('varkon'))).toBe(true);
      expect(getRelation(f('concordium'), f('varkon'))?.opinion).toBe(-20);
    });

    it('routes Varkos to Haven around belt A, and Corran to Concord Prime around belt B', () => {
      const graph = new NavGraph(beltObstacles(M3_FIRST_CONTACT.map.asteroidBelts), { width: 180, height: 108 });
      expect(graph.plan({ x: 140, y: 86 }, { x: 26, y: 56 }).ok).toBe(true);
      expect(graph.plan({ x: 50, y: 26 }, { x: 130, y: 22 }).ok).toBe(true);
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
    const faction = (map: StarMap, id: string) => map.factions.find((f) => f.id === id)!;
    const start = (): StarMap => {
      expect(TestBed.inject(CampaignMissionService).startMission('m3_first_contact', 'normal', 1).ok).toBe(true);
      const map = createStarMap();
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('arrival');
      map.onCampaignChoice(null);
      return map;
    };
    /* Jumps the clock (the envoys come on game time) and plays on. */
    const skipTo = (map: StarMap, seconds: number) => {
      map['gameSeconds'] = seconds;
      run(map, 1.5);
    };
    const answerContact = (map: StarMap, id: string, stance: 'welcome' | 'cautious' | 'warning', replies = [0, 0]) => {
      expect(map.contactDialogue?.factionId).toBe(id);
      map.onContactAnswer({ replies, stance, giftTier: 0 });
      map.onContactClose();
    };
    /*
     * Both envoys arrive; the player answers both warmly. A warm Concordium
     * meeting offers the Accord at once (a modal message that pauses the
     * game): `accord` is the answer to it.
     */
    const meetBoth = (map: StarMap, accord: 'sign' | 'decline' = 'decline') => {
      skipTo(map, 540);
      for (let i = 0; i < 6 && (map.contactDialogue || map.campaignMessage); i++) {
        if (map.contactDialogue) answerContact(map, map.contactDialogue.factionId, 'welcome');
        else map.onCampaignChoice(map.campaignMessage!.eventId === 'concordium_accord' ? accord : null);
        run(map, 1.5);
      }
      expect(['meet_concordium', 'meet_varkon'].map(status)).toEqual(['done', 'done']);
    };
    const pendingDemand = () => TestBed.inject(DiplomacyService).getPendingDemandsFor('player').find((d) => d.demanderId === 'varkon')!;

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
      TestBed.inject(CampaignProgressService).recordCompletion('m1_discovery', { endingId: 'through_the_gate', difficulty: 'normal', records: {}, researchedTechnologies: [] });
      TestBed.inject(CampaignProgressService).recordCompletion('m2_beyond_the_gate', { endingId: 'first_signal', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    });

    afterEach(() => {
      campaign().leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('sends the Concordium envoy at minute 6, and asks again after a reload until answered', () => {
      const map = start();
      skipTo(map, 360);
      expect(map.contactDialogue?.factionId).toBe('concordium');
      expect(campaign().forcedContacts).toEqual(['concordium']);

      // The dialogue is not answered: a reload brings the envoy back (no sighting needed).
      const reloaded = createStarMap();
      run(reloaded, 1.5);
      expect(reloaded.contactDialogue?.factionId).toBe('concordium');
      answerContact(reloaded, 'concordium', 'welcome');
      run(reloaded, 1.5);
      expect(campaign().forcedContacts).toEqual([]);
      expect(status('meet_concordium')).toBe('done');
      expect(getRelation(faction(reloaded, 'concordium'), faction(reloaded, 'player'))?.state).toBe('peace');
    });

    it('scripts the Varkon meeting to a cold peace, then demands tribute a minute later', () => {
      const map = start();
      meetBoth(map);
      const varkon = faction(map, 'varkon');
      const player = faction(map, 'player');
      // The friendliest answers still give a cold peace with a low opinion.
      expect(getRelation(varkon, player)?.state).toBe('peace');
      expect(getRelation(varkon, player)!.opinion).toBeLessThanOrEqual(-10);
      expect(status('meet_varkon')).toBe('done');
      expect(pendingDemand()).toBeUndefined();

      run(map, 61);
      expect(pendingDemand()).toMatchObject({ demanderId: 'varkon', kind: 'tribute', amount: 400 });
    });

    it('keeps the scripted cold peace even after a hostile answer', () => {
      const map = start();
      skipTo(map, 540);
      answerContact(map, 'concordium', 'cautious');
      run(map, 1.5);
      if (map.campaignMessage) {
        map.onCampaignChoice('decline');
        run(map, 1.5);
      }
      // "Come and find out", a hard second reply and a warning: war by the general rule.
      answerContact(map, 'varkon', 'warning', [0, 2]);
      const relation = getRelation(faction(map, 'varkon'), faction(map, 'player'))!;
      expect(relation.state).toBe('peace');
      expect(relation.opinion).toBeLessThanOrEqual(-10);
    });

    it('demands sooner and more when the player offered tribute at contact', () => {
      const map = start();
      skipTo(map, 540);
      answerContact(map, 'concordium', 'cautious', [2, 2]);
      run(map, 1.5);
      if (map.campaignMessage) {
        map.onCampaignChoice('decline');
        run(map, 1.5);
      }
      // Varkon asks its signature question first; reply 2 ("rather pay than fight") sets the flag.
      expect(map.contactDialogue?.questions[0].id).toBe('sig_varkon');
      map.onContactAnswer({ replies: [2, 0], stance: 'cautious', giftTier: 0 });
      map.onContactClose();
      run(map, 1.5);
      expect(campaign().state!.flags['offered_tribute']).toBe(true);
      run(map, 21);
      expect(pendingDemand()).toMatchObject({ demanderId: 'varkon', kind: 'tribute', amount: 700 });
    });

    it('escalates to an ultimatum ~9 minutes after a refused tribute', () => {
      const map = start();
      meetBoth(map);
      run(map, 61);
      map.onDeclineDemand(pendingDemand().id);
      run(map, 1.5);
      expect(campaign().state!.counters['demand_refused:varkon']).toBe(1);
      campaign().state!.heldTimers['ultimatum_clock'] = 539;
      run(map, 1.5);
      expect(pendingDemand()).toMatchObject({ demanderId: 'varkon', kind: 'threat', amount: 800 });
    });

    it('Appeasement: pay, accept the pact, keep paying for 15 minutes', () => {
      const map = start();
      meetBoth(map);
      run(map, 61);
      map.onAcceptDemand(pendingDemand().id);
      run(map, 1.5);
      expect(status('answer_varkon')).toBe('done');
      expect(map.campaignMessage?.eventId).toBe('varkon_pact_offer');
      map.onCampaignChoice('accept');
      expect(campaign().hasTributePact('varkon', 'player')).toBe(true);

      // A payment: 250 credits move to Varkon.
      const player = faction(map, 'player');
      const varkon = faction(map, 'varkon');
      const before = player.currencies['credits'];
      campaign().state!.tributePacts![0].untilNext = 0.5;
      run(map, 1.5);
      expect(campaign().state!.values['tribute_paid:varkon']).toBe(250);
      expect(player.currencies['credits']).toBeLessThan(before);

      // The pact keeps the Dominion's AI from new demands and wars on the player.
      const guard = TestBed.inject(CampaignService);
      expect(guard.hasTributePact(varkon.id, player.id)).toBe(true);

      campaign().state!.heldTimers['pact_kept'] = 899;
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m3_first_contact')?.records).toMatchObject({ m3_alignment: 'varkon', m3_pact_accepted: true });
    });

    it('breaks the pact with war when a payment cannot be made', () => {
      const map = start();
      meetBoth(map);
      run(map, 61);
      map.onAcceptDemand(pendingDemand().id);
      run(map, 1.5);
      map.onCampaignChoice('accept');
      faction(map, 'player').currencies['credits'] = 0;
      campaign().state!.tributePacts![0].untilNext = 0.5;
      run(map, 1.5);
      expect(campaign().state!.flags['tribute_pact_broken']).toBe(true);
      expect(campaign().hasTributePact('varkon', 'player')).toBe(false);
      expect(getRelation(faction(map, 'varkon'), faction(map, 'player'))?.state).toBe('war');
    });

    it('Accord: sign the Accord of Passage, beat a Varkon fleet, hold through the Ostra crisis', () => {
      const map = start();
      meetBoth(map, 'sign');
      expect(campaign().state!.firedEvents).toContain('concordium_accord');
      expect(status('concordium_trust')).toBe('done');
      campaign().notify('battle_won', 1, 'varkon');
      run(map, 1.5);
      expect(status('answer_varkon')).toBe('done');
      // Not before the Ostra gate has been held for 10 minutes.
      expect(map.gameOutcome).toBe('inProgress');
      skipTo(map, 1200);
      expect(map.campaignMessage?.eventId).toBe('ostra_wakes');
      map.onCampaignChoice(null);
      campaign().state!.heldTimers['ostra_watch'] = 599;
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m3_first_contact')).toMatchObject({
        endingId: 'm3_accord',
        records: { m3_alignment: 'concordium', m3_accord: true },
      });
    });

    it('Show of force: peace with Varkon after its war exhaustion reached 30', () => {
      const map = start();
      meetBoth(map);
      map['applyCampaignResult'](campaign().applyExternalEffects([{ kind: 'start_war', a: 'varkon', b: 'player', declarer: 'varkon' }], map['campaignWorld']()));
      const varkon = faction(map, 'varkon');
      const player = faction(map, 'player');
      expect(getRelation(varkon, player)?.state).toBe('war');
      expect(campaign().state!.counters['war_declared:varkon']).toBe(1);
      varkon.relations!['player'].warExhaustion = 35;
      run(map, 1.5);
      expect(campaign().state!.values['war_exhaustion:varkon']).toBe(35);

      for (const [a, b] of [[varkon, player], [player, varkon]]) a.relations![b.id].lockRemaining = 0;
      map['applyCampaignResult'](campaign().applyExternalEffects([{ kind: 'start_peace', a: 'varkon', b: 'player' }], map['campaignWorld']()));
      expect(getRelation(varkon, player)?.state).toBe('peace');
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m3_first_contact')?.endingId).toBe('m3_show_of_force');
    });

    it('counts a lost planet by its new owner, and losing Haven fails the mission', () => {
      const map = start();
      run(map, 1.5);
      map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === 'Haven')!.factionId = 'varkon';
      run(map, 1.5);
      expect(campaign().state!.counters['planet_lost:varkon']).toBe(1);
      expect(map.gameOutcome).toBe('defeat');
      expect(map.campaignEndText).toBe('Haven has fallen.');
    });

    it('wakes the Ostra gate at minute 20', () => {
      const map = start();
      skipTo(map, 1200);
      expect(map['wormholes'].find((w) => w.id === 'ostra_gate')?.state).toBe('active');
    });
  });
});

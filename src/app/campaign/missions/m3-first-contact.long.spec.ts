import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { getRelation } from '../../components/star-map/diplomacy';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyEvent, DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';

/*
 * Mission 3 — a 30-minute run with the real AIs (docs/campaign-design.md,
 * Phase 4b). The player answers both meetings politely, refuses every
 * demand and otherwise stays passive. Checks the scripted Varkon pressure
 * (tribute, then an ultimatum, inside the mission window on Normal) and
 * that the Concordium keeps the peace with a polite player.
 */
describe('Mission 3 AI run (long)', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
    TestBed.inject(GameOutcomeService).reset();
    for (const id of ['m1_discovery', 'm2_beyond_the_gate']) {
      TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    }
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('Varkon demands tribute, then issues an ultimatum; the Concordium stays at peace (30 minutes, Normal)', () => {
    expect(TestBed.inject(CampaignMissionService).startMission('m3_first_contact', 'normal', 1).ok).toBe(true);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();

    const diplomacy = TestBed.inject(DiplomacyService);
    const seen: { minute: number; event: DiplomacyEvent }[] = [];
    const drain = diplomacy.drainEvents.bind(diplomacy);
    vi.spyOn(diplomacy, 'drainEvents').mockImplementation(() => {
      const events = drain();
      for (const event of events) seen.push({ minute: Math.floor(map['gameSeconds'] / 60), event });
      return events;
    });

    const contacts: string[] = [];
    const dt = 0.5;
    for (let t = 0; t < 30 * 60; t += dt) {
      if (map.contactDialogue) {
        contacts.push(`${map.contactDialogue.factionId}@${Math.floor(map['gameSeconds'] / 60)}`);
        map.onContactAnswer({ replies: [1, 1], stance: 'cautious', giftTier: 0 });
        map.onContactClose();
      }
      if (map.campaignMessage) map.onCampaignChoice(map.campaignMessage.choices?.length ? map.campaignMessage.choices[map.campaignMessage.choices.length - 1].id : null);
      if (map.anomalyEvent) map.onAnomalyChoice(map.anomalyEvent.choices[map.anomalyEvent.choices.length - 1].id);
      for (const demand of diplomacy.getPendingDemandsFor('player')) map.onDeclineDemand(demand.id);
      if (map.gameOutcome !== 'inProgress') break;
      map['gameLoopCallback'](dt);
    }

    const varkonDemands = seen.filter((s) => s.event.kind === 'demand' && s.event.initiatorId === 'varkon' && s.event.targetId === 'player');
    const player = map.factions.find((f) => f.id === 'player')!;
    const concordium = map.factions.find((f) => f.id === 'concordium')!;
    const report = [
      `contacts ${contacts.join(', ')}`,
      `varkon demands ${varkonDemands.map((s) => `${s.event.demand?.kind} ${s.event.demand?.amount}@${s.minute}`).join(', ')}`,
      `wars ${seen.filter((s) => s.event.kind === 'war' || s.event.kind === 'breach').map((s) => `${s.event.initiatorId}->${s.event.targetId}@${s.minute}`).join(', ')}`,
      `concordium ${getRelation(concordium, player)?.state} opinion ${getRelation(concordium, player)?.opinion}`,
      `outcome ${map.gameOutcome} objectives ${JSON.stringify(Object.fromEntries(Object.entries(TestBed.inject(CampaignService).state!.objectives).map(([k, v]) => [k, v.status])))}`,
    ];
    (globalThis as any).process?.stdout?.write(report.map((line) => `m3 ${line}\n`).join(''));

    expect(contacts.map((c) => c.split('@')[0]).sort()).toEqual(['concordium', 'varkon']);
    expect(varkonDemands[0]?.event.demand?.kind).toBe('tribute');
    expect(varkonDemands[0].minute).toBeLessThanOrEqual(11);
    expect(varkonDemands.some((s) => s.event.demand?.kind === 'threat' && s.minute <= 21)).toBe(true);
    expect(getRelation(concordium, player)?.state).toBe('peace');
    // Wary neighbours, not at war with each other (aiRestraint).
    expect(getRelation(concordium, map.factions.find((f) => f.id === 'varkon')!)?.state).toBe('peace');
  }, 600_000);
});

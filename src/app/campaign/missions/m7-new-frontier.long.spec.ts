import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { SpaceBaseService } from '../../components/star-map/space-base.service';
import { EnemyDysonService } from '../../components/star-map/enemy-dyson.service';
import { isDysonAnchor, isOpenerAnchor } from '../../components/star-map/dyson-anchor';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';

/*
 * Mission 7 — a 60-minute run with the real AIs and no player action
 * (docs/campaign-design.md, Phase 8). Checks the phase's acceptance points
 * for a headless run: Varkon starts anchors, and the Observers go after
 * opener anchors. Reports the ring and the instability curve every five
 * minutes (the numbers in campaign-design.md come from here).
 */
describe('Mission 7 AI run (long)', () => {
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
    for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact', 'm4_meridian_exchange', 'm5_border_conflict', 'm6_silent_remnant']) {
      TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    }
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('Varkon raises anchors and the Observers hunt openers (60 minutes, Normal)', () => {
    expect(TestBed.inject(CampaignMissionService).startMission('m7_new_frontier', 'normal', 1).ok).toBe(true);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    const minute = () => Math.floor(map['gameSeconds'] / 60);
    const campaign = TestBed.inject(CampaignService);
    const bases = TestBed.inject(SpaceBaseService);
    const dyson = TestBed.inject(EnemyDysonService);
    const diplomacy = TestBed.inject(DiplomacyService);

    const firstAnchor = new Map<string, number>();
    const seenAnchors = new Map<number, string>();
    const lostAnchors: string[] = [];
    let observerHuntMinute: number | null = null;
    const curve: string[] = [];
    const dt = 0.5;
    for (let t = 0; t < 60 * 60; t += dt) {
      if (map.campaignMessage) map.onCampaignChoice(map.campaignMessage.choices[map.campaignMessage.choices.length - 1]?.id ?? null);
      if (map.contactDialogue) {
        map.onContactAnswer({ replies: [1, 1], stance: 'cautious', giftTier: 0 });
        map.onContactClose();
      }
      if (map.anomalyEvent) map.onAnomalyChoice(map.anomalyEvent.choices[map.anomalyEvent.choices.length - 1].id);
      for (const demand of diplomacy.getPendingDemandsFor('player')) map.onDeclineDemand(demand.id);
      if (map.gameOutcome !== 'inProgress') break;
      map['gameLoopCallback'](dt);

      const anchors = bases.bases.filter(isDysonAnchor);
      for (const anchor of anchors) {
        if (!firstAnchor.has(anchor.factionId)) firstAnchor.set(anchor.factionId, minute());
        seenAnchors.set(anchor.id, `${anchor.factionId}/${anchor.dysonBonus ?? '-'}`);
      }
      for (const [id, label] of [...seenAnchors]) {
        if (!anchors.some((a) => a.id === id)) {
          lostAnchors.push(`${label}@${minute()}`);
          seenAnchors.delete(id);
        }
      }
      if (observerHuntMinute === null) {
        const observerOrdered = [...dyson.getOrderedFleetIds()].some((id) => map.fleets.find((f) => f.id === id)?.factionId === 'observers');
        if (observerOrdered && anchors.some((a) => isOpenerAnchor(a))) observerHuntMinute = minute();
      }
      if (map['gameSeconds'] % 300 < dt && map['gameSeconds'] > 1) {
        const ring = anchors.map((a) => `${a.factionId[0]}${isOpenerAnchor(a) ? 'O' : 'D'}`).join('');
        curve.push(`m${minute()} instability ${Math.round(campaign.state?.values['instability'] ?? 0)} ring [${ring}]`);
      }
    }

    const report = [
      `first anchors ${[...firstAnchor].map(([f, m]) => `${f}@${m}`).join(', ')}`,
      `observer hunt order from minute ${observerHuntMinute ?? '-'}`,
      `anchors lost ${lostAnchors.join(', ') || '-'}`,
      ...curve,
      `outcome ${map.gameOutcome} at minute ${minute()} ${map.campaignEndText ?? ''}`,
    ];
    (globalThis as any).process?.stdout?.write(report.map((line) => `m7 ${line}\n`).join(''));

    expect(firstAnchor.has('varkon'), 'Varkon raised an anchor').toBe(true);
    expect(observerHuntMinute, 'the Observers hunted an opener anchor').not.toBeNull();
  }, 900_000);
});

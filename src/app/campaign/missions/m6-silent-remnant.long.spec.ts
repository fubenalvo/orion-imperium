import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { EnemyCampaignService } from '../../components/star-map/enemy-campaign.service';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';

/*
 * Mission 6 — a 40-minute run with the real AIs and no player action
 * (docs/campaign-design.md, Phase 7). Checks the phase's acceptance points:
 * Varkon claims at least one archive by minute ~30, the Concordium at most
 * one, and no fleet is steered by two services: every fleet on a campaign
 * order heads for its site or holds it, frame after frame. (EnemyFleetService
 * drops the role of a fleet the pipeline reserved at its next decision, a
 * few seconds later; it never steers a reserved fleet in between.)
 * Two AI archives end the mission (a defeat), so the run may stop early.
 */
describe('Mission 6 AI run (long)', () => {
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
    for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact', 'm4_meridian_exchange', 'm5_border_conflict']) {
      TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    }
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('Varkon claims an archive by minute 30, the Concordium at most one, every fleet has one owner (40 minutes, Normal)', () => {
    expect(TestBed.inject(CampaignMissionService).startMission('m6_silent_remnant', 'normal', 1).ok).toBe(true);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    const minute = () => Math.floor(map['gameSeconds'] / 60);
    const campaign = TestBed.inject(CampaignService);
    const campaignAi = TestBed.inject(EnemyCampaignService);
    const diplomacy = TestBed.inject(DiplomacyService);

    const claims: string[] = [];
    const orders = new Set<string>();
    let stolen = 0;
    const seenOrder = new Set<number>();
    const dt = 0.5;
    for (let t = 0; t < 40 * 60; t += dt) {
      if (map.campaignMessage) map.onCampaignChoice(map.campaignMessage.choices[map.campaignMessage.choices.length - 1]?.id ?? null);
      if (map.anomalyEvent) map.onAnomalyChoice(map.anomalyEvent.choices[map.anomalyEvent.choices.length - 1].id);
      for (const demand of diplomacy.getPendingDemandsFor('player')) map.onDeclineDemand(demand.id);
      if (map.gameOutcome !== 'inProgress') break;
      map['gameLoopCallback'](dt);
      const sites = new Map(campaign.siteEntries().map((e) => [e.def.id, e.def]));
      for (const id of campaignAi.getOrderedFleetIds()) {
        const fleet = map.fleets.find((f) => f.id === id);
        const site = sites.get(campaignAi.orderedSite(id) ?? '');
        if (!fleet || fleet.destroyed || !site) continue;
        orders.add(`${fleet.factionId}>${site.id}`);
        // From the second frame of an order on, the fleet heads for its site or holds it.
        const onSite = Math.hypot(Math.floor(fleet.x) - site.x, Math.floor(fleet.y) - site.y) <= site.radius;
        const heading = fleet.targetX === site.x && fleet.targetY === site.y;
        if (seenOrder.has(id) && !onSite && !heading && !fleet.transit) stolen++;
        seenOrder.add(id);
      }
      for (const id of [...seenOrder]) if (!campaignAi.getOrderedFleetIds().has(id)) seenOrder.delete(id);
      for (const { def, state } of campaign.siteEntries()) {
        const entry = `${def.id}:${state.claimedBy}`;
        if (state.claimedBy && !claims.some((c) => c.startsWith(entry))) claims.push(`${entry}@${minute()}`);
      }
    }

    const report = [
      `orders ${[...orders].join(', ')}`,
      `claims ${claims.join(', ')}`,
      `frames an ordered fleet went elsewhere ${stolen}`,
      `outcome ${map.gameOutcome} at minute ${minute()}`,
    ];
    (globalThis as any).process?.stdout?.write(report.map((line) => `m6 ${line}\n`).join(''));

    const claimMinute = (factionId: string) => claims.filter((c) => c.includes(`:${factionId}@`)).map((c) => Number(c.split('@')[1]));
    expect(stolen).toBe(0);
    expect(claimMinute('varkon').some((m) => m <= 30), 'a Varkon archive by minute 30').toBe(true);
    expect(claimMinute('concordium').length).toBeLessThanOrEqual(1);
  }, 600_000);
});

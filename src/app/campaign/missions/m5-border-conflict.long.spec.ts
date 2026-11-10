import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { TradeNetworkService } from '../../components/star-map/trade-network.service';
import { EnemyInvasionService } from '../../components/star-map/enemy-invasion.service';
import { getRelation } from '../../components/star-map/diplomacy';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';

/*
 * Mission 5 — a 40-minute run with the real AIs (docs/campaign-design.md,
 * Phase 6). The player picks the opportunist role and stays passive. Checks
 * the phase's acceptance points: the mercantile League never raids or
 * assaults a civilization, stays solvent and builds at least 3 Trading
 * Posts; the scripted Concordium–Varkon war lasts at least 10 minutes
 * without player action.
 */
describe('Mission 5 AI run (long)', () => {
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
    for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact', 'm4_meridian_exchange']) {
      TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    }
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('the League trades peacefully and the border war runs on its own (40 minutes, Normal)', () => {
    expect(TestBed.inject(CampaignMissionService).startMission('m5_border_conflict', 'normal', 1).ok).toBe(true);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    const minute = () => Math.floor(map['gameSeconds'] / 60);
    const faction = (id: string) => map.factions.find((f) => f.id === id)!;

    const raids: string[] = [];
    const trade = TestBed.inject(TradeNetworkService);
    const tick = trade.tick.bind(trade);
    vi.spyOn(trade, 'tick').mockImplementation((...args: Parameters<typeof trade.tick>) => {
      const result = tick(...args);
      for (const raid of result.raids) raids.push(`${raid.raiderFactionId}@${minute()}`);
      return result;
    });
    const assaults: string[] = [];
    const invasion = TestBed.inject(EnemyInvasionService);
    const launch = invasion.launch.bind(invasion);
    vi.spyOn(invasion, 'launch').mockImplementation((...args: Parameters<typeof invasion.launch>) => {
      const result = launch(...args);
      assaults.push(`${args[0][0]?.factionId}>${args[1].name}(${args[1].civilization ? 'civ' : args[1].factionId}):${result}@${minute()}`);
      return result;
    });

    const diplomacy = TestBed.inject(DiplomacyService);
    const warMinutes: number[] = [];
    let lowestLeagueCredits = Infinity;
    let leagueArrears = 0;
    const dt = 0.5;
    for (let t = 0; t < 40 * 60; t += dt) {
      if (map.campaignMessage) {
        const choices = map.campaignMessage.choices;
        map.onCampaignChoice(choices.find((c) => c.id === 'opportunist' || c.id === 'wait')?.id ?? choices[0]?.id ?? null);
      }
      if (map.anomalyEvent) map.onAnomalyChoice(map.anomalyEvent.choices[map.anomalyEvent.choices.length - 1].id);
      for (const demand of diplomacy.getPendingDemandsFor('player')) map.onDeclineDemand(demand.id);
      if (map.gameOutcome !== 'inProgress') break;
      map['gameLoopCallback'](dt);
      if (map['gameSeconds'] % 60 < dt) {
        if (getRelation(faction('concordium'), faction('varkon'))?.state === 'war') warMinutes.push(minute());
        const credits = faction('meridian').currencies['credits'] ?? 0;
        lowestLeagueCredits = Math.min(lowestLeagueCredits, credits);
        if (credits <= 0) leagueArrears++;
      }
    }

    const leaguePosts = map.starSystems.flatMap((s) => s.planetsTiles)
      .filter((p) => p.factionId === 'meridian' && p.buildings.some((b) => b.name === 'Trading Post' && !((b.constructionRemaining ?? 0) > 0))).length;
    const leaguePlanets = map.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === 'meridian').map((p) => p.name);
    const report = [
      `border war minutes ${warMinutes.length} (${warMinutes[0] ?? '-'}..${warMinutes[warMinutes.length - 1] ?? '-'})`,
      `raids ${raids.join(', ')}`,
      `assaults ${assaults.join(', ')}`,
      `league planets ${leaguePlanets.join(', ')} posts ${leaguePosts} lowest credits ${Math.floor(lowestLeagueCredits)} broke minutes ${leagueArrears}`,
      `wars ${map.factions.filter((f) => f.ai).map((f) => `${f.id}:${Object.entries(f.relations ?? {}).filter(([, r]) => r.state === 'war').map(([id]) => id).join('+')}`).join(' ')}`,
      `outcome ${map.gameOutcome}`,
    ];
    (globalThis as any).process?.stdout?.write(report.map((line) => `m5 ${line}\n`).join(''));

    expect(raids.filter((r) => r.startsWith('meridian'))).toEqual([]);
    expect(assaults.filter((a) => a.startsWith('meridian>') && a.includes('(civ)'))).toEqual([]);
    expect(leagueArrears).toBe(0);
    expect(leaguePosts).toBeGreaterThanOrEqual(3);
    expect(warMinutes.length, 'minutes of Concordium–Varkon war').toBeGreaterThanOrEqual(10);
  }, 600_000);
});

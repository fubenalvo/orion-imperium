import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { TradeNetworkService } from '../../components/star-map/trade-network.service';
import { EnemyInvasionService } from '../../components/star-map/enemy-invasion.service';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';

/*
 * Mission 4 — a 40-minute run with the real AIs (docs/campaign-design.md,
 * Phase 5). A passive player who answers every message with its first
 * choice and refuses demands. Checks the acceptance points of the phase:
 * Varkon raids civilian (League) traders between minutes 10 and 30, and no
 * AI launches an assault on a protected League world.
 */
describe('Mission 4 AI run (long)', () => {
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
    for (const id of ['m1_discovery', 'm2_beyond_the_gate', 'm3_first_contact']) {
      TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
    }
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('Varkon raids League traders in minutes 10–30; no assault on a protected League world (40 minutes, Normal)', () => {
    expect(TestBed.inject(CampaignMissionService).startMission('m4_meridian_exchange', 'normal', 1).ok).toBe(true);
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    const minute = () => Math.floor(map['gameSeconds'] / 60);

    const raids: string[] = [];
    const trade = TestBed.inject(TradeNetworkService);
    const tick = trade.tick.bind(trade);
    vi.spyOn(trade, 'tick').mockImplementation((...args: Parameters<typeof trade.tick>) => {
      const result = tick(...args);
      for (const raid of result.raids) raids.push(`${raid.raiderFactionId}>${raid.ownerId ?? 'civilian'}@${minute()}`);
      return result;
    });
    const raidOrders = new Map<number, number>();
    const assaults: string[] = [];
    const invasion = TestBed.inject(EnemyInvasionService);
    const launch = invasion.launch.bind(invasion);
    vi.spyOn(invasion, 'launch').mockImplementation((...args: Parameters<typeof invasion.launch>) => {
      const result = launch(...args);
      assaults.push(`${args[0][0]?.factionId}>${args[1].name}:${result}@${minute()}`);
      return result;
    });

    const diplomacy = TestBed.inject(DiplomacyService);
    const dt = 0.5;
    let hubFreeAt35 = false;
    for (let t = 0; t < 40 * 60; t += dt) {
      if (map.campaignMessage) map.onCampaignChoice(map.campaignMessage.choices[0]?.id ?? null);
      if (map.anomalyEvent) map.onAnomalyChoice(map.anomalyEvent.choices[map.anomalyEvent.choices.length - 1].id);
      for (const demand of diplomacy.getPendingDemandsFor('player')) map.onDeclineDemand(demand.id);
      if (map.gameOutcome !== 'inProgress') break;
      map['gameLoopCallback'](dt);
      for (const fleet of map.fleets) {
        const target = fleet.raidTraderId;
        if (fleet.factionId === 'varkon' && typeof target === 'number' && !raidOrders.has(target)) raidOrders.set(target, minute());
      }
      if (minute() === 35 && !hubFreeAt35) hubFreeAt35 = map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === 'Meridian Hub')!.factionId === 'independent';
    }

    const owner = (name: string) => map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === name)!.factionId;
    const report = [
      `varkon raid orders at minutes ${[...raidOrders.values()].join(',')}`,
      `raids ${raids.join(', ')}`,
      `assaults ${assaults.join(', ')}`,
      `hub ${owner('Meridian Hub')} cantor ${owner("Cantor's Rest")} outcome ${map.gameOutcome}`,
      `wars ${map.factions.filter((f) => f.ai).map((f) => `${f.id}:${Object.entries(f.relations ?? {}).filter(([, r]) => r.state === 'war').map(([id]) => id).join('+')}`).join(' ')}`,
    ];
    (globalThis as any).process?.stdout?.write(report.map((line) => `m4 ${line}\n`).join(''));

    const varkonOrders = [...raidOrders.values()];
    expect(varkonOrders.some((m) => m >= 10 && m <= 30), 'a Varkon raid order on a trader in minutes 10–30').toBe(true);
    // Before minute 35 nobody assaults the Hub; Cantor's Rest is protected all mission.
    expect(assaults.filter((a) => a.includes('>Meridian Hub') && Number(a.split('@')[1]) < 35)).toEqual([]);
    expect(assaults.filter((a) => a.includes(">Cantor's Rest"))).toEqual([]);
    expect(hubFreeAt35).toBe(true);
    expect(owner("Cantor's Rest")).toBe('independent');
  }, 600_000);
});

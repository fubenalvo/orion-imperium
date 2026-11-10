import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { TradeNetworkService } from '../../components/star-map/trade-network.service';
import { EnemyInvasionService } from '../../components/star-map/enemy-invasion.service';
import { SpaceBaseService } from '../../components/star-map/space-base.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph } from '../../components/star-map/fleet-navigation';
import { getRelation } from '../../components/star-map/diplomacy';
import { MiningStation, PlanetTile } from '../../components/star-map/star-map.models';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M4_MERIDIAN_EXCHANGE } from './m4-meridian-exchange';

/* Mission 4 — The Meridian Exchange: its map rules, League standing sources, Hub protection and both victories. */
describe('Mission 4: The Meridian Exchange', () => {
  const build = () => buildMission(M4_MERIDIAN_EXCHANGE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map', () => {
    it('is valid, follows Mission 3, and has the design counts', () => {
      expect(validateMission(M4_MERIDIAN_EXCHANGE)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(9);
      expect(planets.length).toBe(18);
      expect(planets.filter((p) => p.factionId !== 'unhabited').map((p) => `${p.name}:${p.factionId}`)).toEqual([
        'Corvane:player', 'Concord Reach:concordium', 'Meridian Hub:independent', "Cantor's Rest:independent", 'Cantor Minor:varkon', 'Varkon Bastion:varkon',
      ]);
      expect(planets.filter((p) => p.civilization === 'Meridian League').length).toBe(2);
      expect(data.wormholes?.[0]).toMatchObject({ id: 'exchange_gate', state: 'active' });
      expect(data.spaceBases).toEqual([{ id: 1, name: 'Tangle Free Port', factionId: 'free_port', x: 120, y: 100 }]);
      expect(data.campaign!.protectedPlanets).toEqual([{ planetName: 'Meridian Hub' }, { planetName: "Cantor's Rest" }]);
    });

    it('routes east–west trade through the Hub gap and around both belts', () => {
      const graph = new NavGraph(beltObstacles(M4_MERIDIAN_EXCHANGE.map.asteroidBelts), { width: 200, height: 120 });
      expect(graph.plan({ x: 30, y: 90 }, { x: 178, y: 76 }).ok).toBe(true);
      expect(graph.plan({ x: 40, y: 24 }, { x: 150, y: 20 }).ok).toBe(true);
      expect(graph.plan({ x: 62, y: 102 }, { x: 132, y: 88 }).ok).toBe(true);
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
    const value = (key: string) => campaign().state!.values[key] ?? 0;
    const planet = (map: StarMap, name: string): PlanetTile => map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === name)!;
    const faction = (map: StarMap, id: string) => map.factions.find((f) => f.id === id)!;
    const tradingPost = (p: PlanetTile, x = 0) => p.buildings.push({ name: 'Trading Post', size: 2, x, y: 12 });
    const start = (carry: Record<string, string> = {}): StarMap => {
      const progress = TestBed.inject(CampaignProgressService);
      progress.recordCompletion('m3_first_contact', { endingId: 'm3_accord', difficulty: 'normal', records: carry, researchedTechnologies: [] });
      expect(TestBed.inject(CampaignMissionService).startMission('m4_meridian_exchange', 'normal', 1).ok).toBe(true);
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
    const deliver = (map: StarMap, to: string, homeOwnerId: string | null = 'player') => {
      vi.spyOn(TestBed.inject(TradeNetworkService), 'tick').mockReturnValueOnce({
        changed: true,
        deliveries: [{ traderId: 1, credits: 1000, goods: 'ore', homeOwnerId, destinationOwnerId: null, portFee: 0, destinationPlanetId: planet(map, to).id }],
        stranded: [],
        raids: [],
      });
      run(map, 0.25);
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
      for (const id of ['m1_discovery', 'm2_beyond_the_gate']) {
        TestBed.inject(CampaignProgressService).recordCompletion(id, { endingId: 'x', difficulty: 'normal', records: {}, researchedTechnologies: [] });
      }
    });

    afterEach(() => {
      campaign().leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('carries the Mission 3 alignment into the opening opinions', () => {
      const map = start({ m3_alignment: 'concordium' });
      expect(campaign().state!.firedEvents).toContain('alignment_concordium');
      expect(getRelation(faction(map, 'concordium'), faction(map, 'player'))!.opinion).toBeGreaterThanOrEqual(35);
    });

    it('protects the Hub from every AI until minute 35, then only from all but Varkon', () => {
      const map = start();
      const invasion = TestBed.inject(EnemyInvasionService);
      const hub = planet(map, 'Meridian Hub');
      expect(invasion.isHostilePlanet(hub, faction(map, 'varkon'), map.factions)).toBe(false);
      skipTo(map, 2100);
      // The Charter vote (minute 25) is answered first.
      expect(map.campaignMessage?.eventId).toBe('charter_vote');
      map.onCampaignChoice('open');
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('varkon_moves');
      map.onCampaignChoice(null);
      // Civilization worlds are fair game for any empire; the campaign keeps the others away.
      expect(invasion.isHostilePlanet(hub, faction(map, 'varkon'), map.factions)).toBe(true);
      expect(invasion.isHostilePlanet(hub, faction(map, 'concordium'), map.factions)).toBe(false);
      expect(invasion.isHostilePlanet(planet(map, "Cantor's Rest"), faction(map, 'varkon'), map.factions)).toBe(false);
    });

    it('keeps the Hub protected after the Varkon protection deal', () => {
      const map = start();
      skipTo(map, 1500);
      expect(map.campaignMessage?.eventId).toBe('charter_vote');
      map.onCampaignChoice('varkon');
      expect(value('league_standing')).toBe(-15);
      skipTo(map, 2100);
      expect(campaign().state!.firedEvents).not.toContain('varkon_moves');
      expect(TestBed.inject(EnemyInvasionService).isHostilePlanet(planet(map, 'Meridian Hub'), faction(map, 'varkon'), map.factions)).toBe(false);
    });

    it('raises League standing from player deliveries to League ports, up to the source cap', () => {
      const map = start();
      deliver(map, 'Meridian Hub');
      expect(value('league_standing')).toBe(1.5);
      deliver(map, 'Concord Reach');
      deliver(map, "Cantor's Rest", null);
      expect(value('league_standing')).toBe(1.5);
      for (let i = 0; i < 40; i++) deliver(map, "Cantor's Rest");
      expect(value('league_standing')).toBe(40);
    });

    it('raises League standing from exchange trades and battles won near League worlds', () => {
      const map = start();
      tradingPost(planet(map, 'Corvane'));
      map.onTradeRequest({ direction: 'buyRaw', raw: 200 });
      expect(value('league_standing')).toBeGreaterThan(0);
      const afterTrade = value('league_standing');
      campaign().recordBattleWon('varkon', 102, 62, map['campaignWorld']());
      expect(value('league_standing')).toBe(afterTrade + 5);
      campaign().recordBattleWon('varkon', 30, 90, map['campaignWorld']());
      expect(value('league_standing')).toBe(afterTrade + 5);
    });

    it('The Free Exchange: posts, trade, standing, mining, and the Hub still free', () => {
      const map = start({ m3_alignment: 'concordium' });
      skipTo(map, 1500);
      map.onCampaignChoice('exclusive');
      expect(campaign().state!.flags['m4_charter']).toBe('exclusive');

      tradingPost(planet(map, 'Corvane'));
      planet(map, 'Corvane Outer').factionId = 'player';
      tradingPost(planet(map, 'Corvane Outer'), 4);
      campaign().addValue('trade_income', 8000);
      campaign().addValue('league_standing', 40);
      for (const id of ['cinderfall', 'halcyon_drift']) {
        map.starSystems.find((s) => s.id === id)!.asteroidBelt!.asteroids[0].miningStation = { factionId: 'player' } as MiningStation;
      }
      run(map, 1.5);
      expect(['trading_posts', 'trade_income', 'league_standing', 'raw_supply'].map(status)).toEqual(['done', 'done', 'done', 'done']);
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m4_meridian_exchange')).toMatchObject({
        endingId: 'm4_exchange',
        records: { m4_path: 'exchange', m4_charter: 'exclusive', league_standing: 65 },
      });
    });

    it('Market dominance: four Trading Posts with a captured League world, at a cost in standing', () => {
      const map = start();
      campaign().addValue('league_standing', 30);
      planet(map, 'Meridian Hub').factionId = 'player';
      run(map, 1.5);
      expect(campaign().state!.flags['m4_league_conquered']).toBe(true);
      expect(value('league_standing')).toBe(-10);
      tradingPost(planet(map, 'Corvane'));
      for (const name of ['Corvane Outer', 'Tamsin']) {
        planet(map, name).factionId = 'player';
        tradingPost(planet(map, name), 4);
      }
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m4_meridian_exchange')?.endingId).toBe('m4_market_dominance');
    });

    it('fails when Varkon takes the Hub', () => {
      const map = start();
      planet(map, 'Meridian Hub').factionId = 'varkon';
      run(map, 1.5);
      expect(map.gameOutcome).toBe('defeat');
      expect(map.campaignEndText).toBe('The Dominion took the Meridian Hub. The Exchange is closed.');
    });

    it('rewards destroying the free port, and counts a lost player trader', () => {
      const map = start();
      const bases = TestBed.inject(SpaceBaseService);
      expect(bases.bases.some((b) => b.name === 'Tangle Free Port')).toBe(true);
      bases.restore([]);
      run(map, 1.5);
      expect(status('free_port')).toBe('done');
      expect(value('league_standing')).toBe(10);

      map['handleTraderRaids']([{ traderId: 9, homePlanetId: planet(map, 'Corvane').id, raiderFleetId: -1, raiderFactionId: 'varkon', ownerId: 'player', goods: 'ore', cargoCredits: 500, loot: 375, opinion: 0, reputation: 0, respawnSeconds: 120 }]);
      run(map, 1.5);
      expect(campaign().state!.counters['trader_lost:varkon']).toBe(1);
      expect(status('safe_traders')).toBe('failed');
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { TradeNetworkService } from '../../components/star-map/trade-network.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph } from '../../components/star-map/fleet-navigation';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M2_BEYOND_THE_GATE } from './m2-beyond-the-gate';

/* Mission 2 — Beyond the Gate: its map rules, and a scripted playthrough. */
describe('Mission 2: Beyond the Gate', () => {
  const build = () => buildMission(M2_BEYOND_THE_GATE, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map', () => {
    it('is valid, follows Mission 1, and has the design counts', () => {
      expect(validateMission(M2_BEYOND_THE_GATE)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(6);
      expect(planets.length).toBe(10);
      expect(planets.filter((p) => p.factionId !== 'unhabited').map((p) => p.name)).toEqual(['Landfall', 'Tessaly Hold']);
      expect(data.anomalies?.anomalies.map((a) => a.key)).toEqual(['m2_echo', 'm2_relay']);
      expect(data.nebulae?.length).toBe(2);
      expect(data.wormholes?.[0].state).toBe('dormant');
      expect(data.factions.filter((f) => f.ai)).toEqual([]);
    });

    it('hides Tessaly and makes it a trading civilization', () => {
      const data = build();
      const tessaly = data.starSystems.find((s) => s.id === 'tessaly')!;
      expect(tessaly.explored).toBe(false);
      const hold = tessaly.planetsTiles[0];
      expect(hold.civilization).toBe('Tessaly Hold');
      expect(hold.buildings.map((b) => b.name)).toEqual(expect.arrayContaining(['Trading Post', 'Bank', 'Planetary Shield']));
      expect(hold.satisfaction).toBe(60);
    });

    it('puts the rich deposits at Sunder Drift, and both routes around the belt exist', () => {
      const sunder = build().starSystems.find((s) => s.id === 'sunder_drift')!;
      expect(sunder.asteroidBelt!.asteroids.slice(0, 3).map((a) => a.rawMaterials)).toEqual([18_000, 15_000, 12_000]);
      const graph = new NavGraph(beltObstacles(M2_BEYOND_THE_GATE.map.asteroidBelts), { width: 140, height: 84 });
      expect(graph.plan({ x: 20, y: 44 }, { x: 112, y: 22 }).ok).toBe(true);
      expect(graph.plan({ x: 44, y: 20 }, { x: 80, y: 44 }).ok).toBe(true);
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
    const fleet = (map: StarMap) => map.fleets.find((f) => f.name === 'EXPEDITION')!;
    const putFleet = (map: StarMap, x: number, y: number) => {
      const f = fleet(map);
      Object.assign(f, { system: null, x, y, targetX: null, targetY: null });
    };
    const planet = (map: StarMap, name: string) => map.starSystems.flatMap((s) => s.planetsTiles).find((p) => p.name === name)!;
    const start = (): StarMap => {
      expect(TestBed.inject(CampaignMissionService).startMission('m2_beyond_the_gate', 'normal', 1).ok).toBe(true);
      return createStarMap();
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
      // Mission 2 requires Mission 1.
      TestBed.inject(CampaignProgressService).recordCompletion('m1_discovery', {
        endingId: 'through_the_gate', difficulty: 'normal', records: {},
        researchedTechnologies: ['basic_engineering', 'basic_radar', 'fighter_technology', 'stellar_engineering'],
      });
    });

    afterEach(() => {
      campaign().leave();
      localStorage.clear();
      vi.restoreAllMocks();
    });

    it('carries Mission 1 technologies that exist in its horizon, and no others', () => {
      const map = start();
      const researched = map.factions.find((f) => f.id === 'player')!.researchedTechnologies!;
      expect(researched).toContain('fighter_technology');
      expect(researched).not.toContain('stellar_engineering');
    });

    it('charts hidden Tessaly through the Echo Beacon', () => {
      const map = start();
      run(map, 1.5);
      map.onCampaignChoice(null);
      const tessaly = map.starSystems.find((s) => s.id === 'tessaly')!;
      expect(tessaly.explored).toBe(false);
      putFleet(map, 64, 52);
      run(map, 1);
      expect(map.anomalyEvent?.name).toBe('Echo Beacon');
      map.onAnomalyChoice('triangulate');
      expect(tessaly.explored).toBe(true);
      expect(map['exploredGridCells'].has('112-22')).toBe(true);
    });

    it('counts trade deliveries the player receives as trade income', () => {
      const map = start();
      run(map, 1.5);
      vi.spyOn(TestBed.inject(TradeNetworkService), 'tick').mockReturnValueOnce({
        changed: true,
        deliveries: [
          { traderId: 1, credits: 1200, goods: 'ore', homeOwnerId: 'player', destinationOwnerId: null, portFee: 0 },
          { traderId: 2, credits: 900, goods: 'ore', homeOwnerId: null, destinationOwnerId: 'player', portFee: 180 },
          { traderId: 3, credits: 500, goods: 'ore', homeOwnerId: null, destinationOwnerId: null, portFee: 0 },
        ],
        stranded: [],
        raids: [],
      });
      run(map, 1.5);
      expect(campaign().state!.values['trade_income']).toBe(1380);
    });

    it('can be completed: settle, explore, meet Tessaly, trade, decode the relay', () => {
      const map = start();
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('landfall');
      map.onCampaignChoice(null);

      // Track A: housing for 1,500 people, and two more colonies.
      const landfall = planet(map, 'Landfall');
      landfall.buildings.push({ name: 'Medium Residential Block', size: 2, x: 0, y: 0 });
      landfall.population = 1500;
      planet(map, 'Ashfall').factionId = 'player';
      planet(map, 'Cinder Prime').factionId = 'player';

      // Track B: chart the region, meet Tessaly Hold.
      for (const key of ['20-44', '44-20', '52-62', '80-44', '118-64']) map['exploredGridCells'].add(key);
      putFleet(map, 112, 22);
      run(map, 1.5);
      expect(['grow_population', 'found_colonies', 'chart_region'].map(status)).toEqual(['done', 'done', 'done']);
      expect(map.campaignMessage?.eventId).toBe('tessaly_contact');
      map.onCampaignChoice('friendship');
      run(map, 1.5);
      expect(status('contact_tessaly')).toBe('done');

      // Trade: a Trading Post adds standing; income comes from deliveries.
      landfall.buildings.push({ name: 'Trading Post', size: 2, x: 4, y: 0 });
      campaign().addValue('trade_income', 3000);
      run(map, 1.5);
      expect(status('open_trade')).toBe('done');
      expect(campaign().state!.values['league_standing']).toBe(30);

      // Finale: the warden falls, the relay is decoded through the anomaly pipeline.
      const warden = map.fleets.find((f) => f.name === 'WARDEN')!;
      warden.ships.forEach((s) => (s.destroyed = true));
      warden.destroyed = true;
      putFleet(map, 118, 64);
      run(map, 1);
      expect(map.anomalyEvent?.name).toBe('The Relay');
      map.onAnomalyChoice('decode');
      run(map, 1.5);
      expect(map.gameOutcome).toBe('victory');
      const record = TestBed.inject(CampaignProgressService).getRecord('m2_beyond_the_gate');
      expect(record?.endingId).toBe('first_signal');
      expect(record?.records).toEqual({ m2_tessaly_met: 'friendship', league_standing: 40 });
    });
  });
});

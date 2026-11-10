import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../../components/star-map/star-map';
import { StarMapGameLoopService } from '../../components/star-map/star-map-game-loop.service';
import { SpaceBaseService } from '../../components/star-map/space-base.service';
import { EnemyCampaignService } from '../../components/star-map/enemy-campaign.service';
import { beltObstacles } from '../../components/star-map/asteroid-belts';
import { NavGraph, routeLength } from '../../components/star-map/fleet-navigation';
import { Fleet } from '../../components/star-map/star-map.models';
import researchTree from '../../components/star-map/research-tree.json';
import { ResearchService } from '../../services/research.service';
import { SaveGameService } from '../../services/save-game.service';
import { GameOutcomeService } from '../../services/game-outcome.service';
import { CampaignMissionService } from '../campaign-mission.service';
import { CampaignService } from '../campaign.service';
import { CampaignProgressService } from '../campaign-progress.service';
import { buildMission } from '../mission-builder';
import { validateCampaign, validateMission } from '../mission-validation';
import { MISSION_DEFINITIONS } from './index';
import { M6_SILENT_REMNANT } from './m6-silent-remnant';

const ANCIENT = ['remnant_sensor_lattice', 'remnant_drive', 'remnant_shield_matrix', 'remnant_aegis_grid'];

/* Mission 6 — The Silent Remnant: the archives race, ancient technologies, the Lacuna core. */
describe('Mission 6: The Silent Remnant', () => {
  const build = () => buildMission(M6_SILENT_REMNANT, { difficulty: 'normal', carry: { flags: {}, technologies: [] } });

  describe('map and technologies', () => {
    it('is valid, follows Mission 5, and has the design counts', () => {
      expect(validateMission(M6_SILENT_REMNANT)).toEqual([]);
      expect(validateCampaign(MISSION_DEFINITIONS)).toEqual([]);
      const data = build();
      const planets = data.starSystems.flatMap((s) => s.planetsTiles);
      expect(data.starSystems.length).toBe(13);
      expect(planets.length).toBe(28);
      expect(planets.filter((p) => p.factionId !== 'unhabited').length).toBe(7);
      expect(data.spaceBases?.map((b) => b.factionId)).toEqual(['remnant', 'remnant', 'remnant']);
      expect(data.wormholes?.[0]).toMatchObject({ id: 'lacuna_gate', state: 'dormant' });
      expect(data.anomalies?.anomalies.map((a) => a.type)).toContain('lacuna_station');
    });

    it('makes the ancient technologies campaign-only, grant-only, and invisible in a skirmish', () => {
      const techs = (researchTree as { technologies: { id: string; campaignOnly?: boolean; ancient?: boolean }[] }).technologies;
      for (const id of ANCIENT) expect(techs.find((t) => t.id === id)).toMatchObject({ campaignOnly: true, ancient: true });
      for (const mission of MISSION_DEFINITIONS) for (const id of ANCIENT) expect(mission.researchHorizon).not.toContain(id);
      const research = TestBed.inject(ResearchService);
      research.setCampaignHorizon(null);
      for (const id of ANCIENT) {
        expect(research.getAllTechnologies().some((t) => t.id === id)).toBe(false);
        expect(research.isAvailable({ id: 'x', researchedTechnologies: [] } as never, id)).toBe(false);
      }
    });

    it('keeps the race fair: each empire\'s nearest archive is within ±15%, and the player\'s second is no worse than Varkon\'s', () => {
      const graph = new NavGraph(beltObstacles(M6_SILENT_REMNANT.map.asteroidBelts), { width: 270, height: 162 });
      const route = (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const plan = graph.plan(from, to);
        expect(plan.ok).toBe(true);
        return routeLength(from, plan.ok ? plan.waypoints : [], to);
      };
      const archives = M6_SILENT_REMNANT.sites!.filter((s) => s.id.startsWith('archive'));
      const starts = { player: { x: 40, y: 100 }, concordium: { x: 85, y: 18 }, varkon: { x: 220, y: 92 } };
      const sorted = Object.fromEntries(Object.entries(starts).map(([id, from]) => [id, archives.map((a) => route(from, a)).sort((a, b) => a - b)]));
      const nearest = Object.values(sorted).map((d) => d[0]);
      const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
      for (const d of nearest) expect(Math.abs(d - mean) / mean).toBeLessThanOrEqual(0.15);
      expect(sorted['player'][1]).toBeLessThanOrEqual(sorted['varkon'][1]);
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
    const fleet = (map: StarMap, name: string) => map.fleets.find((f) => f.name === name)!;
    const park = (f: Fleet, x: number, y: number) => Object.assign(f, { system: null, x, y, targetX: null, targetY: null });
    const killWarden = (name: string) => {
      const bases = TestBed.inject(SpaceBaseService);
      bases.restore(bases.bases.filter((b) => b.name !== name));
    };
    const start = (): StarMap => {
      expect(TestBed.inject(CampaignMissionService).startMission('m6_silent_remnant', 'normal', 1).ok).toBe(true);
      const map = createStarMap();
      run(map, 1.5);
      expect(map.campaignMessage?.eventId).toBe('arrival');
      map.onCampaignChoice(null);
      run(map, 1.5);
      return map;
    };
    /* Takes an archive with a player fleet: warden gone, 90 s on the site. */
    const claim = (map: StarMap, site: string, warden: string, at: { x: number; y: number }) => {
      killWarden(warden);
      park(fleet(map, 'EXPEDITION'), at.x, at.y);
      run(map, 92, 0.5);
      expect(campaign().state!.sites![site].claimedBy).toBe('player');
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

    it('charts the archives from Lacuna Station', () => {
      const map = start();
      park(fleet(map, 'EXPEDITION'), 140, 82);
      run(map, 1);
      expect(map.anomalyEvent?.name).toBe('Lacuna Station');
      map.onAnomalyChoice('download');
      run(map, 1.5);
      expect(status('investigate')).toBe('done');
      expect(map['exploredGridCells'].has('80-94')).toBe(true);
      expect(map.campaignSiteViews.map((s) => s.id)).toEqual(expect.arrayContaining(['archive_1', 'archive_2', 'archive_3']));
    });

    it('does not let a site be claimed while its warden stands, and grants the archive\'s technology once held', () => {
      const map = start();
      const expedition = fleet(map, 'EXPEDITION');
      // The warden would fight the fleet on its cell; next to it the site is only contested.
      park(expedition, 81, 94);
      run(map, 20, 0.5);
      expect(campaign().state!.sites!['archive_3'].progress['player'] ?? 0).toBe(0);
      killWarden('Warden of Archive III');
      run(map, 92, 0.5);
      expect(campaign().state!.sites!['archive_3'].claimedBy).toBe('player');
      expect(campaign().state!.flags['site:archive_3']).toBe('player');
      expect(map.factions.find((f) => f.id === 'player')!.researchedTechnologies).toContain('remnant_drive');
    });

    it('opens the core with two archives, reveals Stellar Engineering and ends with the sharing choice', () => {
      const map = start();
      claim(map, 'archive_3', 'Warden of Archive III', { x: 80, y: 94 });
      claim(map, 'archive_1', 'Warden of Archive I', { x: 124, y: 36 });
      expect(status('claim_archives')).toBe('done');
      expect(campaign().state!.sites!['lacuna_core'].active).toBe(true);
      park(fleet(map, 'EXPEDITION'), 140, 82);
      run(map, 1);
      if (map.anomalyEvent) map.onAnomalyChoice('download');
      run(map, 92, 0.5);
      expect(campaign().state!.sites!['lacuna_core'].claimedBy).toBe('player');
      expect(campaign().state!.researchHorizon.includes('stellar_engineering') || campaign().state!.horizonExtras['player']?.includes('stellar_engineering')).toBe(true);
      expect(map['wormholes'][0].state).toBe('active');
      run(map, 1);
      expect(map.campaignMessage?.eventId).toBe('core_opened');
      map.onCampaignChoice('observers');
      expect(map.gameOutcome).toBe('victory');
      expect(TestBed.inject(CampaignProgressService).getRecord('m6_silent_remnant')?.records).toMatchObject({
        m6_shared_with: 'observers', 'site:archive_1': 'player', 'site:archive_3': 'player',
      });
    });

    it('fails when two archives fall to AI empires', () => {
      const map = start();
      const sites = campaign().siteEntries();
      sites.find((s) => s.def.id === 'archive_1')!.state.claimedBy = 'concordium';
      sites.find((s) => s.def.id === 'archive_2')!.state.claimedBy = 'varkon';
      run(map, 1.5);
      expect(map.gameOutcome).toBe('defeat');
    });

    it('sends Varkon for archive II from minute 5 through EnemyCampaignService', () => {
      const map = start();
      map['gameSeconds'] = 300;
      run(map, 8, 0.5);
      const ordered = [...TestBed.inject(EnemyCampaignService).getOrderedFleetIds()];
      expect(ordered.length).toBeGreaterThan(0);
      const varkonFleet = map.fleets.find((f) => f.id === ordered[0])!;
      expect(varkonFleet.factionId).toBe('varkon');
      expect([varkonFleet.targetX, varkonFleet.targetY]).toEqual([200, 128]);
    });
  });
});

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { StarMap } from '../components/star-map/star-map';
import { StarMapGameLoopService } from '../components/star-map/star-map-game-loop.service';
import { TradeNetworkService } from '../components/star-map/trade-network.service';
import { BattleService } from '../services/battle.service';
import { SaveGameService, SaveSlotId } from '../services/save-game.service';
import { GameOutcomeService } from '../services/game-outcome.service';
import { CampaignMissionService } from './campaign-mission.service';
import { CampaignService } from './campaign.service';
import { MissionDefinition } from './campaign.models';
import { clearTestMissions, registerTestMission } from './missions';
import { M0_FIXTURE } from './missions/m0-fixture';

/*
 * Wormhole transit in a real StarMap session (docs/campaign-design.md §11,
 * Phase 3b): two trading civilizations at the far ends of the map, linked
 * by a wormhole whose mouths sit next to them.
 */
const LINKED: MissionDefinition = {
  ...structuredClone(M0_FIXTURE),
  id: 'm0_wormhole',
  map: {
    ...structuredClone(M0_FIXTURE.map),
    systems: [
      {
        id: 'west', name: 'West', x: 10, y: 30, color: '#ffcc00',
        planets: [
          { name: 'Home', type: 'earthlike', size: 'medium', owner: 'player', population: 1200, layout: 'homeworld', deposit: true, explored: true },
          { name: 'West Hold', type: 'earthlike', size: 'big', owner: 'independent', civilization: 'West Hold', population: 800, layout: 'civilization_capital' },
        ],
      },
      {
        id: 'east', name: 'East', x: 90, y: 30, color: '#5ca8ff',
        planets: [{ name: 'East Hold', type: 'earthlike', size: 'big', owner: 'independent', civilization: 'East Hold', population: 800, layout: 'civilization_capital' }],
      },
    ],
    fleets: [
      { name: 'ORION', factionId: 'player', x: 12, y: 30, ships: ['frigate', 'frigate'], speed: 8 },
      { name: 'SENTINEL', factionId: 'remnant', x: 50, y: 55, ships: ['fighter'], tag: 'sentinel' },
    ],
    wormholes: [{ id: 'link', name: 'The Link', state: 'active', mouths: [{ x: 14, y: 33 }, { x: 86, y: 33 }] }],
    anomalies: [],
    defaultView: { systemId: 'west', planetName: 'Home' },
  },
  objectives: [{ id: 'never', title: 'Never', condition: { kind: 'flag', flag: 'never' } }],
  events: [],
};

describe('Wormhole transit in StarMap', () => {
  const createStarMap = (): StarMap => {
    const map = TestBed.createComponent(StarMap).componentInstance;
    vi.spyOn(map['cdr'], 'detectChanges').mockImplementation(() => {});
    map.ngOnInit();
    return map;
  };
  const run = (map: StarMap, seconds: number, each?: () => void, dt = 0.25) => {
    for (let t = 0; t < seconds; t += dt) {
      map['gameLoopCallback'](dt);
      each?.();
    }
  };
  const orion = (map: StarMap) => map.fleets.find((f) => f.name === 'ORION')!;
  const start = (): StarMap => {
    expect(TestBed.inject(CampaignMissionService).startMission('m0_wormhole', 'normal', 1).ok).toBe(true);
    const map = createStarMap();
    map.leavePlanetView();
    return map;
  };
  const sendOrion = (map: StarMap, x: number, y: number) => {
    Object.assign(orion(map), { system: null, targetX: x, targetY: y });
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    registerTestMission(LINKED);
    await TestBed.configureTestingModule({
      imports: [StarMap],
      providers: [{ provide: StarMapGameLoopService, useValue: { startGameLoop: vi.fn(), stopGameLoop: vi.fn() } }],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    TestBed.inject(SaveGameService).currentSlot = null;
    TestBed.inject(GameOutcomeService).reset();
  });

  afterEach(() => {
    TestBed.inject(CampaignService).leave();
    clearTestMissions();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hides a fleet in transit from the map and brings it out at the far mouth', () => {
    const map = start();
    sendOrion(map, 88, 30);
    let hidden = false;
    run(map, 25, () => {
      if (orion(map).transit) {
        hidden ||= !map.visibleFleets.includes(orion(map));
      }
    });
    expect(hidden).toBe(true);
    run(map, 20);
    expect(orion(map).transit).toBeUndefined();
    expect(Math.floor(orion(map).x)).toBeGreaterThanOrEqual(85);
  });

  it('saves the transit and finishes it after a reload', () => {
    const map = start();
    sendOrion(map, 88, 30);
    run(map, 30, undefined);
    // Mid-transit or just after; force a save and reload with a transit on the record.
    if (!orion(map).transit) orion(map).transit = { wormholeId: 'link', remaining: 5, exitX: 86, exitY: 33 };
    map['saveGame']();
    expect(TestBed.inject(SaveGameService).loadFromSlot(SaveSlotId.AUTOSAVE)!.fleets.find((f) => f.name === 'ORION')!.transit).toBeDefined();
    const reloaded = createStarMap();
    run(reloaded, 12);
    expect(orion(reloaded).transit).toBeUndefined();
    expect(Math.floor(orion(reloaded).x)).toBeGreaterThanOrEqual(85);
  });

  it('meets a fleet blockading the exit mouth in battle', () => {
    const map = start();
    const sentinel = map.fleets.find((f) => f.name === 'SENTINEL')!;
    Object.assign(sentinel, { x: 86, y: 33 });
    sendOrion(map, 88, 30);
    const battle = vi.spyOn(TestBed.inject(BattleService), 'setBattle');
    run(map, 45, undefined);
    expect(battle).toHaveBeenCalled();
  });

  it('routes civilian traders through the wormhole', () => {
    const map = start();
    const traders = TestBed.inject(TradeNetworkService);
    let jumped = false;
    let flewTheGap = false;
    run(map, 90, () => {
      for (const trader of traders.traders) {
        if (trader.transit) jumped = true;
        if (trader.status === 'travelling' && !trader.transit && trader.x > 25 && trader.x < 75) flewTheGap = true;
      }
    }, 0.5);
    expect(jumped).toBe(true);
    expect(flewTheGap, 'no trader flies the long way').toBe(false);
  });
});

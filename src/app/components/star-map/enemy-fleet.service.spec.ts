import { TestBed } from '@angular/core/testing';
import { EnemyFleetService } from './enemy-fleet.service';
import { Faction, Fleet, StarSystem } from './star-map.models';
import { DriftingAsteroidService } from './drifting-asteroid.service';
import { GameSettingsService } from '../../services/game-settings.service';
import { TradeNetworkService } from './trade-network.service';
import { createInitialTradeNetworkState } from './trade-network';
import { AI_PERSONALITY_PROFILES } from './ai-personality';
import { AiActionLedger } from './ai-action-ledger';

/*
 * Unit tests for AI fleet operations with the real ShipService strength
 * formula and SpaceportService. One tick with dt = 2 is one decision.
 */
describe('EnemyFleetService', () => {
  let service: EnemyFleetService;

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, aiDifficulty: 'normal', currencies: {} },
  ];
  const ai = factions[1];

  // Home system with a Spaceport at (10,10); a colony system at (40,10).
  const systems = (): StarSystem[] => [
    {
      id: 'home',
      name: 'Home',
      x: 10,
      y: 10,
      planets: 1,
      color: '#fff',
      planetsTiles: [
        {
          id: 1, index: 0, name: 'H', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'medium',
          population: 1000, explored: true, buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }],
        },
      ],
    },
    {
      id: 'colony',
      name: 'Colony',
      x: 40,
      y: 10,
      planets: 1,
      color: '#fff',
      planetsTiles: [
        { id: 2, index: 0, name: 'C', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'small', population: 0, explored: true, buildings: [] },
      ],
    },
  ];

  let nextShip = 1;
  const fleet = (id: number, factionId: string, x: number, y: number, types: string[]): Fleet => ({
    id,
    name: `F${id}`,
    factionId,
    x,
    y,
    targetX: null,
    targetY: null,
    speed: 4,
    system: null,
    ships: types.map((type) => ({ id: nextShip++, name: type, type })),
  });

  const decide = (fleets: Fleet[], sys: StarSystem[], pipeline: number[] = []) =>
    service.tick(2, ai, factions, sys, fleets, new Set(pipeline));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EnemyFleetService);
  });

  it('sends an idle fleet to garrison its home Spaceport system', () => {
    const f = fleet(1, 'enemy1', 30, 30, ['frigate']);
    const changed = decide([f], systems());

    expect(changed).toBe(true);
    expect(service.getAssignment(1)?.role).toBe('garrison');
    expect([f.targetX, f.targetY]).toEqual([10, 10]);
  });

  it('records a fleet order once per new role or target, not for repeated decisions (AiActionLedger)', () => {
    const ledger = TestBed.inject(AiActionLedger);
    ledger.reset();
    const f = fleet(1, 'enemy1', 30, 30, ['frigate']);
    decide([f], systems());
    decide([f], systems());
    expect(ledger.report().factions[0].totalsByKind).toEqual({ fleet_order: 1 });

    // A stronger hostile arrives: retreat is a new order.
    decide([f, fleet(50, 'player', 36, 30, ['battleship', 'battleship'])], systems());
    expect(ledger.report().factions[0].totalsByKind).toEqual({ fleet_order: 2 });
  });

  it('retreats an exposed fleet from a stronger hostile fleet', () => {
    const exposed = fleet(1, 'enemy1', 30, 30, ['frigate']);
    const hostile = fleet(50, 'player', 36, 30, ['battleship', 'battleship']);
    decide([exposed, hostile], systems());

    expect(service.getAssignment(1)?.role).toBe('retreat');
    expect([exposed.targetX, exposed.targetY]).toEqual([10, 10]);
  });

  it('intercepts a weak intruder with just enough strength and leaves other fleets on post', () => {
    const near = fleet(1, 'enemy1', 10, 10, ['destroyer']);
    const other = fleet(2, 'enemy1', 10, 10, ['destroyer']);
    const intruder = fleet(50, 'player', 18, 10, ['scout']);
    decide([near, other, intruder], systems());

    const roles = [service.getAssignment(1)?.role, service.getAssignment(2)?.role];
    expect(roles.filter((r) => r === 'intercept')).toHaveLength(1);
    const hunter = service.getAssignment(1)?.role === 'intercept' ? near : other;
    expect([hunter.targetX, hunter.targetY]).toEqual([18, 10]);

    // The next decision does not pull the second fleet in as well.
    decide([near, other, intruder], systems());
    expect([service.getAssignment(1)?.role, service.getAssignment(2)?.role].filter((r) => r === 'intercept')).toHaveLength(1);
  });

  it('does not intercept a hostile fleet stronger than its available fleets', () => {
    const guard = fleet(1, 'enemy1', 10, 10, ['fighter']);
    const raider = fleet(50, 'player', 25, 10, ['cruiser', 'cruiser']);
    decide([guard, raider], systems());

    expect(service.getAssignment(1)?.role).not.toBe('intercept');
    expect(guard.targetX).toBeNull();
  });

  it('sends a fleet that lost most of its strength home to regroup', () => {
    const f = fleet(1, 'enemy1', 40, 10, ['destroyer', 'destroyer', 'destroyer', 'destroyer']);
    decide([f], systems());
    // Battle losses as StarMap.applyBattleResult writes them.
    f.ships.slice(0, 3).forEach((s) => (s.destroyed = true));
    f.targetX = null;
    f.targetY = null;
    decide([f], systems());

    expect(service.getAssignment(1)?.role).toBe('regroup');
    expect([f.targetX, f.targetY]).toEqual([10, 10]);
  });

  it('never touches colonizer carriers or fleets commanded by the pipeline', () => {
    const carrier = fleet(1, 'enemy1', 30, 30, ['colonizer', 'frigate']);
    carrier.targetX = 40;
    carrier.targetY = 10;
    const commanded = fleet(2, 'enemy1', 20, 20, ['destroyer']);
    commanded.targetX = 25;
    commanded.targetY = 25;
    decide([carrier, commanded], systems(), [2]);

    expect(service.getManagedFleetIds().size).toBe(0);
    expect([carrier.targetX, carrier.targetY]).toEqual([40, 10]);
    expect([commanded.targetX, commanded.targetY]).toEqual([25, 25]);
  });

  it('does nothing while paused', () => {
    const f = fleet(1, 'enemy1', 30, 30, ['frigate']);
    expect(service.tick(0, ai, factions, systems(), [f], new Set())).toBe(false);
    expect(f.targetX).toBeNull();
  });
});

/*
 * Opportunistic asteroid salvage: AI fleets compete for drifting asteroids
 * with the same intercept planning and collection rules as the player.
 */
describe('EnemyFleetService salvage role', () => {
  let service: EnemyFleetService;
  let asteroids: DriftingAsteroidService;

  const factions: Faction[] = [
    { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
    { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, aiDifficulty: 'normal', currencies: {} },
  ];
  const ai = factions[1];
  const systems = (): StarSystem[] => [
    {
      id: 'home', name: 'Home', x: 10, y: 10, planets: 1, color: '#fff',
      planetsTiles: [
        {
          id: 1, index: 0, name: 'H', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'medium',
          population: 1000, explored: true, buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }],
        },
      ],
    },
  ];
  const fleet = (id: number, x: number, y: number): Fleet => ({
    id, name: `F${id}`, factionId: 'enemy1', x, y, targetX: null, targetY: null, speed: 8, system: null,
    ships: [{ id, name: 'destroyer', type: 'destroyer' }],
  });
  const rock = (traveled: number) => ({
    id: 7, type: 'ore' as const, startX: 0.5, startY: 25, dirX: 1, dirY: 0, speed: 0.15,
    traveled, length: 120, reward: { rawmaterials: 300 },
  });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(false);
    service = TestBed.inject(EnemyFleetService);
    asteroids = TestBed.inject(DriftingAsteroidService);
  });

  afterEach(() => TestBed.inject(GameSettingsService).setFogOfWarEnabled(true));

  it('sends a free fleet (not the home guard) to intercept a reachable asteroid', () => {
    asteroids.restore({ nextId: 8, spawnTimer: 9999, rngState: 1, active: [rock(5)] }, 1);
    const guard = fleet(1, 10, 10);
    const free = fleet(2, 20, 15);
    service.tick(2, ai, factions, systems(), [guard, free], new Set());

    expect(service.getAssignment(2)?.role).toBe('salvage');
    expect(service.getAssignment(1)?.role).not.toBe('salvage');
    expect(free.targetY).toBeCloseTo(25, 6);
  });

  it('drops the salvage run once the asteroid is gone', () => {
    asteroids.restore({ nextId: 8, spawnTimer: 9999, rngState: 1, active: [rock(5)] }, 1);
    const guard = fleet(1, 10, 10);
    const free = fleet(2, 20, 15);
    service.tick(2, ai, factions, systems(), [guard, free], new Set());
    asteroids.restore({ nextId: 8, spawnTimer: 9999, rngState: 1, active: [] }, 1);
    service.tick(2, ai, factions, systems(), [guard, free], new Set());

    expect(service.getAssignment(2)?.role).not.toBe('salvage');
  });

  it('ignores asteroids it cannot reach in time', () => {
    asteroids.restore({ nextId: 8, spawnTimer: 9999, rngState: 1, active: [rock(118)] }, 1);
    const guard = fleet(1, 10, 10);
    const free = fleet(2, 20, 15);
    service.tick(2, ai, factions, systems(), [guard, free], new Set());
    expect(service.getAssignment(2)?.role).not.toBe('salvage');
  });
});

describe('EnemyFleetService salvage re-aiming', () => {
  it('does not report a state change when the meeting point barely moved', () => {
    TestBed.configureTestingModule({});
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(false);
    const service = TestBed.inject(EnemyFleetService);
    const asteroids = TestBed.inject(DriftingAsteroidService);
    const factions: Faction[] = [
      { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
      { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, aiDifficulty: 'normal', currencies: {} },
    ];
    const systems: StarSystem[] = [
      {
        id: 'home', name: 'Home', x: 10, y: 10, planets: 1, color: '#fff',
        planetsTiles: [{
          id: 1, index: 0, name: 'H', factionId: 'enemy1', x: 12, y: 3, type: 'earthlike', size: 'medium',
          population: 1000, explored: true, buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }],
        }],
      },
    ];
    const mk = (id: number, x: number, y: number): Fleet => ({
      id, name: `F${id}`, factionId: 'enemy1', x, y, targetX: null, targetY: null, speed: 8, system: null,
      ships: [{ id, name: 'destroyer', type: 'destroyer' }],
    });
    const rock = { id: 7, type: 'ore' as const, startX: 0.5, startY: 25, dirX: 1, dirY: 0, speed: 0.15, traveled: 5, length: 120, reward: { rawmaterials: 300 } };
    asteroids.restore({ nextId: 8, spawnTimer: 9999, rngState: 1, active: [rock] }, 1);
    const guard = mk(1, 10, 10);
    const hunter = mk(2, 20, 15);
    expect(service.tick(2, factions[1], factions, systems, [guard, hunter], new Set())).toBe(true);
    expect(service.getAssignment(2)?.role).toBe('salvage');
    const target = { x: hunter.targetX, y: hunter.targetY };

    // Nothing moved: the same meeting point, no new order, no state change.
    expect(service.tick(2, factions[1], factions, systems, [guard, hunter], new Set())).toBe(false);
    expect({ x: hunter.targetX, y: hunter.targetY }).toEqual(target);
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(true);
  });
});

/*
 * Trader raids and the civilization assault gate (docs/trade-network.md#ai).
 */
describe('EnemyFleetService trader raids and civilizations', () => {
  let service: EnemyFleetService;
  let trade: TradeNetworkService;
  let factions: Faction[];
  const POST = { name: 'Trading Post', size: 2, x: 0, y: 0 };

  const system = (id: string, x: number, planet: StarSystem['planetsTiles'][number]): StarSystem =>
    ({ id, name: id, x, y: 10, planets: 1, color: '#fff', planetsTiles: [planet] }) as StarSystem;
  const planet = (id: number, factionId: string, extra: Partial<StarSystem['planetsTiles'][number]> = {}) =>
    ({ id, index: 0, name: `P${id}`, factionId, x: 12, y: 3, type: 'earthlike', size: 'medium', population: 500, explored: true, buildings: [], ...extra }) as StarSystem['planetsTiles'][number];
  // Trade nodes the AI does not assault in these tests: civilization worlds
  // (gated at game second 0) and a heavily defended player world.
  const FORT = [POST, ...Array.from({ length: 8 }, (_, i) => ({ name: 'Laser Turret', size: 1, x: 3 + i, y: 3 })), { name: 'Planetary Shield', size: 2, x: 3, y: 5 }];
  const systems = (traderHomeOwner: string): StarSystem[] => [
    system('home', 10, planet(1, 'enemy1', { population: 1000, buildings: [{ name: 'Spaceport', size: 4, x: 0, y: 0 }] })),
    system('origin', 40, traderHomeOwner === 'independent'
      ? planet(2, 'independent', { buildings: [POST], civilization: 'Veyra Concord' })
      : planet(2, traderHomeOwner, { buildings: FORT })),
    system('far', 70, planet(3, 'independent', { buildings: [POST], civilization: 'Aurel Compact' })),
  ];
  const fleet = (id: number, x: number, types = ['destroyer']): Fleet => ({
    id, name: `F${id}`, factionId: 'enemy1', x, y: 10, targetX: null, targetY: null, speed: 8, system: null,
    ships: types.map((type, i) => ({ id: id * 10 + i, name: type, type })),
  });

  /* One travelling trader of planet 2 at (x, 11); the other slots wait. */
  const withTrader = (sys: StarSystem[], x: number) => {
    const state = createInitialTradeNetworkState(1);
    state.traders.push({
      id: 1, homePlanetId: 2, slot: 0, x, y: 11, status: 'travelling', portPlanetId: 2,
      destinationPlanetId: 3, dockSeconds: 0, cargo: { credits: 800, goods: 'Alloys' }, hull: 300,
    });
    state.nextId = 2;
    state.respawns.push({ homePlanetId: 2, slot: 1, secondsLeft: 1e6 }, { homePlanetId: 3, slot: 0, secondsLeft: 1e6 }, { homePlanetId: 3, slot: 1, secondsLeft: 1e6 });
    trade.restore(state, 1, sys);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    TestBed.inject(GameSettingsService).setFogOfWarEnabled(false);
    service = TestBed.inject(EnemyFleetService);
    trade = TestBed.inject(TradeNetworkService);
    factions = [
      { id: 'player', name: 'Player', color: '#8cc4ff', team: 1, ai: false, currencies: {} },
      { id: 'enemy1', name: 'Enemy 1', color: '#d65757', team: 2, ai: true, aiDifficulty: 'normal', aiPersonality: 'balanced', currencies: {} },
      { id: 'independent', name: 'Independent', color: '#ffcc00', team: 0, ai: false, currencies: {} },
    ] as Faction[];
  });

  afterEach(() => TestBed.inject(GameSettingsService).setFogOfWarEnabled(true));

  it('sends a free warship fleet (not the home guard) to raid a civilian trader nearby', () => {
    const sys = systems('independent');
    withTrader(sys, 25);
    const guard = fleet(1, 10);
    const raider = fleet(2, 18);
    service.tick(2, factions[1], factions, sys, [guard, raider], new Set());
    expect(service.getAssignment(2)?.role).toBe('raid');
    expect(raider.raidTraderId).toBe(1);
    expect([raider.targetX, raider.targetY]).toEqual([25, 11]);
    expect(guard.raidTraderId ?? null).toBeNull();
  });

  it('never raids a peace partner’s trader, but does raid a war enemy’s', () => {
    const sys = systems('player');
    withTrader(sys, 25);
    factions[0].relations = { enemy1: { state: 'peace', lockRemaining: 0 } };
    factions[1].relations = { player: { state: 'peace', lockRemaining: 0 } };
    const raider = fleet(2, 18);
    service.tick(2, factions[1], factions, sys, [fleet(1, 10), raider], new Set());
    expect(service.getAssignment(2)?.role).not.toBe('raid');

    factions[0].relations = { enemy1: { state: 'war', lockRemaining: 0 } };
    factions[1].relations = { player: { state: 'war', lockRemaining: 0 } };
    service.tick(2, factions[1], factions, sys, [fleet(1, 10), raider], new Set());
    expect(service.getAssignment(2)?.role).toBe('raid');
  });

  it('drops the raid and its marker once the trader docks', () => {
    const sys = systems('independent');
    withTrader(sys, 25);
    const raider = fleet(2, 18);
    const fleets = [fleet(1, 10), raider];
    service.tick(2, factions[1], factions, sys, fleets, new Set());
    expect(raider.raidTraderId).toBe(1);
    const trader = trade.getTrader(1)!;
    trader.status = 'docked';
    trader.destinationPlanetId = null;
    service.tick(2, factions[1], factions, sys, fleets, new Set());
    expect(service.getAssignment(2)?.role).not.toBe('raid');
    expect(raider.raidTraderId).toBeNull();
  });

  it('a fleet without warships never raids', () => {
    const sys = systems('independent');
    withTrader(sys, 25);
    const scouts = fleet(2, 18, ['scout']);
    service.tick(2, factions[1], factions, sys, [fleet(1, 10), scouts], new Set());
    expect(service.getAssignment(2)?.role).not.toBe('raid');
  });

  it('leaves an independent civilization alone until its personality gate, then may assault it', () => {
    const civ = planet(5, 'independent', { civilization: 'Veyra Concord' });
    const sys = [systems('independent')[0], system('civ', 30, civ)];
    trade.restore(createInitialTradeNetworkState(1), 1, sys);
    const fleets = () => [fleet(1, 10), fleet(2, 12, ['destroyer', 'destroyer']), fleet(3, 12, ['destroyer'])];

    service.setGameSeconds(0);
    const early = fleets();
    service.tick(2, factions[1], factions, sys, early, new Set());
    expect(early.some((f) => service.getAssignment(f.id)?.role === 'assault')).toBe(false);

    service.reset();
    service.setGameSeconds(AI_PERSONALITY_PROFILES.balanced.civilizationAssaultAfter);
    const late = fleets();
    service.tick(2, factions[1], factions, sys, late, new Set());
    expect(late.some((f) => service.getAssignment(f.id)?.role === 'assault' && service.getAssignment(f.id)?.planetId === 5)).toBe(true);
  });
});

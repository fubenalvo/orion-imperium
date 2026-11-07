import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SaveGameService } from '../../services/save-game.service';
import { SAVE_VERSION, validateSaveData } from '../../services/save-validation';
import { StatefulRng } from './drifting-asteroids';
import { Faction, Fleet, PlanetTile, StarMapData, StarSystem, TradeNetworkState, Trader } from './star-map.models';
import {
  TRADE_NETWORK_CONFIG,
  applyRaidConsequences,
  raidBlocker,
  respawnDelay,
  cargoValueForRoute,
  createInitialTradeNetworkState,
  destinationCandidates,
  payDelivery,
  reconcileTraders,
  sanitizeTradeNetworkState,
  slotKey,
  tradePosts,
} from './trade-network';
import { TRADE_INCOME_WINDOW_SECONDS, TradeNetworkService } from './trade-network.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';

/*
 * Trade network slots and persistence (docs/trade-network.md): two traders
 * per Trading Post, never a duplicate, whatever the order of loads,
 * reconciliations and post changes.
 */

const POST = { name: 'Trading Post', size: 2, x: 0, y: 0 };

let nextPlanetId = 1;
const planet = (factionId: string, posts = 1, extra: Partial<PlanetTile> = {}): PlanetTile => ({
  id: nextPlanetId++,
  index: 0,
  name: `P${nextPlanetId}`,
  factionId,
  x: 1,
  y: 1,
  type: 'earthlike',
  size: 'medium',
  population: 100,
  explored: true,
  buildings: Array.from({ length: posts }, (_, i) => ({ ...POST, x: i * 2 })),
  ...extra,
} as PlanetTile);

const system = (id: string, x: number, y: number, planets: PlanetTile[]): StarSystem => ({
  id,
  name: id,
  x,
  y,
  planets: planets.length,
  color: '#fff',
  planetsTiles: planets,
  explored: true,
} as StarSystem);

const keys = (state: TradeNetworkState): string[] => state.traders.map((t) => slotKey(t.homePlanetId, t.slot)).sort();

function reconcile(state: TradeNetworkState, systems: StarSystem[]) {
  const rng = new StatefulRng(state.rngState);
  const result = reconcileTraders(state, tradePosts(systems), rng);
  state.rngState = rng.state;
  return result;
}

describe('trade network slots', () => {
  let a: PlanetTile;
  let b: PlanetTile;
  let systems: StarSystem[];

  beforeEach(() => {
    a = planet('player');
    b = planet('independent');
    systems = [system('alpha', 10, 20, [a]), system('beta', 40, 30, [b, planet('unhabited', 0)])];
  });

  it('creates two docked traders per Trading Post at its system', () => {
    const state = createInitialTradeNetworkState(5);
    const result = reconcile(state, systems);
    expect(result.spawned).toHaveLength(4);
    expect(keys(state)).toEqual([slotKey(a.id, 0), slotKey(a.id, 1), slotKey(b.id, 0), slotKey(b.id, 1)].sort());
    const atA = state.traders.filter((t) => t.homePlanetId === a.id);
    for (const t of atA) {
      expect(t).toMatchObject({ x: 10, y: 20, status: 'docked', portPlanetId: a.id, cargo: null, hull: TRADE_NETWORK_CONFIG.hull });
      expect(t.dockSeconds).toBeGreaterThanOrEqual(TRADE_NETWORK_CONFIG.firstDockSeconds.min);
      expect(t.dockSeconds).toBeLessThanOrEqual(TRADE_NETWORK_CONFIG.firstDockSeconds.max);
    }
    expect(new Set(state.traders.map((t) => t.id)).size).toBe(4);
  });

  it('is idempotent: reconciling again changes nothing', () => {
    const state = createInitialTradeNetworkState(5);
    reconcile(state, systems);
    const before = structuredClone(state);
    const again = reconcile(state, systems);
    expect(again).toEqual({ spawned: [], removed: [], retired: [] });
    expect(state.traders).toEqual(before.traders);
  });

  it('counts a planet with two posts once and ignores uninhabited planets', () => {
    const double = planet('player', 2);
    expect(tradePosts([system('s', 1, 1, [double])])).toHaveLength(1);
    const state = createInitialTradeNetworkState(1);
    reconcile(state, [system('s', 1, 1, [double, planet('unhabited')])]);
    expect(state.traders).toHaveLength(TRADE_NETWORK_CONFIG.tradersPerPost);
  });

  it('caps the network at maxTraders, filling the lowest planet ids first', () => {
    const planets = Array.from({ length: TRADE_NETWORK_CONFIG.maxTraders }, () => planet('independent'));
    const state = createInitialTradeNetworkState(2);
    reconcile(state, [system('crowded', 5, 5, planets)]);
    expect(state.traders).toHaveLength(TRADE_NETWORK_CONFIG.maxTraders);
    const homes = new Set(state.traders.map((t) => t.homePlanetId));
    expect(Math.max(...homes)).toBe(planets[TRADE_NETWORK_CONFIG.maxTraders / TRADE_NETWORK_CONFIG.tradersPerPost - 1].id);
  });

  it('removes duplicate traders of one slot, keeping the lowest id', () => {
    const state = createInitialTradeNetworkState(5);
    reconcile(state, systems);
    const copy: Trader = { ...state.traders[0], id: 99 };
    state.traders.push(copy);
    state.nextId = 100;
    const result = reconcile(state, systems);
    expect(result.removed.map((t) => t.id)).toEqual([99]);
    expect(result.spawned).toEqual([]);
    expect(state.traders).toHaveLength(4);
  });

  it('retires a travelling trader whose post is gone and re-adopts it when the post returns', () => {
    const state = createInitialTradeNetworkState(5);
    reconcile(state, systems);
    const [travelling, docked] = state.traders.filter((t) => t.homePlanetId === a.id);
    Object.assign(travelling, { status: 'travelling', destinationPlanetId: b.id, cargo: { credits: 500, goods: 'Textiles' } });

    const savedBuildings = a.buildings;
    a.buildings = [];
    const gone = reconcile(state, systems);
    expect(gone.removed.map((t) => t.id)).toEqual([docked.id]);
    expect(gone.retired.map((t) => t.id)).toEqual([travelling.id]);
    expect(state.traders.find((t) => t.id === travelling.id)?.retiring).toBe(true);

    a.buildings = savedBuildings;
    const back = reconcile(state, systems);
    expect(back.spawned).toHaveLength(1);
    expect(back.spawned[0].slot).toBe(docked.slot);
    expect(state.traders.find((t) => t.id === travelling.id)?.retiring).toBeUndefined();
    expect(keys(state)).toHaveLength(4);
  });

  it('a captured post keeps its traders (affiliation is derived from the owner)', () => {
    const state = createInitialTradeNetworkState(5);
    reconcile(state, systems);
    const ids = state.traders.map((t) => t.id);
    b.factionId = 'player';
    expect(reconcile(state, systems)).toEqual({ spawned: [], removed: [], retired: [] });
    expect(state.traders.map((t) => t.id)).toEqual(ids);
  });

  it('does not refill a slot while its respawn is pending', () => {
    const state = createInitialTradeNetworkState(5);
    reconcile(state, systems);
    const lost = state.traders.shift()!;
    state.respawns.push({ homePlanetId: lost.homePlanetId, slot: lost.slot, secondsLeft: 30 });
    expect(reconcile(state, systems).spawned).toEqual([]);
    state.respawns = [];
    expect(reconcile(state, systems).spawned).toHaveLength(1);
  });
});

describe('trade network persistence', () => {
  it('sanitizes saved states: drops malformed traders and keeps ids unique', () => {
    const good: Trader = {
      id: 4, homePlanetId: 1, slot: 0, x: 1, y: 1, status: 'docked', portPlanetId: 1,
      destinationPlanetId: null, dockSeconds: 3, cargo: null, hull: 300,
    };
    const state = sanitizeTradeNetworkState({
      version: 1,
      nextId: 2,
      rngState: 7,
      traders: [good, { ...good }, { ...good, id: 5, status: 'travelling' }, { id: 'x' }],
      respawns: [{ homePlanetId: 1, slot: 1, secondsLeft: -3 }, { slot: 1 }],
    }, 1);
    expect(state.traders.map((t) => t.id)).toEqual([4]);
    expect(state.nextId).toBe(5);
    expect(state.respawns).toEqual([{ homePlanetId: 1, slot: 1, secondsLeft: 0 }]);
    expect(sanitizeTradeNetworkState(null, 1)).toEqual(createInitialTradeNetworkState(1));
  });

  it('a service round trip restores the same traders without creating new ones', () => {
    const systems = [system('alpha', 10, 20, [planet('player')]), system('beta', 40, 30, [planet('independent')])];
    const first = new TradeNetworkService();
    first.restore(undefined, 9, systems);
    const saved = first.serialize();
    expect(saved.traders).toHaveLength(4);

    const second = new TradeNetworkService();
    second.restore(saved, 9, systems);
    second.restore(second.serialize(), 9, systems);
    expect(second.serialize()).toEqual(saved);
  });

  it('respawns a destroyed trader when its timer runs out, and not before', () => {
    const home = planet('player');
    const systems = [system('alpha', 10, 20, [home])];
    const service = new TradeNetworkService();
    const saved = createInitialTradeNetworkState(3);
    saved.respawns.push({ homePlanetId: home.id, slot: 1, secondsLeft: 10 });
    service.restore(saved, 3, systems);
    expect(service.traders.map((t) => t.slot)).toEqual([0]);

    service.tick(9, { starSystems: systems, factions: [] });
    expect(service.traders).toHaveLength(1);
    expect(service.tick(0, { starSystems: systems, factions: [] }).changed).toBe(false);
    expect(service.tick(1, { starSystems: systems, factions: [] }).changed).toBe(true);
    expect(service.traders.map((t) => t.slot).sort()).toEqual([0, 1]);
  });

  it('a new game (no network yet) starts with an empty network', () => {
    const factions = [
      { id: 'player', name: 'P', color: '#00f', team: 1, ai: false, currencies: { credits: 0, rawmaterials: 0, research: 0 } },
      { id: 'independent', name: 'I', color: '#ffcc00', team: 0, ai: false, currencies: {} },
      { id: 'unhabited', name: 'U', color: '#666666', team: 0, ai: false, currencies: {} },
    ] as unknown as Faction[];
    const fresh: StarMapData = {
      saveVersion: SAVE_VERSION,
      galaxy: { size: 'small', seed: 12, generatorVersion: 5 },
      factions,
      map: { width: 180, height: 108, cellSizeVw: 2, cellSizeVh: 2 },
      starSystems: [],
      fleets: [],
    } as unknown as StarMapData;
    const migrated = TestBed.inject(SaveGameService).normalizeSave(fresh);
    expect(migrated.saveVersion).toBe(SAVE_VERSION);
    expect(migrated.tradeNetwork).toEqual(createInitialTradeNetworkState(12));
  });

  it('a malformed network is a warning, not a load error', () => {
    const result = validateSaveData({ saveVersion: SAVE_VERSION, tradeNetwork: { traders: 'nope' } } as unknown as StarMapData);
    expect(result.warnings.some((w) => w.code === 'trade_network_invalid')).toBe(true);
    expect(result.errors.some((e) => e.code === 'trade_network_invalid')).toBe(false);
  });
});

describe('trade trips and deliveries', () => {
  const faction = (id: string, team: number, credits = 0): Faction =>
    ({ id, name: id, color: '#fff', team, ai: id !== 'player', currencies: { credits, rawmaterials: 0, research: 0 } }) as unknown as Faction;

  let factions: Faction[];
  beforeEach(() => {
    factions = [faction('player', 1), faction('enemy1', 2), faction('independent', 0), faction('unhabited', 0)];
  });
  const credits = (id: string) => factions.find((f) => f.id === id)!.currencies['credits'];

  /* Runs the network in 1 s steps; returns every delivery. */
  function run(service: TradeNetworkService, systems: StarSystem[], seconds: number) {
    const deliveries = [];
    for (let i = 0; i < seconds; i++) deliveries.push(...service.tick(1, { starSystems: systems, factions }).deliveries);
    return deliveries;
  }

  /* A network with only one trader in it (every other slot waits for a long respawn). */
  function single(systems: StarSystem[], home: PlanetTile, service = new TradeNetworkService()): { service: TradeNetworkService; trader: Trader } {
    const saved = createInitialTradeNetworkState(4);
    for (const post of tradePosts(systems)) {
      for (let slot = 0; slot < TRADE_NETWORK_CONFIG.tradersPerPost; slot++) {
        if (post.planet.id !== home.id || slot !== 0) saved.respawns.push({ homePlanetId: post.planet.id, slot, secondsLeft: 1e6 });
      }
    }
    service.restore(saved, 4, systems);
    const trader = service.traders[0];
    trader.dockSeconds = 1;
    return { service, trader };
  }

  const blackHoleTerrain = (x: number, y: number): StarMapTerrainService => {
    const terrain = new StarMapTerrainService();
    terrain.configure({
      specialObjects: [{ x, y, width: 4, height: 4, type: 'blackhole', component: 'blackhole' }],
      width: 60,
      height: 30,
    } as Parameters<StarMapTerrainService['configure']>[0]);
    return terrain;
  };

  it('values cargo by route length, rounded to 10 and clamped', () => {
    expect(cargoValueForRoute(0)).toBe(TRADE_NETWORK_CONFIG.minCargoValue);
    expect(cargoValueForRoute(50)).toBe(1250);
    expect(cargoValueForRoute(50.3)).toBe(1260);
    expect(cargoValueForRoute(1000)).toBe(TRADE_NETWORK_CONFIG.maxCargoValue);
  });

  it('never picks the current port and tries the previous port last', () => {
    const [a, b, c, d] = [planet('player'), planet('player'), planet('player'), planet('player')];
    const posts = tradePosts([system('a', 0, 0, [a]), system('b', 10, 0, [b]), system('c', 20, 0, [c]), system('d', 90, 0, [d])]);
    for (let seed = 0; seed < 20; seed++) {
      const order = destinationCandidates({ x: 0, y: 0 }, a.id, b.id, posts, new StatefulRng(seed)).map((n) => n.planet.id);
      expect(order).not.toContain(a.id);
      expect(order.at(-1)).toBe(b.id);
      expect([...order].sort()).toEqual([b.id, c.id, d.id].sort());
    }
    // The previous port is still used when it is the only other node.
    expect(destinationCandidates({ x: 0, y: 0 }, a.id, b.id, posts.slice(0, 2), new StatefulRng(1)).map((n) => n.planet.id)).toEqual([b.id]);
  });

  it('pays the home owner the cargo value and the destination owner a port fee; neutrals get nothing', () => {
    const trader = { id: 1, cargo: { credits: 1000, goods: 'Alloys' }, destinationPlanetId: 2 } as Trader;
    const paid = payDelivery(trader, factions[0], factions[1]);
    expect(paid).toMatchObject({ credits: 1000, homeOwnerId: 'player', destinationOwnerId: 'enemy1', portFee: 200 });
    expect(credits('player')).toBe(1000);
    expect(credits('enemy1')).toBe(200);
    payDelivery(trader, factions[2], factions[2]);
    expect(credits('independent')).toBe(0);
  });

  it('flies to the other node along its route, delivers once and docks there', () => {
    const home = planet('player');
    const away = planet('enemy1');
    const systems = [system('home', 10, 10, [home]), system('away', 40, 10, [away])];
    const { service, trader } = single(systems, home);

    run(service, systems, 2);
    expect(trader).toMatchObject({ status: 'travelling', destinationPlanetId: away.id });
    expect(trader.cargo!.credits).toBe(cargoValueForRoute(30));

    // 30 cells at 0.25 cells/s = 120 s.
    expect(run(service, systems, 110)).toEqual([]);
    const deliveries = run(service, systems, 20);
    expect(deliveries).toHaveLength(1);
    expect(credits('player')).toBe(cargoValueForRoute(30));
    expect(credits('enemy1')).toBe(Math.floor(cargoValueForRoute(30) * TRADE_NETWORK_CONFIG.portFeeShare));
    expect(trader).toMatchObject({ status: 'docked', portPlanetId: away.id, lastPortPlanetId: home.id, cargo: null, x: 40, y: 10 });
  });

  it('routes around a black hole between two nodes', () => {
    const terrain = blackHoleTerrain(24, 9);
    const home = planet('player');
    const away = planet('player');
    const systems = [system('home', 10, 10, [home]), system('away', 40, 10, [away])];
    const { service, trader } = single(systems, home, new TradeNetworkService(new StarMapMovementService(terrain), terrain));
    run(service, systems, 2);
    expect(service.getRoute(trader).length).toBeGreaterThan(1);
    let closest = Infinity;
    for (let i = 0; i < 300 && trader.status === 'travelling'; i++) {
      service.tick(1, { starSystems: systems, factions });
      closest = Math.min(closest, Math.hypot(trader.x - 25.5, trader.y - 10.5));
    }
    expect(trader.status).toBe('docked');
    expect(closest).toBeGreaterThanOrEqual(4);
  });

  it('stays docked and retries later when no other node can be reached', () => {
    const terrain = blackHoleTerrain(39, 9);
    const home = planet('player');
    const systems = [system('home', 10, 10, [home]), system('inside', 40, 10, [planet('player')])];
    const { service, trader } = single(systems, home, new TradeNetworkService(new StarMapMovementService(terrain), terrain));
    run(service, systems, 2);
    expect(trader.status).toBe('docked');
    expect(trader.dockSeconds).toBeGreaterThan(TRADE_NETWORK_CONFIG.retryDockSeconds - 2);
  });

  it('flies on with the same cargo when its destination loses the post mid-trip', () => {
    const home = planet('player');
    const away = planet('enemy1');
    const third = planet('enemy1');
    const systems = [system('home', 10, 10, [home]), system('away', 30, 10, [away]), system('third', 30, 25, [third])];
    const { service, trader } = single(systems, home);
    run(service, systems, 2);
    const target = trader.destinationPlanetId!;
    const cargo = trader.cargo!.credits;
    const lost = target === away.id ? away : third;
    lost.buildings = [];
    const deliveries = run(service, systems, 300);
    expect(deliveries[0]).toMatchObject({ credits: cargo, homeOwnerId: 'player' });
    expect(trader.portPlanetId).not.toBe(lost.id);
  });

  it('a retiring trader delivers its cargo and is then removed', () => {
    const home = planet('player');
    const away = planet('enemy1');
    const systems = [system('home', 10, 10, [home]), system('away', 20, 10, [away])];
    const { service, trader } = single(systems, home);
    run(service, systems, 2);
    home.buildings = []; // the home post is gone: the trader retires
    const deliveries = run(service, systems, 60);
    expect(deliveries).toHaveLength(1);
    expect(credits('player')).toBe(deliveries[0].credits);
    expect(service.getTrader(trader.id)).toBeUndefined();
  });

  it('continues a saved trip after a load and delivers exactly once', () => {
    const home = planet('player');
    const away = planet('enemy1');
    const systems = [system('home', 10, 10, [home]), system('away', 40, 10, [away])];
    const { service } = single(systems, home);
    run(service, systems, 60);
    const saved = service.serialize();
    const moving = saved.traders.find((t) => t.status === 'travelling')!;
    expect(moving.x).toBeGreaterThan(10);

    const loaded = new TradeNetworkService();
    loaded.restore(saved, 4, systems);
    // ~15.5 cells left = 62 s; it docks for 20 s after arriving.
    const deliveries = run(loaded, systems, 70);
    expect(deliveries).toHaveLength(1);
    expect(loaded.getTrader(moving.id)).toMatchObject({ status: 'docked', portPlanetId: away.id });
  });

  it('reports post stats and the recent trade income for the trade UI', () => {
    const home = planet('player');
    const away = planet('enemy1');
    const systems = [system('home', 10, 10, [home]), system('away', 20, 10, [away])];
    const { service } = single(systems, home);
    run(service, systems, 2);
    expect(service.postStats(home.id)).toMatchObject({ nodes: 2, traders: 1, travelling: 1, docked: 0, respawning: 1 });
    expect(service.postStats(away.id)).toMatchObject({ inbound: 1, respawning: 2 });

    const deliveries = run(service, systems, 45);
    expect(deliveries).toHaveLength(1);
    expect(service.recentIncome('player')).toBe(deliveries[0].credits);
    expect(service.recentIncome('enemy1')).toBe(deliveries[0].portFee);
    // The figure covers a rolling window of game time: with the network shut
    // down, older deliveries drop out of it.
    home.buildings = [];
    away.buildings = [];
    run(service, systems, 60);
    expect(service.recentIncome('player')).toBeGreaterThan(0);
    run(service, systems, TRADE_INCOME_WINDOW_SECONDS);
    expect(service.recentIncome('player')).toBe(0);
    // A load starts the window empty.
    service.restore(service.serialize(), 4, systems);
    expect(service.recentIncome('player')).toBe(0);
  });
});

describe('trader raids', () => {
  const faction = (id: string, team: number, extra: Partial<Faction> = {}): Faction =>
    ({ id, name: id, color: '#fff', team, ai: id !== 'player', currencies: { credits: 0, rawmaterials: 0, research: 0 }, ...extra }) as unknown as Faction;
  const atPeace = (a: Faction, b: Faction) => {
    a.relations = { ...(a.relations ?? {}), [b.id]: { state: 'peace', lockRemaining: 0, opinion: 0 } };
    b.relations = { ...(b.relations ?? {}), [a.id]: { state: 'peace', lockRemaining: 0, opinion: 0 } };
  };

  const fleet = (id: number, factionId: string, x: number, y: number, ships: string[], raidTraderId: number | null): Fleet =>
    ({
      id, name: `F${id}`, factionId, x, y, targetX: null, targetY: null, speed: 8, system: null,
      ships: ships.map((type, i) => ({ id: id * 100 + i, name: type, type })), raidTraderId,
    }) as unknown as Fleet;

  let player: Faction;
  let enemy: Faction;
  let civ: Faction;
  let factions: Faction[];
  let systems: StarSystem[];
  let home: PlanetTile;
  let service: TradeNetworkService;
  let trader: Trader;

  /* One travelling trader from `home` (owned by `ownerId`) toward a far node. */
  function setup(ownerId: string) {
    player = faction('player', 1);
    enemy = faction('enemy1', 2);
    civ = faction('independent', 0);
    factions = [player, enemy, civ, faction('unhabited', 0)];
    home = planet(ownerId);
    systems = [system('home', 10, 10, [home]), system('far', 80, 10, [planet('independent')])];
    service = new TradeNetworkService();
    const saved = createInitialTradeNetworkState(3);
    for (const post of tradePosts(systems)) {
      for (let slot = 0; slot < TRADE_NETWORK_CONFIG.tradersPerPost; slot++) {
        if (post.planet.id !== home.id || slot !== 0) saved.respawns.push({ homePlanetId: post.planet.id, slot, secondsLeft: 1e6 });
      }
    }
    service.restore(saved, 3, systems);
    trader = service.traders[0];
    trader.dockSeconds = 1;
    service.tick(2, { starSystems: systems, factions });
    expect(trader.status).toBe('travelling');
  }
  /*
   * Runs 1 s steps. Raiders whose order points at a living trader keep pace
   * with it (in play, fleet-raid-orders.ts makes them chase), except those
   * listed in `stationary`.
   */
  const tick = (seconds: number, fleets: Fleet[], stationary: Fleet[] = []) => {
    const raids = [];
    for (let i = 0; i < seconds; i++) {
      for (const f of fleets) {
        const quarry = f.raidTraderId == null || stationary.includes(f) ? undefined : service.getTrader(f.raidTraderId);
        if (quarry && Math.hypot(f.x - quarry.x, f.y - quarry.y) <= TRADE_NETWORK_CONFIG.raidRadius) {
          f.x = quarry.x;
          f.y = quarry.y;
        }
      }
      raids.push(...service.tick(1, { starSystems: systems, factions, fleets }).raids);
    }
    return raids;
  };

  it('never lets an empire raid its own or an allied trader; neutrals never raid', () => {
    const p = faction('player', 1);
    const ally = faction('enemy1', 1);
    const other = faction('enemy2', 3);
    expect(raidBlocker(p, p)).toBe('own_trader');
    expect(raidBlocker(p, ally)).toBe('allied_trader');
    expect(raidBlocker(faction('independent', 0), p)).toBe('neutral_raider');
    expect(raidBlocker(p, other)).toBeNull();
    expect(raidBlocker(p, faction('independent', 0))).toBeNull();
    expect(raidBlocker(p, undefined)).toBeNull();
  });

  it('doubles the respawn delay per recent loss, capped', () => {
    expect([1, 2, 3, 4].map(respawnDelay)).toEqual([120, 240, 480, 600]);
  });

  it('raiding a peace partner costs its opinion and the raider reputation; war costs nothing', () => {
    const p = faction('player', 1);
    const partner = faction('enemy1', 2);
    atPeace(p, partner);
    expect(applyRaidConsequences(p, partner, 1000)).toEqual({ opinion: 10, reputation: 2 });
    expect(partner.relations!['player'].opinion).toBe(-10);
    expect(p.reputation).toBe(-2);
    expect(applyRaidConsequences(p, partner, 1e6).opinion).toBe(TRADE_NETWORK_CONFIG.peaceOpinionMax);

    const foe = faction('enemy2', 3);
    expect(applyRaidConsequences(p, foe, 1000)).toEqual({ opinion: 0, reputation: 0 });
    expect(applyRaidConsequences(p, faction('independent', 0), 1000)).toEqual({ opinion: 0, reputation: 1 });
  });

  it('a raiding fleet in range wears the hull down, takes 75% of the cargo and the slot respawns later', () => {
    setup('independent');
    const cargo = trader.cargo!.credits;
    // Two frigates: 2 × 28 attack per second against 300 hull → 6 s.
    const raider = fleet(1, 'player', trader.x, trader.y, ['frigate', 'frigate'], trader.id);
    const raids = tick(6, [raider]);
    expect(raids).toHaveLength(1);
    expect(raids[0]).toMatchObject({ raiderFactionId: 'player', ownerId: null, loot: Math.floor(cargo * 0.75), reputation: 1, respawnSeconds: 120 });
    expect(player.currencies['credits']).toBe(Math.floor(cargo * 0.75));
    expect(service.getTrader(trader.id)).toBeUndefined();
    expect(service.serialize().respawns).toContainEqual({ homePlanetId: home.id, slot: 0, secondsLeft: expect.any(Number) });
    expect(service.postStats(home.id).respawning).toBe(2);
  });

  it('a second loss at the same node waits twice as long; the count is forgotten later', () => {
    setup('independent');
    tick(6, [fleet(1, 'player', trader.x, trader.y, ['frigate', 'frigate'], trader.id)]);
    tick(121, []);
    const second = service.traders.find((t) => t.homePlanetId === home.id)!;
    second.dockSeconds = 0;
    tick(1, []);
    const raids = tick(6, [fleet(1, 'player', second.x, second.y, ['frigate', 'frigate'], second.id)]);
    expect(raids[0].respawnSeconds).toBe(240);
    tick(TRADE_NETWORK_CONFIG.lossMemorySeconds, []);
    expect(service.serialize().losses).toEqual([]);
  });

  it('only a fleet with a raid order on that trader, in range, with warships, damages it', () => {
    setup('enemy1');
    const near = { x: trader.x, y: trader.y };
    tick(3, [
      fleet(1, 'player', near.x, near.y, ['frigate'], null), // no order
      fleet(2, 'player', near.x + 5, near.y, ['frigate'], trader.id), // out of range
      fleet(3, 'player', near.x, near.y, ['scout', 'colonizer'], trader.id), // no warship
      fleet(4, 'enemy1', near.x, near.y, ['frigate'], trader.id), // its own trader
    ]);
    expect(trader.hull).toBe(TRADE_NETWORK_CONFIG.hull);
  });

  it('docked traders are safe, and a damaged trader is repaired in port', () => {
    setup('enemy1');
    tick(2, [fleet(1, 'player', trader.x, trader.y, ['frigate'], trader.id)]);
    expect(trader.hull).toBeLessThan(TRADE_NETWORK_CONFIG.hull);
    // Let it fly on unmolested to the far node (70 cells at 0.25/s).
    tick(290, []);
    expect(trader.status).toBe('docked');
    expect(trader.hull).toBe(TRADE_NETWORK_CONFIG.hull);
    tick(3, [fleet(1, 'player', trader.x, trader.y, ['frigate'], trader.id)]);
    expect(trader.hull).toBe(TRADE_NETWORK_CONFIG.hull);
  });

  it('raiding a peace partner reports the opinion and reputation cost', () => {
    setup('enemy1');
    atPeace(player, enemy);
    const cargo = trader.cargo!.credits;
    const raids = tick(6, [fleet(1, 'player', trader.x, trader.y, ['frigate', 'frigate'], trader.id)]);
    expect(raids[0]).toMatchObject({ ownerId: 'enemy1', opinion: Math.min(20, Math.round(5 + cargo / 200)), reputation: 2 });
    expect(enemy.relations!['player'].opinion).toBeLessThan(0);
    expect(enemy.relations!['player'].state).toBe('peace');
  });

  it('losses survive a save round trip', () => {
    setup('independent');
    tick(6, [fleet(1, 'player', trader.x, trader.y, ['frigate', 'frigate'], trader.id)]);
    const saved = service.serialize();
    const loaded = new TradeNetworkService();
    loaded.restore(saved, 3, systems);
    expect(loaded.serialize().losses).toEqual(saved.losses);
    expect(sanitizeTradeNetworkState({ ...saved, losses: [{ homePlanetId: 'x' }] }, 3).losses).toEqual([]);
  });
});

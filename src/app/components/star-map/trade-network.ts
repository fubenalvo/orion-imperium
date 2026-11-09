import { isWellFormedTransit } from './wormholes';
import { StatefulRng } from './drifting-asteroids';
import { Faction, PlanetTile, StarSystem, TradeNetworkState, Trader, TraderLossRecord, TraderRespawn } from './star-map.models';
import { adjustOpinion, adjustReputation, areFactionsAllied, getRelationKind, isNeutralFaction } from './diplomacy';
import { hasTradingPost } from './trade';

/*
 * Civilian trade network — pure rules (docs/trade-network.md).
 *
 * Every planet with a Trading Post is a node of the network and owns
 * TRADE_NETWORK_CONFIG.tradersPerPost trader slots. A slot is the pair
 * (homePlanetId, slot); at most one living trader exists per slot. The set of
 * slots is derived from the planets' buildings every time
 * (`desiredTraderSlots`), never stored, and `reconcileTraders` brings the
 * saved traders in line with it. Reconciliation is idempotent: running it
 * any number of times, after a load or on every tick, never creates a
 * duplicate. That is the only place traders are created.
 *
 * Who a trader works for is the home planet's current owner (derived), so a
 * captured or rebelling post needs no bookkeeping here.
 */

export const TRADE_NETWORK_CONFIG = {
  /* Format version of TradeNetworkState (inside save version 11+). */
  version: 1,
  tradersPerPost: 2,
  /* Global cap; slots beyond it are not filled (lowest planet ids first). */
  maxTraders: 60,
  hull: 300,
  /* Docking time of a newly created trader: spreads first departures out. */
  firstDockSeconds: { min: 5, max: 30 },
  /* Game seconds between reconciliations while the game runs. */
  reconcileInterval: 1,
  /* Open-space speed in galaxy cells per game second (warships: 0.3–0.5). */
  speed: 0.25,
  /* Time at a port between two trips. */
  dockSeconds: 20,
  /* Wait before trying again when no other node can be reached. */
  retryDockSeconds: 30,
  /* Cargo value: credits per cell of the planned route, rounded to 10, clamped. */
  valuePerCell: 25,
  minCargoValue: 200,
  maxCargoValue: 2000,
  /* Share of the cargo value paid to the destination's owner on top (port fee). */
  portFeeShare: 0.2,
  /* Destination choice weighs nodes by 1 / max(distance, this), so a node in the same system is not a certainty. */
  minWeightDistance: 5,
  /* Raids (docs/trade-network.md#raids). A raiding fleet must be within this many galaxy cells. */
  raidRadius: 1,
  /* Hull damage per second = this × the summed attack of the fleet's living warships. */
  raidDamagePerAttack: 1,
  /* Share of the cargo the raiding faction takes; the rest is lost. */
  lootShare: 0.75,
  /* Respawn delay after a loss: base × 2^(recent losses − 1), capped. */
  respawnBaseSeconds: 120,
  respawnMaxSeconds: 600,
  /* A node's loss count is forgotten after this long without a loss. */
  lossMemorySeconds: 600,
  /* Raiding a trader of an empire at peace: its opinion of the raider drops by base + value / per, capped. */
  peaceOpinionBase: 5,
  peaceOpinionPerCredits: 200,
  peaceOpinionMax: 20,
  /* Reputation lost for raiding a peace partner's / a civilian trader. */
  peaceReputation: 2,
  civilianReputation: 1,
} as const;

/*
 * Credits per second the AI expects one Trading Post to earn through its two
 * traders (EnemyEconomyService weighs it against the post's upkeep). Kept
 * below the ~11/s of an average node (docs/trade-network.md#cargo-and-payout)
 * because raids, short routes and a small network earn less.
 */
export const TRADING_POST_EXPECTED_INCOME = 8;

/* Derived from (not equal to) the galaxy seed, like the other event streams. */
const TRADE_RNG_SALT = 0x2f6b9e3d;

export function createInitialTradeNetworkState(seed: number): TradeNetworkState {
  return {
    version: TRADE_NETWORK_CONFIG.version,
    nextId: 1,
    rngState: (seed ^ TRADE_RNG_SALT) | 0,
    traders: [],
    respawns: [],
    losses: [],
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is number => Number.isInteger(v);

export function isWellFormedTrader(value: unknown): value is Trader {
  const t = value as Record<string, unknown> | null;
  if (!t || typeof t !== 'object') return false;
  if (![t['id'], t['homePlanetId'], t['slot'], t['portPlanetId']].every(isId)) return false;
  if (![t['x'], t['y'], t['dockSeconds'], t['hull']].every(isFiniteNumber)) return false;
  if (t['status'] !== 'docked' && t['status'] !== 'travelling') return false;
  if (t['destinationPlanetId'] !== null && !isId(t['destinationPlanetId'])) return false;
  if (t['lastPortPlanetId'] !== undefined && t['lastPortPlanetId'] !== null && !isId(t['lastPortPlanetId'])) return false;
  if (t['status'] === 'travelling' && t['destinationPlanetId'] === null) return false;
  if (t['transit'] !== undefined && !isWellFormedTransit(t['transit'])) return false;
  const cargo = t['cargo'] as Record<string, unknown> | null;
  if (cargo !== null && (typeof cargo !== 'object' || !isFiniteNumber(cargo['credits']) || typeof cargo['goods'] !== 'string')) {
    return false;
  }
  return true;
}

function isWellFormedRespawn(value: unknown): value is TraderRespawn {
  const r = value as Record<string, unknown> | null;
  return !!r && typeof r === 'object' && isId(r['homePlanetId']) && isId(r['slot']) && isFiniteNumber(r['secondsLeft']);
}

/*
 * A clean copy of a saved state; a missing or malformed state becomes a fresh
 * one (reconciliation then recreates the traders of every post). Malformed
 * traders and respawns are dropped; ids stay unique and below nextId.
 */
export function sanitizeTradeNetworkState(saved: unknown, seed: number): TradeNetworkState {
  const fresh = createInitialTradeNetworkState(seed);
  const s = saved as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s['traders'])) return fresh;
  const seen = new Set<number>();
  const traders: Trader[] = [];
  for (const raw of s['traders'] as unknown[]) {
    if (!isWellFormedTrader(raw) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    traders.push(structuredClone(raw));
  }
  const respawns = Array.isArray(s['respawns'])
    ? (s['respawns'] as unknown[]).filter(isWellFormedRespawn).map((r) => ({ ...r, secondsLeft: Math.max(0, r.secondsLeft) }))
    : [];
  const losses = Array.isArray(s['losses'])
    ? (s['losses'] as unknown[]).filter(isWellFormedLoss).map((l) => ({ ...l, count: Math.max(1, Math.floor(l.count)) }))
    : [];
  const maxId = traders.reduce((max, t) => Math.max(max, t.id), 0);
  return {
    version: TRADE_NETWORK_CONFIG.version,
    nextId: isId(s['nextId']) && (s['nextId'] as number) > maxId ? (s['nextId'] as number) : maxId + 1,
    rngState: isFiniteNumber(s['rngState']) ? (s['rngState'] as number) | 0 : fresh.rngState,
    traders,
    respawns,
    losses,
  };
}

function isWellFormedLoss(value: unknown): value is TraderLossRecord {
  const l = value as Record<string, unknown> | null;
  return !!l && typeof l === 'object' && isId(l['homePlanetId']) && isFiniteNumber(l['count']) && isFiniteNumber(l['quietSeconds']);
}

export interface TradePost {
  planet: PlanetTile;
  system: StarSystem;
}

/* Planets that are network nodes (one per planet, however many posts it holds), by planet id. */
export function tradePosts(starSystems: readonly StarSystem[]): TradePost[] {
  const posts: TradePost[] = [];
  for (const system of starSystems) {
    for (const planet of system.planetsTiles ?? []) {
      if (planet.factionId !== 'unhabited' && hasTradingPost(planet)) posts.push({ planet, system });
    }
  }
  return posts.sort((a, b) => a.planet.id - b.planet.id);
}

export const slotKey = (homePlanetId: number, slot: number): string => `${homePlanetId}:${slot}`;

/* Slots that should hold a trader, in fill order, capped at maxTraders. */
export function desiredTraderSlots(posts: readonly TradePost[]): { post: TradePost; slot: number }[] {
  const slots: { post: TradePost; slot: number }[] = [];
  for (const post of posts) {
    for (let slot = 0; slot < TRADE_NETWORK_CONFIG.tradersPerPost; slot++) {
      if (slots.length >= TRADE_NETWORK_CONFIG.maxTraders) return slots;
      slots.push({ post, slot });
    }
  }
  return slots;
}

export interface ReconcileResult {
  spawned: Trader[];
  removed: Trader[];
  retired: Trader[];
}

/*
 * Brings `state` in line with the network's slots (mutates it):
 * - duplicates of a slot: the lowest id stays, the others are removed;
 * - a trader whose slot is gone: removed while docked, otherwise it finishes
 *   its trip as `retiring` (its cargo still arrives); if the slot comes back
 *   it takes it again instead of a new trader being built;
 * - respawn entries of vanished or occupied slots are dropped;
 * - an empty slot without a pending respawn gets a new trader, docked at its
 *   home post with a randomized first departure.
 */
export function reconcileTraders(state: TradeNetworkState, posts: readonly TradePost[], rng: StatefulRng): ReconcileResult {
  const result: ReconcileResult = { spawned: [], removed: [], retired: [] };
  const desired = desiredTraderSlots(posts);
  const desiredKeys = new Set(desired.map((d) => slotKey(d.post.planet.id, d.slot)));

  const occupied = new Set<string>();
  const kept: Trader[] = [];
  for (const trader of [...state.traders].sort((a, b) => a.id - b.id)) {
    const key = slotKey(trader.homePlanetId, trader.slot);
    if (desiredKeys.has(key)) {
      if (occupied.has(key)) {
        result.removed.push(trader);
        continue;
      }
      occupied.add(key);
      if (trader.retiring) delete trader.retiring;
      kept.push(trader);
    } else if (trader.status === 'travelling') {
      if (!trader.retiring) {
        trader.retiring = true;
        result.retired.push(trader);
      }
      kept.push(trader);
    } else {
      result.removed.push(trader);
    }
  }
  // Keep the saved order of the survivors (stable rendering).
  const keptIds = new Set(kept.map((t) => t.id));
  state.traders = state.traders.filter((t) => keptIds.has(t.id));

  state.respawns = state.respawns.filter((r) => {
    const key = slotKey(r.homePlanetId, r.slot);
    return desiredKeys.has(key) && !occupied.has(key);
  });
  const waiting = new Set(state.respawns.map((r) => slotKey(r.homePlanetId, r.slot)));

  for (const { post, slot } of desired) {
    const key = slotKey(post.planet.id, slot);
    if (occupied.has(key) || waiting.has(key)) continue;
    const { min, max } = TRADE_NETWORK_CONFIG.firstDockSeconds;
    const trader: Trader = {
      id: state.nextId++,
      homePlanetId: post.planet.id,
      slot,
      x: post.system.x,
      y: post.system.y,
      status: 'docked',
      portPlanetId: post.planet.id,
      destinationPlanetId: null,
      dockSeconds: Math.round(min + rng.next() * (max - min)),
      cargo: null,
      hull: TRADE_NETWORK_CONFIG.hull,
    };
    state.traders.push(trader);
    occupied.add(key);
    result.spawned.push(trader);
  }
  return result;
}

/* ---------- Trips and cargo ---------- */

/* Credits a trader loads for a route of `routeCells` galaxy cells. */
export function cargoValueForRoute(routeCells: number): number {
  const { valuePerCell, minCargoValue, maxCargoValue } = TRADE_NETWORK_CONFIG;
  const value = Math.round((routeCells * valuePerCell) / 10) * 10;
  return Math.min(maxCargoValue, Math.max(minCargoValue, value));
}

/* Cosmetic goods label by the origin planet's type; the value is what counts. */
const GOODS_BY_PLANET_TYPE: Record<string, readonly string[]> = {
  earthlike: ['Consumer goods', 'Foodstuffs', 'Medicines'],
  marslike: ['Machine parts', 'Alloys'],
  desert: ['Solar cells', 'Glassware'],
  venuslike: ['Chemicals', 'Fuel cells'],
  ice: ['Water ice', 'Cryo samples'],
  gasgiant: ['Helium-3', 'Starship fuel'],
};

export function pickGoods(planetType: string | undefined, rng: StatefulRng): string {
  const list = GOODS_BY_PLANET_TYPE[planetType ?? ''] ?? ['Trade goods'];
  return list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))];
}

/*
 * Candidate destinations from `from` in the order they should be tried:
 * every other node, drawn without replacement with weight
 * 1 / max(distance, minWeightDistance), so near nodes are preferred but far
 * ones still get trade. The previous port goes last unless it is the only
 * choice, which avoids ping-pong between two nodes when others exist.
 */
export function destinationCandidates(
  from: { x: number; y: number },
  portPlanetId: number | null,
  lastPortPlanetId: number | null | undefined,
  nodes: readonly TradePost[],
  rng: StatefulRng,
): TradePost[] {
  const others = nodes.filter((n) => n.planet.id !== portPlanetId);
  const preferred = others.filter((n) => n.planet.id !== lastPortPlanetId);
  const fallback = others.filter((n) => n.planet.id === lastPortPlanetId);
  const ordered: TradePost[] = [];
  const pool = [...preferred];
  while (pool.length > 0) {
    const weights = pool.map((n) => 1 / Math.max(Math.hypot(n.system.x - from.x, n.system.y - from.y), TRADE_NETWORK_CONFIG.minWeightDistance));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = rng.next() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        index = i;
        break;
      }
    }
    ordered.push(pool.splice(index, 1)[0]);
  }
  return [...ordered, ...fallback];
}

export interface TradeDelivery {
  traderId: number;
  credits: number;
  goods: string;
  /* Faction paid the cargo value (the home post's owner), null if neutral or gone. */
  homeOwnerId: string | null;
  /* Faction paid the port fee (the destination's owner), null if neutral. */
  destinationOwnerId: string | null;
  portFee: number;
}

/*
 * Pays a delivery (mutates faction stocks): the home post's owner receives
 * the cargo value, the destination's owner a port fee on top. Neutral owners
 * (independent civilizations, rebels) receive nothing — their share simply
 * does not exist. Amounts are whole credits. Trade income is a windfall
 * outside the economy tick, like collected asteroids: no difficulty or war
 * exhaustion multiplier applies.
 */
export function payDelivery(
  trader: Trader,
  homeOwner: Faction | undefined,
  destinationOwner: Faction | undefined,
): TradeDelivery | null {
  if (!trader.cargo || trader.destinationPlanetId === null) return null;
  const credits = Math.max(0, Math.floor(trader.cargo.credits));
  const portFee = Math.floor(credits * TRADE_NETWORK_CONFIG.portFeeShare);
  const paysHome = !!homeOwner && !isNeutralFaction(homeOwner);
  const paysPort = !!destinationOwner && !isNeutralFaction(destinationOwner);
  if (paysHome) homeOwner.currencies['credits'] = (homeOwner.currencies['credits'] ?? 0) + credits;
  if (paysPort) destinationOwner.currencies['credits'] = (destinationOwner.currencies['credits'] ?? 0) + portFee;
  return {
    traderId: trader.id,
    credits,
    goods: trader.cargo.goods,
    homeOwnerId: paysHome ? homeOwner.id : null,
    destinationOwnerId: paysPort ? destinationOwner.id : null,
    portFee: paysPort ? portFee : 0,
  };
}

/* ---------- Raids ---------- */

export type RaidBlocker = 'neutral_raider' | 'own_trader' | 'allied_trader';

/*
 * May the raider raid a trader whose home post the owner holds? Never its own
 * or a permanent ally's (same non-neutral team); neutral factions never raid.
 * Civilian traders (neutral or missing owner) and every other empire's traders
 * may be raided — at peace too, which has diplomatic consequences
 * (applyRaidConsequences) but never starts a war by itself.
 */
export function raidBlocker(raider: Faction | undefined, owner: Faction | undefined): RaidBlocker | null {
  if (!raider || isNeutralFaction(raider)) return 'neutral_raider';
  if (owner?.id === raider.id) return 'own_trader';
  if (owner && areFactionsAllied(raider, owner)) return 'allied_trader';
  return null;
}

/* Respawn delay of a node's slot after its n-th recent loss. */
export function respawnDelay(losses: number): number {
  const { respawnBaseSeconds, respawnMaxSeconds } = TRADE_NETWORK_CONFIG;
  return Math.min(respawnMaxSeconds, respawnBaseSeconds * 2 ** Math.max(0, losses - 1));
}

export interface RaidConsequences {
  /* Opinion the owner lost of the raider (≥ 0; 0 when none). */
  opinion: number;
  /* Reputation the raider lost (≥ 0). */
  reputation: number;
}

/*
 * Applies the diplomatic cost of a destroyed trader (mutates the factions):
 * - an empire at peace with the raider: its opinion of the raider drops by
 *   peaceOpinionBase + cargo / peaceOpinionPerCredits (capped), and the raider
 *   loses peaceReputation;
 * - a civilian trader: the raider loses civilianReputation (every empire
 *   sees the piracy);
 * - an enemy at war: nothing — raiding is part of the war.
 */
export function applyRaidConsequences(raider: Faction, owner: Faction | undefined, cargoCredits: number): RaidConsequences {
  const cfg = TRADE_NETWORK_CONFIG;
  if (!owner || isNeutralFaction(owner)) {
    adjustReputation(raider, -cfg.civilianReputation);
    return { opinion: 0, reputation: cfg.civilianReputation };
  }
  if (getRelationKind(raider, owner) !== 'peace') return { opinion: 0, reputation: 0 };
  const opinion = Math.min(cfg.peaceOpinionMax, Math.round(cfg.peaceOpinionBase + cargoCredits / cfg.peaceOpinionPerCredits));
  adjustOpinion(owner, raider, -opinion);
  adjustReputation(raider, -cfg.peaceReputation);
  return { opinion, reputation: cfg.peaceReputation };
}

import { Injectable } from '@angular/core';
import { StatefulRng } from './drifting-asteroids';
import { NavPoint, routeLength } from './fleet-navigation';
import { Faction, Fleet, StarSystem, TradeNetworkState, Trader } from './star-map.models';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapTerrainService } from './star-map-terrain.service';
import { ShipService } from '../../services/ship.service';
import { isCombatShipType } from './ai-queries';
import { isNeutralFaction } from './diplomacy';
import {
  ReconcileResult,
  TRADE_NETWORK_CONFIG,
  TradeDelivery,
  TradePost,
  applyRaidConsequences,
  cargoValueForRoute,
  createInitialTradeNetworkState,
  destinationCandidates,
  payDelivery,
  pickGoods,
  raidBlocker,
  reconcileTraders,
  respawnDelay,
  sanitizeTradeNetworkState,
  tradePosts,
} from './trade-network';

export interface TradeNetworkContext {
  starSystems: readonly StarSystem[];
  factions: readonly Faction[];
  /* Fleets that may carry raid orders; without them no raid is processed. */
  fleets?: readonly Fleet[];
}

/* A trader destroyed by a raid this tick. */
export interface TraderRaid {
  traderId: number;
  homePlanetId: number;
  raiderFleetId: number;
  raiderFactionId: string;
  /* The trader's affiliation (home post owner), null for civilians. */
  ownerId: string | null;
  goods: string;
  cargoCredits: number;
  loot: number;
  opinion: number;
  reputation: number;
  respawnSeconds: number;
}

/* One node's traders (planet DETAILS tab) plus the network size. */
export interface TradePostStats {
  nodes: number;
  traders: number;
  /* This node's own traders. */
  docked: number;
  travelling: number;
  respawning: number;
  /* Traders of any node currently heading here. */
  inbound: number;
}

/* Window of the trade income figure (game seconds). */
export const TRADE_INCOME_WINDOW_SECONDS = 300;

export interface TradeNetworkTickResult {
  /* True when traders moved, docked, departed, appeared or disappeared. */
  changed: boolean;
  deliveries: TradeDelivery[];
  /* Traders lost because no route to any node existed (no payout). */
  stranded: number[];
  raids: TraderRaid[];
}

/*
 * =========================================================
 * TRADE NETWORK SERVICE
 * =========================================================
 *
 * Owns the live civilian trade network of the session (pure rules in
 * trade-network.ts, design in docs/trade-network.md). StarMap restores it on
 * every load (`restore`) and writes `serialize()` into every save, so traders,
 * their cargo and pending respawns survive save/load and battle returns.
 *
 * Traders are not `Fleet`s: they live only here, so economy upkeep, the AI,
 * battle detection and the fleet UI never see them.
 *
 * `tick` runs from StarMap's game loop with the scaled game delta (0 while
 * paused → nothing changes). Per tick:
 *   1. respawn timers count down;
 *   2. docked traders wait out `dockSeconds`, then depart: they load cargo
 *      worth their planned route and fly to another reachable node;
 *   3. travelling traders follow their route (black holes and belts avoided,
 *      nebulae slow them); on arrival they deliver (payDelivery) and dock;
 *   4. raids: every fleet with a raid order on a travelling trader within
 *      raidRadius damages its hull (its warships' summed attack per second);
 *      at 0 the trader is destroyed, the raider's faction takes the loot,
 *      the diplomatic cost is applied and the slot waits for an escalating
 *      respawn;
 *   5. every reconcileInterval the traders are reconciled with the current
 *      Trading Posts, which also refreshes the cached node list.
 *
 * Routes are a runtime cache (re-planned from the current position after a
 * load), like fleet routes. Pathfinding runs only when a trader departs or
 * has no cached route, never per frame.
 */
@Injectable({ providedIn: 'root' })
export class TradeNetworkService {
  private state: TradeNetworkState = createInitialTradeNetworkState(0);
  private reconcileClock = 0;
  private nodes: TradePost[] = [];
  // Remaining waypoints per travelling trader (transient, not saved).
  private readonly routes = new Map<number, NavPoint[]>();
  // Recent payouts for the income figure (transient: a load starts it empty).
  private clock = 0;
  private ledger: { at: number; factionId: string; credits: number }[] = [];

  // Defaults keep `new TradeNetworkService()` (unit tests) working with empty
  // terrain; Angular DI always passes the shared instances.
  constructor(
    private readonly movement: StarMapMovementService = new StarMapMovementService(),
    private readonly terrain: StarMapTerrainService = new StarMapTerrainService(),
    private readonly ships: ShipService = new ShipService(),
  ) {}

  /*
   * Hull damage per second a fleet deals to a trader: its living warships'
   * summed base attack × raidDamagePerAttack. Technology bonuses are not
   * applied (an unarmed trader is not a battle). Recon, colonizer and outpost
   * ships do not count, so only a fleet with a warship can raid.
   */
  raidDamagePerSecond(fleet: Fleet): number {
    let attack = 0;
    for (const ship of fleet.ships) {
      if (ship.destroyed) continue;
      const type = this.ships.getShipType(ship.type);
      if (type && isCombatShipType(type)) attack += type.attack;
    }
    return attack * TRADE_NETWORK_CONFIG.raidDamagePerAttack;
  }

  /* The faction a trader works for (its home planet's owner), if any. */
  traderOwner(trader: Trader, starSystems: readonly StarSystem[], factions: readonly Faction[]): Faction | undefined {
    const home = this.findPlanet(starSystems, trader.homePlanetId);
    return home ? factions.find((f) => f.id === home.factionId) : undefined;
  }

  restore(saved: TradeNetworkState | undefined, seed: number, starSystems: readonly StarSystem[]): void {
    this.state = sanitizeTradeNetworkState(saved, seed);
    this.reconcileClock = 0;
    this.routes.clear();
    this.ledger = [];
    this.reconcile(starSystems);
  }

  serialize(): TradeNetworkState {
    return structuredClone(this.state);
  }

  get traders(): readonly Trader[] {
    return this.state.traders;
  }

  getTrader(id: number): Trader | undefined {
    return this.state.traders.find((t) => t.id === id);
  }

  /* Remaining route of a travelling trader (waypoints, then its destination), for rendering. */
  getRoute(trader: Trader): readonly NavPoint[] {
    return this.routes.get(trader.id) ?? [];
  }

  /* Credits the faction earned from deliveries in the last TRADE_INCOME_WINDOW_SECONDS. */
  recentIncome(factionId: string): number {
    return this.ledger.reduce((sum, e) => (e.factionId === factionId ? sum + e.credits : sum), 0);
  }

  /* Network size for the empire-wide trade summary (resource overlay). */
  networkSize(): { nodes: number; traders: number } {
    return { nodes: this.nodes.length, traders: this.state.traders.length };
  }

  postStats(planetId: number): TradePostStats {
    const own = this.state.traders.filter((t) => t.homePlanetId === planetId);
    return {
      nodes: this.nodes.length,
      traders: this.state.traders.length,
      docked: own.filter((t) => t.status === 'docked').length,
      travelling: own.filter((t) => t.status === 'travelling').length,
      respawning: this.state.respawns.filter((r) => r.homePlanetId === planetId).length,
      inbound: this.state.traders.filter((t) => t.status === 'travelling' && t.destinationPlanetId === planetId).length,
    };
  }

  tick(deltaTime: number, ctx: TradeNetworkContext): TradeNetworkTickResult {
    const result: TradeNetworkTickResult = { changed: false, deliveries: [], stranded: [], raids: [] };
    if (deltaTime <= 0) return result;
    this.clock += deltaTime;
    this.decayLosses(deltaTime);
    if (this.ledger.length > 0 && this.ledger[0].at < this.clock - TRADE_INCOME_WINDOW_SECONDS) {
      this.ledger = this.ledger.filter((e) => e.at >= this.clock - TRADE_INCOME_WINDOW_SECONDS);
    }

    let respawnDue = false;
    for (const respawn of this.state.respawns) {
      respawn.secondsLeft = Math.max(0, respawn.secondsLeft - deltaTime);
      if (respawn.secondsLeft === 0) respawnDue = true;
    }
    if (respawnDue) {
      // A finished respawn frees its slot; reconciliation below fills it.
      this.state.respawns = this.state.respawns.filter((r) => r.secondsLeft > 0);
      this.reconcileClock = TRADE_NETWORK_CONFIG.reconcileInterval;
    }

    const rng = new StatefulRng(this.state.rngState);
    for (const trader of [...this.state.traders]) {
      if (trader.status === 'docked') {
        trader.dockSeconds -= deltaTime;
        if (trader.dockSeconds <= 0) {
          this.depart(trader, rng);
          result.changed = true;
        }
      } else {
        result.changed = true;
        this.advance(trader, deltaTime, rng, ctx, result);
      }
    }
    this.state.rngState = rng.state;
    if (ctx.fleets) this.processRaids(deltaTime, ctx, result);

    this.reconcileClock += deltaTime;
    if (this.reconcileClock >= TRADE_NETWORK_CONFIG.reconcileInterval) {
      this.reconcileClock = 0;
      const changes = this.reconcile(ctx.starSystems);
      if (changes.spawned.length > 0 || changes.removed.length > 0 || changes.retired.length > 0) result.changed = true;
    }
    return result;
  }

  /*
   * Picks a reachable destination from the trader's position and loads cargo
   * worth the planned route. Without any reachable node the trader stays
   * docked and tries again after retryDockSeconds.
   */
  private depart(trader: Trader, rng: StatefulRng): void {
    const from = { x: trader.x, y: trader.y };
    if (!this.setCourse(trader, from, trader.portPlanetId, rng)) {
      trader.dockSeconds = TRADE_NETWORK_CONFIG.retryDockSeconds;
      return;
    }
    const origin = this.nodes.find((n) => n.planet.id === trader.portPlanetId);
    const length = routeLength(from, this.routes.get(trader.id)!.slice(0, -1), this.routes.get(trader.id)!.at(-1)!);
    trader.cargo = { credits: cargoValueForRoute(length), goods: pickGoods(origin?.planet.type, rng) };
    trader.status = 'travelling';
    trader.dockSeconds = 0;
  }

  /*
   * Sets destination and route to the first reachable candidate; the route
   * cache ends with the destination point. Returns false if none is reachable.
   */
  private setCourse(trader: Trader, from: NavPoint, portPlanetId: number | null, rng: StatefulRng): boolean {
    for (const node of destinationCandidates(from, portPlanetId, trader.lastPortPlanetId, this.nodes, rng)) {
      const to = { x: node.system.x, y: node.system.y };
      const plan = this.movement.planGalaxyRoute(from, to);
      if (!plan.ok) continue;
      trader.destinationPlanetId = node.planet.id;
      this.routes.set(trader.id, [...plan.waypoints.map((p) => ({ ...p })), to]);
      return true;
    }
    return false;
  }

  private advance(trader: Trader, deltaTime: number, rng: StatefulRng, ctx: TradeNetworkContext, result: TradeNetworkTickResult): void {
    // Inside a wormhole (wormholes.ts): wait, then come out at the exit; the
    // route continues after the jump waypoint (re-planned from the exit after a load).
    if (trader.transit) {
      trader.transit.remaining -= deltaTime;
      if (trader.transit.remaining > 0) return;
      trader.x = trader.transit.exitX;
      trader.y = trader.transit.exitY;
      delete trader.transit;
      const cached = this.routes.get(trader.id);
      if (cached?.[0]?.jump) cached.shift();
      return;
    }
    let route = this.routes.get(trader.id);
    if (!route) {
      // After a load: re-plan from the current position to the saved destination.
      const destination = this.nodes.find((n) => n.planet.id === trader.destinationPlanetId);
      const plan = destination ? this.movement.planGalaxyRoute({ x: trader.x, y: trader.y }, { x: destination.system.x, y: destination.system.y }) : null;
      if (destination && plan?.ok) {
        route = [...plan.waypoints.map((p) => ({ ...p })), { x: destination.system.x, y: destination.system.y }];
        this.routes.set(trader.id, route);
      } else if (!this.redirect(trader, rng)) {
        this.strand(trader, result);
        return;
      } else {
        route = this.routes.get(trader.id)!;
      }
    }

    // Nebulae slow the trader while its current position is inside one.
    let budget = TRADE_NETWORK_CONFIG.speed * this.terrain.nebulaField.speedMultiplierAt(trader.x, trader.y) * deltaTime;
    while (budget > 0 && route.length > 0) {
      const next = route[0];
      const dx = next.x - trader.x;
      const dy = next.y - trader.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        trader.x = next.x;
        trader.y = next.y;
        budget -= distance;
        if (next.jump) {
          trader.transit = { wormholeId: next.jump.wormholeId, remaining: next.jump.transitSeconds, exitX: next.jump.exitX, exitY: next.jump.exitY };
          return;
        }
        route.shift();
      } else {
        trader.x += (dx / distance) * budget;
        trader.y += (dy / distance) * budget;
        budget = 0;
      }
    }
    if (route.length === 0) this.arrive(trader, rng, ctx, result);
  }

  /*
   * Delivers at the destination and docks there. If the destination stopped
   * being a node during the trip, the trader keeps its cargo and flies on to
   * another node instead (no new cargo value is rolled).
   */
  private arrive(trader: Trader, rng: StatefulRng, ctx: TradeNetworkContext, result: TradeNetworkTickResult): void {
    this.routes.delete(trader.id);
    const destination = this.nodes.find((n) => n.planet.id === trader.destinationPlanetId);
    if (!destination) {
      if (!this.redirect(trader, rng)) this.strand(trader, result);
      return;
    }
    const owner = (planetFactionId: string | undefined) => ctx.factions.find((f) => f.id === planetFactionId);
    const home = this.findPlanet(ctx.starSystems, trader.homePlanetId);
    const delivery = payDelivery(trader, owner(home?.factionId), owner(destination.planet.factionId));
    if (delivery) {
      result.deliveries.push(delivery);
      if (delivery.homeOwnerId) this.ledger.push({ at: this.clock, factionId: delivery.homeOwnerId, credits: delivery.credits });
      if (delivery.destinationOwnerId) this.ledger.push({ at: this.clock, factionId: delivery.destinationOwnerId, credits: delivery.portFee });
    }

    if (trader.retiring) {
      this.state.traders = this.state.traders.filter((t) => t.id !== trader.id);
      return;
    }
    trader.status = 'docked';
    trader.lastPortPlanetId = trader.portPlanetId;
    trader.portPlanetId = destination.planet.id;
    trader.destinationPlanetId = null;
    trader.cargo = null;
    trader.dockSeconds = TRADE_NETWORK_CONFIG.dockSeconds;
    // A trader that escaped a raid is repaired in port.
    trader.hull = TRADE_NETWORK_CONFIG.hull;
    trader.x = destination.system.x;
    trader.y = destination.system.y;
  }

  /*
   * Applies raid damage. A fleet hurts a trader only if it carries a raid
   * order on it (Fleet.raidTraderId), has a living warship, stands within
   * raidRadius of it, and may raid it (raidBlocker). Docked traders are safe.
   * Several fleets on one trader add up; the fleet landing the killing blow
   * takes the loot for its faction.
   */
  private processRaids(deltaTime: number, ctx: TradeNetworkContext, result: TradeNetworkTickResult): void {
    for (const fleet of ctx.fleets ?? []) {
      if (fleet.raidTraderId == null || fleet.destroyed) continue;
      const trader = this.getTrader(fleet.raidTraderId);
      if (!trader || trader.status !== 'travelling' || trader.transit || fleet.transit) continue;
      if (Math.hypot(fleet.x - trader.x, fleet.y - trader.y) > TRADE_NETWORK_CONFIG.raidRadius) continue;
      const raider = ctx.factions.find((f) => f.id === fleet.factionId);
      const owner = this.traderOwner(trader, ctx.starSystems, ctx.factions);
      if (raidBlocker(raider, owner)) continue;
      const damage = this.raidDamagePerSecond(fleet) * deltaTime;
      if (damage <= 0) continue;
      trader.hull = Math.max(0, trader.hull - damage);
      result.changed = true;
      if (trader.hull <= 0) result.raids.push(this.destroyTrader(trader, fleet, raider!, owner));
    }
  }

  /* Removes a raided trader: loot, diplomatic cost, escalating respawn of its slot. */
  private destroyTrader(trader: Trader, fleet: Fleet, raider: Faction, owner: Faction | undefined): TraderRaid {
    const cargoCredits = Math.max(0, Math.floor(trader.cargo?.credits ?? 0));
    const loot = Math.floor(cargoCredits * TRADE_NETWORK_CONFIG.lootShare);
    raider.currencies['credits'] = (raider.currencies['credits'] ?? 0) + loot;
    const consequences = applyRaidConsequences(raider, owner, cargoCredits);

    const losses = (this.state.losses ??= []);
    let record = losses.find((l) => l.homePlanetId === trader.homePlanetId);
    if (!record) {
      record = { homePlanetId: trader.homePlanetId, count: 0, quietSeconds: 0 };
      losses.push(record);
    }
    record.count++;
    record.quietSeconds = 0;
    const respawnSeconds = respawnDelay(record.count);
    this.state.respawns.push({ homePlanetId: trader.homePlanetId, slot: trader.slot, secondsLeft: respawnSeconds });

    this.state.traders = this.state.traders.filter((t) => t.id !== trader.id);
    this.routes.delete(trader.id);
    return {
      traderId: trader.id,
      homePlanetId: trader.homePlanetId,
      raiderFleetId: fleet.id,
      raiderFactionId: raider.id,
      ownerId: owner && !isNeutralFaction(owner) ? owner.id : null,
      goods: trader.cargo?.goods ?? 'empty hold',
      cargoCredits,
      loot,
      opinion: consequences.opinion,
      reputation: consequences.reputation,
      respawnSeconds,
    };
  }

  /* A node's loss count is forgotten after lossMemorySeconds without a loss. */
  private decayLosses(deltaTime: number): void {
    const losses = this.state.losses;
    if (!losses || losses.length === 0) return;
    for (const record of losses) record.quietSeconds += deltaTime;
    this.state.losses = losses.filter((l) => l.quietSeconds < TRADE_NETWORK_CONFIG.lossMemorySeconds);
  }

  private redirect(trader: Trader, rng: StatefulRng): boolean {
    return this.setCourse(trader, { x: trader.x, y: trader.y }, trader.destinationPlanetId, rng);
  }

  /*
   * A travelling trader with no route to any node is lost with its cargo; its
   * slot refills at the home node on the next reconciliation. With static
   * terrain this only happens when every other node disappeared mid-trip.
   */
  private strand(trader: Trader, result: TradeNetworkTickResult): void {
    this.routes.delete(trader.id);
    this.state.traders = this.state.traders.filter((t) => t.id !== trader.id);
    result.stranded.push(trader.id);
  }

  private findPlanet(starSystems: readonly StarSystem[], planetId: number) {
    for (const system of starSystems) {
      const planet = system.planetsTiles?.find((p) => p.id === planetId);
      if (planet) return planet;
    }
    return undefined;
  }

  private reconcile(starSystems: readonly StarSystem[]): ReconcileResult {
    this.nodes = tradePosts(starSystems);
    const rng = new StatefulRng(this.state.rngState);
    const result = reconcileTraders(this.state, this.nodes, rng);
    this.state.rngState = rng.state;
    for (const removed of result.removed) this.routes.delete(removed.id);
    return result;
  }
}

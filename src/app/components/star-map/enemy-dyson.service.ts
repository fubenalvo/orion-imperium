import { Injectable } from '@angular/core';
import { Faction, FactionProduction, FactionShipStock, Fleet, SpaceBase, StarSystem } from './star-map.models';
import { ProductionService } from '../../services/production.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import { SpaceportService } from '../../services/spaceport.service';
import { ResearchService } from '../../services/research.service';
import { ShipService } from '../../services/ship.service';
import { DiplomacyService } from '../../services/diplomacy.service';
import { canAffordCost } from '../../services/resource-cost';
import { UPKEEP_CREDITS_PER_POINT } from '../../services/economy.service';
import { SpaceBaseService } from './space-base.service';
import { DysonRingService } from './dyson-ring.service';
import { DysonVictoryService } from './dyson-victory.service';
import { EnemyEconomyService } from './enemy-economy.service';
import { getAiPersonalityProfile } from './ai-personality';
import { isCombatShipType } from './ai-queries';
import { getRelationKind, isTreatyPair, isTruceActive } from './diplomacy';
import { isCivilianMissionFleet } from './space-base';
import { isStationComplete } from './station-construction';
import {
  DYSON_ANCHOR_SHIP_TYPE,
  DYSON_ANCHOR_UPKEEP_POINTS,
  DysonBonusId,
  dysonAnchorCount,
  hasLivingSwarmConstructor,
  isDysonAnchor,
} from './dyson-anchor';
import { AiActionLedger, rejectionReason } from './ai-action-ledger';

/*
 * =========================================================
 * ENEMY DYSON SERVICE (AI Dyson Swarm behavior)
 * =========================================================
 *
 * What AI factions do about the Dyson Swarm (docs/dyson-swarm.md, "AI"),
 * through exactly the player's rules (SpaceBaseService.deployAnchor,
 * DiplomacyService war and treaty calls, ordinary fleet movement and the
 * shared base battle path). The personality decides (ai-personality.ts
 * `dyson`):
 *
 *  1. Build (`build` 'always' = technologist; 'rich' = balanced with a large
 *     credit surplus; 'never' otherwise). With Stellar Engineering, a free
 *     slot, the full price in hand and upkeep headroom, a Swarm Constructor
 *     is queued — up to MAX_CONSTRUCTORS (by plan) queued, stocked or flying
 *     at once; from stock it is assembled into a fleet with up to
 *     ESCORT_SHIPS stocked warships as escort; each fleet flies to the
 *     nearest free slot no other own constructor is heading for, deploys
 *     there and picks a bonus.
 *  2. Hunt. Another empire is a target when it holds `huntAnchors` anchors
 *     (sites included) — or, for every personality, while its warm-up
 *     runs. A builder that finds the ring full without owning all of it
 *     contests it: the rival with the most anchors becomes its target
 *     (phase 7: two builders used to split the ring and freeze it). At peace the AI declares war (free: the Dyson casus belli); a
 *     truce is broken only during a warm-up. At war, combat fleets are sent
 *     onto the target's anchor cells (sites first, then the nearest), where
 *     the ordinary base battle starts: one fleet normally, every fleet but
 *     the strongest-remaining home fleet during a warm-up.
 *  3. Guard. A builder holding GUARD_MIN_ANCHORS completed anchors parks one
 *     combat fleet on its own anchor nearest to the black hole's busiest
 *     side; an attacker reaching that cell meets the fleet first.
 *
 * Ownership: fleets carrying a living Swarm Constructor and the combat
 * fleets this service has ordered (getOrderedFleetIds) are written only
 * here; StarMapAiTickService reserves them from EnemyFleetService and the
 * other layers. An order ends (the fleet returns to EnemyFleetService) when
 * its reason is gone: no target anchors left, the target is no longer
 * hostile, the warm-up ended, or the fleet lost its warships.
 *
 * State: the per-faction decision clock and the combat orders, both
 * dropped by reset(); everything else is re-derived from the world.
 */
type DysonFleetOrder = { kind: 'hunt'; targetFactionId: string } | { kind: 'guard' };

@Injectable({ providedIn: 'root' })
export class EnemyDysonService {
  static readonly DECISION_INTERVAL = 3;
  /* Stocked warships that join a new Swarm Constructor fleet as escort. */
  static readonly ESCORT_SHIPS = 3;
  /* 'rich' builders need this many credits beyond the constructor's price. */
  static readonly RICH_CREDIT_SURPLUS = 40000;
  /* Net credits/s that must remain after the new anchor's upkeep. */
  static readonly UPKEEP_MARGIN = 5;
  /* Living warships an ordinary (non-warm-up) hunt fleet needs: completed anchors have turrets. */
  static readonly MIN_HUNT_WARSHIPS = 3;
  static readonly GUARD_MIN_ANCHORS = 3;
  /*
   * Constructors a faction keeps queued, stocked or flying at once. One per
   * builder made a full ring take two hours after the technology (phase 7).
   */
  static readonly MAX_CONSTRUCTORS: Record<'always' | 'rich', number> = { always: 2, rich: 1 };

  private readonly accumulators = new Map<string, number>();
  /* Fleet id → its Dyson combat order. */
  private readonly orders = new Map<number, DysonFleetOrder>();

  constructor(
    private readonly productionService: ProductionService,
    private readonly fleetAssemblyService: FleetAssemblyService,
    private readonly spaceportService: SpaceportService,
    private readonly researchService: ResearchService,
    private readonly shipService: ShipService,
    private readonly diplomacy: DiplomacyService,
    private readonly bases: SpaceBaseService,
    private readonly ring: DysonRingService,
    private readonly victory: DysonVictoryService,
    private readonly enemyEconomy: EnemyEconomyService,
    private readonly actionLedger: AiActionLedger,
  ) {}

  reset(): void {
    this.accumulators.clear();
    this.orders.clear();
  }

  /* Fleets this service drives: Swarm Constructor fleets are found by their cargo, combat fleets by order. */
  getOrderedFleetIds(): ReadonlySet<number> {
    return new Set(this.orders.keys());
  }

  static isConstructorFleet(fleet: Fleet): boolean {
    return !fleet.destroyed && hasLivingSwarmConstructor(fleet);
  }

  tick(
    gameDeltaTime: number,
    faction: Faction,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[]; production: FactionProduction[] },
    reserved: ReadonlySet<number>,
  ): boolean {
    if (gameDeltaTime <= 0 || faction.ai !== true || !this.ring.ring) return false;
    const accumulator = (this.accumulators.get(faction.id) ?? 0) + gameDeltaTime;
    if (accumulator < EnemyDysonService.DECISION_INTERVAL) {
      this.accumulators.set(faction.id, accumulator);
      return false;
    }
    this.accumulators.set(faction.id, accumulator - EnemyDysonService.DECISION_INTERVAL);

    let changed = this.releaseFinishedOrders(faction, data);
    changed = this.hunt(faction, data, reserved) || changed;
    changed = this.build(faction, data) || changed;
    changed = this.guard(faction, data, reserved) || changed;
    return changed;
  }

  // ---------------------------------------------------------------
  // Building anchors
  // ---------------------------------------------------------------

  private build(
    faction: Faction,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[]; production: FactionProduction[] },
  ): boolean {
    const plan = getAiPersonalityProfile(faction).dyson.build;
    if (plan === 'never' || !this.researchService.isShipUnlocked(faction, DYSON_ANCHOR_SHIP_TYPE)) return false;

    let changed = false;
    const fleets = data.fleets.filter((f) => f.factionId === faction.id && EnemyDysonService.isConstructorFleet(f));
    for (const fleet of fleets) {
      changed = this.driveConstructor(faction, fleet, data, fleets) || changed;
    }
    if (this.freeSlots().length === 0) return changed;
    if (this.assembleConstructor(faction, data)) return true;
    if (this.constructorsInProgress(faction, data) >= EnemyDysonService.MAX_CONSTRUCTORS[plan]) return changed;
    return this.queueConstructor(faction, data, plan) || changed;
  }

  /* Swarm Constructors queued, in stock or in fleets. */
  private constructorsInProgress(
    faction: Faction,
    data: { fleets: Fleet[]; shipStock: FactionShipStock[]; production: FactionProduction[] },
  ): number {
    const queued = Object.values(data.production.find((p) => p.factionId === faction.id)?.ordersByPlanet ?? {})
      .flat()
      .filter((o) => o.shipTypeId === DYSON_ANCHOR_SHIP_TYPE).length;
    const stocked = (data.shipStock.find((s) => s.factionId === faction.id)?.ships ?? []).filter((s) => s.type === DYSON_ANCHOR_SHIP_TYPE).length;
    const flying = data.fleets
      .filter((f) => f.factionId === faction.id && !f.destroyed)
      .reduce((n, f) => n + f.ships.filter((s) => s.type === DYSON_ANCHOR_SHIP_TYPE && !s.destroyed).length, 0);
    return queued + stocked + flying;
  }

  private freeSlots() {
    const ring = this.ring.ring!;
    return ring.slots.filter((slot) => !this.bases.anchorOnSlot(slot.index));
  }

  /* Queues one more constructor (the caller checked the per-plan limit). */
  private queueConstructor(
    faction: Faction,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[]; production: FactionProduction[] },
    plan: 'always' | 'rich',
  ): boolean {
    const type = this.shipService.getShipType(DYSON_ANCHOR_SHIP_TYPE);
    if (!type) return false;
    const cost = this.productionService.shipCostFor(type, faction.id);
    const surplus = plan === 'rich' ? EnemyDysonService.RICH_CREDIT_SURPLUS : 0;
    if (!canAffordCost(faction, { credits: cost.credits + surplus, rawmaterials: cost.rawmaterials })) return false;
    // The anchor's upkeep must fit the projected net income with a margin.
    const context = { fleets: data.fleets, shipStock: data.shipStock, production: data.production, factions: data.factions };
    const projected = this.enemyEconomy.getProjectedNet(faction, data.starSystems, context);
    // Counts every constructor already under way, so parallel builds never overcommit.
    const pending = 1 + this.constructorsInProgress(faction, data);
    const anchorUpkeep = pending * DYSON_ANCHOR_UPKEEP_POINTS * UPKEEP_CREDITS_PER_POINT * projected.upkeepScale;
    if (projected.net - anchorUpkeep < EnemyDysonService.UPKEEP_MARGIN) return false;
    if (this.spaceportService.listSpaceports(faction.id, data.starSystems).length === 0) return false;

    const factory = data.starSystems
      .flatMap((s) => s.planetsTiles)
      .filter((p) => p.factionId === faction.id && p.buildings.some((b) => b.name === 'Spaceship Factory'))
      .sort((a, b) => a.id - b.id)[0];
    if (!factory) return false;
    const result = this.productionService.queueOrder(
      { production: data.production }, faction.id, factory.id, DYSON_ANCHOR_SHIP_TYPE, 1, data.starSystems, [faction],
    );
    if (result.ok) this.actionLedger.record(faction, 'constructor_queued');
    else this.actionLedger.reject(faction, 'constructor_queued', rejectionReason(result));
    return result.ok;
  }

  /* A stocked constructor leaves the Spaceport with up to ESCORT_SHIPS stocked warships. */
  private assembleConstructor(faction: Faction, data: { starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] }): boolean {
    const stock = data.shipStock.find((s) => s.factionId === faction.id)?.ships ?? [];
    if (!stock.some((s) => s.type === DYSON_ANCHOR_SHIP_TYPE)) return false;
    const spaceport = [...this.spaceportService.listSpaceports(faction.id, data.starSystems)]
      .sort((a, b) => a.system.id.localeCompare(b.system.id) || a.planet.id - b.planet.id)[0];
    if (!spaceport) return false;

    const escortCounts = new Map<string, number>();
    let escorts = 0;
    for (const ship of stock) {
      if (escorts >= EnemyDysonService.ESCORT_SHIPS) break;
      if (!isCombatShipType(this.shipService.getShipType(ship.type))) continue;
      escortCounts.set(ship.type, (escortCounts.get(ship.type) ?? 0) + 1);
      escorts++;
    }
    const composition = [
      { typeId: DYSON_ANCHOR_SHIP_TYPE, count: 1 },
      ...[...escortCounts].map(([typeId, count]) => ({ typeId, count })),
    ];
    const result = this.fleetAssemblyService.createFleet({ fleets: data.fleets, shipStock: data.shipStock }, data.starSystems, {
      factionId: faction.id,
      fleetName: `${faction.name} Swarm Builders`,
      systemId: spaceport.system.id,
      planetId: spaceport.planet.id,
      composition,
    });
    if (result.ok) this.actionLedger.record(faction, 'constructor_fleet_created');
    else this.actionLedger.reject(faction, 'constructor_fleet_created', rejectionReason(result));
    return result.ok;
  }

  /* Fly to the nearest free slot no other own constructor heads for; deploy on it; pick the bonus. */
  private driveConstructor(
    faction: Faction,
    fleet: Fleet,
    data: { factions: Faction[]; starSystems: StarSystem[] },
    ownConstructors: readonly Fleet[],
  ): boolean {
    if (fleet.targetX !== null || fleet.targetY !== null) return false; // travelling
    const check = this.bases.checkAnchor(fleet, data.factions);
    if (check.ok) {
      const result = this.bases.deployAnchor(fleet, data.factions);
      if (result.base) this.bases.chooseBonus(result.base.id, faction.id, this.chooseBonus(faction));
      if (result.base) this.actionLedger.record(faction, 'anchor_deployed');
      else this.actionLedger.reject(faction, 'anchor_deployed', 'deployment_invalid');
      return !!result.base;
    }
    const claimed = new Set(
      ownConstructors.filter((f) => f !== fleet && f.targetX !== null).map((f) => `${f.targetX},${f.targetY}`),
    );
    const open = this.freeSlots().filter((s) => !claimed.has(`${s.col},${s.row}`));
    const slot = (open.length > 0 ? open : this.freeSlots()).sort(
      (a, b) => Math.hypot(a.col - fleet.x, a.row - fleet.y) - Math.hypot(b.col - fleet.x, b.row - fleet.y) || a.index - b.index,
    )[0];
    if (!slot) return false;
    fleet.system = null;
    fleet.targetX = slot.col;
    fleet.targetY = slot.row;
    // Only reached while the constructor is not travelling, so each one is a new dispatch.
    this.actionLedger.record(faction, 'constructor_dispatched');
    return true;
  }

  /* Research for the scientific empire, otherwise cheaper ships. */
  private chooseBonus(faction: Faction): DysonBonusId {
    return getAiPersonalityProfile(faction).dyson.build === 'always' ? 'swarm_observatory' : 'orbital_foundries';
  }

  // ---------------------------------------------------------------
  // Hunting another empire's anchors
  // ---------------------------------------------------------------

  /*
   * Is `other` the empire `faction` is hunting for the Dyson Swarm right now?
   * EnemyDiplomacyService then refuses peace with it: an AI–AI settlement a
   * minute after the free declaration (and the truce that follows) would
   * otherwise end every hunt before a fleet arrives (phase 7).
   */
  isHuntTarget(faction: Faction, other: Faction, factions: Faction[]): boolean {
    if (faction.ai !== true || !this.ring.ring) return false;
    return this.huntTarget(faction, { factions })?.target.id === other.id;
  }

  /* The empire this faction should stop now, or undefined. A running warm-up beats everything. */
  private huntTarget(faction: Faction, data: { factions: Faction[] }): { target: Faction; warmup: boolean } | undefined {
    const warmup = this.victory.warmup;
    if (warmup && warmup.remaining > 0 && warmup.factionId !== faction.id) {
      const target = data.factions.find((f) => f.id === warmup.factionId);
      if (target && isTreatyPair(faction, target)) return { target, warmup: true };
    }
    const profile = getAiPersonalityProfile(faction).dyson;
    // A builder facing a full ring it does not own contests it from the first rival anchor.
    const contesting = profile.build !== 'never'
      && this.researchService.isShipUnlocked(faction, DYSON_ANCHOR_SHIP_TYPE)
      && this.freeSlots().length === 0
      && dysonAnchorCount(this.bases.bases, faction.id) < this.ring.ring!.slots.length;
    const threshold = contesting ? 1 : profile.huntAnchors;
    let best: { target: Faction; count: number } | undefined;
    for (const other of data.factions) {
      if (other.id === faction.id || !isTreatyPair(faction, other)) continue;
      const count = dysonAnchorCount(this.bases.bases, other.id);
      if (count >= threshold && (!best || count > best.count)) best = { target: other, count };
    }
    return best ? { target: best.target, warmup: false } : undefined;
  }

  private hunt(
    faction: Faction,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[] },
    reserved: ReadonlySet<number>,
  ): boolean {
    const hunt = this.huntTarget(faction, data);
    if (!hunt) return false;
    const { target, warmup } = hunt;

    if (getRelationKind(faction, target) !== 'war') {
      // The Dyson casus belli makes the declaration free; a truce is only broken against a warm-up.
      const breach = isTruceActive(faction, target);
      if (breach && !warmup) return false;
      const result = breach ? this.diplomacy.breakTreaty(faction, target) : this.diplomacy.declareWar(faction, target);
      const kind = breach ? 'treaty_broken' : 'war_declared';
      if (result.ok) this.actionLedger.record(faction, kind);
      else this.actionLedger.reject(faction, kind, rejectionReason(result));
      return result.ok;
    }

    const anchors = this.bases.bases.filter((b) => isDysonAnchor(b) && b.factionId === target.id);
    if (anchors.length === 0) return false;
    const candidates = this.freeCombatFleets(faction, data.fleets, reserved)
      .filter((f) => warmup || this.livingWarships(f) >= EnemyDysonService.MIN_HUNT_WARSHIPS)
      .sort((a, b) => this.strength(b) - this.strength(a) || a.id - b.id);
    const hunters = [...this.orders].filter(([, o]) => o.kind === 'hunt').length;
    // One fleet normally; during a warm-up every free fleet but one (kept home).
    const wanted = warmup ? Math.max(1, candidates.length - 1 + hunters) : 1;
    let changed = false;
    for (const fleet of candidates) {
      if ([...this.orders.values()].filter((o) => o.kind === 'hunt').length >= wanted) break;
      this.orders.set(fleet.id, { kind: 'hunt', targetFactionId: target.id });
      this.actionLedger.record(faction, 'dyson_fleet_order');
      changed = true;
    }
    // Every hunter heads for the target's next anchor: construction sites first, then the nearest.
    for (const [fleetId, order] of this.orders) {
      if (order.kind !== 'hunt' || order.targetFactionId !== target.id) continue;
      const fleet = data.fleets.find((f) => f.id === fleetId);
      if (!fleet || fleet.factionId !== faction.id) continue;
      const anchor = this.nextAnchor(fleet, anchors);
      changed = this.sendTo(fleet, anchor.x, anchor.y) || changed;
    }
    return changed;
  }

  private nextAnchor(fleet: Fleet, anchors: SpaceBase[]): SpaceBase {
    const distance = (b: SpaceBase) => Math.hypot(b.x - fleet.x, b.y - fleet.y);
    return [...anchors].sort(
      (a, b) => Number(isStationComplete(a)) - Number(isStationComplete(b)) || distance(a) - distance(b) || a.id - b.id,
    )[0];
  }

  // ---------------------------------------------------------------
  // Guarding own anchors
  // ---------------------------------------------------------------

  private guard(faction: Faction, data: { fleets: Fleet[] }, reserved: ReadonlySet<number>): boolean {
    if (getAiPersonalityProfile(faction).dyson.build === 'never') return false;
    const own = this.bases.bases.filter((b) => isDysonAnchor(b) && b.factionId === faction.id && isStationComplete(b));
    if (own.length < EnemyDysonService.GUARD_MIN_ANCHORS) return false;
    let guardId = [...this.orders].find(([id, o]) => o.kind === 'guard' && data.fleets.some((f) => f.id === id && f.factionId === faction.id))?.[0];
    let changed = false;
    if (guardId === undefined) {
      // The second-strongest free fleet: the strongest stays with EnemyFleetService for defense and assaults.
      const free = this.freeCombatFleets(faction, data.fleets, reserved).sort((a, b) => this.strength(b) - this.strength(a) || a.id - b.id);
      const pick = free[1];
      if (!pick) return false;
      this.orders.set(pick.id, { kind: 'guard' });
      this.actionLedger.record(faction, 'dyson_fleet_order');
      guardId = pick.id;
      changed = true;
    }
    const fleet = data.fleets.find((f) => f.id === guardId)!;
    // Park on the own anchor nearest to the guard (any anchor cell is the front).
    const post = [...own].sort((a, b) => Math.hypot(a.x - fleet.x, a.y - fleet.y) - Math.hypot(b.x - fleet.x, b.y - fleet.y) || a.id - b.id)[0];
    return this.sendTo(fleet, post.x, post.y) || changed;
  }

  // ---------------------------------------------------------------
  // Shared
  // ---------------------------------------------------------------

  /* Ends orders whose reason is gone; the fleet returns to EnemyFleetService. */
  private releaseFinishedOrders(faction: Faction, data: { factions: Faction[]; fleets: Fleet[] }): boolean {
    let changed = false;
    const hunt = this.huntTarget(faction, data);
    const ownAnchors = this.bases.bases.filter((b) => isDysonAnchor(b) && b.factionId === faction.id && isStationComplete(b)).length;
    for (const [fleetId, order] of [...this.orders]) {
      const fleet = data.fleets.find((f) => f.id === fleetId);
      if (!fleet || fleet.factionId !== faction.id) {
        if (!fleet) this.orders.delete(fleetId);
        continue;
      }
      let done = fleet.destroyed || this.livingWarships(fleet) === 0;
      if (order.kind === 'hunt') {
        const target = data.factions.find((f) => f.id === order.targetFactionId);
        done = done || !hunt || hunt.target.id !== order.targetFactionId || !target || getRelationKind(faction, target) !== 'war'
          || !this.bases.bases.some((b) => isDysonAnchor(b) && b.factionId === order.targetFactionId);
      } else {
        done = done || ownAnchors < EnemyDysonService.GUARD_MIN_ANCHORS;
      }
      if (done) {
        this.orders.delete(fleetId);
        if (!fleet.destroyed) {
          fleet.targetX = null;
          fleet.targetY = null;
        }
        changed = true;
      }
    }
    return changed;
  }

  /* Own living fleets with a warship that no other mission or this service holds. */
  private freeCombatFleets(faction: Faction, fleets: Fleet[], reserved: ReadonlySet<number>): Fleet[] {
    return fleets.filter(
      (f) => f.factionId === faction.id && !f.destroyed && !reserved.has(f.id) && !this.orders.has(f.id)
        && !isCivilianMissionFleet(f) && this.livingWarships(f) > 0,
    );
  }

  private livingWarships(fleet: Fleet): number {
    return fleet.ships.filter((s) => !s.destroyed && isCombatShipType(this.shipService.getShipType(s.type))).length;
  }

  private strength(fleet: Fleet): number {
    return this.shipService.calculateFleetStrength(fleet.ships.filter((s) => !s.destroyed));
  }

  /* Orders a galaxy move unless the fleet is already there or on its way; clears other roles' fields. */
  private sendTo(fleet: Fleet, x: number, y: number): boolean {
    const there = Math.floor(fleet.x) === x && Math.floor(fleet.y) === y;
    const heading = fleet.targetX === x && fleet.targetY === y;
    if (there || heading) return false;
    fleet.system = null;
    fleet.targetX = x;
    fleet.targetY = y;
    fleet.interceptAsteroidId = null;
    fleet.attackFleetId = null;
    fleet.raidTraderId = null;
    return true;
  }
}

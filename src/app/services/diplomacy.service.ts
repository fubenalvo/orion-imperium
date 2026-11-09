import { Injectable, Optional } from '@angular/core';
import { Faction, FactionProduction } from '../components/star-map/star-map.models';
import {
  OPINION_PEACE_SIGNED,
  OPINION_TREATY_BROKEN,
  OPINION_WAR_DECLARED,
  REPUTATION_TREATY_BROKEN,
  REPUTATION_WAR_DECLARED,
  TRUCE_SECONDS,
  WAR_MIN_DURATION_SECONDS,
  adjustOpinion,
  adjustReputation,
  getDemandCooldown,
  getRelation,
  isTreatyPair,
  isTruceActive,
  recordDemandMade,
  recordDemandRefused,
  recordEmptyThreat,
  recordThreatCarriedOut,
  startPeace,
  startWar,
  tickDiplomacyTime, inContact,
} from '../components/star-map/diplomacy';
import {
  DEMAND_NUISANCE_OPINION,
  DEMAND_PAIR_COOLDOWN_SECONDS,
  DEMAND_RESPONSE_SECONDS,
  DEMAND_RULES,
  DemandInvalidReason,
  DemandKind,
  DiplomaticDemand,
  FOLLOW_THROUGH_SECONDS,
  MAX_PENDING_PLAYER_DEMANDS,
  REPUTATION_EMPTY_THREAT,
  sanitizeDemands,
  validateDemand,
} from '../components/star-map/diplomatic-demand';
import { transferResources } from '../components/star-map/resource-transfer';
import {
  PeaceTreaty,
  TreatyValidation,
  TreatyWorld,
  isFactionAlive,
  resourceTotal,
  validateTreaty,
} from '../components/star-map/peace-treaty';
import { SpaceBaseService } from '../components/star-map/space-base.service';
import { DYSON_CASUS_BELLI_ANCHORS, dysonAnchorCount } from '../components/star-map/dyson-anchor';

/*
 * =========================================================
 * DIPLOMACY SERVICE
 * =========================================================
 *
 * Applies every treaty change — for the player and the AI with exactly the
 * same rules and consequences (docs/diplomacy.md):
 *  - declareWar: only at peace after the truce; reputation and the
 *    victim's opinion drop;
 *  - breakTreaty: the only way to end a running truce; a heavy reputation
 *    and opinion penalty;
 *  - Dyson casus belli (isDysonCasusBelli): against an empire holding 3+
 *    Dyson anchors, both cost no reputation and the war carries no
 *    surprise-attack penalty; the victim's opinion still drops;
 *  - executeTreaty: ends a war with a peace treaty. All-or-nothing: the
 *    terms are re-validated first and only then are resources moved,
 *    peace and the truce started and exhaustion reset. Treaties carry
 *    resources only; planets never change owner through diplomacy.
 *  - credit demands (diplomatic-demand.ts): issueDemand / acceptDemand /
 *    refuseDemand / carryOutThreat / backDown apply the peace-time demand
 *    rules. Payment goes through the shared atomic transfer
 *    (resource-transfer.ts) and never touches treaty state; carrying out a
 *    threat is an ordinary declareWar with all its checks and penalties.
 *    Who decides (accept or refuse, war or bluff) is the caller's
 *    business: the player through StarMap, the AI through
 *    EnemyDiplomacyService.
 *
 * Transient state (not saved; AIs re-evaluate within one decision
 * interval after a load): open AI peace proposals to the human player and
 * the event queue StarMap drains for notices. Treaty state, opinion,
 * reputation and exhaustion live on the factions (diplomacy.ts) and are
 * saved with them. reset() runs on every genuine load / new game.
 *
 * Saved state: open demands (AI demands waiting for the human, the
 * human's refused threats waiting for war-or-back-down). They are kept
 * apart from the peace offers on purpose: a pending ultimatum must survive
 * a reload, or reloading would dodge its consequences. StarMap writes them
 * with serializeDemands and restores them after every load with
 * restoreDemands. Demand cooldowns and memories live on the factions.
 */

export type DiplomacyFailure = 'invalid' | 'already' | 'locked' | 'truce' | 'not_in_truce' | 'no_contact';

export interface DiplomacyResult {
  ok: boolean;
  reason?: DiplomacyFailure;
  /* Seconds until the action becomes possible (locked / truce). */
  waitSeconds?: number;
}

export interface TreatyExecution {
  ok: boolean;
  validation: TreatyValidation;
}

/**
 * 'demand': a demand was made (initiator = demander);
 * 'demand_paid' / 'demand_refused': the target answered it;
 * 'bluff': a refused threat was not carried out (carrying it out emits 'war').
 */
export type DiplomacyEventKind = 'war' | 'breach' | 'peace' | 'honored' | 'demand' | 'demand_paid' | 'demand_refused' | 'bluff';

export interface DiplomacyEvent {
  kind: DiplomacyEventKind;
  initiatorId: string;
  targetId: string;
  /* War or breach against a Dyson casus belli target: no reputation cost. */
  dysonCasusBelli?: boolean;
  /* Peace: the executed terms (for notices). */
  treaty?: PeaceTreaty;
  /* Demand events: a copy of the demand concerned. */
  demand?: DiplomaticDemand;
}

/** Why a demand action is not possible right now. */
export type DemandFailure = DemandInvalidReason | 'cooldown' | 'open_demand' | 'player_queue_full' | 'not_found' | 'war_failed' | 'no_contact';

/** Result of a demand check or action. */
export interface DemandResult {
  ok: boolean;
  reason?: DemandFailure;
  /** Cooldown or war lock: game seconds until the action becomes possible. */
  waitSeconds?: number;
  /** issueDemand: the demand that was made (not stored; see addPendingDemand). */
  demand?: DiplomaticDemand;
}

export interface PeaceProposal {
  treaty: PeaceTreaty;
  secondsLeft: number;
}

/*
 * `ignoreCooldowns`: a campaign `force_demand` (a scripted demand) skips the
 * demander's cooldowns; every other rule still applies, and the demand
 * still starts the cooldowns as usual.
 */
export interface DemandOptions {
  ignoreCooldowns?: boolean;
}

/* How long an AI peace proposal to the player stays open (game seconds). */
export const PEACE_OFFER_SECONDS = 90;

@Injectable({ providedIn: 'root' })
export class DiplomacyService {
  private events: DiplomacyEvent[] = [];
  /* AI faction id → its open peace proposal to the human player. */
  private offers = new Map<string, PeaceProposal>();
  /* Open demands (saved): 'pending' ones to the human, 'follow_through' ones of the human. */
  private demands: DiplomaticDemand[] = [];
  /* Pending demands whose answer time ran out; EnemyDiplomacyService handles them as refusals. */
  private expiredDemands: DiplomaticDemand[] = [];
  private nextDemandId = 1;

  constructor(@Optional() private readonly spaceBases?: SpaceBaseService) {}

  /*
   * Is `target` a legitimate target because of its Dyson anchors
   * (dyson-anchor.ts)? Checked at the moment of the declaration or breach.
   */
  isDysonCasusBelli(target: Faction): boolean {
    return !!this.spaceBases && dysonAnchorCount(this.spaceBases.bases, target.id) >= DYSON_CASUS_BELLI_ANCHORS;
  }

  /* Waives the surprise-attack penalty for the war just started against a casus belli target. */
  private waiveSurpriseAttack(initiator: Faction, target: Faction): void {
    for (const relation of [getRelation(initiator, target), getRelation(target, initiator)]) {
      if (relation) relation.surpriseRecorded = true;
    }
  }

  reset(): void {
    this.events = [];
    this.offers.clear();
    this.demands = [];
    this.expiredDemands = [];
    this.nextDemandId = 1;
  }

  /*
   * Advances all time-based diplomacy (diplomacy.ts tickDiplomacyTime) and
   * expires offers. `world` lets eliminated factions stop accruing
   * exhaustion and drift; without it every faction counts as alive.
   */
  tick(deltaSeconds: number, factions: Faction[], world?: Pick<TreatyWorld, 'starSystems' | 'fleets'>): void {
    if (deltaSeconds <= 0) return;
    const alive = world ? (id: string) => isFactionAlive(id, world) : undefined;
    for (const honored of tickDiplomacyTime(factions, deltaSeconds, alive)) {
      this.events.push({ kind: 'honored', initiatorId: honored.aId, targetId: honored.bId });
    }
    for (const [id, offer] of this.offers) {
      offer.secondsLeft -= deltaSeconds;
      if (offer.secondsLeft <= 0) this.offers.delete(id);
    }
    this.tickDemands(deltaSeconds, factions, alive);
  }

  canDeclareWar(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
    // Nobody declares war on an empire it has not met (docs/first-contact.md).
    if (!inContact(a, b)) return { ok: false, reason: 'no_contact' };
    if (relation.state === 'war') return { ok: false, reason: 'already' };
    if (isTruceActive(a, b)) return { ok: false, reason: 'truce', waitSeconds: relation.lockRemaining };
    return { ok: true };
  }

  canBreakTreaty(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
    if (!isTruceActive(a, b)) return { ok: false, reason: 'not_in_truce' };
    return { ok: true };
  }

  /* Can the two sides negotiate an end to their war right now? */
  canNegotiate(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
    if (relation.state !== 'war') return { ok: false, reason: 'already' };
    if (relation.lockRemaining > 0) return { ok: false, reason: 'locked', waitSeconds: relation.lockRemaining };
    return { ok: true };
  }

  declareWar(initiator: Faction, target: Faction): DiplomacyResult {
    const check = this.canDeclareWar(initiator, target);
    if (!check.ok) return check;
    const casusBelli = this.isDysonCasusBelli(target);
    startWar(initiator, target, WAR_MIN_DURATION_SECONDS, initiator.id);
    if (casusBelli) this.waiveSurpriseAttack(initiator, target);
    else adjustReputation(initiator, REPUTATION_WAR_DECLARED);
    adjustOpinion(target, initiator, OPINION_WAR_DECLARED);
    this.afterTreatyChange(initiator.id, target.id);
    this.events.push({ kind: 'war', initiatorId: initiator.id, targetId: target.id, dysonCasusBelli: casusBelli || undefined });
    return { ok: true };
  }

  /* Ends a running truce with war: treachery, judged harshly by everyone (via reputation). */
  breakTreaty(initiator: Faction, target: Faction): DiplomacyResult {
    const check = this.canBreakTreaty(initiator, target);
    if (!check.ok) return check;
    const casusBelli = this.isDysonCasusBelli(target);
    startWar(initiator, target, WAR_MIN_DURATION_SECONDS, initiator.id);
    if (casusBelli) this.waiveSurpriseAttack(initiator, target);
    else adjustReputation(initiator, REPUTATION_TREATY_BROKEN);
    adjustOpinion(target, initiator, OPINION_TREATY_BROKEN);
    this.afterTreatyChange(initiator.id, target.id);
    this.events.push({ kind: 'breach', initiatorId: initiator.id, targetId: target.id, dysonCasusBelli: casusBelli || undefined });
    return { ok: true };
  }

  /*
   * Executes an agreed peace treaty atomically. The caller has established
   * that both sides agree (player choice and/or AI evaluation); this only
   * checks feasibility, then applies everything.
   */
  executeTreaty(world: TreatyWorld & { production?: FactionProduction[] }, treaty: PeaceTreaty): TreatyExecution {
    const validation = validateTreaty(treaty, world);
    if (!validation.ok) return { ok: false, validation };
    const proposer = world.factions.find((f) => f.id === treaty.proposerId)!;
    const recipient = world.factions.find((f) => f.id === treaty.recipientId)!;

    // Validation guarantees each giver covers its own total, so neither
    // transfer can fail (the two directions touch different stockpiles).
    for (const giver of [proposer, recipient]) {
      const receiver = giver === proposer ? recipient : proposer;
      transferResources(giver, receiver, {
        credits: resourceTotal(treaty, giver.id, 'credits'),
        rawmaterials: resourceTotal(treaty, giver.id, 'rawmaterials'),
      });
    }
    startPeace(proposer, recipient, TRUCE_SECONDS);
    adjustOpinion(proposer, recipient, OPINION_PEACE_SIGNED);
    adjustOpinion(recipient, proposer, OPINION_PEACE_SIGNED);
    this.afterTreatyChange(proposer.id, recipient.id);
    this.events.push({ kind: 'peace', initiatorId: proposer.id, targetId: recipient.id, treaty });
    return { ok: true, validation };
  }

  /* ---------- Credit demands (diplomatic-demand.ts) ---------- */

  /**
   * Can `demander` make this demand of `target` now? Checks the shared
   * feasibility rule (validateDemand; pass MIN_DEMAND_CREDITS as `amount`
   * to ask whether any demand is possible), the demander's global and
   * per-pair cooldowns, that no other demand between the two is open, and
   * the cap on demands waiting for the human.
   */
  canIssueDemand(demander: Faction, target: Faction, kind: DemandKind, amount: number, world: TreatyWorld, options?: DemandOptions): DemandResult {
    if (!inContact(demander, target)) return { ok: false, reason: 'no_contact' };
    const validation = validateDemand({ kind, demanderId: demander.id, targetId: target.id, amount }, world);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const wait = options?.ignoreCooldowns ? 0 : Math.max(demander.demandCooldown ?? 0, getDemandCooldown(demander, target));
    if (wait > 0) return { ok: false, reason: 'cooldown', waitSeconds: wait };
    if (this.hasOpenDemand(demander.id, target.id)) return { ok: false, reason: 'open_demand' };
    if (target.ai !== true && this.getPendingDemandsFor(target.id).length >= MAX_PENDING_PLAYER_DEMANDS) {
      return { ok: false, reason: 'player_queue_full' };
    }
    return { ok: true };
  }

  /**
   * Makes a demand: starts the demander's cooldowns (`globalCooldown` for
   * demands to anyone, DEMAND_PAIR_COOLDOWN_SECONDS for this target),
   * applies the target's opinion loss (kind rule plus a nuisance penalty
   * per earlier demand it still remembers) and emits a 'demand' event.
   * The returned demand is not stored: an AI target answers at once; a
   * demand to the human is stored with addPendingDemand.
   */
  issueDemand(demander: Faction, target: Faction, kind: DemandKind, amount: number, world: TreatyWorld, globalCooldown: number, options?: DemandOptions): DemandResult {
    const check = this.canIssueDemand(demander, target, kind, amount, world, options);
    if (!check.ok) return check;
    const demand: DiplomaticDemand = {
      id: this.nextDemandId++,
      kind,
      demanderId: demander.id,
      targetId: target.id,
      amount,
      stage: 'pending',
      secondsLeft: DEMAND_RESPONSE_SECONDS,
    };
    const remembered = recordDemandMade(demander, target, DEMAND_PAIR_COOLDOWN_SECONDS, globalCooldown);
    adjustOpinion(target, demander, DEMAND_RULES[kind].issueOpinion + DEMAND_NUISANCE_OPINION * remembered);
    this.events.push({ kind: 'demand', initiatorId: demander.id, targetId: target.id, demand: { ...demand } });
    return { ok: true, demand };
  }

  /** Stores a demand to the human so it waits (saved) for an answer. */
  addPendingDemand(demand: DiplomaticDemand): void {
    this.removeDemand(demand.id);
    this.demands.push({ ...demand, stage: 'pending', secondsLeft: DEMAND_RESPONSE_SECONDS });
  }

  /**
   * The target pays. One transaction: the demand is re-validated (still at
   * peace, the target still holds the credits), then the credits move and
   * the small opinion effects apply. Nothing changes on failure, and a
   * stored demand then stays open (the human may still decline it). Never
   * touches treaty state or any other open offer or demand.
   */
  acceptDemand(demand: DiplomaticDemand, world: TreatyWorld): DemandResult {
    const validation = validateDemand(demand, world);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    const demander = world.factions.find((f) => f.id === demand.demanderId)!;
    const target = world.factions.find((f) => f.id === demand.targetId)!;
    if (!transferResources(target, demander, { credits: demand.amount })) return { ok: false, reason: 'insufficient_credits' };
    this.removeDemand(demand.id);
    const rules = DEMAND_RULES[demand.kind];
    adjustOpinion(demander, target, rules.paidOpinionDemander);
    adjustOpinion(target, demander, rules.paidOpinionPayer);
    this.events.push({ kind: 'demand_paid', initiatorId: demand.demanderId, targetId: demand.targetId, demand: { ...demand } });
    return { ok: true };
  }

  /**
   * The target refuses: the demander remembers it and its opinion of the
   * target drops (kind rule × `refusalTolerance`, the AI personality's
   * multiplier; 1 for the human); the target resents the pressure a
   * little. A threat's follow-through is decided separately
   * (carryOutThreat / backDown / startFollowThrough).
   */
  refuseDemand(demand: DiplomaticDemand, factions: Faction[], refusalTolerance = 1): DemandResult {
    this.removeDemand(demand.id);
    const demander = factions.find((f) => f.id === demand.demanderId);
    const target = factions.find((f) => f.id === demand.targetId);
    if (!demander || !target) return { ok: false, reason: 'unknown_faction' };
    const rules = DEMAND_RULES[demand.kind];
    recordDemandRefused(demander, target);
    adjustOpinion(demander, target, rules.refusalOpinion * refusalTolerance);
    adjustOpinion(target, demander, rules.refusalStrain);
    this.events.push({ kind: 'demand_refused', initiatorId: demand.demanderId, targetId: demand.targetId, demand: { ...demand } });
    return { ok: true };
  }

  /** The human's threat was refused: the human has FOLLOW_THROUGH_SECONDS to declare war or back down. */
  startFollowThrough(demand: DiplomaticDemand): void {
    this.removeDemand(demand.id);
    this.demands.push({ ...demand, stage: 'follow_through', secondsLeft: FOLLOW_THROUGH_SECONDS });
  }

  /**
   * Carries out a refused threat with an ordinary war declaration
   * (declareWar: truce and state checks, reputation and opinion
   * penalties, 'war' event). On success one remembered empty threat is
   * forgiven. Fails without side effects when war cannot be declared.
   */
  carryOutThreat(demand: DiplomaticDemand, factions: Faction[]): DemandResult {
    const demander = factions.find((f) => f.id === demand.demanderId);
    const target = factions.find((f) => f.id === demand.targetId);
    if (!demander || !target || demand.kind !== 'threat') return { ok: false, reason: 'not_found' };
    const war = this.declareWar(demander, target);
    if (!war.ok) return { ok: false, reason: 'war_failed', waitSeconds: war.waitSeconds };
    this.removeDemand(demand.id);
    recordThreatCarriedOut(demander);
    return { ok: true };
  }

  /**
   * A refused threat is not carried out (an AI bluff, or the human backing
   * down): the demander loses reputation and its future threats lose
   * credibility with every empire (Faction.emptyThreats).
   */
  backDown(demand: DiplomaticDemand, factions: Faction[]): DemandResult {
    this.removeDemand(demand.id);
    const demander = factions.find((f) => f.id === demand.demanderId);
    if (!demander) return { ok: false, reason: 'unknown_faction' };
    recordEmptyThreat(demander);
    adjustReputation(demander, REPUTATION_EMPTY_THREAT);
    this.events.push({ kind: 'bluff', initiatorId: demand.demanderId, targetId: demand.targetId, demand: { ...demand } });
    return { ok: true };
  }

  getDemand(id: number): DiplomaticDemand | undefined {
    return this.demands.find((d) => d.id === id);
  }

  /** Open demands in creation order (read-only view). */
  getDemands(): readonly DiplomaticDemand[] {
    return this.demands;
  }

  /** Demands waiting for `targetId`'s answer. */
  getPendingDemandsFor(targetId: string): DiplomaticDemand[] {
    return this.demands.filter((d) => d.stage === 'pending' && d.targetId === targetId);
  }

  /** True while any demand between the two factions (either direction) is open. */
  hasOpenDemand(aId: string, bId: string): boolean {
    return this.demands.some((d) => (d.demanderId === aId && d.targetId === bId) || (d.demanderId === bId && d.targetId === aId));
  }

  /** Pending demands whose answer time ran out since the last call (they count as refused). */
  takeExpiredDemands(): DiplomaticDemand[] {
    const expired = this.expiredDemands;
    this.expiredDemands = [];
    return expired;
  }

  /** Copies of the open demands for the save. */
  serializeDemands(): DiplomaticDemand[] {
    return this.demands.map((d) => ({ ...d }));
  }

  /**
   * Replaces the open demands with the saved ones (sanitized against the
   * loaded factions). Runs after every load, including the reload after a
   * battle, so the save is the single source of truth.
   */
  restoreDemands(raw: unknown, factions: Faction[]): void {
    this.demands = sanitizeDemands(raw, factions);
    this.expiredDemands = [];
    let next = 1;
    for (const demand of this.demands) next = Math.max(next, demand.id + 1);
    this.nextDemandId = next;
  }

  drainEvents(): DiplomacyEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /* ---------- AI peace proposals to the human player ---------- */

  addOffer(treaty: PeaceTreaty): void {
    this.offers.set(treaty.proposerId, { treaty, secondsLeft: PEACE_OFFER_SECONDS });
  }

  getOffer(fromAiId: string): PeaceProposal | undefined {
    return this.offers.get(fromAiId);
  }

  hasOffer(fromAiId: string): boolean {
    return this.offers.has(fromAiId);
  }

  getOfferIds(): string[] {
    return [...this.offers.keys()];
  }

  removeOffer(fromAiId: string): void {
    this.offers.delete(fromAiId);
  }

  isTreatyPair(a: Faction, b: Faction): boolean {
    return isTreatyPair(a, b);
  }

  /*
   * Any treaty change between the two voids an open offer or demand
   * between them (demands only exist at peace). Offers and demands of
   * other pairs are untouched.
   */
  private afterTreatyChange(aId: string, bId: string): void {
    for (const [id, offer] of this.offers) {
      const parties = [offer.treaty.proposerId, offer.treaty.recipientId];
      if (parties.includes(aId) && parties.includes(bId)) this.offers.delete(id);
    }
    this.demands = this.demands.filter((d) => !this.isBetween(d, aId, bId));
  }

  private isBetween(demand: DiplomaticDemand, aId: string, bId: string): boolean {
    return (demand.demanderId === aId && demand.targetId === bId) || (demand.demanderId === bId && demand.targetId === aId);
  }

  private removeDemand(id: number): void {
    this.demands = this.demands.filter((d) => d.id !== id);
  }

  /*
   * Counts demand timers down in game seconds. Demands whose pair is no
   * longer at peace or whose party is gone are dropped silently. An
   * expired 'pending' demand is queued as a refusal for
   * EnemyDiplomacyService (the AI demander decides war or bluff); an
   * expired 'follow_through' means the human backed down.
   */
  private tickDemands(deltaSeconds: number, factions: Faction[], alive?: (id: string) => boolean): void {
    if (this.demands.length === 0) return;
    const kept: DiplomaticDemand[] = [];
    const backedDown: DiplomaticDemand[] = [];
    for (const demand of this.demands) {
      const demander = factions.find((f) => f.id === demand.demanderId);
      const target = factions.find((f) => f.id === demand.targetId);
      if (!demander || !target || getRelation(demander, target)?.state !== 'peace') continue;
      if (alive && (!alive(demander.id) || !alive(target.id))) continue;
      demand.secondsLeft -= deltaSeconds;
      if (demand.secondsLeft > 0) kept.push(demand);
      else if (demand.stage === 'pending') this.expiredDemands.push(demand);
      else backedDown.push(demand);
    }
    this.demands = kept;
    for (const demand of backedDown) this.backDown(demand, factions);
  }
}

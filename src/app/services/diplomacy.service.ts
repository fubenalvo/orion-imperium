import { Injectable } from '@angular/core';
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
  getRelation,
  isTreatyPair,
  isTruceActive,
  startPeace,
  startWar,
  tickDiplomacyTime,
} from '../components/star-map/diplomacy';
import {
  PeaceTreaty,
  TreatyValidation,
  TreatyWorld,
  isFactionAlive,
  resourceTotal,
  validateTreaty,
} from '../components/star-map/peace-treaty';

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
 *  - executeTreaty: ends a war with a peace treaty. All-or-nothing: the
 *    terms are re-validated first and only then are resources moved,
 *    peace and the truce started and exhaustion reset. Treaties carry
 *    resources only; planets never change owner through diplomacy.
 *
 * Transient state (not saved; AIs re-evaluate within one decision
 * interval after a load): open AI peace proposals to the human player and
 * the event queue StarMap drains for notices. Treaty state, opinion,
 * reputation and exhaustion live on the factions (diplomacy.ts) and are
 * saved with them. reset() runs on every genuine load / new game.
 */

export type DiplomacyFailure = 'invalid' | 'already' | 'locked' | 'truce' | 'not_in_truce';

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

export type DiplomacyEventKind = 'war' | 'breach' | 'peace' | 'honored';

export interface DiplomacyEvent {
  kind: DiplomacyEventKind;
  initiatorId: string;
  targetId: string;
  /* Peace: the executed terms (for notices). */
  treaty?: PeaceTreaty;
}

export interface PeaceProposal {
  treaty: PeaceTreaty;
  secondsLeft: number;
}

/* How long an AI peace proposal to the player stays open (game seconds). */
export const PEACE_OFFER_SECONDS = 90;

@Injectable({ providedIn: 'root' })
export class DiplomacyService {
  private events: DiplomacyEvent[] = [];
  /* AI faction id → its open peace proposal to the human player. */
  private offers = new Map<string, PeaceProposal>();


  reset(): void {
    this.events = [];
    this.offers.clear();
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
  }

  canDeclareWar(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
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
    startWar(initiator, target, WAR_MIN_DURATION_SECONDS, initiator.id);
    adjustReputation(initiator, REPUTATION_WAR_DECLARED);
    adjustOpinion(target, initiator, OPINION_WAR_DECLARED);
    this.afterTreatyChange(initiator.id, target.id);
    this.events.push({ kind: 'war', initiatorId: initiator.id, targetId: target.id });
    return { ok: true };
  }

  /* Ends a running truce with war: treachery, judged harshly by everyone (via reputation). */
  breakTreaty(initiator: Faction, target: Faction): DiplomacyResult {
    const check = this.canBreakTreaty(initiator, target);
    if (!check.ok) return check;
    startWar(initiator, target, WAR_MIN_DURATION_SECONDS, initiator.id);
    adjustReputation(initiator, REPUTATION_TREATY_BROKEN);
    adjustOpinion(target, initiator, OPINION_TREATY_BROKEN);
    this.afterTreatyChange(initiator.id, target.id);
    this.events.push({ kind: 'breach', initiatorId: initiator.id, targetId: target.id });
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

    // Validation guarantees every amount is covered, so no step below can fail.
    for (const giver of [proposer, recipient]) {
      const receiver = giver === proposer ? recipient : proposer;
      for (const kind of ['credits', 'rawmaterials'] as const) {
        const amount = resourceTotal(treaty, giver.id, kind);
        if (amount <= 0) continue;
        giver.currencies[kind] = (giver.currencies[kind] ?? 0) - amount;
        receiver.currencies[kind] = (receiver.currencies[kind] ?? 0) + amount;
      }
    }
    startPeace(proposer, recipient, TRUCE_SECONDS);
    adjustOpinion(proposer, recipient, OPINION_PEACE_SIGNED);
    adjustOpinion(recipient, proposer, OPINION_PEACE_SIGNED);
    this.afterTreatyChange(proposer.id, recipient.id);
    this.events.push({ kind: 'peace', initiatorId: proposer.id, targetId: recipient.id, treaty });
    return { ok: true, validation };
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

  /* Any treaty change between the two voids an open offer between them. */
  private afterTreatyChange(aId: string, bId: string): void {
    for (const [id, offer] of this.offers) {
      const parties = [offer.treaty.proposerId, offer.treaty.recipientId];
      if (parties.includes(aId) && parties.includes(bId)) this.offers.delete(id);
    }
  }
}

import { Injectable } from '@angular/core';
import { Faction } from '../components/star-map/star-map.models';
import {
  PEACE_MIN_DURATION_SECONDS,
  WAR_MIN_DURATION_SECONDS,
  getRelation,
  isTreatyPair,
  setTreatyState,
  tickRelationLocks,
} from '../components/star-map/diplomacy';

/*
 * =========================================================
 * DIPLOMACY SERVICE
 * =========================================================
 *
 * Applies treaty changes (declare war, sign peace) for the player and the
 * AI with the same rules, and keeps the transient diplomatic state that is
 * not part of the save:
 *  - pending AI peace offers to the human player (expire after
 *    PEACE_OFFER_SECONDS; a refused or expired offer starts the AI's
 *    offer cooldown in EnemyDiplomacyService);
 *  - the cooldown after an AI refused the player's peace proposal, so the
 *    player cannot spam proposals until the AI happens to accept;
 *  - the event queue StarMap drains to show treaty notices.
 *
 * Treaty state itself lives on the factions (`Faction.relations`, see
 * diplomacy.ts) and is saved with them. Losing offers, cooldowns and
 * events on load is harmless: the AI re-evaluates within one decision
 * interval. reset() clears them on every genuine load / new game.
 */

export type DiplomacyFailure = 'invalid' | 'already' | 'locked' | 'refused' | 'cooldown';

export interface DiplomacyResult {
  ok: boolean;
  reason?: DiplomacyFailure;
  /* Seconds until the action becomes possible (locked / cooldown). */
  waitSeconds?: number;
}

export interface DiplomacyEvent {
  kind: 'war' | 'peace';
  initiatorId: string;
  targetId: string;
}

const PLAYER_ID = 'player';

/* How long an AI peace offer to the player stays open (game seconds). */
export const PEACE_OFFER_SECONDS = 60;
/* After an AI refuses the player's proposal, the next one waits this long. */
export const PROPOSAL_REFUSAL_COOLDOWN_SECONDS = 45;

@Injectable({ providedIn: 'root' })
export class DiplomacyService {
  private events: DiplomacyEvent[] = [];
  /* AI faction id → seconds left on its peace offer to the player. */
  private offers = new Map<string, number>();
  /* AI faction id → seconds until the player may propose peace again. */
  private refusalCooldowns = new Map<string, number>();

  reset(): void {
    this.events = [];
    this.offers.clear();
    this.refusalCooldowns.clear();
  }

  /* Counts down treaty locks, offers and cooldowns by scaled game time. */
  tick(deltaSeconds: number, factions: Faction[]): void {
    if (deltaSeconds <= 0) return;
    tickRelationLocks(factions, deltaSeconds);
    for (const [id, left] of this.offers) {
      const next = left - deltaSeconds;
      if (next <= 0) this.offers.delete(id);
      else this.offers.set(id, next);
    }
    for (const [id, left] of this.refusalCooldowns) {
      const next = left - deltaSeconds;
      if (next <= 0) this.refusalCooldowns.delete(id);
      else this.refusalCooldowns.set(id, next);
    }
  }

  canDeclareWar(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
    if (relation.state === 'war') return { ok: false, reason: 'already' };
    if (relation.lockRemaining > 0) return { ok: false, reason: 'locked', waitSeconds: relation.lockRemaining };
    return { ok: true };
  }

  canSignPeace(a: Faction, b: Faction): DiplomacyResult {
    const relation = getRelation(a, b);
    if (!relation) return { ok: false, reason: 'invalid' };
    if (relation.state === 'peace') return { ok: false, reason: 'already' };
    if (relation.lockRemaining > 0) return { ok: false, reason: 'locked', waitSeconds: relation.lockRemaining };
    return { ok: true };
  }

  declareWar(initiator: Faction, target: Faction): DiplomacyResult {
    const check = this.canDeclareWar(initiator, target);
    if (!check.ok) return check;
    setTreatyState(initiator, target, 'war', WAR_MIN_DURATION_SECONDS);
    this.clearPair(initiator.id, target.id);
    this.events.push({ kind: 'war', initiatorId: initiator.id, targetId: target.id });
    return { ok: true };
  }

  /* Signs peace; the caller has already established that both sides agree. */
  signPeace(initiator: Faction, target: Faction): DiplomacyResult {
    const check = this.canSignPeace(initiator, target);
    if (!check.ok) return check;
    setTreatyState(initiator, target, 'peace', PEACE_MIN_DURATION_SECONDS);
    this.clearPair(initiator.id, target.id);
    this.events.push({ kind: 'peace', initiatorId: initiator.id, targetId: target.id });
    return { ok: true };
  }

  drainEvents(): DiplomacyEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /* ---------- AI peace offers to the player ---------- */

  addOffer(fromAiId: string): void {
    this.offers.set(fromAiId, PEACE_OFFER_SECONDS);
  }

  hasOffer(fromAiId: string): boolean {
    return this.offers.has(fromAiId);
  }

  getOfferSecondsLeft(fromAiId: string): number {
    return this.offers.get(fromAiId) ?? 0;
  }

  getOfferIds(): string[] {
    return [...this.offers.keys()];
  }

  removeOffer(fromAiId: string): void {
    this.offers.delete(fromAiId);
  }

  /* ---------- Player proposals ---------- */

  getRefusalCooldown(aiId: string): number {
    return this.refusalCooldowns.get(aiId) ?? 0;
  }

  startRefusalCooldown(aiId: string): void {
    this.refusalCooldowns.set(aiId, PROPOSAL_REFUSAL_COOLDOWN_SECONDS);
  }

  /*
   * A treaty change between the player and an AI voids that AI's pending
   * offer and the player's proposal cooldown with it. Offers and cooldowns
   * only exist toward the human player, so AI–AI changes touch nothing.
   */
  private clearPair(aId: string, bId: string): void {
    const other = aId === PLAYER_ID ? bId : bId === PLAYER_ID ? aId : null;
    if (other) {
      this.offers.delete(other);
      this.refusalCooldowns.delete(other);
    }
  }

  isTreatyPair(a: Faction, b: Faction): boolean {
    return isTreatyPair(a, b);
  }
}

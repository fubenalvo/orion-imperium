import { AiPersonality, Faction } from './star-map.models';
import { getRelation, isTreatyPair, isTruceActive } from './diplomacy';
import { TreatyWorld, isFactionAlive } from './peace-treaty';
import { availableResource } from './resource-transfer';

/*
 * =========================================================
 * DIPLOMATIC DEMANDS — model, rules and validation
 * =========================================================
 *
 * A peace-time credit demand from one empire (the demander) to another
 * (the target). Player and AI use the same model, rules and code paths
 * (docs/diplomacy.md, "Financial demands and ultimatums"):
 *
 *  - 'request' — asks for financial support; refusal sours relations a little.
 *  - 'tribute' — power politics: the stronger side expects payment; no
 *                explicit war threat, but a refusal angers the demander.
 *  - 'threat'  — an ultimatum: pay or face war. On refusal the demander
 *                decides whether to carry it out (a normal war declaration
 *                through DiplomacyService) or to back down (a bluff that
 *                costs reputation and future credibility).
 *
 * Demands exist only between treaty partners at peace (at war the peace
 * negotiation covers payments) and only carry credits. A threat cannot be
 * made during a truce, because carrying it out would need a treaty breach.
 *
 * Lifecycle: an AI target answers at once (no stored state). A demand to
 * the human player waits as 'pending' until answered or expired (expiry
 * counts as a refusal). When an AI refuses the player's threat, the
 * player gets a 'follow_through' entry to declare war or back down
 * (expiry counts as backing down). Both kinds of open entries are saved
 * (StarMapData.diplomaticDemands), so reloading never undoes a decision.
 *
 * This module is pure: rules and checks only. DiplomacyService applies
 * demands; EnemyDiplomacyService makes the AI's choices.
 */

/** The three kinds of credit demand, from mildest to harshest. */
export type DemandKind = 'request' | 'tribute' | 'threat';

/**
 * 'pending': waiting for the target's answer (only demands to the human).
 * 'follow_through': the target refused the human's threat; the human must
 * declare war or back down.
 */
export type DemandStage = 'pending' | 'follow_through';

/** One open demand. Saved with the game while it waits for a decision. */
export interface DiplomaticDemand {
  /** Unique within a game session; restored ids are kept. */
  id: number;
  kind: DemandKind;
  demanderId: string;
  targetId: string;
  /** Credits demanded: a whole number ≥ MIN_DEMAND_CREDITS. */
  amount: number;
  stage: DemandStage;
  /** Game seconds left for the current stage's decision. */
  secondsLeft: number;
}

/** Opinion effects of one demand kind (docs/diplomacy.md). */
export interface DemandKindRules {
  label: string;
  /** Target's opinion of the demander when the demand is made. */
  issueOpinion: number;
  /** Demander's opinion of the target on refusal (× the AI's refusal tolerance). */
  refusalOpinion: number;
  /** Target's opinion of the demander on refusal: the strain of having been pressured. */
  refusalStrain: number;
  /** Demander's opinion of the payer after payment (deliberately small). */
  paidOpinionDemander: number;
  /** Payer's opinion of the demander after payment (paying under pressure stings). */
  paidOpinionPayer: number;
  /** AI demand size: × the demander's economic scale × its personality's demand share. */
  amountMultiplier: number;
}

export const DEMAND_RULES: Readonly<Record<DemandKind, DemandKindRules>> = {
  request: { label: 'Financial request', issueOpinion: 0, refusalOpinion: -6, refusalStrain: -1, paidOpinionDemander: 4, paidOpinionPayer: 0, amountMultiplier: 0.4 },
  tribute: { label: 'Tribute demand', issueOpinion: -4, refusalOpinion: -12, refusalStrain: -3, paidOpinionDemander: 2, paidOpinionPayer: -3, amountMultiplier: 0.8 },
  threat: { label: 'Ultimatum', issueOpinion: -8, refusalOpinion: -20, refusalStrain: -5, paidOpinionDemander: 2, paidOpinionPayer: -6, amountMultiplier: 1.2 },
};

export const DEMAND_KINDS: readonly DemandKind[] = ['request', 'tribute', 'threat'];

/** Smallest demand worth making (credits). */
export const MIN_DEMAND_CREDITS = 100;
/** Game seconds the human has to answer an AI demand (2 minutes). */
export const DEMAND_RESPONSE_SECONDS = 120;
/** Game seconds the human has to carry out a refused threat before it counts as backing down. */
export const FOLLOW_THROUGH_SECONDS = 60;
/** At most this many AI demands wait for the human at once (no notice spam). */
export const MAX_PENDING_PLAYER_DEMANDS = 2;
/** After any demand from A to B, A may not demand from B again for this long (game seconds). */
export const DEMAND_PAIR_COOLDOWN_SECONDS = 600;
/** The human's own cooldown between demands to anyone (AIs use their personality's value). */
export const PLAYER_DEMAND_COOLDOWN_SECONDS = 180;
/** An AI never asks for more than this share of the target's current credits. */
export const MAX_DEMAND_TARGET_SHARE = 0.5;
/** An AI never pays more than this share of its current credits, even above its reserve. */
export const MAX_PAYMENT_SHARE = 0.6;
/** Extra opinion loss per demand the target still remembers from the same demander. */
export const DEMAND_NUISANCE_OPINION = -3;
/** Reputation lost when a refused threat is not carried out. */
export const REPUTATION_EMPTY_THREAT = -3;
// Memory decay rates and the empty-threat cap live in diplomacy.ts, which
// owns the per-relation and per-faction values and ticks them.

export type DemandInvalidReason =
  | 'unknown_faction'
  | 'not_at_peace'
  | 'eliminated'
  | 'truce'
  | 'invalid_amount'
  | 'insufficient_credits';

/** Result of validateDemand; `ok` false carries the first failed rule. */
export interface DemandValidation {
  ok: boolean;
  reason?: DemandInvalidReason;
}

/**
 * The feasibility rule shared by issuing, answering and paying: two living
 * treaty partners at peace, a whole amount ≥ MIN_DEMAND_CREDITS that the
 * target holds now, and no threat during a truce.
 */
export function validateDemand(
  demand: Pick<DiplomaticDemand, 'kind' | 'demanderId' | 'targetId' | 'amount'>,
  world: TreatyWorld,
): DemandValidation {
  const demander = world.factions.find((f) => f.id === demand.demanderId);
  const target = world.factions.find((f) => f.id === demand.targetId);
  if (!demander || !target || !isTreatyPair(demander, target)) return { ok: false, reason: 'unknown_faction' };
  if (getRelation(demander, target)?.state !== 'peace') return { ok: false, reason: 'not_at_peace' };
  if (!isFactionAlive(demander.id, world) || !isFactionAlive(target.id, world)) return { ok: false, reason: 'eliminated' };
  if (demand.kind === 'threat' && isTruceActive(demander, target)) return { ok: false, reason: 'truce' };
  if (!Number.isInteger(demand.amount) || demand.amount < MIN_DEMAND_CREDITS) return { ok: false, reason: 'invalid_amount' };
  if (demand.amount > availableResource(target, 'credits')) return { ok: false, reason: 'insufficient_credits' };
  return { ok: true };
}

/** Player-facing explanation of a validation failure. */
export function describeDemandInvalid(reason: DemandInvalidReason | undefined): string {
  switch (reason) {
    case 'not_at_peace': return 'Demands are only possible at peace; at war, negotiate peace terms instead.';
    case 'eliminated': return 'This empire no longer exists.';
    case 'truce': return 'No ultimatum during a truce: it could only be enforced by breaking the treaty.';
    case 'invalid_amount': return `Demands must be whole amounts of at least ${MIN_DEMAND_CREDITS} credits.`;
    case 'insufficient_credits': return 'They do not hold that many credits.';
    default: return 'This demand is not possible.';
  }
}

/** Rounds a credit amount down to a multiple of 10 (demands read as round numbers). */
export function roundDemandAmount(value: number): number {
  return Math.max(0, Math.floor(value / 10) * 10);
}

/* ---------- Flavor text (tone follows the demander's personality) ---------- */

type Voice = AiPersonality | 'human';

const DEMAND_LINES: Readonly<Record<DemandKind, Readonly<Record<Voice, string>>>> = {
  threat: {
    militarist: 'Pay us {amount} credits, or face the consequences.',
    expansionist: 'Your borders press on ours. {amount} credits will keep our fleets at home.',
    balanced: 'We expect {amount} credits as compensation for maintaining peace between our empires.',
    technologist: 'Our analysts advise caution on your part. Transfer {amount} credits, or we will be forced to act.',
    human: 'Pay {amount} credits, or we declare war.',
  },
  tribute: {
    militarist: 'Your empire has become too prosperous. We demand tribute: {amount} credits.',
    expansionist: 'The strong set the terms. We expect a tribute of {amount} credits.',
    balanced: 'Recognize the balance of power between us: {amount} credits in tribute.',
    technologist: 'A contribution of {amount} credits would acknowledge our position.',
    human: 'We expect a tribute of {amount} credits.',
  },
  request: {
    militarist: 'Our war chest runs thin. Send {amount} credits.',
    expansionist: 'Our new colonies need funding. We request {amount} credits.',
    balanced: 'Our economy is struggling. We request financial assistance: {amount} credits.',
    technologist: 'We would appreciate a contribution of {amount} credits to strengthen our relationship.',
    human: 'We request financial assistance: {amount} credits.',
  },
};

/** The demand as the demander's envoy words it. */
export function demandMessage(kind: DemandKind, voice: Voice, amount: number): string {
  return DEMAND_LINES[kind][voice].replace('{amount}', amount.toLocaleString('en-US'));
}

/* ---------- Persistence ---------- */

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Turns saved demands back into live ones: malformed entries, unknown
 * factions and pairs no longer at peace are dropped; timers are clamped to
 * their stage's limit. Never throws on malformed input.
 */
export function sanitizeDemands(raw: unknown, factions: Faction[]): DiplomaticDemand[] {
  if (!Array.isArray(raw)) return [];
  const result: DiplomaticDemand[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const d = entry as Partial<DiplomaticDemand>;
    if (!isNumber(d.id) || seen.has(d.id)) continue;
    if (d.kind !== 'request' && d.kind !== 'tribute' && d.kind !== 'threat') continue;
    if (d.stage !== 'pending' && d.stage !== 'follow_through') continue;
    if (d.stage === 'follow_through' && d.kind !== 'threat') continue;
    if (!isNumber(d.amount) || !Number.isInteger(d.amount) || d.amount < MIN_DEMAND_CREDITS) continue;
    const demander = factions.find((f) => f.id === d.demanderId);
    const target = factions.find((f) => f.id === d.targetId);
    if (!demander || !target || !isTreatyPair(demander, target)) continue;
    if (getRelation(demander, target)?.state !== 'peace') continue;
    const limit = d.stage === 'pending' ? DEMAND_RESPONSE_SECONDS : FOLLOW_THROUGH_SECONDS;
    const secondsLeft = isNumber(d.secondsLeft) ? Math.min(limit, Math.max(0, d.secondsLeft)) : limit;
    if (secondsLeft <= 0) continue;
    seen.add(d.id);
    result.push({ id: d.id, kind: d.kind, demanderId: demander.id, targetId: target.id, amount: d.amount, stage: d.stage, secondsLeft });
  }
  return result;
}

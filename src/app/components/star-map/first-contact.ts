import { Faction } from './star-map.models';
import { CONTACT_POOLS, ContactPool, ContactQuestion, SIGNATURE_QUESTIONS } from './contact-dialogue';

/*
 * =========================================================
 * FIRST CONTACT (pure rules)
 * =========================================================
 *
 * docs/first-contact.md. When two empires meet, the "asker" (the empire the
 * other one meets; for AI–AI contacts the first of the pair in faction
 * order) asks two questions from its temperament's pool; the replies, a
 * closing stance, an optional gift, the strength ratio and the distance
 * between the empires give a disposition, and the disposition gives the
 * starting relation. Everything is deterministic: questions, reply order
 * and the warlike roll come from the galaxy seed and the pair's ids.
 */

export type ContactStance = 'welcome' | 'cautious' | 'warning';
export type ContactOutcome = 'peace' | 'cold_peace' | 'war';

export const CONTACT_GIFT_TIERS = [0, 300, 800, 2000] as const;
/* Ratio (met empire / asker) from which the met empire counts as stronger for the Warning stance. */
export const CONTACT_STRONGER_RATIO = 1.25;
/* Disposition at which a warlike asker may accept peace at all, and the roll's cap. */
export const WARLIKE_PEACE_THRESHOLD = 10;
export const WARLIKE_PEACE_MAX_CHANCE = 0.2;
const PEACE_OPINION_CAP = 40;
const PROXIMITY_PENALTY = 10;
const STRENGTH_CLAMP = 15;

interface TemperamentTable {
  base: number;
  stance: Record<'welcome' | 'cautious', number> & { warning: number; warningStronger: number };
  gift: [number, number, number];
  warlike: boolean;
}

/* The evaluation table of docs/first-contact.md. */
const TEMPERAMENTS: Readonly<Record<string, TemperamentTable>> = {
  technologist: { base: 20, stance: { welcome: 15, cautious: 0, warning: -20, warningStronger: -20 }, gift: [4, 8, 12], warlike: false },
  balanced: { base: 5, stance: { welcome: 15, cautious: 0, warning: -20, warningStronger: -20 }, gift: [4, 8, 12], warlike: false },
  mercantile: { base: 25, stance: { welcome: 15, cautious: 0, warning: -25, warningStronger: -25 }, gift: [5, 10, 15], warlike: false },
  guardian: { base: 0, stance: { welcome: 10, cautious: 5, warning: -25, warningStronger: -25 }, gift: [2, 4, 6], warlike: false },
  expansionist: { base: -25, stance: { welcome: -5, cautious: 0, warning: -20, warningStronger: 5 }, gift: [2, 4, 6], warlike: true },
  militarist: { base: -35, stance: { welcome: -5, cautious: 0, warning: -20, warningStronger: 5 }, gift: [2, 4, 6], warlike: true },
};

/* The temperament an empire speaks and judges with: its AI personality (balanced otherwise). */
export function temperamentOf(faction: Faction): string {
  const personality = faction.ai === true ? faction.aiPersonality : undefined;
  return personality && personality in TEMPERAMENTS ? personality : 'balanced';
}

export function isWarlikeTemperament(temperament: string): boolean {
  return TEMPERAMENTS[temperament]?.warlike === true;
}

export function contactPool(temperament: string): ContactPool {
  return CONTACT_POOLS[temperament] ?? CONTACT_POOLS['balanced'];
}

/* A deterministic number in [0, 1) from the seed, the pair and a salt (FNV-1a). */
export function seededUnit(seed: number, aId: string, bId: string, salt: string): number {
  const [first, second] = [aId, bId].sort();
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (const ch of `${first}|${second}|${salt}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash / 0x100000000;
}

export interface ContactQuestionSet {
  questions: ContactQuestion[];
  /* Per question, the order in which its replies are shown (indices into `replies`). */
  replyOrder: number[][];
}

/*
 * The two questions the asker asks: its signature question first when the
 * asker is a campaign faction that has one, then pool questions by a seeded
 * draw. Reply order is shuffled the same way, so the friendliest answer is
 * not always first.
 */
export function chooseQuestions(asker: Faction, met: Faction, seed: number): ContactQuestionSet {
  const pool = contactPool(temperamentOf(asker));
  const questions: ContactQuestion[] = [];
  const signature = SIGNATURE_QUESTIONS[asker.id];
  if (signature) questions.push(signature);
  const remaining = [...pool.questions];
  let draw = 0;
  while (questions.length < 2 && remaining.length > 0) {
    const index = Math.floor(seededUnit(seed, asker.id, met.id, `question${draw++}`) * remaining.length);
    questions.push(remaining.splice(index, 1)[0]);
  }
  const replyOrder = questions.map((question, qi) => {
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(seededUnit(seed, asker.id, met.id, `order${qi}_${i}`) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  });
  return { questions, replyOrder };
}

export interface ContactInput {
  /* The asker's temperament (it judges the meeting). */
  temperament: string;
  /* Values of the chosen replies (from the asker's questions). */
  replyValues: number[];
  stance: ContactStance;
  /* Index into CONTACT_GIFT_TIERS (0 = no gift). */
  giftTier: number;
  /* Military strength of the met empire / the asker's. */
  strengthRatio: number;
  /* The two empires' territories are within war reach of each other. */
  territoriesClose: boolean;
  /* seededUnit for this pair: the warlike roll. */
  roll: number;
}

export interface ContactResult {
  disposition: number;
  outcome: ContactOutcome;
  /* The asker's opinion of the met empire afterwards (and the reverse). */
  opinion: number;
}

export function evaluateContact(input: ContactInput): ContactResult {
  const table = TEMPERAMENTS[input.temperament] ?? TEMPERAMENTS['balanced'];
  const stronger = input.strengthRatio >= CONTACT_STRONGER_RATIO;
  const stance = input.stance === 'warning'
    ? (stronger ? table.stance.warningStronger : table.stance.warning)
    : table.stance[input.stance];
  const gift = input.giftTier > 0 ? table.gift[Math.min(input.giftTier, 3) - 1] : 0;
  const rawStrength = 10 * Math.log2(Math.max(1e-6, input.strengthRatio));
  const strength = Math.max(-STRENGTH_CLAMP, Math.min(STRENGTH_CLAMP, rawStrength)) * (table.warlike ? 1 : 0.5);
  const disposition = table.base
    + input.replyValues.reduce((sum, v) => sum + v, 0)
    + stance + gift + strength
    - (input.territoriesClose ? PROXIMITY_PENALTY : 0);

  if (!table.warlike) {
    if (disposition >= 0) return { disposition, outcome: 'peace', opinion: Math.min(PEACE_OPINION_CAP, disposition) };
    if (disposition >= -25) return { disposition, outcome: 'cold_peace', opinion: disposition };
    return { disposition, outcome: 'war', opinion: disposition };
  }
  if (disposition < WARLIKE_PEACE_THRESHOLD) return { disposition, outcome: 'war', opinion: Math.min(0, disposition) };
  const chance = Math.min(WARLIKE_PEACE_MAX_CHANCE, 0.05 + (disposition - WARLIKE_PEACE_THRESHOLD) / 100);
  return input.roll < chance
    ? { disposition, outcome: 'cold_peace', opinion: Math.min(disposition - WARLIKE_PEACE_THRESHOLD, 10) }
    : { disposition, outcome: 'war', opinion: 0 };
}

/* An AI's stance when it is the met side of an AI–AI contact. */
export function aiStance(temperament: string): ContactStance {
  if (temperament === 'technologist' || temperament === 'mercantile') return 'welcome';
  if (isWarlikeTemperament(temperament)) return 'warning';
  return 'cautious';
}

/* An AI answers in character: warlike temperaments the hard reply, peaceful ones the open reply. */
export function aiReplyIndex(question: ContactQuestion, answererTemperament: string): number {
  const tone = isWarlikeTemperament(answererTemperament) ? 'hard' : 'open';
  const index = question.replies.findIndex((reply) => reply.tone === tone);
  return index >= 0 ? index : 1;
}

export function fillPlaceholders(text: string, empire: string, player: string): string {
  return text.replaceAll('{empire}', empire).replaceAll('{player}', player);
}

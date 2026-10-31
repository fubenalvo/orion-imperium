import { Faction, FactionRelation, TreatyState } from './star-map.models';

export type { FactionRelation, TreatyState } from './star-map.models';

/*
 * =========================================================
 * DIPLOMACY — relations, opinion, reputation, war exhaustion
 * =========================================================
 *
 * The single source of truth for "may these two factions fight?" and for
 * the persistent diplomatic values. Every system that used to compare
 * `Faction.team` directly asks the helpers below. Treaty *actions* (declare
 * war, break a treaty, execute a peace treaty) live in DiplomacyService;
 * AI judgment in EnemyDiplomacyService. Full rules: docs/diplomacy.md.
 *
 * Relation kinds between two factions A and B:
 *  - 'self'    — the same faction;
 *  - 'allied'  — same non-neutral team. Permanent; no treaty can change it.
 *                New games give every participant its own team, so this
 *                only happens on older saves (all AIs on team 2);
 *  - 'neutral' — either side is on team 0 (independent rebels, unhabited).
 *                Neutral fleets never fight; neutral planets can still be
 *                captured by anyone (see canAttackPlanetOf);
 *  - 'war' / 'peace' — a treaty state stored on both factions in
 *                `Faction.relations[otherId]`.
 *
 * Time: the game is real-time. A "diplomatic turn" is
 * DIPLOMACY_TURN_SECONDS of scaled game time; per-turn rates are applied
 * continuously (rate × delta / turn), so there is no partial-turn state to
 * save and everything freezes while paused.
 *
 * Invariants:
 *  - Symmetric fields (state, lockRemaining, truce, warSeconds,
 *    declaredBy, surpriseRecorded) are equal on both sides. Only
 *    startWar / startPeace change the treaty state, and they always write
 *    both sides. Per-side fields (opinion, warExhaustion, shipsLostValue,
 *    planetsLost) belong to the faction holding the entry.
 *  - normalizeRelations (new games, every load) fills missing entries and
 *    defaults, clamps ranges and repairs disagreement as war.
 *  - A missing treaty entry between two treaty participants means war.
 *  - Peace is permanent. `lockRemaining` is the minimum war duration while
 *    at war, and the truce while at peace (`truce` true): no normal war
 *    declaration until it expires; only breakTreaty can end it.
 */

export type RelationKind = 'self' | 'allied' | 'neutral' | TreatyState;

/* One diplomatic turn in game seconds (the game has no real turns). */
export const DIPLOMACY_TURN_SECONDS = 60;
/* Mandatory truce after a peace treaty, in turns / game seconds. */
export const TRUCE_TURNS = 10;
export const TRUCE_SECONDS = TRUCE_TURNS * DIPLOMACY_TURN_SECONDS;
/* A war must last this long (game seconds) before peace can be negotiated. */
export const WAR_MIN_DURATION_SECONDS = DIPLOMACY_TURN_SECONDS;
/*
 * Lock on the starting wars of a new game: nobody can negotiate during the
 * opening, so the first contacts are real conflicts.
 */
export const INITIAL_WAR_LOCK_SECONDS = 4 * DIPLOMACY_TURN_SECONDS;

/* ---------- Opinion (A's view of B, −100…+100) ---------- */
export const OPINION_LIMIT = 100;
/* The victim's opinion of a faction that declares war on it. */
export const OPINION_WAR_DECLARED = -30;
/* The victim's opinion of a faction that breaks a truce. */
export const OPINION_TREATY_BROKEN = -60;
/* Both sides' opinion of each other when peace is signed. */
export const OPINION_PEACE_SIGNED = 10;
/* The loser's opinion of the faction that took one of its planets. */
export const OPINION_PLANET_LOST = -10;
/* Drift per turn: peace slowly builds trust up to a cap, war erodes it down to a floor. */
export const OPINION_PEACE_DRIFT_PER_TURN = 1;
export const OPINION_PEACE_DRIFT_CAP = 60;
export const OPINION_WAR_DRIFT_PER_TURN = -0.5;
export const OPINION_WAR_DRIFT_FLOOR = -50;

/* ---------- Reputation (how trustworthy everyone finds a faction, −100…+100) ---------- */
export const REPUTATION_LIMIT = 100;
export const REPUTATION_WAR_DECLARED = -5;
/* Attacking within SURPRISE_ATTACK_WINDOW_SECONDS of one's own declaration. */
export const REPUTATION_SURPRISE_ATTACK = -15;
export const SURPRISE_ATTACK_WINDOW_SECONDS = DIPLOMACY_TURN_SECONDS;
export const REPUTATION_TREATY_BROKEN = -40;
/* Both sides when a truce runs out without being broken. */
export const REPUTATION_TREATY_HONORED = 5;
/* Per turn while a faction is at war with nobody, up to the cap. */
export const REPUTATION_PEACE_PER_TURN = 0.5;
export const REPUTATION_PEACE_CAP = 50;
/* Weight of the other faction's reputation in an AI's effective opinion. */
export const REPUTATION_OPINION_WEIGHT = 0.5;

/* ---------- War exhaustion (per faction per war, 0…100) ---------- */
export const EXHAUSTION_LIMIT = 100;
export const EXHAUSTION_PER_TURN = 1;
/* Losing the whole fleet value at once adds this much (scaled by the lost share). */
export const EXHAUSTION_FLEET_LOSS_SCALE = 40;
/* Denominator floor so a tiny navy losing one scout is not a catastrophe. */
export const EXHAUSTION_MIN_FLEET_VALUE = 2000;
/* A wiped-out fleet worth at least SEVERE_DEFEAT_MIN_VALUE adds this on top. */
export const EXHAUSTION_SEVERE_DEFEAT = 5;
export const SEVERE_DEFEAT_MIN_VALUE = 1000;
/* Per lost planet: base + population / divisor, capped. */
export const EXHAUSTION_PLANET_BASE = 8;
export const EXHAUSTION_PLANET_POP_DIVISOR = 200;
export const EXHAUSTION_PLANET_MAX = 20;
/* Economy penalty: none up to the threshold, then linear up to the maximum at 100. */
export const EXHAUSTION_PENALTY_THRESHOLD = 25;
export const EXHAUSTION_MAX_PENALTY = 0.3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function isNeutralFaction(faction: Faction): boolean {
  return faction.team === 0;
}

/* True for two different factions that take part in diplomacy (non-neutral, not allied). */
export function isTreatyPair(a: Faction, b: Faction): boolean {
  return a.id !== b.id && !isNeutralFaction(a) && !isNeutralFaction(b) && a.team !== b.team;
}

export function getRelationKind(a: Faction, b: Faction): RelationKind {
  if (a.id === b.id) return 'self';
  if (isNeutralFaction(a) || isNeutralFaction(b)) return 'neutral';
  if (a.team === b.team) return 'allied';
  return a.relations?.[b.id]?.state ?? 'war';
}

/* A's (read-only view of the) relation with B; a default war entry if none is stored. */
export function getRelation(a: Faction, b: Faction): FactionRelation | undefined {
  return isTreatyPair(a, b) ? a.relations?.[b.id] ?? { state: 'war', lockRemaining: 0 } : undefined;
}

/* The stored, mutable entry (created as a default war entry when missing). */
function relationEntry(a: Faction, b: Faction): FactionRelation {
  a.relations = a.relations ?? {};
  const existing = a.relations[b.id];
  if (existing) return existing;
  const created: FactionRelation = { state: 'war', lockRemaining: 0 };
  a.relations[b.id] = created;
  return created;
}

/* Fleets of these factions fight on contact; the one hostility rule. */
export function areFactionsHostile(a: Faction | undefined, b: Faction | undefined): boolean {
  return !!a && !!b && getRelationKind(a, b) === 'war';
}

/* Same faction or a permanent ally (same non-neutral team). */
export function areFactionsAllied(a: Faction | undefined, b: Faction | undefined): boolean {
  if (!a || !b) return false;
  const kind = getRelationKind(a, b);
  return kind === 'self' || kind === 'allied';
}

/*
 * May `attacker` capture or assault a planet owned by `owner`? Neutral
 * owners (independent rebels) are always fair game for a non-neutral
 * attacker; `unhabited` planets are colonized, never captured. Otherwise
 * only at war.
 */
export function canAttackPlanetOf(attacker: Faction | undefined, owner: Faction | undefined): boolean {
  if (!attacker || !owner || owner.id === 'unhabited' || attacker.id === owner.id) return false;
  if (isNeutralFaction(attacker)) return false;
  if (isNeutralFaction(owner)) return true;
  return getRelationKind(attacker, owner) === 'war';
}

/* Ids of the factions `faction` is at war with. */
export function hostileFactionIds(faction: Faction, factions: Faction[]): Set<string> {
  return new Set(factions.filter((other) => areFactionsHostile(faction, other)).map((other) => other.id));
}

/* True while a peace treaty's truce forbids a normal war declaration. */
export function isTruceActive(a: Faction, b: Faction): boolean {
  const relation = getRelation(a, b);
  return !!relation && relation.state === 'peace' && relation.truce === true && relation.lockRemaining > 0;
}

/* ---------- Opinion & reputation ---------- */

/* A's opinion of B (0 when unknown). */
export function getOpinion(a: Faction, b: Faction): number {
  return getRelation(a, b)?.opinion ?? 0;
}

export function adjustOpinion(a: Faction, b: Faction, delta: number): void {
  if (!isTreatyPair(a, b) || delta === 0) return;
  const entry = relationEntry(a, b);
  entry.opinion = clamp((entry.opinion ?? 0) + delta, -OPINION_LIMIT, OPINION_LIMIT);
}

export function getReputation(faction: Faction): number {
  return faction.reputation ?? 0;
}

export function adjustReputation(faction: Faction, delta: number): void {
  if (delta === 0 || isNeutralFaction(faction)) return;
  faction.reputation = clamp((faction.reputation ?? 0) + delta, -REPUTATION_LIMIT, REPUTATION_LIMIT);
}

/*
 * How an AI (or anyone) judges B: A's own opinion of B, shifted by B's
 * reputation with everyone. This is how reputation reaches every faction,
 * not only the one a deed was done to.
 */
export function getEffectiveOpinion(a: Faction, b: Faction): number {
  return clamp(getOpinion(a, b) + REPUTATION_OPINION_WEIGHT * getReputation(b), -OPINION_LIMIT, OPINION_LIMIT);
}

/* ---------- War exhaustion ---------- */

/* A's exhaustion in its war with B (0 at peace). */
export function getWarExhaustion(a: Faction, b: Faction): number {
  const relation = getRelation(a, b);
  return relation?.state === 'war' ? relation.warExhaustion ?? 0 : 0;
}

/* The faction's worst exhaustion over all its wars (drives the economy penalty). */
export function getFactionWarExhaustion(faction: Faction): number {
  let worst = 0;
  for (const relation of Object.values(faction.relations ?? {})) {
    if (relation.state === 'war') worst = Math.max(worst, relation.warExhaustion ?? 0);
  }
  return worst;
}

/* Share (0…EXHAUSTION_MAX_PENALTY) by which exhaustion cuts credit, raw and research gains. */
export function getWarExhaustionPenalty(faction: Faction | undefined): number {
  if (!faction) return 0;
  const exhaustion = getFactionWarExhaustion(faction);
  const t = clamp((exhaustion - EXHAUSTION_PENALTY_THRESHOLD) / (EXHAUSTION_LIMIT - EXHAUSTION_PENALTY_THRESHOLD), 0, 1);
  return EXHAUSTION_MAX_PENALTY * t;
}

function addExhaustion(entry: FactionRelation, amount: number): void {
  entry.warExhaustion = clamp((entry.warExhaustion ?? 0) + amount, 0, EXHAUSTION_LIMIT);
}

/*
 * `loser` lost ships worth `lostValue` (credits) to `enemy`. `fleetValueBefore`
 * is the loser's total fleet value before the loss, so exhaustion grows
 * with the *share* of the navy lost.
 */
export function recordShipLosses(loser: Faction, enemy: Faction, lostValue: number, fleetValueBefore: number, wipedOut: boolean): void {
  if (lostValue <= 0 || getRelationKind(loser, enemy) !== 'war') return;
  const entry = relationEntry(loser, enemy);
  entry.shipsLostValue = (entry.shipsLostValue ?? 0) + lostValue;
  const share = lostValue / Math.max(EXHAUSTION_MIN_FLEET_VALUE, fleetValueBefore);
  addExhaustion(entry, EXHAUSTION_FLEET_LOSS_SCALE * Math.min(1, share));
  if (wipedOut && lostValue >= SEVERE_DEFEAT_MIN_VALUE) {
    addExhaustion(entry, EXHAUSTION_SEVERE_DEFEAT);
  }
}

/* `loser` lost a planet with `population` to `enemy` (capture or battle). */
export function recordPlanetLoss(loser: Faction, enemy: Faction, population: number): void {
  if (getRelationKind(loser, enemy) !== 'war') return;
  const entry = relationEntry(loser, enemy);
  entry.planetsLost = (entry.planetsLost ?? 0) + 1;
  addExhaustion(entry, Math.min(EXHAUSTION_PLANET_MAX, EXHAUSTION_PLANET_BASE + population / EXHAUSTION_PLANET_POP_DIVISOR));
  adjustOpinion(loser, enemy, OPINION_PLANET_LOST);
}

/*
 * `attacker` attacked `target` (battle or capture). If the attacker itself
 * declared this war less than SURPRISE_ATTACK_WINDOW_SECONDS ago, it is a
 * surprise attack: one reputation penalty per war. Returns true when the
 * penalty was applied.
 */
export function recordHostileAct(attacker: Faction, target: Faction): boolean {
  if (getRelationKind(attacker, target) !== 'war') return false;
  const a = relationEntry(attacker, target);
  const b = relationEntry(target, attacker);
  if (a.declaredBy !== attacker.id || a.surpriseRecorded || (a.warSeconds ?? 0) >= SURPRISE_ATTACK_WINDOW_SECONDS) {
    return false;
  }
  a.surpriseRecorded = true;
  b.surpriseRecorded = true;
  adjustReputation(attacker, REPUTATION_SURPRISE_ATTACK);
  return true;
}

/* ---------- Treaty state changes (both sides, always) ---------- */

/*
 * Starts a war. War-specific per-side fields restart at zero; opinion is
 * kept (it is the history between the two). `declarerId` is undefined for
 * the opening wars of a new game.
 */
export function startWar(a: Faction, b: Faction, lockSeconds: number, declarerId?: string): void {
  if (!isTreatyPair(a, b)) return;
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const entry = relationEntry(self, other);
    entry.state = 'war';
    entry.lockRemaining = Math.max(0, lockSeconds);
    entry.truce = false;
    entry.warSeconds = 0;
    entry.declaredBy = declarerId;
    entry.surpriseRecorded = false;
    entry.warExhaustion = 0;
    entry.shipsLostValue = 0;
    entry.planetsLost = 0;
    delete entry.passageRights;
    if (declarerId === undefined) delete entry.declaredBy;
  }
}

/*
 * Has `owner` granted `guest` free passage through its territory? Only
 * possible at peace. Nothing grants passage yet (prepared for passage
 * treaties, docs/territory.md); the border service already honors it.
 */
export function hasPassageRights(owner: Faction, guest: Faction): boolean {
  const relation = getRelation(owner, guest);
  return !!relation && relation.state === 'peace' && relation.passageRights === true;
}

/* Starts a permanent peace with a truce of `truceSeconds`; war fields reset. */
export function startPeace(a: Faction, b: Faction, truceSeconds: number): void {
  if (!isTreatyPair(a, b)) return;
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const entry = relationEntry(self, other);
    entry.state = 'peace';
    entry.lockRemaining = Math.max(0, truceSeconds);
    entry.truce = truceSeconds > 0;
    entry.warExhaustion = 0;
    entry.shipsLostValue = 0;
    entry.planetsLost = 0;
    delete entry.warSeconds;
    delete entry.declaredBy;
    delete entry.surpriseRecorded;
  }
}

/* Compatibility wrapper (tests, simple setups): a war or a truce-less peace. */
export function setTreatyState(a: Faction, b: Faction, state: TreatyState, lockSeconds: number): void {
  if (state === 'war') {
    startWar(a, b, lockSeconds);
  } else {
    startPeace(a, b, 0);
    for (const [self, other] of [[a, b], [b, a]] as const) {
      relationEntry(self, other).lockRemaining = Math.max(0, lockSeconds);
    }
  }
}

/*
 * Brings relations into a consistent state: every treaty pair gets an
 * entry on both sides (missing → war with `defaultLock`), symmetric fields
 * agree (disagreeing states become war), per-side values get defaults and
 * are clamped, and entries for allied, neutral or unknown factions are
 * dropped. Reputation is clamped. Idempotent; run on every load and on
 * new games, so saves from before any field existed load with defaults.
 */
export function normalizeRelations(factions: Faction[], defaultLock = 0): void {
  const byId = new Map(factions.map((f) => [f.id, f]));
  for (const faction of factions) {
    if (faction.reputation !== undefined) {
      faction.reputation = Number.isFinite(faction.reputation) ? clamp(faction.reputation, -REPUTATION_LIMIT, REPUTATION_LIMIT) : 0;
    }
    if (!faction.relations) continue;
    for (const otherId of Object.keys(faction.relations)) {
      const other = byId.get(otherId);
      if (!other || !isTreatyPair(faction, other)) {
        const { [otherId]: _dropped, ...rest } = faction.relations;
        faction.relations = rest;
      }
    }
  }
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i];
      const b = factions[j];
      if (!isTreatyPair(a, b)) continue;
      const ra = sanitize(a.relations?.[b.id]);
      const rb = sanitize(b.relations?.[a.id]);
      a.relations = a.relations ?? {};
      b.relations = b.relations ?? {};
      if (!ra && !rb) {
        a.relations[b.id] = defaultsFor('war', defaultLock);
        b.relations[a.id] = defaultsFor('war', defaultLock);
        continue;
      }
      const agree = !!ra && !!rb && ra.state === rb.state;
      const state: TreatyState = agree ? ra!.state : 'war';
      const lock = Math.max(ra?.lockRemaining ?? 0, rb?.lockRemaining ?? 0);
      const shared = agree ? ra! : (ra?.state === 'war' ? ra : rb) ?? ra ?? rb!;
      for (const [self, other, own] of [[a, b, ra], [b, a, rb]] as const) {
        const entry: FactionRelation = {
          ...defaultsFor(state, lock),
          opinion: own?.opinion ?? 0,
        };
        // Border memory survives war and peace; passage is never granted at war.
        if ((own?.borderIncidents ?? 0) > 0) entry.borderIncidents = own!.borderIncidents;
        if (state === 'peace' && own?.passageRights === true) entry.passageRights = true;
        if (state === 'war') {
          entry.warExhaustion = own?.state === 'war' ? own.warExhaustion ?? 0 : 0;
          entry.shipsLostValue = own?.state === 'war' ? own.shipsLostValue ?? 0 : 0;
          entry.planetsLost = own?.state === 'war' ? own.planetsLost ?? 0 : 0;
          entry.warSeconds = shared.warSeconds ?? 0;
          if (shared.declaredBy && byId.has(shared.declaredBy)) entry.declaredBy = shared.declaredBy;
          entry.surpriseRecorded = shared.surpriseRecorded === true;
        } else {
          entry.truce = shared.truce === true && lock > 0;
        }
        self.relations![other.id] = entry;
      }
    }
  }
}

function defaultsFor(state: TreatyState, lock: number): FactionRelation {
  return state === 'war'
    ? { state, lockRemaining: lock, opinion: 0, warExhaustion: 0, shipsLostValue: 0, planetsLost: 0, warSeconds: 0, surpriseRecorded: false }
    : { state, lockRemaining: lock, opinion: 0, warExhaustion: 0, shipsLostValue: 0, planetsLost: 0, truce: false };
}

const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function sanitize(relation: FactionRelation | undefined): FactionRelation | undefined {
  if (!relation || (relation.state !== 'war' && relation.state !== 'peace')) return undefined;
  return {
    ...relation,
    lockRemaining: Math.max(0, finite(relation.lockRemaining, 0)),
    opinion: clamp(finite(relation.opinion, 0), -OPINION_LIMIT, OPINION_LIMIT),
    warExhaustion: clamp(finite(relation.warExhaustion, 0), 0, EXHAUSTION_LIMIT),
    shipsLostValue: Math.max(0, finite(relation.shipsLostValue, 0)),
    planetsLost: Math.max(0, Math.floor(finite(relation.planetsLost, 0))),
    warSeconds: Math.max(0, finite(relation.warSeconds, 0)),
    borderIncidents: Math.max(0, finite(relation.borderIncidents, 0)),
  };
}

/* A truce that ran out unbroken this tick (both sides earn reputation). */
export interface HonoredTreaty {
  aId: string;
  bId: string;
}

/*
 * Advances every time-based diplomatic value by `deltaSeconds` of scaled
 * game time: locks and truces, war duration, per-turn exhaustion, opinion
 * drift and peace-time reputation. Pairs where either side is eliminated
 * (`isAlive` false) only count their locks down. Returns the truces that
 * were honored (expired unbroken) in this tick.
 */
export function tickDiplomacyTime(
  factions: Faction[],
  deltaSeconds: number,
  isAlive: (factionId: string) => boolean = () => true,
): HonoredTreaty[] {
  const honored: HonoredTreaty[] = [];
  if (deltaSeconds <= 0) return honored;
  const turns = deltaSeconds / DIPLOMACY_TURN_SECONDS;
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i];
      const b = factions[j];
      if (!isTreatyPair(a, b)) continue;
      const ra = relationEntry(a, b);
      const rb = relationEntry(b, a);
      const wasTruce = ra.state === 'peace' && ra.truce === true && ra.lockRemaining > 0;
      for (const entry of [ra, rb]) {
        entry.lockRemaining = Math.max(0, entry.lockRemaining - deltaSeconds);
      }
      if (wasTruce && ra.lockRemaining === 0) {
        ra.truce = false;
        rb.truce = false;
        adjustReputation(a, REPUTATION_TREATY_HONORED);
        adjustReputation(b, REPUTATION_TREATY_HONORED);
        honored.push({ aId: a.id, bId: b.id });
      }
      if (!isAlive(a.id) || !isAlive(b.id)) continue;
      if (ra.state === 'war') {
        for (const entry of [ra, rb]) {
          entry.warSeconds = (entry.warSeconds ?? 0) + deltaSeconds;
          addExhaustion(entry, EXHAUSTION_PER_TURN * turns);
          if ((entry.opinion ?? 0) > OPINION_WAR_DRIFT_FLOOR) {
            entry.opinion = Math.max(OPINION_WAR_DRIFT_FLOOR, (entry.opinion ?? 0) + OPINION_WAR_DRIFT_PER_TURN * turns);
          }
        }
      } else {
        for (const entry of [ra, rb]) {
          if ((entry.opinion ?? 0) < OPINION_PEACE_DRIFT_CAP) {
            entry.opinion = Math.min(OPINION_PEACE_DRIFT_CAP, (entry.opinion ?? 0) + OPINION_PEACE_DRIFT_PER_TURN * turns);
          }
        }
      }
    }
  }
  for (const faction of factions) {
    if (isNeutralFaction(faction) || !isAlive(faction.id)) continue;
    const partners = factions.filter((other) => isTreatyPair(faction, other) && isAlive(other.id));
    if (partners.length === 0) continue;
    const atWar = partners.some((other) => getRelationKind(faction, other) === 'war');
    if (!atWar && getReputation(faction) < REPUTATION_PEACE_CAP) {
      faction.reputation = Math.min(REPUTATION_PEACE_CAP, getReputation(faction) + REPUTATION_PEACE_PER_TURN * turns);
    }
  }
  return honored;
}

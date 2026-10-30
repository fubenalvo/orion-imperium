import { Faction, FactionRelation, TreatyState } from './star-map.models';

export type { FactionRelation, TreatyState } from './star-map.models';

/*
 * =========================================================
 * DIPLOMACY — relations between factions and the hostility rule
 * =========================================================
 *
 * The single source of truth for "may these two factions fight?". Every
 * system that used to compare `Faction.team` directly (battle detection,
 * planet capture, AI threat and target selection, attack orders, game
 * outcome) asks the helpers below instead. Full rules: docs/diplomacy.md.
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
 * Invariants:
 *  - Treaty relations are symmetric. Only setTreatyState writes them, and
 *    it always writes both sides; normalizeRelations repairs a save where
 *    the two sides disagree (war wins, the safer reading).
 *  - A missing treaty entry between two non-allied, non-neutral factions
 *    means war. New games and every load fill the entries explicitly, so
 *    the default only matters for transient objects (tests, mid-migration).
 *  - `lockRemaining` is game seconds before the state may change again
 *    (minimum war and peace durations). It is counted down by the game
 *    loop with the scaled delta, so it freezes while paused.
 */

export type RelationKind = 'self' | 'allied' | 'neutral' | TreatyState;

/* A war must last this long (game seconds) before peace can be signed. */
export const WAR_MIN_DURATION_SECONDS = 60;
/* Signed peace holds at least this long before war can be declared. */
export const PEACE_MIN_DURATION_SECONDS = 180;
/*
 * Lock on the starting wars of a new game: nobody can sign peace during
 * the opening, so the first contacts are real conflicts instead of every
 * faction immediately signing peace with everyone.
 */
export const INITIAL_WAR_LOCK_SECONDS = 240;

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

export function getRelation(a: Faction, b: Faction): FactionRelation | undefined {
  return isTreatyPair(a, b) ? a.relations?.[b.id] ?? { state: 'war', lockRemaining: 0 } : undefined;
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

/* Writes a treaty state on both sides (the only writer of Faction.relations). */
export function setTreatyState(a: Faction, b: Faction, state: TreatyState, lockSeconds: number): void {
  if (!isTreatyPair(a, b)) return;
  const lockRemaining = Math.max(0, lockSeconds);
  a.relations = { ...(a.relations ?? {}), [b.id]: { state, lockRemaining } };
  b.relations = { ...(b.relations ?? {}), [a.id]: { state, lockRemaining } };
}

/*
 * Brings relations into a consistent state: every treaty pair gets an
 * entry on both sides (missing → war with `defaultLock`), disagreeing
 * sides become war, invalid locks are clamped, and entries for allied,
 * neutral or unknown factions are dropped. Idempotent; run on every load
 * and on new games.
 */
export function normalizeRelations(factions: Faction[], defaultLock = 0): void {
  const byId = new Map(factions.map((f) => [f.id, f]));
  for (const faction of factions) {
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
      if (!ra && !rb) {
        setTreatyState(a, b, 'war', defaultLock);
      } else if (!ra || !rb || ra.state !== rb.state) {
        setTreatyState(a, b, 'war', Math.max(ra?.lockRemaining ?? 0, rb?.lockRemaining ?? 0));
      } else {
        setTreatyState(a, b, ra.state, Math.max(ra.lockRemaining, rb.lockRemaining));
      }
    }
  }
}

function sanitize(relation: FactionRelation | undefined): FactionRelation | undefined {
  if (!relation || (relation.state !== 'war' && relation.state !== 'peace')) return undefined;
  const lock = Number.isFinite(relation.lockRemaining) ? Math.max(0, relation.lockRemaining) : 0;
  return { state: relation.state, lockRemaining: lock };
}

/* Counts every relation lock down by `deltaSeconds` of game time. */
export function tickRelationLocks(factions: Faction[], deltaSeconds: number): void {
  if (deltaSeconds <= 0) return;
  for (const faction of factions) {
    if (!faction.relations) continue;
    for (const relation of Object.values(faction.relations)) {
      if (relation.lockRemaining > 0) {
        relation.lockRemaining = Math.max(0, relation.lockRemaining - deltaSeconds);
      }
    }
  }
}

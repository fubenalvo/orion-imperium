import { SpaceBase, StarSystem } from './star-map.models';
import { isDysonAnchor, isOpenerAnchor } from './dyson-anchor';
import { isStationComplete } from './station-construction';

/*
 * =========================================================
 * DYSON VICTORY (pure rules)
 * =========================================================
 *
 * The Dyson Swarm victory (docs/dyson-swarm.md, "Victory: the warm-up"):
 *
 * - The ring holder is the one faction with a COMPLETED anchor on every
 *   slot of the ring that also owns at least one planet. Construction
 *   sites do not count, and anchors of allies or peace partners are never
 *   combined. A Dampener anchor (campaign only) never counts.
 * - Campaign coalition (docs/campaign-design.md, Mission 7): when a mission
 *   sets one, its members' completed opener anchors may fill the ring
 *   together (each member at least one, none more than `maxPerMember`);
 *   the holder id is then `coalition:<id>`.
 * - While there is a holder, its warm-up counts down DYSON_WARMUP_SECONDS
 *   of scaled game time. When it reaches zero the holder wins: victory for
 *   the human player, defeat for the player when an AI faction holds it.
 * - The moment the holder loses any anchor (destroyed or demolished) or its
 *   last planet, the warm-up is cancelled and the timer is gone: a later
 *   complete ring starts again from the full DYSON_WARMUP_SECONDS.
 *
 * The state is saved (StarMapData.dysonWarmup), so a reload — including the
 * reload after the battle screen — continues the countdown. A completed
 * warm-up stays in the save with remaining 0; GameOutcomeService reads it.
 */
export const DYSON_WARMUP_SECONDS = 300;

export interface DysonWarmupState {
  factionId: string;
  /* Seconds of game time left; 0 = the warm-up completed (the faction won). */
  remaining: number;
}

export type DysonWarmupEvent =
  | { kind: 'started'; factionId: string }
  | { kind: 'cancelled'; factionId: string }
  | { kind: 'completed'; factionId: string };

/* The faction holding a completed anchor on every slot and at least one planet, or null. */
export function dysonRingHolder(
  bases: readonly SpaceBase[],
  slotCount: number,
  starSystems: readonly StarSystem[],
): string | null {
  if (slotCount <= 0) return null;
  const owners = new Map<number, string>();
  for (const base of bases) {
    if (!isOpenerAnchor(base) || !isStationComplete(base) || typeof base.dysonSlot !== 'number') continue;
    owners.set(base.dysonSlot, base.factionId);
  }
  if (owners.size < slotCount) return null;
  const holder = owners.get(0)!;
  for (let slot = 1; slot < slotCount; slot++) {
    if (owners.get(slot) !== holder) return null;
  }
  const ownsPlanet = starSystems.some((s) => (s.planetsTiles ?? []).some((p) => p.factionId === holder));
  return ownsPlanet ? holder : null;
}

export interface DysonCoalition {
  id: string;
  name: string;
  members: readonly string[];
  maxPerMember: number;
}

export const COALITION_HOLDER_PREFIX = 'coalition:';

export function coalitionHolderId(coalition: Pick<DysonCoalition, 'id'>): string {
  return `${COALITION_HOLDER_PREFIX}${coalition.id}`;
}

export function isCoalitionHolder(holder: string | null | undefined): boolean {
  return !!holder && holder.startsWith(COALITION_HOLDER_PREFIX);
}

/* `coalition:<id>` when the coalition's members fill every slot together (see above), else null. */
export function dysonCoalitionHolder(
  bases: readonly SpaceBase[],
  slotCount: number,
  starSystems: readonly StarSystem[],
  coalition: DysonCoalition | null,
): string | null {
  if (!coalition || slotCount <= 0) return null;
  const owners = new Map<number, string>();
  for (const base of bases) {
    if (!isOpenerAnchor(base) || !isStationComplete(base) || typeof base.dysonSlot !== 'number') continue;
    owners.set(base.dysonSlot, base.factionId);
  }
  if (owners.size < slotCount) return null;
  const counts = new Map<string, number>();
  for (const owner of owners.values()) {
    if (!coalition.members.includes(owner)) return null;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  for (const member of coalition.members) {
    const count = counts.get(member) ?? 0;
    if (count < 1 || count > coalition.maxPerMember) return null;
    if (!starSystems.some((s) => (s.planetsTiles ?? []).some((p) => p.factionId === member))) return null;
  }
  return coalitionHolderId(coalition);
}

/*
 * One step of the warm-up. Returns the new state (null = no warm-up) and
 * what happened. A completed warm-up (remaining 0) is terminal and never
 * changes again.
 */
export function advanceDysonWarmup(
  state: DysonWarmupState | null,
  holder: string | null,
  deltaSeconds: number,
): { state: DysonWarmupState | null; events: DysonWarmupEvent[] } {
  if (state && state.remaining <= 0) return { state, events: [] };
  const events: DysonWarmupEvent[] = [];
  let next = state;
  if (next && next.factionId !== holder) {
    events.push({ kind: 'cancelled', factionId: next.factionId });
    next = null;
  }
  if (!next && holder) {
    next = { factionId: holder, remaining: DYSON_WARMUP_SECONDS };
    events.push({ kind: 'started', factionId: holder });
  }
  if (next && deltaSeconds > 0) {
    const remaining = Math.max(0, next.remaining - deltaSeconds);
    next = { factionId: next.factionId, remaining };
    if (remaining === 0) events.push({ kind: 'completed', factionId: next.factionId });
  }
  return { state: next, events };
}

/* A saved warm-up, or null when missing or malformed. */
export function sanitizeDysonWarmup(saved: unknown): DysonWarmupState | null {
  if (!saved || typeof saved !== 'object') return null;
  const s = saved as Partial<DysonWarmupState>;
  if (typeof s.factionId !== 'string' || typeof s.remaining !== 'number' || !Number.isFinite(s.remaining)) return null;
  return { factionId: s.factionId, remaining: Math.max(0, Math.min(DYSON_WARMUP_SECONDS, s.remaining)) };
}

/* "4:05" — the countdown as players read it. */
export function formatWarmup(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

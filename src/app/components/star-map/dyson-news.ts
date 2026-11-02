import { SpaceBase } from './star-map.models';
import { isDysonAnchor } from './dyson-anchor';
import { isStationComplete } from './station-construction';

/*
 * =========================================================
 * DYSON NEWS (pure)
 * =========================================================
 *
 * Global Dyson news (docs/dyson-swarm.md, "Global news"): every empire learns
 * about every anchor event, regardless of fog of war. Events are derived by
 * comparing two snapshots of the anchors rather than hooked into each code
 * path, so an anchor destroyed on the battle screen (which only edits the
 * autosave; the registry is restored on the reload) is reported exactly like
 * one destroyed in an AI-vs-AI battle.
 *
 * A removed anchor is 'demolished' when SpaceBaseService.demolish recorded
 * that reason, otherwise 'destroyed'.
 */
export interface DysonAnchorSnapshot {
  id: number;
  name: string;
  factionId: string;
  complete: boolean;
}

export type DysonNewsEvent =
  | { kind: 'started'; anchor: DysonAnchorSnapshot }
  | { kind: 'completed'; anchor: DysonAnchorSnapshot }
  | { kind: 'destroyed'; anchor: DysonAnchorSnapshot }
  | { kind: 'demolished'; anchor: DysonAnchorSnapshot };

export function snapshotDysonAnchors(bases: readonly SpaceBase[]): DysonAnchorSnapshot[] {
  return bases
    .filter(isDysonAnchor)
    .map((b) => ({ id: b.id, name: b.name, factionId: b.factionId, complete: isStationComplete(b) }));
}

export function diffDysonAnchors(
  before: readonly DysonAnchorSnapshot[],
  after: readonly DysonAnchorSnapshot[],
  wasDemolished: (id: number) => boolean,
): DysonNewsEvent[] {
  const events: DysonNewsEvent[] = [];
  const afterById = new Map(after.map((a) => [a.id, a] as const));
  const beforeById = new Map(before.map((a) => [a.id, a] as const));
  for (const old of before) {
    const now = afterById.get(old.id);
    if (!now) {
      events.push({ kind: wasDemolished(old.id) ? 'demolished' : 'destroyed', anchor: old });
    } else if (!old.complete && now.complete) {
      events.push({ kind: 'completed', anchor: now });
    }
  }
  for (const anchor of after) {
    if (beforeById.has(anchor.id)) continue;
    // An anchor that appears already complete (e.g. it was built during a
    // single long step) is reported once, as completed.
    events.push({ kind: anchor.complete ? 'completed' : 'started', anchor });
  }
  return events;
}

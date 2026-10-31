import { Faction, Fleet, StarSystem } from './star-map.models';
import { getRelation, isTreatyPair } from './diplomacy';

/*
 * =========================================================
 * PEACE TREATY — terms model and validation
 * =========================================================
 *
 * A peace treaty ends a war between two treaty participants and may carry
 * resource payments in either direction. The same model is used for the
 * player's proposals, AI proposals and counter-offers, and AI–AI treaties;
 * validation here is the one feasibility rule for all of them, and
 * DiplomacyService.executeTreaty re-validates right before applying, so a
 * treaty is either applied completely or not at all (docs/diplomacy.md).
 *
 * Items (each has a giver; the receiver is the other party): credits or
 * raw materials, a positive whole amount the giver holds now.
 *
 * Planets and star systems are deliberately NOT negotiable: territory
 * changes hands only through normal play (conquest, colonization,
 * rebellion). Treaties from older code or saves that list a planet or
 * system are invalid ('unsupported_item') and never execute.
 */

export type ResourceItemKind = 'credits' | 'rawmaterials';

export type TreatyItem = { kind: ResourceItemKind; giverId: string; amount: number };

export interface PeaceTreaty {
  /* The faction that proposes the terms. */
  proposerId: string;
  /* The faction that must accept them. */
  recipientId: string;
  items: TreatyItem[];
}

export type TreatyInvalidReason =
  | 'unknown_faction'
  | 'not_at_war'
  | 'locked'
  | 'eliminated'
  | 'not_party'
  | 'unsupported_item'
  | 'invalid_amount'
  | 'insufficient_resources';

export interface TreatyValidation {
  ok: boolean;
  reason?: TreatyInvalidReason;
  /* Index of the offending item, when the reason concerns one. */
  itemIndex?: number;
}

export interface TreatyWorld {
  factions: Faction[];
  starSystems: StarSystem[];
  fleets: Fleet[];
}

export function otherParty(treaty: PeaceTreaty, factionId: string): string {
  return treaty.proposerId === factionId ? treaty.recipientId : treaty.proposerId;
}

/* A faction takes part while it owns a planet or has a fleet with a living ship. */
export function isFactionAlive(factionId: string, world: Pick<TreatyWorld, 'starSystems' | 'fleets'>): boolean {
  return world.starSystems.some((s) => s.planetsTiles.some((p) => p.factionId === factionId))
    || world.fleets.some((f) => f.factionId === factionId && !f.destroyed && f.ships.some((s) => !s.destroyed));
}

/* Total of a resource kind given by `giverId`. */
export function resourceTotal(treaty: PeaceTreaty, giverId: string, kind: ResourceItemKind): number {
  return treaty.items.reduce((sum, item) => (item.kind === kind && item.giverId === giverId ? sum + item.amount : sum), 0);
}

export function validateTreaty(treaty: PeaceTreaty, world: TreatyWorld): TreatyValidation {
  const proposer = world.factions.find((f) => f.id === treaty.proposerId);
  const recipient = world.factions.find((f) => f.id === treaty.recipientId);
  if (!proposer || !recipient || !isTreatyPair(proposer, recipient)) return { ok: false, reason: 'unknown_faction' };
  const relation = getRelation(proposer, recipient)!;
  if (relation.state !== 'war') return { ok: false, reason: 'not_at_war' };
  if (relation.lockRemaining > 0) return { ok: false, reason: 'locked' };
  if (!isFactionAlive(proposer.id, world) || !isFactionAlive(recipient.id, world)) return { ok: false, reason: 'eliminated' };

  const parties = new Set([proposer.id, recipient.id]);
  for (const [index, item] of treaty.items.entries()) {
    if (!parties.has(item.giverId)) return { ok: false, reason: 'not_party', itemIndex: index };
    // Runtime guard: anything but a resource payment (e.g. a planet item built
    // by stale code) is rejected rather than ignored.
    if ((item.kind as string) !== 'credits' && (item.kind as string) !== 'rawmaterials') {
      return { ok: false, reason: 'unsupported_item', itemIndex: index };
    }
    if (!Number.isInteger(item.amount) || item.amount <= 0) return { ok: false, reason: 'invalid_amount', itemIndex: index };
  }

  for (const giver of [proposer, recipient]) {
    for (const kind of ['credits', 'rawmaterials'] as const) {
      if (resourceTotal(treaty, giver.id, kind) > Math.floor(giver.currencies[kind] ?? 0)) {
        return { ok: false, reason: 'insufficient_resources' };
      }
    }
  }
  return { ok: true };
}

/* Player-facing explanation of a validation failure. */
export function describeTreatyInvalid(reason: TreatyInvalidReason | undefined): string {
  switch (reason) {
    case 'not_at_war': return 'You are not at war with this empire.';
    case 'locked': return 'The war is too fresh to negotiate yet.';
    case 'eliminated': return 'This empire no longer exists.';
    case 'unsupported_item': return 'Only credits and raw materials can be part of a peace treaty.';
    case 'invalid_amount': return 'Resource amounts must be positive whole numbers.';
    case 'insufficient_resources': return 'One side cannot pay the resources listed.';
    default: return 'These terms are not possible.';
  }
}

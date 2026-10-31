import { Faction } from './star-map.models';

/*
 * =========================================================
 * RESOURCE TRANSFER — atomic resource payments between factions
 * =========================================================
 *
 * The one place that moves stockpiled resources from one faction to
 * another for diplomacy: peace treaties (DiplomacyService.executeTreaty)
 * and financial demands (DiplomacyService.acceptDemand). It knows nothing
 * about treaty state — it never starts peace, a truce or a war; callers
 * apply their own diplomatic consequences after a successful transfer.
 *
 * All-or-nothing: every amount is checked against the giver's current,
 * whole-unit stock first, and only when all of them are covered is
 * anything moved. A failed transfer changes nothing.
 */

/** Resource kinds that can change hands through diplomacy. */
export type TransferableResource = 'credits' | 'rawmaterials';

/** Whole, non-negative amounts per resource kind; missing kinds count as 0. */
export type ResourceAmounts = Partial<Record<TransferableResource, number>>;

const KINDS: readonly TransferableResource[] = ['credits', 'rawmaterials'];

/** Whole units of `kind` the faction holds now (fractional income is not payable). */
export function availableResource(faction: Faction, kind: TransferableResource): number {
  return Math.max(0, Math.floor(faction.currencies[kind] ?? 0));
}

/**
 * True when every amount is a non-negative whole number and the giver
 * holds all of them right now.
 */
export function canCoverResources(giver: Faction, amounts: ResourceAmounts): boolean {
  for (const kind of KINDS) {
    const amount = amounts[kind] ?? 0;
    if (!Number.isInteger(amount) || amount < 0) return false;
    if (amount > availableResource(giver, kind)) return false;
  }
  return true;
}

/**
 * Moves `amounts` from `giver` to `receiver` atomically. Returns false and
 * changes nothing when any amount is invalid or not covered.
 */
export function transferResources(giver: Faction, receiver: Faction, amounts: ResourceAmounts): boolean {
  if (giver.id === receiver.id || !canCoverResources(giver, amounts)) return false;
  for (const kind of KINDS) {
    const amount = amounts[kind] ?? 0;
    if (amount <= 0) continue;
    giver.currencies[kind] = (giver.currencies[kind] ?? 0) - amount;
    receiver.currencies[kind] = (receiver.currencies[kind] ?? 0) + amount;
  }
  return true;
}

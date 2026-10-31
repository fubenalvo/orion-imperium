import { Faction, Fleet, PlanetTile, StarSystem } from './star-map.models';
import { getRelation, isTreatyPair } from './diplomacy';

/*
 * =========================================================
 * PEACE TREATY — terms model and validation
 * =========================================================
 *
 * A peace treaty ends a war between two treaty participants and may carry
 * concessions in either direction. The same model is used for the
 * player's proposals, AI proposals and counter-offers, and AI–AI treaties;
 * validation here is the one feasibility rule for all of them, and
 * DiplomacyService.executeTreaty re-validates right before applying, so a
 * treaty is either applied completely or not at all (docs/diplomacy.md).
 *
 * Items (each has a giver; the receiver is the other party):
 *  - credits / rawmaterials: a positive whole amount the giver holds now;
 *  - planet: one planet the giver owns;
 *  - system: every planet the giver owns in that star system. Star systems
 *    have no owner of their own (ownership is per planet), so ceding a
 *    system is exactly ceding those planets — the data stays consistent.
 * A giver must keep at least one planet: a treaty never eliminates a party.
 */

export type ResourceItemKind = 'credits' | 'rawmaterials';

export type TreatyItem =
  | { kind: ResourceItemKind; giverId: string; amount: number }
  | { kind: 'planet'; giverId: string; planetId: number }
  | { kind: 'system'; giverId: string; systemId: string };

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
  | 'invalid_amount'
  | 'insufficient_resources'
  | 'unknown_target'
  | 'not_owner'
  | 'duplicate'
  | 'last_planet';

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

export interface CededPlanet {
  planet: PlanetTile;
  system: StarSystem;
  giverId: string;
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

/* Every planet the treaty cedes (planets and the giver's planets in ceded systems). */
export function cededPlanets(treaty: PeaceTreaty, starSystems: StarSystem[]): CededPlanet[] {
  const result: CededPlanet[] = [];
  for (const item of treaty.items) {
    if (item.kind === 'planet') {
      for (const system of starSystems) {
        const planet = system.planetsTiles.find((p) => p.id === item.planetId);
        if (planet) result.push({ planet, system, giverId: item.giverId });
      }
    } else if (item.kind === 'system') {
      const system = starSystems.find((s) => s.id === item.systemId);
      for (const planet of system?.planetsTiles.filter((p) => p.factionId === item.giverId) ?? []) {
        result.push({ planet, system: system!, giverId: item.giverId });
      }
    }
  }
  return result;
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
  const seenPlanets = new Set<number>();
  for (const [index, item] of treaty.items.entries()) {
    if (!parties.has(item.giverId)) return { ok: false, reason: 'not_party', itemIndex: index };
    if (item.kind === 'credits' || item.kind === 'rawmaterials') {
      if (!Number.isInteger(item.amount) || item.amount <= 0) return { ok: false, reason: 'invalid_amount', itemIndex: index };
      continue;
    }
    const planets = cededPlanets({ ...treaty, items: [item] }, world.starSystems);
    if (planets.length === 0) {
      const exists = item.kind === 'planet'
        ? world.starSystems.some((s) => s.planetsTiles.some((p) => p.id === item.planetId))
        : world.starSystems.some((s) => s.id === (item as { systemId: string }).systemId);
      return { ok: false, reason: exists ? 'not_owner' : 'unknown_target', itemIndex: index };
    }
    for (const { planet } of planets) {
      if (planet.factionId !== item.giverId) return { ok: false, reason: 'not_owner', itemIndex: index };
      if (seenPlanets.has(planet.id)) return { ok: false, reason: 'duplicate', itemIndex: index };
      seenPlanets.add(planet.id);
    }
  }

  for (const giver of [proposer, recipient]) {
    for (const kind of ['credits', 'rawmaterials'] as const) {
      if (resourceTotal(treaty, giver.id, kind) > Math.floor(giver.currencies[kind] ?? 0)) {
        return { ok: false, reason: 'insufficient_resources' };
      }
    }
    const owned = world.starSystems.reduce((n, s) => n + s.planetsTiles.filter((p) => p.factionId === giver.id).length, 0);
    const ceded = [...seenPlanets].filter((id) => world.starSystems.some((s) => s.planetsTiles.some((p) => p.id === id && p.factionId === giver.id))).length;
    if (ceded > 0 && ceded >= owned) return { ok: false, reason: 'last_planet' };
  }
  return { ok: true };
}

/* Player-facing explanation of a validation failure. */
export function describeTreatyInvalid(reason: TreatyInvalidReason | undefined): string {
  switch (reason) {
    case 'not_at_war': return 'You are not at war with this empire.';
    case 'locked': return 'The war is too fresh to negotiate yet.';
    case 'eliminated': return 'This empire no longer exists.';
    case 'invalid_amount': return 'Resource amounts must be positive whole numbers.';
    case 'insufficient_resources': return 'One side cannot pay the resources listed.';
    case 'unknown_target': return 'A listed planet or system no longer exists.';
    case 'not_owner': return 'A listed planet is no longer owned by the side that would cede it.';
    case 'duplicate': return 'A planet is listed twice (directly and through its system).';
    case 'last_planet': return 'An empire cannot cede its last planet.';
    default: return 'These terms are not possible.';
  }
}

import { Faction, Fleet, SpaceBase } from './star-map.models';
import { DysonRing, dysonSlotAtCell } from './dyson-ring';
import { isStationComplete } from './station-construction';

/*
 * =========================================================
 * DYSON ANCHORS (pure rules)
 * =========================================================
 *
 * A Dyson anchor is a space base of kind 'dyson' on one of the eight ring
 * slots (dyson-ring.ts, docs/dyson-swarm.md). It is deployed by the Swarm
 * Constructor ship (unlocked by Stellar Engineering) and lives in the same
 * registry, save list and battle path as ordinary bases (SpaceBaseService,
 * StarMapData.spaceBases, checkBaseBattles), so it is destroy-only and
 * never captured. What differs from an ordinary (radar) base:
 *
 * - Placement: only on an empty ring slot. Territory, base spacing and star
 *   distance do not apply; the slot is the only spot and one anchor per
 *   slot is the only limit. Ordinary bases ignore anchors for their spacing
 *   and may not enter the ring zone at all (space-base.ts).
 * - Territory: no claim disc. A completed anchor makes its wedge its
 *   owner's territory (dysonWedgeOwners → TerritoryMap).
 * - Construction: STATION_CONSTRUCTION_SECONDS.dysonAnchor.
 * - Upkeep: DYSON_ANCHOR_UPKEEP_POINTS, more than a radar base.
 * - Bonus: the owner picks one DysonBonusId once (during construction or
 *   after); it cannot be changed. DEMOLISH removes the anchor without a
 *   refund and frees the slot. Only completed anchors of the faction count;
 *   bonuses of the same kind add up (dysonBonusEffects). Where each effect
 *   applies: energy in EconomyService.calculatePlanetEconomy, research in
 *   EconomyService.calculateEconomy, the ship raw-material discount in
 *   ProductionService.queueOrder (what is charged) and the player's
 *   production panel (what is shown).
 * - Visibility: every anchor is shown to every faction regardless of fog.
 * - Sensors: a completed anchor is a sensor source like a radar base.
 */
export const DYSON_ANCHOR_SHIP_TYPE = 'swarm_constructor';
export const DYSON_TECHNOLOGY_ID = 'stellar_engineering';

/* Upkeep points per second of a completed anchor (a radar base costs 25). Tuned in phase 7. */
export const DYSON_ANCHOR_UPKEEP_POINTS = 60;

export type DysonBonusId = 'stellar_power' | 'orbital_foundries' | 'swarm_observatory';

export interface DysonBonusDef {
  id: DysonBonusId;
  name: string;
  /* Effect per anchor; bonuses of several anchors add up. */
  description: string;
}

/*
 * The starting set of anchor bonuses. Deliberately tiny: an anchor's bonus
 * must stay well below its upkeep in value, so the swarm remains a credit
 * sink. No credit-income or upkeep bonus exists on purpose.
 */
export const DYSON_BONUSES: readonly DysonBonusDef[] = [
  { id: 'stellar_power', name: 'Stellar Power', description: '+1% energy output of power plants' },
  { id: 'orbital_foundries', name: 'Orbital Foundries', description: '−1% raw-material cost of ship production' },
  { id: 'swarm_observatory', name: 'Swarm Observatory', description: '+1 research point every 10 s' },
];

/*
 * Effect per anchor. Value check against the anchor's upkeep (60 points ≈
 * 18 credits/s before the empire scale): 0.1 research/s is worth about
 * 0.4 credits/s at the 4-credits-per-point research price, and 1% of a
 * typical late empire's power or ship raw spending is of the same small
 * order, so the swarm stays a net sink (docs/dyson-swarm.md).
 */
export const DYSON_BONUS_VALUES = {
  /* Added to the faction's power-building energy multiplier (research bonuses add the same way). */
  energyOutputPerAnchor: 0.01,
  /* Share of a ship's raw-material cost removed per anchor. */
  shipRawDiscountPerAnchor: 0.01,
  /* Research points per second of game time per anchor (1 every 10 s). */
  researchPerSecondPerAnchor: 0.1,
} as const;

export interface DysonBonusEffects {
  /* Add to the power-building energy multiplier. */
  energyOutput: number;
  /* Multiply a ship's raw-material cost by this (≤ 1). */
  shipRawCostMultiplier: number;
  researchPerSecond: number;
}

export const NO_DYSON_BONUS: DysonBonusEffects = { energyOutput: 0, shipRawCostMultiplier: 1, researchPerSecond: 0 };

/* Completed anchors of `factionId` that carry `bonus`. */
export function dysonBonusCount(bases: readonly SpaceBase[], factionId: string, bonus: DysonBonusId): number {
  let count = 0;
  for (const base of bases) {
    if (isDysonAnchor(base) && base.factionId === factionId && base.dysonBonus === bonus && isStationComplete(base)) count++;
  }
  return count;
}

/* The faction's summed anchor bonuses. */
export function dysonBonusEffects(bases: readonly SpaceBase[], factionId: string): DysonBonusEffects {
  const power = dysonBonusCount(bases, factionId, 'stellar_power');
  const foundries = dysonBonusCount(bases, factionId, 'orbital_foundries');
  const observatories = dysonBonusCount(bases, factionId, 'swarm_observatory');
  if (power === 0 && foundries === 0 && observatories === 0) return NO_DYSON_BONUS;
  return {
    energyOutput: power * DYSON_BONUS_VALUES.energyOutputPerAnchor,
    shipRawCostMultiplier: Math.max(0, 1 - foundries * DYSON_BONUS_VALUES.shipRawDiscountPerAnchor),
    researchPerSecond: observatories * DYSON_BONUS_VALUES.researchPerSecondPerAnchor,
  };
}

/* A ship's raw-material cost per unit after the Orbital Foundries discount (whole units). */
export function discountedShipRawCost(rawMaterialCost: number, multiplier: number): number {
  return Math.round(rawMaterialCost * multiplier);
}

export function isDysonBonusId(value: unknown): value is DysonBonusId {
  return DYSON_BONUSES.some((b) => b.id === value);
}

export function isDysonAnchor(base: Pick<SpaceBase, 'kind'>): boolean {
  return base.kind === 'dyson';
}

export function hasLivingSwarmConstructor(fleet: Fleet): boolean {
  return (fleet.ships ?? []).some((s) => s.type === DYSON_ANCHOR_SHIP_TYPE && !s.destroyed);
}

export type AnchorDeploymentFailure =
  | 'no_constructor'
  | 'fleet_moving'
  | 'inside_system'
  | 'neutral_faction'
  | 'no_technology'
  | 'no_ring'
  | 'not_on_slot'
  | 'slot_taken';

export type AnchorDeploymentCheck =
  | { ok: true; slot: number; col: number; row: number }
  | { ok: false; reason: AnchorDeploymentFailure };

export interface AnchorDeploymentInput {
  fleet: Fleet;
  factions: readonly Faction[];
  ring: DysonRing | null;
  bases: readonly SpaceBase[];
}

/*
 * Can `fleet` deploy a Dyson anchor where it stands? The fleet must carry a
 * living Swarm Constructor, be stopped on the galaxy map on an empty ring
 * slot, and its faction must have Stellar Engineering. Nothing else — the
 * slot is the only valid spot (docs/dyson-swarm.md, "Anchor lifecycle").
 */
export function validateAnchorDeployment(input: AnchorDeploymentInput): AnchorDeploymentCheck {
  const { fleet, ring } = input;
  const fail = (reason: AnchorDeploymentFailure): AnchorDeploymentCheck => ({ ok: false, reason });
  if (fleet.destroyed || !hasLivingSwarmConstructor(fleet)) return fail('no_constructor');
  if (fleet.targetX !== null || fleet.targetY !== null) return fail('fleet_moving');
  if (fleet.system) return fail('inside_system');
  const owner = input.factions.find((f) => f.id === fleet.factionId);
  if (!owner || owner.team === 0) return fail('neutral_faction');
  if (!(owner.researchedTechnologies ?? []).includes(DYSON_TECHNOLOGY_ID)) return fail('no_technology');
  if (!ring) return fail('no_ring');
  const col = Math.floor(fleet.x);
  const row = Math.floor(fleet.y);
  const slot = dysonSlotAtCell(ring, col, row);
  if (!slot) return fail('not_on_slot');
  if (input.bases.some((b) => isDysonAnchor(b) && b.dysonSlot === slot.index)) return fail('slot_taken');
  return { ok: true, slot: slot.index, col, row };
}

export function describeAnchorDeploymentFailure(reason: AnchorDeploymentFailure): string {
  switch (reason) {
    case 'no_constructor':
      return 'The fleet carries no Swarm Constructor.';
    case 'fleet_moving':
      return 'Stop the fleet first: the anchor is built where the fleet stands.';
    case 'inside_system':
      return 'Leave the star system: anchors are built on the ring around the black hole.';
    case 'neutral_faction':
      return 'This faction cannot build Dyson anchors.';
    case 'no_technology':
      return 'Requires Stellar Engineering.';
    case 'no_ring':
      return 'This map has no black hole to build a Dyson swarm around.';
    case 'not_on_slot':
      return 'Move onto an empty anchor slot of the ring around the black hole.';
    case 'slot_taken':
      return 'This slot already holds an anchor.';
  }
}

/* "Dyson Anchor 3" — slots are numbered 1–8 for players. */
export function dysonAnchorName(slot: number): string {
  return `Dyson Anchor ${slot + 1}`;
}

/* Owner of each wedge (index = slot): the completed anchor on that slot, if any. */
export function dysonWedgeOwners(bases: readonly SpaceBase[], slotCount: number): (string | null)[] {
  const owners: (string | null)[] = Array(slotCount).fill(null);
  for (const base of bases) {
    if (!isDysonAnchor(base) || !isStationComplete(base)) continue;
    const slot = base.dysonSlot;
    if (typeof slot === 'number' && slot >= 0 && slot < slotCount) owners[slot] = base.factionId;
  }
  return owners;
}

export function dysonBonusDef(id: DysonBonusId | undefined): DysonBonusDef | null {
  return DYSON_BONUSES.find((b) => b.id === id) ?? null;
}

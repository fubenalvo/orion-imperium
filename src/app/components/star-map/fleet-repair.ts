import { FactionShipStock, Fleet, FleetShip, ShipStockEntry } from './star-map.models';

/*
 * =========================================================
 * FLEET REPAIR (pure rules)
 * =========================================================
 *
 * Ships keep battle damage (`FleetShip.currentHp`, missing = full) until
 * they are repaired. Full rules: docs/fleet-organization.md, "Repair".
 *
 * - A fleet repairs while it stands, with no galaxy order left, in a star
 *   system where its own faction owns a planet with a Spaceport
 *   (FLEET_REPAIR_CONFIG.spaceportRate), or on the cell of one of its
 *   faction's completed space bases once the faction has researched a
 *   `stationRepair` technology (baseRate). The better site wins; rates do
 *   not stack.
 * - Ships in the reserve (global stock) keep their damage too
 *   (`ShipStockEntry.currentHp`) and repair at the Spaceport rate while the
 *   faction owns at least one Spaceport, since the reserve is docked at the
 *   Spaceports. This closes the old loophole where disbanding a fleet
 *   anywhere repaired it instantly.
 * - The rules are the same for every faction; the AI is repaired by
 *   whatever its fleets already do (parking at Spaceports), it has no
 *   repair-seeking behavior of its own.
 * - Maximum hull is the ship type's `hitPoints`; no technology raises it.
 */
export const FLEET_REPAIR_CONFIG = {
  /* Share of the type's hull restored per game second at a Spaceport (full in 20 s). */
  spaceportRate: 0.05,
  /* Share per game second at a space base with the repair technology (full in 40 s). */
  baseRate: 0.025,
  /*
   * Repair runs in steps of this much game time instead of every frame:
   * hull changes are invisible below that, and the site lookups then run
   * a few times per second instead of per frame.
   */
  stepSeconds: 0.5,
} as const;

export type RepairSite = 'spaceport' | 'base';

export interface FleetRepairInput {
  fleets: Fleet[];
  shipStock?: FactionShipStock[];
  /* Factions owning at least one Spaceport (reserve repair). */
  factionsWithSpaceport: ReadonlySet<string>;
  /* The repair site at the fleet's position, or null. */
  siteFor(fleet: Fleet): RepairSite | null;
  /* Maximum hull of a ship type; undefined for an unknown type. */
  maxHp(typeId: string): number | undefined;
}

export interface FleetRepairResult {
  /* Fleets at a repair site that had damaged ships during this step (for the repair aura). */
  repairing: Map<number, RepairSite>;
  /* True when any hull value changed. */
  changed: boolean;
}

export function repairRate(site: RepairSite): number {
  return site === 'spaceport' ? FLEET_REPAIR_CONFIG.spaceportRate : FLEET_REPAIR_CONFIG.baseRate;
}

/* A ship below its type's hull (missing or malformed hull counts as full). */
export function isShipDamaged(ship: Pick<FleetShip, 'currentHp' | 'destroyed'>, maxHp: number | undefined): boolean {
  if (ship.destroyed || !maxHp || maxHp <= 0) return false;
  const hp = ship.currentHp;
  return typeof hp === 'number' && Number.isFinite(hp) && hp < maxHp;
}

/* Repairs one ship by `amount` hull points. Returns true when its hull changed. */
function repairShip(ship: FleetShip | ShipStockEntry, maxHp: number | undefined, amount: number): boolean {
  if (!isShipDamaged(ship, maxHp)) return false;
  ship.currentHp = Math.min(maxHp!, ship.currentHp! + amount);
  return true;
}

/*
 * Only a fleet that stands still in the galaxy repairs: one passing
 * through a Spaceport system or a base cell does not.
 */
export function isFleetStationary(fleet: Fleet): boolean {
  return fleet.targetX === null && fleet.targetY === null;
}

export function advanceFleetRepair(input: FleetRepairInput, deltaSeconds: number): FleetRepairResult {
  const repairing = new Map<number, RepairSite>();
  let changed = false;
  if (!(deltaSeconds > 0)) return { repairing, changed };

  for (const fleet of input.fleets) {
    if (fleet.destroyed || !isFleetStationary(fleet)) continue;
    const ships = fleet.ships ?? [];
    if (!ships.some((s) => isShipDamaged(s, input.maxHp(s.type)))) continue;
    const site = input.siteFor(fleet);
    if (!site) continue;
    repairing.set(fleet.id, site);
    const share = repairRate(site) * deltaSeconds;
    for (const ship of ships) {
      const maxHp = input.maxHp(ship.type);
      if (maxHp && repairShip(ship, maxHp, maxHp * share)) changed = true;
    }
  }

  const share = FLEET_REPAIR_CONFIG.spaceportRate * deltaSeconds;
  for (const stock of input.shipStock ?? []) {
    if (!input.factionsWithSpaceport.has(stock.factionId)) continue;
    for (const entry of stock.ships ?? []) {
      const maxHp = input.maxHp(entry.type);
      if (maxHp && repairShip(entry, maxHp, maxHp * share)) changed = true;
    }
  }
  return { repairing, changed };
}

/*
 * The hull a ship carries between the fleet and the reserve: a damaged
 * ship keeps its value, a full one stores nothing (missing = full).
 */
export function carriedHp(ship: { currentHp?: number; destroyed?: boolean }, maxHp: number | undefined): number | undefined {
  return isShipDamaged(ship, maxHp) ? ship.currentHp : undefined;
}

import { Injectable } from '@angular/core';
import {
  FactionEquipmentInventory,
  FactionShipStock,
  Fleet,
  FleetShip,
  ShipStockEntry,
  StarSystem,
} from '../components/star-map/star-map.models';
import { EquipmentSlot, getModule, isSlotAllowed } from '../components/star-map/equipment';
import { addToInventory, inventoryCount, takeFromInventory } from '../components/star-map/equipment-inventory';
import { ShipService } from './ship.service';
import { SpaceportService } from './spaceport.service';

export type EquipmentFailure =
  | 'ship_not_found'
  | 'unknown_module'
  | 'slot_locked'
  | 'not_in_inventory'
  | 'not_at_spaceport'
  | 'already_installed'
  | 'nothing_installed';

export interface EquipmentResult {
  ok: boolean;
  reason?: EquipmentFailure;
}

type EquipmentData = {
  fleets: Fleet[];
  shipStock?: FactionShipStock[];
  equipmentInventory?: FactionEquipmentInventory[];
};

/* Where a ship record lives: in a fleet, or in the faction's reserve (fleet null). */
interface LocatedShip {
  ship: FleetShip | ShipStockEntry;
  fleet: Fleet | null;
}

/*
 * =========================================================
 * SHIP EQUIPMENT SERVICE — install and uninstall
 * =========================================================
 *
 * Moves modules between a faction's equipment inventory and its ships
 * (docs/ship-equipment.md, B.5–B.6). Faction-agnostic: the player's UI and,
 * later, the AI use the same rules.
 *
 * Every operation checks everything first and changes nothing on failure.
 * A swap is one operation: the new module leaves the inventory and the old
 * one (if it was a real upgrade) returns to it, so modules are never created
 * or lost here. Installing and uninstalling are free (design decision
 * 2026-11-08); building modules is the cost (ProductionService).
 *
 * Location:
 *  - a fleet ship: its fleet stands within 2 system cells of an own planet
 *    with an operational Spaceport (SpaceportService.spaceportPlanetNear);
 *  - a reserve ship: the faction owns an operational Spaceport, the same
 *    rule under which the reserve is docked and repaired
 *    (docs/fleet-organization.md#repair). The UI only offers the reserve
 *    from a fleet that meets the fleet rule.
 *
 * Unknown module ids already on a ship (quarantined save data) count as no
 * module: uninstall leaves them in place, and installing over one replaces
 * it without adding anything to the inventory.
 */
@Injectable({ providedIn: 'root' })
export class ShipEquipmentService {
  constructor(
    private readonly shipService: ShipService,
    private readonly spaceportService: SpaceportService,
  ) {}

  /* True when the fleet may be refitted where it stands (the fleet location rule). */
  canCustomizeFleet(factionId: string, fleet: Fleet, starSystems: StarSystem[]): boolean {
    return (
      fleet.factionId === factionId &&
      !fleet.destroyed &&
      this.spaceportService.spaceportPlanetNear(factionId, fleet, starSystems) !== null
    );
  }

  /* True when the faction's reserve ships may be refitted (it owns an operational Spaceport). */
  canCustomizeReserve(factionId: string, starSystems: StarSystem[]): boolean {
    return this.spaceportService.hasSpaceport(factionId, starSystems);
  }

  install(
    data: EquipmentData,
    starSystems: StarSystem[],
    request: { factionId: string; shipId: number; moduleId: string },
  ): EquipmentResult {
    const { factionId, shipId, moduleId } = request;
    const module = getModule(moduleId);
    if (!module || module.standard) {
      return { ok: false, reason: 'unknown_module' };
    }
    const located = this.locateShip(data, factionId, shipId);
    if (!located || !this.shipService.getShipType(located.ship.type)) {
      return { ok: false, reason: 'ship_not_found' };
    }
    const slot = module.slot;
    if (!isSlotAllowed(located.ship.type, slot)) {
      return { ok: false, reason: 'slot_locked' };
    }
    if (!this.atLocation(factionId, located, starSystems)) {
      return { ok: false, reason: 'not_at_spaceport' };
    }
    const current = located.ship.equipment?.[slot];
    if (current === moduleId) {
      return { ok: false, reason: 'already_installed' };
    }
    if (inventoryCount(data, factionId, moduleId) <= 0) {
      return { ok: false, reason: 'not_in_inventory' };
    }

    takeFromInventory(data, factionId, moduleId);
    if (this.isRealModule(current, slot)) {
      addToInventory(data, factionId, current!);
    }
    located.ship.equipment = { ...located.ship.equipment, [slot]: moduleId };
    return { ok: true };
  }

  uninstall(
    data: EquipmentData,
    starSystems: StarSystem[],
    request: { factionId: string; shipId: number; slot: EquipmentSlot },
  ): EquipmentResult {
    const { factionId, shipId, slot } = request;
    const located = this.locateShip(data, factionId, shipId);
    if (!located) {
      return { ok: false, reason: 'ship_not_found' };
    }
    const current = located.ship.equipment?.[slot];
    if (!this.isRealModule(current, slot)) {
      return { ok: false, reason: 'nothing_installed' };
    }
    if (!this.atLocation(factionId, located, starSystems)) {
      return { ok: false, reason: 'not_at_spaceport' };
    }

    addToInventory(data, factionId, current!);
    const rest = { ...located.ship.equipment };
    delete rest[slot];
    if (Object.keys(rest).length > 0) {
      located.ship.equipment = rest;
    } else {
      delete located.ship.equipment;
    }
    return { ok: true };
  }

  describeFailure(reason: EquipmentFailure | undefined): string {
    switch (reason) {
      case 'ship_not_found':
        return 'That ship is no longer available.';
      case 'unknown_module':
        return 'Unknown module.';
      case 'slot_locked':
        return 'Civil hulls accept engine modules only.';
      case 'not_in_inventory':
        return 'No such module in the inventory. Build one in a Spaceship Factory.';
      case 'not_at_spaceport':
        return 'Move within 2 cells of a Spaceport planet to refit.';
      case 'already_installed':
        return 'That module is already installed.';
      case 'nothing_installed':
        return 'Only the standard module is installed in this slot.';
      default:
        return 'The equipment change could not be applied.';
    }
  }

  /* A living ship of the faction, in one of its fleets or in its reserve. */
  private locateShip(data: EquipmentData, factionId: string, shipId: number): LocatedShip | null {
    for (const fleet of data.fleets ?? []) {
      if (fleet.factionId !== factionId || fleet.destroyed) {
        continue;
      }
      const ship = fleet.ships.find((s) => s.id === shipId && !s.destroyed);
      if (ship) {
        return { ship, fleet };
      }
    }
    const reserve = data.shipStock?.find((s) => s.factionId === factionId)?.ships ?? [];
    const entry = reserve.find((s) => s.id === shipId);
    return entry ? { ship: entry, fleet: null } : null;
  }

  private atLocation(factionId: string, located: LocatedShip, starSystems: StarSystem[]): boolean {
    return located.fleet
      ? this.canCustomizeFleet(factionId, located.fleet, starSystems)
      : this.canCustomizeReserve(factionId, starSystems);
  }

  /* An installed id that is a real (non-standard) module of this slot, i.e. one that counts in the inventory. */
  private isRealModule(moduleId: string | undefined, slot: EquipmentSlot): boolean {
    const module = getModule(moduleId);
    return !!module && !module.standard && module.slot === slot;
  }
}

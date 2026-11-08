import type { FactionEquipmentInventory } from './star-map.models';
import { getModule } from './equipment';

/*
 * =========================================================
 * EQUIPMENT INVENTORY — empire-wide module counts (pure)
 * =========================================================
 *
 * StarMapData.equipmentInventory holds, per faction, how many of each
 * module are available (built, not installed on any ship). Counts, not
 * instances: modules have no state. Standard modules are never counted.
 *
 * Conservation (docs/ship-equipment.md, B.5): per faction and module id,
 * inventory + modules installed on living ships changes only through a
 * completed factory order (+1, ProductionService) and the destruction of a
 * ship carrying it (−1). Install / uninstall (ShipEquipmentService) only
 * move a module between the inventory and a ship. These helpers are the
 * only writers of the counts.
 */

type InventoryHolder = { equipmentInventory?: FactionEquipmentInventory[] };

/* The faction's inventory entry, created (with no modules) on first use. */
export function inventoryOf(data: InventoryHolder, factionId: string): FactionEquipmentInventory {
  if (!Array.isArray(data.equipmentInventory)) {
    data.equipmentInventory = [];
  }
  let entry = data.equipmentInventory.find((e) => e.factionId === factionId);
  if (!entry) {
    entry = { factionId, modules: {} };
    data.equipmentInventory.push(entry);
  }
  if (!entry.modules || typeof entry.modules !== 'object') {
    entry.modules = {};
  }
  return entry;
}

/*
 * Available count of a module. Read-only: never creates an entry. Unknown
 * or standard ids and malformed counts read as 0, so a save with stray
 * entries (validation warnings) can't hand out modules that don't exist.
 */
export function inventoryCount(data: InventoryHolder, factionId: string, moduleId: string): number {
  const module = getModule(moduleId);
  if (!module || module.standard) {
    return 0;
  }
  const count = data.equipmentInventory?.find((e) => e.factionId === factionId)?.modules?.[moduleId];
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0;
}

/* Adds modules; standard or unknown ids and non-positive amounts are ignored. Returns whether anything changed. */
export function addToInventory(data: InventoryHolder, factionId: string, moduleId: string, amount = 1): boolean {
  const module = getModule(moduleId);
  if (!module || module.standard || !Number.isInteger(amount) || amount <= 0) {
    return false;
  }
  const entry = inventoryOf(data, factionId);
  entry.modules[moduleId] = inventoryCount(data, factionId, moduleId) + amount;
  return true;
}

/* Takes one module out; false (and nothing changes) when none is available. */
export function takeFromInventory(data: InventoryHolder, factionId: string, moduleId: string): boolean {
  const available = inventoryCount(data, factionId, moduleId);
  if (available <= 0) {
    return false;
  }
  const entry = inventoryOf(data, factionId);
  if (available === 1) {
    delete entry.modules[moduleId];
  } else {
    entry.modules[moduleId] = available - 1;
  }
  return true;
}

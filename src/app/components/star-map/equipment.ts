import equipmentData from './equipment-data.json';
import type { WeaponType } from '../battle-screen/battle/battle-grid';

/*
 * =========================================================
 * SHIP EQUIPMENT — catalog and loadouts (pure)
 * =========================================================
 *
 * Every ship has three slots (engine, weapon, defense). The module
 * definitions live in equipment-data.json (the source of truth for module
 * stats and prices); a ship stores only module ids per slot (ShipLoadout),
 * and a missing or unusable id means the slot's standard module.
 *
 * Standard modules add nothing, so a ship with a standard loadout resolves
 * to exactly the stats of its ShipType. That identity is what keeps
 * existing fleets, saves and balance unchanged; ship-stats.spec.ts pins it.
 *
 * Module modifiers are fixed amounts, the same on every hull (design
 * decision 2026-11-08). The only multiplier is a weapon's fireRateFactor.
 * Stats are resolved in ship-stats.ts. See docs/ship-equipment.md.
 */

export type EquipmentSlot = 'engine' | 'weapon' | 'defense';

export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = ['engine', 'weapon', 'defense'];

/*
 * Stats a module may change, in the units of the matching ShipType / Fleet
 * field: battleSpeed = ShipType.speed (before BATTLE_SPEED_MULTIPLIER),
 * turnRate = degrees per battle second, strategicSpeed = Fleet.speed.
 */
export type EquipmentStat =
  | 'attack'
  | 'range'
  | 'battleSpeed'
  | 'turnRate'
  | 'strategicSpeed'
  | 'shield'
  | 'shieldRegen'
  | 'defense';

export interface EquipmentModifier {
  stat: EquipmentStat;
  /* Fixed amount added on every hull; negative values are trade-offs. */
  add: number;
}

export interface EquipmentDefinition {
  id: string;
  name: string;
  slot: EquipmentSlot;
  description: string;
  /* Factory module: adds nothing, never in an inventory, cannot be built. */
  standard?: boolean;
  modifiers: EquipmentModifier[];
  /* Weapon: replaces the hull's attackType. */
  attackType?: WeaponType;
  /* Weapon: factor on the hull's fireRate. Unlike the hull's own rate it changes damage per second. */
  fireRateFactor?: number;
  /* Defense: replaces the hull's defense profile (ShipType.weakness = the resisted damage type). */
  resistType?: WeaponType;
  /* Price of one module, paid when the factory order is queued. */
  price?: { credits: number; rawmaterials: number };
  /* Seconds at one Spaceship Factory; see moduleBuildTime for the default. */
  buildTime?: number;
}

/* Module id per slot. A missing slot is the standard module. */
export type ShipLoadout = Partial<Record<EquipmentSlot, string>>;

/* A loadout with every slot resolved to a usable module. */
export type ResolvedLoadout = Record<EquipmentSlot, EquipmentDefinition>;

interface EquipmentCatalogData {
  modules: EquipmentDefinition[];
  /* Hulls that accept only the listed slots (civil hulls: engine only). Others accept all three. */
  restrictedHulls: Record<string, EquipmentSlot[]>;
}

const CATALOG = equipmentData as EquipmentCatalogData;

const MODULES_BY_ID: ReadonlyMap<string, EquipmentDefinition> = new Map(CATALOG.modules.map((m) => [m.id, m]));

export const STANDARD_MODULE_IDS: Readonly<Record<EquipmentSlot, string>> = {
  engine: 'standard_engine',
  weapon: 'standard_weapon',
  defense: 'standard_defense',
};

/* Same default as ship build times (ShipService: cost / 10 seconds at one factory). */
const DEFAULT_BUILD_SECONDS_PER_CREDIT = 0.1;

export function getAllModules(): readonly EquipmentDefinition[] {
  return CATALOG.modules;
}

export function getModule(id: string | null | undefined): EquipmentDefinition | undefined {
  return id ? MODULES_BY_ID.get(id) : undefined;
}

export function getStandardModule(slot: EquipmentSlot): EquipmentDefinition {
  return MODULES_BY_ID.get(STANDARD_MODULE_IDS[slot])!;
}

/* Modules a faction can build and install, i.e. everything but the standard ones. */
export function getUpgradeModules(slot?: EquipmentSlot): EquipmentDefinition[] {
  return CATALOG.modules.filter((m) => !m.standard && (slot === undefined || m.slot === slot));
}

export function allowedSlots(shipTypeId: string): readonly EquipmentSlot[] {
  return CATALOG.restrictedHulls[shipTypeId] ?? EQUIPMENT_SLOTS;
}

export function isSlotAllowed(shipTypeId: string, slot: EquipmentSlot): boolean {
  return allowedSlots(shipTypeId).includes(slot);
}

export function moduleBuildTime(module: EquipmentDefinition): number {
  return module.buildTime ?? Math.max(1, (module.price?.credits ?? 0) * DEFAULT_BUILD_SECONDS_PER_CREDIT);
}

/*
 * The module a ship actually uses in a slot. An unknown id, a module of
 * another slot, or a slot the hull doesn't accept falls back to the
 * standard module. Saves keep such raw ids untouched (quarantine), so a
 * later catalog that knows them gets them back; only resolution ignores
 * them.
 */
export function moduleInSlot(shipTypeId: string, loadout: ShipLoadout | null | undefined, slot: EquipmentSlot): EquipmentDefinition {
  const module = getModule(loadout?.[slot]);
  if (!module || module.slot !== slot || !isSlotAllowed(shipTypeId, slot)) {
    return getStandardModule(slot);
  }
  return module;
}

export function resolveLoadout(shipTypeId: string, loadout: ShipLoadout | null | undefined): ResolvedLoadout {
  return {
    engine: moduleInSlot(shipTypeId, loadout, 'engine'),
    weapon: moduleInSlot(shipTypeId, loadout, 'weapon'),
    defense: moduleInSlot(shipTypeId, loadout, 'defense'),
  };
}

/*
 * Stable key of the modules a ship actually uses; '' for a standard
 * loadout. Battle stacks group ships by type + this key (stack-level
 * speed, range and fire rate must hold for every ship in a stack), and
 * standard ships keep the key '' so they group exactly as before.
 */
export function loadoutKey(shipTypeId: string, loadout: ShipLoadout | null | undefined): string {
  const resolved = resolveLoadout(shipTypeId, loadout);
  return EQUIPMENT_SLOTS
    .filter((slot) => !resolved[slot].standard)
    .map((slot) => `${slot}=${resolved[slot].id}`)
    .join('|');
}

/*
 * The `equipment` field to put on a rebuilt ship record: a copy of the
 * source's loadout, or nothing when it has none. Every place that builds a
 * new FleetShip / ShipStockEntry from an existing one (stock ↔ fleet,
 * disband, battle write-back) spreads this, so modules can't get lost when
 * the record object changes. Raw ids are copied as they are (unknown ids
 * stay quarantined, see moduleInSlot). The copy keeps the two records
 * from sharing one loadout object.
 */
export function copyEquipment(source: { equipment?: ShipLoadout | null }): { equipment?: ShipLoadout } {
  const loadout = source.equipment;
  if (!loadout || typeof loadout !== 'object' || Object.keys(loadout).length === 0) {
    return {};
  }
  return { equipment: { ...loadout } };
}

/* True when the ship uses at least one non-standard module. */
export function hasUpgrades(shipTypeId: string, loadout: ShipLoadout | null | undefined): boolean {
  return loadoutKey(shipTypeId, loadout) !== '';
}

/* Sum of a module set's fixed additions to one stat. */
export function sumModifier(modules: readonly EquipmentDefinition[], stat: EquipmentStat): number {
  let total = 0;
  for (const module of modules) {
    for (const modifier of module.modifiers) {
      if (modifier.stat === stat) {
        total += modifier.add;
      }
    }
  }
  return total;
}

/* True when any of the modules changes the stat (used to apply floors only where a module acts). */
export function touchesStat(modules: readonly EquipmentDefinition[], stat: EquipmentStat): boolean {
  return modules.some((m) => m.modifiers.some((mod) => mod.stat === stat));
}

const STAT_LABELS: Record<EquipmentStat, string> = {
  attack: 'attack',
  range: 'range',
  battleSpeed: 'battle speed',
  turnRate: 'turn rate (°/s)',
  strategicSpeed: 'map speed',
  shield: 'shield',
  shieldRegen: 'shield regen',
  defense: 'armour',
};

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

/*
 * Player-facing effect lines of a module, generated from the data so the
 * UI (production dialog, customization screen) can't drift from the rules.
 */
export function describeModuleEffects(module: EquipmentDefinition): string[] {
  const lines: string[] = [];
  if (module.attackType) {
    lines.push(`${module.attackType} damage`);
  }
  if (module.resistType) {
    lines.push(`resists ${module.resistType}`);
  }
  for (const modifier of module.modifiers) {
    lines.push(`${signed(modifier.add)} ${STAT_LABELS[modifier.stat]}`);
  }
  if (module.fireRateFactor !== undefined && module.fireRateFactor !== 1) {
    lines.push(`fire rate ×${module.fireRateFactor}`);
  }
  return lines;
}

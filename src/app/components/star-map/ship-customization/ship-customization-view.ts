import type { ShipType } from '../../../services/ship.service';
import { weaponMultiplier } from '../../battle-screen/battle/battle-grid';
import { armorReductionPercent } from '../hull-class';
import {
  EQUIPMENT_SLOTS,
  EquipmentDefinition,
  EquipmentSlot,
  ShipLoadout,
  getUpgradeModules,
  isSlotAllowed,
  moduleInSlot,
} from '../equipment';
import { ResolvedShipStats, effectiveFleetSpeed, resolveShipStats } from '../ship-stats';
import type { Fleet, FleetShip, ShipStockEntry } from '../star-map.models';

/*
 * =========================================================
 * SHIP CUSTOMIZATION — view model (pure)
 * =========================================================
 *
 * Everything the Ship Customization screen shows is computed here from the
 * live fleet, the reserve and the rules in equipment.ts / ship-stats.ts, so
 * the template only renders. Kept separate from the component so the texts
 * and numbers are unit tested and can't drift from battle and movement.
 * See docs/ship-equipment.md (D).
 */

export const SLOT_LABELS: Record<EquipmentSlot, string> = {
  engine: 'Engine',
  weapon: 'Weapon',
  defense: 'Defense',
};

const DAMAGE_TYPES = ['kinetic', 'energy', 'missile'] as const;

export interface RosterShip {
  id: number;
  name: string;
  typeId: string;
  typeName: string;
  /* Hull left, 0–100. */
  hullPercent: number;
  /* Which slots carry a non-standard module. */
  upgraded: Record<EquipmentSlot, boolean>;
}

export interface RosterGroup {
  key: string;
  label: string;
  reserve: boolean;
  ships: RosterShip[];
}

export interface StatLine {
  key: string;
  label: string;
  value: string;
}

export interface ComparisonLine {
  label: string;
  from: string;
  to: string;
  /* +1 better, −1 worse, 0 changed without a direction (a type), null unchanged. */
  trend: 1 | -1 | 0 | null;
}

export interface ModuleOption {
  module: EquipmentDefinition;
  available: number;
  inProduction: number;
  unlocked: boolean;
  /* Technology name that unlocks it, for locked modules. */
  lockedBy: string | null;
  installed: boolean;
}

type AnyShip = FleetShip | ShipStockEntry;

const living = (ships: readonly FleetShip[]) => ships.filter((s) => !s.destroyed);

export function hullPercent(ship: AnyShip, shipType: ShipType | undefined): number {
  const max = shipType?.hitPoints ?? 0;
  if (max <= 0) return 100;
  const hp = typeof ship.currentHp === 'number' && Number.isFinite(ship.currentHp) ? ship.currentHp : max;
  return Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
}

/* The roster: the fleet's living ships, then the reserve, each grouped in fleet order. */
export function buildRoster(
  fleet: Fleet,
  reserve: readonly ShipStockEntry[] | null,
  shipType: (id: string) => ShipType | undefined,
): RosterGroup[] {
  const toRow = (ship: AnyShip): RosterShip => {
    const type = shipType(ship.type);
    const upgraded = {} as Record<EquipmentSlot, boolean>;
    for (const slot of EQUIPMENT_SLOTS) {
      upgraded[slot] = !moduleInSlot(ship.type, ship.equipment, slot).standard;
    }
    return { id: ship.id, name: ship.name, typeId: ship.type, typeName: type?.name ?? ship.type, hullPercent: hullPercent(ship, type), upgraded };
  };
  const groups: RosterGroup[] = [{ key: `fleet-${fleet.id}`, label: fleet.name, reserve: false, ships: living(fleet.ships).map(toRow) }];
  if (reserve && reserve.length > 0) {
    groups.push({ key: 'reserve', label: 'Reserve', reserve: true, ships: reserve.map(toRow) });
  }
  return groups;
}

export function findShip(fleet: Fleet, reserve: readonly ShipStockEntry[] | null, shipId: number | null): AnyShip | null {
  if (shipId == null) return null;
  return living(fleet.ships).find((s) => s.id === shipId) ?? reserve?.find((s) => s.id === shipId) ?? null;
}

/* The damage type that deals 1.2× to a defense profile (the profile's weakness in the damage table). */
export function weakTo(profile: string): string {
  return DAMAGE_TYPES.find((type) => weaponMultiplier(type, profile) > 1) ?? '—';
}

const fmt = (value: number, digits = 1): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(digits).replace(/\.0+$/, '');

/* The resolved stats as display lines (battle values; speed in ship-data units). */
export function statLines(shipType: ShipType, stats: ResolvedShipStats): StatLine[] {
  return [
    { key: 'hull', label: 'Hull', value: `${shipType.hitPoints}` },
    { key: 'shield', label: 'Shield', value: fmt(stats.shield) },
    { key: 'regen', label: 'Regen', value: fmt(stats.shieldRegen) },
    { key: 'armour', label: 'Armour', value: `${fmt(stats.defense)} (−${armorReductionPercent(stats.defense)}%)` },
    { key: 'attack', label: 'Attack', value: fmt(stats.attack) },
    { key: 'fire', label: 'Fire rate', value: `${fmt(stats.fireRate, 2)}/s` },
    { key: 'damage', label: 'Damage', value: stats.attackType },
    { key: 'profile', label: 'Resists', value: `${stats.weakness} · weak to ${weakTo(stats.weakness)}` },
    { key: 'speed', label: 'Battle speed', value: fmt(stats.battleSpeed) },
    { key: 'range', label: 'Range', value: fmt(stats.range) },
  ];
}

/* Damage per second relative to the hull (attack × fire rate, the rule in battle.types volleyShare). */
function damagePerSecond(stats: ResolvedShipStats): number {
  return stats.attack * (stats.fireRate / stats.hullFireRate);
}

/*
 * Current vs. candidate values for one ship, only for what changes.
 * `fleet` gives the map-speed line for engines (the fleet moves at its
 * slowest engine), with the candidate fitted on this ship.
 */
export function compareLoadouts(
  shipType: ShipType,
  ship: AnyShip,
  candidate: ShipLoadout,
  fleet: Fleet | null,
): ComparisonLine[] {
  const now = resolveShipStats(shipType, ship.equipment);
  const next = resolveShipStats(shipType, candidate);
  const lines: ComparisonLine[] = [];
  const num = (label: string, a: number, b: number, higherIsBetter = true, digits = 1) => {
    if (Math.abs(a - b) < 1e-9) return;
    lines.push({ label, from: fmt(a, digits), to: fmt(b, digits), trend: (b > a) === higherIsBetter ? 1 : -1 });
  };
  const text = (label: string, a: string, b: string) => {
    if (a !== b) lines.push({ label, from: a, to: b, trend: 0 });
  };
  num('Attack', now.attack, next.attack);
  num('Damage / s', damagePerSecond(now), damagePerSecond(next));
  num('Fire rate', now.fireRate, next.fireRate, true, 2);
  text('Damage type', now.attackType, next.attackType);
  num('Range', now.range, next.range);
  num('Shield', now.shield, next.shield);
  num('Regen', now.shieldRegen, next.shieldRegen);
  num('Armour', now.defense, next.defense);
  text('Resists', `${now.weakness} (weak to ${weakTo(now.weakness)})`, `${next.weakness} (weak to ${weakTo(next.weakness)})`);
  num('Battle speed', now.battleSpeed, next.battleSpeed);
  num('Turn rate (°/s)', now.turnRateBonus, next.turnRateBonus);
  num('Map speed bonus', now.strategicSpeedBonus, next.strategicSpeedBonus);
  if (fleet && fleet.ships.some((s) => s.id === ship.id) && now.strategicSpeedBonus !== next.strategicSpeedBonus) {
    const before = effectiveFleetSpeed(fleet);
    const after = effectiveFleetSpeed({
      speed: fleet.speed,
      ships: fleet.ships.map((s) => (s.id === ship.id ? { ...s, equipment: candidate } : s)),
    });
    if (before !== after) {
      num('Fleet map speed', before, after);
    } else {
      // The fleet moves at its slowest engine: say why this engine doesn't speed it up yet.
      lines.push({ label: 'Fleet map speed', from: fmt(before), to: `${fmt(after)} (slowest engine)`, trend: null });
    }
  }
  return lines;
}

/* The loadout after putting `moduleId` (or the standard module, null) into `slot`. */
export function withModule(loadout: ShipLoadout | undefined, slot: EquipmentSlot, moduleId: string | null): ShipLoadout {
  const next: ShipLoadout = { ...loadout };
  if (moduleId) {
    next[slot] = moduleId;
  } else {
    delete next[slot];
  }
  return next;
}

/* Every upgrade module for a slot, with what the faction has of it. */
export function moduleOptions(
  slot: EquipmentSlot,
  installedId: string,
  inventory: Readonly<Record<string, number>>,
  inProduction: Readonly<Record<string, number>>,
  unlocked: ReadonlySet<string>,
  lockedBy: Readonly<Record<string, string>>,
): ModuleOption[] {
  return getUpgradeModules(slot).map((module) => ({
    module,
    available: inventory[module.id] ?? 0,
    inProduction: inProduction[module.id] ?? 0,
    unlocked: unlocked.has(module.id),
    lockedBy: unlocked.has(module.id) ? null : lockedBy[module.id] ?? null,
    installed: module.id === installedId,
  }));
}

export function slotAllowed(typeId: string, slot: EquipmentSlot): boolean {
  return isSlotAllowed(typeId, slot);
}

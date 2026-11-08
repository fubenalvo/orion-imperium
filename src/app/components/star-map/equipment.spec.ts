import { describe, it, expect } from 'vitest';
import shipData from './ship-data.json';
import {
  EQUIPMENT_SLOTS,
  STANDARD_MODULE_IDS,
  allowedSlots,
  describeModuleEffects,
  getAllModules,
  getModule,
  getUpgradeModules,
  hasUpgrades,
  loadoutKey,
  moduleBuildTime,
  moduleInSlot,
  resolveLoadout,
} from './equipment';

const shipTypeIds = (shipData as { shipTypes: { id: string }[] }).shipTypes.map((t) => t.id);
const WEAPON_TYPES = ['kinetic', 'energy', 'missile'];

describe('equipment catalog', () => {
  it('has unique module ids', () => {
    const ids = getAllModules().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one standard module per slot, adding nothing', () => {
    for (const slot of EQUIPMENT_SLOTS) {
      const standard = getAllModules().filter((m) => m.slot === slot && m.standard);
      expect(standard.map((m) => m.id)).toEqual([STANDARD_MODULE_IDS[slot]]);
      const [module] = standard;
      expect(module.modifiers).toEqual([]);
      expect(module.attackType).toBeUndefined();
      expect(module.resistType).toBeUndefined();
      expect(module.fireRateFactor).toBeUndefined();
      expect(module.price).toBeUndefined();
    }
  });

  it('gives every upgrade module a positive price and at least one effect', () => {
    for (const module of getUpgradeModules()) {
      expect(module.price!.credits, module.id).toBeGreaterThan(0);
      expect(module.price!.rawmaterials, module.id).toBeGreaterThan(0);
      expect(describeModuleEffects(module).length, module.id).toBeGreaterThan(0);
      expect(moduleBuildTime(module), module.id).toBeGreaterThan(0);
    }
  });

  it('keeps each stat in its slot and type overrides in the right slot', () => {
    const slotStats = {
      engine: ['battleSpeed', 'turnRate', 'strategicSpeed'],
      weapon: ['attack', 'range', 'battleSpeed'],
      defense: ['shield', 'shieldRegen', 'defense', 'battleSpeed'],
    };
    for (const module of getAllModules()) {
      for (const modifier of module.modifiers) {
        expect(slotStats[module.slot], `${module.id}: ${modifier.stat}`).toContain(modifier.stat);
        expect(Number.isFinite(modifier.add)).toBe(true);
      }
      if (module.attackType) {
        expect(module.slot).toBe('weapon');
        expect(WEAPON_TYPES).toContain(module.attackType);
      }
      if (module.resistType) {
        expect(module.slot).toBe('defense');
        expect(WEAPON_TYPES).toContain(module.resistType);
      }
      if (module.fireRateFactor !== undefined) {
        expect(module.slot).toBe('weapon');
        // Fire rate changes damage per second; keep it inside the design limit (docs/ship-equipment.md, C.1).
        expect(module.fireRateFactor).toBeGreaterThanOrEqual(0.85);
        expect(module.fireRateFactor).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('offers one weapon per damage type and one defense per profile', () => {
    expect(getUpgradeModules('weapon').map((m) => m.attackType).sort()).toEqual([...WEAPON_TYPES].sort());
    const profiles = getUpgradeModules('defense').map((m) => m.resistType).filter((t) => t !== undefined);
    expect(profiles.sort()).toEqual([...WEAPON_TYPES].sort());
  });

  it('defaults build time to price / 10 seconds, like ships', () => {
    expect(moduleBuildTime(getModule('railgun')!)).toBe(30);
  });

  it('restricts only known hulls, and civil hulls to the engine slot', () => {
    for (const id of ['colonizer', 'outpost_ship', 'swarm_constructor']) {
      expect(shipTypeIds).toContain(id);
      expect(allowedSlots(id)).toEqual(['engine']);
    }
    expect(allowedSlots('cruiser')).toEqual(EQUIPMENT_SLOTS);
  });
});

describe('loadout resolution', () => {
  it('fills missing slots with standard modules', () => {
    const resolved = resolveLoadout('cruiser', { weapon: 'railgun' });
    expect(resolved.engine.id).toBe('standard_engine');
    expect(resolved.weapon.id).toBe('railgun');
    expect(resolved.defense.id).toBe('standard_defense');
    expect(resolveLoadout('cruiser', undefined).weapon.id).toBe('standard_weapon');
  });

  it('falls back to standard for unknown ids, wrong slots and locked hull slots', () => {
    expect(moduleInSlot('cruiser', { weapon: 'no_such_module' }, 'weapon').id).toBe('standard_weapon');
    expect(moduleInSlot('cruiser', { weapon: 'energy_shield' }, 'weapon').id).toBe('standard_weapon');
    expect(moduleInSlot('colonizer', { weapon: 'railgun' }, 'weapon').id).toBe('standard_weapon');
    expect(moduleInSlot('colonizer', { engine: 'warp_drive' }, 'engine').id).toBe('warp_drive');
  });

  it('keys standard loadouts as empty and others by the modules actually used', () => {
    expect(loadoutKey('cruiser', undefined)).toBe('');
    expect(loadoutKey('cruiser', { engine: 'standard_engine', weapon: 'bogus' })).toBe('');
    expect(loadoutKey('cruiser', { defense: 'energy_shield', engine: 'ion_engine' })).toBe('engine=ion_engine|defense=energy_shield');
    expect(loadoutKey('colonizer', { weapon: 'railgun' })).toBe('');
    expect(hasUpgrades('cruiser', { weapon: 'railgun' })).toBe(true);
    expect(hasUpgrades('cruiser', {})).toBe(false);
  });

  it('describes effects from the data', () => {
    expect(describeModuleEffects(getModule('laser_cannon')!)).toEqual(['energy damage', '+8 attack', 'fire rate ×1.2']);
    expect(describeModuleEffects(getModule('kinetic_barrier')!)).toEqual(['resists kinetic', '+6 armour', '-0.2 battle speed']);
  });
});

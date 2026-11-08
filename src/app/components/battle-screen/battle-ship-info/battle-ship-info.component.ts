import { Component, EventEmitter, Input, Output } from '@angular/core';
import { BATTLE_SPEED_MULTIPLIER, BattleStack, damagePerSecondFactor } from '../battle/battle.types';
import { weaponMultiplier } from '../battle/battle-grid';
import { armorReductionPercent, hullClassMultiplier } from '../../star-map/hull-class';
import { EQUIPMENT_SLOTS, EquipmentSlot, isSlotAllowed, moduleInSlot } from '../../star-map/equipment';

const DAMAGE_TYPES = ['kinetic', 'energy', 'missile'] as const;

export interface ShipInfoLine {
  label: string;
  value: string;
}

export interface ShipInfoSlot {
  slot: EquipmentSlot;
  label: string;
  name: string;
  standard: boolean;
  locked: boolean;
}

/*
 * =========================================================
 * BATTLE SHIP INFO WINDOW
 * =========================================================
 *
 * Left-clicking any stack, own or enemy, opens this window
 * (docs/ship-equipment.md, D.6): the stack's hull and class, its installed
 * modules and the values it fights with. With an own stack selected and an
 * enemy inspected it adds the matchup both ways (damage type × hull class),
 * from the same tables the damage formula uses, so the player can judge a
 * fight before unpausing. Battle-local and read-only: it never changes
 * battle state. Values are those of the stack's front living ship
 * (stacks are homogeneous by type and loadout).
 */
@Component({
  selector: 'app-battle-ship-info',
  standalone: true,
  templateUrl: './battle-ship-info.component.html',
  styleUrl: './battle-ship-info.component.scss',
})
export class BattleShipInfoComponent {
  @Input({ required: true }) stack!: BattleStack;
  /* The player's selected stack, for the matchup line; null hides it. */
  @Input() viewer: BattleStack | null = null;
  @Input() factionColor = '#ffffff';
  @Input() sideLabel = '';
  @Output() close = new EventEmitter<void>();

  readonly slotLabels: Record<EquipmentSlot, string> = { engine: 'Engine', weapon: 'Weapon', defense: 'Defense' };

  private get front() {
    return this.stack.ships.find((s) => s.alive) ?? this.stack.ships[0];
  }

  get alive(): number {
    return this.stack.ships.filter((s) => s.alive).length;
  }

  /* Static defenses (turrets, station cores) have no equipment slots. */
  get isStructure(): boolean {
    return this.stack.hullClass === 'structure' || this.stack.immobile;
  }

  get slots(): ShipInfoSlot[] {
    if (this.isStructure) return [];
    return EQUIPMENT_SLOTS.map((slot) => {
      const module = moduleInSlot(this.stack.typeId, this.stack.loadout, slot);
      return {
        slot,
        label: this.slotLabels[slot],
        name: module.name,
        standard: !!module.standard,
        locked: !isSlotAllowed(this.stack.typeId, slot),
      };
    });
  }

  get lines(): ShipInfoLine[] {
    const ship = this.front;
    if (!ship) return [];
    const fmt = (v: number, d = 1) => (Number.isInteger(v) ? `${v}` : v.toFixed(d));
    const weakTo = DAMAGE_TYPES.find((t) => weaponMultiplier(t, ship.weakness) > 1) ?? '—';
    return [
      { label: 'Attack', value: `${fmt(ship.attack)} ${ship.attackType}` },
      { label: 'Fire rate', value: `${fmt(this.stack.fireRate, 2)}/s` },
      { label: 'Damage / s', value: `×${fmt(damagePerSecondFactor(this.stack), 2)} of hull` },
      { label: 'Armour', value: `${fmt(ship.defense)} (−${armorReductionPercent(ship.defense)}%)` },
      { label: 'Shield', value: `${fmt(ship.shield)} / ${fmt(ship.maxShield)} · +${fmt(ship.shieldRegen)}` },
      { label: 'Resists', value: `${ship.weakness} · weak to ${weakTo}` },
      { label: 'Speed', value: fmt(this.stack.speed / BATTLE_SPEED_MULTIPLIER) },
      { label: 'Range', value: fmt(this.stack.attackRange) },
    ];
  }

  /*
   * "Your X deals 1.2× · takes 0.8×" for an enemy inspected while an own
   * stack is selected: damage type × hull class, each way.
   */
  get matchup(): { deals: string; takes: string; dealsTrend: number; takesTrend: number } | null {
    const own = this.viewer;
    if (!own || own.side === this.stack.side) return null;
    const ownShip = own.ships.find((s) => s.alive);
    const target = this.front;
    if (!ownShip || !target) return null;
    const deals = weaponMultiplier(ownShip.attackType, target.weakness) * hullClassMultiplier(own.hullClass ?? 'medium', this.stack.hullClass ?? 'medium');
    const takes = weaponMultiplier(target.attackType, ownShip.weakness) * hullClassMultiplier(this.stack.hullClass ?? 'medium', own.hullClass ?? 'medium');
    const show = (v: number) => `×${(Math.round(v * 100) / 100).toString()}`;
    return { deals: show(deals), takes: show(takes), dealsTrend: Math.sign(deals - 1), takesTrend: Math.sign(1 - takes) };
  }

  get viewerName(): string {
    return this.viewer?.typeName ?? '';
  }
}

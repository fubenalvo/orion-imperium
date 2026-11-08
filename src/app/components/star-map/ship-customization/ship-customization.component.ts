import { Component, EventEmitter, HostListener, Input, OnChanges, Output } from '@angular/core';
import { ShipService, ShipType } from '../../../services/ship.service';
import { shipIconFor } from '../../battle-screen/battle-grid/ship-icons';
import { HullRoleComponent } from '../hull-role/hull-role.component';
import { isCombatShipType } from '../ai-queries';
import { EQUIPMENT_SLOTS, EquipmentDefinition, EquipmentSlot, describeModuleEffects, moduleInSlot } from '../equipment';
import { resolveShipStats } from '../ship-stats';
import type { Fleet, ShipStockEntry } from '../star-map.models';
import {
  ComparisonLine,
  ModuleOption,
  RosterGroup,
  SLOT_LABELS,
  StatLine,
  buildRoster,
  compareLoadouts,
  findShip,
  moduleOptions,
  slotAllowed,
  statLines,
  withModule,
} from './ship-customization-view';

export interface InstallRequest {
  shipId: number;
  moduleId: string;
}

export interface UninstallRequest {
  shipId: number;
  slot: EquipmentSlot;
}

/*
 * =========================================================
 * SHIP CUSTOMIZATION SCREEN
 * =========================================================
 *
 * Full-screen refit console for one fleet (plus the reserve), opened from
 * the fleet panel near an own Spaceport planet (docs/ship-equipment.md, D).
 * StarMap hosts it as a deferred overlay like Fleet Command: the game is
 * paused while it is open, every confirmed change is applied at once
 * through ShipEquipmentService by StarMap (this component only emits), and
 * StarMap autosaves on close.
 *
 * Flow: pick a ship in the roster → click a hardpoint on the blueprint →
 * pick a module (or REMOVE) → CONFIRM / CANCEL. All numbers come from
 * ship-customization-view.ts, so they match battle and movement.
 */
@Component({
  selector: 'app-ship-customization',
  standalone: true,
  imports: [HullRoleComponent],
  templateUrl: './ship-customization.component.html',
  styleUrl: './ship-customization.component.scss',
})
export class ShipCustomizationComponent implements OnChanges {
  @Input({ required: true }) fleet!: Fleet;
  /* The faction's reserve when it may be refitted; null hides it. */
  @Input() reserve: ShipStockEntry[] | null = null;
  @Input() inventory: Record<string, number> = {};
  @Input() inProduction: Record<string, number> = {};
  @Input() unlockedModuleIds: string[] = [];
  /* Technology name per locked module id. */
  @Input() lockedBy: Record<string, string> = {};
  @Input() factionColor = '#ffffff';
  @Input() locationLabel = '';
  @Input() error: string | null = null;

  @Output() install = new EventEmitter<InstallRequest>();
  @Output() uninstall = new EventEmitter<UninstallRequest>();
  @Output() close = new EventEmitter<void>();

  readonly slots = EQUIPMENT_SLOTS;
  readonly slotLabels = SLOT_LABELS;

  selectedShipId: number | null = null;
  selectedSlot: EquipmentSlot | null = null;
  /* Module picked for the selected slot; 'standard' = REMOVE; null = nothing picked. */
  candidateId: string | null = null;

  constructor(private readonly shipService: ShipService) {}

  ngOnChanges(): void {
    if (!this.selectedShip) {
      this.selectedShipId = this.roster[0]?.ships[0]?.id ?? null;
      this.selectedSlot = null;
      this.candidateId = null;
    }
  }

  get roster(): RosterGroup[] {
    return buildRoster(this.fleet, this.reserve, (id) => this.shipService.getShipType(id));
  }

  get shipCount(): number {
    return this.roster.reduce((sum, g) => sum + g.ships.length, 0);
  }

  get selectedShip() {
    return findShip(this.fleet, this.reserve, this.selectedShipId);
  }

  get selectedType(): ShipType | undefined {
    const ship = this.selectedShip;
    return ship ? this.shipService.getShipType(ship.type) : undefined;
  }

  get selectedInFleet(): boolean {
    const id = this.selectedShipId;
    return this.fleet.ships.some((s) => s.id === id);
  }

  get stats(): StatLine[] {
    const ship = this.selectedShip;
    const type = this.selectedType;
    return ship && type ? statLines(type, resolveShipStats(type, ship.equipment)) : [];
  }

  isCombat(type: ShipType | undefined): boolean {
    return !!type && isCombatShipType(type);
  }

  installedModule(slot: EquipmentSlot): EquipmentDefinition {
    const ship = this.selectedShip;
    return moduleInSlot(ship?.type ?? '', ship?.equipment, slot);
  }

  slotLocked(slot: EquipmentSlot): boolean {
    const ship = this.selectedShip;
    return !!ship && !slotAllowed(ship.type, slot);
  }

  get options(): ModuleOption[] {
    if (!this.selectedSlot) return [];
    return moduleOptions(
      this.selectedSlot,
      this.installedModule(this.selectedSlot).id,
      this.inventory,
      this.inProduction,
      new Set(this.unlockedModuleIds),
      this.lockedBy,
    );
  }

  get candidate(): EquipmentDefinition | null {
    if (!this.candidateId || !this.selectedSlot) return null;
    return this.candidateId === 'standard'
      ? moduleInSlot('', undefined, this.selectedSlot)
      : this.options.find((o) => o.module.id === this.candidateId)?.module ?? null;
  }

  get comparison(): ComparisonLine[] {
    const ship = this.selectedShip;
    const type = this.selectedType;
    if (!ship || !type || !this.selectedSlot || !this.candidateId) return [];
    const next = withModule(ship.equipment, this.selectedSlot, this.candidateId === 'standard' ? null : this.candidateId);
    return compareLoadouts(type, ship, next, this.selectedInFleet ? this.fleet : null);
  }

  /* Why CONFIRM is disabled, or null when it can be pressed. */
  get confirmBlocker(): string | null {
    if (!this.selectedSlot || !this.candidateId) return 'Pick a module.';
    if (this.candidateId === 'standard') {
      return this.installedModule(this.selectedSlot).standard ? 'The standard module is already installed.' : null;
    }
    const option = this.options.find((o) => o.module.id === this.candidateId);
    if (!option) return 'Pick a module.';
    if (option.installed) return 'Already installed.';
    if (!option.unlocked) return `Needs ${option.lockedBy ?? 'research'}.`;
    if (option.available <= 0) return 'None in the inventory. Build it in a Spaceship Factory.';
    return null;
  }

  effects(module: EquipmentDefinition): string[] {
    return describeModuleEffects(module);
  }

  iconHref(typeId: string): string {
    return shipIconFor(typeId).href;
  }

  /* Blueprint aspect from the SVG's natural size, so every hull fills the stage the same way. */
  iconAspect(typeId: string): number {
    const def = shipIconFor(typeId);
    return def.width / def.height;
  }

  rowIconSize(typeId: string): { w: number; h: number } {
    const def = shipIconFor(typeId);
    const w = 1.3 + def.width * 0.45;
    return { w, h: (w * def.height) / def.width };
  }

  selectShip(id: number): void {
    if (id === this.selectedShipId) return;
    this.selectedShipId = id;
    this.candidateId = null;
    if (this.selectedSlot && this.slotLocked(this.selectedSlot)) {
      this.selectedSlot = null;
    }
  }

  selectSlot(slot: EquipmentSlot): void {
    if (this.slotLocked(slot)) return;
    this.selectedSlot = this.selectedSlot === slot ? null : slot;
    this.candidateId = null;
  }

  pick(moduleId: string): void {
    this.candidateId = this.candidateId === moduleId ? null : moduleId;
  }

  confirm(): void {
    const ship = this.selectedShip;
    if (!ship || !this.selectedSlot || !this.candidateId || this.confirmBlocker) return;
    if (this.candidateId === 'standard') {
      this.uninstall.emit({ shipId: ship.id, slot: this.selectedSlot });
    } else {
      this.install.emit({ shipId: ship.id, moduleId: this.candidateId });
    }
    this.candidateId = null;
  }

  cancelPick(): void {
    this.candidateId = null;
  }

  /* Escape peels back one layer: the picked module, then the slot, then the screen. */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.candidateId) {
      this.candidateId = null;
    } else if (this.selectedSlot) {
      this.selectedSlot = null;
    } else {
      this.close.emit();
    }
  }
}

import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { Fleet, ShipStockEntry } from '../star-map.models';
import {
  FLEET_NAME_MAX_LENGTH,
  FleetOrganizationPlan,
} from '../../../services/fleet-organization.service';
import { getShipTypeById } from '../star-map-display.util';
import { shipIconFor } from '../../battle-screen/battle-grid/ship-icons';
import {
  DraftFleet,
  FleetOrganizationDraft,
  RESERVE_KEY,
  ShipClassGroup,
  TransferTarget,
} from './fleet-organization-draft';

interface FleetView {
  key: string;
  fleet: DraftFleet;
  groups: ShipClassGroup[];
  shipCount: number;
  attack: number;
  defense: number;
  isNew: boolean;
  moving: boolean;
  isReserve: boolean;
}

interface Selection {
  fleetKey: string;
  /* typeId → number of ships of that class selected (1..group size). */
  counts: Record<string, number>;
}

/*
 * Fleet manager dialog ("Fleet Command"): reorganizes every friendly fleet
 * on one galaxy cell (docs/fleet-organization.md#ui).
 *
 * Interaction model, chosen so it works with mouse, touch and keyboard:
 * 1. Select ship classes in one fleet (click a row; the stepper picks how
 *    many ships of that class move, default all). A selection always
 *    belongs to a single fleet.
 * 2. Pick a destination: a "transfer here" strip appears on every other
 *    fleet, and the "new fleet" slot forms a fleet from the selection.
 *    Dragging a row (or the selection) onto a fleet does the same.
 * At an own Spaceport the host also passes the faction's ship stock, shown
 * as a "Reserve" column: ships move between it and the fleets exactly like
 * between fleets (this replaced the old REINFORCE button).
 * Everything happens in a FleetOrganizationDraft; only Apply emits a plan.
 * The host (StarMap) keeps the game paused while the dialog is open and
 * applies the plan through FleetOrganizationService.
 */
@Component({
  selector: 'app-star-map-fleet-manager',
  standalone: true,
  templateUrl: './star-map-fleet-manager.component.html',
  styleUrl: './star-map-fleet-manager.component.scss',
})
export class StarMapFleetManagerComponent implements OnInit, OnDestroy {
  /* Co-located fleets of one faction; the first one is the fleet the dialog was opened from. */
  @Input({ required: true }) fleets: Fleet[] = [];
  @Input() factionId = 'player';
  @Input() factionColor = '#ffffff';
  @Input() locationLabel = '';
  /* Names of the faction's other fleets, so suggested names stay unique. */
  @Input() reservedNames: string[] = [];
  /*
   * The faction's ship stock when the fleets stand at an own Spaceport,
   * otherwise null (no reserve column, the stock is out of reach).
   */
  @Input() reserve: ShipStockEntry[] | null = null;
  /* Rejection reason of the last apply attempt (set by the host). */
  @Input() error: string | null = null;

  @Output() apply = new EventEmitter<FleetOrganizationPlan>();
  @Output() cancel = new EventEmitter<void>();

  readonly nameMaxLength = FLEET_NAME_MAX_LENGTH;

  draft!: FleetOrganizationDraft;
  /* Real fleets (the reserve excluded). */
  views: FleetView[] = [];
  reserveView: FleetView | null = null;
  /* Board columns: the reserve (if any) first, then the fleets. */
  columns: FleetView[] = [];
  selection: Selection | null = null;
  dragOverKey: string | null = null;
  /* Fleet that just received ships; briefly highlighted. */
  flashKey: string | null = null;
  confirmDiscard = false;
  dirty = false;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private movingFleetIds = new Set<number>();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.draft = new FleetOrganizationDraft(this.fleets, this.reservedNames, this.reserve);
    this.movingFleetIds = new Set(this.fleets.filter((f) => f.targetX !== null).map((f) => f.id));
    this.refresh();
  }

  ngOnDestroy(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
    }
  }

  // ---- Derived state ------------------------------------------------------

  get totalShips(): number {
    return this.draft.totalShips;
  }

  get selectedCount(): number {
    return this.selection ? Object.values(this.selection.counts).reduce((a, b) => a + b, 0) : 0;
  }

  get selectionSource(): FleetView | undefined {
    return this.selection
      ? this.columns.find((v) => v.key === this.selection!.fleetKey)
      : undefined;
  }

  /*
   * A new fleet needs ships left behind; moving a whole fleet into a new one
   * changes nothing. The reserve may be emptied into a new fleet.
   */
  get canFormNew(): boolean {
    const source = this.selectionSource;
    if (!source || this.selectedCount === 0) {
      return false;
    }
    return source.isReserve || this.selectedCount < source.shipCount;
  }

  get summary() {
    return this.draft.summary;
  }

  get blankNames(): boolean {
    return this.draft.hasBlankNames;
  }

  canTransferTo(key: string): boolean {
    return !!this.selection && this.selection.fleetKey !== key && this.selectedCount > 0;
  }

  isSelected(fleetKey: string, typeId: string): boolean {
    return this.selection?.fleetKey === fleetKey && this.selection.counts[typeId] !== undefined;
  }

  selectedOf(typeId: string): number {
    return this.selection?.counts[typeId] ?? 0;
  }

  hullPercent(group: ShipClassGroup): number {
    return Math.round(group.condition * 100);
  }

  iconHref(typeId: string): string {
    return shipIconFor(typeId).href;
  }

  /*
   * Icon box in em. Width grows with the hull's natural length (fighter
   * ~1 u, dreadnought ~4.4 u) but compressed, so class size reads at a
   * glance without the largest hulls dominating the row.
   */
  iconSize(typeId: string): { w: number; h: number } {
    const def = shipIconFor(typeId);
    const w = 1.3 + def.width * 0.5;
    return { w, h: (w * def.height) / def.width };
  }

  // ---- Selection ----------------------------------------------------------

  toggleGroup(fleetKey: string, group: ShipClassGroup): void {
    this.confirmDiscard = false;
    if (!this.selection || this.selection.fleetKey !== fleetKey) {
      this.selection = { fleetKey, counts: { [group.typeId]: group.ships.length } };
      return;
    }
    const counts = { ...this.selection.counts };
    if (counts[group.typeId] !== undefined) {
      delete counts[group.typeId];
    } else {
      counts[group.typeId] = group.ships.length;
    }
    this.selection = Object.keys(counts).length > 0 ? { fleetKey, counts } : null;
  }

  onRowKey(event: KeyboardEvent, fleetKey: string, group: ShipClassGroup): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleGroup(fleetKey, group);
    }
  }

  adjust(group: ShipClassGroup, delta: number): void {
    if (!this.selection || this.selection.counts[group.typeId] === undefined) {
      return;
    }
    const next = Math.min(
      group.ships.length,
      Math.max(1, this.selection.counts[group.typeId] + delta),
    );
    this.selection = {
      ...this.selection,
      counts: { ...this.selection.counts, [group.typeId]: next },
    };
  }

  setCount(group: ShipClassGroup, count: number): void {
    if (!this.selection || this.selection.counts[group.typeId] === undefined) {
      return;
    }
    const next = Math.min(group.ships.length, Math.max(1, count));
    this.selection = {
      ...this.selection,
      counts: { ...this.selection.counts, [group.typeId]: next },
    };
  }

  selectAll(fleetKey: string): void {
    const fleet = this.draft.find(fleetKey);
    if (fleet) {
      this.selection = { fleetKey, counts: this.draft.countsOf(fleet) };
    }
  }

  clearSelection(): void {
    this.selection = null;
  }

  // ---- Operations ---------------------------------------------------------

  transferTo(target: TransferTarget): void {
    if (!this.selection) {
      return;
    }
    const received = this.draft.transfer(this.selection.fleetKey, this.selection.counts, target);
    this.selection = null;
    if (received) {
      this.flash(received.key);
    }
    this.refresh();
  }

  gather(key: string): void {
    this.draft.gatherInto(key);
    this.selection = null;
    this.flash(key);
    this.refresh();
  }

  splitByClass(key: string): void {
    this.draft.splitByClass(key);
    this.selection = null;
    this.refresh();
  }

  splitInHalf(key: string): void {
    const before = new Set(this.draft.fleets.map((f) => f.key));
    this.draft.splitInHalf(key);
    this.selection = null;
    const added = this.draft.fleets.find((f) => !before.has(f.key));
    if (added) {
      this.flash(added.key);
    }
    this.refresh();
  }

  rename(key: string, value: string): void {
    this.draft.rename(key, value);
    this.dirty = this.draft.isDirty;
  }

  reset(): void {
    this.draft.reset();
    this.selection = null;
    this.confirmDiscard = false;
    this.refresh();
  }

  onApply(): void {
    if (!this.dirty || this.blankNames) {
      return;
    }
    this.apply.emit(this.draft.toPlan(this.factionId));
  }

  requestCancel(): void {
    if (this.dirty && !this.confirmDiscard) {
      this.confirmDiscard = true;
      return;
    }
    this.cancel.emit();
  }

  keepEditing(): void {
    this.confirmDiscard = false;
  }

  discard(): void {
    this.cancel.emit();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.requestCancel();
    }
  }

  /*
   * Escape peels back one layer: selection, then discard confirmation,
   * then the dialog. Propagation is stopped so StarMap's window-level
   * shortcut does not open the pause menu on top.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.selection) {
      this.selection = null;
    } else if (this.confirmDiscard) {
      this.confirmDiscard = false;
    } else {
      this.requestCancel();
    }
    this.cdr.markForCheck();
  }

  // ---- Drag & drop (pointer convenience; every action also has a click path) ----

  onDragStart(event: DragEvent, fleetKey: string, group: ShipClassGroup): void {
    if (!this.isSelected(fleetKey, group.typeId)) {
      this.selection = { fleetKey, counts: { [group.typeId]: group.ships.length } };
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Firefox only starts a drag when some data is set.
      event.dataTransfer.setData('text/plain', `${this.selectedCount} ships`);
    }
  }

  onDragOver(event: DragEvent, target: TransferTarget): void {
    const allowed = target === 'new' ? this.canFormNew : this.canTransferTo(target);
    if (!allowed) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverKey = target;
  }

  onDragLeave(event: DragEvent, target: TransferTarget): void {
    const next = event.relatedTarget as Node | null;
    if (this.dragOverKey === target && !(next && (event.currentTarget as Node).contains(next))) {
      this.dragOverKey = null;
    }
  }

  onDrop(event: DragEvent, target: TransferTarget): void {
    event.preventDefault();
    this.dragOverKey = null;
    this.transferTo(target);
  }

  onDragEnd(): void {
    this.dragOverKey = null;
  }

  // ---- Internals ----------------------------------------------------------

  private refresh(): void {
    this.views = this.draft.fleets.map((fleet) => this.toView(fleet));
    this.reserveView = this.draft.reserve ? this.toView(this.draft.reserve) : null;
    this.columns = this.reserveView ? [this.reserveView, ...this.views] : this.views;
    this.dirty = this.draft.isDirty;
    if (!this.dirty) {
      this.confirmDiscard = false;
    }
  }

  private toView(fleet: DraftFleet): FleetView {
    let attack = 0;
    let defense = 0;
    for (const ship of fleet.ships) {
      const type = getShipTypeById(ship.type);
      attack += type?.attack ?? 0;
      defense += type?.defense ?? 0;
    }
    return {
      key: fleet.key,
      fleet,
      groups: this.draft.groups(fleet),
      shipCount: fleet.ships.length,
      attack,
      defense,
      isNew: fleet.fleetId === null && fleet.key !== RESERVE_KEY,
      moving: fleet.fleetId !== null && this.movingFleetIds.has(fleet.fleetId),
      isReserve: fleet.key === RESERVE_KEY,
    };
  }

  private flash(key: string): void {
    this.flashKey = key;
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
    }
    this.flashTimer = setTimeout(() => {
      this.flashKey = null;
      this.flashTimer = null;
      this.cdr.markForCheck();
    }, 700);
  }
}

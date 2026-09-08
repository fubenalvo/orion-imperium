import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  ElementRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PlanetTile,
  PlanetBuilding,
  PLANET_SURFACE_CELL_VW,
  PlanetEconomyEntry,
  ResourceDeposit,
  ResourceRates,
} from '../star-map.models';
import { FactionCurrenciesComponent } from '../faction-currencies/faction-currencies.component';
import {
  StarMapProductionPanelComponent,
  ProductionPanelViewModel,
  QueueOrderRequest,
} from '../star-map-production-panel/star-map-production-panel.component';
import {
  StarMapSpaceportPanelComponent,
  SpaceportPanelViewModel,
} from '../star-map-spaceport-panel/star-map-spaceport-panel.component';
import planetData from '../planet-data.json';

export interface BuildingType {
  id: string;
  name: string;
  role: string;
  price: number;
  size: number;
  maintenanceCost: number;
  population: number;
  workforce: number;
  moraleRate: number;
  energyConsumption: number;
  energyProduction: number;
  production?: ResourceRates;
  consumption?: ResourceRates;
  defense: {
    type: string;
    attack?: number;
    attackType?: string;
    range?: number;
    weakness?: string;
    shield?: number;
    shieldRegen?: number;
  } | null;
  requiresOreProximity?: boolean;
}

export type PlanetSidebarTab = 'details' | 'build' | 'assembly' | 'production';

/*
 * =========================================================
 * PLANET SCREEN COMPONENT
 * =========================================================
 *
 * Renders the planet surface view: a grid (similar to the star map
 * grid but sized per planet) over a planet-type-colored background
 * with a noise texture.  The sidebar exposes a tab strip with
 * DETAILS, BUILD, ASSEMBLY, and PRODUCTION tabs — selecting a tab
 * replaces the sidebar's content area.  No floating overlays are
 * mounted outside the sidebar; the BUILD building-type list, the
 * production panel, and the spaceport panel are all rendered
 * inside the same `.planet-sidebar` element.
 *
 * Tab visibility:
 *   - DETAILS:    always
 *   - BUILD:      only when the player owns the planet
 *   - PRODUCTION: only when the planet has a Spaceship Factory
 *   - ASSEMBLY:   only when the planet has a Spaceport
 *
 * Grid dimension formula: gridSize = planetNumericSize * 2 + 3
 *   size 1 -> 5x5, size 2 -> 7x7, size 3 -> 9x9, size 4 -> 11x11
 *
 * Build mode:
 * - After selecting a building type (from the BUILD tab list), the
 *   screen enters build mode. Clicking a grid cell highlights the
 *   potential building footprint. A BUILD button appears when the
 *   placement is valid.
 */

@Component({
  selector: 'app-star-map-planet-screen',
  standalone: true,
  imports: [
    CommonModule,
    FactionCurrenciesComponent,
    StarMapProductionPanelComponent,
    StarMapSpaceportPanelComponent,
  ],
  templateUrl: './star-map-planet-screen.component.html',
  styleUrl: './star-map-planet-screen.component.scss',
})
export class StarMapPlanetScreenComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() planet: PlanetTile | null = null;
  @Input() gridSize: number = 5;
  @Input() planetColor: string = '#ffffff';
  /** When true the surface grid is rendered with a 45° isometric tilt. */
  @Input() isometric = true;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() getFactionCurrencies: (factionId: string) => { name: string; value: number }[] =
    () => [];
  @Input() getEnergyForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() getTaxForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() planetEconomy: PlanetEconomyEntry | null = null;
  @Input() getPlayerCredits: () => number = () => 0;

  @Input() onConfirmBuild: (buildingId: string, x: number, y: number) => void = () => {};
  @Input() hasFactory: () => boolean = () => false;
  @Input() hasSpaceport: () => boolean = () => false;
  @Input() getProductionPanelVm: () => ProductionPanelViewModel | null = () => null;
  @Input() getSpaceportPanelVm: () => SpaceportPanelViewModel | null = () => null;
  @Input() spaceportFleetName = 'New Fleet';
  @Input() spaceportMode: 'create' | 'reinforce' = 'create';
  @Input() spaceportTargetFleetId: number | null = null;
  @Input() productionBuildError: string | null = null;
  @Input() spaceportError: string | null = null;
  @Input() isBuildingUnlocked: (buildingId: string) => boolean = () => false;

  @Output() backToStarMap = new EventEmitter<void>();
  @Output() buildConfirmed = new EventEmitter<{ buildingId: string; x: number; y: number }>();
  @Output() queueOrder = new EventEmitter<QueueOrderRequest>();
  @Output() cancelOrder = new EventEmitter<number>();
  @Output() spaceportConfirm = new EventEmitter<{
    fleetName: string;
    composition: { typeId: string; count: number }[];
    systemId: string;
    planetId: number;
    fleetId: number | null;
  }>();
  @Output() spaceportDisband = new EventEmitter<void>();
  @Output() spaceportFleetNameChange = new EventEmitter<string>();
  @Output() openProductionTab = new EventEmitter<void>();
  @Output() openSpaceportTab = new EventEmitter<void>();

  readonly cellVw = PLANET_SURFACE_CELL_VW;
  private readonly _buildingTypes: BuildingType[] = (planetData as { buildings: BuildingType[] }).buildings;

  // Surface panning state (in vw units, matching the codebase grid convention).
  // `scrollX/Y = 0` means the grid is centered in the viewport; positive
  // values pan toward the right/bottom edge of the surface.
  scrollX = 0;
  scrollY = 0;
  private isSurfaceDragging = false;
  private dragMoved = false;
  private wasDragged = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragScrollStartX = 0;
  private dragScrollStartY = 0;
  private readonly dragThreshold = 5;
  private panIntervalId: number | null = null;
  private readonly panStepVw = 3;
  private readonly panRepeatDelay = 50;
  private maxScrollX = 0;
  private maxScrollY = 0;

  @ViewChild('surfaceViewport') surfaceViewport: ElementRef<HTMLElement> | null = null;

  /** Gap between surface cells, must match the `gap` in the SCSS grid. */
  private readonly gridGapVw = 1;

  /** Extra padding (in vw) around the grid so the camera can be panned a
   * little beyond the grid edges. Two cells on each side. */
  private readonly surfacePaddingVw = 2 * this.cellVw;

  get buildingTypes(): BuildingType[] {
    return this._buildingTypes;
  }

  getBuildingName(building: BuildingType): string {
    return building.name;
  }

  getBuildingPrice(building: BuildingType): number {
    return building.price;
  }

  activeTab: PlanetSidebarTab = 'details';
  isBuildMode = false;
  selectedBuildingType: BuildingType | null = null;
  selectedCell: { row: number; col: number } | null = null;
  previewCells: Set<string> = new Set();
  isPreviewValid = false;
  buildError = '';
  showProductionBuildMenu = false;

  /** Returns an array [0, 1, ..., gridSize-1] for rendering grid cells. */
  get gridCells(): number[] {
    return Array.from({ length: this.gridSize }, (_, i) => i);
  }

  /** Returns the CSS grid template string for the planet surface grid. */
  get gridTemplateColumns(): string {
    return `repeat(${this.gridSize}, ${this.cellVw}vw)`;
  }

  /**
   * Combined transform for the surface grid: centers the grid on the
   * viewport, pans it by the current scroll offset, then applies the
   * optional isometric tilt. The pan must be outermost so scrolling moves
   * the grid in screen space regardless of the rotation.
   */
  get gridTransform(): string {
    const translate = `translate(-50%, -50%) translate(${-this.scrollX}vw, ${-this.scrollY}vw)`;
    if (this.isometric) {
      return `${translate} rotateX(45deg) rotateZ(45deg)`;
    }
    return translate;
  }

  /**
   * Tabs available for the current planet, in display order. Visibility is
   * driven by ownership and the buildings the planet actually has.
   */
  get availableTabs(): PlanetSidebarTab[] {
    const tabs: PlanetSidebarTab[] = ['details'];
    if (this.planet?.factionId === 'player') {
      tabs.push('build');
    }
    if (this.hasFactory()) {
      tabs.push('production');
    }
    if (this.hasSpaceport()) {
      tabs.push('assembly');
    }
    return tabs;
  }

  /** True when the active tab is still available — guards stale state. */
  get activeTabAvailable(): boolean {
    return this.availableTabs.includes(this.activeTab);
  }

  setTab(tab: PlanetSidebarTab): void {
    this.activeTab = tab;
    this.showProductionBuildMenu = false;
    if (tab === 'build') {
      this.isBuildMode = false;
      this.selectedBuildingType = null;
      this.selectedCell = null;
      this.previewCells = new Set();
      this.isPreviewValid = false;
      this.buildError = '';
    } else {
      this.exitBuildMode();
    }
    if (tab === 'production') {
      this.openProductionTab.emit();
    }
    if (tab === 'assembly') {
      this.openSpaceportTab.emit();
    }
  }

  openProductionBuildMenu(): void {
    this.showProductionBuildMenu = true;
  }

  closeProductionBuildMenu(): void {
    this.showProductionBuildMenu = false;
  }

  exitBuildMode(): void {
    this.isBuildMode = false;
    this.selectedBuildingType = null;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
  }

  selectBuildingType(buildingId: string): void {
    const building = this.buildingTypes.find((b) => b.id === buildingId) ?? null;
    this.selectedBuildingType = building;
    this.isBuildMode = true;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
  }

  onCellClick(row: number, col: number): void {
    // Suppress the trailing click of a drag-pan so it cannot place a building.
    if (this.wasDragged || this.dragMoved) {
      return;
    }
    if (!this.isBuildMode || !this.selectedBuildingType) {
      return;
    }

    this.selectedCell = { row, col };
    this.updatePreview(row, col);
  }

  private updatePreview(row: number, col: number): void {
    if (!this.selectedBuildingType) {
      return;
    }

    const size = this.selectedBuildingType.size;
    this.previewCells = new Set<string>();

    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        this.previewCells.add(`${r},${c}`);
      }
    }

    const fitsGrid = col + size <= this.gridSize && row + size <= this.gridSize;
    if (!fitsGrid) {
      this.isPreviewValid = false;
      this.buildError = 'This area does not fit the building.';
      return;
    }

    const overlaps = (this.planet?.buildings ?? []).some((b) => {
      const bSize = b.size;
      return col < b.x + bSize && col + size > b.x && row < b.y + bSize && row + size > b.y;
    });

    if (overlaps) {
      this.isPreviewValid = false;
      this.buildError = 'Area overlaps with existing buildings.';
      return;
    }

    const resourceTiles = this.planet?.resourceTiles ?? [];
    const requiresOreProximity = this.selectedBuildingType.requiresOreProximity === true;

    if (requiresOreProximity) {
      const touchesResource = this.touchesResourceTile(row, col, size, resourceTiles);
      if (!touchesResource) {
        this.isPreviewValid = false;
        this.buildError = 'Mining Complex must be placed near a raw material deposit.';
        return;
      }
    } else {
      const overlapsResource = this.overlapsResourceTile(row, col, size, resourceTiles);
      if (overlapsResource) {
        this.isPreviewValid = false;
        this.buildError = 'Cannot build directly on a resource deposit.';
        return;
      }
    }

    this.isPreviewValid = true;
    this.buildError = '';
  }

  private touchesResourceTile(
    row: number,
    col: number,
    size: number,
    resourceTiles: ResourceDeposit[],
  ): boolean {
    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        for (const rt of resourceTiles) {
          if (Math.abs(r - rt.y) <= 1 && Math.abs(c - rt.x) <= 1) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private overlapsResourceTile(
    row: number,
    col: number,
    size: number,
    resourceTiles: ResourceDeposit[],
  ): boolean {
    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        for (const rt of resourceTiles) {
          if (r === rt.y && c === rt.x) {
            return true;
          }
        }
      }
    }
    return false;
  }

  isResourceTile(row: number, col: number): boolean {
    return (this.planet?.resourceTiles ?? []).some(
      (rt) => rt.x === col && rt.y === row,
    );
  }

  confirmBuild(): void {
    if (!this.isPreviewValid || !this.selectedCell || !this.selectedBuildingType) {
      return;
    }

    const { col, row } = this.selectedCell;
    this.buildConfirmed.emit({
      buildingId: this.selectedBuildingType.id,
      x: col,
      y: row,
    });
    this.onConfirmBuild(this.selectedBuildingType.id, col, row);
    this.exitBuildMode();
  }

  canAfford(building: BuildingType): boolean {
    return this.getPlayerCredits() >= building.price;
  }

  isCellInPreview(row: number, col: number): boolean {
    return this.previewCells.has(`${row},${col}`);
  }

  getCellZIndex(row: number, col: number): number {
    // Isometric depth: row + col determines visual depth (0-indexed).
    // Cells on the same anti-diagonal share visual depth; use row as tiebreaker.
    // +1 so (0,0) starts at 1.
    return (row + col) * this.gridSize + row + 1;
  }

  ngAfterViewInit(): void {
    this.updateClamp();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['gridSize']) {
      this.updateClamp();
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateClamp();
  }

  /**
   * Recomputes scroll clamp bounds from the viewport's current size. Uses
   * DOM measurement so it stays correct when the sidebar width changes
   * (26% / 320px cap) or the window is resized. Grid size is analytic:
   * `gridSize * cellVw + (gridSize - 1) * gap`.
   *
   * When the grid is rotated into the isometric diamond, its visual extent is
   * wider than its layout box (layout * sqrt(2)), so the clamp must be based
   * on the visual size — otherwise a 45°-rotated grid that is wider than the
   * viewport would report maxScrollX = 0 and the edge tiles could never be
   * panned into view.
   */
  private updateClamp(): void {
    if (!this.surfaceViewport) {
      return;
    }
    const vwUnit = window.innerWidth / 100;
    const viewport = this.surfaceViewport.nativeElement;
    const viewportWidthVw = viewport.offsetWidth / vwUnit;
    const viewportHeightVw = viewport.offsetHeight / vwUnit;
    const gridSizeVw = this.gridSize * this.cellVw + (this.gridSize - 1) * this.gridGapVw;
    const visualWidthVw = this.isometric ? gridSizeVw * Math.SQRT2 : gridSizeVw;
    const visualHeightVw = this.isometric ? gridSizeVw : gridSizeVw;

    // Add two cells of padding on each side so the camera can be panned a
    // little beyond the grid edges.
    this.maxScrollX = Math.max(0, (visualWidthVw + this.surfacePaddingVw - viewportWidthVw) / 2);
    this.maxScrollY = Math.max(0, (visualHeightVw + this.surfacePaddingVw - viewportHeightVw) / 2);
    this.clampScroll();
  }

  /**
   * Clamps scroll to the computed bounds. Returns true when the scroll was
   * actually changed, false when it was already within bounds.
   */
  private clampScroll(): boolean {
    const clampedX = Math.max(-this.maxScrollX, Math.min(this.maxScrollX, this.scrollX));
    const clampedY = Math.max(-this.maxScrollY, Math.min(this.maxScrollY, this.scrollY));
    const moved = clampedX !== this.scrollX || clampedY !== this.scrollY;
    this.scrollX = clampedX;
    this.scrollY = clampedY;
    return moved;
  }

  /** Pans the surface by the given vw delta. Stops panning when clamped so
   * a held d-pad button at the edge does not keep scheduling change
   * detection. */
  panBy(deltaX: number, deltaY: number): void {
    this.scrollX += deltaX;
    this.scrollY += deltaY;
    if (!this.clampScroll()) {
      this.stopPan();
    }
  }

  /** Resets panning so the grid is centered again. */
  centerScroll(): void {
    this.scrollX = 0;
    this.scrollY = 0;
  }

  /**
   * Starts continuous panning in the given direction. Emits one step
   * immediately, then repeats every 50ms — mirrors the galaxy navigation
   * d-pad behaviour. Stop with {@link stopPan}.
   */
  startPan(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.stopPan();
    this.panStep(direction);
    this.panIntervalId = window.setInterval(() => {
      this.panStep(direction);
    }, this.panRepeatDelay);
  }

  /** Stops the continuous pan interval. */
  stopPan(): void {
    if (this.panIntervalId !== null) {
      window.clearInterval(this.panIntervalId);
      this.panIntervalId = null;
    }
  }

  /** Clears the pan interval so a held button cannot leak past component teardown. */
  ngOnDestroy(): void {
    this.stopPan();
  }

  private panStep(direction: 'up' | 'down' | 'left' | 'right'): void {
    switch (direction) {
      case 'up':
        this.panBy(0, -this.panStepVw);
        break;
      case 'down':
        this.panBy(0, this.panStepVw);
        break;
      case 'left':
        this.panBy(-this.panStepVw, 0);
        break;
      case 'right':
        this.panBy(this.panStepVw, 0);
        break;
    }
  }

  /** Pointer down on the surface viewport — begins drag tracking. */
  onSurfacePointerDown(event: PointerEvent): void {
    this.dragMoved = false;
    this.wasDragged = false;
    // While in build mode, cells are interactive (building placement), so
    // drags must not start there. Outside build mode cells are inert, so
    // letting the drag start on them keeps touch panning usable.
    if (this.isBuildMode && this.isCellOrBuilding(event.target as HTMLElement)) {
      return;
    }
    const viewport = event.currentTarget as HTMLElement;
    viewport.setPointerCapture(event.pointerId);

    this.isSurfaceDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragScrollStartX = this.scrollX;
    this.dragScrollStartY = this.scrollY;

    viewport.classList.add('dragging');
  }

  /** Pointer move during drag — updates scroll with clamping. */
  onSurfacePointerMove(event: PointerEvent): void {
    if (!this.isSurfaceDragging) {
      return;
    }
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;

    if (Math.abs(deltaX) + Math.abs(deltaY) > this.dragThreshold) {
      this.dragMoved = true;
    }

    const vwUnit = window.innerWidth / 100;
    this.scrollX = this.dragScrollStartX - deltaX / vwUnit;
    this.scrollY = this.dragScrollStartY - deltaY / vwUnit;
    this.clampScroll();
  }

  /** Pointer up — ends drag; a short drag that moved is treated as a pan. */
  onSurfacePointerUp(event: PointerEvent): void {
    if (!this.isSurfaceDragging) {
      return;
    }
    const viewport = event.currentTarget as HTMLElement;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    viewport.classList.remove('dragging');

    this.isSurfaceDragging = false;
    if (this.dragMoved) {
      this.wasDragged = true;
    }
  }

  /** Returns true when the drag started on an interactive grid element. */
  private isCellOrBuilding(element: HTMLElement): boolean {
    let el: HTMLElement | null = element;
    while (el && el !== document.body) {
      if (
        el.classList.contains('planet-surface__cell') ||
        el.classList.contains('planet-surface__building')
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Returns the BEM modifier class for a placed building based on its id/name,
   * e.g. `medium_residential` -> `planet-surface__building--medium-residential`.
   * Looks up the original BuildingType by name (the name is the only field we
   * have on PlanetBuilding) and falls back to a slugified version of the name.
   */  getBuildingTypeClass(b: PlanetBuilding): string {
    const def = this.buildingTypes.find(
      (t) => t.name === b.name || t.id === (b as { id?: string }).id,
    );
    const id = def?.id ?? this.slugify(b.name);
    return `planet-surface__building--${id.replace(/_/g, '-')}`;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }
}

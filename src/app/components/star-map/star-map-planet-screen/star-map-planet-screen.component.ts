import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  DoCheck,
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
import { getBlockedMask } from '../planet-surface/planet-surface';
import { PLANET_SURFACE_MARGIN } from '../planet-surface/planet-surface-field';
import {
  SurfaceRenderResult,
  renderPlanetSurface,
  surfaceHazeColor,
} from '../planet-surface/planet-surface-renderer';
import { SettlementLayout, computeSettlementLayout } from '../planet-surface/planet-settlement';

export interface BuildingType {
  id: string;
  name: string;
  role: string;
  price: number;
  rawMaterialCost?: number;
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

/** Predefined camera distances for the planet surface view. */
export type PlanetSurfaceZoomLevel = 'close' | 'medium' | 'far';

/**
 * Screen-space scale of the surface per zoom level, relative to
 * PLANET_SURFACE_CELL_VW. Consecutive levels differ by the same factor
 * (~0.73), so CLOSE / MEDIUM / FAR keep an even progression.
 */
export const PLANET_SURFACE_ZOOM_SCALES: Record<PlanetSurfaceZoomLevel, number> = {
  close: 1,
  medium: 0.733,
  far: 0.537,
};

/** Zoom level active whenever a planet surface is opened. */
export const DEFAULT_PLANET_SURFACE_ZOOM: PlanetSurfaceZoomLevel = 'medium';

/*
 * Sprites stand inset from their footprint; the gap is where streets run.
 * The building SVGs are generated for this inset (scripts/building-sprites/generate.mjs).
 */
const SPRITE_INSET = 0.15;
/* Deposits are small outcrops inside their cell. */
const DEPOSIT_INSET = 0.2;
const DEPOSIT_SPRITE = 'planet-surface/ore-deposit.svg';

/** A depth-sorted image in the object layer (building, deposit, build ghost). */
export interface SurfaceSprite {
  key: string;
  src: string;
  /* Anchor (bottom center) and width in vw at zoom 1, relative to the world center. */
  left: number;
  top: number;
  width: number;
  z: number;
  kind: 'building' | 'deposit' | 'ghost';
}

const EMPTY_SETTLEMENT: SettlementLayout = { streets: '', accessRoads: [], plots: [], lights: [] };

/*
 * =========================================================
 * PLANET SCREEN COMPONENT
 * =========================================================
 *
 * The planet view: a colony on an isometric planet surface plus a sidebar
 * with DETAILS, BUILD, ASSEMBLY and PRODUCTION tabs. Terrain, street and
 * rendering rules are documented in docs/planet-surface.md.
 *
 * Scene layers (inside one camera element that pans and zooms):
 *   1. Terrain canvas — the environment, baked once per planet by
 *      renderPlanetSurface (screen space, includes cliffs and decor).
 *   2. Ground plane — a flat element tilted with rotateX(60) rotateZ(45)
 *      holding the settlement SVG (plots, streets, shadows, lights) and the
 *      interactive CSS grid of cells. Its projection matches the terrain
 *      canvas exactly, and buildable cells are flat (h = 0) in the terrain.
 *   3. Object layer — upright sprites (buildings, deposits, build ghost)
 *      positioned with the same projection and depth-sorted.
 *   4. Labels.
 * World coordinates are cell units; the grid occupies [margin, margin + N).
 *
 * Tab visibility:
 *   - DETAILS:    always
 *   - BUILD:      only when the player owns the planet
 *   - PRODUCTION: only when the planet has a Spaceship Factory
 *   - ASSEMBLY:   only when the planet has a Spaceport
 *
 * Zoom levels (CLOSE / MEDIUM / FAR):
 * - Purely presentational camera state; never written to the planet, the
 *   game state, or the save. The zoom is a `scale()` on the camera, so all
 *   layers scale together and build placement logic is unaffected.
 * - Not persisted: the component is destroyed when the planet view closes
 *   (`@if` in star-map.html), and a change of the `planet` input id also
 *   resets it, so every planet opening starts at DEFAULT_PLANET_SURFACE_ZOOM.
 *
 * Build mode:
 * - After selecting a building type (BUILD tab), clicking a cell previews the
 *   footprint (cells + a ghost sprite). A placement must fit the grid, avoid
 *   terrain obstacles (planet.surface), buildings and deposits (the Mining
 *   Complex must touch one instead). The AI applies the same terrain rule in
 *   EnemyEconomyService.canPlace.
 *
 * Derived scene data (sprites, streets, zone outline) is rebuilt only when
 * the planet's buildings / surface signature changes (ngDoCheck), because
 * StarMap pushes new buildings into the planet's array in place.
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
export class StarMapPlanetScreenComponent implements AfterViewInit, OnChanges, OnDestroy, DoCheck {
  @Input() planet: PlanetTile | null = null;
  @Input() gridSize: number = 10;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() getFactionCurrencies: (factionId: string) => { name: string; value: number }[] =
    () => [];
  @Input() getEnergyForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() getTaxForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() planetEconomy: PlanetEconomyEntry | null = null;
  @Input() getPlayerCredits: () => number = () => 0;
  @Input() getPlayerRawMaterials: () => number = () => 0;

  @Input() hasFactory: () => boolean = () => false;
  @Input() hasSpaceport: () => boolean = () => false;
  @Input() getProductionPanelVm: () => ProductionPanelViewModel | null = () => null;
  @Input() getSpaceportPanelVm: () => SpaceportPanelViewModel | null = () => null;
  @Input() spaceportFleetName = 'New Fleet';
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
  }>();
  @Output() spaceportFleetNameChange = new EventEmitter<string>();
  @Output() openProductionTab = new EventEmitter<void>();
  @Output() openSpaceportTab = new EventEmitter<void>();

  readonly cellVw = PLANET_SURFACE_CELL_VW;
  readonly margin = PLANET_SURFACE_MARGIN;
  private readonly _buildingTypes: BuildingType[] = (planetData as { buildings: BuildingType[] }).buildings;

  // Surface panning state (in vw units, matching the codebase grid convention).
  // `scrollX/Y = 0` means the world center is in the middle of the viewport;
  // positive values pan toward the right/bottom of the screen.
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

  readonly zoomLevels: readonly PlanetSurfaceZoomLevel[] = ['close', 'medium', 'far'];
  zoomLevel: PlanetSurfaceZoomLevel = DEFAULT_PLANET_SURFACE_ZOOM;

  get zoomScale(): number {
    return PLANET_SURFACE_ZOOM_SCALES[this.zoomLevel];
  }

  @ViewChild('surfaceViewport') surfaceViewport: ElementRef<HTMLElement> | null = null;
  @ViewChild('terrainHost') terrainHost: ElementRef<HTMLElement> | null = null;

  // Building names are shown by default; the NAMES toggle hides them.
  showLabels = true;
  terrainReady = false;
  terrainBox: { left: number; top: number; width: number; height: number } | null = null;
  settlement: SettlementLayout = EMPTY_SETTLEMENT;
  sprites: SurfaceSprite[] = [];
  zoneOutline = '';
  hoveredCell: { row: number; col: number } | null = null;
  private terrain: SurfaceRenderResult | null = null;
  private sceneSignature = '';
  private terrainSignature = '';
  private renderHandle: number | null = null;

  get buildingTypes(): BuildingType[] {
    return this._buildingTypes;
  }

  getBuildingName(building: BuildingType): string {
    return building.name;
  }

  getBuildingPrice(building: BuildingType): number {
    return building.price;
  }

  getBuildingRawCost(building: BuildingType): number {
    return building.rawMaterialCost ?? 0;
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

  get worldSize(): number {
    return this.gridSize + this.margin * 2;
  }

  /* World side in vw at zoom 1 (layout size of the ground plane). */
  get worldVw(): number {
    return this.worldSize * this.cellVw;
  }

  get hazeColor(): string {
    return surfaceHazeColor(this.planet?.type ?? 'earthlike');
  }

  /**
   * Camera transform: pans in screen space (unscaled vw), then zooms around
   * the world center, which is anchored at the viewport center. The
   * isometric tilt lives on the ground plane only, so sprites and the baked
   * terrain stay upright.
   */
  get cameraTransform(): string {
    return `translate(${-this.scrollX}vw, ${-this.scrollY}vw) scale(${this.zoomScale})`;
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
      this.updateSprites();
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
    this.updateSprites();
  }

  selectBuildingType(buildingId: string): void {
    const building = this.buildingTypes.find((b) => b.id === buildingId) ?? null;
    this.selectedBuildingType = building;
    this.isBuildMode = true;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
    this.updateSprites();
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
    this.updateSprites();
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

    if (this.footprintHitsTerrain(row, col, size)) {
      this.isPreviewValid = false;
      this.buildError = 'The terrain here is not suitable for construction.';
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

  private footprintHitsTerrain(row: number, col: number, size: number): boolean {
    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        if (this.isBlockedCell(r, c)) return true;
      }
    }
    return false;
  }

  /** True when an environmental obstacle covers the cell (not buildable). */
  isBlockedCell(row: number, col: number): boolean {
    const mask = this.planet ? getBlockedMask(this.planet) : null;
    if (!mask || row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) {
      return false;
    }
    return mask[row * this.gridSize + col] === 1;
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
    this.exitBuildMode();
  }

  /* Same rule StarMap.onBuildingConfirmed enforces: credits AND raw materials. */
  canAfford(building: BuildingType): boolean {
    return (
      this.getPlayerCredits() >= building.price
      && this.getPlayerRawMaterials() >= this.getBuildingRawCost(building)
    );
  }

  isCellInPreview(row: number, col: number): boolean {
    return this.previewCells.has(`${row},${col}`);
  }

  ngAfterViewInit(): void {
    this.updateClamp();
    this.refreshScene();
    this.scheduleTerrainRender();
  }

  ngDoCheck(): void {
    this.refreshScene();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Compare by id: the parent may hand over a new object for the same
    // planet, which must not reset the player's chosen zoom.
    const planetChange = changes['planet'];
    if (
      planetChange &&
      planetChange.previousValue?.id !== planetChange.currentValue?.id
    ) {
      this.zoomLevel = DEFAULT_PLANET_SURFACE_ZOOM;
      this.centerScroll();
      // A placement preview belongs to the planet it was started on.
      if (planetChange.previousValue) {
        this.exitBuildMode();
      }
      this.hoveredCell = null;
      this.terrain = null;
      this.terrainBox = null;
      this.terrainReady = false;
    }
    if (changes['gridSize'] || planetChange) {
      this.updateClamp();
      this.scheduleTerrainRender();
      this.refreshScene();
    }
  }

  /**
   * Switches the camera zoom. The scroll offset is rescaled so the surface
   * point under the viewport center stays put instead of jumping, then it is
   * re-clamped against the new (scaled) bounds.
   */
  setZoomLevel(level: PlanetSurfaceZoomLevel): void {
    if (level === this.zoomLevel) {
      return;
    }
    const ratio = PLANET_SURFACE_ZOOM_SCALES[level] / this.zoomScale;
    this.zoomLevel = level;
    this.scrollX *= ratio;
    this.scrollY *= ratio;
    this.updateClamp();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateClamp();
  }

  /**
   * Recomputes the scroll clamp. The camera center may roam over the grid's
   * projected diamond (plus one cell of headroom for buildings at the back),
   * so every edge of the colony can be brought to the middle of the screen
   * and the terrain around it inspected; the world margin keeps the view
   * filled. Bounds are in screen vw, so they scale with the zoom.
   */
  private updateClamp(): void {
    if (!this.surfaceViewport) {
      return;
    }
    const gridVw = this.gridSize * this.cellVw * this.zoomScale;
    this.maxScrollX = (gridVw * Math.SQRT2) / 2;
    this.maxScrollY = (gridVw * Math.SQRT2) / 4 + this.cellVw * this.zoomScale;
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

  /** Clears timers so a held button or pending render cannot outlive the view. */
  ngOnDestroy(): void {
    this.stopPan();
    this.cancelTerrainRender();
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
      if (el.classList.contains('planet-surface__cell')) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Sprite of a placed building or a building type. Every building has an
   * SVG generated by `npm run sprites:buildings` (scripts/building-sprites),
   * drawn with the same projection and inset as the planet view.
   */
  getBuildingSprite(b: { name: string; id?: string }): string {
    const def = this.buildingTypes.find((t) => t.name === b.name || t.id === b.id);
    const id = def?.id ?? this.slugify(b.name);
    return `buildings-svg/${id.replace(/_/g, '-')}.svg`;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  // ---------------------------------------------------------------
  // Scene: projection, sprites, streets, terrain
  // ---------------------------------------------------------------

  /** Screen position (vw at zoom 1) of a ground point given in world cells. */
  private project(u: number, v: number): { x: number; y: number } {
    const c = this.worldSize / 2;
    const du = u - c;
    const dv = v - c;
    return {
      x: ((du - dv) / Math.SQRT2) * this.cellVw,
      y: ((du + dv) / (2 * Math.SQRT2)) * this.cellVw,
    };
  }

  private refreshScene(): void {
    const planet = this.planet;
    const signature = planet
      ? `${planet.id}|${this.gridSize}|${planet.surface?.blocked ?? ''}|` +
        planet.buildings.map((b) => `${b.name}@${b.x},${b.y},${b.size}`).join(';') +
        '|' +
        (planet.resourceTiles ?? []).map((r) => `${r.x},${r.y}`).join(';') +
        `|${this.terrain ? 1 : 0}`
      : '';
    if (signature === this.sceneSignature) {
      return;
    }
    this.sceneSignature = signature;
    if (!planet) {
      this.sprites = [];
      this.settlement = EMPTY_SETTLEMENT;
      this.zoneOutline = '';
      return;
    }
    const mask = getBlockedMask(planet);
    const terrain = this.terrain;
    this.settlement = computeSettlementLayout(
      planet.buildings,
      this.gridSize,
      mask,
      this.margin,
      terrain ? (u, v) => terrain.isOpenLand(u, v) : undefined,
    );
    this.zoneOutline = this.computeZoneOutline(mask);
    this.updateSprites();
  }

  /*
   * Rebuilds the sprite list (buildings, deposits, build ghost) in painter's
   * order. For non-overlapping footprints, A is behind B when A ends before
   * B starts on either ground axis. That relation is only applied when the
   * two sprites overlap horizontally on screen, which keeps it acyclic, so a
   * topological sort gives a correct order even for mixed footprint sizes
   * (sorting by the front corner alone is wrong for e.g. a 4×4 next to a 1×1).
   */
  private updateSprites(): void {
    const planet = this.planet;
    if (!planet) {
      this.sprites = [];
      return;
    }
    const items: DepthItem<Omit<SurfaceSprite, 'z'>>[] = [];
    planet.buildings.forEach((b, index) => {
      items.push({
        gx: b.x,
        gy: b.y,
        size: b.size,
        value: { ...this.spriteFor(b.x, b.y, b.size, this.getBuildingSprite(b)), key: `b${index}`, kind: 'building' },
      });
    });
    (planet.resourceTiles ?? []).forEach((r, index) => {
      items.push({
        gx: r.x,
        gy: r.y,
        size: 1,
        value: { ...this.spriteFor(r.x, r.y, 1, DEPOSIT_SPRITE, DEPOSIT_INSET), key: `r${index}`, kind: 'deposit' },
      });
    });
    const sprites: SurfaceSprite[] = sortByDepth(items).map((item, i) => ({ ...item.value, z: i + 1 }));
    if (this.isBuildMode && this.selectedBuildingType && this.selectedCell) {
      const size = this.selectedBuildingType.size;
      sprites.push({
        ...this.spriteFor(
          this.selectedCell.col,
          this.selectedCell.row,
          size,
          this.getBuildingSprite(this.selectedBuildingType),
        ),
        key: 'ghost',
        kind: 'ghost',
        z: sprites.length + 1,
      });
    }
    this.sprites = sprites;
  }

  private spriteFor(
    x: number,
    y: number,
    size: number,
    src: string,
    inset = SPRITE_INSET,
  ): Pick<SurfaceSprite, 'src' | 'left' | 'top' | 'width'> {
    const front = this.project(this.margin + x + size - inset, this.margin + y + size - inset);
    return {
      src,
      left: front.x,
      top: front.y,
      width: (size - inset * 2) * Math.SQRT2 * this.cellVw,
    };
  }

  /** Outline (world cell units) around the buildable area of the grid. */
  private computeZoneOutline(mask: Uint8Array | null): string {
    const n = this.gridSize;
    const m = this.margin;
    const open = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < n && y < n && !(mask && mask[y * n + x]);
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!open(x, y)) continue;
        if (!open(x, y - 1)) d += `M${m + x} ${m + y}h1`;
        if (!open(x, y + 1)) d += `M${m + x} ${m + y + 1}h1`;
        if (!open(x - 1, y)) d += `M${m + x} ${m + y}v1`;
        if (!open(x + 1, y)) d += `M${m + x + 1} ${m + y}v1`;
      }
    }
    return d;
  }

  /** Building occupying a grid cell, if any. */
  buildingAt(row: number, col: number): PlanetBuilding | null {
    return (
      this.planet?.buildings.find(
        (b) => col >= b.x && col < b.x + b.size && row >= b.y && row < b.y + b.size,
      ) ?? null
    );
  }

  get hoveredBuilding(): PlanetBuilding | null {
    return this.hoveredCell ? this.buildingAt(this.hoveredCell.row, this.hoveredCell.col) : null;
  }

  onCellHover(row: number, col: number): void {
    this.hoveredCell = { row, col };
  }

  onSurfaceLeave(): void {
    this.hoveredCell = null;
  }

  /** Label anchor (vw at zoom 1) above a building's footprint center. */
  labelPosition(b: PlanetBuilding): { left: number; top: number } {
    const p = this.project(this.margin + b.x + b.size / 2, this.margin + b.y + b.size / 2);
    return { left: p.x, top: p.y - b.size * 0.6 * this.cellVw };
  }

  toggleLabels(): void {
    this.showLabels = !this.showLabels;
  }

  /*
   * The terrain is baked after the first frame so the view opens at once;
   * the canvas fades in when ready. The renderer caches results, so
   * reopening a planet is instant. Skipped under jsdom (no canvas).
   */
  private scheduleTerrainRender(): void {
    const planet = this.planet;
    const surface = planet?.surface;
    if (!planet || !surface || !this.terrainHost || isJsdom()) {
      return;
    }
    const pxPerCell = Math.max(24, Math.min(40, ((window.innerWidth * this.cellVw) / 100) * 0.55));
    const signature = `${planet.id}|${surface.seed}|${surface.blocked}|${Math.round(pxPerCell)}`;
    if (signature === this.terrainSignature) {
      return;
    }
    this.terrainSignature = signature;
    this.cancelTerrainRender();
    this.renderHandle = window.setTimeout(() => {
      this.renderHandle = null;
      const result = renderPlanetSurface({ surface, type: planet.type, pxPerCell });
      if (!result || !this.terrainHost || this.planet?.id !== planet.id) {
        return;
      }
      this.terrain = result;
      result.canvas.classList.add('planet-surface__terrain-canvas');
      this.terrainHost.nativeElement.replaceChildren(result.canvas);
      this.terrainBox = {
        left: result.left * this.cellVw,
        top: result.top * this.cellVw,
        width: result.width * this.cellVw,
        height: result.height * this.cellVw,
      };
      // Streets need the terrain's open-land data for the access road.
      this.refreshScene();
      requestAnimationFrame(() => (this.terrainReady = true));
    }, 30);
  }

  private cancelTerrainRender(): void {
    if (this.renderHandle !== null) {
      window.clearTimeout(this.renderHandle);
      this.renderHandle = null;
    }
  }
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

interface DepthItem<T> {
  gx: number;
  gy: number;
  size: number;
  value: T;
}

/* Topological painter's order for non-overlapping footprints, see updateSprites. */
function sortByDepth<T>(items: DepthItem<T>[]): DepthItem<T>[] {
  const n = items.length;
  const before: number[][] = items.map(() => []);
  const indegree = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const A = items[a];
      const B = items[b];
      // Screen X extent of a footprint spans (minX - maxY) .. (maxX - minY).
      const overlapX =
        A.gx + A.size - A.gy > B.gx - B.gy - B.size && B.gx + B.size - B.gy > A.gx - A.gy - A.size;
      if (overlapX && (A.gx + A.size <= B.gx || A.gy + A.size <= B.gy)) {
        before[a].push(b);
        indegree[b]++;
      }
    }
  }
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) ready.push(i);
  const out: DepthItem<T>[] = [];
  const placed = new Uint8Array(n);
  while (ready.length) {
    // Deterministic: among ready items emit the one furthest back first.
    ready.sort((x, y) => items[y].gx + items[y].gy - (items[x].gx + items[x].gy));
    const next = ready.pop()!;
    placed[next] = 1;
    out.push(items[next]);
    for (const b of before[next]) {
      if (--indegree[b] === 0) ready.push(b);
    }
  }
  // Overlapping (invalid) footprints could form a cycle; never drop sprites.
  for (let i = 0; i < n; i++) if (!placed[i]) out.push(items[i]);
  return out;
}

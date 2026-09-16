import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter, ViewChild, HostListener, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PLANET_SURFACE_CELL_VW, } from '../star-map.models';
import { FactionCurrenciesComponent } from '../faction-currencies/faction-currencies.component';
import { StarMapProductionPanelComponent, } from '../star-map-production-panel/star-map-production-panel.component';
import { StarMapSpaceportPanelComponent, } from '../star-map-spaceport-panel/star-map-spaceport-panel.component';
import planetData from '../planet-data.json';
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
let StarMapPlanetScreenComponent = class StarMapPlanetScreenComponent {
    planet = null;
    gridSize = 5;
    planetColor = '#ffffff';
    /** When true the surface grid is rendered with a 45° isometric tilt. */
    isometric = true;
    getFactionName = () => 'Unknown';
    getFactionColor = () => '#fff';
    getFactionCurrencies = () => [];
    getEnergyForPlanet = () => 0;
    getTaxForPlanet = () => 0;
    planetEconomy = null;
    getPlayerCredits = () => 0;
    onConfirmBuild = () => { };
    hasFactory = () => false;
    hasSpaceport = () => false;
    getProductionPanelVm = () => null;
    getSpaceportPanelVm = () => null;
    spaceportFleetName = 'New Fleet';
    spaceportMode = 'create';
    spaceportTargetFleetId = null;
    productionBuildError = null;
    spaceportError = null;
    isBuildingUnlocked = () => false;
    backToStarMap = new EventEmitter();
    buildConfirmed = new EventEmitter();
    queueOrder = new EventEmitter();
    cancelOrder = new EventEmitter();
    spaceportConfirm = new EventEmitter();
    spaceportDisband = new EventEmitter();
    spaceportFleetNameChange = new EventEmitter();
    openProductionTab = new EventEmitter();
    openSpaceportTab = new EventEmitter();
    cellVw = PLANET_SURFACE_CELL_VW;
    _buildingTypes = planetData.buildings;
    // Surface panning state (in vw units, matching the codebase grid convention).
    // `scrollX/Y = 0` means the grid is centered in the viewport; positive
    // values pan toward the right/bottom edge of the surface.
    scrollX = 0;
    scrollY = 0;
    isSurfaceDragging = false;
    dragMoved = false;
    wasDragged = false;
    dragStartX = 0;
    dragStartY = 0;
    dragScrollStartX = 0;
    dragScrollStartY = 0;
    dragThreshold = 5;
    panIntervalId = null;
    panStepVw = 3;
    panRepeatDelay = 50;
    maxScrollX = 0;
    maxScrollY = 0;
    surfaceViewport = null;
    /** Gap between surface cells, must match the `gap` in the SCSS grid. */
    gridGapVw = 1;
    /** Extra padding (in vw) around the grid so the camera can be panned a
     * little beyond the grid edges. Two cells on each side. */
    surfacePaddingVw = 2 * this.cellVw;
    get buildingTypes() {
        return this._buildingTypes;
    }
    getBuildingName(building) {
        return building.name;
    }
    getBuildingPrice(building) {
        return building.price;
    }
    activeTab = 'details';
    isBuildMode = false;
    selectedBuildingType = null;
    selectedCell = null;
    previewCells = new Set();
    isPreviewValid = false;
    buildError = '';
    showProductionBuildMenu = false;
    /** Returns an array [0, 1, ..., gridSize-1] for rendering grid cells. */
    get gridCells() {
        return Array.from({ length: this.gridSize }, (_, i) => i);
    }
    /** Returns the CSS grid template string for the planet surface grid. */
    get gridTemplateColumns() {
        return `repeat(${this.gridSize}, ${this.cellVw}vw)`;
    }
    /**
     * Combined transform for the surface grid: centers the grid on the
     * viewport, pans it by the current scroll offset, then applies the
     * optional isometric tilt. The pan must be outermost so scrolling moves
     * the grid in screen space regardless of the rotation.
     */
    get gridTransform() {
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
    get availableTabs() {
        const tabs = ['details'];
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
    get activeTabAvailable() {
        return this.availableTabs.includes(this.activeTab);
    }
    setTab(tab) {
        this.activeTab = tab;
        this.showProductionBuildMenu = false;
        if (tab === 'build') {
            this.isBuildMode = false;
            this.selectedBuildingType = null;
            this.selectedCell = null;
            this.previewCells = new Set();
            this.isPreviewValid = false;
            this.buildError = '';
        }
        else {
            this.exitBuildMode();
        }
        if (tab === 'production') {
            this.openProductionTab.emit();
        }
        if (tab === 'assembly') {
            this.openSpaceportTab.emit();
        }
    }
    openProductionBuildMenu() {
        this.showProductionBuildMenu = true;
    }
    closeProductionBuildMenu() {
        this.showProductionBuildMenu = false;
    }
    exitBuildMode() {
        this.isBuildMode = false;
        this.selectedBuildingType = null;
        this.selectedCell = null;
        this.previewCells = new Set();
        this.isPreviewValid = false;
        this.buildError = '';
    }
    selectBuildingType(buildingId) {
        const building = this.buildingTypes.find((b) => b.id === buildingId) ?? null;
        this.selectedBuildingType = building;
        this.isBuildMode = true;
        this.selectedCell = null;
        this.previewCells = new Set();
        this.isPreviewValid = false;
        this.buildError = '';
    }
    onCellClick(row, col) {
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
    updatePreview(row, col) {
        if (!this.selectedBuildingType) {
            return;
        }
        const size = this.selectedBuildingType.size;
        this.previewCells = new Set();
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
        }
        else {
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
    touchesResourceTile(row, col, size, resourceTiles) {
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
    overlapsResourceTile(row, col, size, resourceTiles) {
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
    isResourceTile(row, col) {
        return (this.planet?.resourceTiles ?? []).some((rt) => rt.x === col && rt.y === row);
    }
    confirmBuild() {
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
    canAfford(building) {
        return this.getPlayerCredits() >= building.price;
    }
    isCellInPreview(row, col) {
        return this.previewCells.has(`${row},${col}`);
    }
    getCellZIndex(row, col) {
        // Isometric depth: row + col determines visual depth (0-indexed).
        // Cells on the same anti-diagonal share visual depth; use row as tiebreaker.
        // +1 so (0,0) starts at 1.
        return (row + col) * this.gridSize + row + 1;
    }
    ngAfterViewInit() {
        this.updateClamp();
    }
    ngOnChanges(changes) {
        if (changes['gridSize']) {
            this.updateClamp();
        }
    }
    onResize() {
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
    updateClamp() {
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
    clampScroll() {
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
    panBy(deltaX, deltaY) {
        this.scrollX += deltaX;
        this.scrollY += deltaY;
        if (!this.clampScroll()) {
            this.stopPan();
        }
    }
    /** Resets panning so the grid is centered again. */
    centerScroll() {
        this.scrollX = 0;
        this.scrollY = 0;
    }
    /**
     * Starts continuous panning in the given direction. Emits one step
     * immediately, then repeats every 50ms — mirrors the galaxy navigation
     * d-pad behaviour. Stop with {@link stopPan}.
     */
    startPan(direction) {
        this.stopPan();
        this.panStep(direction);
        this.panIntervalId = window.setInterval(() => {
            this.panStep(direction);
        }, this.panRepeatDelay);
    }
    /** Stops the continuous pan interval. */
    stopPan() {
        if (this.panIntervalId !== null) {
            window.clearInterval(this.panIntervalId);
            this.panIntervalId = null;
        }
    }
    /** Clears the pan interval so a held button cannot leak past component teardown. */
    ngOnDestroy() {
        this.stopPan();
    }
    panStep(direction) {
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
    onSurfacePointerDown(event) {
        this.dragMoved = false;
        this.wasDragged = false;
        // While in build mode, cells are interactive (building placement), so
        // drags must not start there. Outside build mode cells are inert, so
        // letting the drag start on them keeps touch panning usable.
        if (this.isBuildMode && this.isCellOrBuilding(event.target)) {
            return;
        }
        const viewport = event.currentTarget;
        viewport.setPointerCapture(event.pointerId);
        this.isSurfaceDragging = true;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        this.dragScrollStartX = this.scrollX;
        this.dragScrollStartY = this.scrollY;
        viewport.classList.add('dragging');
    }
    /** Pointer move during drag — updates scroll with clamping. */
    onSurfacePointerMove(event) {
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
    onSurfacePointerUp(event) {
        if (!this.isSurfaceDragging) {
            return;
        }
        const viewport = event.currentTarget;
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
    isCellOrBuilding(element) {
        let el = element;
        while (el && el !== document.body) {
            if (el.classList.contains('planet-surface__cell') ||
                el.classList.contains('planet-surface__building')) {
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
     */ getBuildingTypeClass(b) {
        const def = this.buildingTypes.find((t) => t.name === b.name || t.id === b.id);
        const id = def?.id ?? this.slugify(b.name);
        return `planet-surface__building--${id.replace(/_/g, '-')}`;
    }
    slugify(name) {
        return name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
    }
};
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "planet", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "gridSize", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "planetColor", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "isometric", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getFactionName", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getFactionColor", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getFactionCurrencies", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getEnergyForPlanet", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getTaxForPlanet", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "planetEconomy", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getPlayerCredits", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "onConfirmBuild", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "hasFactory", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "hasSpaceport", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getProductionPanelVm", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "getSpaceportPanelVm", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "spaceportFleetName", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "spaceportMode", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "spaceportTargetFleetId", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "productionBuildError", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "spaceportError", void 0);
__decorate([
    Input()
], StarMapPlanetScreenComponent.prototype, "isBuildingUnlocked", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "backToStarMap", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "buildConfirmed", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "queueOrder", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "cancelOrder", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "spaceportConfirm", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "spaceportDisband", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "spaceportFleetNameChange", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "openProductionTab", void 0);
__decorate([
    Output()
], StarMapPlanetScreenComponent.prototype, "openSpaceportTab", void 0);
__decorate([
    ViewChild('surfaceViewport')
], StarMapPlanetScreenComponent.prototype, "surfaceViewport", void 0);
__decorate([
    HostListener('window:resize')
], StarMapPlanetScreenComponent.prototype, "onResize", null);
StarMapPlanetScreenComponent = __decorate([
    Component({
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
], StarMapPlanetScreenComponent);
export { StarMapPlanetScreenComponent };

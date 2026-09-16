import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
/*
 * =========================================================
 * STAR MAP GALAXY VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of StarMap: renders the galaxy map
 * viewport (world grid, fog-of-war cells, sensor highlights,
 * star systems, fleets, and the movement target marker).
 *
 * All simulation/selection/camera logic stays in the parent.
 * Event handlers are provided as @Input functions by the
 * parent and are invoked synchronously during the native
 * event dispatch, so `currentTarget`, `stopPropagation`, and
 * `preventDefault` behave exactly like inline bindings.
 */
let StarMapGalaxyViewComponent = class StarMapGalaxyViewComponent {
    movementService;
    cameraX = 0;
    cameraY = 0;
    cellSizeVw = 2;
    cellSizeVh = 2;
    gridColumns = 0;
    gridRows = 0;
    sensorRangeEnabled = true;
    fogCells = [];
    sensorRangeCells = [];
    sensorPreviewCells = [];
    systems = [];
    fleets = [];
    selectedSystem = null;
    selectedFleet = null;
    targetX = null;
    targetY = null;
    trails = [];
    isEnemyInPreview = () => false;
    getFactionColor = () => '#fff';
    onMapClick = () => { };
    onPointerDown = () => { };
    onPointerMove = () => { };
    onPointerUp = () => { };
    onSystemClick = () => { };
    onFleetClick = () => { };
    onSystemContextMenu = () => { };
    onFleetContextMenu = () => { };
    constructor(movementService) {
        this.movementService = movementService;
    }
    /*
     * getTrailTransform: Computes the CSS transform for a movement-trail div
     * that runs from (x1, y1) to (x2, y2) in vw units.
     *
     * The div is positioned at the start point with its left edge there
     * (transform-origin: 0 0), stretched to the line length along the X axis,
     * then rotated around the origin to point toward the target. This avoids
     * needing an SVG/canvas element — pure HTML/CSS.
     *
     * Returns a CSS transform string, or null when the trail has zero length
     * (fleet already at its target) so the template can hide it.
     */
    getTrailTransform(trail) {
        const dx = trail.x2 - trail.x1;
        const dy = trail.y2 - trail.y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length < 0.0001) {
            return null;
        }
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return `rotate(${angleDeg}deg)`;
    }
    /** Returns the line length in vw, or 0 when the trail is degenerate. */
    getTrailLength(trail) {
        const dx = trail.x2 - trail.x1;
        const dy = trail.y2 - trail.y1;
        return Math.sqrt(dx * dx + dy * dy);
    }
};
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "cameraX", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "cameraY", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "cellSizeVw", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "cellSizeVh", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "gridColumns", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "gridRows", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "sensorRangeEnabled", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "fogCells", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "sensorRangeCells", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "sensorPreviewCells", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "systems", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "fleets", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "selectedSystem", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "selectedFleet", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "targetX", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "targetY", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "trails", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "isEnemyInPreview", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "getFactionColor", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onMapClick", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onPointerDown", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onPointerMove", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onPointerUp", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onSystemClick", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onFleetClick", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onSystemContextMenu", void 0);
__decorate([
    Input()
], StarMapGalaxyViewComponent.prototype, "onFleetContextMenu", void 0);
StarMapGalaxyViewComponent = __decorate([
    Component({
        selector: 'app-star-map-galaxy-view',
        standalone: true,
        templateUrl: './star-map-galaxy-view.component.html',
        styleUrl: './star-map-galaxy-view.component.scss',
    })
], StarMapGalaxyViewComponent);
export { StarMapGalaxyViewComponent };

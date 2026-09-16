import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
/*
 * =========================================================
 * STAR MAP SYSTEM GRID VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of StarMap: renders the star system
 * view grid (sun, system-view sensor highlights, planets,
 * fleets inside the system, and the movement target marker).
 *
 * All simulation/selection logic stays in the parent. Event
 * handlers are provided as @Input functions by the parent and
 * are invoked synchronously during the native event dispatch,
 * so `currentTarget`, `stopPropagation`, and `preventDefault`
 * behave exactly like inline bindings.
 */
let StarMapSystemGridViewComponent = class StarMapSystemGridViewComponent {
    movementService;
    selectedSystem = null;
    selectedFleet = null;
    fleets = [];
    targetX = null;
    targetY = null;
    sensorRangeEnabled = true;
    systemSensorCells = { cells: [], preview: [] };
    getFactionColor = () => '#fff';
    getPlanetClassNames = () => [];
    trails = [];
    /*
     * getTrailTransform: Computes the CSS transform for a movement-trail div
     * that runs from (x1, y1) to (x2, y2) in vw units (system view uses vw
     * directly). The div is positioned at the start point with its left edge
     * there (transform-origin: 0 0), stretched to the line length along the
     * X axis, then rotated around the origin to point toward the target.
     * Returns null when the trail is degenerate so the template can hide it.
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
    onSystemGridClick = () => { };
    onPlanetClick = () => { };
    onFleetClick = () => { };
    onPlanetContextMenu = () => { };
    onFleetContextMenu = () => { };
    constructor(movementService) {
        this.movementService = movementService;
    }
};
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "selectedSystem", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "selectedFleet", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "fleets", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "targetX", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "targetY", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "sensorRangeEnabled", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "systemSensorCells", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "getFactionColor", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "getPlanetClassNames", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "trails", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "onSystemGridClick", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "onPlanetClick", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "onFleetClick", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "onPlanetContextMenu", void 0);
__decorate([
    Input()
], StarMapSystemGridViewComponent.prototype, "onFleetContextMenu", void 0);
StarMapSystemGridViewComponent = __decorate([
    Component({
        selector: 'app-star-map-system-grid',
        standalone: true,
        imports: [NgClass],
        templateUrl: './star-map-system-grid.component.html',
        styleUrl: './star-map-system-grid.component.scss',
    })
], StarMapSystemGridViewComponent);
export { StarMapSystemGridViewComponent };

import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarMapMinimapComponent } from '../star-map-minimap/star-map-minimap.component';
/*
 * =========================================================
 * STAR MAP NAVIGATION COMPONENT
 * =========================================================
 *
 * Provides directional buttons for camera panning and a minimap
 * for quick navigation. Uses setInterval for continuous movement
 * while a button is held. Supports both mouse and touch events.
 *
 * The 50ms repeat delay creates a smooth continuous movement effect.
 */
let StarMapNavigationComponent = class StarMapNavigationComponent {
    cameraX = 0;
    cameraY = 0;
    starSystems = [];
    fleets = [];
    cellSizeVw = 2;
    cellSizeVh = 2;
    gridColumns = 100;
    gridRows = 60;
    viewportHeightVw = 56.25;
    cameraMove = new EventEmitter();
    cameraSet = new EventEmitter();
    centerCamera = new EventEmitter();
    intervalId = null;
    repeatDelay = 50;
    /*
     * startMoving: Begins continuous camera movement in the given direction.
     * Emits the first movement immediately, then repeats every 50ms.
     */
    startMoving(direction) {
        this.stopMoving();
        this.cameraMove.emit(direction);
        this.intervalId = window.setInterval(() => {
            this.cameraMove.emit(direction);
        }, this.repeatDelay);
    }
    /*
     * stopMoving: Clears the movement interval.
     * Called on mouseup, mouseleave, touchend, touchcancel.
     */
    stopMoving() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    onMinimapCameraChange(pos) {
        this.cameraSet.emit(pos);
    }
    /*
     * ngOnDestroy: Ensures the interval is cleared when the component is destroyed.
     * Prevents memory leaks from orphaned intervals.
     */
    ngOnDestroy() {
        this.stopMoving();
    }
};
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "cameraX", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "cameraY", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "starSystems", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "fleets", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "cellSizeVw", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "cellSizeVh", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "gridColumns", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "gridRows", void 0);
__decorate([
    Input()
], StarMapNavigationComponent.prototype, "viewportHeightVw", void 0);
__decorate([
    Output()
], StarMapNavigationComponent.prototype, "cameraMove", void 0);
__decorate([
    Output()
], StarMapNavigationComponent.prototype, "cameraSet", void 0);
__decorate([
    Output()
], StarMapNavigationComponent.prototype, "centerCamera", void 0);
StarMapNavigationComponent = __decorate([
    Component({
        selector: 'app-star-map-navigation',
        standalone: true,
        imports: [CommonModule, StarMapMinimapComponent],
        templateUrl: './star-map-navigation.component.html',
        styleUrl: './star-map-navigation.component.scss'
    })
], StarMapNavigationComponent);
export { StarMapNavigationComponent };

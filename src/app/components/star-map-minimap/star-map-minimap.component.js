import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapMinimapComponent = class StarMapMinimapComponent {
    zone;
    starSystems = [];
    fleets = [];
    cameraX = 0;
    cameraY = 0;
    cellSizeVw = 2;
    cellSizeVh = 2;
    gridColumns = 100;
    gridRows = 60;
    viewportHeightVw = 56.25;
    cameraChange = new EventEmitter();
    MINIMAP_W = 240;
    MINIMAP_H = 144;
    dragging = false;
    lastEmit = 0;
    constructor(zone) {
        this.zone = zone;
    }
    get totalMapVw() {
        return this.gridColumns * this.cellSizeVw;
    }
    get totalMapVh() {
        return this.gridRows * this.cellSizeVh;
    }
    get pxPerCol() {
        return this.MINIMAP_W / this.gridColumns;
    }
    get pxPerRow() {
        return this.MINIMAP_H / this.gridRows;
    }
    systemX(s) {
        return (s.x - 1) * this.pxPerCol;
    }
    systemY(s) {
        return (s.y - 1) * this.pxPerRow;
    }
    fleetX(f) {
        return (f.x - 1) * this.pxPerCol;
    }
    fleetY(f) {
        return (f.y - 1) * this.pxPerRow;
    }
    get viewportX() {
        return (this.cameraX / this.totalMapVw) * this.MINIMAP_W;
    }
    get viewportY() {
        return (this.cameraY / this.totalMapVh) * this.MINIMAP_H;
    }
    get viewportW() {
        return (100 / this.totalMapVw) * this.MINIMAP_W;
    }
    get viewportH() {
        return (this.viewportHeightVw / this.totalMapVh) * this.MINIMAP_H;
    }
    get viewBox() {
        return `0 0 ${this.MINIMAP_W} ${this.MINIMAP_H}`;
    }
    onPointerDown(e) {
        this.dragging = true;
        e.target.setPointerCapture(e.pointerId);
        this.emitCamera(e);
    }
    onPointerMove(e) {
        if (!this.dragging) {
            return;
        }
        const now = performance.now();
        if (now - this.lastEmit > 16) {
            this.emitCamera(e);
            this.lastEmit = now;
        }
    }
    onPointerUp() {
        this.dragging = false;
    }
    emitCamera(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const pxX = e.clientX - rect.left;
        const pxY = e.clientY - rect.top;
        const cameraX = (pxX / rect.width) * this.totalMapVw - 50;
        const cameraY = (pxY / rect.height) * this.totalMapVh - this.viewportHeightVw / 2;
        this.zone.run(() => {
            this.cameraChange.emit({ x: cameraX, y: cameraY });
        });
    }
};
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "starSystems", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "fleets", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "cameraX", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "cameraY", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "cellSizeVw", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "cellSizeVh", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "gridColumns", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "gridRows", void 0);
__decorate([
    Input()
], StarMapMinimapComponent.prototype, "viewportHeightVw", void 0);
__decorate([
    Output()
], StarMapMinimapComponent.prototype, "cameraChange", void 0);
StarMapMinimapComponent = __decorate([
    Component({
        selector: 'app-star-map-minimap',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-minimap.component.html',
        styleUrl: './star-map-minimap.component.scss'
    })
], StarMapMinimapComponent);
export { StarMapMinimapComponent };

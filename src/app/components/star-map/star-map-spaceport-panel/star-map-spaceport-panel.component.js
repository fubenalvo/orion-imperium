import { __decorate } from "tslib";
import { Component, EventEmitter, Input, Output, } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapSpaceportPanelComponent = class StarMapSpaceportPanelComponent {
    vm = null;
    fleetName = 'New Fleet';
    mode = 'create';
    targetFleetId = null;
    close = new EventEmitter();
    openBuildMenu = new EventEmitter();
    confirm = new EventEmitter();
    disband = new EventEmitter();
    fleetNameChange = new EventEmitter();
    selected = {};
    setFleetName(value) {
        this.fleetName = value;
        this.fleetNameChange.emit(value);
    }
    inc(typeId, available) {
        const next = (this.selected[typeId] ?? 0) + 1;
        this.selected[typeId] = Math.min(available, next);
    }
    dec(typeId) {
        const next = (this.selected[typeId] ?? 0) - 1;
        this.selected[typeId] = Math.max(0, next);
    }
    count(typeId) {
        return this.selected[typeId] ?? 0;
    }
    totalSelected() {
        return Object.values(this.selected).reduce((a, b) => a + b, 0);
    }
    canConfirm() {
        return this.totalSelected() > 0 && !!this.vm?.selectedSystemId && !!this.vm?.selectedPlanetId;
    }
    selectedSystem(systemId) {
        if (this.vm) {
            this.vm.selectedSystemId = systemId;
            this.vm.selectedPlanetId = null;
        }
    }
    selectedPlanet(planetId) {
        if (this.vm) {
            this.vm.selectedPlanetId = planetId;
        }
    }
    confirmClick() {
        if (!this.vm || !this.canConfirm()) {
            return;
        }
        const composition = Object.entries(this.selected)
            .filter(([, count]) => count > 0)
            .map(([typeId, count]) => ({ typeId, count }));
        this.confirm.emit({
            fleetName: this.fleetName || 'New Fleet',
            composition,
            systemId: this.vm.selectedSystemId,
            planetId: this.vm.selectedPlanetId,
            fleetId: this.targetFleetId,
        });
    }
};
__decorate([
    Input()
], StarMapSpaceportPanelComponent.prototype, "vm", void 0);
__decorate([
    Input()
], StarMapSpaceportPanelComponent.prototype, "fleetName", void 0);
__decorate([
    Input()
], StarMapSpaceportPanelComponent.prototype, "mode", void 0);
__decorate([
    Input()
], StarMapSpaceportPanelComponent.prototype, "targetFleetId", void 0);
__decorate([
    Output()
], StarMapSpaceportPanelComponent.prototype, "close", void 0);
__decorate([
    Output()
], StarMapSpaceportPanelComponent.prototype, "openBuildMenu", void 0);
__decorate([
    Output()
], StarMapSpaceportPanelComponent.prototype, "confirm", void 0);
__decorate([
    Output()
], StarMapSpaceportPanelComponent.prototype, "disband", void 0);
__decorate([
    Output()
], StarMapSpaceportPanelComponent.prototype, "fleetNameChange", void 0);
StarMapSpaceportPanelComponent = __decorate([
    Component({
        selector: 'app-star-map-spaceport-panel',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-spaceport-panel.component.html',
        styleUrl: './star-map-spaceport-panel.component.scss',
    })
], StarMapSpaceportPanelComponent);
export { StarMapSpaceportPanelComponent };

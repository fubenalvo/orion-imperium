import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapFleetButtonsComponent = class StarMapFleetButtonsComponent {
    fleets = [];
    selectedFleetId = null;
    getFactionColor = () => '#fff';
    selectFleet = new EventEmitter();
};
__decorate([
    Input()
], StarMapFleetButtonsComponent.prototype, "fleets", void 0);
__decorate([
    Input()
], StarMapFleetButtonsComponent.prototype, "selectedFleetId", void 0);
__decorate([
    Input()
], StarMapFleetButtonsComponent.prototype, "getFactionColor", void 0);
__decorate([
    Output()
], StarMapFleetButtonsComponent.prototype, "selectFleet", void 0);
StarMapFleetButtonsComponent = __decorate([
    Component({
        selector: 'app-star-map-fleet-buttons',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-fleet-buttons.component.html',
        styleUrl: './star-map-fleet-buttons.component.scss',
    })
], StarMapFleetButtonsComponent);
export { StarMapFleetButtonsComponent };

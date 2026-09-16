import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapFleetInfoComponent = class StarMapFleetInfoComponent {
    fleet = null;
    fleetSummary = [];
    totalAttack = 0;
    totalDefense = 0;
    getFactionColor = () => '#fff';
    isPlayerFleet = false;
    selectedFleetAction = null;
    canReinforce = false;
    canDisband = false;
    close = new EventEmitter();
    setFleetAction = new EventEmitter();
    selectFleet = new EventEmitter();
    reinforce = new EventEmitter();
    disband = new EventEmitter();
};
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "fleet", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "fleetSummary", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "totalAttack", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "totalDefense", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "getFactionColor", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "isPlayerFleet", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "selectedFleetAction", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "canReinforce", void 0);
__decorate([
    Input()
], StarMapFleetInfoComponent.prototype, "canDisband", void 0);
__decorate([
    Output()
], StarMapFleetInfoComponent.prototype, "close", void 0);
__decorate([
    Output()
], StarMapFleetInfoComponent.prototype, "setFleetAction", void 0);
__decorate([
    Output()
], StarMapFleetInfoComponent.prototype, "selectFleet", void 0);
__decorate([
    Output()
], StarMapFleetInfoComponent.prototype, "reinforce", void 0);
__decorate([
    Output()
], StarMapFleetInfoComponent.prototype, "disband", void 0);
StarMapFleetInfoComponent = __decorate([
    Component({
        selector: 'app-star-map-fleet-info',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-fleet-info.component.html',
        styleUrl: './star-map-fleet-info.component.scss',
    })
], StarMapFleetInfoComponent);
export { StarMapFleetInfoComponent };

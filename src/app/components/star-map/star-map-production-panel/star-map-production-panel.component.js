import { __decorate } from "tslib";
import { Component, EventEmitter, Input, Output, } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapProductionPanelComponent = class StarMapProductionPanelComponent {
    vm = null;
    showBuildMenu = false;
    buildError = null;
    openBuildMenu = new EventEmitter();
    closeBuildMenu = new EventEmitter();
    queueOrder = new EventEmitter();
    cancelOrder = new EventEmitter();
    selectedTypeId = null;
    selectedQuantity = 1;
    pickType(shipTypeId) {
        this.selectedTypeId = shipTypeId;
        this.selectedQuantity = 1;
    }
    changeQuantity(delta) {
        const next = this.selectedQuantity + delta;
        this.selectedQuantity = Math.max(1, Math.min(99, next));
    }
    totalCost() {
        if (!this.vm || !this.selectedTypeId) {
            return 0;
        }
        const cost = this.vm.shipCosts[this.selectedTypeId] ?? 0;
        return cost * this.selectedQuantity;
    }
    canQueue() {
        if (!this.vm || !this.selectedTypeId) {
            return false;
        }
        return this.vm.factionCredits >= this.totalCost();
    }
    confirmQueue() {
        if (!this.selectedTypeId) {
            return;
        }
        this.queueOrder.emit({ shipTypeId: this.selectedTypeId, quantity: this.selectedQuantity });
        this.selectedTypeId = null;
        this.selectedQuantity = 1;
        this.closeBuildMenu.emit();
    }
    cancelOrderClick(orderId) {
        this.cancelOrder.emit(orderId);
    }
    formatEta(eta) {
        if (eta == null) {
            return '—';
        }
        if (eta < 1) {
            return '< 1s';
        }
        return `${Math.ceil(eta)}s`;
    }
};
__decorate([
    Input()
], StarMapProductionPanelComponent.prototype, "vm", void 0);
__decorate([
    Input()
], StarMapProductionPanelComponent.prototype, "showBuildMenu", void 0);
__decorate([
    Input()
], StarMapProductionPanelComponent.prototype, "buildError", void 0);
__decorate([
    Output()
], StarMapProductionPanelComponent.prototype, "openBuildMenu", void 0);
__decorate([
    Output()
], StarMapProductionPanelComponent.prototype, "closeBuildMenu", void 0);
__decorate([
    Output()
], StarMapProductionPanelComponent.prototype, "queueOrder", void 0);
__decorate([
    Output()
], StarMapProductionPanelComponent.prototype, "cancelOrder", void 0);
StarMapProductionPanelComponent = __decorate([
    Component({
        selector: 'app-star-map-production-panel',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-production-panel.component.html',
        styleUrl: './star-map-production-panel.component.scss',
    })
], StarMapProductionPanelComponent);
export { StarMapProductionPanelComponent };

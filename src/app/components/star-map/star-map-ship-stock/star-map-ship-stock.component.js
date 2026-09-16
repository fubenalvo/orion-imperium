import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapShipStockComponent = class StarMapShipStockComponent {
    entries = [];
    totalShips = 0;
    showDetails = false;
    toggleDetails() {
        this.showDetails = !this.showDetails;
    }
    closeDetails(event) {
        event.stopPropagation();
        this.showDetails = false;
    }
};
__decorate([
    Input()
], StarMapShipStockComponent.prototype, "entries", void 0);
__decorate([
    Input()
], StarMapShipStockComponent.prototype, "totalShips", void 0);
StarMapShipStockComponent = __decorate([
    Component({
        selector: 'app-star-map-ship-stock',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-ship-stock.component.html',
        styleUrl: './star-map-ship-stock.component.scss',
    })
], StarMapShipStockComponent);
export { StarMapShipStockComponent };

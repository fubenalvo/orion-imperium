import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FactionCurrenciesComponent } from '../faction-currencies/faction-currencies.component';
import { StarMapShipStockComponent, } from '../star-map-ship-stock/star-map-ship-stock.component';
/*
 * =========================================================
 * STAR MAP HEADER
 * =========================================================
 *
 * Shared top HUD used by every star-map view (map, system,
 * planet). The left group shows the view title, the center
 * group holds the time-control buttons ([⏸] [1x] [2x]), and
 * the right group bundles the player's currency row and the
 * global empire ship stock indicator into a single flex
 * container so the spacing is consistent regardless of the
 * view.
 *
 * The header sits at the top 8% of its parent and pushes the
 * view content below it (the view's main grid is positioned with
 * `top: 8%`).
 *
 * Time controls: the header receives `gameSpeed` (1 or 2) and
 * `isPaused` from the StarMap orchestrator and emits
 * `setSpeed` / `togglePause` events back. The actual time
 * state lives in GameTimeService — the header is a pure view
 * of that state.
 */
let StarMapHeaderComponent = class StarMapHeaderComponent {
    title = '';
    currencies = [];
    economyBreakdown = null;
    shipStockEntries = [];
    shipStockTotal = 0;
    gameSpeed = 1;
    isPaused = false;
    setSpeed = new EventEmitter();
    togglePause = new EventEmitter();
    openResearchTree = new EventEmitter();
};
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "title", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "currencies", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "economyBreakdown", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "shipStockEntries", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "shipStockTotal", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "gameSpeed", void 0);
__decorate([
    Input()
], StarMapHeaderComponent.prototype, "isPaused", void 0);
__decorate([
    Output()
], StarMapHeaderComponent.prototype, "setSpeed", void 0);
__decorate([
    Output()
], StarMapHeaderComponent.prototype, "togglePause", void 0);
__decorate([
    Output()
], StarMapHeaderComponent.prototype, "openResearchTree", void 0);
StarMapHeaderComponent = __decorate([
    Component({
        selector: 'app-star-map-header',
        standalone: true,
        imports: [CommonModule, FactionCurrenciesComponent, StarMapShipStockComponent],
        templateUrl: './star-map-header.component.html',
        styleUrl: './star-map-header.component.scss',
    })
], StarMapHeaderComponent);
export { StarMapHeaderComponent };

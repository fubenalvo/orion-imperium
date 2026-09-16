import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapSystemInfoComponent = class StarMapSystemInfoComponent {
    system = null;
    getFactionName = () => 'Unknown';
    enterSystem = new EventEmitter();
    close = new EventEmitter();
};
__decorate([
    Input()
], StarMapSystemInfoComponent.prototype, "system", void 0);
__decorate([
    Input()
], StarMapSystemInfoComponent.prototype, "getFactionName", void 0);
__decorate([
    Output()
], StarMapSystemInfoComponent.prototype, "enterSystem", void 0);
__decorate([
    Output()
], StarMapSystemInfoComponent.prototype, "close", void 0);
StarMapSystemInfoComponent = __decorate([
    Component({
        selector: 'app-star-map-system-info',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-system-info.component.html',
        styleUrl: './star-map-system-info.component.scss',
    })
], StarMapSystemInfoComponent);
export { StarMapSystemInfoComponent };

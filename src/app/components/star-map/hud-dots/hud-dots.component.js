import { __decorate } from "tslib";
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
let HudDotsComponent = class HudDotsComponent {
    count = 4;
    active = 3;
    size = 'md';
    get dots() {
        return Array.from({ length: this.count }, (_, i) => i < this.active);
    }
};
__decorate([
    Input()
], HudDotsComponent.prototype, "count", void 0);
__decorate([
    Input()
], HudDotsComponent.prototype, "active", void 0);
__decorate([
    Input()
], HudDotsComponent.prototype, "size", void 0);
HudDotsComponent = __decorate([
    Component({
        selector: 'app-hud-dots',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './hud-dots.component.html',
        styleUrl: './hud-dots.component.scss',
    })
], HudDotsComponent);
export { HudDotsComponent };

import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
let StarMapContextMenuComponent = class StarMapContextMenuComponent {
    contextMenu = null;
    selectItem = new EventEmitter();
    close = new EventEmitter();
};
__decorate([
    Input()
], StarMapContextMenuComponent.prototype, "contextMenu", void 0);
__decorate([
    Output()
], StarMapContextMenuComponent.prototype, "selectItem", void 0);
__decorate([
    Output()
], StarMapContextMenuComponent.prototype, "close", void 0);
StarMapContextMenuComponent = __decorate([
    Component({
        selector: 'app-star-map-context-menu',
        standalone: true,
        imports: [CommonModule],
        templateUrl: './star-map-context-menu.component.html',
        styleUrl: './star-map-context-menu.component.scss',
    })
], StarMapContextMenuComponent);
export { StarMapContextMenuComponent };

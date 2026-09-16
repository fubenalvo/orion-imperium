import { __decorate } from "tslib";
import { Component, inject, HostListener } from '@angular/core';
import { GameSettingsService } from '../../services/game-settings.service';
/*
 * =========================================================
 * STAR MAP OPTIONS COMPONENT
 * =========================================================
 *
 * Overlay options menu accessible from the main menu and the
 * pause menu. Currently exposes the fog-of-war toggle.
 *
 * Lifecycle:
 *   - Rendered conditionally by App via the optionsMenuOpen
 *     getter from GameSettingsService.
 *   - ESC key closes the overlay (document-level listener).
 *   - BACK button emits a close event.
 */
let StarMapOptionsComponent = class StarMapOptionsComponent {
    gameSettingsService = inject(GameSettingsService);
    fogOfWarEnabled = this.gameSettingsService.fogOfWarEnabled;
    onToggleFogOfWar() {
        this.gameSettingsService.toggleFogOfWar();
    }
    onClose() {
        this.gameSettingsService.closeOptionsMenu();
    }
    onBackdropClick(event) {
        if (event.target === event.currentTarget) {
            this.onClose();
        }
    }
    onEscape() {
        this.onClose();
    }
};
__decorate([
    HostListener('document:keydown.escape')
], StarMapOptionsComponent.prototype, "onEscape", null);
StarMapOptionsComponent = __decorate([
    Component({
        selector: 'app-star-map-options',
        standalone: true,
        templateUrl: './star-map-options.component.html',
        styleUrl: './star-map-options.component.scss',
    })
], StarMapOptionsComponent);
export { StarMapOptionsComponent };

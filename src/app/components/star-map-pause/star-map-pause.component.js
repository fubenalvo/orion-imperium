import { __decorate } from "tslib";
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { SaveSlotId } from '../../services/save-game.service';
/*
 * =========================================================
 * STAR MAP PAUSE COMPONENT
 * =========================================================
 *
 * Renders the pause menu overlay and handles save/load UI.
 * Communicates with StarMap via event emitters.
 *
 * States:
 * - Normal: shows ☰ hamburger button (opens pause menu)
 * - Paused (menu open): shows Continue, Save, Load, Main Menu buttons
 * - Paused (load slots): shows 4 save slots for loading
 *
 * Notes:
 * - The simulation freezes when paused (via GameTimeService), and the
 *   overlay appears when the hamburger button is clicked or ESC is pressed.
 * - The ☰ button opens the pause menu (pause + overlay).
 * - ESC opens the pause menu (pause + overlay).
 */
let StarMapPauseComponent = class StarMapPauseComponent {
    saveGameService;
    pauseMenuOpen = false;
    currentSlot = null;
    loadError = '';
    saveError = '';
    openPauseMenu = new EventEmitter();
    closePauseMenu = new EventEmitter();
    saveGame = new EventEmitter();
    loadGame = new EventEmitter();
    togglePause = new EventEmitter();
    exitToMainMenu = new EventEmitter();
    openOptionsMenu = new EventEmitter();
    SaveSlotId = SaveSlotId;
    showLoadSlots = false;
    showSaveSlots = false;
    gameSaved = false;
    savedMessageTimeout = null;
    constructor(saveGameService) {
        this.saveGameService = saveGameService;
    }
    get slots() {
        return this.saveGameService.getSlots();
    }
    hasAnySave() {
        return this.saveGameService.hasAnySave();
    }
    formatDate(date) {
        if (!date) {
            return 'Empty';
        }
        const d = new Date(date);
        return d.toLocaleString();
    }
    /*
     * onSaveGame: Opens manual save slot selection instead of saving immediately.
     * The actual save is handled by StarMap after the player selects a slot.
     */
    onSaveGame() {
        this.showSaveSlots = true;
    }
    onSaveSlotSelected(slotIndex) {
        this.saveGame.emit(slotIndex);
        this.showSaveSlots = false;
        this.gameSaved = true;
        if (this.savedMessageTimeout) {
            clearTimeout(this.savedMessageTimeout);
        }
        this.savedMessageTimeout = window.setTimeout(() => {
            this.gameSaved = false;
        }, 2000);
    }
    onLoadGame() {
        this.showLoadSlots = true;
    }
    onBackToMenu() {
        this.showLoadSlots = false;
        this.showSaveSlots = false;
    }
    onSelectSlot(slotIndex) {
        this.loadGame.emit(slotIndex);
        this.showLoadSlots = false;
    }
};
__decorate([
    Input()
], StarMapPauseComponent.prototype, "pauseMenuOpen", void 0);
__decorate([
    Input()
], StarMapPauseComponent.prototype, "currentSlot", void 0);
__decorate([
    Input()
], StarMapPauseComponent.prototype, "loadError", void 0);
__decorate([
    Input()
], StarMapPauseComponent.prototype, "saveError", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "openPauseMenu", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "closePauseMenu", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "saveGame", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "loadGame", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "togglePause", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "exitToMainMenu", void 0);
__decorate([
    Output()
], StarMapPauseComponent.prototype, "openOptionsMenu", void 0);
StarMapPauseComponent = __decorate([
    Component({
        selector: 'app-star-map-pause',
        standalone: true,
        templateUrl: './star-map-pause.component.html',
        styleUrl: './star-map-pause.component.scss',
    })
], StarMapPauseComponent);
export { StarMapPauseComponent };

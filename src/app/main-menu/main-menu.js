import { __decorate } from "tslib";
import { Component, HostListener } from '@angular/core';
import { MANUAL_SLOT_START, } from '../services/save-game.service';
import starMapData from '../components/star-map/star-map-data.json';
let MainMenu = class MainMenu {
    saveGameService;
    router;
    gameSettingsService;
    showNewGameSlots = false;
    showLoadGameSlots = false;
    showInstallButton = false;
    showIOSGuide = false;
    deferredPrompt = null;
    constructor(saveGameService, router, gameSettingsService) {
        this.saveGameService = saveGameService;
        this.router = router;
        this.gameSettingsService = gameSettingsService;
    }
    ngOnInit() {
        this.updateInstallVisibility();
    }
    onResize() {
        this.updateInstallVisibility();
    }
    updateInstallVisibility() {
        if (this.isStandalone) {
            this.showInstallButton = false;
            this.showIOSGuide = false;
            this.removeDisplayModeListener();
            return;
        }
        if (this.isMobile) {
            this.showInstallButton = true;
            this.addDisplayModeListener();
        }
        else {
            this.showInstallButton = false;
            this.removeDisplayModeListener();
        }
    }
    ngOnDestroy() {
        this.removeDisplayModeListener();
    }
    get slots() {
        return this.saveGameService.getSlots();
    }
    get hasAnySave() {
        return this.saveGameService.hasAnySave();
    }
    formatDate(date) {
        if (!date) {
            return 'Empty';
        }
        const d = new Date(date);
        return d.toLocaleString();
    }
    onInstallClick() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            this.deferredPrompt.userChoice.then((choice) => {
                if (choice.outcome === 'accepted') {
                    this.showInstallButton = false;
                }
                this.deferredPrompt = null;
            });
        }
        else {
            this.showIOSGuide = true;
        }
    }
    onCloseIOSGuide() {
        this.showIOSGuide = false;
    }
    newGame(slotIndex) {
        if (slotIndex < MANUAL_SLOT_START) {
            return;
        }
        const defaultData = structuredClone(starMapData);
        this.saveGameService.saveToSlot(slotIndex, defaultData);
        if (!this.saveGameService.activateSlot(slotIndex)) {
            return;
        }
        this.router.navigate(['/star-map']);
    }
    loadGame(slotIndex) {
        if (!this.saveGameService.activateSlot(slotIndex)) {
            return;
        }
        this.router.navigate(['/star-map']);
    }
    onOptions() {
        this.gameSettingsService.openOptionsMenu();
    }
    onBeforeInstallPrompt(event) {
        const promptEvent = event;
        promptEvent.preventDefault();
        this.deferredPrompt = promptEvent;
        if (this.isMobile && !this.isStandalone) {
            this.showInstallButton = true;
        }
    }
    onAppInstalled() {
        this.showInstallButton = false;
        this.showIOSGuide = false;
        this.deferredPrompt = null;
        this.removeDisplayModeListener();
    }
    onWindowLoad() {
        const nav = window.navigator;
        if (nav.standalone) {
            this.showInstallButton = false;
            this.showIOSGuide = false;
        }
    }
    get isMobile() {
        return window.innerWidth <= 768;
    }
    get isStandalone() {
        const nav = window.navigator;
        const displayModeStandalone = typeof window.matchMedia === 'function'
            ? window.matchMedia('(display-mode: standalone)').matches
            : false;
        return nav.standalone === true || displayModeStandalone;
    }
    displayModeListener = null;
    addDisplayModeListener() {
        this.removeDisplayModeListener();
        const mq = window.matchMedia('(display-mode: standalone)');
        this.displayModeListener = (e) => {
            if (e.matches) {
                this.showInstallButton = false;
                this.showIOSGuide = false;
            }
        };
        mq.addEventListener('change', this.displayModeListener);
    }
    removeDisplayModeListener() {
        if (this.displayModeListener) {
            const mq = window.matchMedia('(display-mode: standalone)');
            mq.removeEventListener('change', this.displayModeListener);
            this.displayModeListener = null;
        }
    }
};
__decorate([
    HostListener('window:resize')
], MainMenu.prototype, "onResize", null);
__decorate([
    HostListener('window:beforeinstallprompt', ['$event'])
], MainMenu.prototype, "onBeforeInstallPrompt", null);
__decorate([
    HostListener('window:appinstalled')
], MainMenu.prototype, "onAppInstalled", null);
__decorate([
    HostListener('window:load')
], MainMenu.prototype, "onWindowLoad", null);
MainMenu = __decorate([
    Component({
        selector: 'app-main-menu',
        styleUrl: './main-menu.scss',
        templateUrl: './main-menu.html',
    })
], MainMenu);
export { MainMenu };

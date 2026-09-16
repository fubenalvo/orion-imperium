import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
let GameSettingsService = class GameSettingsService {
    _fogOfWarEnabled = true;
    _optionsMenuOpen = false;
    state$ = new BehaviorSubject({
        fogOfWarEnabled: true,
        optionsMenuOpen: false,
    });
    get fogOfWarEnabled() {
        return this._fogOfWarEnabled;
    }
    get optionsMenuOpen() {
        return this._optionsMenuOpen;
    }
    openOptionsMenu() {
        this._optionsMenuOpen = true;
        this.emitState();
    }
    closeOptionsMenu() {
        this._optionsMenuOpen = false;
        this.emitState();
    }
    setFogOfWarEnabled(enabled) {
        this._fogOfWarEnabled = enabled;
        this.emitState();
    }
    toggleFogOfWar() {
        this._fogOfWarEnabled = !this._fogOfWarEnabled;
        this.emitState();
    }
    emitState() {
        this.state$.next({
            fogOfWarEnabled: this._fogOfWarEnabled,
            optionsMenuOpen: this._optionsMenuOpen,
        });
    }
};
GameSettingsService = __decorate([
    Injectable({ providedIn: 'root' })
], GameSettingsService);
export { GameSettingsService };

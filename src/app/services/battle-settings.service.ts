import { Injectable, signal } from '@angular/core';

const AUTO_BATTLE_STORAGE_KEY = 'orion_battle_auto_battle';

@Injectable({ providedIn: 'root' })
export class BattleSettingsService {
  private _autoBattleEnabled = signal<boolean>(true);

  readonly autoBattleEnabled = this._autoBattleEnabled.asReadonly();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(AUTO_BATTLE_STORAGE_KEY);
      if (stored !== null) {
        this._autoBattleEnabled.set(JSON.parse(stored));
      }
    } catch {
      // If parsing fails, keep default (true)
    }
  }

  toggleAutoBattle(): void {
    const newValue = !this._autoBattleEnabled();
    this._autoBattleEnabled.set(newValue);
    this.saveToStorage(newValue);
  }

  setAutoBattle(enabled: boolean): void {
    this._autoBattleEnabled.set(enabled);
    this.saveToStorage(enabled);
  }

  private saveToStorage(enabled: boolean): void {
    try {
      localStorage.setItem(AUTO_BATTLE_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Ignore storage errors
    }
  }
}
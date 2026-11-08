import { Injectable, signal } from '@angular/core';

const AUTO_BATTLE_STORAGE_KEY = 'orion_battle_auto_battle';
const PAUSED_START_STORAGE_KEY = 'orion_battle_paused_start';

/*
 * Battle screen preferences, remembered per browser in localStorage (not
 * part of any save):
 *  - AUTO battle: the tactical AI moves the player's stacks (default on);
 *  - paused start: a battle opens paused so the player can inspect ships
 *    and give orders before the first shot (default on,
 *    docs/ship-equipment.md D.6).
 */
@Injectable({ providedIn: 'root' })
export class BattleSettingsService {
  private _autoBattleEnabled = signal<boolean>(true);
  private _pausedStart = signal<boolean>(true);

  readonly autoBattleEnabled = this._autoBattleEnabled.asReadonly();
  readonly pausedStart = this._pausedStart.asReadonly();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    this.loadFlag(AUTO_BATTLE_STORAGE_KEY, (value) => this._autoBattleEnabled.set(value));
    this.loadFlag(PAUSED_START_STORAGE_KEY, (value) => this._pausedStart.set(value));
  }

  /* Reads a stored boolean; a missing, unreadable or non-boolean value keeps the default. */
  private loadFlag(key: string, apply: (value: boolean) => void): void {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        const value = JSON.parse(stored);
        if (typeof value === 'boolean') {
          apply(value);
        }
      }
    } catch {
      // Keep the default.
    }
  }

  toggleAutoBattle(): void {
    this.setAutoBattle(!this._autoBattleEnabled());
  }

  setAutoBattle(enabled: boolean): void {
    this._autoBattleEnabled.set(enabled);
    this.saveFlag(AUTO_BATTLE_STORAGE_KEY, enabled);
  }

  togglePausedStart(): void {
    this.setPausedStart(!this._pausedStart());
  }

  setPausedStart(enabled: boolean): void {
    this._pausedStart.set(enabled);
    this.saveFlag(PAUSED_START_STORAGE_KEY, enabled);
  }

  private saveFlag(key: string, enabled: boolean): void {
    try {
      localStorage.setItem(key, JSON.stringify(enabled));
    } catch {
      // Ignore storage errors
    }
  }
}

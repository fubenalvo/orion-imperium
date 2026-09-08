import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/*
 * =========================================================
 * GAME SETTINGS SERVICE
 * =========================================================
 *
 * Centralized owner of persistent game settings.
 * Settings survive route changes because the service is a
 * root-level singleton (providedIn: 'root').
 *
 * Current settings:
 *   fogOfWarEnabled — toggles the fog-of-war / sensor range
 *                     overlay on the star map.
 *
 * state$ emits only on discrete setting changes to avoid
 * unnecessary change detection cycles.
 */

export interface GameSettings {
  fogOfWarEnabled: boolean;
  optionsMenuOpen: boolean;
}

@Injectable({ providedIn: 'root' })
export class GameSettingsService {
  private _fogOfWarEnabled = true;
  private _optionsMenuOpen = false;

  readonly state$ = new BehaviorSubject<GameSettings>({
    fogOfWarEnabled: true,
    optionsMenuOpen: false,
  });

  get fogOfWarEnabled(): boolean {
    return this._fogOfWarEnabled;
  }

  get optionsMenuOpen(): boolean {
    return this._optionsMenuOpen;
  }

  openOptionsMenu(): void {
    this._optionsMenuOpen = true;
    this.emitState();
  }

  closeOptionsMenu(): void {
    this._optionsMenuOpen = false;
    this.emitState();
  }

  setFogOfWarEnabled(enabled: boolean): void {
    this._fogOfWarEnabled = enabled;
    this.emitState();
  }

  toggleFogOfWar(): void {
    this._fogOfWarEnabled = !this._fogOfWarEnabled;
    this.emitState();
  }

  private emitState(): void {
    this.state$.next({
      fogOfWarEnabled: this._fogOfWarEnabled,
      optionsMenuOpen: this._optionsMenuOpen,
    });
  }
}

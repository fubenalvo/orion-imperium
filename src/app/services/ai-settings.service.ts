import { Injectable, signal } from '@angular/core';
import { setAdaptiveDifficultyEnabled } from '../components/star-map/ai-difficulty';

const ADAPTIVE_STORAGE_KEY = 'orion_ai_adaptive';

/*
 * AI preferences, remembered per browser in localStorage (not part of any
 * save), shown in the Options menu:
 *  - ADAPTIVE AI: the AI difficulty follows the player's progress inside
 *    each AI's difficulty band (default on; ai-difficulty.ts,
 *    AiAdaptiveDifficultyService). Global: it applies to every game,
 *    including saves started before it existed, and takes effect at once.
 *
 * The App root component injects this service, which pushes the stored
 * value into the module-level switch the economy and AI read. Nothing else
 * creates it in headless games, so simulations stay non-adaptive.
 */
@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  private readonly _adaptive = signal<boolean>(true);

  readonly adaptive = this._adaptive.asReadonly();

  constructor() {
    try {
      const stored = localStorage.getItem(ADAPTIVE_STORAGE_KEY);
      if (stored !== null) {
        const value = JSON.parse(stored);
        if (typeof value === 'boolean') this._adaptive.set(value);
      }
    } catch {
      // Keep the default.
    }
    setAdaptiveDifficultyEnabled(this._adaptive());
  }

  setAdaptive(enabled: boolean): void {
    this._adaptive.set(enabled);
    setAdaptiveDifficultyEnabled(enabled);
    try {
      localStorage.setItem(ADAPTIVE_STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // Ignore storage errors.
    }
  }

  toggleAdaptive(): void {
    this.setAdaptive(!this._adaptive());
  }
}

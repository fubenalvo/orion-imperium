import { Injectable, signal } from '@angular/core';

const FRAME_LIMIT_STORAGE_KEY = 'orion_frame_limit';

/*
 * Frame-rate cap for the star map and battle requestAnimationFrame loops,
 * added because phones (often 90–120 Hz) ran the full simulation plus
 * change detection every display frame and overheated / drained the battery.
 *
 * Caps: 10 FPS while paused, 30 FPS on touch devices (pointer: coarse),
 * 60 FPS otherwise. The FPS LIMIT Options toggle (localStorage, default on)
 * turns the cap off. Skipped frames do not lose time: the loops measure the
 * delta from the last processed frame, so game speed is unchanged.
 */
@Injectable({ providedIn: 'root' })
export class FrameLimitService {
  private readonly _enabled = signal<boolean>(true);
  readonly enabled = this._enabled.asReadonly();
  private readonly mobile =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

  constructor() {
    try {
      const stored = localStorage.getItem(FRAME_LIMIT_STORAGE_KEY);
      if (stored !== null) {
        const value = JSON.parse(stored);
        if (typeof value === 'boolean') this._enabled.set(value);
      }
    } catch {
      // Keep the default.
    }
  }

  toggle(): void {
    this._enabled.set(!this._enabled());
    try {
      localStorage.setItem(FRAME_LIMIT_STORAGE_KEY, JSON.stringify(this._enabled()));
    } catch {
      // Ignore storage errors.
    }
  }

  /**
   * Whether a frame `elapsedMs` after the last processed one should be skipped.
   * A 1 ms tolerance keeps a 60 Hz display from dropping every other frame.
   */
  shouldSkip(elapsedMs: number, paused: boolean): boolean {
    if (!this._enabled()) return false;
    const fps = paused ? 10 : this.mobile ? 30 : 60;
    return elapsedMs < 1000 / fps - 1;
  }
}

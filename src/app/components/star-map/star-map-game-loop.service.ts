import { Injectable, NgZone } from '@angular/core';

/*
 * =========================================================
 * STAR MAP GAME LOOP SERVICE
 * =========================================================
 *
 * Manages the requestAnimationFrame game loop.
 * Runs outside Angular zone to avoid unnecessary change detection.
 *
 * Change detection is the responsibility of the caller component,
 * not this service. The update callback should return whether
 * any fleets moved, and the component can decide whether to
 * trigger change detection.
 */

@Injectable({ providedIn: 'root' })
export class StarMapGameLoopService {
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  constructor(private ngZone: NgZone) {}

  /*
   * startGameLoop: Begins the game loop.
   * Must be called after view init.
   */
  startGameLoop(updateCallback: (deltaTime: number) => void): void {
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.tick(time, updateCallback));
    });
  }

  /*
   * tick: Internal frame handler.
   * Calculates deltaTime, calls update callback, and schedules next frame.
   */
  private tick(time: number, updateCallback: (deltaTime: number) => void): void {
    const deltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;

    updateCallback(deltaTime);

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((nextTime) =>
        this.tick(nextTime, updateCallback),
      );
    });
  }

  /*
   * pauseGame: Cancels the animation frame.
   */
  pauseGame(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /*
   * resumeGame: Restarts the loop from current time.
   */
  resumeGame(updateCallback: (deltaTime: number) => void): void {
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.tick(time, updateCallback));
    });
  }

  /*
   * stopGameLoop: Permanent stop, used on destroy.
   */
  stopGameLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

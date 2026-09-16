import { Injectable, NgZone } from '@angular/core';

/*
 * =========================================================
 * BATTLE MINIGAME — GAME LOOP SERVICE
 * =========================================================
 *
 * Manages the requestAnimationFrame game loop for the battle minigame.
 * Runs outside Angular zone to avoid unnecessary change detection.
 *
 * Unlike StarMapGameLoopService, this does NOT delegate to GameTimeService
 * for delta scaling — the battle minigame pauses GameTimeService entirely
 * (gameTimeService.pause()), so getScaledDeltaTime would return 0.
 * The battle loop always runs at real-time speed.
 *
 * The update callback receives the raw real delta time (clamped to 0.1s).
 * Change detection is the responsibility of the caller — the battle screen
 * component triggers it via BattleAnimationService.ticks$ on each tick.
 */

@Injectable({ providedIn: 'root' })
export class BattleGameLoopService {
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  constructor(private ngZone: NgZone) {}

  /*
   * startGameLoop: Begins the game loop. Must be called after view init.
   * The loop runs continuously until stopGameLoop() is called.
   */
  startGameLoop(updateCallback: (deltaTime: number) => void): void {
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.tick(time, updateCallback));
    });
  }

  /*
   * tick: Internal frame handler.
   * Calculates real delta time (clamped to 0.1s to prevent spikes
   * when the browser tab is suspended), calls the update callback.
   */
  private tick(time: number, updateCallback: (deltaTime: number) => void): void {
    const realDeltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;

    updateCallback(realDeltaTime);

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((nextTime) =>
        this.tick(nextTime, updateCallback),
      );
    });
  }

  /*
   * stopGameLoop: Stops the game loop. Called on destroy.
   */
  stopGameLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}

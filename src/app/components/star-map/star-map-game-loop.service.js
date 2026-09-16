import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
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
 *
 * The RAF loop ALWAYS runs — it is never paused or canceled
 * for game pause. Instead, GameTimeService.getScaledDeltaTime()
 * returns 0 when the game is paused, so simulation systems
 * receive a 0 delta and naturally freeze. This keeps UI/input
 * responsive while the game is paused.
 */
let StarMapGameLoopService = class StarMapGameLoopService {
    ngZone;
    gameTimeService;
    animationFrameId = null;
    lastFrameTime = 0;
    constructor(ngZone, gameTimeService) {
        this.ngZone = ngZone;
        this.gameTimeService = gameTimeService;
    }
    /*
     * startGameLoop: Begins the game loop. Must be called after view init.
     * The loop runs continuously; pausing is handled by GameTimeService
     * returning 0 for the scaled delta time.
     */
    startGameLoop(updateCallback) {
        this.lastFrameTime = performance.now();
        this.ngZone.runOutsideAngular(() => {
            this.animationFrameId = requestAnimationFrame((time) => this.tick(time, updateCallback));
        });
    }
    /*
     * tick: Internal frame handler.
     * Calculates real delta time (clamped to 0.1s to prevent spikes
     * when the browser tab is suspended), delegates scaling to
     * GameTimeService, and calls the update callback with the scaled
     * game delta time.
     *
     * When paused, getScaledDeltaTime returns 0 — the callback still
     * runs (keeping the loop alive for UI/input) but all simulation
     * systems advance by 0.
     */
    tick(time, updateCallback) {
        const realDeltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);
        this.lastFrameTime = time;
        this.gameTimeService.onTick(realDeltaTime);
        const gameDeltaTime = this.gameTimeService.getScaledDeltaTime(realDeltaTime);
        updateCallback(gameDeltaTime);
        this.ngZone.runOutsideAngular(() => {
            this.animationFrameId = requestAnimationFrame((nextTime) => this.tick(nextTime, updateCallback));
        });
    }
    /*
     * stopGameLoop: Permanent stop, used on destroy.
     * The loop is otherwise never stopped — pause is handled by
     * GameTimeService returning 0 for scaled delta.
     */
    stopGameLoop() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
};
StarMapGameLoopService = __decorate([
    Injectable({ providedIn: 'root' })
], StarMapGameLoopService);
export { StarMapGameLoopService };

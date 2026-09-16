import { __decorate } from "tslib";
import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
/*
 * =========================================================
 * BATTLE MINIGAME — ANIMATION LOCK SERVICE
 * =========================================================
 *
 * Single source of truth for "is an animation in flight?". Every visual
 * sequence runs through run()/wait(), and the busy flag gates:
 *   - the END TURN button
 *   - all movement / attack / selection input
 *   - AI turn progression
 *
 * ticks$ emits after every state mutation that happens mid-animation
 * (effect phase changes, damage application) so the view can re-render
 * projectile / impact / explosion stages without polling.
 */
let BattleAnimationService = class BattleAnimationService {
    activeCount = 0;
    busy = signal(false);
    ticks$ = new Subject();
    get isBusy() {
        return this.activeCount > 0;
    }
    begin() {
        this.activeCount++;
        this.busy.set(true);
    }
    end() {
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.busy.set(this.activeCount > 0);
    }
    /* Wraps an animation sequence, guaranteeing begin/end balance even on failure. */
    run(fn) {
        this.begin();
        return Promise.resolve()
            .then(fn)
            .finally(() => this.end());
    }
    /* Duration-matched wait. Deterministic under vi.useFakeTimers(). */
    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /* Notify the view that mid-animation state changed. */
    tick() {
        this.ticks$.next();
    }
    /* Hard reset for component destroy / battle end. */
    reset() {
        this.activeCount = 0;
        this.busy.set(false);
    }
};
BattleAnimationService = __decorate([
    Injectable({ providedIn: 'root' })
], BattleAnimationService);
export { BattleAnimationService };

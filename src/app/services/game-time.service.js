import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
let GameTimeService = class GameTimeService {
    _speed = 1;
    _isPaused = false;
    _gameElapsedTime = 0;
    state$ = new BehaviorSubject({
        speed: 1,
        isPaused: false,
        gameElapsedTime: 0,
    });
    get speed() {
        return this._speed;
    }
    get isPaused() {
        return this._isPaused;
    }
    get gameElapsedTime() {
        return this._gameElapsedTime;
    }
    /*
     * setSpeed: Sets the simulation speed multiplier and un-pauses.
     * Calling setSpeed always resumes the simulation.
     */
    setSpeed(speed) {
        this._speed = speed;
        this._isPaused = false;
        this.emitState();
    }
    /*
     * pause: Freezes simulation without losing the current speed.
     * The next resume() or setSpeed() call restores the same speed.
     */
    pause() {
        if (this._isPaused)
            return;
        this._isPaused = true;
        this.emitState();
    }
    /*
     * resume: Resumes simulation at the current speed.
     */
    resume() {
        if (!this._isPaused)
            return;
        this._isPaused = false;
        this.emitState();
    }
    /*
     * togglePause: Convenient toggle for the ⏸ button and Space key.
     * Preserves the current speed across the pause/resume cycle.
     */
    togglePause() {
        this._isPaused = !this._isPaused;
        this.emitState();
    }
    /*
     * getScaledDeltaTime: The single authoritative speed multiplier.
     * Returns 0 when paused, realDeltaTime * speed when running.
     * realDeltaTime should already be clamped to a max frame step
     * (StarMapGameLoopService clamps to 0.1 s before calling this).
     */
    getScaledDeltaTime(realDeltaTime) {
        if (this._isPaused)
            return 0;
        return realDeltaTime * this._speed;
    }
    /*
     * onTick: Called every RAF frame with the raw real delta time.
     * Accumulates gameElapsedTime for future features (calendar,
     * scheduled events, fleet ETAs, etc.). Emits state$ only on
     * discrete state changes, not per-frame, to avoid CD thrashing.
     */
    onTick(realDeltaTime) {
        if (this._isPaused)
            return;
        this._gameElapsedTime += realDeltaTime * this._speed;
    }
    /*
     * reset: Restores default state (1x, not paused, 0 elapsed).
     * Called on new game and after loading a save.
     */
    reset() {
        this._speed = 1;
        this._isPaused = false;
        this._gameElapsedTime = 0;
        this.emitState();
    }
    emitState() {
        this.state$.next({
            speed: this._speed,
            isPaused: this._isPaused,
            gameElapsedTime: this._gameElapsedTime,
        });
    }
};
GameTimeService = __decorate([
    Injectable({ providedIn: 'root' })
], GameTimeService);
export { GameTimeService };

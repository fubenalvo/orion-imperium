import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/*
 * =========================================================
 * GAME TIME SERVICE
 * =========================================================
 *
 * Centralized owner of simulation-time state. All gameplay
 * systems receive the scaled game delta time from here; none
 * of them check pause or multiply speed themselves.
 *
 * Time states:
 *   speed = 1 → gameDelta = realDelta (normal)
 *   speed = 2 → gameDelta = realDelta * 2 (double)
 *   isPaused = true → gameDelta = 0 (simulation frozen)
 *
 * The RAF loop always runs (see StarMapGameLoopService); it
 * calls getScaledDeltaTime() every frame and feeds the result
 * to the simulation update callback. When paused the callback
 * still fires but receives 0, so UI/input stays responsive.
 *
 * speed is a numeric multiplier (not an enum of labels) so
 * that 0.5x, 4x, 8x etc. can be added later by extending
 * the GameSpeed type with one additional union member.
 *
 * isPaused is tracked separately from speed so that
 * togglePause() / pause() / resume() preserve the current
 * speed value across pause cycles.
 *
 * state$ emits only on discrete state changes (pause, resume,
 * setSpeed, reset) — NOT on every frame tick — to avoid
 * unnecessary change detection.
 */

export type GameSpeed = 1 | 2;

export interface TimeState {
  speed: GameSpeed;
  isPaused: boolean;
  gameElapsedTime: number;
}

@Injectable({ providedIn: 'root' })
export class GameTimeService {
  private _speed: GameSpeed = 1;
  private _isPaused = false;
  private _gameElapsedTime = 0;

  readonly state$ = new BehaviorSubject<TimeState>({
    speed: 1,
    isPaused: false,
    gameElapsedTime: 0,
  });

  get speed(): GameSpeed {
    return this._speed;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get gameElapsedTime(): number {
    return this._gameElapsedTime;
  }

  /*
   * setSpeed: Sets the simulation speed multiplier and un-pauses.
   * Calling setSpeed always resumes the simulation.
   */
  setSpeed(speed: GameSpeed): void {
    this._speed = speed;
    this._isPaused = false;
    this.emitState();
  }

  /*
   * pause: Freezes simulation without losing the current speed.
   * The next resume() or setSpeed() call restores the same speed.
   */
  pause(): void {
    if (this._isPaused) return;
    this._isPaused = true;
    this.emitState();
  }

  /*
   * resume: Resumes simulation at the current speed.
   */
  resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    this.emitState();
  }

  /*
   * togglePause: Convenient toggle for the ⏸ button and Space key.
   * Preserves the current speed across the pause/resume cycle.
   */
  togglePause(): void {
    this._isPaused = !this._isPaused;
    this.emitState();
  }

  /*
   * getScaledDeltaTime: The single authoritative speed multiplier.
   * Returns 0 when paused, realDeltaTime * speed when running.
   * realDeltaTime should already be clamped to a max frame step
   * (StarMapGameLoopService clamps to 0.1 s before calling this).
   */
  getScaledDeltaTime(realDeltaTime: number): number {
    if (this._isPaused) return 0;
    return realDeltaTime * this._speed;
  }

  /*
   * onTick: Called every RAF frame with the raw real delta time.
   * Accumulates gameElapsedTime for future features (calendar,
   * scheduled events, fleet ETAs, etc.). Emits state$ only on
   * discrete state changes, not per-frame, to avoid CD thrashing.
   */
  onTick(realDeltaTime: number): void {
    if (this._isPaused) return;
    this._gameElapsedTime += realDeltaTime * this._speed;
  }

  /*
   * reset: Restores default state (1x, not paused, 0 elapsed).
   * Called on new game and after loading a save.
   */
  reset(): void {
    this._speed = 1;
    this._isPaused = false;
    this._gameElapsedTime = 0;
    this.emitState();
  }

  private emitState(): void {
    this.state$.next({
      speed: this._speed,
      isPaused: this._isPaused,
      gameElapsedTime: this._gameElapsedTime,
    });
  }
}

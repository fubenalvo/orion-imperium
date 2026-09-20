import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type BattleSpeed = 0.5 | 1;

export interface BattleTimeState {
  speed: BattleSpeed;
  isPaused: boolean;
  battleElapsedTime: number;
}

interface BattleWait {
  remainingMs: number;
  resolve: () => void;
}

@Injectable({ providedIn: 'root' })
export class BattleTimeService {
  private _speed: BattleSpeed = 0.5;
  private _isPaused = false;
  private _battleElapsedTime = 0;
  private readonly waits: BattleWait[] = [];

  readonly state$ = new BehaviorSubject<BattleTimeState>({
    speed: 0.5,
    isPaused: false,
    battleElapsedTime: 0,
  });

  get speed(): BattleSpeed {
    return this._speed;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get battleElapsedTime(): number {
    return this._battleElapsedTime;
  }

  get battleElapsedMs(): number {
    return this._battleElapsedTime * 1000;
  }

  setSpeed(speed: BattleSpeed): void {
    this._speed = speed;
    this._isPaused = false;
    this.emitState();
  }

  pause(): void {
    if (this._isPaused) {
      return;
    }
    this._isPaused = true;
    this.emitState();
  }

  resume(): void {
    if (!this._isPaused) {
      return;
    }
    this._isPaused = false;
    this.emitState();
  }

  togglePause(): void {
    this._isPaused = !this._isPaused;
    this.emitState();
  }

  getScaledDeltaTime(realDeltaTime: number): number {
    if (this._isPaused) {
      return 0;
    }
    return realDeltaTime * this._speed;
  }

  onTick(realDeltaTime: number): void {
    const scaledDeltaTime = this.getScaledDeltaTime(Math.max(0, realDeltaTime));
    this._battleElapsedTime += scaledDeltaTime;
    this.advanceWaits(scaledDeltaTime * 1000);
  }

  wait(durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waits.push({ remainingMs: durationMs, resolve });
    });
  }

  cancelPendingWaits(): void {
    const pending = this.waits.splice(0, this.waits.length);
    for (const wait of pending) {
      wait.resolve();
    }
  }

  reset(): void {
    this._speed = 0.5;
    this._isPaused = false;
    this._battleElapsedTime = 0;
    this.cancelPendingWaits();
    this.emitState();
  }

  private advanceWaits(deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.waits.length; readIndex++) {
      const wait = this.waits[readIndex];
      wait.remainingMs -= deltaMs;
      if (wait.remainingMs <= 0) {
        wait.resolve();
        continue;
      }
      this.waits[writeIndex++] = wait;
    }
    this.waits.splice(writeIndex);
  }

  private emitState(): void {
    this.state$.next({
      speed: this._speed,
      isPaused: this._isPaused,
      battleElapsedTime: this._battleElapsedTime,
    });
  }
}

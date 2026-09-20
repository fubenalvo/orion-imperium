import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { BattleTimeService } from './battle-time.service';

/*
 * =========================================================
 * BATTLE MINIGAME — ANIMATION LOCK SERVICE
 * =========================================================
 *
 * Tracks animation state per stack to allow concurrent animations
 * for different stacks (e.g., AI and player can attack simultaneously).
 * Global busy flag still exists for UI gating.
 *
 * Animation waits are driven by BattleTimeService's frame-driven scheduler,
 * so they respect battle pause/speed controls.
 */

@Injectable({ providedIn: 'root' })
export class BattleAnimationService {
  private activeCount = 0;
  private stackActiveCount = new Map<string, number>();
  private animationWaiters: Array<() => void> = [];
  private stackAnimationWaiters = new Map<string, Array<() => void>>();

  readonly busy = signal(false);
  readonly ticks$ = new Subject<void>();

  constructor(private time: BattleTimeService) {}

  get isBusy(): boolean {
    return this.activeCount > 0;
  }

  /** Check if a specific stack has an active animation. */
  isStackBusy(stackId: string): boolean {
    return (this.stackActiveCount.get(stackId) ?? 0) > 0;
  }

  begin(stackId?: string): void {
    this.activeCount++;
    this.busy.set(true);
    if (stackId) {
      const count = (this.stackActiveCount.get(stackId) ?? 0) + 1;
      this.stackActiveCount.set(stackId, count);
    }
  }

  end(stackId?: string): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.busy.set(this.activeCount > 0);
    if (stackId) {
      const count = Math.max(0, (this.stackActiveCount.get(stackId) ?? 1) - 1);
      if (count === 0) {
        this.stackActiveCount.delete(stackId);
        this.resolveStackAnimationWaiters(stackId);
      } else {
        this.stackActiveCount.set(stackId, count);
      }
    }
    if (this.activeCount === 0) {
      this.resolveAnimationWaiters();
    }
  }

  /* Wraps an animation sequence, guaranteeing begin/end balance even on failure. */
  run<T>(fn: () => Promise<T>, stackId?: string): Promise<T> {
    this.begin(stackId);
    return Promise.resolve()
      .then(fn)
      .finally(() => this.end(stackId));
  }

  /* Duration-matched wait using BattleTimeService's frame-driven scheduler. */
  wait(ms: number): Promise<void> {
    return this.time.wait(ms);
  }

  waitForAnimation(): Promise<void> {
    if (!this.isBusy) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.animationWaiters.push(resolve);
    });
  }

  /** Wait for a specific stack's animation to complete. */
  waitForStackAnimation(stackId: string): Promise<void> {
    if (!this.isStackBusy(stackId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const waiters = this.stackAnimationWaiters.get(stackId) ?? [];
      waiters.push(resolve);
      this.stackAnimationWaiters.set(stackId, waiters);
    });
  }

  /* Cancel all pending frame-driven waits. */
  cancelPendingWaits(): void {
    this.time.cancelPendingWaits();
  }

  /* Notify the view that mid-animation state changed. */
  tick(): void {
    this.ticks$.next();
  }

  /* Hard reset for component destroy / battle end. */
  reset(): void {
    this.cancelPendingWaits();
    this.activeCount = 0;
    this.stackActiveCount.clear();
    this.stackAnimationWaiters.clear();
    this.resolveAnimationWaiters();
    this.busy.set(false);
  }

  private resolveAnimationWaiters(): void {
    const waiters = this.animationWaiters.splice(0, this.animationWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private resolveStackAnimationWaiters(stackId: string): void {
    const waiters = this.stackAnimationWaiters.get(stackId) ?? [];
    this.stackAnimationWaiters.delete(stackId);
    for (const resolve of waiters) {
      resolve();
    }
  }
}
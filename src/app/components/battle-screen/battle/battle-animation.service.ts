import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/*
 * =========================================================
 * BATTLE MINIGAME — ANIMATION LOCK SERVICE
 * =========================================================
 *
 * Tracks animation state per stack to allow concurrent animations
 * for different stacks (e.g., AI and player can attack simultaneously).
 * Global busy flag still exists for UI gating (END TURN button).
 */

@Injectable({ providedIn: 'root' })
export class BattleAnimationService {
  private activeCount = 0;
  private stackActiveCount = new Map<string, number>();
  private timerIds = new Set<number>();

  readonly busy = signal(false);
  readonly ticks$ = new Subject<void>();

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
      } else {
        this.stackActiveCount.set(stackId, count);
      }
    }
  }

  /* Wraps an animation sequence, guaranteeing begin/end balance even on failure. */
  run<T>(fn: () => Promise<T>, stackId?: string): Promise<T> {
    this.begin(stackId);
    return Promise.resolve()
      .then(fn)
      .finally(() => this.end(stackId));
  }

  /* Duration-matched wait. Deterministic under vi.useFakeTimers(). */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(resolve, ms);
      this.timerIds.add(id);
    });
  }

  /* Cancel all pending timer callbacks from wait(). */
  cancelPendingTimers(): void {
    for (const id of this.timerIds) {
      clearTimeout(id);
    }
    this.timerIds.clear();
  }

  /* Notify the view that mid-animation state changed. */
  tick(): void {
    this.ticks$.next();
  }

  /* Hard reset for component destroy / battle end. */
  reset(): void {
    this.cancelPendingTimers();
    this.activeCount = 0;
    this.stackActiveCount.clear();
    this.busy.set(false);
  }
}

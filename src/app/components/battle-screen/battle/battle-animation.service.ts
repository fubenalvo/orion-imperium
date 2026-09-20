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
 *
 * Per-stack animation generations prevent waiter race conditions:
 * - Each begin() increments a generation counter for that stack
 * - Waiters wait for a specific generation to complete
 * - This prevents a new animation from making old waiters wait for it
 */

@Injectable({ providedIn: 'root' })
export class BattleAnimationService {
  private activeCount = 0;
  private stackActiveCount = new Map<string, number>();
  private stackGeneration = new Map<string, number>();
  private stackCompletedGenerations = new Map<string, number>();
  private animationWaiters: Array<() => void> = [];
  private stackAnimationWaiters = new Map<string, Map<number, Array<() => void>>>();

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

  /** Get current animation generation for a stack. */
  getStackGeneration(stackId: string): number {
    return this.stackGeneration.get(stackId) ?? 0;
  }

  begin(stackId?: string): void {
    this.activeCount++;
    this.busy.set(true);
    if (stackId) {
      const prevCount = this.stackActiveCount.get(stackId) ?? 0;
      const count = prevCount + 1;
      this.stackActiveCount.set(stackId, count);
      // Only increment generation when starting a NEW animation cycle (0→1)
      if (prevCount === 0) {
        const gen = (this.stackGeneration.get(stackId) ?? 0) + 1;
        this.stackGeneration.set(stackId, gen);
      }
      // Ensure waiters map exists for this stack
      if (!this.stackAnimationWaiters.has(stackId)) {
        this.stackAnimationWaiters.set(stackId, new Map());
      }
    }
  }

  end(stackId?: string): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.busy.set(this.activeCount > 0);
    if (stackId) {
      const count = Math.max(0, (this.stackActiveCount.get(stackId) ?? 1) - 1);
      if (count === 0) {
        this.stackActiveCount.delete(stackId);
        // Mark this generation as completed
        const gen = this.stackGeneration.get(stackId) ?? 0;
        if (gen > 0) {
          this.stackCompletedGenerations.set(stackId, gen);
          this.resolveStackAnimationWaiters(stackId, gen);
        }
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

  /** Wait for a specific stack's CURRENT animation to complete.
   * Uses generation tracking so waiters don't get stuck waiting for
   * future animations that start after they begin waiting. */
  waitForStackAnimation(stackId: string): Promise<void> {
    if (!this.isStackBusy(stackId)) {
      return Promise.resolve();
    }
    const targetGen = this.stackGeneration.get(stackId) ?? 0;
    if (targetGen === 0) {
      return Promise.resolve();
    }
    // Check if this generation is already completed
    const completedGen = this.stackCompletedGenerations.get(stackId) ?? 0;
    if (completedGen >= targetGen) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const stackWaiters = this.stackAnimationWaiters.get(stackId)!;
      const genWaiters = stackWaiters.get(targetGen) ?? [];
      genWaiters.push(resolve);
      stackWaiters.set(targetGen, genWaiters);
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
    this.stackGeneration.clear();
    this.stackCompletedGenerations.clear();
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

  private resolveStackAnimationWaiters(stackId: string, completedGen: number): void {
    const stackWaiters = this.stackAnimationWaiters.get(stackId);
    if (!stackWaiters) return;

    // Resolve all waiters for generations <= completedGen
    for (const [gen, waiters] of stackWaiters.entries()) {
      if (gen <= completedGen) {
        for (const resolve of waiters) {
          resolve();
        }
        stackWaiters.delete(gen);
      }
    }

    // Clean up empty maps
    if (stackWaiters.size === 0) {
      this.stackAnimationWaiters.delete(stackId);
    }
  }
}
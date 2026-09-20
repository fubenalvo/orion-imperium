# Battle Screen Auto-Attack Blocking User Commands Fix Plan

## Problem
After initial fix for destroyed-stack movement hang, user can give multiple commands initially. But once auto-attack starts firing (combat begins), user commands stop working - they queue but never execute.

## Root Cause
1. **User commands** go through `enqueueCommand` → `executeCommand` which waits for **global** `anim.isBusy` (line 283-284)
2. **Auto-attacks** (`tryAutoAttack`) bypass the command queue and directly call `combat.attackStack()` which uses `anim.run()` - this increments global `activeCount`
3. When auto-attacks fire continuously (every ~500-1000ms per stack), they keep the global animation lock busy
4. User commands wait forever on `anim.waitForAnimation()` because global busy never clears

## Design Intent (from code comments)
- **Global `isBusy`**: For UI gating (pause buttons, etc.) - "Global busy flag still exists for UI gating"
- **Per-stack `isStackBusy`**: For combat logic - "Tracks animation state per stack to allow concurrent animations for different stacks"

But command queue incorrectly uses global lock instead of per-stack lock.

## Solution
Modify command queue to wait for **per-stack animation** instead of global animation.

### Changes Required

1. **BattleAnimationService** (`battle-animation.service.ts`):
   - Add `stackAnimationWaiters = new Map<string, Array<() => void>>()` field
   - Add `waitForStackAnimation(stackId: string): Promise<void>` method
   - In `end(stackId)`, call `resolveStackAnimationWaiters(stackId)` when count reaches 0
   - In `reset()`, clear `stackAnimationWaiters`
   - Add `resolveStackAnimationWaiters(stackId)` private method

2. **BattleScreenComponent** (`battle-screen.component.ts`):
   - Modify `enqueueCommand(command, stackId?)` to accept optional stackId
   - Modify `executeCommand(command, stackId?)` to wait for that stack's animation using `anim.waitForStackAnimation(stackId)` instead of global `anim.waitForAnimation()`
   - Update all call sites to pass the relevant stackId:
     - `doCarrierBoost()` → selected stack
     - `doMoveToAttack(attacker, target)` → attacker stack
     - `moveTowardsAndAttack(attacker, target)` → attacker stack
     - `doMove(stack, col, row)` → stack
     - `doAttack(attacker, target)` → attacker stack

3. **Auto-attacks** (`tryAutoAttack`): Already use per-stack check (`anim.isStackBusy`), no change needed.

## Files to Modify
- `src/app/components/battle-screen/battle/battle-animation.service.ts`
- `src/app/components/battle-screen/battle-screen.component.ts`

## Implementation Details

### battle-animation.service.ts changes:
```typescript
// Add field
private stackAnimationWaiters = new Map<string, Array<() => void>>();

// Add method
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

// In end() method, add:
if (count === 0) {
  this.stackActiveCount.delete(stackId);
  this.resolveStackAnimationWaiters(stackId); // ADD THIS
}

// In reset(), add:
this.stackAnimationWaiters.clear();

// Add private method:
private resolveStackAnimationWaiters(stackId: string): void {
  const waiters = this.stackAnimationWaiters.get(stackId) ?? [];
  this.stackAnimationWaiters.delete(stackId);
  for (const resolve of waiters) {
    resolve();
  }
}
```

### battle-screen.component.ts changes:
```typescript
// enqueueCommand - add stackId parameter
private enqueueCommand(command: () => Promise<boolean>, stackId?: string): Promise<boolean> {
  if (this.battleTime.isPaused || this.commandRunning) {
    this.commandQueue.push({ command, stackId });
    return Promise.resolve(false);
  }
  return this.executeCommand(command, stackId);
}

// executeCommand - add stackId parameter and use per-stack wait
private async executeCommand(command: () => Promise<boolean>, stackId?: string): Promise<boolean> {
  if (this.commandRunning) {
    this.commandQueue.push({ command, stackId });
    return false;
  }

  this.commandRunning = true;
  try {
    if (stackId && this.anim.isStackBusy(stackId)) {
      await this.anim.waitForStackAnimation(stackId);
    } else if (!stackId && this.anim.isBusy) {
      await this.anim.waitForAnimation(); // fallback for commands without stackId
    }
    return await command();
  } catch {
    return false;
  } finally {
    this.commandRunning = false;
    void this.drainCommandQueue();
  }
}

// drainCommandQueue - update to pass stackId
private async drainCommandQueue(): Promise<void> {
  if (this.commandRunning || this.battleTime.isPaused) {
    return;
  }

  while (this.commandQueue.length > 0 && !this.battleTime.isPaused) {
    const { command, stackId } = this.commandQueue.shift()!;
    this.commandRunning = true;
    try {
      if (stackId && this.anim.isStackBusy(stackId)) {
        await this.anim.waitForStackAnimation(stackId);
      } else if (!stackId && this.anim.isBusy) {
        await this.anim.waitForAnimation();
      }
      await command();
    } catch {
      // Invalid or interrupted commands are discarded without blocking the queue.
    } finally {
      this.commandRunning = false;
    }
  }
}

// Update commandQueue type
private commandQueue: Array<{ command: () => Promise<boolean>; stackId?: string }> = [];

// Update all call sites:
doCarrierBoost() - pass this.selectedStackId
doMoveToAttack(attacker, target) - pass attacker.stackId
moveTowardsAndAttack(attacker, target) - pass attacker.stackId
doMove(stack, col, row) - pass stack.stackId
doAttack(attacker, target) - pass attacker.stackId
```

## Validation
- Give multiple move/attack commands rapidly before combat starts - should work
- Let auto-attacks fire, then try to give new commands - should work (not queue forever)
- Verify multiple stacks can animate concurrently (AI + player)
- Run existing tests: battle-grid, battle-movement, battle-state, star-map
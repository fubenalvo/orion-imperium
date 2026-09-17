# Fix: Selected Stack Becomes Unresponsive After a While in Battle

## Context

Battle minigame in `src/app/components/battle-screen/`. The game loop runs outside Angular's zone (`BattleGameLoopService`) and calls `gameLoopCallback` every RAF frame. The animation lock (`BattleAnimationService.isBusy`) gates player input and AI actions. Victory state (`state.winner`) is set by `checkVictory()` from multiple call sites.

## Root Cause Analysis

Three interacting issues cause the freeze:

### Issue 1: Game loop early-exit kills all `detectChanges` triggers
**File:** `battle-screen.component.ts:518-544`

```typescript
private gameLoopCallback(deltaTime: number): void {
  if (!this.state || this.state.winner) { return; }  // line 518
  ...
  checkVictory(this.state);  // line 541 — may set winner THIS frame
  this.anim.tick();           // line 544 — IS called this frame
}                           // next frame: early exit, NO tick, NO detectChanges
```

Once `state.winner` is set (whether correctly from battle end or incorrectly from a premature `checkVictory`), the game loop permanently stops calling `anim.tick()`. The `ticksSub` subscription (`line 116`) only fires `detectChanges` when `ticks$` emits. If no other path triggers `detectChanges`, the UI freezes — stacks stop visually updating, damage numbers don't appear, and selection highlights disappear.

### Issue 2: `checkVictory` sets `state.winner` from inside `attackStack` animation while game loop continues
**File:** `battle-combat.service.ts:69-153`

`attackStack` runs inside `anim.run()`. The game loop keeps ticking during the animation (AI is correctly blocked by `isBusy`). `checkVictory` at line 541 can set `state.winner` *during* the animation (e.g., AI kills the last player stack between projectile and impact phases). After the animation finishes:
- `busy.set(false)` is called (finally block)
- `state.winner` is already set
- `canAct` = `playerHasStacks && !isBusy` → `playerHasStacks` returns false → **permanently unresponsive** even though `isBusy` is now false

### Issue 3: `carrierShieldBoost` calls `checkVictory` without triggering `anim.tick()`
**File:** `battle-combat.service.ts:164-202`

`carrierShieldBoost` is not wrapped in `anim.run()`. It calls `checkVictory` at line 200 but never calls `this.anim.tick()`. If it sets `state.winner`, `gameLoopCallback` will early-exit on the next tick without ever having called `anim.tick()` from the carrier action itself, so no `detectChanges` fires from that code path. Additionally, `doCarrierBoost()` in the component does not call `cdr.detectChanges()`.

## Proposed Fix

### Change 1: Decouple `anim.tick()` from the winner check in game loop
**File:** `battle-screen.component.ts:517-545`

Move `anim.tick()` before the early-exit check, or always call it when `state` exists regardless of winner. The animation tick should keep firing to ensure the view updates even after battle end (for result modal display and any final state commits).

```typescript
private gameLoopCallback(deltaTime: number): void {
  if (!this.state) { return; }

  updateStackPositions(this.state, deltaTime);

  this.aiTickAccumulator += deltaTime * 1000;
  if (this.aiTickAccumulator >= AI_ACTION_INTERVAL_MS && !this.anim.isBusy) {
    this.aiTickAccumulator = 0;
    void this.ai.playAction(this.state);
  }

  this.shieldRegenAccumulator += deltaTime * 1000;
  if (this.shieldRegenAccumulator >= SHIELD_REGEN_INTERVAL_MS) {
    this.shieldRegenAccumulator = 0;
    regenerateAllShields(this.state);
    this.state.round++;
  }

  checkVictory(this.state);
  this.anim.tick();  // Always tick — ensures detectChanges fires
}
```

**Rationale:** `anim.tick()` is cheap (just `ticks$.next()`). The subscription triggers `detectChanges`. Even after battle end, the result modal needs at least one `detectChanges` to render. Removing the `state.winner` guard from the early-exit ensures the loop keeps firing ticks until `!this.state`. The early-exit for `state.winner` was incorrectly preventing `anim.tick()` from firing on frames where winner was set during the same callback.

### Change 2: Add `detectChanges` to `doCarrierBoost`
**File:** `battle-screen.component.ts:468-477`

Add `this.cdr.detectChanges()` at the end of `doCarrierBoost()`, matching the pattern in `doAttack`, `doMove`, and `doMoveToAttack`.

### Change 3: Test — verify `anim.tick()` fires after `checkVictory` sets winner in game loop
**File:** `battle-screen.component.spec.ts` (or appropriate test file)

Add a test that:
1. Creates a battle state where `checkVictory` will set winner
2. Simulates a game loop callback
3. Asserts `anim.tick()` was called (via `ticks$` subscription) even though `state.winner` was just set

### Change 4: Test — verify `carrierShieldBoost` triggers view update when ending battle
Add a test that:
1. Calls `carrierShieldBoost` in a scenario where it sets `state.winner`
2. Verifies `anim.tick()` was called (or that `doCarrierBoost` calls `detectChanges`)

## Files to Modify

1. **`src/app/components/battle-screen/battle-screen.component.ts`** — Fix `gameLoopCallback` (Change 1), fix `doCarrierBoost` (Change 2)
2. **`src/app/components/battle-screen/battle-screen.component.spec.ts`** — Add tests (Change 3, 4) if spec file exists; otherwise create appropriate test

## Verification

1. Run existing battle-screen tests to ensure no regressions: `npx vitest run src/app/components/battle-screen/`
2. Verify `checkVictory` in `battle-grid.spec.ts` still passes (no changes to that file)
3. Manually verify: start a battle, let AI kill one side — result modal should appear promptly with no UI freeze
4. Manually verify: Carrier Shield Pulse ending a battle — result modal should appear and view should update

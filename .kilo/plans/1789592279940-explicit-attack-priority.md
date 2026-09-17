# Auto-Attack for All Player Stacks + Explicit Attack Priority

## Goal
- ALL player-controlled stacks auto-attack enemies in range by default (not just selected stack)
- Explicit attack command (click enemy) sets priority target - stack focuses ONLY on that target
- Move command clears explicit target → returns to normal auto-attack
- Deselect clears explicit target

## Current State
- `autoAttack` only runs for `selectedStackId` (recursive chain after explicit `doAttack`)
- Explicit attack target logic implemented in `autoAttack`
- Move/deselect clears explicit target

## Changes Needed

### 1. Modify `autoAttack` to work for any player stack
**File**: `src/app/components/battle-screen/battle-screen.component.ts`

Remove the `selectedStackId` check. Add check: only run for player-controlled stacks.

```typescript
private async autoAttack(attacker: BattleStack): Promise<void> {
  if (!this.state || this.state.winner) return;
  // Only player-controlled stacks auto-attack
  if (!isSidePlayerControlled(this.state, attacker.side)) return;
  // Don't interrupt ongoing animation
  if (this.anim.isBusy) return;
  // ... rest of logic
}
```

### 2. Add auto-attack trigger in game loop
**File**: `src/app/components/battle-screen/battle-screen.component.ts`

In `gameLoopCallback`, after AI tick, add player auto-attack:

```typescript
// 2b. Player auto-attack: all player stacks attack enemies in range
if (!this.state.winner && !this.anim.isBusy) {
  const playerStacks = this.state.stacks.filter(s => 
    !s.destroyed && isSidePlayerControlled(this.state, s.side)
  );
  for (const stack of playerStacks) {
    // Fire-and-forget: autoAttack handles its own cooldown/busy checks
    void this.autoAttack(stack);
  }
}
```

### 3. Update `autoAttack` target selection logic
Keep explicit target priority, but ensure it works for non-selected stacks too.

### 4. Prevent overlapping attacks
- `autoAttack` checks `this.anim.isBusy` at start
- But multiple stacks could trigger simultaneously → need per-stack busy tracking
- Option A: Add `isAttacking` flag to BattleStack
- Option B: Use animation service counter (already exists via `activeCount`)

Actually, `BattleAnimationService` has `activeCount` and `busy` signal. The `run()` method increments/decrements. We can check `anim.isBusy` globally, but that would block ALL stacks if one is animating.

Better: Add per-stack `attackCooldownUntil` timestamp or `isAttacking` flag to BattleStack.

### 5. Add per-stack attack cooldown tracking
**File**: `src/app/components/battle-screen/battle/battle.types.ts`

Add to `BattleStack`:
```typescript
// Timestamp (performance.now()) when next attack can occur
attackCooldownUntil?: number;
```

In `autoAttack`:
- Check `attackCooldownUntil` vs `performance.now()`
- After attack, set `attackCooldownUntil = performance.now() + fireRateMs`

### 6. Remove `autoAttackActive` flag
No longer needed since game loop manages auto-attack for all stacks.

## Affected Files
1. `src/app/components/battle-screen/battle/battle.types.ts` - Add `attackCooldownUntil` to BattleStack
2. `src/app/components/battle-screen/battle-screen.component.ts` - Modify autoAttack, add game loop trigger, remove autoAttackActive

## Testing
- All player stacks auto-attack enemies in range
- Explicit attack command overrides auto-attack for that stack
- Move command clears explicit target
- Multiple stacks can attack simultaneously (different animations)
- AI unaffected (uses separate AI system)

## Edge Cases
- Stack with explicit target moves out of range → clears explicit target, resumes auto-attack
- Explicit target destroyed → clears explicit target, resumes auto-attack
- Animation busy → stack waits for cooldown
- Battle ends → auto-attack stops
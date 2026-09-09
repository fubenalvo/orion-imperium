# Battle Screen AI Attacker Stuck - Analysis & Fix Plan

## Problem Statement
The Battle Screen gets stuck immediately when the AI is the attacker. The AI turn doesn't start or complete properly.

## Root Cause Analysis

### Call Chain
```
BattleScreenComponent.ngOnInit()
  → createBattleState() → state.activeSide = 'attacker'
  → void this.runAiTurns()  (fire-and-forget)
    → while (!winner && !isSidePlayerControlled(state, activeSide))
      → await ai.playTurn(state)
        → attackStack() / moveStack() (anim.run() wraps animations)
        → turn.endTurn(state)
          → flips activeSide, resets AP, sets phase
          → RETURNS false if anim.isBusy!
    → loops back, checks condition again
```

### Exact Failure Path

**The bug is in `BattleAiService.playTurn()` - it ignores the return value of `endTurn()`:**

```typescript
// battle-ai.service.ts:72-75
if (!state.winner) {
  console.log('[BattleAI] ending turn');
  this.turn.endTurn(state);  // ← Return value IGNORED!
}
```

**`BattleTurnService.endTurn()` returns `false` when `anim.isBusy` is true:**
```typescript
// battle-turn.service.ts:23-26
endTurn(state: BattleModelState): boolean {
  if (state.winner || this.anim.isBusy) {
    return false;  // Turn NOT ended!
  }
  // ... flip side, reset AP, set phase
  return true;
}
```

**Scenario causing the stuck state:**
1. AI is attacker → `runAiTurns()` loop condition is true
2. `playTurn()` executes attacks/moves (each wrapped in `anim.run()`)
3. Due to a race condition or animation timing issue, `anim.isBusy` is still `true` when `endTurn()` is called
4. `endTurn()` returns `false` - **turn doesn't flip**
5. `playTurn()` ignores `false`, returns normally
6. `runAiTurns()` loops again with **same `activeSide`** (attacker)
7. AI has 0 AP (already spent), does nothing, calls `endTurn()` again
8. Repeats until safety counter (10) hits → "AI turn safety limit reached"
9. Battle appears stuck - AI never yields to player

### Why `anim.isBusy` Might Be True at End of Turn
- `anim.run()` uses `finally` → should always balance `begin()`/`end()`
- But: multiple concurrent `anim.run()` calls (attack + move in same turn) could cause issues if one throws
- Or: previous battle didn't clean up (`anim.reset()` not called in some edge case)
- Or: `BattleAnimationService` is a singleton (`providedIn: 'root') - state persists across battles

## Minimal Fix

### Fix 1: `BattleAiService.playTurn()` - Check `endTurn()` return value
```typescript
if (!state.winner) {
  console.log('[BattleAI] ending turn');
  const ended = this.turn.endTurn(state);
  if (!ended) {
    console.error('[BattleAI] endTurn failed - anim.isBusy:', this.turn['anim']?.isBusy);
    // Don't loop infinitely - throw to surface the real issue
    throw new Error('AI turn could not end: animation lock still active');
  }
}
```

### Fix 2: `BattleScreenComponent.runAiTurns()` - Catch and handle errors
```typescript
try {
  await this.ai.playTurn(this.state);
} catch (e) {
  console.error('[BattleScreen] AI turn error:', e);
  break;  // Exit loop instead of infinite retry
}
```

### Fix 3: Ensure `phase` is correctly initialized in `createBattleState()`
```typescript
// battle-state.ts:53 - currently hardcoded to 'playerTurn'
phase: isSidePlayerControlled(...),  // Fix: compute based on actual attacker
```

## Files to Change

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-ai.service.ts` | Check `endTurn()` return value, throw on failure |
| `src/app/components/battle-screen/battle-screen.component.ts` | Wrap `playTurn()` in try/catch in `runAiTurns()` |
| `src/app/components/battle-screen/battle/battle-state.ts` | Initialize `phase` correctly based on attacker faction |

## Tests to Add/Update

1. **AI attacker starts automatically** - Verify `runAiTurns()` is called and `playTurn()` executes when attacker faction ≠ 'player'
2. **AI attacker → player defender handoff** - Verify `activeSide` flips to 'defender' and loop exits
3. **AI attacker → AI defender transition** - Verify consecutive AI turns work (safety counter prevents infinite loop)
4. **Player attacker → AI defender** - Verify `runAiTurns()` called after player ends turn
5. **`anim.isBusy` doesn't block initial AI turn** - Mock `anim.isBusy = true`, verify error is thrown/surfaced

## Validation Plan

1. Run existing test suite: `npx ng test --include="src/app/components/battle-screen/**/*.spec.ts"`
2. Manual test: Start game, move enemy fleet into player fleet → battle starts with AI attacker
3. Check console for: `[BattleScreen] AI turn start`, `[BattleAI] playTurn start`, `[BattleAI] ending turn`, `[BattleScreen] AI turn end`, `[BattleScreen] runAiTurns complete, playerControlsActiveSide: true`
4. Verify player can then act (green move cells, red attack targets appear)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Throwing in `playTurn()` could crash the battle | Wrapped in try/catch in `runAiTurns()`, logs error, exits gracefully |
| Changing `phase` initialization could break UI | `phase` is only used for display; `playerControlsActiveSide` uses `isSidePlayerControlled()` |
| Safety counter (10) might be too low for large battles | Only triggers on error path; normal battles have 1-2 AI turns max |

## Out of Scope
- Redesigning animation lock mechanism
- Changing `BattleTurnService.endTurn()` signature
- Modifying strategic AI (enemy-*) - this is purely tactical battle AI
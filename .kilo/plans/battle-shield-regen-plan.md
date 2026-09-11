# Shield Regeneration on Turn Start — Plan

## 1. Exact lifecycle point

`BattleTurnService.endTurn(state)` (`battle-turn.service.ts:23-44`) is the single point where a side becomes active. It already:

1. Flips `state.activeSide` (line 28)
2. Increments `state.round` when control returns to attacker (line 29-31)
3. Refills `state.ap = state.apPerTurn` (line 32)
4. Resets per-stack turn counters for the newly-active side (lines 34-39)
5. Sets `state.phase` and calls `checkVictory` (lines 41-42)

**Insert shield regeneration immediately after the side flip and AP refill, before the turn-counter reset.** Specifically after line 32 (`state.ap = state.apPerTurn`) and before line 34 (the stack loop). This guarantees:

- Regeneration happens for the side that just became active — both player and AI paths converge here (`onEndTurn` → `endTurn` → `runAiTurns` → `ai.playTurn`; AI's own `playTurn` also calls `endTurn` at the end, which flips the next side and regenerates it before its actions).
- It runs before any player action or AI action (AI `playTurn` is called from `runAiTurns` *after* `endTurn` returns).
- It never runs during the enemy's inactive phase (only the newly-active side's ships are touched).
- It never runs during animations — `endTurn` is rejected while `anim.isBusy` (line 24), and all combat/movement actions are awaited inside `anim.run(...)` blocks, so regeneration only occurs at a quiescent point.

A new private method `regenerateShields(state)` on `BattleTurnService` keeps the change isolated.

## 2. Files to modify

### `src/app/components/battle-screen/battle/battle-turn.service.ts`
- Add `regenerateShields(state: BattleModelState): void` — iterate `state.stacks`, for each stack on `state.activeSide`, for each ship where `ship.alive`, add `ship.shieldRegen` (default 0) to `ship.shield` (default 0), capped at `ship.maxShield` (default 0).
- Call it from `endTurn()` after AP refill, before the turn-counter reset loop.

### `src/app/components/battle-screen/battle/battle-turn.service.spec.ts`
- Add tests for the new behavior.

## 3. Regeneration logic (single source of truth)

```ts
private regenerateShields(state: BattleModelState): void {
  for (const stack of state.stacks) {
    if (stack.side !== state.activeSide || stack.destroyed) {
      continue;
    }
    for (const ship of stack.ships) {
      if (!ship.alive) {
        continue;
      }
      const regen = ship.shieldRegen ?? 0;
      if (regen <= 0) {
        continue;
      }
      const current = ship.shield ?? 0;
      const max = ship.maxShield ?? 0;
      ship.shield = Math.min(max, current + regen);
    }
  }
}
```

Notes:
- `ship.shield ?? 0`, `ship.maxShield ?? 0`, `ship.shieldRegen ?? 0` preserve compatibility with test fixtures that build `BattleShip` literals without shield fields.
- A ship with no shield data (`maxShield === 0`) is unaffected — `Math.min(0, ...)` keeps shield at 0.
- Destroyed ships are skipped via `!ship.alive`.
- Stacks on the inactive side are skipped via `stack.side !== state.activeSide`.

## 4. Required tests

All in `battle-turn.service.spec.ts`, using the existing `setup()` helper.

1. **regenerates the active side's shield by shieldRegen, capped at maxShield**
   - Set up a defender frigate (shieldRegen 6, maxShield 80), damage its shield to 50, endTurn (active becomes defender).
   - Assert `defender.ships[0].shield` is 56 (50 + 6), still below max.

2. **caps regeneration at maxShield**
   - Defender frigate, set shield to 78, endTurn.
   - Assert shield is 80 (78 + 6 capped), not 84.

3. **does not regenerate the inactive side**
   - Damage attacker fighter shield (regen 4, max 30) to 10, endTurn (active becomes defender).
   - Assert attacker shield is still 10 after the turn flip.

4. **does not regenerate destroyed ships**
   - Set a defender ship `alive = false`, endTurn.
   - Assert its shield is unchanged (no regen applied to dead ships).

5. **ships with no shield data are unaffected**
   - A virtual turret (shieldRegen 0, maxShield 0) — assert shield stays 0.

6. **regeneration happens before the turn-counter reset** (behavioral)
   - End a turn and assert both shield regen and `cellsMovedThisTurn = 0` / `attackedThisTurn = false` are applied for the new side in the same `endTurn` call.

## 5. Edge cases

- **Battle already over**: `endTurn` returns false early if `state.winner` is set (line 24), so no regeneration occurs post-battle. Safe.
- **Animation in flight**: `endTurn` is rejected while `anim.isBusy` (line 24), so regeneration never interrupts a projectile/move/explosion.
- **Zero regen ships**: skipped via `regen <= 0` continue — no-op, no NaN.
- **Shield already at max**: `Math.min(max, current + regen)` is a no-op.
- **Both sides have shield ships**: only the newly-active side regenerates; the other side's shield is preserved until its turn.
- **AI-vs-AI / consecutive AI turns**: each `endTurn` call regenerates the side that just flipped active, so multi-AI chains (`runAiTurns` loop) regenerate correctly between AI turns.
- **HP unchanged**: this method only touches `shield`; HP regeneration is out of scope and untouched.
- **AP unchanged**: regeneration is inserted *after* the existing AP refill, not replacing it.
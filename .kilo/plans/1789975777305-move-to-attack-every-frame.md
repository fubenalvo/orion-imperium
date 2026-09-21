# Run Move-to-Attack Re-Evaluation Every Frame

## Problem

AI ships overshoot or undershoot moving targets because `updateMoveToAttackTargets`
runs only every 1000 ms (`MOVE_TO_ATTACK_UPDATE_INTERVAL_MS`). When an enemy
starts moving between update ticks, the chasing stack continues toward a stale
destination cell. By the time the next re-evaluation fires (up to 1 second
later), the target has moved significantly and the chasing stack may have
already passed the optimal cell.

## Root Cause

In `battle-screen.component.ts:967`, the move-to-attack re-evaluation is gated
by a 1000 ms accumulator:

```typescript
this.moveToAttackUpdateAccumulator += deltaTime * 1000;
if (this.moveToAttackUpdateAccumulator >= MOVE_TO_ATTACK_UPDATE_INTERVAL_MS) {
    this.moveToAttackUpdateAccumulator = 0;
    this.movement.updateMoveToAttackTargets(this.state);
}
```

This runs 5x slower than the AI action tick (200 ms). A stack can move a
significant distance in 1 second, causing the chasing AI to lag behind.

## Fix

Run `updateMoveToAttackTargets` every frame instead of every 1000 ms. The
function is lightweight — it only processes stacks that are `moving &&
moveToAttackTargetId != null`, and `findBestMoveToAttackCell` does a grid scan
(19x8 = 152 cells). With 2-4 chasing stacks, that is ~600-1200 cell checks per
frame — negligible.

### Changes to `battle-screen.component.ts`

1. Remove `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS` from the import (line 32).
2. Remove the `moveToAttackUpdateAccumulator` class field (line 141).
3. Replace the interval-gated block (lines 967-975) with an unconditional call:
   ```typescript
   if (!this.state.winner && !isPaused) {
       this.movement.updateMoveToAttackTargets(this.state);
   }
   ```

### Changes to `battle.types.ts`

1. Remove `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS` constant (lines 34-36).

### Changes to `battle-movement.service.ts`

1. Update the docstring at line 134 to reflect that it is now called every
   frame, not every 1000 ms.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle-screen.component.ts` | Remove import, remove accumulator field, call `updateMoveToAttackTargets` unconditionally each frame |
| `src/app/components/battle-screen/battle/battle.types.ts` | Remove `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS` constant |
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Update docstring comment |

## Risks

- **Frequent `findBestMoveToAttackCell` calls**: ~4 stacks x 152 cells x 60 fps
  = 36,480 cell checks/s. Negligible for a 19x8 grid.
- **Target jitter**: if the enemy is moving, `findBestMoveToAttackCell` might
  return slightly different cells frame-to-frame. In practice, the target cell
  only changes when the enemy crosses into a new grid column/row, so
  adjustments are infrequent. `updateStackPositions` interpolation handles
  direction changes smoothly.
- **Existing tests**: no test references the interval constant directly.

## Validation

1. `npx ng test --watch=false --include='**/battle-grid.spec.ts'`
2. `npx ng test --watch=false --include='**/battle-movement.service.spec.ts'`
3. `npx ng test --watch=false --include='**/battle-screen.component.spec.ts'`
4. `npx tsc --noEmit --project tsconfig.app.json`

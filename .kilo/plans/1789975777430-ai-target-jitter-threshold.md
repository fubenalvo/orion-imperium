# Fix AI Ship Position Jumps + Same-Cell Collisions

## Problem

Two issues remain in the AI battle movement:

1. **10-20px position jumps** — Already addressed: `snapToGrid` now smoothly
   interpolates the ship to the nearest cell center via `updateStackPositions`
   instead of teleporting `x`/`y`. The 0.1 vw threshold guard also prevents
   redundant target re-sets in the fallback redirect path.

2. **Multiple AI stacks sent to the same cell** — Root cause: `snapToGrid`
   unconditionally sets the target to the nearest cell center **without checking
   `isCellReserved`**. When two AI stacks are near each other and their enemies
   enter attack range simultaneously (same frame), both round to the same nearest
   cell and receive the same target.

## Root Cause: Missing Reservation Check in snapToGrid

The game loop order is:
1. `updateStackPositions` — smooth interpolation
2. AI tick (async, `void playAction`) — moves ONE stack per 200ms tick
3. `updateMoveToAttackTargets` — re-evaluates every frame

When the enemy enters range, `updateMoveToAttackTargets` calls `snapToGrid` for
a stack. `snapToGrid` calls `vwToStackCell(stack.x, stack.y)` to find the nearest
cell and sets `targetX/Y` to that cell's center — **no reservation check**.

If two stacks are within the same cell-width band (e.g., both at x≈7.0 and x≈7.5,
which both round to `col=2`), their nearest cell is identical. Both get the same
target. `updateMoveToAttackTargets` processes all stacks in a single loop, so
both targets are set in the same frame — no `isCellReserved` guard between them.

## Fix: Add Reservation Check to snapToGrid

### 1. Pass `state` to `snapToGrid`

Change the signature to `snapToGrid(stack, state)` so it can check
`isCellReserved` and `isOccupied`.

### 2. Search for nearest unreserved cell

```typescript
private snapToGrid(stack: BattleStack, state: BattleModelState): void {
  const cell = vwToStackCell(stack, stack.x, stack.y);
  stack.col = cell.col;
  stack.row = cell.row;

  // Find nearest unreserved cell (diamond search from origin outward)
  const target = this.findNearestFreeCell(state, stack, cell);
  if (target) {
    const center = cellCenterVw(target, stack);
    stack.targetX = center.x;
    stack.targetY = center.y;
    stack.moving = true;
  } else {
    // No free cell found — stop at current position
    stack.targetX = null;
    stack.targetY = null;
    stack.moving = false;
    this.completeMovement(stack.stackId);
  }
}

private findNearestFreeCell(
  state: BattleModelState,
  stack: BattleStack,
  origin: GridCell,
): GridCell | null {
  for (let radius = 0; radius < BATTLE_GRID_COLUMNS + BATTLE_GRID_ROWS; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dc) + Math.abs(dr) !== radius) continue;
        const col = origin.col + dc;
        const row = origin.row + dr;
        if (!isInBounds(col, row)) continue;
        const destCols = occupiedCols(stack, col);
        if (!destCols.some((c) =>
          !isInBounds(c, row) ||
          isOccupied(state, c, row, stack.stackId) ||
          isCellReserved(state, c, row, stack.stackId)
        )) {
          return { col, row };
        }
      }
    }
  }
  return null;
}
```

### 3. Import `isCellReserved` and `occupiedCols`

Add to the imports from `./battle-grid`:
```typescript
import {
  ...,
  isCellReserved,
  occupiedCols,
} from './battle-grid';
```

### 4. Update callers

Pass `state` to all three `snapToGrid` call sites.

### 5. Update tests

The 3 existing tests verify `snapToGrid` behavior. With the reservation check,
`snapToGrid` now searches for the nearest unreserved cell. The tests set up
a single AI stack (no other in-flight stacks), so `isCellReserved` should return
false for the nearest cell. The tests should still pass with updated expectations:

- `moving = true` (smooth transition target set)
- `targetX/Y` set to nearest cell center (not null)
- `x/y` unchanged (no teleport)
- `col/row` = nearest cell

Add a new test: two stacks near each other with enemies in range → verify they
get DIFFERENT target cells (collision avoidance).

## Why Diamond Search?

`vwToStackCell` rounds to the nearest cell. Two stacks at x=7.0 and x=7.5 might
round to the same cell. A diamond search (increasing Manhattan distance from the
origin) finds the nearest *available* cell, which is still close to the ship's
position — minimizing visual displacement while preventing collisions.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Modify `snapToGrid` to accept `state`, check `isCellReserved`, search nearest free cell; add `findNearestFreeCell` helper; update 3 callers |
| `src/app/components/battle-screen/battle/battle-movement.service.spec.ts` | Update 3 tests; add collision avoidance test |

## Risks

- **Search overhead**: Diamond search iterates up to ~30 cells in worst case.
  This is negligible (O(1) for an 8×19 grid).
- **Fallback stop**: If no free cell is found (all nearby cells occupied), the
  ship stops at its current position. This is an edge case that only occurs
  with many stacks in a dense formation.
- **No behavior change for single-stack scenarios**: With only one stack,
  `isCellReserved` returns false for the nearest cell, so the smooth transition
  works as before.

## Validation

1. `npx ng test --watch=false --include='**/battle-movement.service.spec.ts'`
2. `npx ng test --watch=false --include='**/battle-grid.spec.ts'`
3. `npx tsc --noEmit --project tsconfig.app.json`

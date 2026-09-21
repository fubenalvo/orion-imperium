# Prevent Multiple Stacks on Same Cell — Without Blocking Paths

## Problem

After the previous `isOccupied` change, player commands broke: clicking on cells or
enemies does nothing. The `isOccupied` change made **all** path cells (including
intermediate cells) block on in-flight targets, so any enemy in-flight stack blocks
the player's straight-line path. The fix must only block **destination** cells, not
intermediate path cells.

## Root Cause

`isOccupied` (battle-grid.ts:176) was modified to check in-flight target cells for
**every** cell it examines. `isPathClear` calls `isOccupied` for all cells in the
path — intermediate AND destination. The in-flight check should only apply to the
**destination** cell, not intermediate path cells.

## Fix

**1. Revert `isOccupied` to original static-only behavior** (battle-grid.ts:176)
Remove the in-flight target branch. `isOccupied` checks only `col`/`row` (static
position).

**2. Add `isCellReserved` helper** (battle-grid.ts, after `isOccupied`)
A new exported function that checks whether a cell is the destination of an
in-flight stack (using `vwToStackCell` + `occupiesCell`), excluding a given
stack ID.

**3. Modify `isPathClear`** (battle-grid.ts:449)
Add an `isCellReserved` check only for the **last cell** in the path (the
destination), after the existing `isOccupied` check passes. Intermediate cells
are NOT checked for in-flight targets.

**4. Add `isCellReserved` check in `moveStack`** (battle-movement.service.ts:40)
After `isPathClear` passes, call `isCellReserved(state, target.col, target.row,
stack.stackId)`. If true, reject the move. This is the enforcement point for
player clicks and AI commands.

## Why not just modify `isPathClear`?

`getReachableCells` and `getMoveToAttackCells` call `isPathClear` per candidate
cell. With the `isPathClear` destination-only check, these functions would
automatically exclude in-flight target cells. So `moveStack` also needs the
check as a safety net (in case a cell becomes reserved between the
reachability check and the `moveStack` call).

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-grid.ts` | Revert `isOccupied`; add `isCellReserved`; modify `isPathClear` to check `isCellReserved` for destination cell only; export `isCellReserved` |
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Add `isCellReserved` import; add destination check in `moveStack` |
| `src/app/components/battle-screen/battle/battle-grid.spec.ts` | Revert in-flight `isOccupied` tests; add `isCellReserved` tests; verify `getReachableCells` still excludes in-flight targets via `isPathClear` |
| `src/app/components/battle-screen/battle/battle-movement.service.spec.ts` | Add test: `moveStack` rejects destination already targeted by in-flight stack |

## Tests to update

### battle-grid.spec.ts

- **Revert**: "isOccupied blocks destination cells of in-flight stacks" — `isOccupied`
  now only checks static positions. Delete or repurpose this test.
- **Revert**: "isOccupied does not block target cells of non-moving stacks" — delete
  (tests original behavior, no longer relevant as a new test).
- **Keep**: "getReachableCells excludes cells already targeted by an in-flight stack" —
  still works via `isPathClear` destination check.
- **Add**: `isCellReserved` returns true when cell is in-flight target of another stack
  (and false with excludeStackId).
- **Add**: `isPathClear` blocks path through destination cell targeted by in-flight stack
  but allows path through intermediate in-flight target cell.
- **Add**: `moveStack` rejects destination that is an in-flight target of another stack.

### battle-movement.service.spec.ts

- **Add**: `moveStack` returns false when destination is already targeted by an
  in-flight stack; returns true when the in-flight stack is the same stack
  (excludeStackId).

## Risks

- **AI fallback**: If the AI's `moveTowardNearestEnemy` fallback uses
  `linePath` from current position to enemy position, and all destination cells
  on the path are reserved, the AI tries shorter steps. If all fail, the AI
  doesn't move this tick — acceptable (it retries next tick).
- **Player friction**: The player might click on a cell that's an in-flight target
  and see no movement. This is correct behavior — the cell is occupied.
- **`updateMoveToAttackTargets` redirect**: `findBestMoveToAttackCell` uses
  `getMoveToAttackCells` → `isPathClear`, which now checks destination-only
  in-flight targets. Redirects will naturally find unreserved cells. No change
  needed to the redirect logic.

## Validation

1. `npx ng test --watch=false --include='**/battle-grid.spec.ts'` — all pass
2. `npx ng test --watch=false --include='**/battle-movement.service.spec.ts'` — all pass
3. `npx tsc --noEmit --project tsconfig.app.json` — no errors
4. Full battle-screen test suite — no new failures beyond pre-existing ones

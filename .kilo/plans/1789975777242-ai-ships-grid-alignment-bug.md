# AI Ships Stop at Non-Grid-Aligned Positions

## Problem

AI ships on the battle screen frequently come to rest at positions that are not perfectly
aligned to the grid cell centers. This happens because the **move-to-attack** system
interrupts movement without snapping the ship's position to the nearest grid cell.

## Root Cause Analysis

### Normal movement (grid-aligned)
When a stack moves via `moveStack()` (in `battle-movement.service.ts:40`), the target is
set to the **cell center** in vw coordinates (`cellCenterVw` at line 187). The game loop
calls `updateStackPositions()` (in `battle-grid.ts:317`) every frame, which interpolates
the stack toward the target. When the stack reaches the target (`dist <= 0.01`, line 356),
it **snaps** to `targetX`/`targetY` and updates `col`/`row` via `vwToStackCell` (line 361).
This path always results in grid-aligned positions.

### Move-to-attack movement (the bug)
When a stack performs a move-to-attack command (set via `moveToAttack()` or by
`BattleAiService.moveTowardNearestEnemy()`), the stack's `moveToAttackTargetId` is set.
Every `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS` (1000ms), the game loop calls
`updateMoveToAttackTargets()` (in `battle-movement.service.ts:138`). This method can
do one of three things to a moving stack:

1. **Redirect** — recompute `bestCell` based on the enemy's *current* position and set a
   new `targetX`/`targetY` (line 172-174). The stack is now heading to a different cell
   while still being visually between cells.

2. **Stop — target destroyed** (line 146-152) — sets `targetX = null`, `targetY = null`,
   `moving = false`. No position snapping occurs.

3. **Stop — target in range** (line 154-162) — same as above: `targetX = null`, no snapping.

4. **Stop — no bestCell** (line 163-170) — same: no snapping.

In cases 2-4, the stack simply stops wherever it happens to be. Its `x`/`y` are mid-flight
between cells, and its `col`/`row` still reflect the *old* cell. The
`updateStackPositions()` function is never given a chance to snap because it checks
`hasTarget = stack.targetX != null && stack.targetY != null` (line 323) — when the target
is nulled, it hits `continue` at line 336 and does nothing.

### Consequence: stale col/row
`occupiesCell()` (battle-grid.ts:200) and `isOccupied()` (line 176) use `stack.col`/`stack.row`
for grid logic, not `stack.x`/`stack.y`. When a ship stops mid-cell without updating
col/row, the grid occupancy state becomes inconsistent with visual position. A subsequently
redeployed cell could overlap the visually-off-center stack.

## Fix

Add a `snapToGrid` helper that converts a stack's current vw position to the nearest grid
cell, then updates `x`/`y`/`col`/`row` to the exact cell center. Call it in
`updateMoveToAttackTargets()` at every point where the stack is **stopped** (not redirected).

Add a note: on **redirect** (line 172), the stack keeps moving and will eventually snap via
`updateStackPositions` when it reaches the new target, so no snap is needed there.

### Changes to `battle-movement.service.ts`

1. `stackCenterVw` is already imported at line 10 of `battle-movement.service.ts`.
   `vwToStackCell` needs to be added to the import from `./battle-grid` (line 4-9).
2. Add a private `snapToGrid(stack: BattleStack)` method:
   - Calls `vwToStackCell(stack, stack.x, stack.y)` to snap to nearest cell
   - Sets `stack.col = cell.col`, `stack.row = cell.row`
   - Sets `stack.x = center.x`, `stack.y = center.y` (using `stackCenterVw`)
3. Call `snapToGrid(stack)` in three stop branches inside `updateMoveToAttackTargets()`:
   - **Target destroyed** (line 146-152): snap before nulling targets
   - **Target in range** (line 154-162): snap before nulling targets
   - **No bestCell** (line 163-170): snap before nulling targets

### Changes to `battle-movement.service.spec.ts`

Update existing tests for `updateMoveToAttackTargets`:
- "clears target when destroyed" — assert position snapped to grid cell
- "clears target when target is in range" — assert position snapped to grid cell
- Add test: "snaps position to grid when stopping for target in range" with a position
  that is clearly between two cells

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Add `snapToGrid` method; call it in 3 stop branches of `updateMoveToAttackTargets` |
| `src/app/components/battle-screen/battle/battle-movement.service.spec.ts` | Update existing tests + add new snapping test |

## Risks

- **Occupancy conflicts**: Snapping a stopped ship could push it onto an occupied cell.
  This is the same risk that exists for any ship reaching its target via
  `updateStackPositions`. The `getReachableCells` / `isPathClear` logic already handles
  this at command time; snapping to nearest is a presentation-level fix that doesn't
  change gameplay logic.
- **Visual jitter**: A ship that snaps from mid-cell to a cell center could visibly jump.
  This is acceptable — it's the same behavior that happens when movement completes
  normally via `updateStackPositions`.

## Validation

1. Run `npx vitest run battle-movement` — all existing + new tests pass
2. Run `npx vitest run battle-grid` — all grid tests pass

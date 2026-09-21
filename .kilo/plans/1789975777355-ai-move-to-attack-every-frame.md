# AI Ships Don't Re-Evaluate Move-to-Attack Targets

## Problem

After the previous fixes (destination reservation + every-frame re-evaluation),
AI ships still don't adjust their movement when the target moves. The user
observes AI ships continuing to a stale destination cell long after the target
has moved away from it.

## Root Cause

In `battle-ai.service.ts:150` (`moveTowardNearestEnemy`), the AI calls
`this.movement.moveStack(...)` **directly** instead of `this.movement.moveToAttack(...)`.

`moveStack` sets `targetX`/`targetY` and `moving = true` but does **not** set
`stack.moveToAttackTargetId`. The `updateMoveToAttackTargets` method (line 140)
only processes stacks where `stack.moveToAttackTargetId` is truthy:

```typescript
if (!stack.moving || !stack.moveToAttackTargetId) {
    continue;  // SKIPPED — no re-evaluation
}
```

So AI stacks that got their destination via `moveStack` (not `moveToAttack`) are
never re-evaluated. They keep moving toward the cell chosen at the time of the
AI tick (200ms), even as the target moves.

Additionally, when `findBestMoveToAttackCell` returns null (target too far for
an attack cell), `updateMoveToAttackTargets` stops the stack entirely instead
of redirecting it toward the enemy's current position.

## Fix

### 1. `battle-ai.service.ts` — `moveTowardNearestEnemy`

**Primary path (line 165-169):** Replace `moveStack` with `moveToAttack`,
which sets `moveToAttackTargetId` internally, enabling per-frame re-evaluation:

```typescript
if (moveAttackTarget) {
    const success = await this.movement.moveToAttack(
        state, stack.stackId, moveAttackTarget.stackId,
    );
    if (success) return true;
}
```

**Fallback path (line 193-196):** After a successful fallback `moveStack`,
manually set `stack.moveToAttackTargetId = enemy.stackId` so the stack is
tracked by `updateMoveToAttackTargets`:

```typescript
const result = await this.movement.moveStack(state, stack.stackId, dest.col, dest.row);
if (result) {
    stack.moveToAttackTargetId = enemy.stackId;
    return true;
}
```

### 2. `battle-movement.service.ts` — `updateMoveToAttackTargets`

When `findBestMoveToAttackCell` returns null (line 167-176), instead of
stopping immediately, redirect the stack toward the enemy's current grid
position using `linePath` + `isPathClear`:

```typescript
const bestCell = findBestMoveToAttackCell(state, stack, target);
if (!bestCell) {
    // No optimal attack cell — redirect toward enemy's position to
    // keep closing distance. updateMoveToAttackTargets re-evaluates
    // every frame, so the path stays current as the enemy moves.
    const path = linePath(
        { col: stack.col, row: stack.row },
        { col: target.col, row: target.row },
    );
    let redirected = false;
    if (path) {
        for (let d = path.length; d >= 1; d--) {
            const dest = path[d - 1];
            const destPath = linePath({ col: stack.col, row: stack.row }, dest);
            if (destPath && isPathClear(state, destPath, stack)) {
                const targetVw = cellCenterVw(dest, stack);
                stack.targetX = targetVw.x;
                stack.targetY = targetVw.y;
                redirected = true;
                break;
            }
        }
    }
    if (!redirected) {
        // No valid path — stop and wait for AI to re-plan on next tick
        this.snapToGrid(stack);
        stack.moveToAttackTargetId = null;
        stack.moving = false;
        stack.targetX = null;
        stack.targetY = null;
        this.completeMovement(stack.stackId);
    }
    continue;
}
```

`isPathClear` already checks both static occupancy (`isOccupied`) and in-flight
destination reservations (`isCellReserved`), so the redirected cell won't
conflict with other stacks.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-ai.service.ts` | Use `moveToAttack` in primary path; set `moveToAttackTargetId` in fallback |
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Redirect toward enemy in `updateMoveToAttackTargets` when no bestCell found, instead of stopping |

## Interaction with existing fixes

- **snapToGrid**: preserved — stacks still snap to grid when they stop
- **isCellReserved**: preserved — prevents two stacks on same cell
- **Every-frame update**: the foundation — re-evaluation now runs every frame

## Risks

- **CPU cost**: `findBestMoveToAttackCell` is called every frame per
  move-to-attack stack. Grid is 19x8 = 152 cells. With 4 AI stacks, ~600 cells
  checked per frame. Negligible.
- **AI stack may stall**: if the enemy is surrounded by reserved cells and no
  path is found, the stack stops. Next AI tick (200ms) re-plans. Acceptable.
- **Fallback redirect uses grid position, not visual position**: the enemy's
  `col`/`row` is its last settled cell, not its in-flight position. This is
  the same limitation as the original fallback. Acceptable — re-evaluation
  happens every frame, so the grid position updates as soon as the enemy
  arrives at a new cell.

## Validation

1. `npx ng test --watch=false --include='**/battle-grid.spec.ts'` — all pass
2. `npx ng test --watch=false --include='**/battle-movement.service.spec.ts'` — all pass
3. `npx ng test --watch=false --include='**/battle-ai.service.spec.ts'` — no new failures
4. `npx tsc --noEmit --project tsconfig.app.json` — no errors

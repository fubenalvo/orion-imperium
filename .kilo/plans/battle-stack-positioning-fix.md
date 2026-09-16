# Battle Stack Positioning Fix

## Problem

During battle, stacks are rendering at positions roughly double their expected
grid location (e.g., a stack at col 5 row 5 renders near col 10 row 10). They appear
to be "fixed relative to the screen" rather than anchored to grid cells, and can
end up outside the visible 18x7 grid.

## Root Cause

In `battle-grid.component.ts`, the `stackVw()` method computes:

```typescript
const offset = (stack.size - 1) / 2;
const visualCol = stack.side === 'attacker' ? stack.col + offset : stack.col - offset;
return {
  x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW + (stack.x ?? 0),
  y: (stack.row - 0.5) * BATTLE_CELL_SIZE_VW + (stack.y ?? 0),
};
```

But `stack.x` and `stack.y` are **already absolute VW coordinates** — they are
initialized in `battle-state.ts` via `stackCenterVw(stack)` which returns
`{ x: (visualCol - 0.5) * BATTLE_CELL_SIZE_VW, y: (row - 0.5) * BATTLE_CELL_SIZE_VW }`,
and are then updated every frame by `updateStackPositions()` in `battle-grid.ts`.

The component is **adding** the absolute VW position on top of the cell-based
calculation, producing double the expected offset.

## Fix

**File:** `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`

Replace `stackVw()` with a direct return of `stack.x`/`stack.y`:

```typescript
stackVw(stack: BattleStack): { x: number; y: number } {
  return {
    x: stack.x ?? 0,
    y: stack.y ?? 0,
  };
}
```

### Why This Works

- `stackCenterVw()` in `battle-grid.ts` already computes the side-offset-adjusted
  VW position (accounting for `stack.size` for attacker/defender visual offsets)
- `initializeStackPositions()` stores these absolute VW values into `stack.x`/`stack.y`
- `updateStackPositions()` interpolates between these absolute VW targets each frame
- The component should just read the absolute VW position directly
- `col`/`row` remain available for click detection, pathing, and combat range

### Additional Cleanup

Remove the unused `BATTLE_CELL_SIZE_VW` import from `battle-grid.component.ts`
(line 9) if no other methods in the component use it. Check: `cellVw()` still uses it,
so **keep** the import.

## Validation

1. Run `npx tsc --noEmit` — should pass clean
2. Run `npx jest --testPathPattern="battle-grid.component.spec"` — should pass
3. Visually verify: stacks render at correct grid cell positions, movement interpolates
   smoothly between cells, no stacks appear outside the 18x7 grid
4. Verify `effect.to.x`/`effect.to.y` and projectile lines still render correctly
   (they use `stack.x`/`stack.y` or effect coords directly, not `stackVw()`)
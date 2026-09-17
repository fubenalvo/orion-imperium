# Fix: AI Stacks Converge to Same Cell When Moving

## Context

When AI stacks move toward targets, multiple stacks can converge on the same cell even though that cell will be occupied by another moving stack. The root cause is that `isOccupied` checks only `col`/`row` (current position), not `targetX`/`targetY` (destination). A stack mid-movement still has its origin `col`/`row` until it arrives, so another stack sees the destination as empty.

## Root Cause

`battle-grid.ts:isOccupied` checks `occupiesCell` which reads `stack.col`/`stack.row`. During movement these fields still hold the origin cell. The destination cell (`targetX`/`targetY` mapped back to grid cell) is not reflected as occupied.

Example: Stack A moves from (1,4) to (2,4). A's `col` is still 1. Stack B at (3,4) tries to move to (2,4) — `isOccupied(state, 2, 4, B.id)` sees A's `col=1`, so (2,4) appears empty. Both target (2,4).

## Proposed Fix

**File**: `src/app/components/battle-screen/battle/battle-grid.ts`

Modify `isOccupied` to also consider stacks whose `targetX`/`targetY` maps to the queried cell. Use `vwToStackCell` to convert the visual target to a grid cell.

```typescript
export function isOccupied(state, col, row, excludeStackId): boolean {
  return state.stacks.some((s) => {
    if (s.destroyed || s.stackId === excludeStackId) return false;
    if (occupiesCell(s, col, row)) return true;
    // Also check if this stack is targeting the queried cell.
    if (s.targetX != null && s.targetY != null) {
      const targetCell = vwToStackCell(s, s.targetX, s.targetY);
      return targetCell.col === col && targetCell.row === row;
    }
    return false;
  });
}
```

This is a single function change that fixes all consumers: `getReachableCells`, `getMoveToAttackCells`, `isPathClear`, and any rendering code that checks occupancy.

## Why This Approach

- **Minimal**: One function changed, all callers benefit automatically
- **Correct**: A cell targeted by a moving stack is properly reserved
- **Safe**: `vwToStackCell` only runs when `targetX`/`targetY` are set (guarded by null check), so stacks without targets are unaffected
- **Performance**: `vwToStackCell` is a simple math operation; called once per stack per `isOccupied` check

## Trade-offs

- `isOccupied` becomes slightly more expensive (one extra `vwToStackCell` per stack per call)
- Cells targeted by moving stacks become "occupied" for ALL purposes (rendering, reachability, AI pathfinding) — this is the correct semantic since a stack in transit to a cell has effectively reserved it
- Two stacks targeting the same cell from different directions would both be blocked — but the second one would find a different path or fail gracefully

## Files to Modify

1. `src/app/components/battle-screen/battle/battle-grid.ts` — modify `isOccupied`

## Verification

1. `ng test --watch false` — verify existing `battle-grid.spec.ts` and `battle-combat.service.spec.ts` tests still pass
2. Manual: Watch AI stacks in battle — they should no longer converge on the same cell
3. Manual: Player stacks should also respect occupied-target-cell when choosing moves

## Risks

- `vwToStackCell` uses `Math.round` which could have edge cases at cell boundaries. This is already used elsewhere in the codebase and is well-tested.
- If `isOccupied` is used in rendering and the behavior changes (cells now appear occupied because a stack is targeting them), this is the CORRECT behavior — a targeted cell should visually indicate it's reserved.

# Infinite Movement Loop - Root Cause Analysis & Fix Plan

## Executive Summary

The infinite loop is caused by **`updateMoveToAttackTargets` checking `canAttack` using the ship's interpolated visual position (`x/y`) while the ship is mid-movement**. The visual position temporarily enters attack range during transit, triggering `snapToGrid` which redirects the ship back to its original cell before the movement completes.

---

## 1. Exact Sequence Causing the Loop

```
Frame N:     AI tick -> moveToAttack(attacker @(7,6), target @(11,7))
             -> bestCell = (9,8)  [within 0.8 * range = 2.4 cells of target]
             -> moveStack sets targetX/targetY to center of (9,8)
             -> moving = true, moveToAttackTargetId = target

Frame N+1:   updateStackPositions: ship starts interpolating from (7,6) toward (9,8)
             updateMoveToAttackTargets: 
               - stack.moving = true, moveToAttackTargetId set
               - canAttack(stack, target) uses stack.x, stack.y (INTERPOLATED position!)
               - At some frame, interpolated position is within (range + 1) = 4 cells of target
               - canAttack returns TRUE!
               - snapToGrid called:
                 * vwToStackCell(stack.x, stack.y) -> rounds to NEAREST grid cell
                 * Ship is still near (7,6) visually -> rounds to (7,6)
                 * findNearestFreeCell from (7,6) -> returns (7,6) itself (free)
                 * targetX/targetY set to center of (7,6)
                 * moving = true (re-targeted to original cell!)
               - moveToAttackTargetId = null

Frame N+2:   updateStackPositions: 
               - dist to NEW target (7,6 center) <= 0.01 (already there!)
               - MOVE-COMPLETE fires: "arrived at (7,6) from (7,6)"
               - moving = false

Next AI tick (200ms later):
             Ship at (7,6), target at (11,7), dist=4.21, canAttack=false
             -> moveToAttack called AGAIN -> new destination cell
             -> REPEATS INDEFINITELY
```

---

## 2. Why `MOVE-REEVAL` Thinks Ship Is In Range

**Location**: `battle-movement.service.ts:169`

```typescript
if (canAttack(stack, target)) {  // <-- BUG: uses stack.x, stack.y (visual position)
```

`canAttack` delegates to `isAbsolutePositionInRange(attacker, target, range)` which computes distance between `attacker.x/attacker.y` and `target.x/target.y`.

**During movement**, `stack.x/stack.y` is the **interpolated visual position** between origin and destination cells. It is NOT the logical grid position.

The ship moves from cell (7,6) → (9,8). The target is at (11,7).
- Distance from origin (7,6) to target: 4.21 cells (OUT of range)
- Distance from destination (9,8) to target: ~2.24 cells (IN range)
- **During transit**, the interpolated position passes through distances between 4.21 and 2.24
- At ~60% of the journey, distance ≤ 4.0 (range 3 + tolerance 1)
- `canAttack` returns true **before the ship reaches its destination cell**

---

## 3. Which Position/Range Calculation Is Wrong

| Check Location | Position Used | Correct? |
|----------------|---------------|----------|
| `moveToAttack` (initial) | `stack.col/stack.row` (logical grid) via `findBestMoveToAttackCell` | ✅ |
| `updateMoveToAttackTargets` (per-frame) | `stack.x/stack.y` (INTERPOLATED visual) | ❌ **BUG** |
| `canAttack` in combat | `attacker.x/attacker.y` (visual) | ✅ Only called when NOT moving |
| `tryAutoAttack` (player) | `computeAttackTargetIds` uses `canAttack` | ✅ Only for non-moving stacks |

**The bug**: `updateMoveToAttackTargets` uses the wrong position for a moving ship.

---

## 4. Why `snapToGrid` Resets Ship to Original Cell

**Location**: `battle-movement.service.ts:252-283`

```typescript
private snapToGrid(stack: BattleStack, state: BattleModelState): void {
  const cell = vwToStackCell(stack, stack.x, stack.y);  // Rounds visual pos to nearest cell
  stack.col = cell.col;
  stack.row = cell.row;
  
  const target = this.findNearestFreeCell(state, stack, cell);  // Searches from that cell
  if (target) {
    const center = cellCenterVw(target, stack);
    stack.targetX = center.x;  // Re-targets to this cell's center
    stack.targetY = center.y;
    stack.moving = true;
  }
}
```

1. `vwToStackCell(stack.x, stack.y)` rounds the **current visual position** to nearest grid cell
2. Ship is mid-journey from (7,6) to (9,8) — visual position is still closer to (7,6)
3. Rounds to (7,6) — the **origin cell**
4. `findNearestFreeCell` from (7,6) finds (7,6) itself (it's free, ship logically occupies it)
5. Sets new `targetX/targetY` to center of (7,6) — **cancels the original movement**
6. Ship "arrives" immediately (already at that position) → `MOVE-COMPLETE` at origin

---

## 5. Should `MOVE-REEVAL` Interrupt Active Movement?

**No.** The per-frame re-evaluation should only:
- Update the destination cell if the **target moved** (so the attacker tracks a moving target)
- Handle target destruction
- Handle "no valid cell" (retreat)

It should **NOT** check whether the attacker has entered attack range mid-movement. That check belongs to:
- The **movement completion callback** (when ship actually arrives at destination cell)
- The **next AI tick** (which calls `moveToAttack` again, which checks `canAttack` first)
- The **player auto-attack** (runs every frame for non-moving stacks)

The current code tries to "optimize" by stopping early if the target comes into range, but it uses the wrong position (interpolated visual) causing false positives.

---

## 6. Smallest Safe Fix

**File**: `src/app/components/battle-screen/battle/battle-movement.service.ts`

**Function**: `updateMoveToAttackTargets` (lines 151-237)

**Change**: Remove the `canAttack` check for moving stacks. The movement should complete uninterrupted. Attack range checking happens after arrival via normal AI/player attack logic.

```typescript
// REMOVE lines 165-174:
/*
      // Target already attackable — smoothly align to nearest grid cell.
      // canAttack tolerates a stack that settled just outside absolute
      // range, so a stack standing at attack distance stops here instead
      // of re-planning a move for something it can already hit.
      if (canAttack(stack, target)) {
        console.log(`[MOVE-REEVAL] ${stack.stackId} NOW IN RANGE of ${target.stackId} -> snapToGrid, clear target`);
        this.snapToGrid(stack, state);
        stack.moveToAttackTargetId = null;
        continue;
      }
*/
```

**Why this is safe**:
- `moveToAttack` already checks `canAttack` before moving (line 97)
- If target moves into range during transit, the ship will arrive at its planned cell, then next AI tick (≤200ms) will attack
- Player auto-attack runs every frame for non-moving stacks
- No functionality is lost — just removes the premature range check that uses wrong position

---

## 7. Step-by-Step Implementation Plan

### Step 1: Remove Premature Range Check
**File**: `battle-movement.service.ts`
**Lines**: 165-174 (the `if (canAttack(stack, target))` block in `updateMoveToAttackTargets`)
**Action**: Delete the entire block (including the comment above it)
**Preserve**: Target destruction handling, retreat logic, destination redirect logic

### Step 2: Verify Movement Completion Triggers Attack
**Check**: After movement completes, does the AI/player attack?
- AI: `playAction` runs every 200ms, calls `bestTarget` which uses `canAttack` with logical positions ✅
- Player: `tryAutoAttack` runs every frame for non-moving stacks, uses `computeAttackTargetIds` ✅

### Step 3: Run Tests
```bash
npx ng test --watch=false --include="**/battle-movement.service.spec.ts"
npx ng test --watch=false --include="**/battle-grid.spec.ts"
npx ng test --watch=false --include="**/battle-ai.service.spec.ts"
npx ng build --configuration=development
```

### Step 4: Manual Verification
1. Start battle with two ships at distance > attackRange
2. Observe console logs:
   - `[MOVE-START]` → `[MOVE-COMPLETE]` at DESTINATION cell (not origin)
   - No `[MOVE-REEVAL] NOW IN RANGE` during movement
   - Next AI tick: `[AI-ATTACK]` or `[MOVE-TO-ATTACK] -> DIRECT ATTACK`
3. Confirm no infinite loop

---

## 8. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Ship arrives at cell but target moved away | Next AI tick re-evaluates, calls `moveToAttack` again with new target position |
| 200ms delay before attack after arrival | Acceptable — movement takes seconds, 200ms is negligible |
| Player auto-attack doesn't trigger | `tryAutoAttack` runs every frame for non-moving stacks; ship is non-moving after `MOVE-COMPLETE` |

---

## 9. Files to Modify

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Remove lines 165-174 in `updateMoveToAttackTargets` |

---

## 10. Validation Checklist

- [ ] Build succeeds
- [ ] All existing tests pass
- [ ] Manual test: two ships at distance 4.5, range 3 → movement completes to destination cell, then attack
- [ ] Manual test: target moves during transit → attacker tracks and adjusts destination
- [ ] Manual test: target destroyed during transit → attacker snaps to grid
- [ ] No `[MOVE-REEVAL] NOW IN RANGE` logs during movement
- [ ] `MOVE-COMPLETE` shows destination cell, not origin

---

*Plan saved to `.kilo/plans/1790105505466-infinite-movement-loop-fix.md`*
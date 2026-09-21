# Fix AI Ship Position Jumps on Target Acquisition

## Problem

User reports AI ships still jump **10-20 pixels** on a 1080p monitor when the
enemy enters attack range, despite the 0.1 vw threshold already applied in
`updateMoveToAttackTargets`.

## Root Cause

The 0.1 vw threshold is a **no-op** for the best-cell path: `findBestMoveToAttackCell`
returns discrete grid cells whose centers are ~3.7 vw (~71px) apart. The threshold
never triggers because a different cell always means a target ~3.7 vw away.

The actual 10-20px jump comes from **`snapToGrid`** (line 236-243), called at
three sites in `updateMoveToAttackTargets`:

| Line | Trigger | x/y snap? |
|------|---------|-----------|
| 149  | Target destroyed | Yes — **jump** |
| 159  | Target brought into range | Yes — **jump** (main complaint) |
| 203  | No redirect path found (fallback) | Yes — **jump** |

`snapToGrid` computes the nearest cell via `vwToStackCell` and then **teleports
`x`/`y` to that cell's center** (lines 241-242). When the ship is mid-flight
(between cells), this can move the ship by up to ~0.5 vw (~10px on 1080p),
exactly matching the user's report.

`updateStackPositions` interpolates `x`/`y` smoothly every frame (line 384-388),
so the jump is **not** from the game loop's interpolation — it's from
`snapToGrid`'s instant teleport.

## Why the Threshold Didn't Help

The threshold guards `targetX`/`targetY` updates in `updateMoveToAttackTargets`.
But the jump is in `snapToGrid`, which runs **after** the threshold check and
overrides `x`/`y` regardless. The two code paths are independent.

## Fix

### 1. Stop `snapToGrid` from teleporting x/y

Modify `snapToGrid` (line 236-243) to **only update `col`/`row`**, leaving
`x`/`y` at their current smooth-interpolated position:

```typescript
private snapToGrid(stack: BattleStack): void {
  const cell = vwToStackCell(stack, stack.x, stack.y);
  stack.col = cell.col;
  stack.row = cell.row;
  // x/y left untouched — prevents visual jump when ship is mid-flight.
  // col/row stays in sync with visual position (nearest cell).
}
```

**Why this is safe:**
- Combat targeting uses `x`/`y` (visual position), not `stackCenterVw` — confirmed
  by `battle-combat.service.spec.ts:425-453` ("projectile should aim at the current
  visual position, not the stale cell center").
- Pathfinding uses `col`/`row` as origin — `vwToStackCell` already rounds to
  the nearest cell, so col/row is the best discrete approximation of the
  continuous position.
- `updateStackPositions` already updates `col`/`row` when the ship naturally
  arrives at a target (line 376-378) without teleporting — no change needed there.
- `isOccupied`/`isOccupied` use `col`/`row` for collision checks — the nearest
  cell is a conservative approximation that prevents other ships from colliding.

### 2. Keep the 0.1 vw threshold (already implemented)

It is a harmless no-op for the best-cell path but **does** prevent redundant
target re-sets in the fallback redirect path (lines 183-193) when the enemy
drifts sub-cell. No change needed.

### 3. Update affected tests

Three tests in `battle-movement.service.spec.ts` assert that `snapToGrid`
teleports `x`/`y` to a cell center. These must be updated to verify **col/row
sync without x/y teleport**:

| Test (line) | Current assertion | New assertion |
|-------------|-------------------|---------------|
| L142 `…destroyed and snaps to grid` | `attacker.x ≈ expectedCenter.x` | `attacker.x` unchanged (stays at 7); `attacker.col/row` = nearest cell |
| L173 `…in range and snaps to grid` | `attacker.x ≈ expectedCenter.x` | Same pattern |
| L220 `…snaps to nearest grid cell when target is brought into range` | `attacker.x ≈ snapCenter.x` | `attacker.x` unchanged (stays at `offGridX`); `attacker.col/row` = nearest cell |

Each test should also add a new assertion verifying `attacker.x` and `attacker.y`
**did not change** — this is the regression guard for the jump.

## Why Not Just Increase the Threshold?

A larger threshold (e.g., 3.5 vw = one cell) would prevent all re-targeting,
which means ships would never adjust to enemy movement — they'd chase stale
positions. The `snapToGrid` fix directly addresses the visual jump while
preserving all targeting logic.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-movement.service.ts` | Remove `x`/`y` teleport from `snapToGrid` (lines 241-242); keep 0.1 vw threshold already applied |
| `src/app/components/battle-screen/battle/battle-movement.service.spec.ts` | Update 3 tests: assert x/y unchanged, col/row synced to nearest cell |

## Risks

- **col/row approximate**: After `snapToGrid`, `col`/`row` is the nearest cell to
  the visual position, not necessarily the cell the ship was heading to. If the
  next AI tick paths from this approximate cell, the path might be slightly
  different. This is a minor inefficiency, not a correctness issue — the ship
  still moves toward the best cell center via smooth interpolation.
- **No backward compat break**: No schema or API changes. `snapToGrid` remains
  internal.

## Validation

1. `npx ng test --watch=false --include='**/battle-movement.service.spec.ts'` — 33 tests pass after test updates
2. `npx ng test --watch=false --include='**/battle-grid.spec.ts'` — regression check
3. `npx tsc --noEmit --project tsconfig.app.json` — type check clean

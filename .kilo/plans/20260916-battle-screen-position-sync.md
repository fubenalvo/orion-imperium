# Battle Screen Ship Position Sync Fix

## Problem

On the battle screen (tactical minigame at `/battle`), when a stack is mid-movement and gets attacked, the projectile animation travels to the target's **stale grid-cell center** instead of the target's **current visual position**. The target appears to have moved to an empty space while the shot still aims where it used to be.

## Root Cause

In `BattleCombatService.attackStack()` (`src/app/components/battle-screen/battle/battle-combat.service.ts:64-65`):

```typescript
const from = stackCenterVw(attacker);
const to   = stackCenterVw(target);
```

`stackCenterVw()` computes a position from `stack.col`/`stack.row` (integer grid cells). These integers are **only updated when a stack fully reaches its target** in `updateStackPositions()` (`battle-grid.ts:256-278`). While a stack is mid-movement (distance > 0.01), `col/row` still reflect the **previous** cell even though `stack.x/stack.y` already reflect the current visual position.

The template renders stacks at `stack.x/stack.y` (via `stackVw()` in `battle-grid.component.ts:62-67`), but combat projectiles use `stackCenterVw()` which reads `col/row` — a stale position during movement.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/battle-screen/battle/battle-combat.service.ts` | Fix projectile `from`/`to` positions to use `stack.x/stack.y` instead of `stackCenterVw()` |
| `src/app/components/battle-screen/battle/battle-combat.service.spec.ts` | Add/update test verifying projectile targets current visual position |

## Fix Detail

In `BattleCombatService.attackStack()`, change:

```typescript
const from = stackCenterVw(attacker);
const to = stackCenterVw(target);
```

To:

```typescript
const from = { x: attacker.x, y: attacker.y };
const to = { x: target.x, y: target.y };
```

This aligns projectile `from`/`to` positions with the template's `stackVw(stack)` helper (which reads `stack.x/stack.y`), ensuring projectiles always travel to the target's current visual location.

`isInRange` checks in `bestTarget()` and `attackStack()` continue to use `col/row` intentionally — grid-cell range is the deliberate tactical design (same cell = engagement range). The only fix needed is the visual projectile position.

## Verification

1. Run existing tests: `npx vitest run src/app/components/battle-screen/`
2. Add a test case in `battle-combat.service.spec.ts` where the target stack has `col/row` at one cell but `x/y` at a different (mid-movement) position — verify the projectile `to` position matches `x/y`, not `stackCenterVw(target)`.
3. Manual verification: deploy stacks, give one a movement target, wait until it's between cells but not yet arrived, then attack it — projectile should travel to current visual position, not previous cell center.

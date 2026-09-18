# Battle Screen — Allow Command Redirection While Moving

## Context
When a player's stack is selected and mid-movement, the UI currently blocks all new commands (move, attack, select). Players must wait until the stack arrives before issuing another command. This feels sluggish in a real-time game — players should be able to redirect a moving stack at any time.

## Behavior
- Selected stack is moving to cell A → player clicks cell B → stack redirects to B (no wait)
- Selected stack is moving to cell A → player clicks enemy E → stack redirects towards E, sets `explicitAttackTargetId`, moves towards E
- Direct attack while still moving is NOT allowed (attack requires stationary position) — this falls through to "move towards and attack" instead
- AI stacks unaffected (they don't take player commands)

## Affected Files

### 1. `src/app/components/battle-screen/battle/battle-movement.service.ts`
- `moveStack()` line 39: remove `stack.moving` from the rejection gate. When moving, just update `targetX/targetY` — the game loop interpolates toward the new target from the current position.
- `moveToAttack()` line 77: remove `stack.moving` from the rejection gate. If in range and moving, `attackStack` will be called but blocked by combat gate (intentional — can't fire while moving). If out of range, movement redirects.

### 2. `src/app/components/battle-screen/battle-screen.component.ts`
- `canPlayerAct` getter line 213: remove `!stack.moving` condition. Selected + non-destroyed = can act.
- `moveCells` getter line 218: change `this.canPlayerAct` to `stack && !stack.destroyed` so move highlights show while moving.
- `onStackClick()` line 391: remove `if (!stack.moving)` gate for selecting own moving stacks.
- `onStackClick()` line 405: remove `selected.moving` gate for enemy clicks.
- `onStackClick()` enemy attack logic lines 409-414: change so that if `selected.moving`, always call `moveTowardsAndAttack` (skip direct attack — it would fail due to combat gate anyway). If NOT moving, keep current logic (direct attack if in range, move-towards-attack if out of range).

### 3. `src/app/components/battle-screen/battle-screen.component.html`
- No template changes needed. The `selection-moving` badge (line 86-88) already shows. Move/attack cells will now be visible. `canSelect="canAct"` already allows click interactions when player has stacks.

## What Stays Unchanged
- `battle-combat.service.ts` `attackStack()` line 59: `attacker.moving` gate stays — direct attacks require stationary position.
- `battle-screen.component.ts` `tryAutoAttack()` line 651: `attacker.moving` gate stays — auto-attack waits for arrival.
- `doAttack()` unchanged — it correctly fails silently when stack is moving (combat gate).
- `doMove()` unchanged — relies on `moveStack` which now allows redirection.
- `doMoveToAttack()` unchanged — relies on `moveToAttack` which now allows redirection.
- All movement validation (path, occupancy) unchanged — `moveStack` still validates path before redirecting.

## Edge Cases
1. **Stack moving, player clicks in-range enemy**: `onStackClick` → `moveTowardsAndAttack` (never direct attack while moving). Stack redirects towards enemy, sets explicit target, arrives in range, auto-attack fires.
2. **Stack moving, player clicks non-reachable cell**: `moveStack` validates new path from current `col/row` to new target. If path is blocked, `moveStack` returns false, `doMove` shows PATH BLOCKED feedback. Correct behavior.
3. **Stack moving, player clicks same cell**: `moveStack` checks `target.col === stack.col && target.row === stack.row` → returns false. No-op.
4. **Stack moving, player clicks different enemy**: `moveTowardsAndAttack` redirects. Old `explicitAttackTargetId` overwritten by new one (set in `moveTowardsAndAttack` line 541).
5. **Stack arrived at A, player quickly clicks B**: `stack.moving` is false at this point (game loop set it false when arrived). Normal `moveStack` flow. No redirection needed.

## Verification
- `npx tsc --noEmit` — 0 errors
- `npx tsc --noEmit -p tsconfig.spec.json` — 0 errors
- Manual: select moving stack, click different cell → stack redirects
- Manual: select moving stack, click enemy → stack redirects towards enemy
- Manual: click non-reachable cell while moving → PATH BLOCKED feedback
- Existing tests should continue to pass (all test fixtures go through `toBattleShip()` pipeline)

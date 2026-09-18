# Move-to-Attack: Periodic Target Re-computation

## Context

When a player or AI issues `moveToAttack` on a moving target, the destination cell is computed once at command time. If the target moves away, the attacker chases a stale grid cell. The fix: re-compute the destination every second using the target's current absolute position.

## Decisions

1. **Re-compute interval**: 1 second (`MOVE_TO_ATTACK_UPDATE_INTERVAL_MS = 1000`)
2. **Approach**: Option B variant — periodic re-compute (not on arrival, not per-frame)
3. **Target tracking**: Add `moveToAttackTargetId?: string | null` to `BattleStack` to know which target a moving stack is chasing

## Files to Change

### 1. `src/app/components/battle-screen/battle/battle.types.ts`
- Add `moveToAttackTargetId?: string | null` to `BattleStack` interface
- Add `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS = 1000` constant

### 2. `src/app/components/battle-screen/battle/battle-movement.service.ts`
- In `moveToAttack()`: after `moveStack` succeeds, set `stack.moveToAttackTargetId = targetStackId`
- Add `updateMoveToAttackTargets(state: BattleModelState): void` method:
  - For each stack where `moving && moveToAttackTargetId`:
    - Find target by `moveToAttackTargetId`
    - If target missing/destroyed: clear `moveToAttackTargetId`, set `moving = false`, clear `targetX/targetY`
    - Else: call `findBestMoveToAttackCell(state, stack, target)`
      - If no cell found (target in range or no path): clear `moveToAttackTargetId`, set `moving = false`, clear `targetX/targetY`
      - If cell found: compute cell center via `stackCenterVw`, update `stack.targetX/targetY`

### 3. `src/app/components/battle-screen/battle-screen.component.ts`
- Add a timer accumulator (`moveToAttackUpdateAccumulator`)
- In `gameLoopCallback(deltaTime)`: accumulate delta time; when >= `MOVE_TO_ATTACK_UPDATE_INTERVAL_MS`, call `movement.updateMoveToAttackTargets(state)` and reset accumulator

### 4. Tests
- `battle-movement.service.spec.ts`: Add test for `updateMoveToAttackTargets` — re-computes destination when target moves
- `battle-movement.service.spec.ts`: Add test for target destroyed → clears `moveToAttackTargetId`
- `battle-movement.service.spec.ts`: Update existing "allows changing the move target while already moving" test to set `moveToAttackTargetId`

## Edge Cases

- **Target moves into range**: `findBestMoveToAttackCell` returns no cells → stack stops, caller handles attack on next tick
- **Target destroyed mid-move**: Stack stops immediately, `moveToAttackTargetId` cleared
- **Multiple stacks chasing same target**: Each re-computes independently
- **Stack changes target via new `moveToAttack` call**: Old `moveToAttackTargetId` overwritten

## Validation

- `npm run build` passes
- `npm test -- --watch=false` — all 607+ tests pass, including new tests

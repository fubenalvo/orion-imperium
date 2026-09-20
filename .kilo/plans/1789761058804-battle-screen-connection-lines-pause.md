# Battle Screen Connection Lines - Pause Animation & Visibility

## Goal
Ensure battle screen connection lines (move line and attack line) animate and remain visible when the battle screen is paused.

## Current State Analysis

### Connection Line Implementation
- **Move line** (`moveConnectionLine` getter in `BattleScreenComponent`): Shows when a stack is selected and `stack.moving === true` with valid `targetX/targetY`
- **Attack line** (`attackConnectionLine` getter): Shows when a stack has `explicitAttackTargetId` or `moveToAttackTargetId`
- **Rendering**: `BattleGridComponent` renders both via `@if (getConnectionLine())` and `@if (getAttackConnectionLine())`
- **Animation**: Pure CSS `animation: trail-dash-move 0.5s linear infinite` on `.connection-line` class

### Pause Behavior
- Game loop runs continuously via `requestAnimationFrame` (in `BattleGameLoopService`)
- `BattleTimeService.getScaledDeltaTime()` returns `0` when paused
- `updateStackPositions()` called with `deltaTime = 0`:
  - `step = Math.min(stack.speed * 0, dist) = 0`
  - Positions don't change
  - **But** `stack.moving = true` is still set (line 329 in battle-grid.ts)
- `BattleAnimationService.tick()` called every frame → triggers change detection
- Connection line getters re-evaluated every frame via change detection

### Potential Issues
1. **Edge case**: If a stack was already at its target (`dist <= 0.01`) when pause is triggered, `updateStackPositions` would complete the movement on the first paused frame, setting `stack.moving = false` and hiding the move line
2. **No explicit test coverage** for pause state connection line visibility

## Plan

### 1. Verify Current Behavior
- Test manually: Start battle, select stack, issue move command, pause game → verify move line visible and animating
- Test: Select stack, target enemy, pause game → verify attack line visible and animating

### 2. Ensure Move Line Persists During Pause
**File**: `src/app/components/battle-screen/battle/battle-grid.ts`
- In `updateStackPositions()`: When `deltaTime === 0` (paused), skip the movement completion logic
- Only update `stack.moving = true` when actually moving (`step > 0`)
- This prevents stacks from "completing" movement during pause due to floating-point precision

### 3. Ensure Attack Line Persists During Pause
- No changes needed - attack line depends on `explicitAttackTargetId`/`moveToAttackTargetId` which are not affected by pause

### 4. Verify CSS Animation Runs During Pause
- The CSS animation `trail-dash-move` is pure CSS and runs independently
- No Angular/game loop dependency
- Verify in browser dev tools that animation continues when paused

### 5. Add Test Coverage
**File**: `src/app/components/battle-screen/battle-screen.component.spec.ts`
- Add test: "connection lines remain visible and animated when battle is paused"
- Test both move line and attack line

## Files to Modify

1. `src/app/components/battle-screen/battle/battle-grid.ts` - Fix `updateStackPositions` to not complete movement when paused
2. `src/app/components/battle-screen/battle-screen.component.spec.ts` - Add pause state tests

## Acceptance Criteria
- [ ] Move connection line visible and animating when battle paused (stack moving)
- [ ] Attack connection line visible and animating when battle paused (stack has attack target)
- [ ] Lines update position correctly when unpaused and movement resumes
- [ ] No regression in normal (unpaused) behavior
- [ ] Tests pass
# Battle Screen Command System Issues - Investigation & Fix Plan

## User Reported Issues
1. **Inconsistent command execution**: After giving one command to a stack, second command doesn't always work - works "ad-hoc" randomly
2. **Can't switch attack targets**: Click enemy A to attack, then click enemy B to attack B instead - doesn't reliably work
3. **Commands stop working once combat starts**: "ahogy elkezdődik a harc utána nem tudok több parancsot adni"
4. **Suspects pause/speed controls broke runtime command execution**
5. **First few commands work, then it breaks**: "egy darabig tökjól tudok adni parancsokat a stack-eknek, utána vagy nem veszi be, vagy törli"
6. **Stack switching broken**: "az első kijelölt stack-et tudnám tökjól irányítani ameddig nem váltok el róla. de ha más stackre kattintok, azt már nem tudom irányítani rendesen" - **FIXED**
7. **NEW: Command lag**: "ha új parancsot adok egy hajónak, olyan mintha laggolva, később reagálna fél-1 másodperccel" - **NEEDS FIX**

## Root Cause Analysis

### Issue 1: Animation Service Generation Bug (FIXED)
**File**: `src/app/components/battle-screen/battle/battle-animation.service.ts`
**Fix Applied**: Generation only increments when starting NEW animation cycle (count 0→1)

### Issue 2: Command Queue Not Cleared on Stack Switch (FIXED)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Fix Applied**: Clear queue on stack switch, use setter for `explicitAttackTargetId` cleanup

### Issue 3: User Commands Wait for Auto-Attack Animations (NEW - HIGH PRIORITY)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Lines**: 302-306 (`executeCommand`)

**Problem**: 
- `executeCommand` waits for `anim.isStackBusy(stackId)` before executing user command
- Auto-attacks run every ~700-1000ms per stack, animation lasts ~500-900ms
- Stack is animating ~50-70% of the time
- User command waits up to 1500ms (timeout) for animation to complete
- This causes the 0.5-1 second lag the user reports

**Why it was added**: To prevent command conflicts, but it breaks responsiveness

**Correct behavior**: User commands should execute IMMEDIATELY. They can interrupt/redirect current actions:
- `doMove` clears `explicitAttackTargetId` and starts new movement
- `doAttack` sets new `explicitAttackTargetId` and fires immediately
- `moveTowardsAndAttack` sets new target and moves
- Movement system handles redirection natively

### Issue 4: Animation Wait Timeout Uses Real Time (PARTIALLY FIXED)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Fix Applied**: Reduced timeout from 3000ms → 1500ms
**Remaining**: Uses real `setTimeout` instead of battle time

## Implementation Plan

### Phase 1: Remove Animation Wait for User Commands (HIGHEST PRIORITY)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Change**: Remove the `anim.isStackBusy` wait in `executeCommand` and `drainCommandQueue`
**Rationale**: User commands should interrupt/redirect immediately, not wait for auto-attack animations

### Phase 2: Remove Unused Helper Method
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Change**: Remove `waitForStackAnimationWithTimeout` since no longer needed

### Phase 3: Test Responsiveness
Verify: Click to move/attack → immediate response, no lag

## Files to Modify
1. `src/app/components/battle-screen/battle-screen.component.ts` - Remove animation wait in executeCommand/drainCommandQueue

## Validation Criteria
- [ ] Click stack → immediate selection
- [ ] Click enemy → immediate attack command (no 0.5-1s lag)
- [ ] Click cell → immediate move command (no lag)
- [ ] Multiple rapid commands work
- [ ] Stack switching works
- [ ] Auto-attacks still work (visual animations)
- [ ] All existing tests pass
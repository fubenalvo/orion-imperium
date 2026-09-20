# Battle Screen Command System Issues - Investigation & Fix Plan

## User Reported Issues
1. **Inconsistent command execution**: After giving one command to a stack, second command doesn't always work - works "ad-hoc" randomly
2. **Can't switch attack targets**: Click enemy A to attack, then click enemy B to attack B instead - doesn't reliably work
3. **Commands stop working once combat starts**: "ahogy elkezdődik a harc utána nem tudok több parancsot adni"
4. **Suspects pause/speed controls broke runtime command execution**
5. **First few commands work, then it breaks**: "egy darabig tökjól tudok adni parancsokat a stack-eknek, utána vagy nem veszi be, vagy törli"
6. **NEW: Stack switching broken**: "az első kijelölt stack-et tudnám tökjól irányítani ameddig nem váltok el róla. de ha más stackre kattintok, azt már nem tudom irányítani rendesen"

## Root Cause Analysis

### Issue 1: Animation Service Generation Bug (FIXED)
**File**: `src/app/components/battle-screen/battle/battle-animation.service.ts`
**Fix Applied**: Generation only increments when starting NEW animation cycle (count 0→1)

### Issue 2: Command Queue Not Cleared on Stack Switch (NEW - HIGH PRIORITY)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`

**Problem**: 
- User selects stack A, gives commands → queued for stack A
- User selects stack B, gives commands → queued for stack B  
- Queue processes in FIFO order: stack A's commands execute BEFORE stack B's
- Old stack's pending commands can interfere with new stack's control
- `replaceOrEnqueueCommand` only replaces for SAME stackId, doesn't clear other stacks' commands

**Evidence**: 
- `onStackClick` (line 520-552) switches selection but doesn't clear queue
- `selectedStackId` setter (line 117-128) only clears `explicitAttackTargetId` when setting to `null`, not when switching stacks
- `clearCommandQueue()` exists (line 346-349) but only called on destroy

### Issue 3: Setter vs Direct Assignment Inconsistency
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Lines**: 538 (direct assignment `this._selectedStackId = stack.stackId`) vs setter (line 117-128)

The setter has logic to clear old stack's `explicitAttackTargetId`, but `onStackClick` bypasses the setter by directly assigning `this._selectedStackId`.

### Issue 4: Animation Wait Timeout (PARTIALLY FIXED)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Fix Applied**: Reduced timeout from 3000ms → 1500ms
**Remaining**: Uses real `setTimeout` instead of battle time

## Implementation Plan

### Phase 1: Clear Command Queue on Stack Switch (HIGHEST PRIORITY)
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Changes**:
1. In `onStackClick`, when switching to a different player-owned stack, call `clearCommandQueue()` before setting new selection
2. Or add a method `switchSelection(stackId)` that clears queue and uses the setter
3. Make `onStackClick` use the setter (`this.selectedStackId = stack.stackId`) instead of direct assignment

### Phase 2: Fix Setter to Clear on Any Change
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Change**: Modify `selectedStackId` setter to clear old stack's `explicitAttackTargetId` whenever value changes (not just when setting to null)

### Phase 3: Clear Old Stack's Commands from Queue
**File**: `src/app/components/battle-screen/battle-screen.component.ts`
**Change**: In `replaceOrEnqueueCommand` or new method, remove commands for the previously selected stack when switching

### Phase 4: Test Stack Switching Scenario
Verify: Select stack A → give commands → select stack B → give commands → both work correctly

## Files to Modify
1. `src/app/components/battle-screen/battle-screen.component.ts` - Clear queue on stack switch, fix setter, use setter in onStackClick

## Validation Criteria
- [ ] Can select stack A, give multiple commands, works reliably
- [ ] Can switch to stack B, give commands, works reliably
- [ ] Can switch back to stack A, give commands, works reliably
- [ ] Old stack's pending commands don't interfere with new stack
- [ ] Auto-attacks don't block user commands after switch
- [ ] All existing tests pass
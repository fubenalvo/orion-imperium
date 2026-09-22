# Battle Screen Issues Investigation & Implementation Plan

## 1. Current Implementation

### Key Files & Functions

| File | Responsibility |
|------|----------------|
| `battle-grid.ts` | Core grid logic: `findBestMoveToAttackCell`, `getMoveToAttackCells`, `isPathClear`, `canAttack` |
| `battle-movement.service.ts` | Movement execution: `moveToAttack`, `updateMoveToAttackTargets`, `moveStack` |
| `battle-combat.service.ts` | Attack execution: `attackStack` (sets `firing=true/false`) |
| `battle-ai.service.ts` | AI decision making: `playAction`, `moveTowardNearestEnemy` |
| `battle-screen.component.ts` | Game loop, player input, auto-attack: `tryAutoAttack`, `gameLoopCallback` |
| `battle-grid.component.ts` | Visual rendering: `stackClasses` adds `firing` CSS class |
| `battle-grid.component.scss` | Stack visual styles (NO `.firing` animation defined) |

### How Pieces Interact

1. **Target Cell Selection**: `findBestMoveToAttackCell` (called by `moveToAttack` and `updateMoveToAttackTargets`) finds valid attack positions within `attackRange * AI_MOVE_TO_ATTACK_RATIO` (80% of range).

2. **Movement**: `moveStack` sets `targetX/targetY`; game loop calls `updateStackPositions` every frame to interpolate.

3. **Attack Execution**: When in range, `attackStack` validates `canAttack`, then runs animation sequence:
   - `attacker.firing = true`
   - Projectile effect (320ms)
   - Damage calculation
   - Impact/explosion effect (200/420ms)
   - `attacker.firing = false`

4. **Firing Visual**: `battle-grid.component.ts:stackClasses()` adds `'firing'` class when `stack.firing === true`. **No CSS animation exists for `.firing` class.**

5. **AI/Player Attack Loop**:
   - AI: One action per 200ms tick, attacks first available target
   - Player: `tryAutoAttack` runs every frame for all player stacks (with fire-rate cooldown)

---

## 2. Root Causes

### Issue 1: Attackers Pile Up on Same Side

**Location**: `battle-grid.ts:593-650` (`findBestMoveToAttackCell`)

**Root Cause**: The selection priority order:
1. **Primary**: Closest cell to attacker (Chebyshev distance) — minimum move cost
2. **Secondary**: Closest cell to target
3. **Tertiary**: Farthest from nearest ally (fan out) — **only breaks ties**
4. **Final**: Stable cell coordinate ordering

**Why it causes piling**: All attackers approaching from the same direction (e.g., left side) have the SAME closest cell on the attack ring around the target. Since they start at different rows, their Chebyshev distances to that closest cell differ, so the primary sort key picks different cells for each — but those cells are all on the same side of the target. The "fan out" criterion never activates as a primary driver because ties on distance-to-attacker are rare.

**Occupied cells ARE considered** (via `isOccupied` + `isCellReserved` in `getMoveToAttackCells`), but only to exclude invalid cells. They don't influence *which* valid cell is preferred.

**Attacker's approach direction IS NOT considered** — the algorithm doesn't know or care which side the attacker comes from.

**Grid boundaries** are handled by `isInBounds` checks in `getMoveToAttackCells`.

**Multiple attackers CAN reserve the same target area** — `isCellReserved` prevents two stacks from targeting the exact same destination cell, but they can target adjacent cells on the same side.

### Issue 2: Incorrect `firing` Animation

**Location**: `battle-combat.service.ts:70,150` (sets `attacker.firing = true/false`)

**Root Cause**: 
1. **No CSS animation exists** for `.firing` class in any SCSS file. The user's description of "ship moves half a cell toward target and back" describes a *desired* or *planned* animation that hasn't been implemented.

2. **Multiple simultaneous attacks**: Player's `tryAutoAttack` runs for ALL player stacks every frame. If 3 ships are in range of the same target, all 3 call `attackStack` in the same frame → all 3 get `firing = true` for ~520ms. The first attack may destroy the target, making the other two attacks "not useful" but they still play the firing animation.

3. **Tolerance allows marginal attacks**: `ATTACK_GRID_TOLERANCE_CELLS = 1` means a ship at distance `range + 1` can attack. A rear ship at distance 4 (range 3) can fire "through" the front ship at distance 3.

4. **Firing state tied to attack command, not attack resolution**: `firing = true` is set at animation START (projectile launch), not at impact. If the target dies from the first attacker's volley, the other attackers' projectiles are already "in flight" visually.

---

## 3. Proposed Solutions

### Issue 1: Better Target Cell Distribution

**Smallest change**: Modify `findBestMoveToAttackCell` to prefer cells on *different sides* of the target based on attacker's approach angle.

**Approach**: 
- Compute the attacker's approach angle to the target (vector from attacker to target)
- Group candidate cells by quadrant relative to target (front, left, right, rear)
- Prefer cells in the quadrant matching the approach direction, but if occupied, spill to adjacent quadrants
- Make "distance from allies" a stronger factor (secondary, not tertiary)

**Alternative simpler fix**: Change sort priority to:
1. Distance from nearest ally (fan out) — **primary**
2. Distance to attacker — secondary
3. Distance to target — tertiary

This naturally spreads attackers because the first attacker claims the closest cell, the second finds that cell "close to ally" and picks the next best, etc.

### Issue 2: Firing Animation Only on Actual Attack Execution

**Two sub-fixes**:

**A. Add proper CSS animation** for `.firing` class in `battle-grid.component.scss`:
- Subtle muzzle flash / recoil effect (scale or brightness pulse)
- **NO positional transform** — ship should not visually move

**B. Tighten when `firing` is set** (optional, if user wants stricter gating):
- Only set `firing = true` if the attack will actually deal damage (target alive, in range, not already doomed)
- Or: Keep current behavior (fire on launch) but ensure CSS doesn't move the ship

**Recommended**: Add CSS animation (A) without changing logic (B), since the current logic correctly only sets `firing` during actual attack execution. The "piling up" visual issue is actually an Issue 1 symptom — rear ships attack because they're in range, not because of a firing bug.

---

## 4. Implementation Plan

### Step 1: Fix Target Cell Selection (Issue 1)

**File**: `src/app/components/battle-screen/battle/battle-grid.ts`

**Function**: `findBestMoveToAttackCell` (lines 593-650)

**Changes**:
1. Reorder selection criteria:
   - Primary: `minDistanceToAllies` (fan out) — prefer cells farthest from other friendly stacks
   - Secondary: Chebyshev distance to attacker (move cost)
   - Tertiary: Absolute distance to target
   - Final: Stable cell ordering

2. Add approach-direction awareness (optional enhancement):
   - Compute angle from attacker to target
   - Slight preference for cells in the "forward" quadrant

**What NOT to change**:
- `getMoveToAttackCells` (candidate generation)
- `canAttack` / attack range rules
- Movement interpolation logic

**Verification**: 
- Run existing tests: `npm test -- battle-grid.spec.ts`
- Manual test: Place 4 attackers on left, 1 defender on right → attackers should spread across top/middle/bottom attack positions

---

### Step 2: Add Firing CSS Animation (Issue 2)

**File**: `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`

**Changes**:
Add `.stack.firing` animation:
```scss
.stack.firing {
  animation: firing-recoil 180ms ease-out;
}

@keyframes firing-recoil {
  0% { transform: scale(1); filter: brightness(1); }
  30% { transform: scale(0.95); filter: brightness(1.3); }
  100% { transform: scale(1); filter: brightness(1); }
}
```
- Uses `scale` and `brightness` — **no translate/position change**
- Duration ~180ms (shorter than projectile+impact so it completes before impact)

**What NOT to change**:
- `battle-combat.service.ts` attack logic
- `firing` state timing (keep at animation start)

**Verification**:
- Visual check: Click attack → ship flashes/recoils but stays in place
- Run existing tests: `npm test -- battle-grid.component.spec.ts`

---

### Step 3 (Optional): Prevent Redundant Simultaneous Attacks

**File**: `src/app/components/battle-screen/battle-screen.component.ts`

**Function**: `tryAutoAttack` (lines 815-888)

**Change**: Track recently attacked targets per frame; skip auto-attack if target was already attacked this frame by another friendly stack.

```typescript
// In gameLoopCallback, before player auto-attack loop:
const attackedTargetsThisFrame = new Set<string>();

// In tryAutoAttack:
if (attackedTargetsThisFrame.has(targetStack.stackId)) return false;
attackedTargetsThisFrame.add(targetStack.stackId);
```

**What NOT to change**:
- Explicit player attacks (`doAttack`) — always allow
- AI attacks (already one per tick)

**Verification**:
- Multiple ships in range of same target → only first fires per frame
- Run tests: `npm test -- battle-screen.component.spec.ts`

---

## 5. Expected Result

### Scenario: 4 Attackers (range 3) vs 1 Defender at column 16, row 4

**Before Fix**:
- All 4 attackers move to cells (13,4), (12,4), (11,4), (10,4) — same row, piling up left-to-right
- Rear attackers may be blocked or out of effective range
- All 4 may fire simultaneously if in range + tolerance

**After Fix**:
- Attacker 1 (row 3) → cell (13,3) [top attack position]
- Attacker 2 (row 4) → cell (13,4) [direct front]
- Attacker 3 (row 5) → cell (13,5) [bottom attack position]
- Attacker 4 (row 2) → cell (12,4) [side position, next best]
- Each ship fires in sequence (one per frame max for auto-attack)
- Firing animation: brief scale/brightness pulse, **no position shift**

### Validation Checklist
- [ ] First ship takes valid attack position
- [ ] Additional ships choose other valid positions around target
- [ ] No unnecessary piling up when valid positions exist elsewhere
- [ ] Rear ships get into attack range when valid positions exist
- [ ] Ship only receives `firing` visual when actually executing attack
- [ ] Ship outside attack range does not play firing animation
- [ ] Firing animation does not move ship position
- [ ] Existing battle mechanics (movement, combat, AI) still work
- [ ] All existing tests pass
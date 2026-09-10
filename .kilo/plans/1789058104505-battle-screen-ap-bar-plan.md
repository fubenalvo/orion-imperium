# Battle Screen AP Bar & End Turn Pulse Plan

## Goal
Update the battle screen's action point system:
1. Increase AP per turn from 10 to 50
2. Replace text "AP: X/10" with a grid-width progress bar showing fill and current value
3. Make End Turn button pulse when AP is depleted OR no movable ships remain
4. **Add "spent" visual state for ships that can neither move nor attack**
5. **Increase AP costs by 50% (moveApPerCell, attackAp)**
6. **Reduce battleMoveRange to 60% (rounded up)**

---

## Files to Modify

### 1. `src/app/components/battle-screen/battle/battle.types.ts`
- Change `AP_PER_TURN` constant from `10` to `50` (line 25)

### 2. `src/app/components/battle-screen/battle/battle-state.ts`
- Update initial state: `ap: 50`, `apPerTurn: 50` (lines 50-51)

### 3. `src/app/components/battle-screen/battle/battle-ship-stats.ts`
- Increase `moveApPerCell` and `attackAp` by 50% (multiply by 1.5)
- Line 82: `moveApPerCell: Math.ceil(tier * 1.5)`
- Line 83: `attackAp: Math.ceil(tier * 1.5)`
- Line 99: `moveApPerCell: Math.ceil(3 * 1.5)` → 5
- Line 100: `attackAp: Math.ceil(2 * 1.5)` → 3
- Lines 114-115: same for fallback

### 4. `src/app/components/star-map/ship-data.json`
- Reduce `battleMoveRange` for all ships to 60% of current value (rounded up with `Math.ceil`)

### 5. `src/app/components/battle-screen/battle-screen.component.ts`
- Add new getter `shouldPulseEndTurn()` that returns true when:
  - `state.ap <= 0` (or very low threshold, e.g., `< 5`)
  - OR no player-controlled stacks have valid actions remaining
- Valid action check: stack on active side, not destroyed, not immobile, and either:
  - `cellsMovedThisTurn < moveRange` AND `state.ap >= stack.moveApPerCell` (can move at least 1 cell)
  - OR `!attackedThisTurn` AND `state.ap >= stack.attackAp` (can attack)
- **Add new getter `spentStackIds()` that returns Set<string> of stackIds that are "spent":**
  - For each active side stack (not destroyed, not immobile):
    - Compute `getReachableCells(state, stack)` - if any cells AND `ap >= moveApPerCell` → can move
    - Compute `computeAttackTargetIds(state, stack)` - if any targets AND `!attackedThisTurn` AND `ap >= attackAp` → can attack
    - Compute `getMoveToAttackTargetIds(state, stack)` - if any targets AND `ap >= moveApPerCell + attackAp` → can move-to-attack
    - If NONE of the above AND not animating (`!moving && !firing`) → add to spent set
  - If `ap <= 0` → all active side stacks are spent

### 6. `src/app/components/battle-screen/battle-screen.component.html`
- Replace line 18 `<div class="battle-screen__ap">AP: {{ state.ap }} / {{ state.apPerTurn }}</div>` with a progress bar:
  ```html
  <div class="battle-screen__ap-bar" [style.width.vw]="72">
    <div class="battle-screen__ap-fill" [style.width.%]="(state.ap / state.apPerTurn) * 100"></div>
    <span class="battle-screen__ap-text">AP: {{ state.ap }} / {{ state.apPerTurn }}</span>
  </div>
  ```
- Add `[class.pulse]="shouldPulseEndTurn()"` to the End Turn button (line 38-39)
- Pass `[activeSide]="battleState?.activeSide ?? 'attacker'"` to `app-battle-grid`
- Pass `[ap]="battleState?.ap ?? 0"` to `app-battle-grid`
- Pass `[spentStackIds]="spentStackIds"` to `app-battle-grid`

### 7. `src/app/components/battle-screen/battle-screen.component.scss`
- Add styles for `.battle-screen__ap-bar` (grid-width: 72vw, height ~8-10px, background, border-radius)
- Add styles for `.battle-screen__ap-fill` (height 100%, transition, green color)
- Add styles for `.battle-screen__ap-text` (position absolute, centered, white text with shadow)
- Add `.pulse` animation for `.end-turn-btn` (keyframes: box-shadow pulse, ~1.5s infinite)

### 8. `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`
- Add `@Input() activeSide: BattleSide = 'attacker';`
- Add `@Input() ap = 0;`
- Add `@Input() spentStackIds: Set<string> = new Set();`
- Update `stackClasses()` to add `spent` class when `spentStackIds.has(stack.stackId)`:
  ```typescript
  if (this.spentStackIds.has(stack.stackId)) {
    classes.push('spent');
  }
  ```
- Only applies to active side's own stacks (battle-screen already filters this)
- Only after animation completes (battle-screen already handles this)

### 9. `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`
- Add `.stack.spent` style:
  - Remove border (`border-color: transparent`)
  - Remove box-shadow
  - Darken background (`rgba(0, 0, 0, 0.5)`)
  - Reduce opacity to 50%
  - **No `pointer-events: none`** (enemy targets must remain clickable)

---

## Validation Steps
1. Start a battle, verify AP shows 50/50 initially
2. Move a ship, verify bar decreases and text updates
3. Attack, verify bar decreases
4. When AP reaches 0 or no valid moves, verify End Turn button pulses
5. End turn, verify AP refills to 50 and pulse stops
6. Verify AI turns still work correctly
7. **Ship that moved once but still has move range AND AP → NOT spent**
8. **Ship that attacked but can still move → NOT spent**
9. **Ship that moved max range AND attacked → spent (dimmed, no border)**
10. **Immobile ship that attacked → spent**
11. **Enemy ships never show spent visual** (remain clickable as targets)
12. **Ship with no AP left → spent**
13. **AP costs increased by 50%**: tier 1 = 2 AP/cell, 2 AP/attack; tier 5 = 8 AP/cell, 8 AP/attack
14. **battleMoveRange reduced to 60%** (rounded up)
15. **ALL active side ships show spent correctly** - not just selected ship
16. **Spent updates immediately after each action** (move, attack, end turn)

---

## Risks / Edge Cases
- AI turns: ensure `apPerTurn` change doesn't break AI logic (AI uses `state.ap` directly)
- Ship stats: `moveApPerCell` and `attackAp` values from ship stats should still work with 50 AP pool
- Grid width: battle grid is 18 cols × 4vw = 72vw, bar should match this width
- Pulse condition: must not pulse during enemy turn or animations
- "Spent" logic: must correctly handle immobile ships, ships with 0 move range, AP constraints, blocked movement
- Performance: `spentStackIds` recomputes on every change detection (acceptable for small number of stacks)
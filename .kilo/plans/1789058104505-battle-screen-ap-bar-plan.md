# Battle Screen AP Bar & End Turn Pulse Plan

## Goal
Update the battle screen's action point system:
1. Increase AP per turn from 10 to 50
2. Replace text "AP: X/10" with a grid-width progress bar showing fill and current value
3. Make End Turn button pulse when AP is depleted OR no movable ships remain

---

## Files to Modify

### 1. `src/app/components/battle-screen/battle/battle.types.ts`
- Change `AP_PER_TURN` constant from `10` to `50` (line 25)

### 2. `src/app/components/battle-screen/battle/battle-state.ts`
- Update initial state: `ap: 50`, `apPerTurn: 50` (lines 50-51)

### 3. `src/app/components/battle-screen/battle-screen.component.ts`
- Add new getter `shouldPulseEndTurn()` that returns true when:
  - `state.ap <= 0` (or very low threshold, e.g., `< 5`)
  - OR no player-controlled stacks have valid actions remaining
- Valid action check: stack on active side, not destroyed, not immobile, and either:
  - `cellsMovedThisTurn < moveRange` AND `state.ap >= stack.moveApPerCell` (can move at least 1 cell)
  - OR `!attackedThisTurn` AND `state.ap >= stack.attackAp` (can attack)

### 4. `src/app/components/battle-screen/battle-screen.component.html`
- Replace line 18 `<div class="battle-screen__ap">AP: {{ state.ap }} / {{ state.apPerTurn }}</div>` with a progress bar:
  ```html
  <div class="battle-screen__ap-bar" [style.width.vw]="72">
    <div class="battle-screen__ap-fill" [style.width.%]="(state.ap / state.apPerTurn) * 100"></div>
    <span class="battle-screen__ap-text">AP: {{ state.ap }} / {{ state.apPerTurn }}</span>
  </div>
  ```
- Add `[class.pulse]="shouldPulseEndTurn()"` to the End Turn button (line 38-39)

### 5. `src/app/components/battle-screen/battle-screen.component.scss`
- Add styles for `.battle-screen__ap-bar` (grid-width: 72vw, height ~8-10px, background, border-radius)
- Add styles for `.battle-screen__ap-fill` (height 100%, transition, green color)
- Add styles for `.battle-screen__ap-text` (position absolute, centered, white text with shadow)
- Add `.pulse` animation for `.end-turn-btn` (keyframes: box-shadow pulse, ~1.5s infinite)

---

## Validation Steps
1. Start a battle, verify AP shows 50/50 initially
2. Move a ship, verify bar decreases and text updates
3. Attack, verify bar decreases
4. When AP reaches 0 or no valid moves, verify End Turn button pulses
5. End turn, verify AP refills to 50 and pulse stops
6. Verify AI turns still work correctly

---

## Risks / Edge Cases
- AI turns: ensure `apPerTurn` change doesn't break AI logic (AI uses `state.ap` directly)
- Ship stats: `moveApPerCell` and `attackAp` values from ship stats should still work with 50 AP pool
- Grid width: battle grid is 18 cols × 4vw = 72vw, bar should match this width
- Pulse condition: must not pulse during enemy turn or animations
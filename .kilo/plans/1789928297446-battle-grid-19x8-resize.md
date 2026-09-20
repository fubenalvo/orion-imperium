# Battle Grid Resize: 19×8 (same total size 72vw × 28vw)

## Goal
Change battle grid from 18×7 to 19×8 while keeping total container size identical (72vw × 28vw). Cells become rectangular: **~3.789vw wide × 3.5vw tall**.

---

## Affected Files & Changes

### 1. `src/app/components/battle-screen/battle/battle.types.ts`
- `BATTLE_GRID_COLUMNS = 19` (was 18)
- `BATTLE_GRID_ROWS = 8` (was 7)
- Replace `BATTLE_CELL_SIZE_VW = 4` with two constants:
  - `BATTLE_CELL_WIDTH_VW = 72 / 19` ≈ 3.7894736842105263
  - `BATTLE_CELL_HEIGHT_VW = 28 / 8` = 3.5
- Export both new constants

### 2. `src/app/components/battle-screen/battle/battle-grid.ts`
All coordinate math that uses `BATTLE_CELL_SIZE_VW` for **both** x and y must use width/height separately:

- `cellToVw()` → x uses width, y uses height
- `stackCenterVw()` → x uses width, y uses height
- `vwToStackCell()` → x divides by width, y divides by height
- `isAbsolutePositionInRange()` / `isAbsoluteInRange()` → rangeVw becomes elliptical? **Decision needed**: keep circular range (use min dimension) or elliptical? Recommendation: **circular using min(cellWidth, cellHeight) = 3.5vw** for consistency with "range in cells" concept.
- `updateStackPositions()` — no change (uses x/y directly)
- `getReachableCells()` / `getMoveToAttackCells()` — loops use new column/row bounds (already use constants)
- `occupiedCols()` — no change

### 3. `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`
- `cellVw()` → x uses width, y uses height
- `onGridClickHandler()` → col = floor(vwX / width) + 1, row = floor(vwY / height) + 1

### 4. `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`
- `.battle-grid` width: 72vw, height: 28vw (unchanged)
- `background-size: <width>vw <height>vw` → `background-size: calc(72vw/19) calc(28vw/8)` or use CSS vars
- `.move-cell` width/height → match new cell size minus padding
- `.stack-cell` width/height → match new cell size
- `.stack-cell--size-1/2/3` widths → recalculate: 1×cellW, 2×cellW - gap, 3×cellW - 2×gap (gap ≈ 0.2vw)
- `.impact` / `.impact--explosion` width/height → scale to new cell size

### 5. `src/app/components/battle-screen/battle-screen.component.scss`
- `.battle-screen__planet-shield` width: 72vw (unchanged, matches grid width)

### 6. `src/app/components/battle-screen/battle-planet/battle-planet.component.scss`
- `:host` left: `72vw - (cellWidth/2)` = 72 - 1.8947 ≈ **70.105vw** (was 70vw)
- `:host` top: `(28vw / 2)` = **14vw** (unchanged, grid vertically centered)

### 7. `src/app/components/battle-screen/battle/battle-movement.service.ts`
- `stackCenterVw()` calculation (line 191-192) → use width for x, height for y

### 8. `src/app/components/battle-screen/battle/battle-state.ts`
- Deployment column constants `ATTACKER_DEPLOY_COLS` / `DEFENDER_DEPLOY_COLS` in battle.types.ts need review: currently `[1,2,3,4]` and `[18,17,16,15]`. With 19 columns, defender should deploy at `[19,18,17,16]`. Update in battle.types.ts.

### 9. `src/app/components/battle-screen/battle/battle-grid.spec.ts`
- Update expectations: `BATTLE_GRID_COLUMNS = 19`, `BATTLE_GRID_ROWS = 8`
- Any tests checking cellToVw, vwToStackCell, stackCenterVw positions need updated expected values

### 10. `src/app/components/battle-screen/battle-screen.component.ts`
- `moveCells` getter loops use `BATTLE_GRID_COLUMNS` / `BATTLE_GRID_ROWS` (already imported) — no code change needed, just uses new constants

---

## Key Design Decisions

| Decision | Recommendation |
|----------|----------------|
| **Range shape** | Circular using `min(cellWidth, cellHeight) = 3.5vw` per cell. A "range 3" weapon reaches 10.5vw in any direction. Keeps "cells" as the mental model. |
| **Cell size precision** | Use exact fractions in TS: `72/19` and `28/8`. In SCSS use `calc(72vw/19)` and `calc(28vw/8)` or CSS custom properties. |
| **Stack visual width** | Stack spans N cells horizontally. Width = N × cellWidth - (N-1) × gap. Recompute `--stack-scale` if needed. |
| **Planet position** | Keep planet vertically centered (14vw). Horizontal: right edge of grid minus half cell width. |

---

## Validation Plan
1. Run `npm test -- --filter=battle-grid` — all unit tests pass
2. Run `npm test -- --filter=battle-screen` — integration tests pass
3. Manual: start battle, verify grid renders 19×8, clicks map to correct cells, movement/attack ranges feel correct
4. Verify planet marker aligns with defender column (col 19)

---

## Open Questions
1. **Range shape**: Circular (min dimension) or elliptical (separate X/Y range)? → Recommend circular
2. **CSS approach**: CSS custom properties (`--cell-w`, `--cell-h`) or `calc()` in each rule? → Custom properties cleaner
3. **Stack visual scaling**: Keep current `--stack-scale` logic or adjust for rectangular cells? → Keep, just width changes
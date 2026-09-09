# Battle Grid Cell Size Fix Plan

## Goal
Reduce battle grid cell size from 5vw to 2.5vw so the 18×7 tactical grid fits within viewport without horizontal overflow.

## Files to Modify

### 1. `src/app/components/battle-screen/battle/battle.types.ts`
- Change `BATTLE_CELL_SIZE_VW` from `5` to `2.5`

### 2. `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`
Scale all vw-based dimensions by 0.5:
- `.battle-grid` — width: 45vw, height: 17.5vw, `background-size: 2.5vw 2.5vw`
- `.move-cell` — width/height: 2vw
- `.stack-cell` — width/height: 2.3vw
- `.impact` — width/height: 1.5vw
- `.projectile` — height: keep 3px (not vw-based)

## Validation Steps
1. Run `npx ng test --include="src/app/components/battle-screen/**/*.spec.ts"` — all 63 tests pass
2. Manual verify: grid fits on 1366px+ screens, no horizontal scrollbar
3. Verify click handlers work (coordinate conversion uses `BATTLE_CELL_SIZE_VW` constant)

## Notes
- Coordinate math in `battle-grid.component.ts:117-118` already uses the constant, so click detection auto-adjusts
- Fleet panel widths unchanged — they flex alongside the grid
- Animation durations (ms) unchanged — only visual scale changes
# Star Map Grid Coordinate Refactor Plan

## Problem

The star map currently uses **vw (viewport width) units** as world coordinates for star systems and fleets. The `map.width` (200) and `map.height` (120) in `star-map-data.json` represent vw extents, not grid dimensions. Each grid cell is `cellSizeVw` vw wide (2 on desktop, 7 on mobile), so the actual grid is 100×60 cells (desktop) or 29×18 cells (mobile). This causes confusion: Altair at world vw (105, 75) appears at CSS grid cell (16, 11) on mobile — not obviously related to its data coordinates.

## Goal

Change the data model so that `map.width`/`map.height` are **grid columns/rows**, and star system / fleet `x`/`y` are **1-indexed grid cell coordinates**. The `cellSizeVw`/`cellSizeVh` become purely a rendering concern (vw size per cell).

## Design Decisions

### D1: 1-indexed grid cells (CSS grid native)
- Cell 1 covers vw [0, cellSize), cell 2 covers [cellSize, 2*cellSize), etc.
- Star system x/y are 1-indexed integers (can be used directly in CSS `gridColumn`/`gridRow`).
- Fleet x/y are 1-indexed floats (for sub-cell smooth movement).
- **vw position of a grid cell**: `(gridCell - 0.5) * cellSizeVw`

### D2: Grid dimensions fixed in data, cellSize dynamic
- `map.width = 100` (grid columns), `map.height = 60` (grid rows) — fixed, viewport-independent.
- `cellSizeVw = 2` (desktop), `cellSizeVh = 7` (mobile) — rendering concern, changes on resize.
- On mobile, grid is physically larger (700vw × 420vw); camera clamping and proportional scaling handle visibility.
- `gridColumns = mapWidth` directly (not `ceil(mapWidth / cellSizeVw)`).

### D3: Fleet speed stays in vw/s, converted in movement math
- `fleet.speed` (e.g., 8) remains in vw/s.
- Movement step in cells: `(fleet.speed / cellSizeVw) * deltaTime`.
- Ensures visual speed is constant regardless of cellSize.

### D4: Camera stays in vw, scaled proportionally on resize
- `cameraX`/`cameraY` remain in vw for CSS transform.
- On resize: `cameraX *= newCellSize / oldCellSize` to preserve relative grid position.

### D5: System view (inside star systems) is OUT OF SCOPE
- `fleet.systemX/Y` stay in vw coordinates (system view grid is 20×12, 5vw cells, separate from map grid).
- System view template uses `left/top` with vw — unchanged.
- New `calculateSystemGridCell(vwX, vwY)` function added for system view collision detection (fixes pre-existing bug where map cellSize was used for system grid).

### D6: Grid cell vs vw for fleet rendering
- **Before**: `[style.left]="fleet.x + 'vw'"` (fleet.x is vw)
- **After**: `[style.left]="((fleet.x - 0.5) * cellSizeVw) + 'vw'"` (fleet.x is 1-indexed grid cell)

### D7: Star system rendering simplified
- **Before**: `[style.gridColumn]="movementService.calculateGridCell(system.x, system.y).col"`
- **After**: `[style.gridColumn]="movementService.calculateGridCell(system.x, system.y).col"` (still works — `calculateGridCell` now floors the already-grid-cell value)

### D8: Save game backward compatibility
- Old saves have `map.width = 200` (vw). New saves have `map.width = 100` (grid cells).
- Migration: in `loadGame()` / `initializeCoordinates()`, detect legacy format (width > 100) and convert vw → grid cells using the saved `cellSizeVw`.

## Coordinate Conversion Reference

Conversion formula: `gridCell = floor(vw / cellSizeVw) + 1` using cellSize = 2 (base/desktop value).

Reverse: `vw = (gridCell - 0.5) * cellSizeVw`.

### Star Systems (vw → grid cell)

| System     | Old (vw)   | New (grid cell) | Verification (reverse) |
|------------|------------|-----------------|------------------------|
| SOL        | 35, 25     | 18, 13          | (17.5*2, 12.5*2) = (35, 25) ✓ |
| VEGA       | 78, 18     | 40, 10          | (39.5*2, 9.5*2) = (79, 19) ⚠️ |
| SIRIUS     | 125, 35    | 63, 18          | (62.5*2, 17.5*2) = (125, 35) ✓ |
| ARCTURUS   | 165, 22    | 83, 12          | (82.5*2, 11.5*2) = (165, 23) ⚠️ |
| RIGEL      | 55, 65     | 28, 33          | (27.5*2, 32.5*2) = (55, 65) ✓ |
| ALTAIR     | 105, 75    | 53, 38          | (52.5*2, 37.5*2) = (105, 75) ✓ |
| BETELGEUSE | 155, 68    | 78, 35          | (77.5*2, 34.5*2) = (155, 69) ⚠️ |
| PROCYON    | 25, 95     | 13, 48          | (12.5*2, 47.5*2) = (25, 95) ✓ |
| DENEB      | 90, 105    | 46, 53          | (45.5*2, 52.5*2) = (91, 105) ⚠️ |
| ANTARES    | 175, 100   | 88, 51          | (87.5*2, 50.5*2) = (175, 101) ⚠️ |

Note: ⚠️ entries have ±1vw difference because odd vw values don't land exactly on cell centers. This is expected — grid cells are discrete and the star will snap to the cell center. The position is within the correct cell.

### Fleets (vw → grid cell)

| Fleet    | Old (vw)  | Old grid cell | New (grid cell) | Speed (vw/s) |
|----------|-----------|---------------|-----------------|--------------|
| ORION    | 11, 9     | 6, 5          | 6, 5            | 8            |
| PEGASUS  | 25, 13    | 13, 7         | 13, 7           | 6            |
| RAIDER   | 17, 11    | 9, 6          | 9, 6            | 7            |
| HUNTER   | 29, 15    | 15, 8         | 15, 8           | 9            |

Fleets currently have no `targetX`/`targetY` set (all null). Conversion is straightforward.

## Files to Change

### 1. `src/app/components/star-map/star-map-data.json`
- `map.width`: 200 → 100
- `map.height`: 120 → 60
- `map.cellSizeVw`/`cellSizeVh`: keep as 2 (base value, overridden by onResize)
- Star system `x`/`y`: convert all 10 systems (table above)
- Fleet `x`/`y`: convert all 4 fleets (table above)
- Fleet `targetX`/`targetY`: unchanged (null)
- Fleet `speed`: unchanged (vw/s)
- Fleet `gridCol`/`gridRow`: remove (redundant with floor(x/y))
- Star system `gridCol`/`gridRow`: remove (redundant with x/y)

### 2. `src/app/components/star-map/star-map-movement.service.ts`
- **`initialize()`**: Change `gridColumns = mapWidth` (direct assignment, not `ceil(mapWidth / cellSizeVw)`). Same for `gridRows`.
- **`calculateGridCell(x, y)`**: Change to accept 1-indexed grid cell coordinates. Return `{ col: Math.floor(x), row: Math.floor(y) }`. No division by cellSize.
- **`getTileCenter(vwX, vwY)`**: Change to convert vw → 1-indexed grid cell. Return `{ x: Math.floor(vwX / cellSizeVw) + 1, y: Math.floor(vwY / cellSizeVh) + 1 }`. Target is the grid cell center (which equals the cell number in 1-indexed space).
- **`getCellCenterVw(gridCol, gridRow)`**: New method. Convert 1-indexed grid cell → vw: `{ x: (gridCol - 0.5) * cellSizeVw, y: (gridRow - 0.5) * cellSizeVh }`. Used by template for fleet positioning OR inline in template.
- **`updateFleets()`**: Fleet movement math uses grid cell space. Convert speed: `movement = (fleet.speed / this.cellSizeVw) * deltaTime`. Distance, dx, dy all in grid cells. Threshold `distance <= 0.01` stays (now in cells). `calculateGridCell(fleet.x, fleet.y)` still works (floors the float position).
- **`refreshGridPositions()`**: `gridCol = Math.floor(fleet.x)`, `gridRow = Math.floor(fleet.y)`. Same for systems.
- **`initializeCoordinates()`**: Update for migration from legacy vw format. Detect `fleet.x > gridColumns` (vw value stored in grid cell space) and convert: `fleet.x = floor(fleet.x / cellSizeVw) + 1`.
- **`getObjectsAtMapCell()`**: No changes needed — still uses `fleet.gridCol === col && fleet.gridRow === row`.
- **`getObjectsAtSystemCell()`**: Change `calculateGridCell(fleet.systemX, fleet.systemY)` → `calculateSystemGridCell(fleet.systemX, fleet.systemY)`.
- **`calculateSystemGridCell(vwX, vwY)`**: New method. `col = floor(vwX / SYSTEM_CELL_SIZE) + 1`, `row = floor(vwY / SYSTEM_CELL_SIZE) + 1`. Where `SYSTEM_CELL_SIZE = 5`.
- **`isFleetInSystem()`**: No changes — uses `calculateGridCell` with map grid cells (which now just floors).

### 3. `src/app/components/star-map/star-map.ts`
- **`mapWidth`/`mapHeight`**: Still read from data, but now represent grid dimensions (100/60).
- **`cellSizeVw`/`cellSizeVh`**: Still set from data (2), overridden on resize (2/7).
- **`onResize()`**: 
  - `this.cellSizeVw = isWide ? 2 : 7` (same)
  - `movementService.initialize(...)` — now gridColumns = mapWidth (100), not computed from vw
  - Scale camera: `cameraX *= cellSizeVw / oldCellSize`, same for Y
  - Call `clampCamera()` (unchanged logic)
- **`selectFleet()`** (line 467): `cameraX = (fleet.x - 0.5) * this.cellSizeVw - 50` (convert grid cell to vw, then center on fleet)
- **`saveGame()`**: Store `map.width`/`height` as grid dimensions (100/60). Store fleet x/y as grid cells. No changes needed since x/y are already grid cells.
- **`loadGame()`**: `initializeCoordinates` handles migration.
- **`moveSelectedFleet()`**: No changes — targetX/Y are now grid cells, set directly.
- **`onMapClick()`** (line 764): `getTileCenter(worldX, worldY)` now returns grid cells. `moveSelectedFleet(targetTile.x, targetTile.y)` — targetTile is grid cells. ✓
- **`selectSystem()`** (line 539): Remove `getTileCenter` call — system.x/y are already grid cells. `moveSelectedFleet(system.x, system.y)`.
- **`enterSystem()`** (line 228): Change `calculateGridCell(fleet.systemX!, fleet.systemY!)` → `calculateSystemGridCell(fleet.systemX!, fleet.systemY!)`. Don't set `fleet.gridCol` from system coordinates (keep map grid cell).
- **`leaveSystem()`** (line 255): `calculateGridCell(fleet.x, fleet.y)` still works (floors grid cell).
- **`onFleetClick()`** (line 616): `calculateGridCell(fleet.x, fleet.y)` still works. (System view part at line 625: use `calculateSystemGridCell`).
- **`onSystemClick()`** (line 656): `calculateGridCell(system.x, system.y)` still works.
- **`onPlanetClick()`** (line 686): Uses `getPlanetGridPosition` — system view, unchanged.
- **`updateExploredPlanets()`**: Uses `calculateGridCell` from movementService — works with grid cells. Also uses `getPlanetGridPosition` — unchanged.
- **`clampCamera()`** (line 829): Uses `gridColumns * cellSizeVw` — works with new gridColumns (= 100).

### 4. `src/app/components/star-map/star-map.html`
- **Star systems** (line 44-45): Keep `calculateGridCell(system.x, system.y).col` — now just floors. Or simplify to `system.x` directly. Recommendation: simplify to `system.x`/`system.y`.
- **Fleets** (line 65-66): Change `fleet.x + 'vw'` → `((fleet.x - 0.5) * cellSizeVw) + 'vw'` and `fleet.y + 'vw'` → `((fleet.y - 0.5) * cellSizeVh) + 'vw'`.
- **Ship target** (line 92-93): Keep `calculateGridCell(targetX, targetY).col` — floors the grid cell.
- **System view fleets** (line 197-198): Unchanged — `fleet.systemX + 'vw'`, `fleet.systemY + 'vw'`.
- **System view target** (line 229-230): Unchanged — vw coordinates.

### 5. `src/app/components/star-map/star-map.models.ts`
- **`StarMapData.map`**: Update type to clarify `width`/`height` are grid columns/rows, `cellSizeVw`/`Vh` are rendering cell sizes.
- **`StarSystem`**: Remove `gridCol?`/`gridRow?` (redundant with x/y). Or keep for backward compat. Recommendation: keep in model but don't populate in JSON.
- **`Fleet`**: Remove `gridCol?`/`gridRow?` (redundant with floor(x/y)). Or keep as cached values. Recommendation: keep as cached values, populate from x/y.
- **`Fleet.x`/`y`**: Update comment to "1-indexed grid column/row (floats for smooth movement)".
- **`StarSystem.x`/`y`**: Update comment to "1-indexed grid column/row".

### 6. Documentation files
- **`docs/data-models.md`**: Update Fleet and StarSystem descriptions. Remove "World position in vw units" — replace with "1-indexed grid column/row".
- **`docs/invariants.md`**: Update Grid Coordinate System section. Change `cellSizeVw = 5` (already wrong, actually 2) to `cellSizeVw = 2` base. Update formula: `gridColumns = mapWidth` (direct). Update `calculateGridCell` formula.
- **`docs/game-systems.md`**: Update Movement section (speed in vw/s, converted to cells/s). Update Camera section (camera in vw, scaled on resize).

## Migration Strategy

### New game (no saves)
- Data file is updated with grid cell coordinates. No migration needed.

### Existing saves (localStorage)
- Detect legacy format: `data.map.width === 200` (vw) vs `100` (grid cells).
- Migration in `loadGame()`:
  ```ts
  if (data.map.width === 200) {
    const cellSize = data.map.cellSizeVw;
    // Convert star system vw → grid cells
    for (const sys of data.starSystems) {
      sys.x = Math.floor(sys.x / cellSize) + 1;
      sys.y = Math.floor(sys.y / cellSize) + 1;
    }
    // Convert fleet vw → grid cells
    for (const fleet of data.fleets) {
      fleet.x = Math.floor(fleet.x / cellSize) + 1;
      fleet.y = Math.floor(fleet.y / cellSize) + 1;
      if (fleet.targetX !== null) fleet.targetX = Math.floor(fleet.targetX / cellSize) + 1;
      if (fleet.targetY !== null) fleet.targetY = Math.floor(fleet.targetY / cellSize) + 1;
    }
    // Update map dimensions
    data.map.width = Math.ceil(200 / cellSize);
    data.map.height = Math.ceil(120 / cellSize);
  }
  ```
- **Risk**: If user's viewport was mobile when saving (cellSize=7), the grid dimensions would be 29×18, not 100×60. The migration uses the saved cellSize to compute grid cells. After migration, the grid is 29×18 — different from the new default of 100×60. This is a data inconsistency.
- **Mitigation**: After migration, also update `data.map.width = 100, data.map.height = 60` to match the new fixed grid. Recompute coordinates: `cell = floor(vw / cellSize) + 1` already gives the correct grid cell for the 100×60 grid (since the grid is the same set of cells, just with different cellSize interpretation).

Wait, this is tricky. If the save was made on mobile (cellSize=7), the fleet vw positions were in a 700vw grid (29 cells × 7vw = 203vw, no — 203vw). Hmm, actually in the current system:
- Mobile: gridColumns = ceil(200/7) = 29, cellSize=7. Grid is 203vw.
- Desktop: gridColumns = ceil(200/2) = 100, cellSize=2. Grid is 200vw.

If a fleet is at vw position 11 on desktop, grid cell = floor(11/2)+1 = 6. On mobile, the same vw position 11 would be grid cell = floor(11/7)+1 = 2.

So the grid cell is different depending on cellSize! A fleet at vw 11 is in cell 6 on desktop but cell 2 on mobile.

If we migrate a mobile save (cellSize=7) to the new system (fixed 100×60 grid), the conversion would be: `gridCell = floor(vw / 7) + 1`. This gives cell 2 for vw 11. But on desktop, cell 2 covers vw [2, 4), not [11, 13). So the fleet would be at a different grid cell.

This is a fundamental issue with the migration. The grid cells are different sizes on different viewports. A vw position maps to different grid cells depending on cellSize.

**Proposed solution**: Always convert legacy saves using cellSize=2 (desktop/base), regardless of what cellSize was used when the save was created. This is approximate but consistent:
- If the save was made on desktop (cellSize=2), conversion is exact.
- If the save was made on mobile (cellSize=7), the conversion is approximate — the fleet might end up in a nearby but not exact grid cell.

Actually wait — the vw positions in the save are the same regardless of viewport. The fleet at vw 11 is at vw 11 whether saved on desktop or mobile. We just need to convert vw → grid cell. Using cellSize=2: `floor(11/2)+1 = 6`. Using cellSize=7: `floor(11/7)+1 = 2`. The "correct" grid cell depends on what grid we're converting to.

In the new system, the grid is always 100×60 with cellSize=2 as the reference. So we should always convert using cellSize=2:
- `gridCell = floor(vw / 2) + 1`

This gives the correct grid cell for the 100×60 grid. The fact that on mobile the grid is rendered with 7vw cells doesn't change the grid cell — the grid is 100×60 regardless.

So the migration should use `data.map.cellSizeVw` only as a hint (to detect if it's a legacy save), and always convert using cellSize=2 for the new fixed grid. Actually, we should use the saved cellSize to convert, because that's the cellSize that was used when the save was created. If the save was created on desktop (cellSize=2), we convert using 2. If on mobile (cellSize=7), we convert using 7.

But then the grid cells would be different for mobile-saved games. A fleet at vw 11 saved on mobile would be grid cell 2, while the same fleet saved on desktop would be grid cell 6. When loaded on desktop in the new system (100×60 grid, cellSize=2), grid cell 2 covers vw [2, 4) — the fleet would appear at vw 3. But the fleet was at vw 11 in the old system. This is wrong!

The problem is: the grid cells don't correspond between the old mobile system (29×18 with 7vw cells) and the new system (100×60 with 2vw cells as reference). A vw position maps to different grid cells in the two systems.

The correct migration is: convert vw → grid cell using the REFERENCE cellSize (2), not the saved cellSize. This way:
- Fleet at vw 11 → grid cell floor(11/2)+1 = 6
- In new system (100×60, cellSize=2): grid cell 6 covers vw [10, 12), center vw 11 ✓

This is correct regardless of what viewport the save was made on, because we're using the reference cellSize (2) for conversion. The saved cellSize (2 or 7) is irrelevant — it was just for rendering.

So the migration should be:
```ts
if (data.map.width === 200) {  // legacy: vw dimensions
  const refCellSize = 2;  // reference cell size for conversion
  for (const sys of data.starSystems) {
    sys.x = Math.floor(sys.x / refCellSize) + 1;
    sys.y = Math.floor(sys.y / refCellSize) + 1;
  }
  for (const fleet of data.fleets) {
    fleet.x = Math.floor(fleet.x / refCellSize) + 1;
    fleet.y = Math.floor(fleet.y / refCellSize) + 1;
    if (fleet.targetX !== null) fleet.targetX = Math.floor(fleet.targetX / refCellSize) + 1;
    if (fleet.targetY !== null) fleet.targetY = Math.floor(fleet.targetY / refCellSize) + 1;
  }
  data.map.width = 100;  // ceil(200/2)
  data.map.height = 60;  // ceil(120/2)
}
```

This is consistent and correct. The reference cellSize is always 2 (the desktop base).

Actually wait, there's still an issue. If a mobile save was made, the grid columns were 29 (not 100). The vw positions were in a 203vw grid. The fleet at vw 11 in the old mobile system — what vw position would it be in the new system?

In the old mobile system: 29 columns × 7vw = 203vw. Fleet at vw 11 is at 11/203 = 5.4% across.
In the new system: 100 columns × 2vw = 200vw. 5.4% across = vw 10.8. Grid cell = floor(10.8/2)+1 = 6.4 → cell 6.

So the fleet would be at grid cell 6, which corresponds to vw 11. This is correct!

But what about a fleet at the right edge of the old mobile grid? vw 200 in the old system. In the new system: floor(200/2)+1 = 101. But the grid only has 100 columns. Grid cell 101 is out of bounds!

Hmm, this is because the old mobile grid had 29 columns × 7vw = 203vw, but positions could go up to 200vw (the map width). In the new system, the grid has 100 columns × 2vw = 200vw. So vw 200 maps to cell 101, which is out of bounds.

But looking at the star system data, the max vw is ANTARES at 175, which maps to cell 88. And the max fleet vw is HUNTER at 29, which maps to cell 15. So no positions exceed the grid bounds. The migration should be safe for the current data.

But in general, for future saves, if a fleet moves to vw 199 on mobile, it would be cell floor(199/2)+1 = 100.5 → 100. That's within bounds (100 columns). If it's at vw 200, cell 101 is out of bounds. But the clampCamera prevents going past the grid, so positions should stay within [0, 200]. The maximum valid cell is 100 (vw 198-200). floor(199/2)+1 = 100. ✓

Actually, the camera clamps so that cameraX can go from 0 to gridWidthVw - viewportWidthVw. The gridWidthVw = gridColumns × cellSizeVw. On mobile (old system): 29 × 7 = 203vw. So camera can go to 203-100 = 103vw. A fleet at the far right of the viewport would be at vw 103+100 = 203. So fleet positions can go up to ~203vw.

floor(203/2)+1 = 102. That's out of bounds for a 100-column grid.

This is a migration edge case. For the current data, all positions are within bounds. For future saves, there might be issues. But since the user is asking about the current data, this should be fine.

Actually, let me reconsider. In the new system, the grid is 100×60 with cellSize=2 on desktop. The grid in vw is 200×120. On mobile, cellSize=7, grid is 700×420vw. Fleets are positioned in grid cell space, and the vw position is `(cell - 0.5) * cellSize`. A fleet at cell 100 on mobile: vw = (100-0.5)*7 = 696.5vw. The camera would need to pan to see it. The camera clamps to [0, 700-100] = [0, 600] for vw.

So in the new system, a fleet at the rightmost grid cell (100) would be at vw 696.5 on mobile, which is within the grid (700vw). The camera can pan to see it. ✓

For migration, if an old mobile save has a fleet at vw 203, the new grid cell would be floor(203/2)+1 = 102. But the new grid only has 100 columns. The fleet would be out of bounds.

To handle this, we could clamp: `fleet.x = Math.min(Math.floor(fleet.x / 2) + 1, 100)`. Or we could use a larger reference grid. But for the current data, this isn't an issue.

I'll note this as a minor migration risk in the plan.

### Migration summary:
- Detect legacy saves by `data.map.width === 200`
- Convert vw → grid cells using reference cellSize = 2
- Update map dimensions to 100×60
- Clamp grid cells to valid range to handle edge cases

## Risks and Edge Cases

### R1: Fleet speed changes on viewport resize
- Speed is in vw/s, converted to cells/s using `cellSizeVw`.
- On desktop (cellSize=2): speed 8 vw/s = 4 cells/s
- On mobile (cellSize=7): speed 8 vw/s = 1.14 cells/s
- Visual speed is constant (8 vw/s), but the grid is larger on mobile (700vw vs 200vw)
- **Impact**: Fleets take longer to cross the grid on mobile. Acceptable — grid is physically larger.

### R2: Camera jump on resize
- Camera is in vw, scaled proportionally on resize.
- `cameraX *= newCellSize / oldCellSize` preserves relative position.
- **Risk**: Floating point errors could accumulate. Mitigation: clamp after scaling.

### R3: Mobile grid much larger (700vw vs 203vw)
- New grid on mobile: 100×60 cells × 7vw = 700vw × 420vw
- Old grid on mobile: 29×18 cells × 7vw = 203vw × 126vw
- New system shows ~1/3 of the grid on mobile
- **Impact**: Player sees less of the map on mobile, needs more panning
- **Mitigation**: Could add a "fit to screen" zoom option, or reduce gridColumns on mobile
- **Decision**: Accept for now — correctness of coordinate system is the priority

### R4: Legacy save migration edge cases
- As described above, some vw positions might map to out-of-bounds grid cells
- **Mitigation**: Clamp to valid grid range during migration

### R5: System view coordinate inconsistency
- System view uses its own grid (20×12, 5vw cells), fleet systemX/Y in vw
- `calculateGridCell` was incorrectly used with system vw coordinates (pre-existing bug)
- New `calculateSystemGridCell` fixes this
- **Impact**: System view collision detection becomes more accurate

### R6: Star system rendering in template
- Can simplify `gridColumn="system.x"` (direct) since system.x is already 1-indexed
- Or keep `calculateGridCell` for consistency (it just floors integers)
- **Decision**: Simplify to direct binding for clarity

### R7: Fleet `gridCol`/`gridRow` redundancy
- With fleet.x/y as grid cells, `gridCol = floor(fleet.x)` is redundant
- But `gridCol`/`gridRow` are used in `getObjectsAtMapCell` and `data-grid-position` debug attribute
- **Decision**: Keep as cached values, updated in `updateFleets` and `refreshGridPositions`

## Validation Steps

1. **Lint/typecheck**: `npm run lint` and `tsc --noEmit` (or project's typecheck command)
2. **Visual verification**:
   - Star systems appear at correct visual positions (Altair at ~105vw on desktop)
   - Fleets render at correct positions
   - Grid lines align with cells
3. **Coordinate verification**:
   - Fleet at grid cell 6 renders at vw (6-0.5)*2 = 11vw ✓
   - Star system at grid cell 53 renders at CSS grid column 53 ✓
4. **Movement**:
   - Select fleet, click on map, fleet moves to correct grid cell
   - Fleet speed visually consistent (vw/s)
5. **Resize**:
   - Resize viewport, camera scales proportionally
   - Fleet positions update correctly (same grid cell, new vw position)
6. **Save/load**:
   - New save/load preserves grid cell positions
   - Legacy save migrates correctly (if any exist)
7. **Collision detection**:
   - Two fleets in same cell trigger battle
   - Fleet entering system grid cell detected correctly
8. **System view**:
   - Enter system, fleet positions in system view unchanged
   - Planet collision detection uses correct system grid cells

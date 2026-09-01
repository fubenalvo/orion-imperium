# Invariants and Assumptions

## Grid Coordinate System

- `map.width` and `map.height` define the grid dimensions in cells (100 columns × 60 rows).
- `cellSizeVw = 2` (desktop) and `cellSizeVh = 7` (mobile) define the vw size per cell; these are rendering concerns.
- Grid columns = `map.width` (direct), rows = `map.height` (direct).
- Star systems and fleets use **1-indexed grid cell coordinates** for x/y (e.g., x=53 means column 53).
- `calculateGridCell(x, y)` snaps 1-indexed grid cell coordinates to integer cells: `col = floor(x)`, `row = floor(y)`.
- `getTileCenter(vwX, vwY)` converts vw coordinates to 1-indexed grid cells: `col = floor(vwX / cellSizeVw) + 1`.
- vw position of a grid cell: `(gridCell - 0.5) * cellSizeVw`.
- The system view uses a separate fixed 20×12 grid with 5vw cells. Fleet `systemX`/`systemY` remain in vw units.
- `calculateSystemGridCell(vwX, vwY)` converts system view vw to grid cells using 5vw cell size.

## Fleet Position Invariants

- `fleet.gridCol` and `fleet.gridRow` must always reflect `Math.floor(fleet.x)` and `Math.floor(fleet.y)`.
- When `fleet.destroyed = true`, the fleet is excluded from all active fleet operations (movement, battle detection, rendering via `visibleFleets`).
- A destroyed fleet's `gridCol`/`gridRow` are not updated during the game loop.

## View State Transitions

- When entering a system (`enterSystem()`):
  - Fleets inside the system get `systemId` assigned.
  - If `systemX`/`systemY` are null, they default to (2.5, 32.5) vw in the system grid.
  - `gridCol`/`gridRow` are recalculated using `calculateSystemGridCell` for system view collision.
- When leaving a system (`leaveSystem()`):
  - All fleets with `systemId` get their `gridCol`/`gridRow` recalculated from map grid cell coordinates via `calculateGridCell(floor(x), floor(y))`.
  - `systemId`, `systemX`, `systemY`, and targets are cleared.

## Save/Load Invariants

- `saveGame()` only writes if `saveGameService.currentSlot` is not null.
- `loadGame()` restores all mutable state but does NOT reset `factions`, `starSystems`, or `fleets` arrays if loading fails (early return).
- After loading, `refreshGridPositions()` is called to recalculate all grid cells from x/y.
- Legacy saves (map.width === 200) are migrated in `loadGame()`: vw coordinates are converted to grid cells using the reference cell size of 2vw.
- `destroyedFleetId` is stored separately from the fleet data to survive save/load cycles.

## Pause/Resume Guarantees

- `pauseGame()` cancels the animation frame and sets `isPaused = true`.
- `resumeGame()` sets `isPaused = false` and restarts the loop.
- The game loop always runs outside Angular zone; change detection is only triggered when fleets move.
- Window blur and visibility change events pause the game, but do NOT close the pause menu overlay (only the internal `isPaused` flag).

## Battle State Machine

1. StarMap detects collision → `BattleService.setBattle()` → navigate to `/battle`.
2. BattleScreen resolves battle immediately in `ngOnInit()`.
3. User clicks "Back to Star Map" → loser marked destroyed → `destroyedFleetId` stored → navigate back.
4. StarMap `ngOnInit` detects `destroyedFleetId` → marks fleet as destroyed → clears battle service state.

## Selection Mutual Exclusion

- Selecting a fleet deselects the current system and planet tile (in map view).
- Selecting a system deselects the current fleet and planet tile.
- Selecting a planet tile deselects the fleet and system (unless in system view, where system can remain selected).
- `selectedFleetAction` is cleared on any new selection.

## Context Menu Behavior

- Context menu appears only when multiple objects occupy the same grid cell.
- In map view: fleets and star systems can overlap.
- In system view: fleets and planets can overlap.
- Clicking a context menu item selects that object.
- The context menu is closed by any subsequent click or selection action.

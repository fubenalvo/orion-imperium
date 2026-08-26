# Invariants and Assumptions

## Grid Coordinate System

- The world map uses a grid of 5vw x 5vh cells.
- `cellSizeVw = 5`, `cellSizeVh = 5` (defined in `star-map-data.json`).
- Grid columns = `ceil(mapWidth / cellSizeVw)`, rows = `ceil(mapHeight / cellSizeVh)`.
- `calculateGridCell(x, y)` returns 1-indexed grid positions: `col = floor(x / cellSizeVw) + 1`, `row = floor(y / cellSizeVh) + 1`.
- World coordinates (`x`, `y`) are in `vw` units, representing the center of the object.

## Fleet Position Invariants

- `fleet.gridCol` and `fleet.gridRow` must always reflect the current `fleet.x` / `fleet.y` position.
- When `fleet.destroyed = true`, the fleet is excluded from all active fleet operations (movement, battle detection, rendering via `visibleFleets`).
- A destroyed fleet's `gridCol`/`gridRow` are not updated during the game loop.

## View State Transitions

- When entering a system (`enterSystem()`):
  - Fleets inside the system get `systemId` assigned.
  - If `systemX`/`systemY` are null, they default to (2.5, 32.5).
  - `gridCol`/`gridRow` are recalculated based on system coordinates.
- When leaving a system (`leaveSystem()`):
  - All fleets with `systemId` get their grid positions recalculated from map coordinates.
  - `systemId`, `systemX`, `systemY`, and targets are cleared.

## Save/Load Invariants

- `saveGame()` only writes if `saveGameService.currentSlot` is not null.
- `loadGame()` restores all mutable state but does NOT reset `factions`, `starSystems`, or `fleets` arrays if loading fails (early return).
- After loading, `refreshGridPositions()` is called to recalculate all grid positions.
- Fleets loaded with missing `gridCol`/`gridRow` are treated as having grid coordinates equal to their x/y values (legacy format compatibility).
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

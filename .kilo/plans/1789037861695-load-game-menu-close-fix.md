# Load Game Menu Close Fix Plan

## Problem
When the user selects a save slot in the Load Game menu, the game loads correctly but the pause menu overlay remains open. The user must manually click "CONTINUE" to close it.

Previously, selecting a save slot would automatically close the pause menu and resume the game.

## Root Cause
In `src/app/components/star-map/star-map.ts`, the `loadFromMenu()` method (line 544-549) calls `loadGame()` but does not call `closePauseMenu()`.

The `loadGame()` method (line 2103) calls `gameTimeService.reset()` which sets `isPaused = false` (resumes game simulation), but it does not set `pauseMenuOpen = false` (which controls the pause menu overlay visibility).

The `closePauseMenu()` method (line 532-535) properly sets both `pauseMenuOpen = false` and calls `gameTimeService.resume()`.

## Solution
Add a call to `this.closePauseMenu()` at the end of `loadFromMenu()` after `this.loadGame()`.

## Affected Files
- `src/app/components/star-map/star-map.ts` - line 548 (add `this.closePauseMenu();` after `this.loadGame();`)

## Validation
1. Start the game
2. Open pause menu (☰ button or ESC)
3. Click "LOAD GAME"
4. Select a save slot
5. Verify: pause menu closes automatically and game resumes

## Risk Assessment
- Low risk: Single line addition calling an existing method
- The `closePauseMenu()` method is already used by the "CONTINUE" button in the pause menu
- No changes to save/load logic or game state restoration
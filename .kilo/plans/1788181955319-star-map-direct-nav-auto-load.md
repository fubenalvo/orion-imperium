# Plan: Auto-load save on direct `/star-map` navigation

## Goal
When the user opens `/star-map` directly (bypassing `MainMenu`), automatically load the most recent save. If no save exists, redirect to `/` (main menu).

## Current behavior
- `MainMenu.newGame()` / `loadGame()` set `saveGameService.currentSlot` before navigating to `/star-map`.
- `StarMap.ngOnInit()` only calls `loadGame()` when `currentSlot !== null`.
- Direct navigation leaves `currentSlot === null` → fresh default game loads, `saveGame()` is a permanent no-op.

## Proposed changes

### 1. `SaveGameService` — add `getMostRecentSlotIndex()`

**File:** `src/app/services/save-game.service.ts`

Add a new public method:

```ts
getMostRecentSlotIndex(): number | null {
  const slots = this.getSlots();
  let bestIndex: number | null = null;
  let bestDate: string | null = null;
  for (let i = 0; i < slots.length; i++) {
    const date = slots[i].date;
    if (date && (bestDate === null || date > bestDate)) {
      bestDate = date;
      bestIndex = i;
    }
  }
  return bestIndex;
}
```

**Why here:** This service already owns the slot data and localStorage parsing. Keeping the "find most recent" logic here avoids leaking storage details into the component.

### 2. `StarMap.ngOnInit()` — restructure init flow

**File:** `src/app/components/star-map/star-map.ts`

Replace the current `ngOnInit()` with:

```ts
ngOnInit(): void {
  this.onResize();

  // If there is no active slot, attempt to restore the most recent save.
  if (this.saveGameService.currentSlot === null) {
    const slotIndex = this.saveGameService.getMostRecentSlotIndex();
    if (slotIndex !== null) {
      // Auto-load the most recent save without requiring MainMenu navigation.
      this.saveGameService.currentSlot = slotIndex;
    } else {
      // No save data exists — redirect to main menu so the user can start a new game.
      this.router.navigate(['']);
      return;
    }
  }

  // At this point currentSlot is guaranteed to be non-null.
  this.loadGame();
  this.removeDestroyedFleetFromService();
}
```

**What changes:**
- The `if (currentSlot !== null) { loadGame() } else { initializeCoordinates(); refreshGridPositions(); }` branch is replaced by a single path.
- `initializeCoordinates()` and `refreshGridPositions()` are already called inside `loadGame()` → no duplication.
- `onResize()` (cell-size calculation + `refreshGridPositions()`) stays first, exactly as before.
- The `return` after redirect prevents any further initialization on the main-menu path.

### 3. Comments

Add concise comments explaining:
- Why `currentSlot` is set here (direct navigation bypasses `MainMenu`).
- Why we redirect when no save exists (prevents unsaveable default-game state).
- That `loadGame()` is the single entry point for state restoration.

## Edge cases

| Scenario | Behavior |
|---|---|
| Direct nav, save exists | Loads most recent save, `currentSlot` set, game is saveable. |
| Direct nav, no save | Redirects to `/`. |
| Menu → New Game → `/star-map` | Unchanged: `MainMenu` sets `currentSlot`, `ngOnInit` loads it. |
| Menu → Load Game → `/star-map` | Unchanged: same as above. |
| `/star-map` → destroy → re-enter `/star-map` | Unchanged: slot persists in `SaveGameService` singleton. |
| Save corrupted / missing fleets | `loadGame()` already has a guard (`if (!data.fleets ...) return;`). The component falls back to default state. |

## Out of scope

- Fleet-position CSS bug: no code change needed; coordinates are correct.
- `initializeCoordinates()` legacy conversion: remains effectively unreachable (existing behavior, not introduced by this change).

## Files touched

1. `src/app/services/save-game.service.ts` — add `getMostRecentSlotIndex()`.
2. `src/app/components/star-map/star-map.ts` — rewrite `ngOnInit()` with comments.

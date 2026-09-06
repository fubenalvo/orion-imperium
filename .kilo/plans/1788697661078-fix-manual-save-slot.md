# Fix manual save going to wrong slot

## Problem
When the player selects a manual slot in the pause menu, `saveFromMenu(slotIndex)` sets `currentSlot` but then calls `saveGame()`, which always writes to `SaveSlotId.AUTOSAVE` (slot 0). The manual save data ends up in the autosave slot, leaving the chosen manual slot empty.

User scenario:
1. Pause → SAVE GAME → select Slot 5 (index 4)
2. Data is written to slot 0 (Autosave) instead of slot 4
3. Main menu shows Slot 5 empty, but Autosave has the new date

## Root Cause
`star-map.ts:439-442`:
```ts
saveFromMenu(slotIndex: number): void {
  this.saveGameService.currentSlot = slotIndex;
  this.saveGame(); // always writes to AUTOSAVE
}
```

`star-map.ts:2283`:
```ts
this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
```

## Fix
Extract serialization into `serializeGameState(): StarMapData` and update `saveFromMenu()` to save directly to the selected slot.

### 1. `star-map.ts`
- Add private `serializeGameState(): StarMapData` containing the current serialization logic from `saveGame()`
- Update `saveGame()` to call `serializeGameState()` and save to `SaveSlotId.AUTOSAVE`
- Update `saveFromMenu(slotIndex)` to call `serializeGameState()` and save to `slotIndex` directly

### 2. Validation
- Run `npm test` — no regressions
- Manual test: pause → save to Slot 4 → verify data appears in Slot 4, not Autosave

## Notes
- All autosave triggers (`enterSystem`, `leaveSystem`, `exitToMainMenu`, etc.) continue to call `saveGame()` → slot 0. No change needed.
- `loadFromMenu()` and `loadGame()` behavior unchanged.
- No UI changes needed.

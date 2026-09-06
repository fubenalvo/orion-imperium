# 5-slot Save System Plan

## Goal
Introduce a dedicated `Autosave` slot (slot 0) and 4 manual slots (slots 1–4). Autosave never overwrites manual saves; manual save never writes to autosave. Load can read any slot. Old 4-slot saves are preserved as manual slots 1–4.

## Key Decisions
- **Slot 0 = Autosave**, **Slots 1–4 = Manual**. Centralized constants in `SaveGameService`.
- **`slotCount` increases from 4 to 5**. Old localStorage data with 4 slots maps cleanly: slot 0 becomes empty, old slots shift to 1–4 automatically because `getSlots()` iterates up to `slotCount` and missing indices become empty.
- **`saveGame()` in `StarMap` always writes to slot 0** regardless of `currentSlot`. `currentSlot` remains the load-context slot.
- **Manual save from pause menu** auto-selects the first empty manual slot (1–4). If all manual slots are full, it falls back to slot 1 (overwrite oldest manual).
- **New game from main menu** only offers slots 1–4.
- **Load UI** (main menu + pause menu) shows all 5 slots. Autosave is loadable but not selectable for new game or manual save.
- **Battle screen planet-battle result** loads from and saves to slot 0 (autosave), because the pre-battle state is always autosaved before navigating to `/battle`.

## Files to modify

### 1. `src/app/services/save-game.service.ts`
- Add constants: `AUTOSAVE_SLOT = 0`, `MANUAL_SLOT_START = 1`, `MANUAL_SLOT_COUNT = 4`, `TOTAL_SLOT_COUNT = 5`.
- Change `slotCount` from `4` to `this.TOTAL_SLOT_COUNT`.
- No interface changes (`SaveSlot` stays the same).
- Backwards compatibility is automatic: old 4-slot JSON becomes slot 0 empty + slots 1–4 populated.

### 2. `src/app/components/star-map/star-map.ts`
- **`saveGame()`**: Remove the `currentSlot === null` guard. Always serialize and call `saveGameService.saveToSlot(0, data)`.
- **`saveFromMenu()`**: Pick a manual slot (first empty among 1–4, fallback slot 1). Set `saveGameService.currentSlot` to that manual slot temporarily, call `saveGame()`, then restore? Actually simpler: add a new method `saveToManualSlot()` or just inline the logic. Let's add `saveGameToManualSlot(manualSlotIndex)` to `SaveGameService` or just do it inline. Recommended: add `saveGameService.saveToSlot(manualSlot, data)` directly from `saveFromMenu()` without going through `saveGame()`.
- **`loadFromMenu()`**: Allow slot 0–4. Set `currentSlot = slotIndex`. Call `loadGame()`.
- **`exitToMainMenu()`**: Still calls `saveGame()` which now goes to slot 0. Correct.
- **`ngOnDestroy()`**: Calls `saveGame()` → slot 0. Correct.
- **`removeDestroyedFleetFromService()`**: Calls `saveGame()` → slot 0. Correct.
- **`reloadAfterBattle()`**: Calls `loadGame()` → loads from `currentSlot`. Correct.

### 3. `src/app/components/battle-screen/battle-screen.component.ts`
- **`applyPlanetBattleResult()`**: Change `loadFromSlot(this.saveGameService.currentSlot)` → `loadFromSlot(0)`. Change `saveToSlot(this.saveGameService.currentSlot, data)` → `saveToSlot(0, data)`.
- Rationale: pre-battle state is always autosaved to slot 0 before battle navigation. Result should persist to autosave, not overwrite the manual slot the player was playing from.

### 4. `src/app/main-menu/main-menu.ts`
- **`newGame(slotIndex)`**: Guard that `slotIndex` is 1–4. Save to slot, set `currentSlot = slotIndex`, navigate.
- **`loadGame(slotIndex)`**: Allow 0–4. Load from slot, set `currentSlot = slotIndex`, navigate.

### 5. `src/app/components/star-map-pause/star-map-pause.component.ts`
- **`onSaveGame()`**: Emits save event. `StarMap.saveFromMenu()` will handle picking a manual slot.
- **`onSelectSlot(slotIndex)`**: Emits load event with slotIndex (0–4).
- **`get slots()`**: Returns all 5 slots from service.

### 6. `src/app/main-menu/main-menu.html`
- When `showNewGameSlots` is true: render only slots 1–4 with label `Slot {{ $index }}` (because index 0 is autosave, but we skip it). Actually, render slots 1–4 with labels "Slot 1" through "Slot 4".
- When `showLoadGameSlots` is true: render all 5 slots. Slot 0 shows "Autosave" instead of "Slot 1".
- CLOSE button unchanged.

### 7. `src/app/components/star-map-pause/star-map-pause.component.html`
- Load slots view: render all 5 slots. Slot 0 shows "Autosave" label and maybe a different style (e.g., muted text indicating it's managed automatically).
- Save button unchanged (still triggers manual save to slots 1–4).

## Autosave trigger points (all go to slot 0 after change)
These are the call sites of `saveGame()` in `star-map.ts`:
1. `enterSystem()` — line ~462
2. `leaveSystem()` — line ~615
3. `openPlanetView()` — line ~1290
4. `leavePlanetView()` — line ~1296
5. `exitToMainMenu()` — line ~456
6. `onQueueOrder()` — line ~849
7. `onCancelOrder()` — line ~863
8. `onTechnologyResearched()` — line ~911
9. `onSpaceportConfirm()` — line ~974
10. `onSpaceportDisband()` — line ~996
11. `disbandSelectedFleet()` — line ~1005
12. `battleDetectionService.checkForBattles(...)` callback — line ~1929
13. `handleFleetPlanetArrival()` colonization — line ~2110
14. `handleFleetPlanetArrival()` capture — line ~2142
15. `triggerPlanetBattle()` — line ~2213
16. `removeDestroyedFleetFromService()` — line ~2519
17. `ngOnDestroy()` — line ~2573

## Validation
- Run existing tests: `npm test` (Vitest). Expect migration spec to still pass.
- Manual smoke test:
  1. Start new game in Slot 1. Play until first autosave. Verify slot 0 (Autosave) has data, slot 1 has initial data.
  2. Make a state change that triggers autosave. Verify slot 0 updated, slot 1 unchanged.
  3. Pause → Save Game. Verify it saves to Slot 2 (or first empty manual slot).
  4. Pause → Load Game. Verify all 5 slots are visible. Loading from Autosave works. Loading from Slot 1/2 works.
  5. Trigger a planet battle. After battle, verify autosave (slot 0) has updated state, manual slot unchanged.
  6. Refresh page. Verify `getMostRecentSlotIndex()` returns correct slot and game loads.

## Open questions / assumptions
- **New game slot overwrite**: If all 4 manual slots are full, should new game overwrite slot 1 or show an error? Assumption: overwrite slot 1 (oldest manual by convention, or just slot 1). Current UI has no error state, so overwrite is simplest.
- **Autosave label in UI**: "Autosave" vs "Slot 1" for the first slot. Assumption: label it "Autosave" in both main menu and pause menu load views.
- **Battle screen fallback**: If slot 0 is somehow empty when `applyPlanetBattleResult` runs, `loadFromSlot(0)` returns null and the result is silently dropped. This is acceptable because slot 0 is always written before battle navigation.

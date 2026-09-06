# Pause Menu Manual Save Slot Selection Plan

## Goal
When the player clicks SAVE GAME in the pause menu, present manual save slots (1-4) for selection instead of auto-saving to an empty slot.

## Current Flow
1. Pause menu shows: CONTINUE, SAVE GAME, LOAD GAME, MAIN MENU
2. Clicking SAVE GAME emits `saveGame` (void) to StarMap
3. StarMap.saveFromMenu() auto-selects first empty manual slot and saves immediately
4. "GAME SAVED" toast appears for 2 seconds

## Desired Flow
1. Pause menu shows: CONTINUE, SAVE GAME, LOAD GAME, MAIN MENU
2. Clicking SAVE GAME shows manual save slots (Slot 1-4) — Autosave excluded
3. Player clicks a manual slot
4. StarMap saves to that slot
5. "GAME SAVED" toast appears, selection view closes, returns to main pause menu

## Changes Required

### 1. `star-map-pause.component.ts`
- Change `@Output() saveGame = new EventEmitter<void>()` to `@Output() saveGame = new EventEmitter<number>()`
- Add `showSaveSlots = false` state
- Change `onSaveGame()` to set `showSaveSlots = true` instead of emitting immediately
- Add `onSaveSlotSelected(slotIndex: number)` that emits `saveGame.emit(slotIndex)`, sets `showSaveSlots = false`, and shows toast
- Remove immediate save + toast from `onSaveGame()`; toast logic moves to `onSaveSlotSelected()`

### 2. `star-map-pause.component.html`
- Replace main buttons block with conditional:
  - If `!showSaveSlots && !showLoadSlots`: show CONTINUE, SAVE GAME, LOAD GAME, MAIN MENU + toast
  - If `showSaveSlots`: show title "SAVE GAME", manual slots 1-4, BACK button
  - If `showLoadSlots`: show title "LOAD GAME", all 5 slots, BACK button
- In save slots view, render only slots where `$index >= 1` (manual only), label as "Slot {{ $index + 1 }}"
- BACK in save slots view sets `showSaveSlots = false`

### 3. `star-map.ts`
- Change `saveFromMenu()` signature to `saveFromMenu(slotIndex: number): void`
- Use `slotIndex` directly instead of auto-selecting:
  ```ts
  this.saveGameService.currentSlot = slotIndex;
  this.saveGame();
  ```
- Remove auto-selection logic

### 4. `star-map.html`
- Update `(saveGame)` binding to pass event: `(saveGame)="saveFromMenu($event)"`

## Validation
- Run `npm test` — ensure no regressions in save-game service, star-map, or pause component tests
- Manual: open pause menu → SAVE GAME → verify only Slot 1-4 appear → click Slot 2 → verify "GAME SAVED" toast → verify data persisted to Slot 2

## Edge Cases
- Player clicks BACK in save slot view: returns to main pause menu, no save occurs
- Player clicks SAVE GAME again after returning: re-opens slot selection
- All manual slots full: all 4 slots still shown; player can overwrite any of them

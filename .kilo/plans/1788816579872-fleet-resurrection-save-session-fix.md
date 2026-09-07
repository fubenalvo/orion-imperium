# Fleet Resurrection Save-Session Fix

## Goal

Prevent fleets destroyed in earlier battles from returning after a later battle, while preserving manual save slots as explicit snapshots and autosave as the live session state.

## Root Cause

- New/load game sets `SaveGameService.currentSlot` to a manual slot, but runtime `StarMap.saveGame()` and battle result handling write to autosave slot 0.
- `/star-map` and `/battle` are separate routed components; without a custom `RouteReuseStrategy`, returning from battle creates a new `StarMap` whose `ngOnInit()` loads `currentSlot`.
- That reload can therefore restore a stale manual snapshot. `BattleService.destroyedFleetId` reapplies only the latest loser, so a fleet destroyed in an earlier battle is resurrected while the latest loser remains destroyed.
- The same split source of truth can discard other accumulated runtime state and planet-battle ownership results.

## Design Decision

Autosave slot 0 is the sole active-session persistence source. Loading or creating from a manual slot copies that snapshot into autosave and switches `currentSlot` to autosave. Manual slots remain unchanged until the player explicitly saves to one; no save schema migration is required.

## Implementation

1. Add a `SaveGameService.activateSlot(slotIndex): boolean` operation in `src/app/services/save-game.service.ts`.
   - Load and validate the requested slot.
   - If it is manual, write its full snapshot to `SaveSlotId.AUTOSAVE` before play starts.
   - Set `currentSlot = SaveSlotId.AUTOSAVE` only after activation succeeds.
   - Return `false` for an empty/invalid slot without changing the current session or overwriting autosave.
   - Avoid rewriting autosave when slot 0 itself is selected.

2. Route every session start through `activateSlot`.
   - In `src/app/main-menu/main-menu.ts`, new-game creation first writes the chosen manual snapshot, then activates it; manual/autosave load uses activation and navigates only on success.
   - In `src/app/components/star-map/star-map.ts`, pause-menu loading activates the selected slot before `loadGame()`.
   - In `StarMap.ngOnInit()`, normalize an existing non-autosave `currentSlot` through activation, and do the same for the most-recent fallback used by direct `/star-map` navigation. Redirect/preserve state on activation failure rather than loading unrelated autosave data.
   - Keep `loadGame()` reading `currentSlot`; after activation this is consistently slot 0, so normal initialization and `reloadAfterBattle()` consume the same snapshot that `saveGame()` and `BattleScreenComponent` update.

3. Retain `destroyedFleetId` as a navigation/failure fallback, not as the authoritative history of destroyed fleets.
   - Do not add multi-ID compatibility state or alter the save schema.
   - Keep persisted `fleet.destroyed` flags authoritative and cumulative in autosave.
   - Update misleading lifecycle comments in `star-map.ts` and `battle-screen.component.ts`: the map is normally destroyed between sibling routes; `BattleService` and autosave carry the handoff.

4. Add regression coverage.
   - In `src/app/services/save-game.service.spec.ts`, verify manual activation copies the complete snapshot to autosave, selects slot 0, preserves the manual snapshot, handles autosave activation without rewriting it, and leaves state untouched for empty slots.
   - In `src/app/main-menu/main-menu.spec.ts`, verify new game and manual load activate autosave before navigation.
   - In `src/app/components/star-map/star-map.spec.ts`, model a stale manual slot plus a live autosave and verify two cumulative fleet destructions survive repeated loads; verify pause-menu load seeds autosave and subsequent `loadGame()` no longer falls back to the stale manual snapshot.
   - Include a planet ownership mutation in the session-state test or a focused equivalent, ensuring planet battle results are protected by the same source-of-truth fix.

5. Update existing documentation to match the implementation.
   - `docs/architecture.md`: five slots, routed component lifecycle, autosave as active-session state, manual slots as snapshots.
   - `docs/game-systems.md`: activation flow and consistent read/write slot semantics.
   - `docs/invariants.md`: active `currentSlot` is autosave during gameplay; manual load copies before mutation; failed activation is non-destructive.
   - `docs/battle-rules.md` and `docs/game-state.md`: battle results accumulate in the active autosave and survive any number of later battles.

## Validation

1. Run focused tests for `save-game.service.spec.ts`, `main-menu.spec.ts`, and `star-map.spec.ts` using the project Vitest/Angular test command.
2. Run the full `npm test` suite and `npm run build`.
3. Manually start from a manual new-game slot: lose ORION to HUNTER, defeat HUNTER with PEGASUS, return to the map, and verify both losers remain absent.
4. Repeat after loading a manual save and verify fleet positions, resources, exploration, production, and planet ownership are not rolled back on battle return.
5. Confirm explicit manual saves remain unchanged until selected by the player, while the load menu exposes the continuously updated autosave.

## Risks And Boundaries

- Activating a manual slot intentionally replaces the previous autosave, matching "load game" semantics; the selected manual snapshot itself is not mutated.
- Existing localStorage data remains compatible because only slot selection/copy behavior changes.
- Winner ship damage persistence and battle simulation rules are out of scope.

# Phase 0 Save/Load Persistence Audit

## Scope and evidence

Audit of the current Phase 0 persistence behavior. No source files were changed.

Reviewed:
- `src/app/services/save-game.service.ts` + `.spec.ts`
- `src/app/components/star-map/star-map.ts` (serialize/load/session/battle apply)
- `src/app/components/star-map/star-map-movement.service.ts`
- `src/app/components/star-map/star-map-battle-detection.service.ts`, `star-map-planet-arrival.service.ts`, AI services
- `src/app/components/battle-screen/battle-screen.component.ts` + battle model/state/result services
- `src/app/services/production.service.ts`, `fleet-assembly.service.ts`, `ship-stock.service.ts`, `planet-battle.service.ts`, `economy.service.ts`, `research.service.ts`
- `src/app/main-menu/main-menu.ts` and pause save/load wiring
- `docs/invariants.md`, `docs/game-state.md`, `docs/data-models.md`

Worktree note: `src/app/services/economy.service.spec.ts` has unrelated uncommitted changes; this audit does not depend on them.

Terms:
- **Persisted**: written into a `StarMapData` snapshot in one of the five localStorage slots.
- **Transient**: in-memory service state only; lost on browser refresh and not expected in `StarMapData`.
- **Phase 0 fields**: fields added/changed by the current Phase 0 work (shield pool, per-ship rosters, AI combat/reinforce actions).

---

## 1. Current persistence model

### 1.1 Slot layer

`SaveGameService` (`save-game.service.ts`)
- Storage key `orion_save_slots`; 5 slots: 0 autosave, 1-4 manual (`:10-18`, `:33-43`).
- `getSlots()` parses the whole key and calls `migrateSave()` per slot (`:52-78`).
- `saveToSlot()` reads all slots, replaces one, rewrites the whole array (`:85-93`).
- `loadFromSlot()` returns a migrated snapshot or `null` (`:95-101`).
- `activateSlot()` validates, copies a manual snapshot into autosave, sets `currentSlot = 0` (`:119-129`).
- `isValidSaveData()` only checks that `fleets`, `starSystems`, `factions` are arrays (`:137-145`).
- `migrateSave()` backfills `shipStock`, `production`, `resourceTiles`, `ai`, `researchedTechnologies` (`:155-184`).
- `getMostRecentSlotIndex()` compares ISO date strings (`:200-212`).

### 1.2 Root snapshot (`StarMap.serializeGameState`, `star-map.ts:2038-2063`)

| Domain | Persisted fields |
|---|---|
| Factions | `factions[]`: `id`, `name`, `color`, `team`, `ai`, `currencies`, `researchedTechnologies` |
| Map | `map.width/height/cellSizeVw/cellSizeVh` (but dimensions are not restored; see gaps) |
| Systems/planets | `starSystems[]`; each planet tile: ownership `factionId`, `buildings`, `population`, `satisfaction`, `explored`, `resourceTiles`, **`shieldPoolCurrent`** |
| Fleets | `fleets[]`: `x/y`, `targetX/Y`, `system` (`id`, `x/y`, `targetX/Y`), `speed`, `sensorRange`, `destroyed`, `gridCol/gridRow`, `ships[]` |
| Ships | `ships[]`: `id`, `type`, `name`, `currentHp`, `destroyed` |
| Stock | `shipStock[]` per faction (`id`, `type`, `name`, `producedAtTick?`, `originPlanetId?`) |
| Production | `production[]` per faction, `ordersByPlanet` keyed by planet id, order `id`, `shipTypeId`, `quantity`, `progress`, `startedAtTick` |
| Research | `faction.researchedTechnologies`, `currencies.research` |
| Fog/view | `exploredGridCells[]`, `currentView`, `cameraX/Y`, selection ids, `selectedFleetAction`, root `targetX/Y` |
| Battle residue | `destroyedFleetId` |

`StarMap.loadGame()` (`star-map.ts:2086-2207`) restores arrays, defaults fog/sensor, performs legacy coordinate conversion, marks `destroyedFleetId`, recomputes grid, restores view/selection, resets game time and AI pipeline.

`serializeGameState()` does **not** write `defaultView` (`star-map.ts:2039-2062`). `map.width/height/cellSize*` are written but never assigned back on load; the component uses its own `mapWidth/mapHeight` and current viewport size.

### 1.3 Battle write-back

- Pre-battle snapshot: `enterBattleScreen()` saves autosave then navigates (`star-map.ts:2080-2083`).
- Fleet battle: `BattleScreenComponent.persistFleetBattleResult()` loads autosave, writes both real fleets' ships and `destroyed` flags, saves (`battle-screen.component.ts:688-704`).
- Planet battle: `applyPlanetBattleResult()` loads autosave, writes planet ownership on attacker victory, writes `shieldPoolCurrent` if the outcome carries it, writes attacker roster/destroyed, saves (`battle-screen.component.ts:712-738`).
- On return, `StarMap.ngOnInit()` loads autosave and `removeDestroyedFleetFromService()` applies the in-memory `BattleOutcome`, snaps non-wiped winners' positions, clears targets, then saves (`star-map.ts:2252-2253`, `:2302-2366`).
- Virtual planet-defense fleets use negative ids and are deliberately not persisted (`star-map.ts:2339-2342`; `planet-battle.service.ts`).

### 1.4 Autosave / manual / activation

- `saveGame()` always writes autosave; there is no `currentSlot` guard despite `docs/invariants.md:46` (`star-map.ts:2066-2069`).
- Session start normalizes non-autosave slots through `activateSlot()`: `MainMenu.newGame/loadGame`, `StarMap.loadFromMenu`, and the `ngOnInit` fallback (`main-menu.ts:106-111`, `star-map.ts:2235-2250`, `star-map.ts:2232-2272`).
- `reloadAfterBattle()` reloads autosave and applies pending battle state (`star-map.ts:2283-2289`).

### 1.5 Transient-only state (not serialized)

- `BattleService.currentBattle/battleResult/destroyedFleetId` (`battle.service.ts`).
- AI strategy/goal/capability/action maps and peak strength; reset via `aiTickService.resetAiPipeline()` on load (`star-map.ts:2204`).
- `StarMapPlanetArrivalService.triggeredBattles` (cleared on load) and `fleetPlanetMap` (not cleared).
- `ProductionService.orderIdCounter` and `tickCounter` (`production.service.ts:50-51`).
- `GameTimeService` speed/pause/elapsed time; deliberately reset on load (`star-map.ts:2202`).

---

## 2. Findings and missing persistence

### P0 - correctness / data loss

1. **Per-ship HP and destroyed state are persisted but not consumed by combat.**
   `toBattleShip()` always sets real ships to `stats.maxHp` and `alive: true` (`battle-state.ts:97-101`, `:119`). Destroyed ships are re-deployed at full HP, and `applyBattleResult()` later writes them back as alive (`star-map.ts:2347-2353`). A partial loss is therefore erased by the next battle. This contradicts the Phase 0 "no resurrection" intent for ships.

2. **Planet-battle garrison damage/death is not persisted.**
   `PlanetBattleService.createVirtualDefenseFleet()` copies garrison ships with new ids (`planet-battle.service.ts:105-112`). `applyPlanetBattleResult()` only writes the attacker roster (`battle-screen.component.ts:728-734`). The real garrison fleet keeps its old ships/HP/destroyed flags after battle, even when the planet is captured.

3. **A zero shield pool is treated as "no pool".**
   `createBattleState()` creates `defenderShieldPool` only when `shieldPool > 0` (`battle-state.ts:78-81`). A fully depleted persisted shield (`shieldPoolCurrent = 0`) becomes `null`, so `buildBattleOutcome()` omits `shieldPoolCurrent`, `applyPlanetBattleResult()` leaves the stale 0 (which happens to be correct for depletion) but the shared pool never regenerates in battle and no future outcome is produced. Clamping only handles the upper bound (`planet-battle.service.ts:101-103`); negative/NaN values are not handled.

4. **Legacy migration is non-idempotent and incomplete.**
   `StarMap` converts when `data.map.width === 200` (`star-map.ts:2134-2153`) but never updates `data.map.width/height`, so re-loading the same legacy slot re-converts already converted coordinates. `StarMapMovementService.initializeCoordinates()` uses a different test (`gridColumns > 150`, `star-map-movement.service.ts:257-288`). `Fleet.system.x/y`, root `targetX/Y`, and destroyed fleets are not converted. Clamping has no lower bound. Docs say `map.width > 150` (`docs/invariants.md:48`) while the current data file uses 300x180.

5. **Production counters are not rebased on load.**
   `orderIdCounter` and `tickCounter` reset on app restart/reload (`production.service.ts:50-51`, `:98`, `:102`, `:187`). Loaded `startedAtTick` values keep their old absolute values, so stall age is negative until the counter catches up, and newly queued orders can reuse persisted order ids (`:228`).

6. **Save corruption handling is all-or-nothing.**
   `getSlots()` wraps parsing plus every `migrateSave()` call in one `try` (`save-game.service.ts:58-77`). One malformed slot (e.g. non-iterable `starSystems`) makes every slot appear empty. The next `saveToSlot()` then rewrites the whole key from the empty result, destroying recoverable data. `saveToSlot()` also does not catch quota/serialization errors (`:85-93`).

7. **Shallow validation accepts data that crashes later.**
   `isValidSaveData()` only checks three top-level arrays (`save-game.service.ts:137-145`). It accepts empty `factions`/`starSystems`, non-array nested `ships`, `planetsTiles`, `buildings`, invalid currency values, invalid fleet coordinates, and unknown ship types. `StarMap.loadGame()` only checks truthiness of the same three arrays (`star-map.ts:2094-2096`), and direct `loadFromSlot()` does not validate at all.

### P1 - persistence gaps and inconsistent behavior

8. **No save version / schema contract.** Migrations are inferred from field presence and one exact map width. There is no `saveVersion` to make ordered, testable migrations possible.

9. **AI/economy/production changes are not autosaved promptly.** The game loop mutates production progress, stock, currencies, population, satisfaction, buildings, planet ownership, and AI fleet targets; `gameLoopCallback()` does not call `saveGame()`. Only explicit autosave triggers and `ngOnDestroy` capture them. A crash/tab kill loses simulation progress since the last trigger. `docs/invariants.md:172-173` claims root snapshot persistence but does not define autosave cadence.

10. **Unknown ship types degrade silently.** Battle stats fall back to a 1-HP immobile unit (`battle-ship-stats.ts`), `ProductionService.tick()` drops unknown queued orders without refund, and fleet assembly/stock accept unknown types. There is no validation/quarantine and no user-visible warning.

11. **Fog/explored flag reconciliation is incomplete.** When `exploredGridCells` exists but a system lacks `explored`, the code does not default it (the second loop is also gated by `!hasSensorData`, `star-map.ts:2118-2123`). Missing `PlanetTile.explored` has no load-time normalization. `docs/invariants.md:156` only describes the no-sensor-data case.

12. **Transient session state is not reset on every load.** `loadFromMenu()` does not clear `BattleService` or `fleetPlanetMap`; stale battle result/id could later be applied to a freshly loaded snapshot. `fleetPlanetMap` persists across sibling-route recreation of `StarMap`, so an arrival can be skipped once after a load.

13. **`defaultView`, map dimensions, and cell sizes are not restored.** `serializeGameState()` omits `defaultView`; `loadGame()` ignores saved `map.width/height/cellSize*`. This works for the current fixed map but breaks future map-size changes and makes legacy migration depend on the runtime map size.

14. **`localStorage` failures and UX.** No handling for disabled storage, quota errors, or write failures; manual save UI can report success before a throw. `getMostRecentSlotIndex()` uses lexicographic string comparison, so non-ISO dates misorder.

### P2 - consistency / hygiene

15. Destroyed fleets are retained forever, and orphan `shipStock`/`production` entries for removed factions are never cleaned up. `ShipStockService.onFactionRemoved()` exists but is not called.
16. Loaded selection/action state can reference missing fleet/system/planet ids (`star-map.ts:2185-2190`), leaving stale UI state.
17. Documentation drift: `docs/invariants.md` says 100x60 map (`:7`), says `saveGame()` only writes when `currentSlot` is not null (`:46`), and describes legacy migration as `map.width > 150` (`:48`) while code uses `=== 200`.
18. No atomic write/backup: a failed `setItem` can leave the old value, but a partially valid rewrite from a corrupt parse can still clobber slots.

---

## 3. Missing fields by requested domain

| Requested domain | Status | Gap |
|---|---|---|
| Fleet roster | Persisted via `fleets[].ships` | No nested validation; no repair of missing/duplicate ids |
| Per-ship HP | Written by battle results | Ignored at battle start for real ships (`battle-state.ts:100-101`) |
| Per-ship destroyed | Written by battle results | Ignored at battle start; erased on next surviving battle (`:119`, `star-map.ts:2347-2353`) |
| Fleet position | Persisted (`x/y`, `gridCol/gridRow`) | Legacy conversion non-idempotent; bounds/NaN not validated; saved map size ignored |
| Fleet movement target | Persisted (`targetX/Y`, `system.targetX/Y`) | Root/system targets not legacy-migrated; stale targets not always cleared on crash between battle write-back and map return |
| Planetary shield pool | `shieldPoolCurrent` persisted | Zero pool becomes `null`; no lower-bound/NaN validation; max derived but not reconciled on load; capture semantics undefined |
| Planet ownership | Persisted (`factionId`) | No validation against faction ids; capture leaves old garrison fleet alive |
| Production queue | Persisted (`production`) | Counters not rebased; unknown types silently dropped; orphan planet refs; progress/quantity bounds unchecked |
| Global ship stock | Persisted (`shipStock`) | Unknown types accepted; duplicate ids possible; orphan faction entries |
| Research | Persisted (`researchedTechnologies`, `research`) | Non-array or unknown ids not validated; migration grants starting techs to every faction lacking the field |
| AI state | Only `Faction.ai` persisted; pipeline transient | Reset is intentional; no explicit persistence of goals/targets. `targetStrength`/`value`/new `ActionType` values are transient and recomputed, so no persistence needed |
| Battle flags | `destroyedFleetId` persisted; rest transient | Battle screen state lost on refresh; pre-battle fallback is intentional but should be verified for planet battles |
| Destroyed fleets | `fleet.destroyed` persisted | Retained forever; per-ship coherence not enforced |
| New Phase 0 fields | `PlanetTile.shieldPoolCurrent` persisted; `BattleFleetOutcome.shieldPoolCurrent/Max`, `CapabilityRequirement.value`, `ActionResult.shipTypeId/targetStrength`, new `ActionType` values are transient | Only `shieldPoolCurrent` belongs in the save contract. The AI fields are recomputed and must not be persisted; verify no service reads stale transient values after `resetAiPipeline()` |

---

## 4. Migration requirements

Implement migrations in a single ordered chain, driven by a new `saveVersion` number.

1. **Add `saveVersion` to `StarMapData`.** Treat missing as version 0; write the current version on save.
2. **Centralize legacy detection.** Replace the duplicated `map.width === 200` / `gridColumns > 150` checks with one versioned migration. After conversion, set `map.width/height` to the current grid dimensions so the migration is idempotent.
3. **Convert all legacy coordinate spaces.** Star systems, fleet `x/y`, fleet `targetX/Y`, fleet `system.x/y/targetX/Y`, and root `targetX/Y`; clamp both bounds and reject non-finite values.
4. **Rebase production state.** On load, set `orderIdCounter = max(existing order ids) + 1` and `tickCounter` to a value that makes persisted `startedAtTick` ages non-negative; or store stall state relative to `startedAtTick` instead of an absolute counter.
5. **Normalize shields.** Clamp `shieldPoolCurrent` to `[0, totalShield]`; treat a missing value as full; preserve an explicit `0`. Reconcile against current shield buildings on load.
6. **Normalize ships and fleets.** Ensure arrays exist, ids unique, HP finite and within `[0, maxHp]`, `destroyed` boolean, `fleet.destroyed` consistent with all-ships-dead policy, and coordinates finite/in-bounds.
7. **Reconcile fog.** If `exploredGridCells` exists, default missing `StarSystem.explored` and `PlanetTile.explored` to `false` or recompute from explored cells; if it does not exist, preserve the current "all explored" fallback.
8. **Preserve research/migration semantics.** Keep explicit empty `researchedTechnologies` arrays as-is; derive `ai` for `team >= 2`, not only `team === 2`; filter or quarantine unknown tech ids.
9. **Handle unknown ship types.** Define a policy: keep raw type string for save fidelity, but exclude it from combat/strength/production completion and surface a validation warning. Never silently convert it to a 1-HP combat unit.
10. **Handle planet-battle garrison state.** Extend the battle outcome to identify the real garrison fleet and persist its final roster/destroyed state; mark or remove it when the planet is captured.
11. **Reset transient session state on every session load.** Clear `BattleService`, `triggeredBattles`, `fleetPlanetMap`, AI pipeline, and any stale selections/actions.
12. **Update docs** (`docs/invariants.md`, `docs/game-state.md`, `docs/data-models.md`) for map dimensions, versioned migration, autosave cadence, per-ship battle semantics, and shield/capture rules.

---

## 5. Validation requirements

Introduce an explicit validation result (`valid`, `warnings`, `errors`, `canLoad`) and run it:
- before `activateSlot()` copies a manual snapshot into autosave;
- before `StarMap.loadGame()` replaces live state;
- optionally after migration, so migrated output is validated.

Required rules:
- `saveVersion` known and not newer than the running build.
- Exactly one player faction; unique faction ids; valid `team`/`ai`; finite currency values; `researchedTechnologies` an array of known strings.
- At least one star system; unique system ids; grid cells finite and within map bounds; `planetsTiles` arrays; unique planet ids; valid planet `factionId`; known building names; `population >= 0`; `satisfaction` in `[0, 100]`; `shieldPoolCurrent` in `[0, maxShield]` when present.
- `fleets` an array; unique fleet ids; valid faction ids; finite in-bounds `x/y` and targets; `speed > 0`; `system.id` references an existing system and `system` coordinates are finite; `ships` an array; unique ship ids across fleets and stock; ship `type` known or quarantined; `currentHp` in `[0, maxHp]`; `destroyed` boolean; `fleet.destroyed` consistent with the chosen ship-death policy.
- `shipStock`/`production` arrays; faction ids valid; ship/type ids valid; production order ids unique; `quantity > 0`; `progress` finite; `startedAtTick` finite; planet references valid.
- Selection ids and `destroyedFleetId` either reference existing entities or are cleared.
- `map.width/height` positive integers; current runtime map dimensions must match or the save must be migrated.
- Unknown fields preserved for forward compatibility.
- Corrupt/partial data: isolate per slot; never return "all empty" because one slot is bad; quarantine the raw value (e.g. a backup key or warning) before any rewrite; report a recoverable error to the UI.
- Storage failures: wrap `getItem`/`setItem`; surface quota/disabled-storage errors; never report a successful manual save unless the write completed.
- Empty arrays: `fleets: []` may be valid (all fleets destroyed); `factions: []`/`starSystems: []` must be rejected.

---

## 6. Tests required before release

### SaveGameService unit tests
- Parse error in one slot does not hide other slots.
- Each malformed nested shape (`starSystems` object, `ships` string, `planetsTiles` null, invalid currencies) is rejected or quarantined without clobbering autosave.
- Quota/`setItem` throw is caught and reported; manual save does not report success.
- Versioned migration: version 0 -> current, idempotent; unknown future version rejected.
- `getMostRecentSlotIndex()` ignores invalid dates and orders correctly.
- `activateSlot()` never mutates the manual snapshot; failed activation leaves autosave untouched.
- Empty `factions`/`starSystems` rejected; empty `fleets` accepted.

### StarMap load/save integration tests
- Legacy save conversion round-trip is stable across repeated load/save/load.
- Missing optional fields (`shieldPoolCurrent`, `satisfaction`, `population`, `sensorRange`, `explored`, `resourceTiles`, `shipStock`, `production`) load with documented defaults.
- Invalid values (NaN/null/negative/out-of-bounds coordinates, HP, shield, speed, quantity, progress) are clamped/rejected without a crash.
- Unknown ship types in fleet, stock, and production follow the quarantine policy.
- Repeated load of the same autosave 10x does not drift.
- Manual save -> load copies to autosave and subsequent autosaves accumulate there.
- Direct `/star-map` navigation picks the correct slot and normalizes to autosave.
- Simulated AI/economy/production ticks followed by load do not regress or duplicate state.
- Battle-return recovery: stale `BattleService` state is applied or cleared exactly once.

### Battle persistence tests
- A damaged ship enters the next battle with persisted HP and a destroyed ship stays destroyed (or the chosen policy is explicitly enforced).
- Partial fleet loss survives a second battle; full wipe marks the fleet destroyed.
- Planet battle persists garrison losses/HP for defender win and attacker capture.
- Zero shield pool remains a real pool with regen; negative/above-max values are clamped.
- Shield value after capture follows the documented policy.
- Unknown-type ship in a battle does not silently become a 1-HP unit.

### Production / stock tests
- Loaded orders do not collide with new order ids.
- Stall timeout behaves correctly for persisted `startedAtTick`.
- Unknown ship type in a queued order is refunded/quarantined, not silently dropped.
- Orphan planet/faction references are rejected or cleaned.
- `nextShipId()` remains unique with duplicate/invalid ids present.

### End-to-end smoke
- New game -> save -> refresh -> load -> battle -> return -> save -> reload.
- Main-menu manual load, pause-menu manual load, autosave fallback.
- Corrupted local storage key shows a recoverable error and preserves recoverable slots.

### Property/fuzz
- Random valid snapshots round-trip unchanged through save -> load.
- Random malformed snapshots never crash and never overwrite the live autosave.

---

## 7. Implementation order for the implementing agent

1. Add `saveVersion`, validation types, and a single migration entry point.
2. Harden `SaveGameService`: per-slot isolation, quarantine/backup, try/catch on storage, atomic-ish writes.
3. Fix battle consumption of `currentHp`/`destroyed`; change/confirm the per-ship death policy.
4. Persist real planet-battle garrison state; define capture shield/garrison behavior.
5. Fix zero-shield representation and shield normalization.
6. Make legacy migration versioned and idempotent; convert all coordinate spaces.
7. Rebase production counters and order ids; validate queue/stock contents.
8. Reset transient session state on every load.
9. Add prompt autosave coverage for AI/economy/production changes.
10. Update docs and add the test matrix above.

Suggested validation commands after implementation:
- `npm test`
- `npx tsc -p tsconfig.app.json --noEmit` (or the project's configured typecheck command)

---

## 8. Open design decisions (recommendations, confirm before coding)

1. **Per-ship HP persistence:** persist HP across battles; do not auto-repair survivors. Destroyed ships remain in the roster for history but are excluded from battle, strength, economy, and sensor calculations.
2. **Destroyed-ship roster:** keep destroyed ships in `fleet.ships` (current shape) but filter them everywhere gameplay reads a living ship; if the fleet is fully destroyed, set `fleet.destroyed = true`.
3. **Shield on capture:** keep the physical shield pool value with the planet; do not reset to full on capture unless the rules explicitly say so.
4. **Unknown ship types:** keep the raw string in storage but quarantine the instance from gameplay and log/report a validation warning.
5. **Legacy migration target size:** after conversion set `map.width/height` to the runtime grid dimensions so repeated loads are stable.

## 9. Out of scope

- Refactoring the battle simulation itself.
- Changing the map dimensions or redesigning the fog-of-war model.
- Networking/cloud saves or multi-tab synchronization.
- Any behavior change to morale/economy beyond persistence and validation.

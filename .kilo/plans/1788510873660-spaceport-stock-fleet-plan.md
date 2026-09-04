# Spaceport → Global Ship Stock → Fleet Assembly Plan

## Context

The ship production pipeline is operational. The next step is the player-facing
loop that lets **produced ships leave the global stock and become real fleets**.
The repo already contains the full backend for this loop:

- `ShipStockService` (`src/app/services/ship-stock.service.ts`) — global
  per-faction ship reserve, FIFO, per-instance `ShipStockEntry` records.
- `ProductionService.tick` (`src/app/services/production.service.ts:230-244`)
  already calls `ShipStockService.addToStock` for every completed order — so
  **production completion → global stock is already wired**.
- `MilitarySpaceportService`
  (`src/app/services/military-spaceport.service.ts`) — answers "does the
  faction have a Spaceport planet?" purely from `planet.buildings`.
- `FleetAssemblyService` (`src/app/services/fleet-assembly.service.ts`) — pops
  stock entries into a real `Fleet`, gates by `hasSpaceport` +
  `isSpaceportPlanet`, supports `createFleet`, `reinforceFleet`,
  `disbandFleet`. Reuses the existing `Fleet` entity end-to-end. No new
  fleet type, no parallel fleet manager.
- `ShipStockService.disbandFleet` already returns surviving `FleetShip`s to
  the stock on disband.
- `SaveGameService.migrateSave`
  (`src/app/services/save-game.service.ts:93-101`) already backfills
  `shipStock: []` and `production: []`, so save/load is already covered.
- `StarMap` already calls `productionService.tick` from the game loop
  (`star-map.ts:1509`, `star-map.ts:1881`) and exposes
  `StarMapSpaceportPanelComponent` (create + reinforce UI) and
  `StarMapShipStockComponent` (global stock UI).

The single outstanding ask from the user is to use the building name
**Spaceport** (not "Military Spaceport"). That name is currently hard-coded
in three places: `MilitarySpaceportService.SPACEPORT_NAME`, the JSON entry in
`planet-data.json`, and the title string in
`StarMapSpaceportPanelComponent.html`. Renaming is a mechanical, low-risk
edit that does not change the architecture.

The remaining work in this plan is therefore **small, focused, and
verification-heavy**: rename the building; confirm each stage of the pipeline
behaves correctly with a tiny test harness; add a couple of UI affordances
that make manual testing fast; document the production-completion side
effect (the docs do not currently spell out that `ProductionService.tick`
pushes to the stock).

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Building name | `Spaceport` (no "Military" prefix) | Per user instruction. JSON change + rename in code. |
| Reuse existing services | Yes — no new services | `ShipStockService`, `ProductionService`, `MilitarySpaceportService` (renamed in place to `SpaceportService`), `FleetAssemblyService` already cover the entire loop. |
| Reuse existing `Fleet` entity | Yes | `FleetAssemblyService` already pushes stock entries into `fleet.ships`; battle / sensor / movement code reads them unchanged. |
| Production → stock | Already wired at `ProductionService.tick` | Verified at `production.service.ts:230-244` (`addToStock` on completion). Just document. |
| Destroyed ships in battle | Never returned to stock | Existing battle service does not call back into `ShipStockService`. No change needed — current behaviour matches the spec ("NE kerüljenek vissza"). |
| Disband policy | Surviving ships return to stock, destroyed ships are lost (matches IG1) | Existing `ShipStockService.disbandFleet` does exactly this. Document. |
| Save/load | Already covered by `StarMapData.shipStock` + `migrateSave` | No change needed beyond confirming round-trip. |

## Implementation Steps

### 1. Rename building: `Military Spaceport` → `Spaceport`

**Files:**

- `src/app/components/star-map/planet-data.json` — change the
  `military_spaceport` entry's `id` and `name` to `spaceport` / `Spaceport`.
- `src/app/services/military-spaceport.service.ts` — rename file and class to
  `spaceport.service.ts` / `SpaceportService`, set
  `SPACEPORT_NAME = 'Spaceport'`. (Keep the file name if renaming breaks too
  many imports; class rename is mandatory, file rename is cosmetic.)
- `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.html` —
  change "MILITARY SPACEPORT — …" titles to "SPACEPORT — …".
- Any string in `star-map.ts` referencing "Military Spaceport"
  (e.g. the error message in `openSpaceportPanel`) → "Spaceport".

Update `docs/ship-production.md`, `docs/architecture.md`,
`docs/data-models.md`, `docs/invariants.md` to use the new name. The
building definition file already calls it a "permission flag, not a storage
depot" — keep that wording.

### 2. Document the Production → Global Stock side effect

**File:** `docs/ship-production.md`

Append a short subsection "Production completion → Global Stock" that points
to `ProductionService.tick` (`production.service.ts:230-244`) and states
explicitly:

- On `progress >= 1`, the order's ships are minted as `ShipStockEntry`s with
  fresh ids from `ShipStockService.nextShipId` and pushed into
  `ShipStockService.addToStock` for the producing faction.
- The entries' `producedAtTick` and `originPlanetId` are set for debug.
- The fleet is never touched.

Also add a one-line note to `docs/invariants.md` next to the existing
"Stock ship ids share the same id space" entry that confirms production
completion is the canonical way new entries enter the stock.

### 3. Confirm Create-Fleet flow

No code change. The flow is already:

```
openSpaceportPanel('create') → onSpaceportConfirm
  → FleetAssemblyService.createFleet
  → SpaceportService.hasSpaceport + isSpaceportPlanet
  → ShipStockService.removeFromStock (atomic per typeId/count)
  → new Fleet pushed to data.fleets
  → saveGame()
```

Verify by reading `star-map.ts:704-758` and `fleet-assembly.service.ts:56-121`
end-to-end; both are already correct. Test by:

- Selecting a player planet with a `Spaceport` building; opening the Spaceport
  panel in create mode; confirming a fleet with composition → fleet appears,
  stock decreases, save reload preserves both.

### 4. Confirm Reinforce flow

No code change. `FleetAssemblyService.reinforceFleet`
  (`fleet-assembly.service.ts:123-160`) is the same stock-pop path and
  appends to `fleet.ships`. Test:

- Select an existing player fleet; open the Spaceport panel in reinforce
  mode; add ships → fleet gains ships, stock decreases, save reload
  preserves.

### 5. Confirm Disband flow

No code change. `FleetAssemblyService.disbandFleet` calls
`ShipStockService.disbandFleet` which returns survivors to stock, clears
`fleet.ships`, sets `fleet.destroyed = true` — which is exactly the existing
"destroyed fleet is invisible everywhere" path. Test: disband → surviving
ships back in stock UI; fleet disappears from fleet buttons; save reload
preserves.

### 6. Add minimal UI affordances for testing

The Spaceport panel + Ship Stock panel already exist. Add only the few small
gaps that make manual testing fast:

**File:** `src/app/components/star-map/star-map.ts`

- Expose a `selectedPlayerFleet()` helper (or inline it) so the existing
  `disbandFleet` button is reachable from the fleet info panel.
- Make sure `getPlayerSpaceportPanelViewModel`
  (`star-map.ts:609-644`) re-reads the stock every time the panel is opened,
  not just on construction (currently it is a getter called from the
  template — already correct).

**File:** `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.html`

- Add a `DISBAND` button on the reinforce-mode UI that emits a
  `disband.emit()` event so the panel can be the single test surface for
  create / reinforce / disband.

**File:** `src/app/components/star-map/star-map.ts`

- Wire `onSpaceportDisband` to call `FleetAssemblyService.disbandFleet`
  for `spaceportTargetFleetId`, then `saveGame()`, then
  `closeSpaceportPanel()`.

These three edits make the whole stock → fleet → back-to-stock round-trip
testable from a single panel.

### 7. Edge cases & validation (lightweight)

| Case | Existing behaviour | Action |
|---|---|---|
| Create fleet with empty composition | `AssemblyResult { reason: 'invalid_composition' }` | None — already handled by `FleetAssemblyService.checkStock`. |
| Reinforce with insufficient stock | `insufficient_stock` | None — already handled. |
| Create on a planet without Spaceport | `no_spaceport` | None — already gated by `isSpaceportPlanet` inside `createFleet`. |
| Create on an enemy planet | `invalid_target` | None — already gated by `planet.factionId !== request.factionId`. |
| Disband an enemy fleet | `enemy_fleet` | None — already gated by `fleet.factionId !== factionId`. |
| Disband an already-destroyed fleet | `fleet_not_found` | None — early return on `fleet.destroyed`. |
| Battle destroys ships | Ships stay destroyed, never return to stock | None — battle service does not call into the stock. Matches spec. |
| Star system with no Spaceport | `SpaceportService.listSpaceports` returns `[]` | None — UI hides panel gracefully. |
| Production order has no factory for 30 s | Auto-cancelled with proportional refund | None — already implemented in `ProductionService.tick`. |
| Save/load round-trip | `migrateSave` backfills `shipStock` + `production`; existing root-state persistence covers the rest | None — verified. |

No new validation code is required.

### 8. Save/load integration

No code change. The global stock already persists via:

- `StarMapData.shipStock` written by `StarMap.saveGame`
  (`star-map.ts:1921-…`).
- `StarMapData.production` written the same way.
- `SaveGameService.migrateSave` backfills both fields for saves that pre-date
  them.

Confirm by reading `save-game.service.ts:93-101` and the save call site in
`star-map.ts`. Add a note to `docs/ship-production.md` "Save/load" section
that `StarMapData.shipStock` is the canonical storage for the global stock
and `StarMapData.production` for production queues.

## Files Modified

| File | Change |
|---|---|
| `src/app/components/star-map/planet-data.json` | Rename building `military_spaceport` → `spaceport` (`id` + `name`). |
| `src/app/services/military-spaceport.service.ts` | Rename class to `SpaceportService`, constant to `SPACEPORT_NAME = 'Spaceport'`. Optionally rename file to `spaceport.service.ts` and update imports. |
| `src/app/components/star-map/star-map.ts` | Update DI token, error message strings, and any other references to "Military Spaceport" / "military_spaceport". Add `onSpaceportDisband` handler. |
| `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.ts` | Add `@Output() disband = new EventEmitter<void>()` (if not already present). |
| `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.html` | Change panel title strings. Add a DISBAND button in reinforce mode. |
| `docs/ship-production.md` | Add "Production completion → Global Stock" subsection. |
| `docs/architecture.md` | Update any references to "Military Spaceport" → "Spaceport". |
| `docs/data-models.md` | Update building / service references. |
| `docs/invariants.md` | Update the "Spaceport" invariant description and add a one-liner about production completion feeding the stock. |

No new files, no new services, no parallel data structures.

## Validation Plan

1. **Rename correctness**
   - `grep -ri "military.spaceport\|military_spaceport" src/` returns no
     gameplay-affecting matches (only file names if the file was not
     renamed).
   - The `Spaceport` building can be placed on a player planet from the
     planet surface build menu.

2. **Production → stock**
   - Queue 1 Corvette on a planet with a Spaceship Factory. Wait
     `buildTime` seconds.
   - Global Ship Stock panel shows `Corvette +1`. Player ship stock
     `Corvette` count increases by 1.

3. **Stock → new fleet**
   - Open Spaceport panel on a Spaceport planet. Pick composition
     (e.g. `Corvette: 3`). Confirm.
   - New fleet appears in the fleet list and on the galaxy map (at the
     host system's cell). Global Ship Stock decreases by the chosen count.

4. **Stock → reinforce**
   - Select an existing fleet. Open Spaceport panel in reinforce mode. Add
     `Corvette: +2`.
   - Fleet's ship count increases; global Stock decreases; sensor range
     floor rises if any new ship has `ShipType.range > 3`.

5. **Disband**
   - Disband a player fleet from the Spaceport panel.
   - Surviving ships return to the global stock; destroyed ships do not.
   - Fleet disappears from fleet buttons and minimap.

6. **Battle loss → no stock return**
   - Move a fleet onto an enemy system; lose the battle.
   - Destroyed ships are gone (stock does **not** increase). Total ship
     count across stock + surviving fleets is conserved except for the
     destroyed ones.

7. **Spaceport requirement**
   - On a player planet that has no `Spaceport` building, open the planet
     panel. The "Assemble Fleet" / "Reinforce" controls are disabled or
     hidden.

8. **Save / load**
   - Save the game. Reload from the same slot.
   - Global stock counts, fleet compositions, and Spaceport buildings are
     identical.

## Out of Scope

- Orbital Factory (deferred per user).
- Flagship production (deferred per user).
- New fleet movement or combat code (existing fleet system is reused).
- AI fleet management (deferred per user).
- Complex logistics (deferred per user).
- Multiple production slots per planet (current single-slot model stays).
- Per-ship veterancy / age effects (the `producedAtTick` field is captured
  but unused).
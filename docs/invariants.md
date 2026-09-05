# Invariants and Assumptions

Conditions that must remain true across the codebase. When changing any code that touches these areas, verify the new behaviour against this list.

## Grid Coordinate System

- `map.width` and `map.height` define the galaxy grid in cells (currently 100 columns × 60 rows).
- `cellSizeVw` and `cellSizeVh` are the rendered vw size of one cell. On desktop (`window.innerWidth >= gridBreakpointPx`, default 1300) both are `2`. On mobile (below the breakpoint) both are `3.5`. The change happens in `StarMap.onResize()` and also forces a grid position refresh.
- Star systems and fleets use **1-indexed grid cell coordinates** for `x`/`y` (e.g. `x = 18` is column 18).
- `StarMapMovementService.calculateGridCell(x, y)` snaps to `{ col: floor(x), row: floor(y) }`.
- `StarMapMovementService.getTileCenter(vwX, vwY)` converts vw coordinates to 1-indexed grid cells: `{ x: floor(vwX / cellSizeVw) + 1, y: floor(vwY / cellSizeVh) + 1 }`.
- The vw position of grid cell `N` is `(N - 0.5) * cellSizeVw` horizontally and `(N - 0.5) * cellSizeVh` vertically.
- The system view uses a fixed 18×10 grid with 5vw cells (`StarMapMovementService.SYSTEM_CELL_SIZE_VW`). `system.x`/`system.y` are in vw units on this grid.
- `calculateSystemGridCell(vwX, vwY)` returns 1-indexed cells: `{ col: floor(vwX / 5) + 1, row: floor(vwY / 5) + 1 }`.
- `getSystemTileCenter(vwX, vwY)` snaps a click to the center of the containing system cell, in vw units, so the visual target and the actual target match.
- `getPlanetGridPosition(planet)` returns `{ col: 13 - planet.index, row: 6 ± (planet.index % 3) }`. The sign alternates with `planet.index % 2`. Planets are placed in a zigzag arc to the left of the sun; the JSON `x`/`y`/`xOffset`/`yOffset` fields on a planet are loaded but **not used** for rendering.

## Fleet Position Invariants

- `fleet.gridCol`/`fleet.gridRow` must always equal `Math.floor(fleet.x)` and `Math.floor(fleet.y)` (or `Math.floor(fleet.system.x) + 1` / `Math.floor(fleet.system.y) + 1` while the fleet is in a system).
- A `Fleet.system` object is present if and only if the fleet is inside a star system. The `id` is the owning system's id; `x`/`y` are in vw on the 18×10 system grid.
- When `fleet.destroyed = true`, the fleet is excluded from:
  - `visibleFleets` (rendering and the fleet-button list)
  - `updateFleets()` (no movement updates)
  - `checkForBattles()` and `checkFleetPlanetArrivals()`
  - `EconomyService.calculateEconomy()` fleet-expense aggregation
- A destroyed fleet's `gridCol`/`gridRow` are not updated. Its `id` and `name` are preserved so it can be re-referenced after a save/load.
- A fleet inside a system has `gridCol`/`gridRow` derived from `system.x`/`system.y` (in vw). When it leaves the system cell on the overworld (`fleet.x`/`fleet.y` no longer match the system's cell), `updateFleets` clears `fleet.system = null`.

## View State Transitions

- On `enterSystem()`:
  - `currentView` is set to `'system'`.
  - Every active fleet whose `x`/`y` cell matches the selected system's cell is given a `SystemLocation` with default position `(2.5, 32.5)` vw if it does not already have one.
  - `gridCol`/`gridRow` are recalculated from `system.x`/`system.y` for fleets in the system.
  - The visible target marker is updated to the selected fleet's `system.targetX`/`system.targetY` if set, otherwise cleared.
- On `leaveSystem()`:
  - `currentView` is set to `'map'`.
  - Every active fleet with a `system.id` has its `gridCol`/`gridRow` recalculated from the map `x`/`y`.
  - `targetX`/`targetY` are restored from the selected fleet's overworld target.
- On `openPlanetView()`: `currentView` is set to `'planet'` (only if the planet is `explored`).
- On `leavePlanetView()`: `currentView` returns to `'system'`.

## Save/Load Invariants

- `StarMap.saveGame()` only writes if `SaveGameService.currentSlot` is not null.
- `loadGame()` early-returns if the loaded data is missing `fleets`, `starSystems`, or `factions`. The current in-memory state is preserved on failure.
- Legacy saves (where `map.width > 150`, i.e. the old 200vw grid) are migrated in `loadGame()`: vw positions are converted to 1-indexed grid cells using a 2vw reference cell size and clamped to `[1, mapWidth]`/`[1, mapHeight]`.
- `destroyedFleetId` is read on load: the matching fleet is marked `destroyed = true`. The id is then dropped from the next save.
- `triggeredBattles` is a `Set<string>` of `"minId-maxId"` pair keys. It is not serialized and is re-created on every `StarMap` instance; pairs of destroyed fleets are filtered out, so a survivor is never re-matched against a destroyed opponent even after reload.

## Pause/Resume Guarantees

- `GameTimeService` is the single source of truth for both pause state and speed.
  It exposes `speed` (GameSpeed: 1 or 2), `isPaused` (boolean), and
  `getScaledDeltaTime(realDeltaTime)` which returns 0 when paused or
  `realDeltaTime * speed` when running.
- The `requestAnimationFrame` loop always runs (never canceled for pause).
  When paused, `getScaledDeltaTime` returns 0, so all simulation systems
  receive a 0 delta and naturally freeze. UI/input remains responsive.
- `StarMap.isPaused` is a read-only getter delegating to `gameTimeService.isPaused`.
  `StarMap.resumeGame()` is a thin wrapper calling `gameTimeService.resume()`,
  preserved for backward compatibility with `StarMapPauseComponent`'s `resumeGame` output.
- `GameTimeService.setSpeed(n)` both sets the speed and un-pauses.
  `GameTimeService.pause()` / `resume()` / `togglePause()` preserve the current speed.
- Window `blur` and document `visibilitychange` (hidden) call `gameTimeService.pause()`
  but do **not** open the pause-menu overlay.
- The "rotate your device" overlay is purely visual; it does not pause or resume the loop.
- Time speed is a runtime/UI preference, not strategic state. It is NOT persisted in
  saves. `GameTimeService.reset()` (called on game start and after loading) restores
  speed=1, isPaused=false, gameElapsedTime=0.
- `ProductionService.tick` early-returns when `deltaTime <= 0` to prevent the
  frame-based stall timeout (`tickCounter`) from advancing during pause.

## Battle State Machine

1. `StarMap` detects a collision (fleet) or planet arrival (planet) → `BattleService.setBattle()` / `setPlanetBattle()` → save → navigate to `/battle`.
2. `BattleScreenComponent.ngOnInit()` calls `BattleService.startBattle()`, which initialises per-ship HP and `BattleState`.
3. A `setInterval(tickRateMs)` (default 1000 ms) calls `BattleService.processStep()` once per tick. `BattleScreenComponent` re-reads the battle and runs change detection.
4. When the battle ends, the timer is stopped and the "Back to Star Map" button becomes visible.
5. On "Back to Star Map":
   - Fleet battle: `loser.destroyed = true`; `setDestroyedFleetId(loser.id)`; `clearBattle()`.
   - Planet battle: `applyPlanetBattleResult()` reloads the save, sets `planet.factionId` to the attacker's faction (if attacker won) or marks the attacker destroyed (otherwise), and writes the save back. `clearBattle()` is also called.
6. `StarMap.reloadAfterBattle()` (subscribed to `Router.events`) reloads the save and calls `removeDestroyedFleetFromService()`, which applies the destroyed fleet id (if any), clears the selection if it matched, and saves again.

## Selection Mutual Exclusion

- Selecting a fleet clears the system and planet tile selection in map view.
- Selecting a system clears the fleet and planet tile selection (system view is the only context where the system may remain selected alongside other state).
- Selecting a planet tile clears the fleet selection; in system view the system may remain selected.
- `selectedFleetAction` is reset to `null` on any new selection. It is also cleared after `moveSelectedFleet` runs from a map click.

## Context Menu Behaviour

- The context menu is shown only when more than one object is registered at the same grid cell (`handleObjectClick`, `onPlanetClick`).
- Map view: fleets and star systems share a cell.
- System view: fleets and planets share a cell.
- Picking a context-menu item routes to the matching `select*` handler. Any open context menu is closed on the next click or selection.

## Economy Invariants

- Stock resources (`credits`, `rawmaterials`, `research`) are accumulated in `faction.currencies`. `credits` is floored on every application; `rawmaterials` and `research` are stored as floats.
- Energy is a flow resource. `faction.currencies.energy` is **not** updated; the value is computed and used only to compute `efficiency`.
- Efficiency is `1.0` when production ≥ consumption; otherwise `production / max(consumption, 1)`. It is averaged across owned planets for the faction-level breakdown.
- The effective per-planet rate applied to a stock resource is `netRate × efficiency × satisfactionMultiplier`. Where applicable, building `production` rates are first scaled by the planet's `workforceEfficiency` (see Workforce, below) inside `EconomyService.calculatePlanetEconomy`; consumption and the `pop * 0.1` credit contribution are **not** workforce-scaled. Credits are additionally scaled by `satisfaction / 100`; raw materials and research are not. Maintenance is not scaled by satisfaction.
- Population contributes `pop * 0.1` credits/s as production (not consumption). That production inherits the satisfaction multiplier because it contributes to credits. It is NOT scaled by workforce efficiency (planet-level income, not a building).
- Building stats are loaded once from `planet-data.json` and indexed by both `id` and `name`; adding a new building requires a JSON change only.
- `PlanetTile.satisfaction` is in `[0, 100]`. When undefined (older saves) it is treated as `100`. It drifts each economy tick by `(energyDirection ±1 + moraleDrift) × deltaTime`, clamped to `[0, 100]`, where:
  - `energyDirection` is `-1` when energy production < consumption, else `+1`.
  - `moraleDrift = PLANET_TYPE_HABITABILITY[planet.type] + Σ building.moraleRate` (habitability base per planet type, plus the per-building `moraleRate`; social/entertainment buildings are positive, heavy industry mildly negative). `moraleRate`/`habitabilityDrift` units are satisfaction points per second of game time.
  - This whole delta is multiplied by `deltaTime` (the game-time accumulator passed from `StarMap`), so morale is frozen while paused and runs 2× at speed 2x — no per-system pause/speed checks are needed.
- When `satisfaction` reaches `0` and `factionId !== 'independent'`, the planet's `factionId` is set to `'independent'` (rebellion). This happens **before** the credits tick for the same frame, so a planet that flips contributes `0` credits on the tick it flips. Once `independent`, `satisfaction` stays at `0` and the planet no longer contributes to any faction's owned-planet economy.
- Energy balance ≥ 0 means the planet is considered powered; `>= 0` (not `> 0`) is the recovery threshold so a perfectly balanced grid counts as healthy.

## Workforce Invariants

- `availableWorkforce` = Σ `providesWorkforce` over residential (`role === 'housing'`) buildings on the planet. `requiredWorkforce` = Σ `workforce` (requirement) over **all** buildings. Both are recomputed from `planet-data.json` each economy calculation — they are never persisted in a save.
- `workforceEfficiency = requiredWorkforce > 0 ? min(1, max(0, available / required)) : 1` (floor 0). When there are no workforce consumers, efficiency is 1 (no stall).
- Building `production` rates are scaled by `workforceEfficiency` in `EconomyService.calculatePlanetEconomy`; this is the single place production is reduced by a workforce shortfall. `production.service.ts` (ship build queues) is **not** affected — workforce efficiency only gates resource extraction/processing output, not ship manufacturing progress.
- Workforce has no save/load impact: `providesWorkforce` is a static data field in `planet-data.json` looked up by building name, and `PlanetBuilding` only stores `name`/`size`/`x`/`y`. Old saves load unchanged.
- Workforce does **not** gate morale drift or satisfaction directly; it only scales production. A planet can be fully satisfied yet unproductive if understaffed.

## Population Growth Invariants

- Population grows continuously via `EconomyService.applyEconomyDelta`, driven by the **same 1s game-time accumulator** (`StarMap.economyAccumulator`) that drives satisfaction drift. The per-tick growth is `POPULATION_GROWTH_BASE_RATE (0.005/s) × satisfactionMultiplier × habitabilityMultiplier × capacityRemaining × deltaTime`, so it is **frozen while paused** (`deltaTime === 0`) and runs **2× at speed 2x** — no independent timers or per-planet update loops, mirroring morale drift.
- `capacityRemaining = max(0, populationCapacity - population)`. `populationCapacity` is the sum of the `population` field of all residential (`role === 'housing'`) buildings on the planet (Small 100 / Medium 300 / Large 700 from `planet-data.json`). Growth is applied as a float and **clamped to capacity**, so a planet at capacity grows by 0.
- `satisfactionMultiplier = clamp(satisfaction / 100, 0, 1)`. Independent planets have `satisfaction` locked at `0`, so they never grow.
- `habitabilityMultiplier = max(0, 1 + PLANET_TYPE_HABITABILITY[planet.type])` — note `PLANET_TYPE_HABITABILITY` is a **satisfaction drift** value, not a 0..1 score: the multiplier is `1 + drift` (`earthlike`/`gasgiant` = 1.0; `desert`/`venuslike` = 0.95; `marslike` = 0.97; `ice` = 0.92). This multiplier is independent of the morale-drift path that *also* uses habitability for satisfaction.
- Growth is written as a float to `planet.population` and is never floored (unlike `credits`); UI rounds for display only via the `number:'1.0-0'` pipe in `star-map-planet-info` and `star-map-planet-screen`.
- `PlanetTile.population` is optional in saves (older saves are treated as `0`); growth writes back a concrete number regardless.

## Camera Invariants

- The camera is clamped to the map bounds after every move (`clampCamera`) using the **current** cell size and viewport aspect ratio, not the values present at component init.
- On viewport resize, the camera is scaled by `newCellSize / oldCellSize` so the same grid area remains under the same viewport point.
- The background is sized to 200% of the map grid extent and translated at `0.3 * cameraX/Y` for parallax; the getters `bgWidthVw`, `bgHeightVw`, `bgLeftVw`, `bgTopVw` keep it centered on the viewport at all times.
  - Camera speed is `2` vw per arrow-key press or navigation-component event, not time-based.

## Sensor Range & Fog-of-War Invariants

- Each fleet has a `sensorRange` field (default 3 if missing from save data). This field is a **minimum floor** — the effective range can be higher when individual ships have a greater `ShipType.range`. The range is in galaxy grid cells and defines a Euclidean circle of visibility.
- Sensor ranges are computed around integer grid positions: `Math.floor(fleet.x)` for fleets and `system.gridCol`/`system.gridRow` for star systems.
- Player-owned star systems (≥1 planet with `factionId === 'player'`) provide a fixed 5-grid sensor radius regardless of fleet presence.
- Only **player** sensor ranges are highlighted on the galaxy map. Enemy fleet sensor ranges are never shown.
- `exploredGridCells` (a `Set<string>` of `"col-row"` keys, persisted as `string[]`) is monotonic: once a cell is explored it stays explored forever.
- `StarSystem.explored` is set to `true` when the system's grid cell enters any player sensor range, and never reset to `false`.
- `PlanetTile.explored` is set to `true` when the planet's system-view grid cell is within a player fleet's sensor range (Euclidean distance on the 18×10 system grid).
- Enemy/neutral fleets are hidden on the galaxy map when their grid cell is not in the player's sensor range. They remain tracked for battle detection (which uses raw fleet data, not visibility-filtered).
- In system view, all fleets in the current system are visible (player is physically present).
- Fog cells (unexplored viewport cells) are culled to the camera viewport + 1-cell buffer for performance on the 100×60 grid.
- The minimap renders only explored star systems and visible fleets.
- A fleet's effective sensor range is `max(fleet.sensorRange, maxShipRange)` where `maxShipRange` is the highest `ShipType.range` among the fleet's non-destroyed ships (0 if no non-destroyed ships). Computed by `StarMapSensorService.getFleetSensorRange()`.
- Old saves without `exploredGridCells` or `StarSystem.explored` default to all systems explored (no fog-of-war regression). `Fleet.sensorRange` (minimum floor) defaults to 3.
- `visibleFleets` filters out both destroyed fleets and fleets hidden by fog-of-war. The fleet-buttons sidebar and minimap use this filtered list.

## Ship Production & Fleet Assembly Invariants

- `StarMapData.shipStock` and `StarMapData.production` are empire-scoped (per faction), never planet-scoped. Adding ships to a faction's stock, removing from it, or queueing a production order never mutates another faction's data.
- A `ShipStockEntry` has the same `{id, type, name}` shape as a `FleetShip` so `FleetAssemblyService` can push a stock entry into `fleet.ships` and existing battle / sensor / movement code reads it without changes.
- Stock ship ids share the same id space as `FleetShip.id` and are unique per save (`ShipStockService.nextShipId` walks every fleet and every stock entry to allocate).
- A `Spaceport` building is a permission flag, not a storage depot. The faction must have ≥1 such building on an owned planet to call `FleetAssemblyService.createFleet` or `reinforceFleet`. New fleets are placed at the host `StarSystem.x/y`; they may immediately be ordered to move.
- Production completion is the only way new entries enter the stock: `ProductionService.tick` mints `ShipStockEntry`s and pushes them into `ShipStockService.addToStock` (`production.service.ts:230-244`).
- Resource cost for a `ProductionOrder` is deducted from `faction.currencies['credits']` at queue time, not per-tick. `cancelOrder` and auto-cancel on factory loss refund the **un-built** portion only.
- Per-planet production capacity = `count(Spaceship Factory on planet)`. Per-planet production power = same count × `0.5` progress/s. A `ShipType` whose `productionBuilding` is `orbital_factory` is rejected by `ProductionService.queueOrder` on planets lacking an Orbital Factory.
- `ProductionService.tick` is called every frame from the `StarMap` game loop alongside `updateFleets` and the 1s `applyEconomyDelta`. The service is data-driven: it reads `planet.buildings` each tick so destroying a factory mid-build takes effect on the next tick (the order is then auto-cancelled after a stall timeout of 30s with a proportional refund).
- `FleetAssemblyService.createFleet` allocates a new `Fleet.id` strictly greater than every existing fleet id (in fleets and stock). The new fleet is appended to `data.fleets`; existing movement / combat / economy code observes it without any further wiring.
- `FleetAssemblyService.disbandFleet` returns surviving `FleetShip`s to the stock and marks the fleet `destroyed = true`. Destroyed ships in the fleet are lost (matches IG1). After disband the fleet is filtered out of `visibleFleets`, `updateFleets`, the battle detection pass, and `EconomyService.calculateEconomy` exactly like a battle-loss.
- Reinforcement uses the same `stock -> fleet` path as creation; no fleet state outside `fleet.ships` is touched.
- `SaveGameService.migrateSave` backfills `shipStock: []` and `production: []` so older saves load unchanged. Production `progress` and per-fleet composition both persist via the existing `StarMapData` root snapshot.


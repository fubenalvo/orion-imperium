# Game Systems

## Star Map

The `StarMap` component (`src/app/components/star-map/star-map.ts`) is the central gameplay view. It is an orchestrator: pure logic lives in dedicated services, UI is split across child components, and the component itself mainly wires them together and forwards events.

### Views

`StarMap` exposes three sub-views, switched by the `currentView` field:

- **`map`** – Galaxy view. Star systems and fleets are positioned on a `map.width` × `map.height` grid of cells. `cellSizeVw` and `cellSizeVh` (both 2 on desktop, 3.5 on mobile) define the rendered size of each cell. `gridBreakpointPx` (1300) decides which cell size is used.
- **`system`** – Inside a star system. Fleets are positioned in vw units on a separate 18×10 grid with 5vw cells (`StarMapMovementService.SYSTEM_CELL_SIZE_VW`). Planets are arranged in a zigzag arc to the left of the sun via `getPlanetGridPosition()`: column = `13 - planet.index`, row = `6 ± (planet.index % 3)` with a sign that alternates by `planet.index % 2`.
- **`planet`** – Planet surface. A grid of size `numericPlanetSize * 2 + 3` is overlaid on a noise-textured, type-colored background. The player can place new buildings here.

### Game Loop

`StarMapGameLoopService` owns the `requestAnimationFrame` loop and always runs outside the Angular zone. The component provides an update callback that:

1. Calls `StarMapMovementService.updateFleets()` with `deltaTime` (clamped to 0.1s).
2. Calls `updateExploredPlanets()` (system view only) and `checkFleetPlanetArrivals()` (system view only).
3. Calls `StarMapBattleDetectionService.checkForBattles()`.
4. Every `economyTickInterval` (1s) of accumulated `deltaTime`, runs `EconomyService.applyEconomyDelta()` for every faction and refreshes the cached player economy breakdown.
5. Triggers `cdr.detectChanges()` only when fleets actually moved or the economy tick fired.

The loop is paused by `StarMapGameLoopService.pauseGame()` and resumed with `resumeGame()`. `stopGameLoop()` is used on component destroy. `isPaused` is a separate flag tracked by `StarMap` (it does not close the pause-menu overlay).

### Pause and Focus

- Window `blur` and document `visibilitychange` (hidden) call `pauseGame()` automatically.
- Portrait orientation shows a "rotate your device" overlay; landscape is required to play.
- Opening the pause menu pauses the game; closing the menu resumes it.
- `ngOnDestroy` saves the game, unsubscribes from router events, removes all focus/orientation/drag listeners, and stops the loop.

### Camera and Drag

- `cameraSpeed = 2` vw per arrow-key press.
- Arrow keys (`window:keydown`), the navigation component, and pointer drag all pan the camera.
- The map viewport uses pointer capture for drag-to-pan. A small movement threshold (`dragThreshold = 5` px) distinguishes drag from click. If the pointer didn't move, the up-event dispatches a normal `onMapClick`.
- Camera is clamped to the map bounds after every move (`clampCamera`) using the current cell size and viewport aspect ratio.
- Background is rendered at 200% of the grid extent and translated at `0.3 * cameraX/Y` for parallax. The `bgWidthVw`, `bgHeightVw`, `bgLeftVw`, `bgTopVw` getters on `StarMap` keep the background centered on the viewport at all times.

### Selection

At most one of `selectedSystem`, `selectedFleet`, `selectedPlanetTile` is active at a time. Mutual exclusion:

- Selecting a fleet clears the system and planet selection (in map view).
- Selecting a system clears the fleet and planet selection, unless in system view.
- Selecting a planet tile clears the fleet selection; the system may stay selected in system view.
- `selectedFleetAction` is cleared on any new selection (it is also cleared when the fleet reaches its target).

`selectedFleetAction` is currently limited to `'move'`. When set, the next click on the map (`onMapClick`) or system grid (`onSystemGridClick`) translates the click into a 1-indexed grid target and assigns it to the selected fleet. The action is then cleared.

### Movement

Fleet movement is target-based. Each frame, `StarMapMovementService.updateFleets()` processes every active fleet:

- **Map movement** uses `fleet.targetX` / `fleet.targetY` (1-indexed grid cells). Speed is in vw/s and is converted to cells/s via `fleet.speed / cellSizeVw` before applying. When the remaining distance is below 0.01, the fleet snaps to the target, clears the target, and fires the `onTargetReached` callback (used to clear the visible target marker). If the fleet has a `system.id` and is no longer inside that system cell, `onLeaveSystem` is invoked, which clears `fleet.system`.
- **System movement** uses `fleet.system.targetX` / `fleet.system.targetY` in vw units. Speed is in vw/s and applied directly (no cell conversion). Same target-reached / snap behaviour. While in the system, `gridCol`/`gridRow` are derived from `calculateSystemGridCell(system.x, system.y)`.

After every move, `gridCol` and `gridRow` are refreshed from the current x/y. `refreshGridPositions()` does the same for every fleet and system and is called on load, after resize, and on every reload from a save.

### Planet Arrivals

`checkFleetPlanetArrivals()` runs every frame in system view. For every fleet that has stopped on a planet's grid cell, it invokes `handleFleetPlanetArrival()`:

1. **Uninhabited planet** — `PlanetBattleService.resolveUninhabitedArrival()` looks for a non-destroyed `colonizer` ship. If found, the colonizer is removed, the planet's `factionId` becomes the fleet's `factionId`, and the game is saved.
2. **Same-faction planet** — Logged and ignored.
3. **Teammate planet** — Logged and ignored.
4. **Undefended enemy planet** — Captured immediately (`planet.factionId = fleet.factionId`).
5. **Defended enemy planet** — `triggerPlanetBattle()` builds a virtual defense fleet (`PlanetBattleService.createVirtualDefenseFleet()`), calls `BattleService.setPlanetBattle()`, saves, and navigates to `/battle`.

A `Map<number, number>` (`fleetPlanetMap`) tracks the last planet id each fleet arrived on so the same planet is not processed twice in a row.

### Battle Detection

`StarMapBattleDetectionService.checkForBattles()` scans every active fleet pair. A battle is triggered when two fleets share a grid cell, both have a faction, neither is neutral (team 0), they are on different teams, and the pair has not already triggered a battle (tracked by a `Set<string>` keyed on the sorted pair of fleet ids). The fleet that has a `targetX`/`targetY` is treated as the attacker; the other is the defender. On trigger, the game is saved and the router navigates to `/battle`.

## Economy

`EconomyService` is a data-driven system that derives production, consumption, maintenance, and efficiency from `planet-data.json`.

- **Stock resources** are accumulated: `credits`, `rawmaterials`, `research`. Credits are floored on accumulation; the other two are stored as floats.
- **Energy** is a flow resource. It is never accumulated, only used to compute efficiency. If `energyProduction >= energyConsumption`, efficiency is 1.0; otherwise efficiency = `energyProduction / max(energyConsumption, 1)`. The effective rate applied per stock resource is `netRate * efficiency`.
- **Building stats** are read once from `planet-data.json` (indexed by `id` and by `name`) and applied generically, so adding a new building requires no code change.
- **Population** contributes `population * 0.1` credits/s as a planet-level production source.
- **Maintenance** comes from `building.maintenanceCost` (per building instance) and `shipType.maintenanceCost` (per non-destroyed ship in non-destroyed fleets).
- The same service exposes `getPlanetTax(planet)` (legacy `pop*0.1 + factories*500`) and `getPlanetEnergy(planet)` for callers that still expect them.
- `EconomyService.applyEconomyDelta()` is called once per second for every faction. It mutates `faction.currencies` only; it never changes the saved snapshot directly.

`FactionCurrenciesComponent` shows the current balances and provides an expandable breakdown per planet (income, expense, net, efficiency, per-building maintenance).

## Planet Surface

`StarMapPlanetScreenComponent` renders the surface grid for a single planet. Behaviour:

- The grid is `numericSize * 2 + 3` cells per side (`5, 7, 9, 11`).
- A build menu lists every `building` from `planet-data.json`.
- Selecting a building type enters build mode; clicking a cell highlights the building's footprint and reveals a BUILD button if placement is valid.
- Confirming a build deducts the building's `price` from the player's credits and appends a new `PlanetBuilding` (with the chosen `x`/`y`) to `planet.buildings`.
- The same component is reused across the system view (when a planet is selected) and the planet view.

## Save System

- 4 save slots are stored in `localStorage` under the key `orion_save_slots`.
- Each slot contains a full `StarMapData` snapshot plus an ISO date string.
- The service exposes `getSlots`, `getSlot(i)`, `saveToSlot(i, data)`, `loadFromSlot(i)`, `clearSlot(i)`, `hasAnySave`, and `getMostRecentSlotIndex`.
- `currentSlot` is the only piece of state kept on the service itself; it is set by `MainMenu` (new game / load) and by `StarMap` when loading via the pause menu.
- `StarMap.saveGame()` is called on: entering a system, leaving a system, opening the planet view, leaving the planet view, opening the pause menu, exiting to the main menu, battle trigger (both fleet and planet), planet colonization, planet capture, and on `ngOnDestroy`.
- Loading happens in `loadGame()` from the pause menu or on `ngOnInit` when the user reaches `/star-map` without going through the main menu. If `currentSlot` is null but a save exists, the most recent slot is auto-selected; if no save exists, the user is redirected to the main menu.
- Legacy saves (where `map.width > 150`, i.e. the old 200vw grid) are migrated: every system and fleet `x`/`y` is converted from vw to 1-indexed grid cells using a 2vw reference cell size.
- `destroyedFleetId` is stored as part of the save so that the destruction persists across reloads.

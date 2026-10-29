# Game Systems

## Star Map

The `StarMap` component (`src/app/components/star-map/star-map.ts`) is the central gameplay view. It is an orchestrator: pure logic lives in dedicated services, UI is split across child components, and the component itself mainly wires them together and forwards events.

### Views

`StarMap` exposes three sub-views, switched by the `currentView` field:

- **`map`** – Galaxy view. Star systems and fleets are positioned on a `map.width` × `map.height` grid of cells. `cellSizeVw` and `cellSizeVh` (both 2 on desktop, 3.5 on mobile) define the rendered size of each cell. `gridBreakpointPx` (1300) decides which cell size is used.
- **`system`** – Inside a star system. Fleets are positioned in vw units on a separate 18×10 grid with 5vw cells (`StarMapMovementService.SYSTEM_CELL_SIZE_VW`). Planets are arranged in a zigzag arc to the left of the sun via `getPlanetGridPosition()`: column = `13 - planet.index`, row = `6 ± (planet.index % 3)` with a sign that alternates by `planet.index % 2`.
- **`planet`** – Planet surface. A grid of size `numericPlanetSize * 2 + 3` is overlaid on a noise-textured, type-colored background. The player can place new buildings here.

### Fog of War & Sensor Range

Sensor range determines which grid cells a fleet (or player-owned star system) can "see". All sensor ranges are Euclidean circles (`dx² + dy² <= range²`).

**Sources of sensor range (galaxy map, player faction only):**

1. **Player fleets** — each fleet has a `sensorRange` field (default 3 grid cells) which serves as a **minimum floor**. The effective range is `max(fleet.sensorRange, max ShipType.range among non-destroyed ships)` — if any ship in the fleet has a longer `range`, that ship's range is used instead — plus `SENSOR_RANGE_GLOBAL_BONUS` (2 cells, applied to every sensor source, player and AI, galaxy and system view). The effective range is centered on the fleet's current integer grid position (`Math.floor(fleet.x)`, `Math.floor(fleet.y)`).
2. **Player-owned star systems** — any star system containing at least one planet with `factionId === 'player'` provides a fixed 7-grid-radius sensor range (5 + the global +2 bonus), centered on the system's grid cell. This is the "base visibility" — your home territory is always partially detected even without a fleet present.

**Rendering:**

- Grid cells within sensor range are highlighted with a semi-transparent faction-colored overlay (`.sensor-range-cell` with `--sensor-color` CSS variable). Player sensors use the player faction color (`#8cc4ff`).
- A toggle button in the top HUD (`sensorRangeEnabled`) shows/hides the highlight overlays and fog.
- Enemy fleet sensor ranges are **never** shown on the galaxy map — only player sensors are visible.
- AI factions obey the same fog of war with the same sensor rules (per-faction knowledge in `EnemyIntelService`, see [AI Pipeline](./ai-pipeline.md#fog-of-war-enemyintelservice)); with fog disabled they see what the player sees.
- **Nebulae** shorten sensor radii: a source inside a nebula, or a target cell inside one, is sensed at 60% of the radius (applied once). Player layer and AI intel share this rule; see [Star Map Terrain](./star-map-terrain.md#sensor-penalty).
- A pulsing animation (`sensor-pulse`, 2.5s) highlights active sensor area.
- **Fog strength:** unexplored cells are covered at 88% black, explored cells outside current sensor range at 55%. All terrain (nebulae, asteroid belts, the black hole and its no-fly ring) is drawn *under* the fog layer, so anything not yet explored is strongly dimmed; fleets, trails, markers and visible drifting asteroids stay above it.
- **Minimap fog:** the minimap darkens every unexplored cell (97% opacity, so unexplored content shows at ~3% brightness) over terrain and stars, under fleets and the viewport frame. It is one SVG path of per-row runs, rebuilt only when the explored set grows; hidden when fog of war is off.

**Exploration tracking:**

- `exploredGridCells` (`Set<string>` of `"col-row"` keys, persisted as `string[]` in saves) tracks every galaxy grid cell the player has ever sensed. Once explored, a cell stays explored.
- `StarSystem.explored` is set to `true` when the system's grid cell falls within any player sensor range. Only explored systems are rendered and selectable on the galaxy map.
- `PlanetTile.explored` is set to `true` when the planet's system-view grid cell falls within a player fleet's sensor range in the system view (replacing the previous exact-cell-match logic).

**Fog of war layers (galaxy map):**

- **Black fog** — cells never explored, fully hidden (dark `rgba(0,0,0,0.85)` overlay).
- **Grey fog** — cells previously explored but currently outside sensor range (`rgba(0,0,0,0.45)`), still visible but dimmed.
- **Visible** — cells currently in sensor range, shown with faction-colored highlight.

Fog cells are viewport-culled (only cells within the camera's visible area + 1-cell buffer are rendered) for performance on the 100×60 grid.

**Fleet visibility:**

- Player fleets are always visible.
- Enemy/neutral fleets are **hidden** when their grid cell is not in the player's sensor range. Hidden fleets are still tracked for battle detection (which operates on raw fleet data, not visibility).
- In system view, all fleets in the current system are visible (the player is physically present).

**Minimap:** Only explored star systems and visible fleets are shown.

**Backward compatibility:** Old saves without `exploredGridCells` or `StarSystem.explored` default to all systems explored (no fog-of-war regression). `Fleet.sensorRange` (minimum floor) defaults to 3 when absent.

### Game Loop

`GameTimeService` (`src/app/services/game-time.service.ts`) is the single owner of
pause state and speed. It exposes `speed` (1 or 2), `isPaused` (boolean), and
`getScaledDeltaTime(realDeltaTime)` — the only place in the codebase where the
speed multiplier is applied.

`StarMapGameLoopService` owns the `requestAnimationFrame` loop and always runs
outside the Angular zone. It always runs — it is never canceled for pause. Each
frame:

1. Computes `realDeltaTime = Math.min((time - lastFrameTime) / 1000, 0.1)` (clamped
   to 0.1 s to prevent spikes when the tab is suspended).
2. Calls `gameTimeService.onTick(realDeltaTime)` to accumulate `gameElapsedTime`.
3. Calls `gameTimeService.getScaledDeltaTime(realDeltaTime)` to get the **scaled**
   game delta: `0` when paused, `realDeltaTime * speed` when running.
4. Passes the scaled delta to the component's update callback.

The update callback (consolidated into `StarMap.gameLoopCallback`):

1. Calls `StarMapMovementService.updateFleets()` with the scaled `gameDeltaTime`.
2. Calls `updateExploredPlanets()` (system view only) and `checkFleetPlanetArrivals()`
   (system view only).
3. Calls `StarMapSensorService.computeGalaxySensorCells()` to recompute the current
   sensor range cells, updates `exploredGridCells` (persistent), marks star systems
   as explored, and updates fog cell rendering.
4. Calls `StarMapBattleDetectionService.checkForBattles()`.
5. Every `economyTickInterval` (1 s) of accumulated **game** `deltaTime`, runs
   `EconomyService.applyEconomyDelta()` for every faction and refreshes the cached
   player economy breakdown.
6. Calls `ProductionService.tick()` with the scaled `gameDeltaTime`. When paused
   (deltaTime = 0), `ProductionService.tick` early-returns to prevent frame-based
   stall detection from firing.
7. Triggers `cdr.detectChanges()` only when fleets moved, the economy tick fired,
   sensor visibility changed, or production state changed.

The loop is paused by `GameTimeService.pause()` and resumed with `GameTimeService.resume()`.
When paused, the loop continues to run (producing `gameDelta = 0`) so UI/input stays
responsive. `stopGameLoop()` is used on component destroy.

### Pause and Focus

- Keyboard: `Space` toggles pause/resume, `1` sets 1× speed, `2` sets 2× speed.
- Window `blur` and document `visibilitychange` (hidden) call `gameTimeService.pause()`.
- The pause menu overlay (in `StarMapPauseComponent`) shows when `isPaused || pauseMenuOpen`.
- Portrait orientation shows a "rotate your device" overlay; landscape is required to play.
- Opening the pause menu pauses the game; closing the menu resumes it.

### Camera and Drag

- `cameraSpeed = 2` vw per arrow-key press.
- Arrow keys (`window:keydown`), the navigation component, and pointer drag all pan the camera.
- The map viewport uses pointer capture for drag-to-pan. A small movement threshold (`dragThreshold = 5` px) distinguishes drag from click. If the pointer didn't move, the up-event dispatches a normal `onMapClick`.
- `cameraX`/`cameraY` are world-space (unscaled) vw coordinates of the viewport's top-left corner. The visible world extent is `visibleWidthVw = 100 / zoom` by `visibleHeightVw = viewportHeightVw / zoom`; the viewport height in vw depends on the aspect ratio, so horizontal and vertical centering must never share a constant.
- Camera is clamped to the map bounds after every move (`clampCamera`) using the current cell size, viewport aspect ratio, and zoom. If the whole grid fits on an axis (small galaxy at a far zoom), the grid is centered on that axis instead.
- Selecting a fleet (map view) and the system/planet default view center the camera through `centerCameraOnGridPosition`, which puts the grid position's render point (`(x - 0.5) * cellSize`) on the viewport center at any aspect ratio and zoom. Near the map edges the clamp wins, so the target can be off-center there. Focusing never changes the zoom level.

### Galaxy Map Zoom

- Discrete levels in `StarMap.zoomLevels` = `[1, 0.75, 0.5, 0.35]`; `1` is the original (closest) view, the other three are zoom-out steps. There is no zoom-in beyond `1`.
- Mouse wheel over the map viewport (`onMapWheel`) moves one level per gesture (wheel down = out), clamped to the ends of the list. A 150 ms cooldown stops trackpad/free-spin bursts from skipping levels. The wheel event is always `preventDefault`ed so the page does not scroll.
- Zooming keeps the world point under the cursor fixed (`setZoomIndex` with a screen anchor).
- Rendering: `StarMapGalaxyViewComponent.worldTransform` = `translate(-camera * zoom vw) scale(zoom)` with `transform-origin: 0 0` on `.map-world`. All world content (systems, fleets, trails, fog, target marker) is inside `.map-world`, so it scales together; the grid coordinate system and cell sizes are unchanged.
- Every screen→world conversion (map click, drag, arrow/d-pad pan step, fog culling, minimap viewport rectangle and click-to-center) divides screen vw by `zoom`. The minimap receives the visible extent through `viewportWidthVw`/`viewportHeightVw`.
- Zoom is a view preference and is not saved; the saved camera is in world units, so it is valid at any zoom. Parallax background layers stay in screen space and are not scaled.
- More visible area means more viewport-culled fog cells are rendered at far zoom levels.
- Background is rendered at 200% of the grid extent and translated at `0.3 * cameraX/Y` for parallax. The `bgWidthVw`, `bgHeightVw`, `bgLeftVw`, `bgTopVw` getters on `StarMap` keep the background centered on the viewport at all times.

### Selection

At most one of `selectedSystem`, `selectedFleet`, `selectedPlanetTile` is active at a time. Mutual exclusion:

- Selecting a fleet clears the system and planet selection (in map view).
- Selecting a system clears the fleet and planet selection, unless in system view.
- Selecting a planet tile clears the fleet selection; the system may stay selected in system view.
- `selectedFleetAction` is cleared on any new selection (it is also cleared when the fleet reaches its target).

`selectedFleetAction` is currently limited to `'move'`. When set, the next click on the map (`onMapClick`) or system grid (`onSystemGridClick`) translates the click into a 1-indexed grid target and assigns it to the selected fleet. The action is then cleared.

**Right-click orders** (alternative to the MOVE button, which keeps working): with a player fleet selected, a right-click issues an order based on what is under the cursor — empty galaxy/system space, a star system, a planet, or a friendly/neutral fleet → move there (moving onto an enemy planet is the planet attack, handled by planet arrival); a hostile fleet on the galaxy map (same hostility rule as battle detection: different teams, neither neutral) → **attack order**; a drifting asteroid → intercept order; the selected fleet itself → deselect. Every order goes through `moveSelectedFleet`, so the usual validation and fleet-panel rejection messages apply. Without a selected player fleet a right-click keeps its old meaning (clear the clicked object type's selection). The native browser menu is suppressed on the map, and the right button never starts a camera drag.

**Attack orders** (`fleet-attack-orders.ts`, `Fleet.attackFleetId`, player only): the attacker pursues the quarry — each frame its galaxy target is re-aimed at the quarry's position once it drifted ≥ 0.5 cell (routing applies; re-aiming stops while both share a cell). Combat is not special-cased: the regular battle detection fires when they meet. The order ends when the quarry is destroyed/gone or no longer hostile, leaves the player's sensor picture ("lost contact" notice), or becomes unreachable (notice); the fleet then flies on to the last aimed point. Any manual move or intercept order replaces it. The fleet panel shows `ATTACKING <fleet>`.

### Movement

Fleet movement is target-based. Each frame, `StarMapMovementService.updateFleets()` processes every active fleet:

- **Map movement** uses `fleet.targetX` / `fleet.targetY` (1-indexed grid cells). Speed is in vw/s and is converted to cells/s via `fleet.speed / 10 / GALAXY_MOVEMENT_CELL_SIZE_VW` (a fixed 2 = the desktop cell size) before applying; the rendered cell size never affects travel time. When the remaining distance is below 0.01, the fleet snaps to the target, clears the target, and fires the `onTargetReached` callback (used to clear the visible target marker). If the fleet has a `system.id` and is no longer inside that system cell, `onLeaveSystem` is invoked, which clears `fleet.system`.
- **System movement** uses `fleet.system.targetX` / `fleet.system.targetY` in vw units. Speed is in vw/s and applied directly (no cell conversion). Same target-reached / snap behaviour. While in the system, `gridCol`/`gridRow` are derived from `calculateSystemGridCell(system.x, system.y)`.

Player move commands in system view are rejected by `StarMap.validateFleetMove` when the target cell is an allied (same team, not player-owned) planet, or a player planet where another living player fleet is already stationed. A rejected command changes nothing; its reason is shown in the fleet panel (`StarMap.fleetMoveError`, worded by `StarMapPanelVmService.describeFleetMoveRejection`) until the next accepted move or a selection change.

**Galaxy terrain** (see [Star Map Terrain](./star-map-terrain.md)): every galaxy target is routed around black hole no-fly zones and asteroid belts (cached `NavGraph`; the target stays the final destination, the waypoints are a runtime cache); a target that cannot be reached safely is rejected (player orders, with a fleet-panel message) or dropped (orders that became invalid) and the fleet stays put — never flying through. Inside a nebula the galaxy speed is × 0.7, evaluated per step at the fleet's position. Trails are drawn per route leg and the fleet panel shows the ETA including both effects.

**Fleet markers** (galaxy map and system view share the same look): the frame is four thin corner brackets in the owning faction's color (`--fleet-color`); a selected fleet gets longer, brighter brackets and a faint glow. The ship glyph is the shared `FleetShipComponent` (`fleet-ship/`): the hull artwork (`public/fleet.svg`, nose pointing right, so `FLEET_SPRITE_FORWARD_DEG` = 0) plus an engine trail anchored to its rear inside the same rotated element, so the trail always points backward. The trail fades/scales in while the fleet has a target (galaxy `targetX/Y`, system view `system.targetX/Y`) and out when it stops; it ignores pointer events, so clicks still hit the fleet button.

**Ship headings** (`fleet-heading.ts`, render-only, never saved): `StarMap.updateFleetHeadings` runs every frame after movement with one `FleetHeadingTracker` per view. The desired heading points at the next galaxy route waypoint (or the target), converted to screen space with `cellSizeVw`/`cellSizeVh`; in the system view it points at the in-system target (uniform vw). Ships turn along the shortest arc with a frame-rate-independent exponential approach (`FLEET_TURN_RATE_PER_SECOND`) driven by the scaled game delta, so turning freezes while paused. Stationary fleets keep their last heading; fleets never moved face right. A heading change alone triggers a redraw but does not mark the save dirty.

After every move, `gridCol` and `gridRow` are refreshed from the current x/y. `refreshGridPositions()` does the same for every fleet and system and is called on load, after resize, and on every reload from a save.

### Planet Arrivals

`checkFleetPlanetArrivals()` runs every frame in system view. For every fleet that has stopped on a planet's grid cell, it invokes `handleFleetPlanetArrival()`:

1. **Uninhabited planet** — `PlanetBattleService.resolveUninhabitedArrival()` looks for a non-destroyed `colonizer` ship. If found, the colonizer is removed, the planet's `factionId` becomes the fleet's `factionId`, and the game is saved.
2. **Same-faction planet** — Logged and ignored.
3. **Teammate planet** — Logged and ignored.
4. **Undefended enemy planet** — Captured immediately (through `PlanetOwnershipService.transferPlanet`, the single ownership pathway — see [Planet Capture](./planet-capture.md)). This arrival handling only runs for the system the player is viewing; AI fleets capture planets through `EnemyInvasionService` on galaxy-map cells instead.
5. **Defended enemy planet** — `triggerPlanetBattle()` builds a virtual defense fleet (`PlanetBattleService.createVirtualDefenseFleet()`), calls `BattleService.setPlanetBattle()`, saves, and navigates to `/battle`.

A `Map<number, number>` (`fleetPlanetMap`) tracks the last planet id each fleet arrived on so the same planet is not processed twice in a row.

### Battle Detection

`StarMapBattleDetectionService.checkForBattles()` scans every active fleet pair. A battle is triggered when two fleets share a grid cell, both have a faction, neither is neutral (team 0), they are on different teams, and the pair has not already triggered a battle (tracked by a `Set<string>` keyed on the sorted pair of fleet ids). The fleet that has a `targetX`/`targetY` is treated as the attacker; the other is the defender. On trigger, the game is saved and the router navigates to `/battle`.

## Economy

`EconomyService` is a data-driven system that derives production, consumption, maintenance, and efficiency from `planet-data.json`.

- **Stock resources** are accumulated: `credits`, `rawmaterials`, `research`. Credits are integers (fraction carried between ticks); the other two are stored as floats. Buildings and ships cost credits and raw materials; research points buy technologies. Full rules: [Economy](./economy.md).
- **Energy** is a flow resource. It is never accumulated, only used to compute efficiency. If `energyProduction >= energyConsumption`, efficiency is 1.0; otherwise efficiency = `energyProduction / max(energyConsumption, 1)`. The effective rate applied per stock resource is `netRate * efficiency`.
- **Building stats** are read once from `planet-data.json` (indexed by `id` and by `name`) and applied generically, so adding a new building requires no code change.
- **Population** contributes `population * 0.1` credits/s as a planet-level production source.
- **Upkeep** is charged every economy tick: `maintenanceCost` points (× 0.3 credits) per building instance and per non-destroyed ship in non-destroyed fleets, half rate for ships in the stock, plus colony administration (3% of planet income per planet beyond the first, max 45%). At 0 credits unpaid upkeep costs satisfaction (arrears).
- The same service exposes `getPlanetTax(planet)` (legacy `pop*0.1 + factories*500`) and `getPlanetEnergy(planet)` for callers that still expect them.
- `EconomyService.applyEconomyDelta()` is called once per second for every faction. It mutates `faction.currencies`, planet satisfaction/population and (on rebellion) ownership; it never changes the saved snapshot directly.

`FactionCurrenciesComponent` shows the current balances and an expandable breakdown: effective production/consumption/net per resource, building upkeep, colony administration, ship upkeep, unpaid upkeep (arrears), per-planet rows and per-fleet upkeep. These are the same rates the economy tick applies.

## Planet Surface

`StarMapPlanetScreenComponent` renders the surface grid for a single planet. Behaviour:

- The grid is `numericSize * 2 + 3` cells per side (`5, 7, 9, 11`).
- A build menu lists every `building` from `planet-data.json`.
- Selecting a building type enters build mode; clicking a cell highlights the building's footprint and reveals a BUILD button if placement is valid.
- Confirming a build charges the building's `price` (credits) and `rawMaterialCost` through `payCost` (nothing is charged if either is short) and appends a new `PlanetBuilding` (with the chosen `x`/`y`) to `planet.buildings`. The build list shows both costs and disables unaffordable buildings. Confirmation reaches `StarMap.onBuildingConfirmed` through the `buildConfirmed` output only (a second input callback used to place and charge every building twice).
- The same component is reused across the system view (when a planet is selected) and the planet view.
- The sidebar exposes a tab strip with DETAILS, BUILD, PRODUCTION, and ASSEMBLY. Tab visibility is data-driven: BUILD is shown only for player-owned planets, PRODUCTION only when the planet has a Spaceship Factory, and ASSEMBLY only when the planet has a Spaceport. Selecting a tab replaces the sidebar's content area; no floating overlays are mounted outside the sidebar (the production and spaceport panels are re-used inline).
- **Zoom levels:** a CLOSE / MEDIUM / FAR selector (bottom-right of the surface; top-right below 600px width) scales the grid via `PLANET_SURFACE_ZOOM_SCALES` (`1` / `0.75` / `0.55`) inside the grid's inline transform. CLOSE (`1`) is the original framing defined by `PLANET_SURFACE_CELL_VW`; the scale is applied around the grid center, and the pan offset is rescaled on switch so the view does not jump. Pan clamp bounds use the scaled size.
- Zoom is view-only state: it is never stored on the planet, in game state, or in saves. Every planet opening starts at MEDIUM (`DEFAULT_PLANET_SURFACE_ZOOM`) — the component is destroyed when the planet view closes, and a change of planet id resets it. There is no deliberate view-state persistence for the planet view (unlike `currentView`/camera, which the save system restores), so this does not conflict with any existing behaviour.

## Save System

- 5 save slots are stored in `localStorage` under the key `orion_save_slots`: slot 0 (autosave) + slots 1–4 (manual). Each slot contains a full `StarMapData` snapshot plus an ISO date string.
- The service exposes `getSlots`, `getSlot(i)`, `saveToSlot(i, data)`, `loadFromSlot(i)`, `clearSlot(i)`, `hasAnySave`, `getMostRecentSlotIndex`, and `activateSlot(i)`.
- **Autosave is the active session source of truth.** `activateSlot(i)` loads the requested slot and, for a manual slot, copies its full snapshot into autosave before switching `currentSlot` to 0. Session start (new game, manual load, pause-menu load, direct `/star-map` navigation) always normalizes `currentSlot` to autosave.
- Every runtime save (`StarMap.saveGame`), autosave trigger, and battle result therefore writes to the same slot that `loadGame()` and `reloadAfterBattle()` read back. Without this, a stale manual snapshot can resurrect fleets destroyed in earlier battles once the player returns from a later battle.
- Manual slots remain explicit snapshots: they are not mutated by activation and are only written to when the player explicitly saves to one.
- `currentSlot` is the only piece of state kept on the service itself; it is set by `MainMenu` (new game / load) and by `StarMap` when loading via the pause menu.
- New games are procedurally generated (see [New Game Generation](./new-game-generation.md)): `NewGameService` writes the validated galaxy to the chosen manual slot and activates it. From then on it is an ordinary save — loading never regenerates the galaxy.
- `StarMap.saveGame()` is called on: entering a system, leaving a system, opening the planet view, leaving the planet view, opening the pause menu, exiting to the main menu, battle trigger (both fleet and planet), planet colonization, planet capture, and on `ngOnDestroy`.
- Loading happens in `loadGame()` from the pause menu or on `ngOnInit` when the user reaches `/star-map` without going through the main menu. If `currentSlot` is null but a save exists, the most recent slot is auto-selected; if no save exists, the user is redirected to the main menu.
- Legacy saves (where `map.width > 150`, i.e. the old 200vw grid) are migrated: every system and fleet `x`/`y` is converted from vw to 1-indexed grid cells using a 2vw reference cell size.
- `destroyedFleetId` is stored as part of the save so that the destruction persists across reloads.

## New Game Setup & AI Difficulty

- The New Game screen configures galaxy size (Small / Medium / Large), 2–6 participants (name, color, Human/AI, AI difficulty), an optional seed, and the target save slot. Exactly one participant is human.
- AI difficulty is per faction and feeds the existing pipeline: `EnemyStrategyService` uses the faction's attack strength advantage, `EconomyService` scales the faction's positive income, and the generator scales starting resources, fleets and colonies. Full table and rules: [New Game Generation](./new-game-generation.md).

# StarMap Refactor Plan (Behavior-Preserving, Moderate Scope)

Refactor `src/app/components/star-map/star-map.ts` (2,654 lines) into focused child components and services with **100% behavior preservation**. Scope confirmed by user: **Moderate** (presentational extraction + 4 logic extractions; camera, save/load, selection, game-loop orchestration stay in `StarMap`).

## Non-negotiable constraints (verified against code)

1. `star-map.spec.ts` accesses private members: `component['gameLoopCallback']`, `['saveGame']`, `['reloadAfterBattle']`, `['ngZone']`, `['cdr']`, plus public `fleets`, `factions`, `starSystems`, `shipStock`, `production`, `loadGame()`, `loadFromMenu()`. All of these MUST remain members of `StarMap`.
2. Services already receive the component structurally (`shipStockService.getSummary(this, 'player')`, `productionService.tick(..., this, ...)`, `fleetAssemblyService.createFleet(this, ...)`) — keep passing `this`.
3. `StarMap.getShipType()` returns **raw, non-normalized** types from `ship-data.json`. `ShipService.getShipType()` normalizes — do NOT swap them.
4. No `ViewChild` anywhere; `#mapViewport` template ref is unused (may be kept in the child template).
5. Existing child-component SCSS pattern: re-use partials via `@use '../_star-map-...'` (fleet-info precedent). Parent partials (`_star-map-*.scss`) stay unchanged in place; parent `star-map.scss` keeps its full `@use` list.
6. Component style budget: 15kB warning / 20kB **error** (`anyComponentStyle`). Largest child `@use` set ≈ 14.5kB raw SCSS — compiled should fit, but verify at build (fallback in Risks).
7. All `console.log` calls (incl. `[PLANET BATTLE]`, `[Enemy AI]`, `[StarMap]`, `[PLANET ARRIVAL]`) must be moved verbatim — one spec counts `[Enemy AI]` log calls.
8. Order-sensitive flows that must not be touched: spaceport create (`selectSystem` before `currentView='system'` before `selectFleet`), save-before-navigation (`enterBattleScreen`, `leaveSystem`, `openPlanetView`), `loadGame` migration order, AI pipeline order (ai → strategy → goal → capability → action → executor, per-faction loops), change-detection conditions in `gameLoopCallback`.
9. `visibilityDirty` is write-only — keep it exactly as-is (write in `updateSensorVisibility`).
10. `StarMap` stays the runtime source of truth for `factions`/`starSystems`/`fleets` (documented in `docs/architecture.md`).
11. English comments only (AGENTS.md). Do not comment mechanical code.

## Communication model

- Parent `StarMap` keeps all state and all existing public/private method names; moved logic becomes thin delegating calls (template, spec, and routes unaffected).
- New presentational children receive data via `@Input()` and parent handlers via `@Input()` function props — the same pattern already used by `star-map-planet-screen` (`onConfirmBuild`). Handler functions are invoked synchronously during native event dispatch, so `event.currentTarget`, `stopPropagation()`, and `preventDefault()` semantics are identical to today's inline bindings.
- New services are stateless coordinators (except arrival bookkeeping maps, which move with the logic) receiving plain data + callbacks, matching `StarMapBattleDetectionService.checkForBattles(...)` style.

---

## Implementation steps (each independently verifiable; build + test after each)

### Step 1 — `StarMapGalaxyViewComponent` (galaxy map viewport)

New folder `src/app/components/star-map/star-map-galaxy-view/` with `.ts`, `.html`, `.scss`.

- **Move** `star-map.html` lines 40–152 (the second `@if (currentView === 'map')` block containing `#mapViewport` / `.map-viewport` / `.map-world`: fog cells, sensor range + preview cells, star systems, fleets, ship-target marker) into the child template, byte-identical except:
  - Parent handler calls become input-function calls with the SAME names: `onMapClick($event)`, `onPointerDown/Move/Up($event)`, `onSystemClick(system, $event)`, `onFleetClick(fleet, $event)`, `onSystemContextMenu($event)`, `onFleetContextMenu($event)`.
  - `exploredStarSystems` → `systems` input; `visibleFleets` → `fleets` input; `sensorRangeCellsArray` → `sensorRangeCells`; `sensorPreviewCellsArray` → `sensorPreviewCells`.
  - Keep `track` expressions, CSS classes, `[style.*]` bindings, `--cell-size-vw` inheritance (CSS custom property inherits from `.star-map`), and `movementService.calculateGridCell(targetX, targetY)` calls (child injects `StarMapMovementService` — same root singleton the parent initialized).
- **Child TS inputs:** `cameraX`, `cameraY`, `cellSizeVw`, `cellSizeVh`, `gridColumns`, `gridRows`, `sensorRangeEnabled`, `fogCells: {col,row,explored}[]`, `sensorRangeCells: SensorCellInfo[]`, `sensorPreviewCells: SensorPreviewCellInfo[]`, `systems: StarSystem[]`, `fleets: Fleet[]`, `selectedSystem: StarSystem | null`, `selectedFleet: Fleet | null`, `targetX`, `targetY`, `isEnemyInPreview: (fleet) => boolean`, `getFactionColor: (id) => string`, and the 8 handler inputs listed above. Passing whole `selectedSystem`/`selectedFleet` objects keeps every template expression (`selectedSystem?.id === system.id`, target-marker `@if`) verbatim.
- **Child SCSS:** `@use '../_star-map-base'; @use '../_star-map-grid'; @use '../_star-map-star-system'; @use '../_star-map-ships'; @use '../_star-map-sensor';` plus `:host { display: contents; }` (keeps `.map-viewport { position:absolute; inset:0 }` resolving against `.star-map`).
- **Parent:** replace the moved block with the child element wired to all inputs; add `readonly boundIsEnemyInPreview = this.isEnemyInPreview.bind(this);` next to the existing `bound*` fields; add 3 tiny handlers (preserve statement order — deselect first, matching today's inline bindings):
  ```ts
  onSystemContextMenu(event: MouseEvent): void { this.deselectSystem(); event.preventDefault(); event.stopPropagation(); }
  onFleetContextMenu(event: MouseEvent): void  { this.deselectFleet(); event.preventDefault(); event.stopPropagation(); }
  onPlanetContextMenu(event: MouseEvent): void { this.deselectPlanetTile(); event.preventDefault(); event.stopPropagation(); }
  ```
  (These 3 are shared with Step 2.) Register child in `imports`. Pointer/drag/click logic, camera mutation, and `.dragging` class toggling stay in the parent handlers — the child only forwards events.

### Step 2 — `StarMapSystemGridViewComponent` (system view grid)

New folder `src/app/components/star-map/star-map-system-grid/`.

- **Move** `star-map.html` lines 242–338 (the `.system-grid` div: sun, system sensor cells, planets, fleets-in-system, system target) into the child, byte-identical except handler calls become input-function calls (`onSystemGridClick($event)`, `onPlanetClick(planet, $event)`, `onFleetClick(fleet, $event)`, `onPlanetContextMenu($event)`, `onFleetContextMenu($event)`) and `[ngClass]` uses input `getPlanetClassNames(planet)`. `movementService.getPlanetGridPosition(planet)` stays (child injects movement service).
- **Child inputs:** `selectedSystem`, `selectedFleet`, `fleets` (parent's `visibleFleets`; the `fleet.system?.id === selectedSystem.id` filter stays in the child template verbatim), `targetX`, `targetY`, `sensorRangeEnabled`, `systemSensorCells: { cells: {col,row}[]; preview: {col,row}[] }`, `getFactionColor`, `getPlanetClassNames`, plus the 5 handler inputs. `imports: [NgClass]`.
- **Child SCSS:** `@use '../_star-map-grid'; @use '../_star-map-ships'; @use '../_star-map-sensor'; @use '../_star-map-system-view';` + `:host { display: contents; }` (required: otherwise the host would become a flex item of `.system-view` and break `.system-grid { margin: auto }` centering).
- **Parent:** header, back button, fleet-info, planet-info, and the `.system-view` wrapper stay; only the grid div is replaced by the child element.

### Step 3 — `star-map-display.util.ts` (pure display helpers)

New file `src/app/components/star-map/star-map-display.util.ts`. Pure functions, no DI. The module builds its own ship-type map from `ship-data.json` (same raw JSON → same values as today's component map):

```ts
getShipTypeById(typeId): ShipType | undefined
getFactionColor(factions, factionId): string          // '#ffffff' fallback
getFactionName(factions, factionId): string           // 'Unknown' fallback
getFactionCurrencies(factions, factionId): {name,value}[]
getPlayerCurrencies(factions): {name,value}[]
getPlayerCredits(factions): number
getPlanetClassNames(planet): string[]                 // uses PLANET_SIZE_MAP
getPlanetNumericSize(planet): number
getPlanetGridSize(planet): number                     // size*2+3
getPlanetColor(planet): string                        // PLANET_TYPE_COLORS
getFleetShipTypeSummary(fleet): FleetShipTypeSummary[]
getFleetTotalAttack(fleet): number
getFleetTotalDefense(fleet): number
```

`StarMap` keeps every existing method name as a one-line delegate (e.g. `getFactionColor(factionId) { return getFactionColor(this.factions, factionId); }` — use `as ...Util` import aliases to avoid name collisions). Keep the public `readonly shipTypes` field; delete the now-unused private `shipTypeById`. `getEnergyForPlanet`/`getTaxForPlanet`/`getPlanetEconomy` (economyService delegates) stay as-is.

### Step 4 — `StarMapPanelVmService` (production/spaceport VM + message mapping)

New file `src/app/components/star-map/star-map-panel-vm.service.ts`, `providedIn: 'root'`, injecting `ProductionService`, `ShipStockService`, `ShipService`, `SpaceportService`, `ResearchService`. Move bodies verbatim:

```ts
getProductionPanelVm(data, selectedPlanetTile, selectedSystem, factions): ProductionPanelViewModel | null
getSpaceportPanelVm(data, selectedPlanetTile, selectedSystem, starSystems, spaceportError): SpaceportPanelViewModel | null
describeProductionError(reason): string
describeAssemblyError(reason): string
suggestFleetName(fleets): string        // + private ordinalSuffix
```

`data` is the existing structural param pattern (`{ shipStock?; production? }`) — `StarMap` keeps passing `this`. `StarMap` keeps `getProductionPanelVm()`, `getSpaceportPanelVm()`, `describeProductionError()`, `describeAssemblyError()`, `suggestFleetName()` as delegating methods (bound VM getters used by `planet-screen` inputs keep working unchanged). Panel open/close state and all panel event handlers stay in `StarMap`.

### Step 5 — `StarMapPlanetArrivalService` (planet arrival, colonization, capture, planet battle)

New file `src/app/components/star-map/star-map-planet-arrival.service.ts`, `providedIn: 'root'`, injecting `PlanetBattleService`, `BattleService`, `StarMapMovementService`. Move verbatim from `StarMap`:

- State: `fleetPlanetMap` (private Map) and `triggeredBattles` (expose as `readonly` Set — `StarMap` passes `this.arrivalService.triggeredBattles` into `battleDetectionService.checkForBattles`).
- Methods: `checkFleetPlanetArrivals(params)` where `params = { fleets, currentView, selectedSystem, factions, saveGame: () => this.saveGame(), enterBattleScreen: () => this.enterBattleScreen() }`; private `handleFleetPlanetArrival`, `triggerPlanetBattle` (same signatures, callbacks threaded through); public `getFleetOnPlanet(fleets, selectedSystem, planet)`.

`StarMap` updates: `updateFleets` calls the service; `validateFleetMove` calls `this.arrivalService.getFleetOnPlanet(this.fleets, this.selectedSystem, planet)`; delete the 4 moved methods and the 2 moved fields. All `[PLANET ARRIVAL]` / `[PLANET BATTLE]` / `[StarMap] Fleet ...` logs move verbatim. Colonization, capture, garrison logic, `battleService.setPlanetBattle(...)` payload: byte-identical.

### Step 6 — `StarMapAiTickService` (AI pipeline sequencing)

New file `src/app/components/star-map/star-map-ai-tick.service.ts`, `providedIn: 'root'`, injecting `EnemyAiService`, `EnemyStrategyService`, `EnemyGoalService`, `EnemyCapabilityService`, `EnemyActionService`, `EnemyActionExecutor`. Move gameLoopCallback lines (AI block: `enemyAiService.tick` → strategy → per-faction goal loop → capability loop → action loop with `[Enemy AI]` logs → executor loop) verbatim into:

```ts
tick(gameDeltaTime, data: { fleets, factions, starSystems, shipStock, production }): boolean
// returns aiChanged || strategyChanged || goalChanged || actionChanged || actionExecuted
```

`StarMap.gameLoopCallback` keeps: `updateFleets` first, then `const aiChanged = this.aiTickService.tick(...)`, then `updateSensorVisibility`, production tick, economy accumulator, and the unchanged combined change-detection condition (`this.ngZone.run(() => this.cdr.detectChanges())` stays in `StarMap` — required for the spec's ngZone/cdr spies). TestBed spies on root AI services still intercept (same singletons).

### Step 7 — Documentation

Update `docs/architecture.md` component tree only: add the two new view child components and three new services/util under `components/star-map/`, and note that display helpers live in `star-map-display.util.ts`. No new doc files; no other docs touched.

---

## Explicitly NOT moved (intentional)

- Game state arrays, camera state/clamp/drag/keyboard/resize/orientation, selection + click resolution + context-menu state, `validateFleetMove`/`moveSelectedFleet`/`onMapClick`/`onSystemGridClick`, `enterSystem`/`leaveSystem`/`applyDefaultView`/`initFleetsInSystem`/`syncTargetFromSelectedFleet`, all save/load/migration/battle-return logic, `gameLoopCallback` skeleton + `updateFleets` + `updateSensorVisibility` + `updateExploredPlanets` + `fogCells` getters + sensor state, economy accumulator + cached breakdown, `ensureResourceTiles`, production/spaceport/research panel open-close handlers, `onBuildingConfirmed`, lifecycle (init/destroy/router subscription/focus handlers), all `bound*` fields.
- Existing services (`movement`, `game-loop`, `sensor`, `battle-detection`, `enemy-*`) and existing child components: untouched.

## Validation (after each step, and final)

1. `npm run build` — must pass production build (also catches style-budget errors and template errors).
2. `npm run test` — full vitest suite must pass (especially `star-map.spec.ts`, `star-map-planet-screen.component.spec.ts`).
3. Final grep checks: old members still referenced nowhere unexpectedly; no circular imports (children import only `star-map.models`, `star-map-movement.service`, `star-map-sensor.service` types); `app.routes.ts` unchanged (`StarMap` import path still `./components/star-map/star-map`).
4. Verify template parity by diffing moved markup blocks against the originals (should differ only in the documented handler/input renames).

## Risks / notes

- **Style budget:** if `anyComponentStyle` errors on a child, split the `@use` list to only the partials whose selectors that child's template actually uses (rules are flat class selectors; no nesting across partials), or inline the needed rule blocks in the child SCSS. Do not edit partial contents.
- **Handler-input pattern** relies on synchronous Angular event dispatch (already proven by `planet-screen`'s `onConfirmBuild`). If `event.currentTarget` ever turns out null in a parent pointer handler (it must not — verified synchronous), fall back to `@Output` + passing the needed element data; do not move camera logic into the child.
- Spec compatibility is protected by the delegating-methods rule; if any spec fails, fix the refactor, not the spec.
- Do not reformat unrelated code; keep diffs minimal and mechanical.

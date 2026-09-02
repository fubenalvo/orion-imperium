# Plan: Fleet Sensor Range & Fog of War

## Goal

Add a `sensorRange` (in grid cells) to each fleet. Grid cells within that Euclidean radius are highlighted on the star map using the faction's color. Player-owned star systems get a permanent 5-grid sensor radius ("base visibility"). Full fog-of-war: unexplored star systems are hidden on the galaxy map, enemy fleets are hidden when outside player sensor range, and grid cells are highlighted by faction color.

## Resolved Decisions

| Decision | Choice |
|---|---|
| Fleet sensor range source | New `sensorRange: number` field on `Fleet` model, default 3, set in data file |
| Visibility shape | Euclidean circle (true radius: `dx² + dy² <= range²`) |
| Enemy fleet visibility | Hidden when outside player sensor range |
| `explored` semantics | Reinterpreted: explored when within sensor range (not just landed on) |
| Player-owned systems | 5-grid base sensor radius, player faction color |
| Enemy sensor ranges | Never shown on galaxy map (player sensors only) |
| Scope | Galaxy map: full fog-of-war. System view: sensor range highlighting + proximity exploration, planets remain visible when system is entered |
| Fog rendering | Individual divs per fog/highlighted cell within the CSS grid (viewport-culled for fog) |

## Affected Files

| File | Change |
|---|---|
| `src/app/components/star-map/star-map.models.ts` | Add `sensorRange` to `Fleet`, `explored` to `StarSystem`, `exploredGridCells` to `StarMapData` |
| `src/app/components/star-map/star-map-sensor.service.ts` | **New file** — sensor range cells computation, visibility checks, explored cell tracking |
| `src/app/components/star-map/star-map.ts` | Wire sensor service, add visibility state, update game loop, update save/load, update minimap/fleet list filtering |
| `src/app/components/star-map/star-map.html` | Add fog + sensor range cell layers, filter systems/fleets by visibility, add toggle button |
| `src/app/components/star-map/star-map.scss` | Import new `_star-map-sensor.scss` |
| `src/app/components/star-map/_star-map-sensor.scss` | **New file** — fog cell, sensor range cell, pulse animation styles |
| `src/app/components/star-map/star-map-data.json` | Add `sensorRange: 3` to each fleet, add `explored` to each star system |
| `docs/data-models.md`, `docs/game-systems.md`, `docs/invariants.md` | Update documentation |

## Implementation Steps

### Step 1 — Data Model

`src/app/components/star-map/star-map.models.ts`:

1. Add `sensorRange?: number` to `Fleet` (optional; code defaults to 3 when undefined).
2. Add `explored?: boolean` to `StarSystem`.
3. Add `exploredGridCells?: string[]` to `StarMapData` (serialized form of the component's `Set<string>` of `"col-row"` cell keys).

### Step 2 — Sensor Service

Create `src/app/components/star-map/star-map-sensor.service.ts` (`@Injectable({ providedIn: 'root' })`):

```
interface SensorCellInfo {
  col: number;
  row: number;
  factionId: string;
  color: string;
}

class StarMapSensorService {
  // Returns all cells within Euclidean radius of (centerX, centerY) in grid cells.
  // centerX/Y are floating-point grid coordinates (1-indexed).
  getCellsInRadius(centerX: number, centerY: number, radius: number,
                   gridColumns: number, gridRows: number): {col: number; row: number}[]

  // Returns a Map keyed "col-row" -> SensorCellInfo for all cells currently in
  // any player fleet's or player-owned system's sensor range.
  // Priority: player fleets > player-owned systems (both use player color).
  computeSensorRangeCells(fleets, starSystems, factions, gridColumns, gridRows): Map<string, SensorCellInfo>

  // Returns the set of all cells ever explored by the player (union of all
  // sensor ranges over time, plus initial explored cells).
  // Merges `currentExplored` with any newly-sensed cells.
  updateExploredCells(existingExplored: Set<string>, sensorCells: Map<string, SensorCellInfo>): Set<string>

  // Returns true if a star system's grid cell falls within any player sensor range.
  isSystemExplored(system, sensorCells: Map<string, SensorCellInfo>): boolean

  // Returns true if a fleet's current cell is within player sensor range
  // (or the fleet is a player fleet / in the current system view).
  isFleetVisible(fleet, sensorCells: Map<string, SensorCellInfo>,
                 currentView, selectedSystem): boolean
}
```

Key logic:
- Player fleets: range = `fleet.sensorRange ?? 3`, center = `(fleet.x, fleet.y)`, color = player faction color
- Player-owned systems (systems containing ≥1 planet with `factionId === 'player'`): range = 5, center = `(system.gridCol, system.gridRow)`, color = player faction color
- Sensor cells are computed from **integer** fleet positions (`Math.floor(fleet.x)`, `Math.floor(fleet.y)`) for consistency with grid-cell-based system positions
- Fog cells = viewport cells NOT in the explored set

### Step 3 — Component: State & Initialization

`star-map.ts`:

1. Inject `StarMapSensorService`.
2. Add properties:
   - `exploredGridCells = new Set<string>()` — persistent; all cells ever explored
   - `sensorRangeCells = new Map<string, SensorCellInfo>()` — transient; cells currently in sensor range (for highlighting)
   - `sensorRangeEnabled = true` — toggle for showing/hiding highlights
3. In `loadGame()` / `loadFromMenu()`:
   - Load `exploredGridCells` from save (`exploredGridCells` string array → Set). If missing (old save), mark all systems as explored (backward compatibility).
   - Load `StarSystem.explored` for each system. If missing, default to `true` (old saves) — backward compatibility.
   - Load `fleet.sensorRange` (defaults to 3 if missing).
4. On new game (`ngOnInit` → `loadGame` from slot created by `MainMenu`): compute initial explored cells from starting fleet positions and player-owned systems.

### Step 4 — Component: Game Loop Integration

In the game loop tick callback (`startGameLoop` / `resumeGame` tick), after `updateFleets`:

1. Call `sensorService.computeSensorRangeCells(...)` → store in `sensorRangeCells`.
2. Call `sensorService.updateExploredCells(existingExploredGridCells, sensorRangeCells)` → update `exploredGridCells`.
3. Mark star systems as explored when their cell is in `sensorRangeCells`.
4. Update planet exploration in system view (see Step 6).
5. Mark `visibilityDirty = true` so change detection runs if visibility changed.

### Step 5 — Component: Visibility Filtering

1. Change `visibleFleets` getter: filter out fleets that are not visible to the player (enemy fleets in unexplored/out-of-range cells are hidden). Player fleets and fleets in the current system view are always visible.
2. Add `exploredStarSystems` getter: `starSystems.filter(s => s.explored)`.
3. Update `minimapFleets` getter: only include visible fleets.
4. Pass `exploredStarSystems` to the minimap instead of the full `starSystems` array.

### Step 6 — Component: System View Exploration

Modify `updateExploredPlanets()`:

- Instead of only marking planets `explored` when fleet `gridCol/Row === planetCell.col/row`, use the fleet's `sensorRange` to check Euclidean distance in system grid cells.
- A planet is explored when `distance(fleetSystemCell, planetCell) <= fleet.sensorRange`.
- This replaces the exact-cell-match logic.

### Step 7 — Component: Save/Load

In `saveGame()`:
- Serialize `exploredGridCells` as `Array.from(exploredGridCells)` → `exploredGridCells: string[]`
- `StarSystem.explored` is already on the object, serialized as part of `starSystems`
- `Fleet.sensorRange` is already on the object, serialized as part of `fleets`

In `loadGame()`:
- Restore `exploredGridCells` from the array (or compute from initial state for new games)
- Restore `StarSystem.explored` and `Fleet.sensorRange` from the loaded data (with defaults for old saves)

### Step 8 — Galaxy Map Template

`star-map.html` (map view section, inside `.map-world`):

1. **Fog cells layer** (before systems):
   ```html
   @if (sensorRangeEnabled) {
     @for (cell of fogCells; track cell.key) {
       <div class="fog-cell"
            [class.fog-cell--explored]="isCellExplored(cell.col, cell.row)"
            [style.gridColumn]="cell.col"
            [style.gridRow]="cell.row">
       </div>
     }
   }
   ```
   `fogCells` = computed by a getter that iterates viewport grid cells (camera-derived bounds) and returns those NOT in `exploredGridCells`. Only cells within viewport + 1-cell buffer are computed.

2. **Sensor range highlight layer** (after fog, before systems):
   ```html
   @if (sensorRangeEnabled) {
     @for (cell of sensorRangeCellsArray; track cell.key) {
       <div class="sensor-range-cell"
            [style.--sensor-color]="cell.color"
            [style.gridColumn]="cell.col"
            [style.gridRow]="cell.row">
       </div>
     }
   }
   ```
   `sensorRangeCellsArray` = `Array.from(sensorRangeCells.values())`.

3. **Star systems filter**: Change `starSystems` → `exploredStarSystems` in the `@for` loop.

4. **Sensor toggle button**: Add a button in the top HUD to toggle `sensorRangeEnabled`.

### Step 9 — System View Template

`star-map.html` (system view section, inside `.system-grid`):

1. **Sensor range highlight cells** (after sun, before planets):
   ```html
   @if (sensorRangeEnabled && selectedFleet?.system?.id === selectedSystem?.id) {
     @for (cell of systemSensorCells; track cell.key) {
       <div class="sensor-range-cell system-sensor-range-cell"
            [style.--sensor-color]="systemSensorColor"
            [style.gridColumn]="cell.col"
            [style.gridRow]="cell.row">
       </div>
     }
   }
   ```
   `systemSensorCells` = cells within the selected fleet's sensor range on the 18×10 system grid, computed using `calculateSystemGridCell(fleet.system.x, fleet.system.y)` as the center.

2. **Planet dimming**: Add `[class.planet--explored]="planet.explored"` / `[class.planet--unexplored]="!planet.explored"` to dim unexplored planets in the system view.

### Step 10 — SCSS

Create `src/app/components/star-map/_star-map-sensor.scss`:

```scss
.fog-cell {
  position: relative;
  width: var(--cell-size-vw, 5vw);
  height: var(--cell-size-vw, 5vw);
  background: rgba(0, 0, 0, 0.8);
  z-index: 5;
  pointer-events: none;
}

.fog-cell--explored {
  background: rgba(0, 0, 0, 0.45);
}

.sensor-range-cell {
  position: relative;
  width: var(--cell-size-vw, 5vw);
  height: var(--cell-size-vw, 5vw);
  background: color-mix(in srgb, var(--sensor-color, #3586e5) 35%, transparent 65%);
  z-index: 6;
  pointer-events: none;
  animation: sensor-pulse 2.5s ease-in-out infinite;
}

.system-sensor-range-cell {
  width: 5vw;
  height: 5vw;
}

@keyframes sensor-pulse {
  0% { opacity: 0.4; }
  50% { opacity: 0.6; }
  100% { opacity: 0.4; }
}

.sensor-toggle-btn { /* style for the toggle button */ }
```

Add `@import '_star-map-sensor';` to `star-map.scss`. Delete the empty `star-map.scss.new`.

### Step 11 — Data File

`src/app/components/star-map/star-map-data.json`:

1. Add `"sensorRange": 3` to each fleet entry (ORION, PEGASUS, RAIDER, HUNTER).
2. Add `"explored": true` to SOL (player-owned).
3. Add `"explored": false` to all other star systems (Vega, Sirius, Arcturus, Rigel, Altair, Betelgeuse, Procyon, Deneb, Antares).

### Step 12 — Documentation

1. **`docs/data-models.md`**: Document `Fleet.sensorRange`, `StarSystem.explored`, `StarMapData.exploredGridCells`.
2. **`docs/game-systems.md`**: Add "Fog of War & Sensor Range" section.
3. **`docs/invariants.md`**: Add sensor range invariants (computed from integer fleet positions, player-owned systems get range 5, fog cells are viewport-culled, backward compatibility for old saves).
4. **`AGENTS.md`**: Update documentation list if a new `docs/fog-of-war.md` is created (decided against — content fits in `game-systems.md`).

## Data Flow

```
Game Loop Tick
  │
  ├─ updateFleets()         // existing fleet movement
  ├─ computeSensorRange()   // NEW: compute sensorRangeCells + update exploredGridCells
  ├─ updateExploredSystems() // NEW: mark StarSystem.explored when cell is in range
  ├─ updateExploredPlanets() // MODIFIED: use range-based exploration (not exact cell)
  ├─ checkFleetPlanetArrivals() // existing
  └─ checkForBattles()      // existing

Template Rendering
  │
  ├─ fogCells getter → viewport-culled unexplored cells
  ├─ sensorRangeCells → faction-colored highlight divs
  ├─ exploredStarSystems → only explored systems rendered
  └─ visibleFleets → only sensor-visible fleets rendered
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Performance: 100×60=6000 grid cells, viewport-culled fog | Only compute fog cells within camera viewport bounds |
| Backward compatibility: old saves have no `explored`/`sensorRange` | Default `explored=true` and `sensorRange=3` for loaded data; default all systems explored if `exploredGridCells` missing |
| Multiple overlapping sensor ranges | Player systems take priority; sensor cells use player color; no overlap conflicts for player-only highlighting |
| Fleet fractional position during movement | Use `Math.floor(fleet.x)` as center for sensor range (consistent with grid cell semantics) |
| `isInteractiveElement` might catch fog cells | Fog/sensor cells use `pointer-events: none` in CSS |
| Minimap shows hidden systems | Pass `exploredStarSystems` instead of full array to minimap |
| Battle detection on hidden fleets | Battle detection operates on raw fleet data, not visibility-filtered — no change needed |

## Validation

1. **New game**: Start from `star-map-data.json`. SOL should be explored, cells within 5 grids of SOL explored, cells within 3 grids of each player fleet explored. All other systems hidden.
2. **Fleet movement**: Moving a fleet should expand the explored area. Highlight circles follow the fleet in real-time.
3. **Enemy fleet visibility**: Enemy fleets only appear when within player sensor range. Move a fleet near an enemy to reveal it.
4. **Save/load**: Explored state persists across saves.
5. **Old save migration**: Loading a save without `explored`/`sensorRange` fields should default to all systems explored (no fog of war regression).
6. **System view**: Entering an explored system shows planet sensor range highlights. Planets within range are marked explored.
7. **Toggle button**: Clicking the sensor toggle hides/shows highlight circles.
8. **Performance**: No visible lag when panning the map or moving fleets.

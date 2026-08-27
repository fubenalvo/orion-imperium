# StarMap Refactoring Plan

## Problem

`star-map.ts` is ~1418 lines, `star-map.html` is ~470 lines. The component owns too many responsibilities: game loop, movement, camera, selection, context menus, save/load, UI rendering, and battle detection.

## Approach

Keep `StarMap` as a thin orchestrator. Extract three categories of concerns:

### 1. Child Components (UI decomposition)

Extract repeated UI sections into standalone components with `@Input`/`@Output`.

| New Component | Source Lines | Responsibility |
|---------------|-------------|----------------|
| `star-map-fleet-info` | ~120 | Selected fleet panel (map + system view both use identical markup) |
| `star-map-system-info` | ~40 | Selected system info panel + ENTER SYSTEM button |
| `star-map-planet-info` | ~40 | Planet details panel |
| `star-map-fleet-buttons` | ~30 | Fleet button list |
| `star-map-context-menu` | ~25 | Context menu overlay |

**Why child components:** The template repeats fleet info panels in both map and system views. Extracting them removes ~200 lines from the template and makes each panel independently testable.

**Template binding strategy:** Child components receive state via `@Input` and emit events via `@Output`. The parent (`StarMap`) retains the methods but delegates UI rendering.

### 2. Services (logic extraction)

Move pure business logic out of the component into injectable services.

| New Service | Responsibility |
|-------------|----------------|
| `star-map-game-loop.service.ts` | `requestAnimationFrame` management, pause/resume, delta time calculation, blur/visibility listeners |
| `star-map-movement.service.ts` | Fleet movement (map + system), grid cell calculation, coordinate conversion, position refreshing |
| `star-map-battle-detection.service.ts` | Collision detection, team validation, battle trigger deduplication |

**Why services:** These are pure logic with no template dependency. Extracting them makes them unit-testable and reusable. The component injects them and delegates calls.

### 3. Interfaces & Types

Move all interfaces from `star-map.ts` to a shared `star-map.models.ts`:

- `PlanetBuilding`, `PlanetType`, `PlanetSize`, `Faction`, `PlanetTile`, `StarSystem`
- `FleetShip`, `ShipType`, `FleetShipTypeSummary`
- `ContextMenuItem`
- `StarMapData`

This eliminates duplication with `battle.service.ts` and `ship.service.ts`.

## File Structure After Refactoring

```
star-map/
  star-map.component.ts          (~300 lines, orchestrator only)
  star-map.component.html        (~150 lines, layout + child components)
  star-map.component.scss        (unchanged)
  star-map.models.ts             (all interfaces)
  star-map-game-loop.service.ts  (~80 lines)
  star-map-movement.service.ts   (~150 lines)
  star-map-battle-detection.service.ts (~60 lines)
  star-map-fleet-info.component.ts + html
  star-map-system-info.component.ts + html
  star-map-planet-info.component.ts + html
  star-map-fleet-buttons.component.ts + html
  star-map-context-menu.component.ts + html
  star-map-data.json             (unchanged)
  ship-data.json                 (unchanged)
```

## Execution Order

1. Create `star-map.models.ts` and move all interfaces
2. Create services (game loop, movement, battle detection)
3. Create child components (fleet info, system info, planet info, fleet buttons, context menu)
4. Refactor `star-map.component.ts` to inject services and delegate
5. Refactor `star-map.component.html` to use child components
6. Update imports across the project
7. Run build + tests

## Risks

- Template bindings are tightly coupled to component methods. Child components need careful `@Input`/`@Output` design.
- `ngZone.runOutsideAngular` and change detection logic must stay correct after game loop extraction.
- Save/load logic touches many state properties; moving state to a service would be cleaner but is a larger change.

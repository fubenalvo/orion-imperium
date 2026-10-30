# Orion Imperium – Architecture

## Overview

Orion Imperium is an Angular 22 standalone 4X strategy game. The application uses Angular Router with three routes:

- `/` – `MainMenu` (new game / load game)
- `/star-map` – `StarMap` (core gameplay view: galaxy map, star system view, planet surface view)
- `/battle` – `BattleScreenComponent` (turn-based battle resolution view)

The app is fully client-side. All state is held in memory; the only persistence layer is `localStorage` via `SaveGameService`. There is no backend and no external API.

The shell (`App` in `src/app/app.ts`) renders a CRT-styled viewport with a single `<router-outlet>`. Global Angular providers live in `app.config.ts` (`provideBrowserGlobalErrorListeners`, `provideRouter`).

Global styles live in `src/styles.scss`; shared SCSS partials in `src/styles/` (on the include path) provide the mixins every component reuses: `_mixins.scss` (breakpoints), `_hud-panel.scss` / `_hud-controls.scss` (HUD frame and controls), and `_space.scss` / `_planets.scss` (space scenery and lit planets, see [UI Styling](./ui-styling.md#space-scenery)).

## Application Structure

```
src/app/
  app.ts / app.html / app.scss
    → Root component: CRT container, game viewport, router-outlet
  app.routes.ts
    → Route definitions (main menu, star map, battle)
  app.config.ts
    → Application providers

  main-menu/
    main-menu.ts / .html / .scss
    → Title screen: decorative animated space scene, navigation,
      New Game setup host, slot-based load-game UI (see ui-styling.md)
    new-game-setup/
    → New Game configuration screen (galaxy size, players, seed, slot)

  components/
    space-nebula-field/
      → Decorative, endlessly wrapping nebula backdrop for scrolling scenes
        (galaxy map); see ui-styling.md#space-scenery
    star-map/
      star-map.ts / .html / .scss / .models.ts
        → Central gameplay component; orchestrates services and child UI components
      star-map-game-loop.service.ts
        → requestAnimationFrame loop, runs outside Angular zone; always runs;
          delegates delta scaling to GameTimeService
      star-map-movement.service.ts
        → Fleet movement, grid cell math, coordinate conversion, planet grid layout;
          routes every galaxy order around black holes and applies nebula slowdown
      star-map-terrain.service.ts / fleet-navigation.ts / nebula.ts
        → Galaxy terrain: black hole no-fly zones + routing, nebula shapes, field
          and generation (see docs/star-map-terrain.md)
      drifting-asteroid.service.ts / drifting-asteroids.ts
        → Drifting asteroid events: spawn, movement, collection, intercepts
      star-map-asteroid-info/
        → Selected asteroid panel (cargo, time left, INTERCEPT per fleet)
      star-map-battle-detection.service.ts
        → Fleet-vs-fleet collision detection on the map / inside systems
      star-map-planet-arrival.service.ts
        → Fleet arrivals on planets: colonization, capture, planet battle trigger;
          owns the arrival bookkeeping map and the triggered-battle registry
      star-map-ai-tick.service.ts
        → Sequences one AI pipeline tick (ai → strategy → goal → capability →
          action → executor) and resets the pipeline on load
      star-map-panel-vm.service.ts
        → View models for the production/spaceport panels, error message mapping,
          fleet name suggestion
      star-map-display.util.ts
        → Pure display helpers (faction colors/names/currencies, planet
          classes/sizes/colors, fleet ship summaries); uses raw ship-data.json
      star-map-galaxy-view/
        → Presentational galaxy map viewport (fog, sensor highlights, systems,
          fleets, movement target); forwards events to StarMap handler inputs
      star-map-system-grid/
        → Presentational system view grid (sun, decorative orbit rings,
          system sensor highlights, planets, fleets in system, movement target)
      fleet-ship/ + fleet-heading.ts
        → Shared fleet marker ship glyph (rotating hull + engine trail) used by
          both views; render-only heading trackers updated by StarMap's loop
      star-map-data.json
        → Legacy hand-made galaxy: reference scale for the Large preset and
          source for migrating pre-v3 saves (no longer used to start games)
      ai-difficulty.ts
        → Per-faction AI difficulty profiles read by strategy/economy/generator
      ship-data.json
        → Ship type stats (HP, attack, defense, cost, etc.)
      planet-data.json
        → Building definitions and per-planet economy stats
      star-map-context-menu/
        → Disambiguates clicks on overlapping objects (fleets/systems/planets)
      star-map-fleet-buttons/
        → Sidebar list of all visible fleets
      star-map-fleet-info/
        → Selected fleet detail panel (ships, totals, actions)
      star-map-system-info/
        → Selected star system info panel + "Enter System" action
      star-map-planet-info/
        → Selected planet panel (population, buildings, economy, "Open Planet")
      star-map-planet-screen/
        → Planet surface view (scene layers, build mode, camera)
      planet-surface/
        → Surface grid + terrain mask (gameplay), terrain field/generator,
          terrain renderer, street layout (docs/planet-surface.md)
      faction-currencies/
        → Currency HUD with expandable economy breakdown
    star-map-header/
        → Star-map flavour of the shared game header: title, back button,
          time controls ([⏸] [1x] [2x]), currencies, ship stock, ☰ pause-menu button
    star-map-navigation/
        → Camera pan controls, minimap, viewport position
    star-map-pause/
        → Pause overlay, save slot UI, exit-to-menu (opened from the header ☰ button or ESC)
    game-header/
        → Shared top bar for every in-game screen (star map, system, planet, battle);
          see ui-styling.md → Game Header
    star-map-minimap/
        → Standalone minimap widget (consumed by the navigation component)
    battle-screen/
        → Turn-based battle simulation UI
    background-stars/
        → Decorative animated background

  services/
    game-time.service.ts
      → Centralized game time state: speed, pause, scaled delta, elapsed time
    ship.service.ts
      → Read-only lookup of ship type definitions
    battle.service.ts
      → Owns the active battle state (turn order, log, winner/loser)
    planet-battle.service.ts
      → Builds virtual defense fleets from planet buildings, colonizer handling
    economy.service.ts
      → Per-planet and per-faction resource production / consumption / efficiency
    production.service.ts
      → Per-planet production queue and per-tick progress
    save-game.service.ts
      → localStorage persistence, 5 save slots, "most recent" lookup, migration
    save-validation.ts
      → SAVE_VERSION and the structural save gate
    new-game.models.ts / new-game-config.ts
      → New Game config types, galaxy size presets, config validation helpers
    galaxy-generator.service.ts
      → Seeded procedural galaxy generation (StarMapData in the legacy schema)
    galaxy-validation.ts
      → Strict validation of freshly generated galaxies
    new-game.service.ts
      → Start Game workflow: validate → generate → validate → save → activate
```

See [New Game Generation](./new-game-generation.md) for the generation and setup rules.

The empty legacy directories `src/app/components/ship`, `src/app/components/ships`, and `src/app/components/star-map-grid` are placeholders for components that were consolidated into `star-map` and are kept for now to avoid breaking references.

## Component Communication

- `MainMenu` shows `NewGameSetupComponent`; on Start it calls `NewGameService.startNewGame`, which generates and validates a galaxy, writes it into the chosen manual slot and activates it (copying the snapshot into the autosave slot and switching `currentSlot` to 0). Only on success does `MainMenu` navigate to `/star-map`; otherwise the errors are shown on the setup screen.
- `StarMap` is the runtime source of truth: it holds the live `factions`, `starSystems`, and `fleets` arrays and is the only component that mutates them during gameplay.
- `StarMap` delegates pure logic to injected services (`StarMapGameLoopService`, `StarMapMovementService`, `StarMapBattleDetectionService`, `StarMapPlanetArrivalService`, `StarMapAiTickService`, `StarMapPanelVmService`) and delegates UI to its child components (`StarMapGalaxyViewComponent`, `StarMapSystemGridViewComponent`, and the panel components).
- When two fleets collide, or when a fleet arrives at an enemy planet with defenses, `StarMap` calls `BattleService.setBattle()` (or `setPlanetBattle()`) and navigates to `/battle`.
- `BattleScreenComponent` runs the self-contained real-time tactical minigame (RAF game loop, battle-local clock, tactical AI, shared fire control); `BattleService` is only the transport boundary. When the battle ends, a result overlay with "Back to Star Map" appears. See [Battle Screen](./battle-screen.md) and [Battle Rules](./battle-rules.md).
- On "Back to Star Map":
  - For a fleet battle, the loser is marked `destroyed = true` and the destroyed fleet id is stored in `BattleService` so `StarMap` can pick it up.
  - For a planet battle, the saved data is reloaded and the planet is either transferred to the attacker's faction (attacker wins) or the attacker is destroyed.
- `StarMap` reacts to the `/star-map` navigation end via a `Router.events` subscription (`reloadAfterBattle()`) and applies the destroyed fleet / planet ownership change.

## Save Slots and Active Session

- Five slots are stored in `localStorage` under the key `orion_save_slots`: slot 0 (autosave) plus slots 1–4 (manual).
- Each slot contains a full `StarMapData` snapshot plus an ISO date string. The service exposes `getSlots`, `getSlot(i)`, `saveToSlot(i, data)`, `loadFromSlot(i)`, `clearSlot(i)`, `hasAnySave`, `getMostRecentSlotIndex`, and `activateSlot(i)`.
- **Autosave is the active session source of truth.** `activateSlot(i)` loads the requested slot and, for a manual slot, copies its full snapshot into autosave before switching `currentSlot` to 0. Session start (new game, manual load, pause-menu load, direct `/star-map` navigation) always normalizes `currentSlot` to autosave.
- Every runtime save (`StarMap.saveGame`), autosave trigger, and battle result therefore writes to the same slot that `loadGame()` and `reloadAfterBattle()` read back. Without this, a stale manual snapshot can resurrect fleets destroyed in earlier battles once the player returns from a later battle.
- Manual slots remain explicit snapshots: they are not mutated by activation and are only written to when the player explicitly saves to one.
- `destroyedFleetId` is stored as part of the save so the destruction persists across reloads.

## State Ownership

- `StarMap` owns the runtime game state (`factions`, `starSystems`, `fleets`, selection, camera, current view, `targetX`/`targetY`, etc.).
- `BattleService` temporarily owns the active battle between `StarMap` and `BattleScreenComponent` and remembers a single `destroyedFleetId` across navigations.
- `SaveGameService` is the persistence layer; it owns `currentSlot` and the four localStorage-backed save slots.
- `ShipService` is a stateless lookup of `ShipType` definitions loaded from `ship-data.json`.
- `EconomyService` is stateless with respect to game data: every call recomputes from the current `factions`/`starSystems`/`fleets` arrays.
- `PlanetBattleService` reads `planet-data.json` once at construction and exposes pure functions to create virtual defense fleets.

## Cross-Cutting Concerns

- The `requestAnimationFrame` loop runs outside the Angular zone and always runs (it is never canceled for pause). `GameTimeService.getScaledDeltaTime()` produces a scaled delta — 0 when paused, `realDeltaTime * speed` when running — which all simulation systems receive. `StarMap` triggers change detection only when fleets moved or the economy tick fired, or when `GameTimeService.state$` emits a discrete state change (pause/resume/speed).
- Window blur, document visibility hidden, and device-portrait orientation all pause the game automatically.
- The map viewport is drag-to-pan in addition to keyboard/button navigation; pointer capture is used so the drag continues even when the cursor leaves the viewport.
- On viewport resize, the cell size switches between desktop (`2vw`) and mobile (`3.5vw`) at a 1300px breakpoint, and the camera is scaled proportionally so the same grid area stays in view.

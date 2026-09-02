# Orion Imperium – Architecture

## Overview

Orion Imperium is an Angular 22 standalone 4X strategy game. The application uses Angular Router with three routes:

- `/` – `MainMenu` (new game / load game)
- `/star-map` – `StarMap` (core gameplay view: galaxy map, star system view, planet surface view)
- `/battle` – `BattleScreenComponent` (turn-based battle resolution view)

The app is fully client-side. All state is held in memory; the only persistence layer is `localStorage` via `SaveGameService`. There is no backend and no external API.

The shell (`App` in `src/app/app.ts`) renders a CRT-styled viewport with a single `<router-outlet>`. Global Angular providers live in `app.config.ts` (`provideBrowserGlobalErrorListeners`, `provideRouter`).

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
    → Slot-based new-game / load-game UI

  components/
    star-map/
      star-map.ts / .html / .scss / .models.ts
        → Central gameplay component; orchestrates services and child UI components
      star-map-game-loop.service.ts
        → requestAnimationFrame loop, runs outside Angular zone
      star-map-movement.service.ts
        → Fleet movement, grid cell math, coordinate conversion, planet grid layout
      star-map-battle-detection.service.ts
        → Fleet-vs-fleet collision detection on the map / inside systems
      star-map-data.json
        → Initial galaxy (factions, systems, planets, fleets, map config)
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
        → Planet surface view (build-mode grid, building placement)
      faction-currencies/
        → Currency HUD with expandable economy breakdown
    star-map-navigation/
      → Camera pan controls, minimap, viewport position
    star-map-pause/
      → Pause overlay, save slot UI, exit-to-menu
    star-map-minimap/
      → Standalone minimap widget (consumed by the navigation component)
    battle-screen/
      → Turn-based battle simulation UI
    background-stars/
      → Decorative animated background

  services/
    ship.service.ts
      → Read-only lookup of ship type definitions
    battle.service.ts
      → Owns the active battle state (turn order, log, winner/loser)
    planet-battle.service.ts
      → Builds virtual defense fleets from planet buildings, colonizer handling
    economy.service.ts
      → Per-planet and per-faction resource production / consumption / efficiency
    save-game.service.ts
      → localStorage persistence, 4 save slots, "most recent" lookup
```

The empty legacy directories `src/app/components/ship`, `src/app/components/ships`, and `src/app/components/star-map-grid` are placeholders for components that were consolidated into `star-map` and are kept for now to avoid breaking references.

## Component Communication

- `MainMenu` writes a fresh `StarMapData` snapshot into a save slot, sets `SaveGameService.currentSlot`, then navigates to `/star-map`.
- `StarMap` is the runtime source of truth: it holds the live `factions`, `starSystems`, and `fleets` arrays and is the only component that mutates them during gameplay.
- `StarMap` delegates pure logic to injected services (`StarMapGameLoopService`, `StarMapMovementService`, `StarMapBattleDetectionService`) and delegates UI to its child components.
- When two fleets collide, or when a fleet arrives at an enemy planet with defenses, `StarMap` calls `BattleService.setBattle()` (or `setPlanetBattle()`) and navigates to `/battle`.
- `BattleScreenComponent` drives a `setInterval` that calls `BattleService.processStep()`; the service advances one ship attack per tick. When the battle ends, the screen reveals a "Back to Star Map" button.
- On "Back to Star Map":
  - For a fleet battle, the loser is marked `destroyed = true` and the destroyed fleet id is stored in `BattleService` so `StarMap` can pick it up.
  - For a planet battle, the saved data is reloaded and the planet is either transferred to the attacker's faction (attacker wins) or the attacker is destroyed.
- `StarMap` reacts to the `/star-map` navigation end via a `Router.events` subscription (`reloadAfterBattle()`) and applies the destroyed fleet / planet ownership change.

## State Ownership

- `StarMap` owns the runtime game state (`factions`, `starSystems`, `fleets`, selection, camera, current view, `targetX`/`targetY`, etc.).
- `BattleService` temporarily owns the active battle between `StarMap` and `BattleScreenComponent` and remembers a single `destroyedFleetId` across navigations.
- `SaveGameService` is the persistence layer; it owns `currentSlot` and the four localStorage-backed save slots.
- `ShipService` is a stateless lookup of `ShipType` definitions loaded from `ship-data.json`.
- `EconomyService` is stateless with respect to game data: every call recomputes from the current `factions`/`starSystems`/`fleets` arrays.
- `PlanetBattleService` reads `planet-data.json` once at construction and exposes pure functions to create virtual defense fleets.

## Cross-Cutting Concerns

- The `requestAnimationFrame` loop runs outside the Angular zone. `StarMap` triggers change detection only when fleets actually move or the economy tick fires.
- Window blur, document visibility hidden, and device-portrait orientation all pause the game automatically.
- The map viewport is drag-to-pan in addition to keyboard/button navigation; pointer capture is used so the drag continues even when the cursor leaves the viewport.
- On viewport resize, the cell size switches between desktop (`2vw`) and mobile (`3.5vw`) at a 1300px breakpoint, and the camera is scaled proportionally so the same grid area stays in view.

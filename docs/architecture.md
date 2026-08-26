# Orion Imperium – Architecture

## Overview

Orion Imperium is an Angular 22 standalone 4X strategy game. The application uses Angular Router with three routes:

- `/` – MainMenu
- `/star-map` – StarMap (core gameplay view)
- `/battle` – BattleScreen (temporary battle resolution view)

All state is managed in-memory with localStorage persistence via SaveGameService. No backend, no external APIs.

## Application Structure

```
src/app/
  app.ts / app.html / app.scss
    → Root component with CRT overlay, game viewport, router-outlet
  app.routes.ts
    → Route definitions
  app.config.ts
    → Angular providers (router, global error listeners)
  main-menu/
    → New game / load game / main menu UI
  components/
    star-map/
      → Core gameplay component: map view, system view, game loop, selection, movement, saving
    star-map-navigation/
      → Camera pan controls (arrow buttons)
    star-map-pause/
      → Pause menu, save/load slots UI
    battle-screen/
      → Battle resolution display
    background-stars/
      → Decorative background component
  services/
    ship.service.ts
      → Ship type definitions and lookup from ship-data.json
    battle.service.ts
      → Battle state, resolution logic, result storage
    save-game.service.ts
      → localStorage persistence, 4 save slots
```

## Component Communication

- `MainMenu` → `SaveGameService` → saves initial/loaded `StarMapData` → navigates to `/star-map`
- `StarMap` owns the runtime game state (`factions`, `starSystems`, `fleets`, selection, camera, etc.)
- `StarMap` injects `BattleService`, `SaveGameService`, `ShipService`
- When two fleets collide, `StarMap` calls `BattleService.setBattle()` and navigates to `/battle`
- `BattleScreenComponent` reads battle from `BattleService`, resolves it, displays result
- On "Back to Star Map", `BattleScreenComponent` marks the loser as `destroyed` via `BattleService`, then navigates back
- `StarMap` detects the destroyed fleet ID on load via `removeDestroyedFleetFromService()`

## State Ownership

- **StarMap** is the single source of truth for runtime gameplay state.
- **BattleService** temporarily holds battle data between StarMap and BattleScreen.
- **SaveGameService** is the persistence layer; it serializes/deserializes `StarMapData`.
- **ShipService** is a read-only lookup service for ship type stats.

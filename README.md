# Orion Imperium

A 4X space strategy game built with Angular 22 standalone components. You manage factions, fleets, and planets on a turn-based galaxy map, expand into star systems, colonize planets, and fight turn-based battles.

## Features

- Galaxy map with drag-to-pan camera, minimap, and arrow-key navigation
- Star system view with planets, garrisoning, and planet battles
- Planet surface view with building placement
- Turn-based fleet and planet battles
- Data-driven economy (credits, raw materials, research) with per-planet and per-building maintenance
- 4 local save slots with auto-save on key events
- Landscape-only mobile layout with auto-pause on focus loss
- CRT-styled UI

## Tech Stack

- Angular 22 (standalone components, new control flow, signal-free for now)
- TypeScript ~6.0
- RxJS 7.8
- Prettier 3 for formatting
- Vitest 4 / jsdom 28 for unit tests
- npm 12

No backend, no external APIs. All state is in-memory with `localStorage` persistence via `SaveGameService`.

## Getting Started

```bash
npm install
npm start         # ng serve, dev server
npm run build     # production build
npm test          # unit tests
```

The repo also ships a `start.bat` for Windows.

## Project Layout

```
src/app/
  app.ts / app.html / app.scss / app.routes.ts / app.config.ts
  main-menu/                       New game / load game UI
  services/                        ship, battle, planet-battle, economy, save-game
  components/
    star-map/                      Central gameplay view (map, system, planet)
    star-map-navigation/           Camera controls + minimap
    star-map-pause/                Pause menu, save slots
    star-map-minimap/              Standalone minimap widget
    battle-screen/                 Turn-based battle UI
    background-stars/              Decorative background
```

See `docs/` for design documentation:

- [Architecture](./docs/architecture.md) – overall architecture and component communication
- [Game Systems](./docs/game-systems.md) – major gameplay systems and their responsibilities
- [Data Models](./docs/data-models.md) – important data structures and domain models
- [Battle Rules](./docs/battle-rules.md) – battle and combat rules
- [Invariants](./docs/invariants.md) – rules and conditions that must always remain true

## License

Private / unlicensed.

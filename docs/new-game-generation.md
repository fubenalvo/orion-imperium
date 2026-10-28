# New Game Setup & Procedural Galaxy Generation

This document describes how a new game is configured, how its galaxy is generated, and how the
result becomes an ordinary persistent save. Related documents:
[Architecture](./architecture.md), [Data Models](./data-models.md), [Invariants](./invariants.md),
[Game Systems](./game-systems.md).

## Flow

```
MainMenu ── NEW GAME ──▶ NewGameSetupComponent (edits NewGameConfig, picks slot)
                               │ (start) { config, slotIndex }
                               ▼
MainMenu.newGame ─▶ NewGameService.startNewGame
                      1. validateNewGameConfig          (new-game-config.ts)
                      2. GalaxyGeneratorService.generate(config, seed)
                      3. validateGeneratedGalaxy        (galaxy-validation.ts)
                         └ on failure: retry with a derived seed (max 8 attempts)
                      4. SaveGameService.saveToSlot(slotIndex)
                      5. SaveGameService.activateSlot(slotIndex)  → autosave = live session
                  ─▶ router.navigate(['/star-map'])  (only when every step succeeded)
```

If any step fails, the errors are shown on the setup screen and nothing is activated. The legacy
`star-map-data.json` is no longer used to start games; it remains the reference for the Large
preset and the source for migrating pre-v3 saves.

## Configuration (`services/new-game.models.ts`, `services/new-game-config.ts`)

`NewGameConfig = { galaxySize, players: PlayerSetup[], seed? }`,
`PlayerSetup = { name, color, controller: 'human' | 'ai', difficulty }`.

Rules (enforced by `validateNewGameConfig`, kept true by the UI helpers):

- 2 ≤ players ≤ the size's `maxPlayers` (Small 3, Medium 4, Large 6). Shrinking the galaxy trims
  surplus AI players, never the human.
- **Exactly one human.** The game is single-player; selecting "Human" on another row demotes the
  previous human to AI. Supporting more humans would need hot-seat turns, which do not exist.
- Names: trimmed, non-empty, ≤ 20 chars, unique case-insensitively.
- Colors: from `PLAYER_COLOR_PALETTE`, unique, and not within RGB distance 60 of each other or of
  the neutral colors (`#ffcc00` independent, `#666666` unhabited).
- Seed: optional integer in `[0, 2^32)`. Empty → random.

## Galaxy size presets

All presets keep the 5:3 aspect ratio (the minimap is a fixed 240×144 px widget) and a similar
system density. **Large is the legacy map's scale** and must stay so.

| Size   | Grid    | Systems | Planets per system | Max players |
| ------ | ------- | ------- | ------------------ | ----------- |
| Small  | 180×108 | 8       | 1–4                | 3           |
| Medium | 240×144 | 11      | 1–5                | 4           |
| Large  | 300×180 | 14      | 1–6                | 6           |

Planet counts per non-home system are weighted like the legacy map (4×1, 4×2, 3×3, 2×4, 1×6).
Home systems have at least 3 planets. A map width of exactly 200 must never be used: it marks the
pre-grid legacy save format and would be rescaled by `SaveGameService.migrateSave`.

## Generation (`services/galaxy-generator.service.ts`)

- **Deterministic:** one Mulberry32 stream (`createMulberry32`, shared with resource deposits)
  seeded with the seed; the same config + seed always produces the same galaxy.
- **Black hole:** a `SpecialObject` `{ type: 'blackhole', component: 'blackhole', 4×4 }` whose cell
  span is centered exactly on `((W+1)/2, (H+1)/2)`. All sizes have even dimensions, so a 4×4 span is
  exactly centered. It is rendered by the existing `app-star-map-blackhole` component and has no
  gameplay effect beyond keeping systems and starting fleets `blackHoleClearance` cells away.
- **Home systems** sit on an ellipse around the black hole at evenly spaced angles (with small
  jitter), so every faction is about equally far from the center and its neighbours.
- **Other systems** use best-candidate (Mitchell) sampling: for each system, 40 random candidates
  are drawn and the one farthest from all existing systems wins, subject to `minSystemSpacing`,
  `blackHoleClearance` and `edgeMargin`. This avoids both clustering and empty regions, and the
  spacing keeps system labels from overlapping.
- **Planets** get sequential numeric ids, globally unique generated names, random type/size, and
  the legacy system-view layout positions by index. Unique planet names are required:
  `EconomyService` resolves planets by name.
- **Factions:** the human → id `'player'` (team 1); AIs → `'enemy1'…` in config order (team 2,
  `ai: true`, `aiDifficulty`); the neutral `independent` and `unhabited` factions are always added.
  All AIs share team 2, as on the legacy map, so they do not fight each other.
- **Homeworld** (planet 1 of each home system, earthlike/medium, population 1400): the legacy Earth
  buildings plus a Fusion Power Plant, so every faction starts energy-positive. Without it, AI
  homeworlds would lose satisfaction at −1/s and rebel before their develop action ran.
- **Starting assets:** 1000 credits / raw materials / research (scaled for AI by difficulty), the
  four basic technologies, and fleets placed 3–6 cells from the home system on free cells. The
  human always gets the legacy roster (ORION: 2 frigates, PEGASUS: 3 cruisers).
- **Visibility:** every star system starts `explored: true` — star positions and names are known
  and drawn on the galaxy view and minimap, as on every legacy-map game. Fog of war still covers
  grid cells (`exploredGridCells` starts `[]`; a *missing* field means a legacy all-explored save),
  enemy fleets (sensor range) and planet details (only the human homeworld starts
  `PlanetTile.explored`). `StarSystem.explored` decides whether a system is rendered at all, and
  sensor ranges (3–5 cells) are far shorter than system spacing (≥ 22 cells), so hiding systems
  made the rest of the galaxy undiscoverable (generator v1 bug). `migrateSave` reveals star
  positions in saves with `galaxy.generatorVersion < 2`.
- **Start view:** `defaultView` opens the human homeworld; the camera is centered on the home
  system so leaving the planet view lands there.
- **Metadata:** `StarMapData.galaxy = { size, seed, requestedSeed, generatorVersion }` (current
  generator version: 2). `seed` is the
  seed that actually produced the galaxy (after retries).

## AI difficulty (`components/star-map/ai-difficulty.ts`)

Difficulty is a per-faction value read by the existing AI pipeline and economy — there is no
separate AI implementation.

| Setting                       | Easy    | Normal   | Hard       | Used by                 |
| ----------------------------- | ------- | -------- | ---------- | ----------------------- |
| Attack strength advantage     | 1.6×    | 1.2×     | 1.0×       | `EnemyStrategyService`  |
| Income multiplier (gains only)| 0.75    | 1        | 1.3        | `EconomyService`        |
| Starting resources            | 0.75×   | 1×       | 1.5×       | generator               |
| Starting fleets               | 2 frigates | human roster | human roster + 4 destroyers | generator |
| Extra home-system colonies    | 0       | 1        | 2          | generator               |

`normal` is neutral by design: factions without `aiDifficulty` (older saves, the legacy map) keep
their exact previous behavior. Human factions are never ticked by the AI (`ai: false`).

## Persistence

A generated galaxy is an ordinary `StarMapData` save. Loading restores the stored snapshot and
never calls the generator. Since save version 3, `StarMap` persists `specialObjects` and `galaxy`
and reads `map.width/height` from the save. `migrateSave` backfills the legacy black hole for
pre-v3 saves (only when it fits the save's grid) and sets `aiDifficulty: 'normal'` on AI factions
that lack it.

## Validation (`services/galaxy-validation.ts`)

`validateGeneratedGalaxy` runs `validateSaveData` and then strict checks a fresh galaxy must pass:
map size matches the preset, exactly one centered black hole, unique system/planet/fleet/ship ids,
unique system and planet names, valid faction references, coordinates inside the map and outside
the black hole clearance, minimum system spacing, known buildings placed inside the surface without
overlap, known ship types, a homeworld and fleet for every participant, exactly one human
`'player'`, a valid difficulty for each AI, `defaultView` on the human homeworld, and factions that
match the config (names, colors, controllers, difficulties).

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
preset.

## Configuration (`services/new-game.models.ts`, `services/new-game-config.ts`)

`NewGameConfig = { galaxySize, players: PlayerSetup[], seed?, tutorial? }`,
`PlayerSetup = { name, color, controller: 'human' | 'ai', difficulty }`. `tutorial` (missing = on;
the TUTORIAL checkbox above START) is applied by `NewGameService.startNewGame` only, so headless
`createGame` callers (simulations) never get it. Adaptive difficulty is not part of the
configuration: it is a global Options setting (see Adaptive difficulty below).

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
Home systems have at least 3 planets.

## Generation (`services/galaxy-generator.service.ts`)

- **Deterministic:** one Mulberry32 stream (`createMulberry32`, shared with resource deposits)
  seeded with the seed; the same config + seed always produces the same galaxy.
- **Black hole:** a `SpecialObject` `{ type: 'blackhole', component: 'blackhole', 4×4 }` whose cell
  span is centered exactly on `((W+1)/2, (H+1)/2)`. All sizes have even dimensions, so a 4×4 span is
  exactly centered. It is rendered by the existing `app-star-map-blackhole` component, keeps
  systems and starting fleets `blackHoleClearance` cells away, and is a navigation obstacle with a
  4-cell no-fly radius (see [Star Map Terrain](./star-map-terrain.md#black-holes-navigation-obstacles)).
- **Nebulae** (`generateGalaxyNebulae`, generator v3): 3/4/5 irregular clouds for small/medium/large,
  spread over map zones, never covering a home system or touching the black hole no-fly zone.
  They use a separate seed-derived rng stream, so systems and fleets of a seed are unchanged.
  See [Star Map Terrain](./star-map-terrain.md#nebulae).
- **Asteroid belts** (`generateGalaxyAsteroidBelts`, generator v4; gentle arcs since v5): 2/3/4 long impassable belts with
  their own seed-derived rng stream, kept clear of systems, fleets, the black hole, the border and
  each other, and never disconnecting a home from any system. See
  [Star Map Terrain](./star-map-terrain.md#asteroid-belts).
- **Asteroid events:** `asteroidEvents` starts empty with a seed-derived rng state and first spawn
  timer (`initialAsteroidEvents`).
- **Home systems** sit on an ellipse around the black hole at evenly spaced angles (with small
  jitter), so every faction is about equally far from the center and its neighbours.
- **Other systems** use best-candidate (Mitchell) sampling: for each system, 40 random candidates
  are drawn and the one farthest from all existing systems wins, subject to `minSystemSpacing`,
  `blackHoleClearance` and `edgeMargin`. This avoids both clustering and empty regions, and the
  spacing keeps system labels from overlapping.
- **Planets** get sequential numeric ids, globally unique generated names, random type/size, and
  the legacy system-view layout positions by index. Unique planet names are required:
  `EconomyService` resolves planets by name.
- **Factions:** the human → id `'player'` (team 1); AIs → `'enemy1'…` in config order (teams 2, 3, …
  — one team each, `ai: true`, `aiDifficulty`, `aiPersonality`); the neutral `independent` and `unhabited` factions are always added.
  No two participants are permanent allies: everyone starts at war with everyone, under the opening
  war lock (`normalizeRelations(factions, INITIAL_WAR_LOCK_SECONDS)`), and treaties decide later who
  fights whom. See [Diplomacy](./diplomacy.md). (Pre-diplomacy saves keep all AIs on team 2.)
- **Homeworld** (planet 1 of each home system, earthlike/medium, population 1200): the Capital (core
  building) in the middle, with a Large Residential Block, a Fusion Power Plant, a Laser Turret and a
  Research Laboratory around it. The Fusion Power Plant makes every faction start energy-positive
  (120 vs 42); without it, AI homeworlds would be short on energy and rebel before their develop
  action ran. AI starting colonies get a Colony Center, a Small Residential Block and a Solar Array.
  Starting layouts are centered on the grid (`centerLayout`). See [Economy](./economy.md#colony-cores).
- **Planet surfaces:** settled planets get their terrain (`generatePlanetSurface`, seeded from the
  galaxy seed and planet id, kept clear of the starting buildings) during generation; all other
  planets receive the identical terrain on first load. See [Planet Surface](./planet-surface.md).
- **Starting assets:** 1000 credits / 2500 raw materials / 1000 research (scaled for AI by difficulty), a raw-material deposit on every homeworld (deposit tiles placed on free ground after the starting buildings; the finite reserve comes from `ensurePlanetDeposits`, see [Economy](./economy.md#economic-safety)), the
  four basic technologies, and the starting fleets. The human's fleet is stationed at the
  homeworld: on the home system's galaxy cell with `Fleet.system` set to the homeworld's footprint
  center (the same spot `FleetAssemblyService` uses for a fleet assembled at a Spaceport), so it
  shows next to the homeworld in the system view. AI fleets start on free cells 3–6 cells from
  their home system on purpose: `EnemyFleetService` keeps the strongest fleet on the home cell as
  the home guard and never sends a faction's only fleet away from it, so an AI fleet starting at
  home never explored (see [AI pipeline](./ai-pipeline.md)). The
  human always starts with one small scouting fleet (ORION: 2 scouts + 1 fighter), which keeps
  the starting upkeep low; the AI's starting fleet follows its difficulty (Easy: the same as the
  human, Normal: 2 frigates, Hard: 2 frigates + 3 cruisers; `startingFleetPreset` in
  `ai-difficulty.ts`, `FLEET_PRESETS` in `galaxy-generator.service.ts`). One fleet template can mix
  ship types.
- **Visibility:** every star system starts `explored: true` — star positions and names are known
  and drawn on the galaxy view and minimap, as on every legacy-map game. Fog of war still covers
  grid cells (`exploredGridCells` starts `[]`; a *missing* field means a legacy all-explored save),
  enemy fleets (sensor range) and planet details (only the planets of the human's home system
  start `PlanetTile.explored`). `StarSystem.explored` decides whether a system is rendered at all, and
  sensor ranges (3–5 cells) are far shorter than system spacing (≥ 22 cells), so hiding systems
  made the rest of the galaxy undiscoverable (generator v1 bug).
- **Start view:** `defaultView` opens the human homeworld; the camera is centered on the home
  system so leaving the planet view lands there.
- **Tutorial:** the setup screen has a TUTORIAL checkbox right above START GAME, checked by
  default. `NewGameService.startNewGame` writes it as `StarMapData.tutorial = { enabled, done: [] }`
  (headless `createGame` callers get no tutorial field). A tutorial game starts paused. See
  [Tutorial Hints](./tutorial-hints.md).
- **Metadata:** `StarMapData.galaxy = { size, seed, requestedSeed, generatorVersion }` (current
  generator version: 9 — the human's starting fleet stationed at the homeworld, the human's whole
  home system explored). `seed` is the
  seed that actually produced the galaxy (after retries).

## AI difficulty (`components/star-map/ai-difficulty.ts`)

Difficulty is a per-faction value read by the existing AI pipeline and economy — there is no
separate AI implementation.

| Setting                       | Easy    | Normal   | Hard       | Used by                 |
| ----------------------------- | ------- | -------- | ---------- | ----------------------- |
| Attack strength advantage     | 1.6×    | 1.2×     | 1.0×       | `EnemyStrategyService`, `EnemyFleetService` (accepted risk) |
| Combat forecast (decision quality) | no (summed strength) | yes | yes | `EnemyFleetService` interceptions and retreats |
| Reaction interval (fleet decisions) | 4 s | 2 s | 2 s | `EnemyFleetService` |
| Income multiplier (gains only)| 0.7     | 1        | 1.3        | `EconomyService`        |
| Navy target (strength and ship cap) | 0.6× | 0.85×  | 1×         | `EnemyEconomyService.militaryNeed` |
| Colonization pause after a planet gain | 360 s | 120 s | none   | `EnemyGoalService`      |
| Opening grace (no attack on the player) | 600 s | 360 s | 240 s | `opening-grace.ts`      |
| Adaptive band (`aiAdaptiveFactor`) | 0.6–1.1 | 0.75–1.2 | 0.9–1.35 | `AiAdaptiveDifficultyService` |
| Adaptive target (AI power / player power) | 0.85 | 1 | 1.2     | `AiAdaptiveDifficultyService` |
| Starting resources            | 0.75×   | 1×       | 1.5×       | generator               |
| Starting fleets               | human roster (2 scouts + 1 fighter) | 2 frigates | 2 frigates + 3 cruisers | generator |
| Extra home-system colonies    | 0       | 0        | 2          | generator               |

`normal` is the reference setting for decision quality: factions without `aiDifficulty` (older
saves, the legacy map) are treated as Normal. Difficulty changes decision quality (forecast vs
crude strength sums, reaction speed, risk appetite), tempo (navy size, colonization pause, opening
grace) and the income multiplier on legitimately produced income; it never bypasses game rules.

**Tempo values (2026-11-09).** Play testing found every difficulty too fast for a human. The APM
report ([AI Pipeline](./ai-pipeline.md#action-ledger-aiactionledger)) showed the AI acts only 4–8 times per game minute on
every difficulty, so the gap is expansion pace and navy size, not decision speed. Easy and Normal
were therefore slowed on tempo: lower navy target, a colonization pause, a longer opening grace, no
extra starting colony on Normal, Easy income 0.75 → 0.7. Measured with a passive player on a small
map after 30 minutes (seeds 31337 and 4242): AI planets Easy 2–5 (before 6–7), Normal 4–8 (before
6–8), Hard 5–9 (unchanged); warships Normal 13–17 (before 16–21). Rejected while tuning:

- Easy income 0.6: Easy AIs founded their first colony only after 10–15 minutes.
- Normal pause 240 s: on the large map (late-economy acceptance test) the technologist lost the
  land race to its neighbours during the pauses and founded 2 colonies in 90 minutes; at 120 s it
  founds 5. The same run exposed the stale-target idle fixed in
  [AI Pipeline](./ai-pipeline.md#colonization).

The colonization pause runs from the last planet gain (colonization or conquest) and only blocks
starting a new colonize goal; a run already under way continues. It is in memory, so after a
load the first colonization is not delayed.

### Adaptive difficulty (`components/star-map/ai-adaptive-difficulty.service.ts`)

**ADAPTIVE AI** is a global setting in the Options menu (`AiSettingsService`, localStorage key
`orion_ai_adaptive`, not in saves, default on). It applies to every game, including saves made
before it existed, and takes effect at once. The App root component creates the service, which
pushes the stored value into a module-level switch in `ai-difficulty.ts`
(`setAdaptiveDifficultyEnabled`), because the economy and AI read the factor from plain
functions. Headless games (simulations, unit tests) never create it, so the switch stays off and
their measurements stay comparable.

While it is on, every AI with a difficulty is adaptive; a missing `Faction.aiAdaptiveFactor`
counts as 1 and is written on the first update. Once per game minute
`AiAdaptiveDifficultyService` compares each adaptive AI's empire power with the human's
(the geometric mean of the smoothed ratios of planets, population, combat strength of fleets plus
reserve, and researched technologies) and moves the factor by 0.05 toward the difficulty's target
ratio; inside ±15% of the target it holds (no oscillation). The factor is clamped to the
difficulty's band, so the chosen difficulty still sets the floor and the ceiling. It multiplies
the AI's income multiplier and navy target and divides its colonization pause; it never changes
combat rules or grants resources directly. It reads the real world, not the AI's fog-of-war view
(a game director, not an AI decision), and the AI never reads the power ratio. Nothing changes
while the player owns no planet. The factor is saved on the faction (optional field, no save
version change; save validation accepts 0.25–2); the minute accumulator is in memory. With the
option off the saved factor is kept but ignored (factor 1) and does not move, so turning it back
on resumes where it stopped. The AI debug panel shows the factor next to the difficulty
(`normal ×0.85`) while the option is on.

## AI personality (`components/star-map/ai-personality.ts`)

Each generated AI faction gets `aiPersonality` — `balanced`, `expansionist`, `militarist` or
`technologist` — cycling through that list from a seed-derived offset (`(seed + aiIndex) % 4`).
The assignment is arithmetic on the seed and does not consume the Mulberry32 stream, so a seed's
galaxy layout is unchanged. Missing on older saves and the legacy map → `balanced`, which is the
neutral profile. What each personality changes is documented in
[AI Pipeline](./ai-pipeline.md#personalities-and-difficulty). Human factions are never ticked by the AI (`ai: false`).

## Persistence

A generated galaxy is an ordinary `StarMapData` save. Loading restores the stored snapshot and
never calls the generator. `StarMap` persists `specialObjects`, `galaxy`, `nebulae`,
`asteroidEvents`, `asteroidBelts` and `PlanetTile.surface`, and reads `map.width/height` from the
save. The generated save carries `saveVersion` and `gameVersion`; the state it leaves out (space
bases, demands, anomalies, trade network) is created by `SaveGameService.normalizeSave` on the first
load. Saves of unsupported formats are rejected ([Versioning](./versioning.md)).

## Independent civilizations (generator v7)

After everything above, `generateCivilizationSystems` adds 3 / 4 / 5 extra star systems (small / medium / large) with neutral civilization worlds — a Bank, a Trading Post and light defenses on each capital — from their own rng stream, so the regular systems, fleets, nebulae and belts of a seed are unchanged. They keep the usual spacing and clearances, stay well away from home systems and reachable from them; a civilization without a valid position is skipped. The preset's `systemCount` counts only the regular systems. Details: [Trade Network](./trade-network.md#independent-civilizations). Headless simulations may pass `{ civilizations: false }` as a third `generate` argument; New Game never does.

## Validation (`services/galaxy-validation.ts`)

`validateGeneratedGalaxy` runs `validateSaveData` and then strict checks a fresh galaxy must pass:
map size matches the preset, exactly one centered black hole, unique system/planet/fleet/ship ids,
unique system and planet names, valid faction references, coordinates inside the map and outside
the black hole clearance, minimum system spacing, known buildings placed inside the surface without
overlap and off terrain obstacles (settled planets must carry a valid surface), known ship types, a homeworld and fleet for every participant, exactly one human
`'player'`, a valid difficulty for each AI, `defaultView` on the human homeworld, at least one
nebula and none covering a home system, no nebula or asteroid belt reaching into the Dyson ring zone ([Dyson Swarm](./dyson-swarm.md#ring-geometry)), an initialized asteroid event state, asteroid belts that cover no system or starting fleet and leave every home connected to every system, civilization systems that are extra to the preset count (at most the configured number), independent, free of player planets and each with a Bank and a Trading Post, and factions that
match the config (names, colors, controllers, difficulties).

# Planet Surface

The planet view shows a colony on an isometric planet surface: a buildable
grid framed by procedurally generated terrain (coasts, cliffs, mountains,
lava, cloud abysses, canyons) that can also cut into the grid. This document
covers the surface grid, terrain generation and persistence, construction
rules on terrain, and how the view is rendered.

Related: [Data Models](./data-models.md) (`PlanetTile.surface`),
[Game Systems](./game-systems.md#planet-surface) (planet screen behaviour),
[New Game Generation](./new-game-generation.md) (starting layouts),
[AI Pipeline](./ai-pipeline.md) (AI construction),
[Invariants](./invariants.md#planet-surface), [UI Styling](./ui-styling.md).

## Code map

| File | Responsibility |
|---|---|
| `star-map/planet-surface/planet-surface.ts` | Grid size, blocked-mask encoding/decoding, placement helpers (`isFootprintBlocked`, `centerOutPlacementOrder`), per-planet seed. **Gameplay source of truth.** |
| `star-map/planet-surface/planet-surface-field.ts` | Deterministic terrain field `f(u, v)`, per-planet-type biome parameters, height mapping, seeded simplex noise. |
| `star-map/planet-surface/planet-surface-generator.ts` | Builds the persisted `PlanetSurface` record, template centering, deposit placement. |
| `star-map/planet-surface/planet-surface-renderer.ts` | Bakes the terrain + decor into a canvas (visual only, cached). |
| `star-map/planet-surface/planet-settlement.ts` | Street network, plots and street lights (visual only). |
| `star-map/star-map-planet-screen/` | The planet view component (scene layers, build mode, camera). |
| `public/planet-surface/ore-deposit.svg` | Raw-material deposit sprite. |
| `scripts/building-sprites/` | Generator of the building sprites (`npm run sprites:buildings`) → `public/buildings-svg/<id>.svg`. |

## Grid

- Side length `N = numericSize * 4 + 6`: tiny 10, small 14, medium 18,
  big / huge 22 (`getPlanetGridSize`). These are exactly twice the original
  5 / 7 / 9 / 11 grids, so the relative progression of sizes is unchanged.
- Coordinates are 0-indexed cells; a building's `x`/`y` is its top-left cell
  and it covers `size × size` cells. Deposits occupy one cell.
- Every system that places or validates buildings uses `getPlanetGridSize`
  (planet screen, AI construction, galaxy generator and validator, save
  migration). `legacyPlanetGridSize` exists only for the v6 save migration.

## Terrain data (`PlanetTile.surface`)

```ts
interface PlanetSurface {
  version: number;   // PLANET_SURFACE_VERSION (generator algorithm)
  seed: number;      // planetSurfaceSeed(galaxy seed, planet id)
  gridSize: number;  // grid the record was generated for
  intrusion: number; // 0..1 field parameter actually used (see retries)
  blocked: string;   // row-major hex bitmask of terrain-blocked cells
}
```

- `blocked` is **authoritative for gameplay**. Visual terrain is rebuilt from
  `seed` + `intrusion` every time the view opens, but the renderer flattens
  every unblocked grid cell to the buildable plateau, so what you can build on
  always looks buildable and vice versa.
- A record whose `gridSize` does not match the planet (or whose mask is
  malformed) is ignored: `getBlockedMask` returns `null`, placement treats
  the planet as fully open, save validation reports a warning, and
  `StarMap.ensurePlanetSurfaces` regenerates it on the next load.
- Mask encoding: each row is `ceil(N / 4)` hex digits; bit `x % 4` of digit
  `floor(x / 4)` is cell `x`. Max 132 characters per planet.

### When surfaces are generated

| Situation | Where |
|---|---|
| New game, settled planets (homeworlds, AI starting colonies) | `GalaxyGeneratorService.generate`, after starting buildings are placed |
| New game, every other planet | `StarMap.ensurePlanetSurfaces` on the first load (before deposits are generated), then persisted by the next save |
| Saves older than v6 | `SaveGameService.migrateSave` (see below) |
| Any planet with a missing/stale record | `StarMap.ensurePlanetSurfaces` on load |

Generation is deterministic for (galaxy seed, planet id, type, size,
occupied cells), so it does not matter which of these paths runs first.
Unsettled planets are not generated inside the galaxy generator only for
speed: the generator is run many times (retries, tests) and ~100 surfaces
per galaxy would dominate its cost.

### Generation rules (`generatePlanetSurface`)

1. Build the field for the planet and evaluate it on a half-cell lattice
   (corners, edge midpoints and center of every cell; neighbours share
   samples). A cell is blocked when at least 3 of its 9 samples are not land
   (`|f| > SURFACE_LAND_LIMIT`). Cells deeper than `field.maxReach()` inside
   the grid can never be blocked and are skipped.
2. Cells occupied by existing buildings or deposits (`keepClear`) are never
   blocked.
3. `tidyRegions`: obstacle specks smaller than 3 cells that do not touch the
   grid border are removed; buildable pockets smaller than 3 cells enclosed by
   terrain are blocked (unless they hold a building or deposit).
4. If more than 20% of the grid ends up blocked, retry with shallower
   intrusions (`intrusion` 1 → 0.6 → 0.3 → 0). At 0 the grid is fully
   buildable and terrain exists only outside it.

## Terrain field

World coordinates are cell units over the grid plus
`PLANET_SURFACE_MARGIN` (14) cells of environment on every side; the grid
occupies `[margin, margin + N)`.

- `f(u, v)` = domain-warped fBm relief + a **tilt** + biome bias + crater
  stamps, multiplied by a mask that is 0 inside the grid.
- The tilt raises one side of the world and lowers the other. The high side
  always points to the back of the isometric view (screen top, ±60°), so
  mountains rise behind the colony and coasts / chasms lie in front of it —
  tall terrain never stands in front of buildings.
- The mask edge is pushed into the grid by a low-frequency **intrusion**
  noise. Where it reaches in, the relief is also pushed away from "land", so
  every lobe reads as a real obstacle: a bay on the low side, a rocky spur on
  the high side. Elsewhere the mask edge retreats outside the grid, so flat
  land continues past the grid edge and the colony does not look framed by a
  rectangle.
- `height(f)`: `|f| ≤ 0.12` → gentle land (plateau `h = 0` inside the grid);
  `f > 0.12` → terraced highland (sharp terraces = mesas and cliffs);
  `f < -0.12` → shore (beach or cliff, per biome) down to the low floor.

Biomes (`SURFACE_BIOMES`, by `PlanetType`):

| Type | Low terrain | Character |
|---|---|---|
| earthlike | sea (beaches, shallow/deep water, lakes) | grassland, forests, snow-capped mountains |
| ice | frozen sea with cracks and open-water leads | snowfields, blue ice cliffs, ice shards |
| venuslike | lava (glowing crust plates), calderas | sulfur plains, basalt, volcanic vents |
| gasgiant | cloud abyss far below | floating platforms with sheer edges, crystal clusters |
| marslike | deep canyons | rust plains, stratified mesas, craters, boulders, spires |
| desert | dry canyons | dunes, banded mesas, hoodoos, shrubs |

Changing the field or the biome table changes how existing saves **look**
(never what is buildable). Bump `PLANET_SURFACE_VERSION` if a future change
needs to tell old and new records apart.

## Construction on terrain

- Player (`StarMapPlanetScreenComponent.updatePreview`) and AI
  (`EnemyEconomyService.canPlace`) reject any footprint containing a blocked
  cell, in addition to the existing grid/overlap/deposit rules. Player error:
  "The terrain here is not suitable for construction."
- The AI scans candidate positions center-out (`centerOutPlacementOrder`), so
  AI colonies grow as one compact settlement around the grid center.
- Deposits (`pickResourceDeposits`) are placed on unblocked, unoccupied
  cells, preferring cells with ≥ 4 cells of clearance from terrain and the
  grid edge, so a 3×3 Mining Complex always fits next to them.
- Starting layouts (`centerLayout`) are authored at the origin and moved to
  the grid center; the surface is generated around them.

## Save compatibility (save version 6)

For saves older than v6, `migrateSave` (once, idempotent through
`saveVersion`):

1. moves every building and deposit by `floor((N_new - N_old) / 2)` — the old
   layout always fits and ends up centered on the doubled grid;
2. generates the surface with those cells kept clear.

Players therefore keep every building; nothing ends up on terrain.

## Rendering

The scene sits in one camera element (`.planet-surface__camera`), a
zero-size point at the viewport center that carries the pan/zoom transform.
Layers, back to front:

1. **Terrain canvas** — `renderPlanetSurface` bakes the environment into a
   screen-space canvas once per planet (≈0.5 s for the largest planets, run
   off the first frame; the canvas fades in). Results are cached (last 3).
   - Projection (shared by all layers): `X = (u − v)/√2`,
     `Y = (u + v)/(2√2) − h·sin 60°`, in cell units from the world center.
     It is exactly what the CSS `rotateX(60deg) rotateZ(45deg)` ground plane
     produces; changing one without the other misaligns the layers.
   - Raster: each pixel column is walked front to back; each heightmap sample
     paints from its projected top down to the highest pixel painted so far,
     which yields real vertical cliff faces. Steep samples blend into a
     stratified face colour (bands follow world height).
   - Lighting from the screen's upper left, ray-marched cast shadows, liquids
     (water depth/foam, frozen sea, lava, clouds), a fade into the planet's
     haze colour at the world edge.
   - Heights are capped inside the grid (0.55 cells) and in front of it
     (by distance), so baked terrain never covers a buildable cell.
   - Decor (trees, conifers, boulders, spires, crystals, ice shards, vents,
     shrubs) is deterministic per seed, kept away from buildable cells (tall
     decor further), and dropped where nearer terrain hides its foot. Blocked
     cells whose terrain ended up flat (legacy colonies, folded pockets) get
     rubble so they still read as obstacles.
2. **Ground plane** — the tilted flat element. It holds the settlement SVG
   (worn ground, deposit glow, paved plots, streets, cast building shadows,
   street lights, buildable-zone outline in build mode, hover highlight) and
   the interactive CSS grid of cells (contiguous, no gaps).
3. **Sprites** — buildings (`public/buildings-svg/`, see [Building sprites](#building-sprites)),
   deposits and the build ghost, positioned with the same projection. A
   sprite's bottom center is its footprint's front corner (inset 0.15 cells,
   where the streets run) and its width is the footprint diamond's width.
   Painter's order is a topological sort of the "behind" relation between
   footprints, applied only to sprites that overlap horizontally on screen;
   sorting by the front corner alone is wrong for mixed sizes.
4. **Labels** — building names on hover, or for all buildings with the NAMES
   toggle. Sprites and labels never take pointer input; hover and clicks
   always reach the cells.

### Streets (`computeSettlementLayout`)

Visual only, recomputed whenever buildings change. Streets run on cell
edges, never through cells, so they never consume buildable space:

- buildings of size ≥ 2 get a ring street, so neighbours share streets and
  clusters read as city blocks;
- all buildings are joined into one network with repeated multi-source
  shortest paths from the network to the nearest unconnected building
  (existing streets are cheap, turns cost extra, so streets stay straight
  and merge into avenues);
- an access road leaves the grid across open land when the terrain allows,
  fading out;
- an edge is usable only if a buildable cell is on at least one side and it
  is not inside a single building.

### Building sprites

Every building has one SVG in `public/buildings-svg/` (file name = building
id with dashes), generated from geometry by `scripts/building-sprites/`:

- `iso-svg.mjs` — the painter: the planet-view projection (same formula as
  the terrain renderer and the CSS ground plane), the shared light
  (top / left-front / right-front face brightness), and primitives (boxes
  with ambient-occluded faces, window grids, glowing light strips,
  cylinders and cooling-tower shells, domes, discs, glows, trees).
- `buildings.mjs` — one design per building id (Imperium Galactica-like
  colony architecture: concrete and steel volumes on a bevelled base slab,
  lit windows, cyan light strips, red beacons, hazard-yellow markings).
  Each design draws back to front, since SVG paints in document order.
- `generate.mjs` — writes one file per building in `planet-data.json` and
  fails if a building has no design, so a new building cannot ship without
  a sprite.

Sprite contract: the SVG is exactly as wide as the footprint diamond of
`size − 2 × 0.15` cells and its bottom edge is that footprint's front corner
(the component's `SPRITE_INSET`; the generator has its own copy that must
match). Re-run `npm run sprites:buildings` after changing a design, the
inset or the projection. The old raster sprites in
`public/buildings-isometric/` and `public/buildings/` are no longer used.

### Camera

- Zoom levels CLOSE / MEDIUM / FAR scale `PLANET_SURFACE_CELL_VW` (4.4vw)
  by 1 / 0.733 / 0.537 — each step is the same factor. CLOSE matches the old
  MEDIUM framing and MEDIUM the old FAR; FAR is a new overview where the
  largest colony fits the view.
- The camera center may roam over the grid's projected diamond (plus one cell
  of headroom); the world margin keeps the view filled with terrain.
- Zoom and pan are view state only and are never saved.

## Known limitations

- Terrain baked into the canvas cannot occlude sprites. Height caps keep
  terrain in front of the grid low, but decor or rocks right next to a
  building can still be drawn behind it.
- The terrain canvas is rasterized at ≤ 40 px per cell; at CLOSE zoom on
  large screens it is upscaled (smooth filtering plus per-pixel grain hide
  most of it).
- Under jsdom (unit tests) the terrain canvas is not rendered.

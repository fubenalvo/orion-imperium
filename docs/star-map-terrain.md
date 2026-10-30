# Star Map Terrain & Events

Galaxy-map features that change how fleets move and see, plus the drifting-asteroid event:

1. [Black holes](#black-holes-navigation-obstacles) — impassable navigation obstacles.
2. [Nebulae](#nebulae) — procedurally generated clouds that slow fleets and degrade sensors.
3. [Drifting asteroids](#drifting-asteroids) — periodic collectible objects crossing the map.
4. [Asteroid belts](#asteroid-belts) — long, permanent, impassable walls of rock that split the map into regions.

All rules apply identically to the player and to AI factions. Related docs: [Game Systems](./game-systems.md) (movement, fog of war), [AI Pipeline](./ai-pipeline.md) (salvage role, AI fog of war), [New Game Generation](./new-game-generation.md), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Code map

| File | Responsibility |
|---|---|
| `components/star-map/fleet-navigation.ts` | Pure geometry: capsule obstacles (discs and segments), segment tests, cached `NavGraph` visibility graph, `planRoute` |
| `components/star-map/asteroid-belts.ts` | Belt config, procedural placement + connectivity check, capsule obstacles, deterministic rock fragments and render data |
| `components/star-map/nebula.ts` | Nebula shape, point tests, `NebulaField` (cell mask + travel-time integration), procedural generation, SVG paths, `NEBULA_CONFIG` |
| `components/star-map/star-map-terrain.service.ts` | Session holder of the loaded terrain (obstacles + nebula field). Configured by `StarMap.loadGame`; empty until then |
| `components/star-map/star-map-movement.service.ts` | Routes every galaxy order around black holes; applies the nebula slowdown per step; ETA estimates |
| `components/star-map/star-map-sensor.service.ts` | Nebula sensor rule (`isGalaxyCellSensed`, `getGalaxySensorCells`) for the player layer |
| `components/star-map/enemy-intel.service.ts` | AI fog of war; uses the same sensor rule (`isPointSensed` for non-fleet objects) |
| `components/star-map/drifting-asteroids.ts` | Pure asteroid rules: config, spawn trajectories, intercept planning, stateful rng |
| `components/star-map/drifting-asteroid.service.ts` | Live asteroid state: tick (spawn, move, exit, collect, steer player intercepts), save/restore |
| `components/star-map/enemy-fleet.service.ts` | AI `salvage` fleet role |
| `components/star-map/star-map-galaxy-view/` | Rendering: nebula SVG layer, no-fly ring, asteroids with trails |
| `components/star-map/star-map-asteroid-info/` | Asteroid panel (cargo, time left, per-fleet INTERCEPT) |

## Black holes (navigation obstacles)

The existing `SpecialObject` with `type: 'blackhole'` is the obstacle; no second black hole system exists.

- **No-fly zone:** a disc around the object's center (`x + (width-1)/2`, `y + (height-1)/2`, the same center galaxy validation uses). Radius = `SpecialObject.navigationRadius` if set, otherwise `max(BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS (4), max(width, height)/2)`. The generated 4×4 black hole therefore has radius 4 cells — far inside every preset's `blackHoleClearance` (≥ 14), so no system or starting fleet is cut off.
- **Routing:** `Fleet.targetX/targetY` stays the *final destination* for every caller (player clicks, all AI subsystems, intercepts). `StarMapMovementService` plans a route the first time it sees a new target (`planRoute`) and flies its waypoints before the target. Because routing lives in the movement step, the AI needs no changes to obey it, and a save loaded with an old straight order through the black hole is re-planned on the next frame.
- **Algorithm:** every obstacle is a *capsule* (points closer than `radius` to a segment; a black hole is the degenerate disc case, belts are chains of capsules). Straight line if no leg comes within any radius; otherwise Dijkstra over a visibility graph whose nodes are the start, the target and the vertices of a 16-gon (disc) or stadium (capsule) circumscribed around each obstacle and inflated by 5%, so polygon edges never touch it. Vertices outside the map or inside another obstacle are dropped. `NavGraph` caches the vertices and the vertex-to-vertex visibility per loaded galaxy (`StarMapTerrainService.navGraph`); a query only tests the start and target against them.
- **Forbidden area, not center:** a leg is rejected when its closest distance to the center is below the radius, so lines that miss the center but cut the disc are rerouted.
- **Failure handling (never fly through as a fallback):**
  - target inside a no-fly zone → `target_blocked`; unreachable target → `no_route`.
  - Player orders are validated before they are accepted (`StarMap.moveSelectedFleet`): the order is not given and the fleet panel shows the reason.
  - An already accepted order that becomes unreachable is dropped by the movement step (target cleared, fleet stays), reported through `onRouteBlocked` (fleet panel or map notice for player fleets).
  - A fleet whose position is already inside a disc (only possible in saves older than this feature) ignores that disc so it can leave.
- **Route cache:** the route is cached per fleet object in a `WeakMap` and never saved; it is re-planned whenever the target differs, so moving targets (pursuits, intercepts) are always routed from the fleet's current position.
- **Visuals:** fleet trails are drawn per route leg (`getGalaxyTrailSegmentsVw`), so the line shown is the path flown. The black hole visual (`blackhole/`, pure CSS) is centered on its cell span and sized from the no-fly radius (`--bh-radius-vw`): its thin bright photon ring lies exactly on the no-fly edge, so the visual itself shows the forbidden area. Around it: a full Einstein ring hugging the shadow with a thick lensed arc on top, a wide tilted accretion disk (2D rotate + `scaleY`, streaks spinning by transform only) whose far half sits behind the shadow and near half crosses in front of it (two `clip-path` halves), Doppler brightening on the left, a warm bloom and a horizontal light streak along the disk plane. All ring gradients use `closest-side` so stops are fractions of each element's own radius. The exact dashed no-fly outline (`.no-fly-ring`, UI teal) is drawn only while a fleet is selected, when the player is planning a route.
- **Speed / travel time:** unchanged except for the detour length.

## Nebulae

### Data and generation

`Nebula { id, x, y, radius, lobes[], rotation, color }` in grid coordinates. The edge distance at angle θ is `radius × lobe(θ)`, cosine-interpolated between evenly spaced `lobes` (9–14 multipliers in 0.62–1.28) — smooth, irregular blobs, never identical circles.

- Generated at New Game by `generateGalaxyNebulae` (galaxy generator v3) with **its own rng stream** derived from the galaxy seed (`seed ^ 0x9e3779b9`), so galaxy layouts of existing seeds did not change.
- Count: small 3, medium 4, large 5 (`NEBULA_CONFIG.countBySize`); radius 12–19% of the map height before lobes (≈ 13–20 cells on small, 22–34 on large maps).
- Spread: the map is split into ~2× as many zones as nebulae; each nebula goes to a random point in a different random zone.
- Rejected placements: covering a home system (edge + 4 cells), touching a black hole no-fly zone (+4 cells), heavy overlap with another nebula, or mostly off-map. After bounded attempts a nebula is skipped, so fewer than requested is possible, invalid never.
- Persisted in `StarMapData.nebulae`; **loading never regenerates them**. Saves older than v4 get the deterministic set for their seed once in `SaveGameService.migrateSave` (legacy-map saves use seed 0); systems owned by a major faction are kept clear.
- Galaxy validation requires ≥ 1 well-formed nebula and no homeworld system inside one.

### Movement penalty

- While a fleet's **current position** is inside any nebula its galaxy speed is × `NEBULA_CONFIG.speedMultiplier` (0.7 → 30% slower). Applied per movement step, so the penalty is proportional to the distance flown inside and cannot be applied twice (nothing is stored; re-planning and save/load cannot double it).
- **Overlap rule:** inside one or several nebulae is the same single penalty (no multiplication).
- ETA (`estimateRemainingTravelSeconds`, `estimateTravelSeconds`) integrates the same point test along the route in 0.5-cell samples; the fleet panel shows it.
- System view (inside star systems) is unaffected.

### Sensor penalty

- Rule: a galaxy sensor source inside a nebula, **or** a target cell inside a nebula, is sensed with the radius × `NEBULA_CONFIG.sensorMultiplier` (0.6 → 40% shorter). Both at once still apply the multiplier once.
- Implemented once in `StarMapSensorService` (`isGalaxyCellSensed`, `getGalaxySensorCells`, `getGalaxyOuterRingCells`) and used by the player's sensor layer (`computeGalaxySensorCells`: owned systems and fleets, including the preview ring) and by `EnemyIntelService` (AI fog of war). Research sensor bonuses are added to the base radius before the multiplier.
- Fleet visibility, fleet list, minimap, trails and context menus all read the sensor cell layer, so a fleet hidden in a nebula is not leaked through other UI paths.
- Feedback: fleets inside a nebula get a hazy outline on the map and an "IN NEBULA: SPEED −30%, SENSORS −40%" line in the fleet panel.

### Rendering

One SVG in grid units inside the transformed world (scales with zoom), under the fog layer (z 4), `pointer-events: none`, `mix-blend-mode: screen`. Per nebula: a faint colored glow (halo, gradient body, core; blurred), then the gas structure — the shared `nebula.png` texture (rotated by the nebula's `rotation`, sized `3 x radius`) on an opaque black backing, grayscaled and multiplied by the nebula color, plus a pale untinted wisp copy, cut to the nebula shape by a blurred mask with a center-to-edge falloff and screened over the glow — and finally the dashed edge marking where the penalties start. The black backing matters: `nebula.png` is mostly transparent, and the multiply tint over transparency would produce a flat fill. Everything is static (no animation), so the layer is rasterized once per zoom level. `NebulaView.cx / cy / textureSize / rotationDeg` carry the texture placement. Paths are built once per load (`StarMap.rebuildTerrainViews`). The minimap draws the same body outlines as soft translucent patches under systems and fleets (scaled into minimap pixels; shown for the whole map, like star positions).

## Drifting asteroids

### Lifecycle

| Step | Rule |
|---|---|
| Spawn | First after 40–80 s of game time, then every 90–170 s, only while fewer than `maxActive` (3) are active. Entry: uniform point on the map border; direction: toward a random point in the central 50% of the map; must cross ≥ 50% of the shorter map side and keep ≥ 3 cells from any black hole no-fly zone (else retried, then skipped until the next interval). |
| Move | Straight line, constant speed 0.12–0.2 cells/s; position = start + dir × `traveled`. Driven by the scaled game delta: frozen while paused, faster at 2×. |
| Exit | Removed when `traveled ≥ length` (reached the opposite border). |
| Collect | A living fleet of a non-neutral faction within `collectRadius` (1 cell, gameplay coordinates) collects it; closest wins, ties → lowest fleet id. The asteroid is removed in the same step the reward is added (exactly once). `StarMap` autosaves immediately after a collection so a battle-return reload cannot bring it back. |

### Types and rewards (`ASTEROID_CONFIG.types`)

| Type | Weight | Cargo |
|---|---|---|
| Ore | 5 | 250–600 raw materials |
| Crystal | 3 | 150–400 research points |
| Mixed cargo | 2 | 120–320 raw materials + 80–220 research points |

Rewards go into the existing `Faction.currencies` (`rawmaterials`, `research` — research points are a spendable currency, see [Research](./research.md)). The game has no rare resource, so none is used. Cargo is rolled at spawn and rounded to tens.

### Interception

- **Player:** click an asteroid to open its panel (cargo, time until it leaves, every player fleet with an INTERCEPT button and its ETA, or OUT OF REACH). With a fleet selected in MOVE mode, clicking an asteroid orders that fleet directly. The order is accepted only if `planIntercept` finds a meeting point before the asteroid leaves.
- **Intercept order:** `Fleet.interceptAsteroidId` (persisted). Every `reaimInterval` (1 s) `DriftingAsteroidService` re-plans and sets `targetX/targetY` to the meeting point; routing and nebula slowdown apply as for any move. A manual move clears the order. If the asteroid is collected by someone else, leaves, or becomes unreachable, the order and target are cleared and the player gets a notice.
- **Planning:** closed-form straight-line pursuit (lower bound) refined by fixed-point iteration on the real route time (`StarMapMovementService.estimateTravelSeconds`: black hole detours + nebula slowdown).
- **AI (`salvage` role, EnemyFleetService):** at each fleet decision, one free fleet per faction (never the home guard) is sent to the asteroid it can meet soonest, if the meeting is within 150 s and within 45 cells of the faction's territory and no other AI fleet already claims that asteroid. The fleet service stays the single owner of AI fleet targets: it re-plans the meeting point at each decision and re-issues the order through `moveTo` only once the point drifted a full cell; AI fleets never use `interceptAsteroidId`. Rewards follow the same collection rule — the AI gets nothing for free.

### Visibility

Asteroids are visible everywhere on the map except inside a nebula, where they are only seen within sensor coverage (player: sensor/preview cells; AI: `EnemyIntelService.isPointSensed`). With fog of war off, they are always visible.

### Rendering

Absolutely positioned like fleets (z 13: above fog and trails, below fleets): a lumpy glowing rock colored by type (ore amber, crystal cyan, mixed violet), a label, and a gradient tail pointing backwards whose length is `min(traveled, trailLength)` — derived from state each frame, never stored. Selected / targeted asteroids get a rotating dashed ring (green when a player fleet is en route).

### Persistence

`StarMapData.asteroidEvents = { nextId, spawnTimer, rngState, active[] }` (Mulberry32 state, so spawns continue identically after a load). Collected and expired asteroids are simply absent. Malformed asteroids are dropped on restore (save validation only warns); intercept orders pointing at missing asteroids are cleared.

## Asteroid belts

Long, narrow, permanent walls of rock — the strategic equivalent of cliffs: they split the map, force detours around their ends and create chokepoints between belts. They cannot be selected, collected, mined, damaged or crossed, and no technology changes that.

### Geometry (navigation) vs fragments (visuals)

- **Data:** `AsteroidBelt { id, points[], halfWidth, visualSeed }` (2 points when straight, 5 when curved) in `StarMapData.asteroidBelts`. Only this geometry is saved.
- **Barrier:** one capsule per polyline segment, radius `halfWidth + safetyMargin` (0.5). Consecutive capsules share their joint, so a belt has no gap; the capsules go into the same obstacle list and routing graph as black holes (`beltObstacles`). There is no per-fragment collision.
- **Fragments:** `buildBeltFragments` scatters irregular rocks from `visualSeed` (deterministic, never saved), always within `halfWidth` of the axis — the barrier covers every rock and every visual crack. Density varies along the belt (clumps and thin stretches), rocks are larger near the axis, sizes/rotations/shades/shapes vary.
- **Consequences:** a target inside a belt is `target_blocked` (`blockedBy: 'belt'`; the player sees "inside an impassable asteroid belt"); an opening between two belts is usable only if it is wider than both no-fly margins; starting inside a capsule (impossible in generated games) only allows leaving it.

### Generation (galaxy generator v4–v5)

`generateGalaxyAsteroidBelts` with its own rng stream (`seed ^ 0x85ebca6b`), so systems, fleets and nebulae of a seed are unchanged.

- Count 2/3/4 (small/medium/large); length 20–36% of the map width; half width 0.9–1.7 cells; 45% are gentle arcs (quadratic curve sagging 6–14% of the length, sampled into 4 capsules; generator v5 — v4 used a single kink).
- Spread like nebulae (one belt per random map zone); orientations = base angle + k·π/count + jitter, so belts never all run parallel.
- Rejected placements: within `systemClearance` (4 cells beyond the no-fly edge) of any star system, within half that of a starting fleet, closer than `minPassage` (6 cells of open space) to another belt, the black hole no-fly zone or the map border. The border rule keeps both ends of every belt a real route and prevents accidental edge passages.
- Hard check: every home system must still reach every star system with the real router (`areSystemsConnected`); belts are removed from the end until it holds. Galaxy validation repeats the cover and connectivity checks.
- Drifting asteroid tracks keep `obstacleMargin` from belts as from black holes, so intercept points are never inside a belt.
- Saves older than v5 get `asteroidBelts: []`: inserting walls into a game in progress could cut off fleets or territory.

### Rendering

One SVG layer in grid units inside the transformed world (scales with zoom) at z 4: under the fog like all terrain (unexplored belts are strongly dimmed), below asteroids, trails (14) and fleets (15), so routes and fleets stay readable; `pointer-events: none`. Per belt: a wide blurred dust haze and a narrower brighter dust core along the axis (shows the direction), and the rocks merged into at most three paths (dark/mid/light). Belts are static — no rock spins. The rocks are lit by one SVG lighting filter (`#belt-rock-light`: blurred alpha as a height map, `feDiffuseLighting` from the upper left, multiplied into the rock colors), which gives every rock its own rounded shading without per-rock elements; a noise-texture overlay adds surface grain. The dust and lighting filters use `userSpaceOnUse` regions spanning the whole map: a bbox-relative region would clip the blur of a nearly straight belt into a hard-edged band. Render data is built once per load (`buildBeltView` in `StarMap.rebuildTerrainViews`). The minimap draws each belt axis as a thick rock-colored line.

## Balance values

| Value | Where | Default |
|---|---|---|
| Black hole no-fly radius | `BLACK_HOLE_DEFAULT_NAVIGATION_RADIUS` / `SpecialObject.navigationRadius` | 4 cells |
| Nebula speed multiplier | `NEBULA_CONFIG.speedMultiplier` | 0.7 |
| Nebula sensor multiplier | `NEBULA_CONFIG.sensorMultiplier` | 0.6 |
| Nebula count / size / shape | `NEBULA_CONFIG` | 3/4/5; 12–19% of map height |
| Belt count / length / thickness / bend | `ASTEROID_BELT_CONFIG` | 2/3/4; 20–36% of map width; half width 0.9–1.7; 45% arcs, sag 6–14% |
| Belt safety margin / min passage / system clearance | `ASTEROID_BELT_CONFIG` | 0.5 / 6 / 4 cells |
| Belt visual density | `ASTEROID_BELT_CONFIG.fragmentsPerCell`, `maxFragmentsPerBelt` | 1.6 / 320 |
| Asteroid timing, speed, limit, radius | `ASTEROID_CONFIG` | see tables above |
| Asteroid cargo | `ASTEROID_CONFIG.types` | see tables above |
| AI salvage limits | `EnemyFleetService.SALVAGE_MAX_ETA` / `SALVAGE_TERRITORY_RANGE` | 150 s / 45 cells |

## Known limitations

- Asteroid belts only exist in games started after they were added (older saves load without belts).
- AI distance heuristics (reach, threat radii) remain straight-line, so belts make some AI targets slower to reach than the AI expects; movement itself always respects the belts.

- AI strategic estimates (colonization reach, timeouts) still use straight-line distances; actual travel includes detours and nebula slowdown, so they are slightly optimistic near the black hole or nebulae.
- The AI does not route *around* nebulae to save time; it only suffers the penalty like the player.
- Nebulae are hidden under unexplored fog like other terrain (they are drawn below the fog layer).
- Only one asteroid intercept per player fleet; AI factions run at most one salvage fleet each.

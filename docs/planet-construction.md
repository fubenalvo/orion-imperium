# Planetary Building Construction

Buildings on a planet are not finished when they are placed. A placed building is a **construction site** until its construction time has passed; only then does it work. Player and AI follow the same rules and code paths.

Related: [Economy](./economy.md) (prices, upkeep, refunds), [Research](./research.md) (construction speed technologies), [Planet Surface](./planet-surface.md) (rendering, build list), [AI Pipeline](./ai-pipeline.md) (AI planning with sites), [Planet Capture](./planet-capture.md) (ownership changes), [Territory](./territory.md#construction) (the older, separate station construction rule this one mirrors).

## Sources of truth

| What | Where |
| --- | --- |
| Construction time per building (`constructionSeconds`, work-seconds at speed 1) | `src/app/components/star-map/planet-data.json` |
| Rules: sites, clock, speed, refunds, load cleanup, planning view | `src/app/components/star-map/building-construction.ts` |
| Core speed factors (`CONSTRUCTION_SPEED_CONFIG`) | `building-construction.ts` |
| Technology speed bonuses (`buildingConstructionSpeed`) | `research-tree.json`, aggregated by `ResearchService.getModifiers` |
| Clock: advancing sites every frame, completion notices, cancel | `StarMap.updateStationConstruction`, `StarMap.onCancelConstruction` |
| Surface visual and BUILD-tab construction list | `star-map-planet-screen` component |

## Construction times

Base times at speed 1 (1× game speed, Colony Center, no technology). The values are deliberately different inside each category and grow with price and importance; they are all in `planet-data.json`, so rebalancing is a data change.

| Building | Category | Price (CR / RM) | Seconds |
| --- | --- | --- | ---: |
| Solar Array | power | 600 / 150 | 25 |
| Small Residential Block | housing | 600 / 150 | 30 |
| Central Park | comfort | 800 / 200 | 40 |
| Laser Turret | defense | 800 / 200 | 60 |
| Medium Residential Block | housing | 1800 / 450 | 60 |
| Missile Turret | defense | 1000 / 250 | 75 |
| Mining Complex | industry | 1500 / 375 | 75 |
| Small Research Laboratory | research | 1000 / 250 | 75 |
| School | comfort | 1500 / 375 | 80 |
| Trading Post | trade | 2500 / 600 | 90 |
| Spaceship Factory | industry | 3000 / 750 | 90 |
| Hospital | comfort | 2000 / 500 | 100 |
| Bank | finance | 3000 / 750 | 100 |
| Research Laboratory | research | 3000 / 750 | 110 |
| Large Residential Block | housing | 4500 / 1125 | 120 |
| Fusion Power Plant | power | 2500 / 625 | 120 |
| Entertainment Center | comfort | 3000 / 750 | 130 |
| Spaceport | military | 4000 / 1000 | 150 |
| Planetary Shield | defense | 3500 / 875 | 180 |
| Capital / Colony Center | core | free | 0 (placed complete) |

Design notes: turrets are below the 90–150 s band suggested for military installations because they are the cheapest defense and a colony under threat must be able to react; the Planetary Shield, the most expensive defense, is the slowest building. Nothing exceeds 3 minutes, so ordinary play never waits long at 1× speed.

## Rules

**Placing.** The full price is paid when the site is placed (`payCost`, all-or-nothing, as before). `startBuildingConstruction` adds a normal `PlanetBuilding` with `constructionRemaining` = `constructionTotal` = the type's time and `constructionPaid` = the price. A type with time 0 (colony cores) is placed complete.

**A site occupies its cells** (placement overlap) and **counts toward `maxPerPlanet`** (Bank, Trading Post), so it cannot be placed twice.

**No effect before completion.** Every consumer of building effects reads `operationalBuildings(planet)` instead of `planet.buildings`:

- `EconomyService`: production, energy, workforce (required and provided), housing capacity, comfort, morale, **upkeep** (a site pays no upkeep);
- `ProductionService` factory capacity and power (no ship orders at a factory site; the PRODUCTION tab appears on completion);
- `SpaceportService` (assembly, reserve, Spaceport repair);
- `trade.ts` `hasTradingPost` (exchange and trade-network node);
- `PlanetBattleService` (turrets and shield; a planet whose only turret is a site counts as undefended and is captured on arrival);
- `raw-deposits.ts` (`planetHasMine`, raw outlook).

Things that are about the building *existing* (placement, per-planet limits, AI "do I already have one" checks, save, galaxy validation, intel snapshots) keep reading `planet.buildings`.

**Clock.** `advanceBuildingConstruction` runs in `StarMap.updateStationConstruction` with the **scaled** game delta from `GameTimeService`, the same clock as station construction: pause (delta 0) freezes every site, 2× game speed builds twice as fast. There is no separate timer. Completion only removes the construction fields; every consumer picks the building up on its next read. The player gets a map notice for each completion ("Fusion Power Plant on Nyum is complete."), on any screen. While any site exists the star map redraws about once a second.

**Parallel construction, no queue.** All sites of a planet build at the same time. There is no construction queue and no per-planet limit: the price, paid up front, is the limit. A queue would need a second state ("queued, not paid / paid but idle") and new refund rules for little gain in a real-time game.

**Construction speed.** Each planet builds at

```
speed = core factor × (1 + Σ buildingConstructionSpeed bonuses of the owner)
```

- Core factor (`CONSTRUCTION_SPEED_CONFIG.coreSpeed`): **Capital 1.25**, **Colony Center 1**, no core 1. The colony core acts as the planet's construction hub, in the spirit of Imperium Galactica II's Colony Hub; no new building was added for this.
- Technologies: **Advanced Construction +20%**, **Urban Infrastructure +20%** (existing construction technologies; they add up to +40%).
- Example: a Capital with both technologies builds at 1.25 × 1.4 = 1.75, so a Spaceport takes 150 / 1.75 ≈ 86 s.

The speed applies continuously: researching a technology speeds up sites already in progress. `constructionRemaining` is stored in work-seconds, so a speed change never rewrites saved state.

**Cancelling.** Only an unfinished site can be cancelled (BUILD tab, CANCEL). The refund is the unbuilt share of what was paid, rounded down: `floor(paid × remaining / total)` per resource, the same rule as cancelled ship orders. A site without a valid paid record (malformed save) refunds that share of the list price. A refund can never exceed what was paid.

**Ownership change.** `PlanetOwnershipService.transferPlanet` cancels every site of the planet with that refund to the **previous** owner, before writing the new owner (capture, battle, rebellion, colonization). A conqueror never finishes the loser's projects.

## Save compatibility

The three fields are optional on `PlanetBuilding` and saved with the planet; no save version bump. On load `normalizeBuildingConstruction` (after `ensureColonyCores`) makes every building without a positive finite `constructionRemaining` complete (all construction fields removed), gives valid sites a sane `constructionTotal`, and drops a malformed `constructionPaid`. Saves from before construction time therefore load with every building complete, and a site saved at 40% resumes at 40%.

## AI

The AI uses the same placement (`EnemyEconomyService.tryConstruct` → `startBuildingConstruction`) and pays the same way. Two planning rules keep it from wasting money on sites:

- **Sites count as planned.** "Do I have a factory / Spaceport / role X" checks read all buildings, and the per-planet economy the AI plans with (energy, workforce, housing, comfort) is computed on `withConstructionComplete(planet)`, a copy with every site treated as finished. A power plant under construction is therefore not built twice and a pending consumer is not forgotten. Warship orders wait for an operational factory; warship production may start while the Spaceport is still a site (ships wait in the stock).
- **Committed upkeep.** `getProjectedNet` subtracts the upkeep its sites will cost on completion, like it already did for queued ships. Without it the AI bought against headroom its own sites would take and fell into arrears and rebellion once they finished (seen in `ai-simulation.spec.ts` during development).

**Tempo.** Because every AI building now takes time, the AI develops more slowly than before (intended: the Normal AI was felt to be too fast). Measured in `ai-simulation.spec.ts`: first colony ~355 s instead of under 300 s, ~72 instead of ~90 ships at 30 minutes on a large map, Stellar Engineering ~30 minutes later, a slightly larger credit surplus at minute 90 (up to ~23% of income). The health checks (no arrears, rebellion, deadlock, rejected orders or stuck expansion) still hold; the tempo thresholds and run lengths in the spec were adjusted with comments.

## UI

- **Surface.** A site is drawn as a construction site instead of the finished sprite: a faint cyan hologram of the finished building, the real sprite in unpainted steel rising from the ground with the progress, a steel scaffold that climbs with the build line, an amber plank deck, a tower crane whose trolley and hook travel above the work, two welding points with sparks at the build line, blinking beacon lamps and a ten-segment amber progress plate on the ground. All of it is CSS / inline SVG over the existing sprite (no new assets), anchored exactly like a sprite. The rig is drawn in the sprite's own isometric frame (`siteRig`): building sprites are exactly as wide as their footprint diamond with a 2:1 projection, so scaffold poles stand on the diamond's corners and edge midpoints, ledgers and the deck run parallel to the footprint edges, and the crane stands on the right corner with its jib over the footprint's centre. The sprite's height / width ratio is read when its image loads; the scaffold climbs in proportion to the building's height above its footprint. Animations stop while the game is paused and are disabled under `prefers-reduced-motion`. The building label shows "· 45%" while it is a site.
- **BUILD tab.** An "Under construction" list above the build list (only while sites exist): name, BUILDING / PAUSED, a segmented progress bar, percent, time left at the planet's current speed (game seconds), what was paid, and CANCEL with the refund amount. The title shows the planet's construction speed when it is not 100%.
- **Build info box.** "Build time here: m:ss" for the selected building type at this planet's speed.
- **Energy preview.** The build list's energy preview counts sites with their listed values, so the player sees the planet as it will be once everything already paid for is complete.

## Tests

- `building-construction.spec.ts`: a time for every building (cores 0), category spread, site creation and paid record, occupied cells and per-planet limit, the clock (pause, speed multiplier, frame-rate independence, exact completion, parallel sites, planet speed), speed factors and technology stacking, no effect before completion for economy, upkeep, factory, Spaceport, Trading Post, turrets, shield and mine, the AI planning view, refunds (full, half, never above paid, complete buildings refused), cancellation on ownership change, save round trip, old saves and malformed data.
- `star-map-planet-screen.component.spec.ts`: a site renders as a construction site and turns into the finished sprite on completion, the BUILD-tab entry (progress, time left, status, paid, cancel event), PAUSED state, time left at a planet speed.
- `ai-simulation.spec.ts`: advances sites like StarMap; the multi-minute AI games run with construction time.

## Open points

- Turret construction times sit below the suggested military band (see above).
- No construction queue and no limit on simultaneous sites (see Rules).
- A site cannot be attacked or damaged in a planet battle; it simply does not fight.
- The system view's planet card counts sites among the buildings (and lists them in the count's tooltip) without marking them.

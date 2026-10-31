# Data Models

All gameplay types live in `src/app/components/star-map/star-map.models.ts`. The battle-specific types live in `src/app/services/battle.service.ts` and the economy types in `src/app/services/economy.service.ts` (re-exported from the models file).

## StarMapData

The root save format. Contains everything needed to reconstruct a game session:

- `saveVersion`: format version (currently 7); see `SAVE_VERSION` in `save-validation.ts`
- `galaxy?`: `{ size: 'small' | 'medium' | 'large', seed, requestedSeed, generatorVersion }` – generation metadata of a procedurally generated galaxy (absent for the legacy map). Informational only: loading never regenerates. See [New Game Generation](./new-game-generation.md)
- `factions`: `Faction[]`
- `specialObjects?`: `SpecialObject[]` – map entities without ownership, currently the central black hole (`{ x, y, width, height, type: 'blackhole', component: 'blackhole' }`, x/y = top-left grid cell). Persisted since v3; pre-v3 saves are backfilled from `star-map-data.json`. Optional `navigationRadius` sets a black hole's no-fly radius (default 4 cells), see [Star Map Terrain](./star-map-terrain.md#black-holes-navigation-obstacles)
- `nebulae?`: `Nebula[]` – `{ id, x, y, radius, lobes[], rotation, color }`, irregular gas clouds in grid coordinates (edge distance = `radius × lobe(θ)`). Generated at New Game, persisted, never regenerated on load; pre-v4 saves are backfilled once by `migrateSave`. See [Star Map Terrain](./star-map-terrain.md#nebulae)
- `asteroidBelts?`: `AsteroidBelt[]` – `{ id, points: {x,y}[] (2 straight / 5 for a gentle arc), halfWidth, visualSeed }`, impassable belts (v5). Navigation uses capsules of radius `halfWidth + safetyMargin` along `points`; rock fragments are rebuilt from `visualSeed`, not saved. Pre-v5 saves get `[]`. See [Star Map Terrain](./star-map-terrain.md#asteroid-belts)
- `asteroidEvents?`: `{ nextId, spawnTimer, rngState, active: DriftingAsteroid[] }` – drifting asteroid state (v4). `DriftingAsteroid = { id, type: 'ore' | 'crystal' | 'mixed', startX, startY, dirX, dirY, speed, traveled, length, reward: { rawmaterials?, research? } }`; position is derived as start + dir × traveled. See [Star Map Terrain](./star-map-terrain.md#drifting-asteroids)
- `spaceBases?`: `SpaceBase[]` – `{ id, name, factionId, x, y, shieldPoolCurrent? }`, permanent space bases on integer galaxy cells (v7; older saves get `[]`). Only living bases are stored. Territory is derived from these and planet owners, never saved. See [Territory](./territory.md)
- `map`: `{ width, height, cellSizeVw, cellSizeVh }` – the grid dimensions and per-cell render size. Width/height vary per galaxy (180×108, 240×144, 300×180) and are read from the save by `StarMap.loadGame`
- `starSystems`: `StarSystem[]`
- `fleets`: `Fleet[]`
- `currentView`: `'map' | 'system' | 'planet'` (optional)
- `cameraX`, `cameraY`: world-space (unscaled) vw position of the galaxy viewport's top-left corner; independent of the galaxy map zoom, which is not persisted
- `selectedSystemId`, `selectedFleetId`, `selectedPlanetTileId`: persisted selection
- `selectedFleetAction`: `'move' | null`
  - `targetX`, `targetY`: visible target marker (companion to the selected fleet's actual target)
  - `destroyedFleetId`: id of the fleet destroyed in the last battle, used so destruction survives save/load
  - `exploredGridCells`: `string[]` of `"col-row"` keys representing every galaxy grid cell the player has ever explored; loaded into `Set<string>` at runtime. Absent on old saves → all systems default to explored

## Faction

- `id`: unique string. `'player'` is always the single local human faction; AI factions are `'enemy1'…'enemyN'`; `'independent'` and `'unhabited'` are neutral
- `name`: display name (player-configurable on the New Game screen)
- `color`: hex color used for the UI accent (player-configurable)
- `team`: `0` neutral, `1` the human, `2+` AIs. Same non-neutral team = **permanent alliance** (never fight). New games give each AI its own team; pre-diplomacy saves keep all AIs on team 2. Team 0 fleets never fight; team 0 rebel planets can be captured
- `relations?`: `Record<otherFactionId, FactionRelation>` — treaty state and diplomatic values toward every other non-neutral, non-allied faction. Symmetric fields (same on both sides): `state` (`war` | `peace`), `lockRemaining` (war minimum / truce), `truce`, `warSeconds`, `declaredBy`, `surpriseRecorded`; per-side fields (the holder's view): `opinion` (−100…+100), `warExhaustion` (0…100), `shipsLostValue`, `planetsLost`. Treaty state is changed only by `diplomacy.ts` `startWar` / `startPeace` (both sides at once); `normalizeRelations` fills defaults and repairs it on new games and every load. Whether two factions fight is decided here, not by `team`. Two optional per-side fields belong to the territory system: `borderIncidents` (decaying memory of the other's border violations) and `passageRights` (holder grants the other free passage; prepared, peace only). See [Diplomacy](./diplomacy.md), [Territory](./territory.md#border-violations)
- `reputation?`: −100…+100 (missing = 0), how trustworthy every other empire finds the faction; feeds every AI's effective opinion. See [Diplomacy](./diplomacy.md#reputation)
- `ai?: boolean`: `true` when the AI pipeline should tick this faction. Replaces the previous hardcoded `enemy1`/`enemy2` ID sets — any faction with `ai: true` is managed by the AI layers (V3 target selection → V4.1 strategy → V4.2 goal → V4.3 capability → V5 action → V5.1/V5.2 execution). `false` for player and neutral factions. Backfilled from `team === 2` by `SaveGameService.migrateSave` for older saves.
- `aiPersonality?`: `'balanced' | 'expansionist' | 'militarist' | 'technologist'` – only for `ai: true`; profiles in `ai-personality.ts`; missing (older saves, legacy map) is `'balanced'`; validated by `save-validation.ts` when present.
- `aiDifficulty?`: `'easy' | 'normal' | 'hard'` – only for `ai: true`. Tuning lives in `ai-difficulty.ts`; missing is treated as `'normal'` (the original AI behavior) and backfilled by `migrateSave`
- `currencies`: `Record<string, number>` containing at least `credits`, `rawmaterials`, `research`

## Ship Stock & Production

See [Ship Production](./ship-production.md) for the full pipeline. The relevant data shapes are:

- `ShipStockEntry`: per-instance ship record held in the global stock. Same shape as `FleetShip` minus `currentHp` / `destroyed` so the existing battle / sensor / movement code can consume it when it is pushed into a fleet.
- `FactionShipStock`: `{ factionId, ships: ShipStockEntry[] }` — empire-scoped reserve, never planet-scoped.
- `Technology` (`research-tree.json`): `{ id, name, description, researchCost, prerequisites, unlocksShips, unlocksBuildings, bonuses? }`. `bonuses` are `{ type, value, shipTypes? }` (`TechnologyBonusType`); `ResearchService.getModifiers` aggregates them into `TechModifiers`, which are derived and never saved. `Faction.researchedTechnologies` is the only persisted research state. See [Research](./research.md).
- `Battle.combatBonuses?`: per faction id, per ship type attack/shield multipliers stamped at battle creation.
- `ProductionOrder`: `{ id, shipTypeId, quantity, progress, startedAtTick, paid? }` — one in-flight order per planet; resource cost (credits + raw materials) is deducted up-front at queue time and recorded in `paid`, which refunds are computed from. `paid` is absent on orders from older saves (they paid credits only).
- `FactionProduction`: `{ factionId, ordersByPlanet: Record<planetId, ProductionOrder[]> }`.
- `StarMapData.shipStock` and `StarMapData.production` are optional fields; `SaveGameService.migrateSave` backfills them as `[]` for older saves.
- The `Spaceport` building is a permission flag for fleet assembly; the building does not store ships. `FleetAssemblyService.createFleet` needs a Spaceport planet as the assembly point, and stock ships reach an existing fleet (`reinforceFleet`, or the fleet manager's reserve) only while that fleet stands in a system with one of its faction's Spaceport planets ([Fleet Organization](./fleet-organization.md#reserve)).

## ShipType extensions

Every ship type now also carries:

- `buildTime?: number` — seconds at one factory (`productionPower = 1`). Defaults to `cost / 10`.
- `productionBuilding?: 'spaceship_factory' | 'orbital_factory'` — discriminator used by `ProductionService` to filter which buildings can produce this ship. Defaults to `'spaceship_factory'`.

## StarSystem

- `id`, `name`: identity
- `x`, `y`: 1-indexed grid column/row on the galaxy map (e.g. `x = 18` is column 18)
- `planets`: informational count
- `color`: star color for rendering
- `planetsTiles`: `PlanetTile[]`
- `gridCol`, `gridRow`: derived integer cell (`Math.floor(x)`, `Math.floor(y)`); recomputed by `refreshGridPositions`
- `explored`: controls whether the system is rendered and selectable. Set `true` once the system comes within any player sensor range on the galaxy map; generated galaxies (and all legacy-map games) start with every system `true`, so star positions are always known — see [New Game Generation](./new-game-generation.md)

## Sensor Range

See `docs/game-systems.md` / Fog of War & Sensor Range for gameplay rules.

### Fleet.sensorRange

- `sensorRange?: number` — sensor range **minimum floor** in galaxy grid cells (default 3). The effective range is computed as `max(fleet.sensorRange, max ShipType.range among non-destroyed ships) + SENSOR_RANGE_GLOBAL_BONUS (2)` via `StarMapSensorService.getFleetSensorRange()`. Stored per-fleet in `star-map-data.json` and persisted in save data.
- Player-owned star systems (those containing ≥1 planet with `factionId === 'player'`) provide a fixed 7-grid sensor radius (5 + the global +2 bonus) on the galaxy map, regardless of fleet presence.
- A Euclidean circle (`dx² + dy² <= range²`) defines the set of cells visible from a given center.

### exploredGridCells

- `exploredGridCells?: string[]` — array of `"col-row"` keys representing every galaxy grid cell the player has ever sensed. Persisted in the `StarMapData` save snapshot. Loaded into a `Set<string>` on the `StarMap` component at runtime. Old saves without this field default to all systems explored (backward compatibility).

## PlanetTile

- `id`, `index`, `name`: identity
- `factionId`: owning faction (use `'unhabited'` for uncolonized worlds)
- `x`, `y`, `xOffset`, `yOffset`: loaded from JSON for backwards compatibility but **not used** for rendering. The system view uses `getPlanetGridPosition()` instead.
 - `type`: `'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert'`. Also determines the planet's base morale/satisfaction drift per second via `PLANET_TYPE_HABITABILITY` (`star-map.models.ts`): `earthlike 0`, `marslike -0.03`, `venuslike -0.05`, `gasgiant 0`, `ice -0.08`, `desert -0.05`.
 - `size`: `'huge' | 'big' | 'medium' | 'small' | 'tiny'`
  - `population`: float (not floored); grown each economy tick by `EconomyService.applyEconomyDelta` per the rule in `docs/invariants.md` (§ Population Growth Invariants), and clamped to the planet's residential `populationCapacity`. Older saves may omit it (treated as `0`).
 - `buildings`: `PlanetBuilding[]`
 - `explored`: `true` once a planet has come within a player fleet's sensor range in system view (range = `getFleetSensorRange(fleet)`, which is the max of the fleet's `sensorRange` floor (default 3) and the highest `ShipType.range` among its non-destroyed ships, plus the global +2 bonus, on the 18×10 system grid)
 - `resourceTiles?`: raw-material deposits (`{ type, x, y }`, one grid cell each); never on terrain-blocked cells.
 - `surface?`: `PlanetSurface` terrain record — `{ version, seed, gridSize, intrusion, blocked }`. `blocked` is a row-major hex bitmask of cells covered by terrain obstacles and is authoritative for construction; the visual terrain is regenerated from `seed`. A record whose `gridSize` does not match the planet is ignored and regenerated on load. See [Planet Surface](./planet-surface.md).
 - `satisfaction?`: number in `[0, 100]`, defaulting to `100` when undefined (backward-compatible with older saves). Represents population satisfaction; drifts each economy tick by `(energyDirection ±1 + moraleDrift) × deltaTime` where `moraleDrift = PLANET_TYPE_HABITABILITY[type] + Σ building.moraleRate`, scaled by game time (pauses when paused, 2× at speed 2). When it reaches `0` the planet's `factionId` is set to `'independent'` (rebellion). Once flipped, satisfaction stays at `0` until the planet is re-conquered (currently out of scope). See `docs/invariants.md` for the rules that depend on this field.

### PlanetBuilding

 - `name`: looked up in `planet-data.json` (case-sensitive)
 - `size`: footprint in grid cells (matches `BuildingType.size`)
 - `x`, `y`: top-left cell on the planet's surface grid
 - The full building definition (production, consumption, energy, workforce requirement, `providesWorkforce` for housing, `moraleRate`, etc.) is resolved by name from `planet-data.json` via `EconomyService.buildingStatsByName` at calculation time, so it is never serialized into a save.

### PlanetSizeNumber

Numeric size used by surface grid math: `'tiny' → 1`, `'small' → 2`, `'medium' → 3`, `'big' → 4`, `'huge' → 4` (`PLANET_SIZE_MAP`). Surface grid side length is `numericSize * 4 + 6` (10/14/18/22, `getPlanetGridSize` in `planet-surface/planet-surface.ts`); saves before version 6 used `numericSize * 2 + 3` and are migrated (see [Planet Surface](./planet-surface.md#save-compatibility-save-version-6)).

## Fleet

- `id`, `name`, `factionId`: identity and ownership
- `x`, `y`: 1-indexed grid column/row on the galaxy map (floats for smooth movement)
- `targetX`, `targetY`: map movement target in grid cells (`null` when idle). Always the final destination: the movement service routes around black holes internally (the route is a runtime cache, not saved)
- `interceptAsteroidId?`: player intercept order on a drifting asteroid; while set, `DriftingAsteroidService` re-aims `targetX/targetY`. Cleared by manual moves and when the asteroid is gone. Never used by AI fleets
- `attackFleetId?`: player attack order (pursuit of a hostile fleet, see `fleet-attack-orders.ts`); re-aims `targetX/targetY` at the quarry while it stays visible. Optional and persisted with the fleet (no save version bump: missing = no order). Cleared by manual moves, intercept orders, an unreachable route, or when the quarry is lost. Never used by AI fleets
- `speed`: in vw/s; converted to cells/s via `speed / 10 / GALAXY_MOVEMENT_CELL_SIZE_VW` (fixed 2) for map movement — the rendered `cellSizeVw` does not affect movement
- `system`: `SystemLocation | null` — present while the fleet is inside a star system
- `gridCol`, `gridRow`: derived integer cell on whichever view the fleet is currently in
  - `ships`: `FleetShip[]`
  - `destroyed`: `true` after a lost battle, a disband, an AI merge, or when fleet organization moved all its living ships into other fleets ([Fleet Organization](./fleet-organization.md)); the fleet is filtered from `visibleFleets` and excluded from collision, movement, and rendering. Its record stays in `fleets` so stored ids keep resolving
   - `sensorRange`: `number` (optional, default 3) — minimum floor for sensor range in galaxy grid cells; the effective range is `max(fleet.sensorRange, max ShipType.range among non-destroyed ships) + 2`, computed by `StarMapSensorService.getFleetSensorRange()`

### SystemLocation

- `id`: id of the star system the fleet is inside (`null` if not in a system)
- `x`, `y`: position in vw units on the 18×10 system grid
- `targetX`, `targetY`: target position in vw (`null` when idle)

### FleetShip

- `id`, `name`, `type`: identity and ship-type reference
- `currentHp`: per-ship HP during battle; reset by `BattleService.startBattle()`
- `destroyed`: `true` if destroyed during the current or last battle

## ShipType

Read from `ship-data.json`:

- `id`: type key (e.g. `'frigate'`, `'cruiser'`, `'colonizer'`)
- `name`, `role`: display info
- `hitPoints`, `shield`, `shieldRegen`: defense stats.
  `hitPoints` is reduced by damage. `shield` absorbs damage before hull HP.
  `shieldRegen` regenerates shield per ship at the start of each side's turn via `BattleTurnService.endTurn()`.
- `attack`, `attackType`, `weakness`: offense stats. `attack` is the base
  damage. `attackType` and `weakness` drive the weapon effectiveness table in
  `battle-grid.ts` via `weaponMultiplier()` in `battle-combat.service.ts`.
- `defense`: flat damage reduction per ship
- `speed`, `range`, `cost`: `range` is used as each ship's sensor contribution (fleets take the max ship range as a floor above `Fleet.sensorRange`); `cost` is not currently used in gameplay logic
- `rawMaterialCost`: raw materials charged per ship at queue time (with `cost` credits)
- `maintenanceCost`: upkeep points per second; `EconomyService` charges `× UPKEEP_CREDITS_PER_POINT` (0.3) credits, half in the ship stock

## BuildingType / BuildingStats

Read from `planet-data.json`:

- `id`, `name`: identity
- `role`: e.g. `'industrial'`, `'defense'`
- `price`: build cost in credits; `rawMaterialCost`: build cost in raw materials (see [Economy](./economy.md) for the price table)
- `size`: footprint in surface-grid cells
- `maintenanceCost`: upkeep points per second (`× 0.3` credits/s)
- `production`, `consumption`: `ResourceRates` – resources produced or consumed per second
- `energyProduction`, `energyConsumption`: per-second energy flow
- `population`, `workforce`, `providesWorkforce`, `moraleRate`: optional demographic / morale fields. `workforce` is the workforce *required* by the building per second of operation; `providesWorkforce` (housing-role buildings only) is the workforce *provided* by the building; `moraleRate` is the building's per-second contribution to the planet's morale/satisfaction drift (social/entertainment buildings are positive, heavy industry mildly negative). All three are now consumed by `EconomyService`.
- `defense`: optional `{ type, attack, attackType, range, fireRate, weakness, shield, shieldRegen }` block for defense buildings

## Battle

Transport type `Battle` (defined in `src/app/components/battle-screen/battle/battle.types.ts`,
re-exported by `BattleService`). Lives between `StarMap` and `BattleScreenComponent` and is
**never mutated** by the minigame — it deep-clones the fleets it needs.

- `fleet1`, `fleet2`: `Fleet`-shaped references (the defender may be a virtual defense fleet
  for planet battles; its `id` is `-planet.id`). Only `id`, `name`, `factionId`, and `ships`
  are read, plus the optional planet-battle fields below.
- `fleet2.shieldPool?` / `fleet2.shieldPoolRegen?`: planet-battle only. Shared shield
  granted by `planetary_shield` buildings; `PlanetBattleService` sets them on the virtual
  defense fleet.
- `faction1Name`, `faction1Color`, `faction2Name`, `faction2Color`: display data
- `attackerId`, `defenderId`: ids of the attacker and defender — sides are resolved by id,
  not by fleet1/fleet2 order (the attacker may be fleet2).
- `type`: `'fleet' | 'planet'` — set to `'planet'` by `setPlanetBattle()` (also used for space base battles: static defenses)
- `spaceBaseId`: only set for space base battles (then `planetId` is absent); copied to the battle state and `BattleOutcome.spaceBaseId` ([Territory](./territory.md#combat))
- `planetId`: only set for planet battles; used by the result handler to update the planet
  owner
- `planetName`, `planetColor`: planet-battle presentation metadata used by the separate
  planet visual; never part of combat state

## Battle State Model

Battle-local simulation state lived in `BattleService.BattleState` during the old
auto-resolving implementation. It now lives in
`src/app/components/battle-screen/battle/battle.types.ts` as `BattleModelState` and is built
by `createBattleState()` (in `battle/battle-state.ts`), **not** by `BattleService`.

- `round`: increments every shield-regen tick (`SHIELD_REGEN_INTERVAL_MS` = 2s) (real-time model)
- `battleType`: `'fleet' | 'planet'`
- `planetId?`, `planetName?`, `planetColor?`: planet-battle metadata
- `defenderShieldPool?`: `{ current, max, regen } | null` — shared planetary shield that
  absorbs damage for immobile turret stacks only and regenerates on every shield-regen tick
- `stacks`: `BattleStack[]` — the tactical units on the grid
- `effects`: `BattleAttackEffect`s (impact / explosion) at hit positions, each with a battle-time `remainingMs`
- `projectiles`: `BattleProjectile`s — laser bolts in flight: tip position, unit direction fixed
  at launch, distance travelled / max travel, intended target id, a snapshot of the firing
  stack (`volley`) used for damage on impact, and the shooter's faction color. See
  [Battle Rules](./battle-rules.md#combat).
- `winner`: the battle side with surviving stacks, or `null`
- `attackerFleetId`, `defenderFleetId`, faction ids, and display names/colors
- `attackerShips`, `defenderShips`: full rosters in input order (used to build the outcome)

### BattleStack

- `stackId`: `${side}:${typeId}:${index}`
- `side`, `typeId`, `typeName`, `col`, `row`
- `x`, `y`: real-time vw position (updated every frame by the game loop)
- `targetX`, `targetY`: vw destination (null when idle); set by `moveStack`, cleared on arrival
- `speed`: movement speed in vw/s (from `ShipType.speed`, 1–5; 0 for immobile)
- `ships`: `BattleShip[]` (≤ `MAX_STACK_SIZE = 5`)
- `tier`: size/combat tier; `size`: cells occupied in the row (1–3, by tier)
- `attackRange`: = the ship type's `range`, in range units of `BATTLE_RANGE_UNIT_VW`
  (0 for unknown/fallback types); `fireRate`: volleys per second (per class; changes battle rhythm, not damage per second, see [Battle Rules](./battle-rules.md#combat))
- `immobile`: true for planet-defense buildings (they cannot move but do fire), which also
  receive the shared shield
- `moving`, `firing`
- Orders/targeting (battle-local, never persisted): `explicitAttackTargetId` (manual attack
  order), `manualMoveOrder`, `moveToAttackTargetId` (chase target), `targetingMode`
  (`'balanced' | 'strongest' | 'weakest' | 'firepower'`), `autoTargetId` (sticky automatic
  target), `attackCooldownUntil` (fire cooldown), `actionCooldownUntil` (AI re-plan cooldown).
  See [Battle Rules](./battle-rules.md#orders-and-targeting).
- `destroyed`: true when every ship in the stack is dead

### BattleShip

`shipId` === overworld `FleetShip.id` (the key used to map the outcome back onto the
fleet roster), `hp` / `maxHp`, `attack`, `defense`, `alive`, plus `shield` / `maxShield` /
`shieldRegen`, `attackType`, and `weakness` used by the battle rules.

## BattleOutcome

Returned by `buildBattleOutcome()` and stored on `BattleService` via `setBattleResult()`:

- `winnerSide` / `winnerFleetId` / `loserFleetId`
- `attacker`, `defender`: `BattleFleetOutcome` (roster in input order with final `hp` /
  `destroyed`, `survivors`, `wipedOut`)
- `rounds`, `battleType`, `planetId?`

## Economy Types

- `ResourceType`: `'credits' | 'rawmaterials' | 'research' | 'energy'`
- `ResourceRates`: `Partial<Record<ResourceType, number>>`
- `PlanetEconomy`: `{ production, consumption, net, energyProduction, energyConsumption, energyBalance, efficiency, satisfaction, incomeMultiplier, workforceAvailable, workforceRequired, workforceEfficiency, habitabilityDrift, buildingMoraleBonus }`. `satisfaction` is the current value (0..100) and `incomeMultiplier = satisfaction / 100` is the factor applied to credit production from this planet. `workforceEfficiency` (0..1) is the fraction of required workforce that is available and scales building production; `habitabilityDrift` is the planet-type base morale drift and `buildingMoraleBonus` is the aggregate building morale contribution.
- `EconomyBreakdown`: aggregated per-faction `{ incomePerSecond, expensePerSecond, netPerSecond, totalPopulation, planets, fleetExpenses, production, consumption, net, efficiency }`
- `PlanetEconomyEntry`: per-planet view inside an `EconomyBreakdown`; also carries `satisfaction`, `incomeMultiplier`, and the workforce/morale fields (`workforceAvailable`, `workforceRequired`, `workforceEfficiency`, `habitabilityDrift`, `buildingMoraleBonus`) for UI rendering.
- `BuildingExpenseEntry`: per-building maintenance breakdown
- `FleetExpenseEntry`: per-fleet/per-ship-type maintenance breakdown
- `BuildingStats`: see above (re-exported alongside the economy types)

## Context Menu

- `ContextMenuItem`: `{ type: 'fleet' | 'system' | 'planet', label, data }` — the data field is the actual `Fleet`/`StarSystem`/`PlanetTile`

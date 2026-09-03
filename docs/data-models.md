# Data Models

All gameplay types live in `src/app/components/star-map/star-map.models.ts`. The battle-specific types live in `src/app/services/battle.service.ts` and the economy types in `src/app/services/economy.service.ts` (re-exported from the models file).

## StarMapData

The root save format. Contains everything needed to reconstruct a game session:

- `factions`: `Faction[]`
- `map`: `{ width, height, cellSizeVw, cellSizeVh }` – the grid dimensions and per-cell render size
- `starSystems`: `StarSystem[]`
- `fleets`: `Fleet[]`
- `currentView`: `'map' | 'system' | 'planet'` (optional)
- `cameraX`, `cameraY`: viewport offset in vw
- `selectedSystemId`, `selectedFleetId`, `selectedPlanetTileId`: persisted selection
- `selectedFleetAction`: `'move' | null`
  - `targetX`, `targetY`: visible target marker (companion to the selected fleet's actual target)
  - `destroyedFleetId`: id of the fleet destroyed in the last battle, used so destruction survives save/load
  - `exploredGridCells`: `string[]` of `"col-row"` keys representing every galaxy grid cell the player has ever explored; loaded into `Set<string>` at runtime. Absent on old saves → all systems default to explored

## Faction

- `id`: unique string (`'player'`, `'enemy1'`, `'enemy2'`, `'unhabited'`)
- `name`: display name
- `color`: hex color used for the UI accent
- `team`: `0` neutral, `1` player, `2+` enemies. Same-team factions never fight; team 0 is never attacked and never attacks
- `currencies`: `Record<string, number>` containing at least `credits`, `rawmaterials`, `research`

## StarSystem

- `id`, `name`: identity
- `x`, `y`: 1-indexed grid column/row on the galaxy map (e.g. `x = 18` is column 18)
- `planets`: informational count
- `color`: star color for rendering
- `planetsTiles`: `PlanetTile[]`
- `gridCol`, `gridRow`: derived integer cell (`Math.floor(x)`, `Math.floor(y)`); recomputed by `refreshGridPositions`
- `explored`: `true` once the system has come within any player sensor range on the galaxy map; controls whether the system is rendered and selectable

## Sensor Range

See `docs/game-systems.md` / Fog of War & Sensor Range for gameplay rules.

### Fleet.sensorRange

- `sensorRange?: number` — sensor range **minimum floor** in galaxy grid cells (default 3). The effective range is computed as `max(fleet.sensorRange, max ShipType.range among non-destroyed ships)` via `StarMapSensorService.getFleetSensorRange()`. Stored per-fleet in `star-map-data.json` and persisted in save data.
- Player-owned star systems (those containing ≥1 planet with `factionId === 'player'`) provide a fixed 5-grid sensor radius on the galaxy map, regardless of fleet presence.
- A Euclidean circle (`dx² + dy² <= range²`) defines the set of cells visible from a given center.

### exploredGridCells

- `exploredGridCells?: string[]` — array of `"col-row"` keys representing every galaxy grid cell the player has ever sensed. Persisted in the `StarMapData` save snapshot. Loaded into a `Set<string>` on the `StarMap` component at runtime. Old saves without this field default to all systems explored (backward compatibility).

## PlanetTile

- `id`, `index`, `name`: identity
- `factionId`: owning faction (use `'unhabited'` for uncolonized worlds)
- `x`, `y`, `xOffset`, `yOffset`: loaded from JSON for backwards compatibility but **not used** for rendering. The system view uses `getPlanetGridPosition()` instead.
- `type`: `'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert'`
- `size`: `'huge' | 'big' | 'medium' | 'small' | 'tiny'`
- `population`: integer
- `buildings`: `PlanetBuilding[]`
   - `explored`: `true` once a planet has come within a player fleet's sensor range in system view (range = `getFleetSensorRange(fleet)`, which is the max of the fleet's `sensorRange` floor (default 3) and the highest `ShipType.range` among its non-destroyed ships, on the 18×10 system grid)

### PlanetBuilding

- `name`: looked up in `planet-data.json` (case-sensitive)
- `size`: footprint in grid cells (matches `BuildingType.size`)
- `x`, `y`: top-left cell on the planet's surface grid

### PlanetSizeNumber

Numeric size used by surface grid math: `'tiny' → 1`, `'small' → 2`, `'medium' → 3`, `'big' → 4`, `'huge' → 4` (`PLANET_SIZE_MAP`). Surface grid side length is `numericSize * 2 + 3` (5/7/9/11).

## Fleet

- `id`, `name`, `factionId`: identity and ownership
- `x`, `y`: 1-indexed grid column/row on the galaxy map (floats for smooth movement)
- `targetX`, `targetY`: map movement target in grid cells (`null` when idle)
- `speed`: in vw/s; converted to cells/s via `speed / cellSizeVw` for map movement
- `system`: `SystemLocation | null` — present while the fleet is inside a star system
- `gridCol`, `gridRow`: derived integer cell on whichever view the fleet is currently in
  - `ships`: `FleetShip[]`
  - `destroyed`: `true` after a lost battle; the fleet is filtered from `visibleFleets` and excluded from collision, movement, and rendering
   - `sensorRange`: `number` (optional, default 3) — minimum floor for sensor range in galaxy grid cells; the effective range is `max(fleet.sensorRange, max ShipType.range among non-destroyed ships)`, computed by `StarMapSensorService.getFleetSensorRange()`

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
- `hitPoints`, `shield`, `shieldRegen`: defense stats (only `hitPoints` is used in battle resolution)
- `attack`, `attackType`, `weakness`: offense stats (only `attack` is used in battle resolution; `weakness` and `attackType` are tracked but not yet applied)
- `defense`: flat damage reduction per ship
- `speed`, `range`, `cost`: `range` is used as each ship's sensor contribution (fleets take the max ship range as a floor above `Fleet.sensorRange`); `cost` is not currently used in gameplay logic
- `maintenanceCost`: per-second credit cost applied by `EconomyService`

## BuildingType / BuildingStats

Read from `planet-data.json`:

- `id`, `name`: identity
- `role`: e.g. `'industrial'`, `'defense'`
- `price`: build cost in credits
- `size`: footprint in surface-grid cells
- `maintenanceCost`: per-second credit cost
- `production`, `consumption`: `ResourceRates` – resources produced or consumed per second
- `energyProduction`, `energyConsumption`: per-second energy flow
- `population`, `workforce`, `moraleRate`: optional demographic fields (not yet applied)
- `defense`: optional `{ type, attack, attackType, range, weakness, shield, shieldRegen }` block for defense buildings

## Battle

Owned by `BattleService` while a battle is in progress. Lives between `StarMap` and `BattleScreenComponent`.

- `fleet1`, `fleet2`: `Fleet` references (the defender may be a virtual defense fleet for planet battles)
- `faction1Name`, `faction1Color`, `faction2Name`, `faction2Color`: display data
- `attackerId`, `defenderId`: ids of the attacker and defender (`fleet1.id` / `fleet2.id`)
- `type`: `'fleet' | 'planet' | undefined` — set to `'planet'` by `setPlanetBattle()`
- `planetId`: only set for planet battles; used by the result handler to update the planet's owner
- `capturedPlanetId`: reserved for future capture flow

## BattleState

- `attackerId`, `defenderId`: ids from the `Battle`
- `currentFleetId`: whose turn it is
- `currentShipIndex`: index into the current fleet's alive ships
- `log`: `BattleLogEntry[]`
- `round`: increments every time the attacker has had a full turn
- `isOver`: `true` once one side has no alive ships
- `winnerId`, `loserId`: set when the battle ends

## BattleLogEntry

- `round`, `attackerFleetName`, `attackerShipName`, `defenderFleetName`, `defenderShipName`, `damage`, `targetDestroyed`

## Economy Types

- `ResourceType`: `'credits' | 'rawmaterials' | 'research' | 'energy'`
- `ResourceRates`: `Partial<Record<ResourceType, number>>`
- `PlanetEconomy`: `{ production, consumption, net, energyProduction, energyConsumption, energyBalance, efficiency }`
- `EconomyBreakdown`: aggregated per-faction `{ incomePerSecond, expensePerSecond, netPerSecond, totalPopulation, planets, fleetExpenses, production, consumption, net, efficiency }`
- `PlanetEconomyEntry`: per-planet view inside an `EconomyBreakdown`
- `BuildingExpenseEntry`: per-building maintenance breakdown
- `FleetExpenseEntry`: per-fleet/per-ship-type maintenance breakdown
- `BuildingStats`: see above (re-exported alongside the economy types)

## Context Menu

- `ContextMenuItem`: `{ type: 'fleet' | 'system' | 'planet', label, data }` — the data field is the actual `Fleet`/`StarSystem`/`PlanetTile`

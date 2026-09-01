# Data Models

## StarMapData

The root save format. Contains all state needed to reconstruct a game session:

- `factions`: Array of Faction objects.
- `map`: Grid dimensions and cell sizes.
- `starSystems`: Array of StarSystem objects with their planets.
- `fleets`: Array of Fleet objects.
- `currentView`: 'map' | 'system'
- `cameraX`, `cameraY`: Viewport offset.
- `selectedSystemId`, `selectedFleetId`, `selectedPlanetTileId`: UI selection state.
- `selectedFleetAction`: 'move' | 'attack' | null
- `targetX`, `targetY`: Current movement target for selected fleet.
- `destroyedFleetId`: ID of fleet that was destroyed in the last battle, used for recovery after navigation.

## Faction

- `id`: Unique identifier ('player', 'enemy1', 'enemy2', 'unhabited').
- `name`: Display name.
- `color`: Hex color for UI.
- `team`: 0 = neutral, 1 = player, 2 = enemies. Same-team fleets do not fight.

## StarSystem

- `id`, `name`: Identity.
- `x`, `y`: 1-indexed grid column/row on the galaxy map (e.g., x=53 means column 53).
- `planets`: Planet count (informational).
- `color`: Star color for rendering.
- `planetsTiles`: Array of PlanetTile objects.
- `gridCol`, `gridRow`: Derived integer grid cell (floor of x/y).

## PlanetTile

- `id`, `index`, `name`: Identity.
- `factionId`: Owner faction.
- `type`: 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert'
- `size`: 'huge' | 'big' | 'medium' | 'small' | 'tiny'
- `population`: Current population.
- `buildings`: Array of `{ name, count }` objects.
- `x`, `y`, `xOffset`, `yOffset`: Position data (currently unused in rendering, planets use hardcoded grid positions).
- `gridCol`, `gridRow`: Not currently set; system view uses hardcoded grid formulas.

## Fleet

- `id`, `name`, `factionId`: Identity and ownership.
- `x`, `y`: 1-indexed grid column/row on the galaxy map (floats for smooth movement).
- `targetX`, `targetY`: Map movement target in grid cell coordinates (null when idle).
- `speed`: Movement speed in vw/s (the movement service converts to cells/s via speed / cellSizeVw).
- `systemId`: Star system the fleet is currently inside (undefined when on map).
- `systemX`, `systemY`: Position within a system view in vw units (separate 20x12 grid, 5vw cells).
- `systemTargetX`, `systemTargetY`: System movement target in vw.
- `gridCol`, `gridRow`: Current integer grid cell on the map (floor of x/y).
- `ships`: Array of FleetShip objects.
- `destroyed`: Flag set after battle loss; fleet is filtered out of active fleets.

## FleetShip

- `id`, `name`, `type`: Ship identity and type reference.

## ShipType

- `id`: Ship type key (e.g., 'frigate', 'cruiser').
- `name`, `role`: Display info.
- `hitPoints`, `shield`, `shieldRegen`: Defense stats (shield regen not used in current battle resolution).
- `attack`, `attackType`, `weakness`: Offense stats (weakness not used in current battle resolution).
- `defense`: Armor value (not used in current battle resolution).
- `speed`, `range`, `cost`: Movement range and economic value (cost not currently used).

## Battle / BattleResult

- `Battle`: References two fleets and faction display info.
- `BattleResult`: Contains computed scores, totals, winner/loser, and draw flag.

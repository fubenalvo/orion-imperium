# Orion Imperium — Játékállapot, Feature lista és Készültségi fok

> **Verzió:** 0.1  
> **Utoljára frissítve:** 2026-09-05  
> **Scope:** Angular 22 standalone, kliens-oldali, localStorage persistence.

---

## 1. Feature készültségi mátrix

| # | Feature | Állapot |
|---|---------|---------|
| 1 | Galaxy map (100×60) | ✅ |
| 2 | System view (18×10) | ✅ |
| 3 | Planet surface | ✅ |
| 4 | Fleet movement | ✅ |
| 5 | Fog of war / sensor | ✅ |
| 6 | Fleet vs fleet battle | ✅ |
| 7 | Planet vs fleet battle | ✅ |
| 8 | Economy | ✅ |
| 9 | Ship production | ✅ |
| 10 | Global ship stock | ✅ |
| 11 | Fleet assembly (spaceport) | ✅ |
| 12 | Save / load (4 slots) | ✅ |
| 13 | Main menu | ✅ |
| 14 | Pause menu | ✅ |
| 15 | Time controls (1x/2x/pause) | ✅ |
| 16 | Camera / navigation | ✅ |
| 17 | Context menu | ✅ |
| 18 | Fleet info panel | ✅ |
| 19 | System info panel | ✅ |
| 20 | Planet info panel | ✅ |
| 21 | Currency HUD | ✅ |
| 22 | Ship stock HUD | ✅ |
| 23 | Header time controls | ✅ |
| 24 | Production panel | ✅ |
| 25 | Spaceport panel | ✅ |
| 26 | Building placement | ✅ |
| 27 | Planet colonization | ✅ |
| 28 | Planet capture | ✅ |
| 29 | Satisfaction / rebellion | ✅ |
| 30 | Planet habitability & morale drift | ✅ |
| 31 | Workforce & building efficiency | ✅ |
| 32 | CRT style / parallax | ✅ |
| 31 | Responsive layout | ✅ |
| 32 | Options / Credits | ❌ stub |
| 33 | Diplomacy | ❌ |
| 34 | Research tree | ❌ |
| 35 | Ship design | ❌ |
| 36 | AI opponents | ⚠️ V3 (strength-based target selection) |
| 37 | Missions | ❌ |
| 38 | Multiplayer | ❌ |
| 39 | Audio | ❌ |
| 40 | Save metadata UI | ⚠️ partial |
| 41 | Planet population growth | ✅ |

---

## 2. Tech stack

- Angular 22 standalone
- TypeScript ~6.0.2
- Angular CLI 22.1.5
- Vitest 4.0.8
- localStorage (`orion_save_slots`)

---

## 3. Architektúra

### Route-ok
- `/` → MainMenu
- `/star-map` → StarMap (galaxy/system/planet)
- `/battle` → BattleScreenComponent

### Könyvtár
```
src/app/
  main-menu/
  components/
    star-map/           # central orchestrator + child components
    battle-screen/
    background-stars/
  services/
    game-time.service.ts
    ship.service.ts
    battle.service.ts
    planet-battle.service.ts
    economy.service.ts
    production.service.ts
    ship-stock.service.ts
    spaceport.service.ts
    fleet-assembly.service.ts
    save-game.service.ts
```

---

## 4. Rendszer dokumentáció

### 4.1 Star Map (galaxy)
- 100×60 grid, 2vw desktop / 3.5vw mobile
- 1-indexed grid coordinates
- Parallax background (200% size, 0.3× camera)
- Camera: arrow keys, drag-to-pan, minimap, d-pad
- Selection mutual exclusion: fleet / system / planet
- Auto-save on state changes

### 4.2 Star System view
- 18×10 grid, 5vw cells
- Planet arc layout: `col = 13 - index`, `row = 6 ± (index % 3)`
- Fleets in vw units, no fog inside systems
- Planet arrivals: colonize / capture / ignore / trigger battle

### 4.3 Planet Surface
- Grid: `numericSize * 2 + 3` (5/7/9/11)
- 3vw cells
- Tabs: Details, Build (player only), Production (if factory), Assembly (if spaceport)

### 4.4 Movement
- Map: target grid cells, speed/cellSizeVw → cells/s
- System: target vw units, speed direct
- Snap at < 0.01 distance

### 4.5 Fog of War
- Player fleet range = max(floor, best ship range), default 3
- Player system range = 5
- Euclidean circles
- Black/grey/visible layers
- `exploredGridCells` monotonic

### 4.6 Battle
- Fleet vs Fleet: same cell, different teams, not already triggered
  - Triggered by `StarMapBattleDetectionService.checkForBattles()` every frame from `StarMap.gameLoopCallback`
  - Uses `StarMapMovementService.calculateGridCell(x, y)` to convert fleet positions to grid cells for collision detection
  - When two hostile fleets occupy the same grid cell and neither is destroyed, a battle is initiated
  - Once triggered, the battle ID is stored in `triggeredBattles` Set to prevent duplicate triggers
  - After battle resolution, fleets may be marked as destroyed via `destroyedFleetId` tracking
- Planet vs Fleet: arrival at defended enemy planet
  - Triggered by `StarMap.checkFleetPlanetArrivals()` when a fleet reaches a planet tile
  - If the planet has a defense fleet (from buildings), a virtual defense fleet is assembled
  - Colonizer fleets can colonize uncolonized or captured planets
- Virtual defense fleet from buildings
  - `PlanetBattleService` generates defense fleets based on defensive buildings (Laser Turret, Missile Turret, Planetary Shield)
  - These virtual fleets participate in battle like normal fleets but do not persist after battle
- Turn-based: attacker → defender, weakest HP target
  - `BattleService` manages turn order and battle state
  - Each turn, the active side selects the weakest HP target from the opposing side
  - Damage formula: `max(1, attack - defense)`
  - No weapon effectiveness, no crit/evasion/randomness
- Battle state persistence
  - Active battles are tracked in `BattleService`
  - `destroyedFleetId` is remembered across navigation to handle fleet cleanup after returning from battle screen
  - Winner survivor roster does not persist back to the star map; only fleet destruction is tracked
- Fleet state after battle
  - Surviving fleets return to their pre-battle positions or remain at the battle location
  - Destroyed fleets have `destroyed = true` and are filtered from movement, collision, and rendering
  - The AI detects destroyed targets via `EnemyAiService` and retargets accordingly

### 4.7 Economy
- Stock: credits (floored), rawmaterials, research
- Flow: energy (efficiency only)
- Energy efficiency = 1.0 if energy ok, else production/consumption
- Workforce: `availableWorkforce` = Σ `providesWorkforce` (housing/residential buildings); `requiredWorkforce` = Σ `workforce` (requirement) over all buildings; `workforceEfficiency = min(1, available/required)` (1 when there are no consumers). Scales building `production` rates only — consumption and the `pop * 0.1` credit contribution are intentionally unscaled.
- Satisfaction 0–100, drift per economy tick = `(energyDirection ±1 + moraleDrift) × deltaTime`
  - `energyDirection`: -1 if energy production < consumption, else +1 (±1/s).
  - `moraleDrift = PLANET_TYPE_HABITABILITY[planet.type] + Σ building.moraleRate` (satisfaction points per second of game time). Base per planet type: `earthlike 0`, `gasgiant 0`, `marslike -0.03`, `venuslike -0.05`, `desert -0.05`, `ice -0.08`. Social/entertainment buildings (Park +0.03, Entertainment Center +0.08, …) offset harsh worlds; heavy industry contributes a small negative (-0.01–-0.02).
  - The existing energy-based ±1/s drift is preserved; the habitability/morale drift is additive on top of it.
  - Clamped to [0, 100]. 0 → rebellion → independent faction.
- Population growth: applied each economy tick from the **same 1s accumulator** that drives morale, so it pauses when paused and runs 2× at speed 2x (`star-map.ts` feeds the scaled delta into `applyEconomyDelta`).
  - Per-tick growth = `0.005/s × (satisfaction/100, clamped 0..1) × max(0, 1 + PLANET_TYPE_HABITABILITY[type]) × (capacity − population) × deltaTime`.
  - `capacity` = Σ `population` of residential/housing buildings (Small 100 / Medium 300 / Large 700, from `planet-data.json`). Growth is a float and **clamped to capacity**; a planet at capacity grows by 0.
  - Independent planets (satisfaction locked at 0) never grow; the `pop * 0.1` credit contribution uses the grown population on the next tick.
  - Pause / 2× speed: inherited from `GameTimeService.getScaledDeltaTime` — the 1-second economy accumulator is fed the scaled delta, so morale is frozen while paused and runs 2× as fast at speed 2x (no per-system pause/speed checks).

### 4.8 Production
- One order per planet
- Spaceship Factory = 1 slot, 0.5 power/s
- Cost deducted up-front
- Progress = delta / buildTime * power
- Auto-cancel after 30s stall, refund unbuilt

### 4.9 Game Time
- GameTimeService: speed (1|2), isPaused, elapsed
- RAF always runs, scaled delta = 0 when paused
- Economy ticks every 1s game time
- Production tick every frame
- Keyboard: Space, 1, 2, arrows, Escape

### 4.10 Save / Load
- 4 slots, localStorage key `orion_save_slots`
- Full StarMapData snapshot
- Migration: shipStock/production backfill, vw→grid, destroyedFleetId

### 4.11 Enemy Fleet AI (V3)
- `EnemyAiService` runs every frame inside the existing `StarMap.gameLoopCallback`
- Uses the same scaled `gameDeltaTime` as other systems (pause-safe, 1x/2x-aware)
- Only enemy factions (`enemy1`, `enemy2`) are controlled; player, independent, and unhabited fleets are never modified
- Runtime state tracks `enemyFleetId → targetPlayerFleetId` in a `Map<number, number>`
  - This is purely in-memory state; no persistent properties are added to the `Fleet` model
  - The map is cleared via `reset()` for test isolation
- Fleet strength calculation:
  - `shipStrength = attack + defense + hitPoints / 10 + shield / 10`
  - `fleetStrength = sum(shipStrength for all ships in fleet)`
  - Uses existing `ShipService.getShipType(typeId)` to resolve ship stats from `ship-data.json`
  - No duplicate ship-stat definitions; reuses the existing `ShipType` interface
- Strength categories (based on `ratio = playerFleetStrength / enemyStrength`):
  - `weak`: ratio <= 0.75
  - `comparable`: 0.75 < ratio <= 1.5
  - `strong`: ratio > 1.5
- Target selection algorithm:
  1. Filter fleets to enemy factions and skip destroyed ones
  2. For each enemy fleet without a valid target, find all valid player fleets (not destroyed, has ships)
  3. Calculate `enemyStrength` and `playerFleetStrength` for each candidate
  4. Calculate `ratio = playerFleetStrength / enemyStrength` (if `enemyStrength === 0`, all candidates are treated as `comparable`)
  5. Categorize each candidate as weak / comparable / strong
  6. Sort candidates by: category priority (weak > comparable > strong), then Euclidean distance
  7. Select the first (best) candidate
  8. Set `enemy.targetX = player.x`, `enemy.targetY = player.y`
  9. Store the mapping in `currentTargets`
- Target validity rules:
  - A target is **valid** if the player fleet exists, `destroyed === false`, and `ships.length > 0`
  - A target becomes **invalid** if the player fleet is destroyed, has no ships, or no longer exists in the fleet array
  - The AI does NOT switch targets just because another player fleet becomes closer or weaker; it commits to the current target until invalidity
- Retargeting behavior:
  - When a target becomes invalid, the AI clears the old mapping and immediately selects the nearest remaining player fleet using the new strength + distance algorithm
  - If no valid player fleets remain, the enemy fleet's target is cleared (`targetX = null`, `targetY = null`)
  - Logging: `[Enemy AI] <name> -> <target> (<category> target, ratio=<value>)` on new assignment or retargeting
- Integration with existing systems:
  - **Movement**: The AI only sets `targetX/targetY`; the existing `StarMapMovementService` handles actual fleet movement each frame
  - **Battle**: The AI does not trigger battles. When an enemy fleet reaches a player fleet in the same cell, the existing `StarMapBattleDetectionService` detects the collision and initiates battle via `BattleService`
  - **Pause**: When `gameDeltaTime <= 0` (paused), the AI returns `false` immediately and makes no progress
  - **Speed**: At 1x and 2x, the AI runs at the same rate as other simulation systems
- Test coverage:
  - 21 Vitest tests covering: target selection by strength priority, distance tie-breaking within categories, strong-target fallback, target commitment, retargeting on destroy/no-ships, pause safety, independent multi-fleet targeting, moving target follow, no modification of player/neutral fleets

### 4.12 Enemy Strategy Layer (V4.1)

- `EnemyStrategyService` runs above `EnemyAiService` V3 and determines the current high-level strategic intention for each enemy faction.
- Strategy type: `'expand' | 'attack' | 'defend' | 'develop'`.
- Evaluation timing: every 2 seconds of game time using an internal accumulator, so it respects pause state and game speed.
- Decision rules (in priority order):
  1. **DEFEND**: any enemy-owned star system has a player fleet within 5 galaxy cells.
  2. **ATTACK**: any enemy fleet has a player fleet within 15 galaxy cells and the enemy fleet strength is at least 1.2× the player fleet strength.
  3. **EXPAND**: any enemy fleet is within 20 galaxy cells of an unhabited planet.
  4. **DEVELOP**: fallback when no other condition is met.
- Fleet strength formula matches V3: `sum(attack + defense + hitPoints/10 + shield/10)` per ship, resolved via `ShipService.getShipType()`.
- The layer does not execute strategy yet; it only stores and logs the current intention.
- Integration: `StarMap.gameLoopCallback` calls `EnemyStrategyService.tick()` each frame; change detection runs only when the strategy actually changes.
- Reset: strategy state is cleared on game load / new game via `EnemyStrategyService.reset()`.
- Test coverage: 14 Vitest tests covering defend/attack/expand/develop selection, priority ordering, determinism, no state mutation, independent multi-faction behavior, accumulator timing, and reset behavior.

### 4.13 Enemy Goal Layer (V4.2)

- `EnemyGoalService` runs below `EnemyStrategyService` (V4.1) and above `EnemyAiService` V3.
- Given a faction's current strategy, selects a concrete strategic goal with a specific target.
- Goal types: `colonize` | `attack` | `defend` | `develop`.
- Evaluation timing: every 2 seconds of game time using an internal accumulator, matching the V4.1 cadence.
- Goal commitment:
  - A goal is kept while it remains valid and the strategy does not change.
  - A goal is replaced when it becomes invalid or when the strategy changes.
- Goal selection rules (by strategy):
  - **EXPAND → COLONIZE**: scores all unhabited planets by proximity to enemy territory and habitability/size weight. Skips planets already targeted by another enemy faction. Deterministic tie-breaking by score, distance, planet id, system id.
  - **ATTACK → ATTACK**: selects the player fleet with the most favorable strength ratio (weak > comparable > strong), then closest distance, then lowest fleet id. Uses the same fleet strength formula as V3.
  - **DEFEND → DEFEND**: selects the enemy-owned planet closest to any player fleet (within threat distance). Includes the threatening fleet id in the goal.
  - **DEVELOP → DEVELOP**: produces a `develop` goal with no target.
- Validity predicates:
  - `colonize`: target planet still exists and is still unhabited.
  - `attack`: target fleet still exists, is not destroyed, has ships, and is still a player fleet.
  - `defend`: target planet/system still exists, planet is still owned by the faction, and a player fleet is still within threat distance.
  - `develop`: always valid.
- Cross-faction deduplication: colonize goals check if another enemy faction already targets the same planet and skip it.
- The layer does NOT execute goals. It only stores and logs the current goal.
- Integration: `StarMap.gameLoopCallback` calls `EnemyGoalService.tick()` for each enemy faction each frame; change detection runs when any faction's goal changes.
- Reset: goal state is cleared on game load / new game via `EnemyGoalService.reset()`.
- Test coverage: tests covering all four goal types, goal commitment, invalidation, strategy change replacement, multi-faction independence, determinism, no state mutation, accumulator timing, and reset behavior.

### 4.14 Enemy Capability Layer (V4.3)

- `EnemyCapabilityService` runs below `EnemyGoalService` V4.2 and above the future `EnemyActionService`.
- Given a faction's current goal, evaluates whether the faction currently has the capabilities required to pursue that goal.
- Result type: `CapabilityResult` with `canExecute: boolean`, `goalType`, `factionId`, and `requirements: CapabilityRequirement[]`.
- Each `CapabilityRequirement` has `type`, `satisfied`, and `reason` so the future Action layer can identify what is missing and how to obtain it.
- The layer does NOT execute actions. It only inspects the current game state and reports what is available and what is missing.
- Evaluation timing: every 2 seconds of game time using an internal accumulator, matching the V4.1/V4.2 cadence.
- Capability checks by goal type:
  - **COLONIZE**:
    - `colonizer_technology`: faction has `basic_engineering` researched.
    - `colonizer_unlocked`: `colonizer` ship type is unlocked via research.
    - `colonizer_available`: at least one colonizer exists in the faction's ship stock or in a non-destroyed enemy fleet.
    - `usable_fleet`: at least one non-destroyed enemy fleet with ships exists.
    - `target_valid`: goal target system/planet still exists and planet is still `unhabited`.
  - **ATTACK**:
    - `available_fleet`: at least one non-destroyed enemy fleet with ships exists.
    - `target_valid`: goal target fleet still exists, is not destroyed, has ships, and is still a player fleet.
    - `fleet_can_engage`: at least one enemy fleet has positive fleet strength (`attack + defense + hitPoints/10 + shield/10`).
  - **DEFEND**:
    - `available_fleet`: at least one non-destroyed enemy fleet with ships exists.
    - `target_valid`: goal target system/planet still exists and planet is still owned by the faction.
    - `threat_present`: at least one player fleet is within `THREAT_DISTANCE` (5 cells) of the target system.
  - **DEVELOP**:
    - `always_executable`: always satisfied (no special capability required).
- The layer does NOT duplicate V4.2 goal validity predicates; it only adds capability-specific checks.
- The layer does NOT duplicate V4.1 strategy selection or V3 fleet movement/battle logic.
- Fleet strength formula matches V3: `sum(attack + defense + hitPoints/10 + shield/10)` per ship, resolved via `ShipService.getShipType()`.
- No persistent AI state stores capability flags; all checks are derived from the live game snapshot.
- Integration: `StarMap.gameLoopCallback` calls `EnemyCapabilityService.tick()` for each enemy faction each frame; results are stored per faction and can be queried via `getCapability(factionId)`.
- Reset: capability state is cleared on game load / new game via `EnemyCapabilityService.reset()`.
- Test coverage: 16 Vitest tests covering colonization prerequisites, attack/defend fleet and target checks, develop executability, determinism, no state mutation, multi-faction independence, accumulator timing, reset behavior, and edge cases (undefined goal, missing researchedTechnologies, destroyed-ship fleets).

---

## 5. Data Models

### StarMapData
- factions, map, starSystems, fleets
- currentView, camera, selection
- exploredGridCells, shipStock, production

### Faction
- id, name, color, team
- currencies: credits, rawmaterials, research

### StarSystem
- id, name, x/y (1-indexed grid)
- planetsTiles, explored, gridCol/Row

### PlanetTile
 - id, index, name, factionId
 - type, size, population (float; grown each economy tick, clamped to residential capacity)
 - buildings[], explored, satisfaction
 - satisfaction drift (per tick): `(energyDirection ±1 + moraleDrift) × deltaTime`, where `moraleDrift = PLANET_TYPE_HABITABILITY[type] + Σ building.moraleRate`
 - population growth (per tick): `0.005 × (satisfaction/100) × (1 + PLANET_TYPE_HABITABILITY[type]) × (capacity − population) × deltaTime`, clamped to capacity; independent planets do not grow
 - workforce (derived from buildings, not persisted): available / required + efficiency

### Fleet
- id, name, factionId, x/y
- targetX/Y, speed, system
- ships[], destroyed, sensorRange

### ShipType (11 types)
- Scout, Fighter, Corvette, Frigate, Destroyer, Cruiser
- Carrier, Battleship, Battlecruiser, Dreadnought, Colonizer

### BuildingType (15 types)
- Defense: Laser Turret, Missile Turret, Planetary Shield
- Housing: Small/Medium/Large Residential (provide workforce: 20/50/100, requirement 0)
- Industry: Small/Medium/Large Factory
- Energy: Solar Panel, Fusion Power Plant
- Research: Small/Large Research Lab
- Infrastructure: Spaceport, Spaceship Factory, Orbital Factory, Mining Complex
- Social: Park, Hospital, School, Entertainment Center

---

## 6. UI Komponensek

### Screens
- MainMenu: new/load game
- StarMap: galaxy/system/planet views
- BattleScreen: turn-based battle UI

### HUD
- Header: title, time controls, currencies, stock
- Pause: overlay, save/load, exit
- Currencies: expandable breakdown
- ShipStock: expandable list

### Info Panels
- Fleet: composition, attack/defense, actions
- System: info, enter system
- Planet: info, open planet

### Planet Sidebar
- PlanetScreen: grid, build mode
- ProductionPanel: queue, ETA, cancel
- SpaceportPanel: create/reinforce/disband

### Navigation
- NavigationComponent: d-pad + minimap
- Minimap: 240×144, drag, click-to-move
- ContextMenu: overlap disambiguation

---

## 7. Kezdeti adatok

### Factions
- Player (team 1, blue, 1000 resources)
- Enemy1 (team 2, red)
- Enemy2 (team 2, teal)
- Independent (team 0, yellow)
- Unhabited (team 0, grey)

### Galaxy
- 10 star systems, 1-6 planets each
- Player starts at SOL (4 planets, partial development)
- Starting fleets: ORION (2 frigates), PEGASUS (3 cruisers)
- Enemy fleets: RAIDER (4 destroyers), HUNTER (6 scouts + 2 destroyers)

### Resources
- Starting: 1000 credits, rawmaterials, research
- Energy is flow resource (not stored)

---

## 8. Ismert korlátok

- No weapon effectiveness (attackType/weakness not applied)
- No shield regen in battle
- No shield pool application
- No crit/evasion/randomness
- Weakest-HP targeting only
- Winner survivor roster doesn't persist
  - Population is a single integer/float counter per planet (no citizen entities): workforce is derived from residential `providesWorkforce`, morale drift is type + building based, and natural population growth now grows it over time toward the residential `population` capacity. No migration, hospitals, food, or citizen simulation.
- No re-conquest for independent planets
- Debug console.log statements present
- Enemy AI V3 tracks targets by fleet ID and validates them; strength-based selection prefers weak/comparable targets, distance breaks ties; no combat trigger, fleet strength evaluation beyond simple sum, pathfinding, strategic goals, retreat, or personality

---

## 9. Tesztek

- Vitest 4.0.8 + jsdom
- Existing: app.spec.ts, main-menu.spec.ts, star-map.spec.ts, game-time.service.spec.ts, star-map-sensor.service.spec.ts, enemy-ai.service.spec.ts
  - New: economy.service.spec.ts — habitability drift (earthlike 0, desert/ice negative, entertainment offsets), workforce/efficiency (1.0 when sufficient, 0.5 at half, production halved under shortage), pause freezes morale (deltaTime 0), 2× speed linearity, plus population growth: capacity from residential `population` (100/300/700), growth formula `0.005 × satisfaction × (1+habitability) × remaining × deltaTime`, clamp to capacity, independent planets yield 0 growth, and live mutation + pause/2× behaviour through `applyEconomyDelta`
- Coverage: enemy AI strength-based target selection, category priority (weak/comparable/strong), distance tie-breaking, target validation, retargeting on destroy/no-ships, pause safety, independent multi-fleet targeting, moving target follow, no modification of player/neutral fleets, plus the habitability/workforce cases above

---

## 10. Összefoglalás

A játék jelenlegi állapota:
- Core gameplay loop működik (map → system → planet → battle)
- Gazdasági és gyártási rendszer teljesen működik; a bolygó-termelés a workforce efficiency (lakosság által biztosított vs. épület igény) szorzójával skálázódik; a nehezen lakható bolygók negatív morale driftet generálnak, amit Park és Entertainment Center ellensúlyoz
- Fleet assembly és ship stock működik
- Save/load és fog-of-war működik
- Enemy AI V3: ellenséges flották erősségi szempontból választanak célpontot (weak > comparable > strong), távolság csökkenti a kötést ugyanazon kategórián belül
- Harcrendszer autonóm: az AI nem indítja a csatákat, a `StarMapBattleDetectionService` detektálja az ütközéseket és a `BattleService` kezeli a csatát
- Hiányzik: stratégiai AI, diplomacia, research tree, hang, multiplayer

Ez a dokumentum a játék teljes jelenlegi állapotát írja le feature-felel és készültségi fokok szerint.

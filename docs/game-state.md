# Orion Imperium — Játékállapot, Feature lista és Készültségi fok

> **Verzió:** 0.3
> **Utoljára frissítve:** 2026-09-06
> **Scope:** Angular 22 standalone, kliens-oldali, localStorage persistence.

---

## 1. Feature készültségi mátrix

| # | Feature | Állapot |
|---|---------|---------|
| 1 | Galaxy map (300×180) | ✅ |
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
| 12 | Save / load (5 slots: 1 autosave + 4 manual) | ✅ |
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
| 33 | Resource deposits | ✅ |
| 34 | Research tree | ✅ |
| 35 | Sensor range bonuses (research) | ✅ |
| 36 | Responsive layout | ✅ |
| 37 | Options / Credits | ❌ stub |
| 38 | Diplomacy | ❌ |
| 39 | Ship design | ❌ |
| 40 | AI opponents | ✅ V5.2 pipeline (strategy → goal → capability → action → execution; execute produce_colonizer + assemble_fleet) |
| 41 | Missions | ❌ |
| 42 | Multiplayer | ❌ |
| 43 | Audio | ❌ |
| 44 | Save metadata UI | ⚠️ partial |
| 45 | Planet population growth | ✅ |

---

## 2. Tech stack

- Angular 22 standalone
- TypeScript ~6.0.2
- Angular CLI 22.1.5
- Vitest ^4.0.8
- jsdom ^28.0.0
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
    star-map/
      star-map-game-loop.service.ts       # RAF loop management
      star-map-movement.service.ts        # Fleet movement + coordinate math
      star-map-sensor.service.ts          # Fog of war + sensor ranges + preview rings
      star-map-battle-detection.service.ts # Fleet-vs-fleet collision detection
      star-map-resources.util.ts          # Resource tile generation + selection
      enemy-ai.service.ts                 # V3: strength-based target selection
      enemy-strategy.service.ts           # V4.1: high-level strategy (expand/attack/defend/develop)
      enemy-goal.service.ts               # V4.2: concrete strategic goals
      enemy-capability.service.ts         # V4.3: capability assessment
      enemy-action.service.ts             # V5: next action evaluation (integrated into the game loop)
      enemy-action-executor.service.ts    # V5.1/V5.2: action execution (produce_colonizer, assemble_fleet)
      star-map.models.ts                  # All interfaces/types
      star-map.ts                         # Central orchestrator
      star-map.html                       # Main template
      star-map-planet-screen/             # Planet surface view
      star-map-research-tree/             # Research tree UI component
      star-map-context-menu/              # Context menu for overlap disambiguation
      star-map-fleet-info/                # Fleet info panel
      star-map-system-info/               # System info panel
      star-map-planet-info/               # Planet info panel
      star-map-fleet-buttons/             # Fleet action buttons
      star-map-spaceport-panel/           # Spaceport/fleet assembly panel
      star-map-production-panel/          # Production queue panel
      star-map-ship-stock/                # Ship stock HUD
      star-map-header/                    # Shared header (time controls + currencies + stock)
      faction-currencies/                 # Currency breakdown overlay
      star-map-navigation/                # D-pad + minimap
      star-map-pause/                     # Pause menu overlay
    battle-screen/                        # Turn-based battle UI
    background-stars/                     # Background starfield
  services/
    game-time.service.ts                  # Speed/pause + scaled delta
    ship.service.ts                       # Ship type definitions + normalization
    battle.service.ts                     # Turn-based battle simulation
    planet-battle.service.ts              # Virtual defense fleets from buildings
    economy.service.ts                    # Resource production/consumption + morale + population
    production.service.ts                 # Ship production queue + tick
    ship-stock.service.ts                 # Global ship stock management
    spaceport.service.ts                  # Spaceport detection
    fleet-assembly.service.ts             # Create/reinforce/disband fleets from stock
    save-game.service.ts                  # localStorage persistence (5 slots)
    research.service.ts                   # Research tree logic
```

---

## 4. Rendszer dokumentáció

### 4.1 Star Map (galaxy)
- 300×180 grid, 2vw desktop / 3.5vw mobile (breakpoint: 1300px)
- 1-indexed grid coordinates
- Parallax background (200% size, 0.3× camera)
- Camera: arrow keys, drag-to-pan, minimap, d-pad
- Selection mutual exclusion: fleet / system / planet
- Auto-save on state changes
- Default view: planet screen of SOL/Earth (planet id=1) on new game
- Fleets are placed on galaxy grid cells matching their system position on load

### 4.2 Star System view
- 18×10 grid, 5vw cells
- Planet arc layout: `col = 13 - index`, `row = 6 ± (index % 3)`
- Fleets in vw units, no fog inside systems
- Planet arrivals: colonize / capture / ignore / trigger battle

### 4.3 Planet Surface
- Grid: `numericSize * 2 + 3` (5/7/9/11)
- 3vw cells
- Tabs: Details, Build (player only), Production (if factory), Assembly (if spaceport)
- Deterministic resource deposits on ~20% of planets, visible in planet view
- Mining Complex buildings must be placed adjacent to resource tiles
- Buildings cannot overlap or be placed directly on resource tiles

### 4.4 Movement
- Map: target grid cells, speed/cellSizeVw → cells/s
- System: target vw units, speed direct
- Snap at < 0.01 distance
- New fleets spawn on their host planet's system-grid cell
- Movement speed on galaxy map is fleet.speed / 10 / cellSizeVw

### 4.5 Fog of War
- Player fleet range = max(floor, best ship range), default 3
- Player system range = 5
- Euclidean circles
- Black/grey/visible layers
- `exploredGridCells` monotonic
- Outer-ring preview cells (R+1..R+2) rendered as faint halo, NOT added to explored set
- Fleet visibility: player fleets always visible; enemy fleets visible in sensor range or in current system view
- Sensor range bonus from researched radar technologies (+1 per tier: basic_radar → advanced_radar → long_range_radar)
- Player-owned star systems mark cells within range 5 + sensor bonus as explored
- Research tree affects sensor range via `getSensorRangeBonus()`

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
  - Shield buildings contribute to a `shieldPool` value on the virtual fleet (not yet applied in battle damage)
- Turn-based: attacker → defender, weakest HP target
  - `BattleService` manages turn order and battle state
  - Each turn, the active side selects the weakest non-destroyed ship from the opposing fleet
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
- Planet battle result handling
  - On attacker win, the planet faction is changed to the attacker's faction
  - On defender win, the attacker fleet is marked destroyed
  - Results are written to the AUTOSAVE slot via `BattleScreenComponent.backToStarMap()`

### 4.7 Economy
- Stock: credits (floored), rawmaterials, research
- Flow: energy (efficiency only)
- Energy efficiency = 1.0 if energy ok, else production/consumption
- Workforce: `availableWorkforce` = Σ `providesWorkforce` (housing/residential buildings); `requiredWorkforce` = Σ `workforce` (requirement) over all buildings; `workforceEfficiency = min(1, available/required)` (1 when there are no consumers). Scales building `production` rates only — consumption and the `pop * 0.1` credit contribution are intentionally unscaled.
- Satisfaction 0–100, drift per economy tick = `(energyDirection ±1 + moraleDrift) × deltaTime`
  - `energyDirection`: -1 if energy production < consumption, else +1 (±1/s).
  - `moraleDrift = PLANET_TYPE_HABITABILITY[planet.type] + Σ building.moraleRate` (satisfaction points per second of game time). Base per planet type: `earthlike 0`, `gasgiant 0`, `marslike -0.03`, `venuslike -0.05`, `desert -0.05`, `ice -0.08`. Social/entertainment buildings (Park +0.03, Entertainment Center +0.08, Hospital +0.02, School +0.01) offset harsh worlds; heavy industry contributes a small negative (-0.01–-0.02: Spaceship Factory -0.02, Fusion Plant -0.01, Mining Complex -0.01).
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
- Build time defaults to `cost * 0.1` seconds per factory power unit
- Ships are added to the faction's global stock when production completes
- Production is gated by research (`isShipUnlocked`)

### 4.9 Game Time
- `GameTimeService`: speed (1|2), isPaused, elapsed
- `StarMapGameLoopService`: manages RAF loop outside Angular zone; always runs (never paused), delegates delta scaling to GameTimeService
- RAF always runs, scaled delta = 0 when paused
- Economy ticks every 1s game time
- Production tick every frame
- Keyboard: Space, 1, 2, arrows, Escape
- `state$` BehaviorSubject emits only on discrete state changes (pause/resume/speed), not every frame
- Real delta time clamped to 0.1s max before scaling to prevent tab-suspend spikes

### 4.10 Save / Load
- 5 slots: 1 autosave (slot 0) + 4 manual (slots 1–4), localStorage key `orion_save_slots`
- Full StarMapData snapshot per slot
- Autosave triggers: entering/leaving systems, pausing, exiting to menu, battle trigger, component destroy
  - Migration: shipStock/production backfill, vw→grid (legacy width=200 saves), destroyedFleetId, resourceTiles, researchedTechnologies (defaults to 4 starting techs), ai flag (derived from team: team 2 → ai: true)
  - `researchedTechnologies` migration: if missing, defaults to `['basic_engineering', 'basic_science', 'basic_industry', 'basic_power']`
  - `ai` flag migration: if missing, set to `faction.team === 2` — replaces the old hardcoded `enemy1`/`enemy2` ID set for identifying AI-controlled factions

### 4.11 Research Tree
- Data-driven system: 18 technologies defined in `research-tree.json`
- Player starts with 4 technologies: `basic_engineering`, `basic_science`, `basic_industry`, `basic_power`
- Each technology has: id, name, description, researchCost, prerequisites, unlocksShips, unlocksBuildings, optional bonuses
- Research costs range from 0 to 500 research points
- Prerequisites form a branching tree: basic → advanced → specialized tiers
- Unlocks:
  - Ships: scout/fighter/colonizer (basic_engineering) → corvette/frigate (advanced) → cruiser/carrier (shipyards) → battleship/battlecruiser/dreadnought (weapons) → destroyer (military)
  - Buildings: factories, residential tiers, power plants, social buildings, research labs
- Bonuses: sensor range (+1 per radar tier: basic → advanced → long-range)
- `ResearchService` methods: `canResearch()`, `researchTechnology()`, `isShipUnlocked()`, `isBuildingUnlocked()`, `getStatus()`, `getSensorRangeBonus()`
- Research gates: building construction, ship production, fleet assembly, sensor range
- UI: `StarMapResearchTreeComponent` — opened from header button, emits `researched` event which triggers save + change detection

### 4.12 Resource Deposits
- Deterministic resource tile generation using Mulberry32 PRNG seeded by `planet.id * 4967297`
- Each eligible planet gets 1–2 rawmaterial tiles within its surface grid
- ~20% of all planets are selected for resource deposits via Fisher-Yates shuffle seeded by sum of all planet IDs
- Resource tiles are placed on the planet surface grid and rendered as special cells
- Mining Complex buildings must be placed adjacent to (within 1 cell of) a resource tile
- Buildings cannot be placed directly on resource tiles
- Resource tile data is generated once and persisted in `planet.resourceTiles`

### 4.13 Enemy AI V3
- `EnemyAiService` runs every frame inside the existing `StarMap.gameLoopCallback`
- Uses the same scaled `gameDeltaTime` as other systems (pause-safe, 1x/2x-aware)
  - Only AI-controlled factions (`f.ai === true`, dynamically derived from the `factions` array) are controlled; player, independent, and unhabited fleets are never modified
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

### 4.14 Enemy Strategy Layer (V4.1)

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
- Test coverage: 18 Vitest tests covering defend/attack/expand/develop selection, priority ordering, determinism, no state mutation, independent multi-faction behavior, accumulator timing, and reset behavior.

### 4.15 Enemy Goal Layer (V4.2)

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
- Test coverage: 27 Vitest tests covering all four goal types, goal commitment, invalidation, strategy change replacement, multi-faction independence, determinism, no state mutation, accumulator timing, and reset behavior.

### 4.16 Enemy Capability Layer (V4.3)

- `EnemyCapabilityService` runs below `EnemyGoalService` V4.2 and above the `EnemyActionService` (V5).
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
- Test coverage: 25 Vitest tests covering colonization prerequisites, attack/defend fleet and target checks, develop executability, determinism, no state mutation, multi-faction independence, accumulator timing, reset behavior, and edge cases (undefined goal, missing researchedTechnologies, destroyed-ship fleets).

### 4.17 Enemy Action Layer (V5) — Integrated

- `EnemyActionService` runs below `EnemyCapabilityService` V4.3 and is the fourth strategic AI layer.
- Given a faction's current goal and capability assessment, determines the single next action the faction should take.
- Result type: `ActionResult` with `type`, `factionId`, `goalType`, `goal`, `targetId`, `targetSystemId`, `targetPlanetId`, `reason`.
- Action types: `none` | `produce_colonizer` | `assemble_fleet` | `move_to_target` | `colonize` | `attack` | `defend` | `develop`
- The layer does NOT execute actions. It only inspects the current game state and returns an `ActionResult` describing the recommended next step.
- Evaluation timing: actions are recalculated every 2 seconds of game time using an internal accumulator, matching the V4.1/V4.2/V4.3 cadence.
- Action evaluation logic:
  - If capability is not satisfied: evaluates preparation actions (e.g., `produce_colonizer` when colonizer is missing but production is possible)
  - If capability is satisfied: evaluates execute actions (e.g., `move_to_target` → `colonize` when fleet reaches the planet)
- Action selection by goal type:
  - **colonize**: finds fleet with colonizer, checks if at target planet → `colonize`; if not at target → `move_to_target`; if no colonizer but in stock → `assemble_fleet`; if no colonizer at all → `produce_colonizer` (if conditions met)
  - **attack**: finds best enemy fleet, checks if at target position → `attack`; otherwise → `move_to_target`
  - **defend**: finds best enemy fleet, checks if at threatened system → `defend`; otherwise → `move_to_target`
  - **develop**: always returns `develop` action
- `canProduceColonizer`: checks if faction has basic_engineering researched, colonizer unlocked, sufficient credits, and at least one planet with available spaceship factory capacity.
  - Integration: `StarMap.gameLoopCallback` calls `EnemyActionService.tick()` every frame AFTER the capability layer, once per AI faction (`factions.filter(f => f.ai)`), passing the faction's current goal (`EnemyGoalService.getGoal`) and capability (`EnemyCapabilityService.getCapability`). Pipeline order: V3 AI → V4.1 Strategy → V4.2 Goal → V4.3 Capability → V5 Action → V5.1/V5.2 Execution. The `ActionResult` is stored per faction and is queryable via `getAction(factionId)`; the action layer itself never mutates state (execution is delegated to `EnemyActionExecutor`). Change detection and the `[Enemy AI] <factionId> action: <type>` debug log fire only when the result actually changes.
- Reset: action state is cleared on game load / new game via `EnemyActionService.reset()`, called alongside the V3/V4.1/V4.2/V4.3 resets in `StarMap.loadGame()`.
- Test coverage: 23 Vitest tests covering all action types, preparation vs execution paths, determinism, no state mutation, independent multi-faction behavior, accumulator timing, reset behavior, and edge cases.

### 4.18 Enemy Action Execution Layer (V5.1 → V5.2)

- `EnemyActionExecutor` runs below `EnemyActionService` and is the only AI layer that mutates game state for actions.
- Responsibility split:
  - `EnemyActionService` = decision / planning (inspection only, no mutation).
  - `EnemyActionExecutor` = state mutation / execution, always through existing game service APIs.
- Currently executable actions:
  - `produce_colonizer` (V5.1): queues one colonizer order via `ProductionService.queueOrder` at the faction's deterministic first factory planet.
  - `assemble_fleet` (V5.2): moves one colonizer from the faction ship stock into a fleet via `FleetAssemblyService`. Prefers reinforcing the faction's deterministic lowest-id usable fleet (`reinforceFleet`); when no usable fleet exists, creates a new fleet at the faction's deterministic first owned Spaceport planet (`createFleet`).
- Not yet executable (still generated but ignored by the executor): `move_to_target`, `colonize`, `attack`, `defend`, `develop`, `none`.
- Duplicate-execution protection is stateless: every frame the executor re-checks the game-state fact its mutation establishes (a pending colonizer order; a fleet already carrying a colonizer). It keeps no mutable executor state, so `reset()` stays a no-op.
  - The executor only acts for AI factions (`f.ai === true`), never for player / independent factions, and only mutates the acting faction's stock and fleets. Failed assembly (e.g., no Spaceport, no stock) leaves the state unchanged.
- Execution logging follows the existing convention and fires only on actual execution, e.g. `[Enemy AI] enemy1 executed assemble_fleet: reinforced fleet RAIDER with 1 colonizer`.
- Integration: `StarMap.gameLoopCallback` calls `EnemyActionExecutor.tick()` every frame after the action layer, once per enemy faction, with the faction's current `ActionResult`. The executor is not called on reset (`reset()` is a no-op).
- Test coverage: 32 Vitest tests covering produce_colonizer execution and assemble_fleet execution (reinforcement, new-fleet fallback, duplicate/stale-action guards, wrong-faction and player safety, failed-assembly no-mutation, pause safety, logging).

---

## 5. Data Models

### StarMapData
- factions, map, starSystems, fleets
- currentView, camera, selection
- exploredGridCells, shipStock, production
- destroyedFleetId, targetX, targetY
- defaultView: `{ type: 'map' | 'system' | 'planet', systemId?, planetId?, cameraX?, cameraY? }`
  ### Faction

  - id, name, color, team
  - ai?: boolean — true for AI-controlled factions; replaces hardcoded enemy IDs
- currencies: credits, rawmaterials, research
- researchedTechnologies?: string[]

### StarSystem
- id, name, x/y (1-indexed grid)
- planetsTiles, explored, gridCol/Row

### PlanetTile
- id, index, name, factionId
- type, size, population (float; grown each economy tick, clamped to residential capacity)
- buildings[], explored, satisfaction
- satisfaction drift (per tick): `(energyDirection ±1 + moraleDrift) × deltaTime`, where `moraleDrift = PLANET_TYPE_HABITABILITY[type] + Σ building.moraleRate`
- population growth (per tick): `0.005 × (satisfaction/100) × (1 + PLANET_TYPE_HABITABILITY[type]) × (capacity − population) × deltaTime`, clamped to capacity; independent planets do not grow
- resourceTiles?: ResourceDeposit[]
- workforce (derived from buildings, not persisted): available / required + efficiency

### Fleet
- id, name, factionId, x/y
- targetX/Y, speed, system
- ships[], destroyed, sensorRange
- gridCol?, gridRow?
- shieldPool?: number (used by planet defense virtual fleets)

### FleetShip
- id, name, type
- currentHp?: number
- destroyed?: boolean

### ShipType (11 types)
- Scout, Fighter, Corvette, Frigate, Destroyer, Cruiser
- Carrier, Battleship, Battlecruiser, Dreadnought, Colonizer
- Normalized fields (added by ShipService): buildTime (default: cost * 0.1), productionBuilding (default: spaceship_factory)

### ShipStockEntry
- id, type, name
- producedAtTick?: number
- originPlanetId?: number | null

### FactionShipStock
- factionId: string
- ships: ShipStockEntry[]

### ProductionOrder
- id, shipTypeId, quantity, progress, startedAtTick

### FactionProduction
- factionId: string
- ordersByPlanet: Record<number, ProductionOrder[]>

### BuildingType (17 types)
- Defense: Laser Turret, Missile Turret, Planetary Shield
- Housing: Small/Medium/Large Residential Block (provide workforce: 20/50/100, population capacity: 100/300/700)
- Industry: Spaceship Factory (rawmaterials +10/s, 1 slot, 0.5 power/s), Mining Complex (rawmaterials +5/s, requires ore proximity)
- Power: Solar Array (energy +40), Fusion Power Plant (energy +100)
- Research: Small Research Laboratory (research +2/s), Research Laboratory (research +5/s)
- Social: Central Park (+0.03 morale/s), Hospital (+0.02 morale/s, workforce 40), School (+0.01 morale/s, workforce 30), Entertainment Center (+0.08 morale/s, workforce 60)
- Military: Spaceport (fleet assembly, workforce 60)
- Note: Orbital Factory building type is defined in `ProductionBuildingKind` but not implemented in any building definition

### Technology (18 types in research-tree.json)
- id, name, description, researchCost, prerequisites
- unlocksShips: string[]
- unlocksBuildings: string[]
- bonuses?: { type: 'sensorRange', value: number }[]
- Player starting techs: basic_engineering, basic_science, basic_industry, basic_power

### ResourceDeposit
- type: 'rawmaterial'
- x, y: grid coordinates on planet surface

### AI Strategy Types
- `AiStrategy = 'expand' | 'attack' | 'defend' | 'develop'`
- `GoalType = 'colonize' | 'attack' | 'defend' | 'develop'`
- `StrategicGoal = ColonizeGoal | AttackGoal | DefendGoal | DevelopGoal`
- `ActionType = 'none' | 'produce_colonizer' | 'assemble_fleet' | 'move_to_target' | 'colonize' | 'attack' | 'defend' | 'develop'`
- `ActionResult`: { type, factionId, goalType, goal, targetId?, targetSystemId?, targetPlanetId?, reason }
- `CapabilityRequirement`: { type, satisfied, reason }
- `CapabilityResult`: { canExecute, goalType, factionId, requirements }

---

## 6. UI Komponensek

### Screens
- MainMenu: new/load game
- StarMap: galaxy/system/planet views
- BattleScreen: turn-based battle UI

### HUD
- Header: title, time controls, currencies, stock, research tree button
- Pause: overlay, save/load, exit
- Currencies: expandable breakdown
- ShipStock: expandable list

### Info Panels
- Fleet: composition, attack/defense, actions
- System: info, enter system
- Planet: info, open planet

### Planet Sidebar
- PlanetScreen: grid, build mode, resource tiles display
- ProductionPanel: queue, ETA, cancel
- SpaceportPanel: create/reinforce/disband

### Navigation
- NavigationComponent: d-pad + minimap
- Minimap: 240×144, drag, click-to-move
- ContextMenu: overlap disambiguation

### Research
- StarMapResearchTreeComponent: technology tree with status indicators (researched/available/locked)

---

## 7. Kezdeti adatok

  ### Factions
  - Player (team 1, blue, 1000 credits/rawmaterials/research, 4 researched techs, ai=false)
  - Enemy1 (team 2, red, ai=true)
  - Enemy2 (team 2, teal, ai=true)
  - Independent (team 0, yellow, ai=false)
  - Unhabited (team 0, grey, ai=false)

### Galaxy
- 14 star systems, 1-6 planets each (35 total planets)
- Player starts at SOL (4 planets, partial development, Earth has 2 Large Residential + Research Laboratory + Laser Turret)
- Starting fleets: ORION (2 frigates), PEGASUS (3 cruisers)
- Enemy fleets: RAIDER (4 destroyers), HUNTER (4 scouts + 1 destroyer)
- Game starts directly on planet view (SOL/Earth) via defaultView

### Resources
- Starting: 1000 credits, rawmaterials, research
- Energy is flow resource (not stored)
- Player has 4 starting technologies: basic_engineering, basic_science, basic_industry, basic_power

---

## 8. Ismert korlátok

- No weapon effectiveness (attackType/weakness not applied in damage formula)
- No shield regen in battle (shieldRegen field exists on ships but is not used)
- No shield pool application (Planetary Shield buildings contribute to shieldPool on virtual fleets, but the battle service does not apply it)
- No crit/evasion/randomness
- Weakest-HP targeting only
- Winner survivor roster doesn't persist back to the star map
- Population is a single float counter per planet (no citizen entities)
- No migration, hospitals don't boost population growth, food not simulated
- No re-conquest for independent planets
- Debug console.log statements present
- Enemy AI V3 tracks targets by fleet ID and validates them; strength-based selection prefers weak/comparable targets, distance breaks ties
- Strategic AI layers V4.1 (strategy), V4.2 (goal), V4.3 (capability), and V5 (action) only evaluate and log intentions; the V5.1/V5.2 `EnemyActionExecutor` executes `produce_colonizer` and `assemble_fleet`
- Enemy Action Layer V5 is fully implemented, tested, and integrated into the game loop; V5.1 executes `produce_colonizer` and V5.2 executes `assemble_fleet`, while `move_to_target` / `colonize` / `attack` / `defend` / `develop` are evaluated but not yet executed
- No enemy fleet production or reinforcement from conquered planets
- Only one Spaceship Factory building type exists (no Small/Medium/Large Factory tiers)
- `orbital_factory` is defined as a `ProductionBuildingKind` type but no building produces it and no ship requires it
- School moraleRate is 1.0 in planet-data.json, which is much higher than other social buildings and may be overpowered
- Research Laboratory moraleRate is 1.0 in planet-data.json

---

## 9. Tesztek

- Vitest 4.x + jsdom
- Existing spec files:
  - `app.spec.ts` — 2 tests
  - `main-menu.spec.ts` — 1 test
  - `star-map.spec.ts` — 15 tests (component creation + EnemyActionService game-loop integration: 2s evaluation timing, pause safety, 2x speed behaviour, independent per-faction ActionResults, reset on load, no game-state mutation, pipeline ordering, log-only-on-change, produce_colonizer and assemble_fleet full-pipeline execution)
  - `game-time.service.spec.ts` — 28 tests
  - `star-map-sensor.service.spec.ts` — 11 tests
  - `star-map-resources.spec.ts` — 10 tests (deterministic resource tile generation + selection)
  - `economy.service.spec.ts` — 34 tests (habitability drift, workforce/efficiency, pause freezes morale, 2× speed linearity, population growth: capacity, formula, clamp, independent planets, live mutation)
  - `enemy-ai.service.spec.ts` — 21 tests (strength-based target selection, category priority, distance tie-breaking, target validation, retargeting on destroy/no-ships, pause safety, independent multi-fleet targeting, moving target follow, no modification of player/neutral fleets)
  - `enemy-strategy.service.spec.ts` — 18 tests (defend/attack/expand/develop selection, priority ordering, determinism, no state mutation, independent multi-faction behavior, accumulator timing, reset)
  - `enemy-goal.service.spec.ts` — 27 tests (all four goal types, goal commitment, invalidation, strategy change replacement, multi-faction independence, determinism, no state mutation, accumulator timing, reset)
  - `enemy-capability.service.spec.ts` — 25 tests (colonization prerequisites, attack/defend fleet and target checks, develop executability, determinism, no state mutation, multi-faction independence, accumulator timing, reset, edge cases)
  - `enemy-action.service.spec.ts` — 23 tests (all action types, preparation vs execution paths, determinism, no state mutation, independent multi-faction behavior, accumulator timing, reset, edge cases)
  - `enemy-action-executor.service.spec.ts` — 32 tests (produce_colonizer execution: planet selection, guard rails, duplicate-order protection, logging; assemble_fleet execution: stock→fleet reinforcement, colonizer assembly, new-fleet fallback, duplicate/stale-action guards, wrong-faction and player safety, no-Spaceport/no-stock no-mutation, pause safety, logging)
  - `research.service.spec.ts` — 28 tests (getAllTechnologies/getTechnology, starting techs, getStatus, canResearch, researchTechnology, isShipUnlocked, isBuildingUnlocked, getSensorRangeBonus)
  - `save-game.service.spec.ts` — 3 tests
  - `star-map-planet-screen.component.spec.ts` — 11 tests (resource tile detection, mine placement validation)
- Total: ~289 tests

---

## 10. Összefoglalás

A játék jelenlegi állapota:
- Core gameplay loop működik (map → system → planet → battle)
- Gazdasági és gyártási rendszer teljesen működik; a bolygó-termelés a workforce efficiency (lakosság által biztosított vs. épület igény) szorzójával skálázódik; a nehezen lakható bolygók negatív morale driftet generálnak, amit Park és Entertainment Center ellensúlyoz
- Fleet assembly és ship stock működik
- Save/load (5 slots) és fog-of-war működik
- Research tree: 18 technologies, player starts with 4, gates buildings/ships/sensors
- Resource deposits: ~20% of planets have deterministic resource tiles, Mining Complex adjacency required
- Sensor system: preview rings, research-based range bonuses, system/fleet range computation
- Enemy AI V3: ellenséges flották erősségi szempontból választanak célpontot (weak > comparable > strong), távolság csökkenti a kötést ugyanazon kategórián belül
- Harcrendszer autonóm: az AI nem indítja a csatákat, a `StarMapBattleDetectionService` detektálja az ütközéseket és a `BattleService` kezeli a csatát
- Stratégiai AI rétegzett rendszere: Strategy (V4.1) → Goal (V4.2) → Capability (V4.3) → Action (V5, implementálva és integrálva a game loop-ba; az action értékelése minden faction-re lekérdezhető, a V5.1/V5.2 `EnemyActionExecutor` pedig a `produce_colonizer` és `assemble_fleet` actionöket hajtja végre a meglévő service-eken keresztül)
- Hiányzik: a fennmaradó action típusok végrehajtása (`move_to_target`, `colonize`, `attack`, `defend`, `develop`), diplomacia, ship design, hang, multiplayer
- Ismert korlátok: no shield pool in battle, no weapon effectiveness, no crit/evasion, only one factory type, School/Research Lab moraleRate 1.0 potentially overpowered

Ez a dokumentum a játék teljes jelenlegi állapotát írja le feature-felel és készültségi fokok szerint.

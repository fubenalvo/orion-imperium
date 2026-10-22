# Orion Imperium - Feature List & Project Status (2026-10-12)

> **Version:** 0.5  
> **Framework:** Angular 22 (standalone components)  
> **Platform:** Client-side only, localStorage persistence  
> **Purpose:** Comprehensive overview of current implementation - all screens, features, functions, and global systems

---

## 1. Project Overview

Orion Imperium is a 4X space strategy game featuring real-time strategic gameplay on a galaxy map with fleet movement, economy simulation, production chains, research tree, AI opponents with multi-layer decision making, and a real-time tactical battle minigame.

**Core Gameplay Loop:** Explore → Expand (colonize) → Build economy → Research → Produce ships → Assemble fleets → Fight → Manage → Repeat

---

## 2. Screens & Routes

| Route | Screen | Purpose | Status |
|---|---|---|---|
| `/` | **Main Menu** | New game/load game, slot management, PWA install prompt (mobile) | ✅ Complete |
| `/star-map` | **Star Map** | Core gameplay hub - galaxy view, system view, planet surface | ✅ Complete |
| `/battle` | **Battle Screen** | Real-time tactical minigame (18×7 grid) with pause/speed controls | ✅ Complete |

---

## 3. Main Menu (`src/app/main-menu/`)

**Functions:**
- **Slot Management** (5 slots: slot 0 = autosave, slots 1-4 = manual)
- **New Game** - Creates fresh game from `star-map-data.json`, saves to selected manual slot, activates it
- **Load Game** - Activates selected slot (copies to autosave), navigates to star map
- **PWA Support** - Install prompt for mobile, iOS standalone detection
- **Options** - Opens global options menu via `GameSettingsService`

**Files:** `main-menu.ts`, `main-menu.html`, `main-menu.scss`

---

## 4. Star Map Screen - Core Component (`src/app/components/star-map/star-map.ts`)

The Star Map is the orchestrator component managing game state and coordinating all sub-systems.

### Views (mutually exclusive)

| View | Mode | Description |
|---|---|---|
| `map` | **Galaxy View** | 300×180 cell grid. Star systems and fleets positioned. Fog of war, sensor range, camera panning, minimap. |
| `system` | **System View** | 18×10 grid (5vw cells). View inside star system - planets arranged in zigzag arc, fleets in system. All fleets visible in system. |
| `planet` | **Planet Surface** | Grid sized by planet (5/7/9/11 cells). Building placement, production, assembly. Pannable surface. |

### Selection System (mutual exclusion)
- `selectedSystem` / `selectedFleet` / `selectedPlanetTile` - only one active at a time
- `selectedFleetAction` - currently supports `'move'` mode
- Context menu for disambiguating overlapping objects on same cell

### Camera & Navigation
- **Panning**: Arrow keys, drag-to-pan (with 5px threshold), minimap click, d-pad
- **Clamping**: Camera constrained to map bounds
- **Parallax**: Background at 200% grid size with 0.3× offset
- **Responsive**: Cell size 2vw (desktop ≥1300px) / 3.5vw (mobile)
- **Auto-pause**: On window blur, tab hidden, portrait orientation

### Global Functions
- **Game Time Integration** - Delegates to `GameTimeService`, RAF loop via `StarMapGameLoopService`
- **Save/Load** - Auto-saves on: enter/leave system, open/close planet view, pause menu open/close, exit to menu, battle trigger, colonization/capture, destroy
- **Battle Flow** - Detects fleet-vs-fleet collisions → navigates to battle; applies results on return via `reloadAfterBattle()`

---

## 5. Star Map UI Components

| Component | Location | Function |
|---|---|---|
| **Header HUD** | `star-map-header/` | Time controls (⏸ 1× 2×), currencies, ship stock count, research tree button, sensor range toggle, HudDots indicator |
| **Navigation** | `star-map-navigation/` | Camera pan controls, minimap, viewport position display |
| **Galaxy View** | `star-map-galaxy-view/` | Renders galaxy grid, fog of war, sensor highlights, systems, fleets, movement trails |
| **System Grid View** | `star-map-system-grid/` | Renders system interior (sun, planets in arc, fleets in system, system sensor range) |
| **Planet Screen** | `star-map-planet-screen/` | Planet surface grid, build mode, building placement validation, tabs (Details/Build/Production/Assembly) |
| **Fleet Info Panel** | `star-map-fleet-info/` | Selected fleet details - ships, attack/defense totals, actions (reinforce/disband) |
| **System Info Panel** | `star-map-system-info/` | Selected system info + "Enter System" action |
| **Planet Info Panel** | `star-map-planet-info/` | Selected planet - population, buildings, economy, satisfaction, workforce, morale |
| **Fleet Buttons** | `star-map-fleet-buttons/` | Sidebar list of all visible fleets (click to select) |
| **Context Menu** | `star-map-context-menu/` | Disambiguates overlapping objects (fleets/systems/planets) on same cell |
| **Production Panel** | `star-map-production-panel/` | Queue ship production, view ETA, cancel orders (inline in planet screen) |
| **Spaceport Panel** | `star-map-spaceport-panel/` | Create/reinforce/disband fleets, composition selection (inline in planet screen) |
| **Research Tree** | `star-map-research-tree/` | 24 technologies with status (researched/available/locked), unlocks ships/buildings/bonuses |
| **Minimap** | `star-map-minimap/` | Standalone widget showing explored systems & visible fleets |
| **Pause Menu** | `star-map-pause/` | Save/load slots, exit to main menu (overlays star map) |
| **Options** | `star-map-options/` | Global options menu (fog of war toggle) |
| **Hud Dots** | `hud-dots/` | Status LED indicators (sm/md sizes) |
| **Background Stars** | `background-stars/` | Decorative animated parallax background |
| **Black Hole** | `blackhole/` | Special object component on map |

---

## 6. Battle Screen (`src/app/components/battle-screen/`)

Real-time tactical minigame, fully self-contained. Uses `BattleService` for transport boundary.

### Battle Screen Component (`battle-screen.component.ts`)
- Orchestrator - builds local `BattleModelState`, forwards input, manages result modal
- Real-time RAF game loop + AI tick interval (200ms)
- Battle time controls (pause/1×/2×) via `BattleTimeService` (independent from global GameTime)
- Auto-battle toggle
- Command queue for player actions (handles pause/drain)
- Result modal with summaries

### Battle Grid Component (`battle-grid/`)
- Renders 18×7 grid (4vw cells)
- Highlights: selected stack, move cells (green dashed), attack targets (red pulsing), connections
- Renders projectiles, impacts, explosions
- Handles clicks for move/attack
- Shows planet visual for planet battles + shared shield bar

### Battle Fleet Panel (`battle-fleet-panel/`)
- Side rosters (attacker/defender) with ship counts, HP/shield, status
- Shows carrier shield pulse button when available
- Stack selection

### Battle Subsystem (`battle/` module)

| Service/Util | Purpose |
|---|---|
| **battle.types.ts** | Core types, constants (18×7, ANIMATION_MS, AI_ACTION_INTERVAL_MS, SHIELD_REGEN_INTERVAL_MS) |
| **battle-state.ts** | Creates `BattleModelState` from `Battle` - deep clones ships, groups into stacks (max 5 per type), deploys |
| **battle-grid.ts** | Grid geometry - bounds, distance (Euclidean), pathfinding (line of sight), occupancy, range checks |
| **battle-game-loop.service.ts** | RAF loop with raw real delta time (not affected by global pause) |
| **battle-movement.service.ts** | Real-time VW movement toward targets, move validation, path clearing |
| **battle-combat.service.ts** | Attack resolution - volley damage, spillover, weapon effectiveness vs weakness, shield absorption, logging |
| **battle-animation.service.ts** | Animation lock (busy counter), effect lifecycle (projectile→impact/explosion), tick notifications |
| **battle-ai.service.ts** | Tactical AI for non-player sides - greedy attack→boost→move, one action per 200ms tick |
| **battle-time.service.ts** | Independent battle time (pause/1×/2×), frame-driven wait scheduler, accumulates battleElapsedTime |
| **battle-result.ts** | Builds `BattleOutcome` from final state for Star Map consumption |

**Battle Mechanics:**
- Real-time movement at ship speed (vw/s), no AP system
- Stacks group ships by type (max 5 per stack) - volley attack from all alive
- Damage: `max(1, totalAttack - frontShip.defense)`, spills to next ship; shields absorb first
- Weapon type effectiveness (kinetic/energy/missile vs weakness) with multipliers
- Planet battles: virtual defense from buildings (turrets immobile), shared planetary shield pool
- Animation lock gates attacks; movement never blocked
- Auto-battle mode uses AI for player side

---

## 7. Global Services

### Core Time & Simulation
- **GameTimeService** (`services/game-time.service.ts`) - Central time state: speed (1|2), isPaused, gameElapsedTime, scaled delta calculation. Always returns 0 delta when paused. Emits state changes only on discrete events.
- **StarMapGameLoopService** - RAF loop outside Angular zone, always runs (pause handled by GameTimeService returning 0), clamps delta to 0.1s, triggers callbacks with scaled delta.

### Battle Transport
- **BattleService** (`services/battle.service.ts`) - Transport boundary between Star Map and Battle Screen. Stores `currentBattle`, `battleResult`, `destroyedFleetId`. Methods: `setBattle()`, `setPlanetBattle()`, `getBattleResult()`, `setDestroyedFleetId()`, `clearBattle()`.

### Data & Persistence
- **SaveGameService** (`services/save-game.service.ts`) - localStorage (`orion_save_slots`), 5 slots (0 autosave + 4 manual). Migration logic for legacy saves (grid conversion, backfill fields). `activateSlot()` copies manual to autosave. Validates save data. Stores ISO timestamps.
- **SaveValidation** (`services/save-validation.ts`) - Schema validation for save data, version checking (`SAVE_VERSION`).

### Economy & Population
- **EconomyService** (`services/economy.service.ts`) - Data-driven economy. Computes planet/faction production/consumption, energy efficiency, workforce efficiency, satisfaction drift. 
  - Resources: credits (floored), rawmaterials/research (floats), energy (flow only)
  - Population growth: `0.005/s × satisfactionMultiplier × habitabilityMultiplier × (capacity - pop) × deltaTime`
  - Satisfaction drift: `(energyDir ±1 + habitabilityDrift + buildingMoraleBonus) × deltaTime`, range 0-100, rebellion at 0→independent
  - Workforce: available from housing, required by all buildings; efficiency scales building production only

### Production & Assembly
- **ProductionService** (`services/production.service.ts`) - Per-planet production queues (1 order per planet). Cost deducted upfront. Build time: `shipType.buildTime / factoryPower` (default buildTime = cost×0.1). Completed ships enter global stock. Auto-cancel stalled orders after 30s with proportional refund. Ticks respect pause (returns early if deltaTime ≤ 0).
- **ShipStockService** (`services/ship-stock.service.ts`) - Global per-faction stock (per-instance ShipStockEntry). FIFO semantics, id generation shared with fleet ships. `disbandFleet()` returns survivors to stock.
- **FleetAssemblyService** (`services/fleet-assembly.service.ts`) - Create/reinforce/disband fleets using stock. Spawns at host planet's system cell. Validates spaceport presence, stock availability.
- **SpaceportService** (`services/spaceport.service.ts`) - Permission checks for Spaceport building. Lists spaceport locations per faction.

### Research
- **ResearchService** (`services/research.service.ts`) - Data-driven research tree (24 technologies). Checks prerequisites, deducts research points, tracks researched techs. Unlocks ships, buildings, sensor bonuses. Validates tree structure (no cycles, valid refs).

### Ships & Movement
- **ShipService** (`services/ship.service.ts`) - Ship type lookup, normalization (adds buildTime, productionBuilding defaults), fleet strength calculation.
- **StarMapMovementService** (`star-map/star-map-movement.service.ts`) - Fleet movement (galaxy + system), grid cell math, coordinate conversion, trail generation. Galaxy: converts speed (vw/s) to cells/s. System: uses vw directly. Refreshes grid positions.

### Planet Battles & Detection
- **PlanetBattleService** (`services/planet-battle.service.ts`) - Creates virtual defense fleets from planet buildings (turrets become immobile ships), manages shared planetary shield pool, handles uninhabited arrival (colonizer consumption), resolves capture vs combat.
- **StarMapBattleDetectionService** - Detects fleet-vs-fleet collisions on same grid cell (hostile teams only), determines attacker/defender, triggers battle once per pair.
- **StarMapPlanetArrivalService** - Handles fleet arrival on planets: uninhabited → colonize, same-faction → ignore, undefended enemy → capture immediately, defended → trigger planet battle.

### AI System (Layered Pipeline)
- **StarMapAiTickService** - Sequences full AI pipeline each tick for all AI factions: V3 → V4.1 → V4.2 → V4.3 → V5 → execution. Runs every frame respecting pause/speed.
- **EnemyAiService (V3)** - Reactive targeting: strength-based selection (weak/comparable/strong), prioritizes weak→comparable→strong by distance. Commits to targets until invalidated.
- **EnemyStrategyService (V4.1)** - High-level strategy every 2s: DEFEND (threat within 5 cells) → ATTACK (favorable engagement within 15 cells, 1.2× stronger) → EXPAND (within 20 cells of uninhabited) → DEVELOP (fallback).
- **EnemyGoalService (V4.2)** - Concrete goals with targets: colonize, attack, defend, develop. Committed until invalidated or strategy changes.
- **EnemyCapabilityService (V4.3)** - Evaluates capability to pursue goal (tech, ships, fleet, target validity, combat capability, reinforcement need). Tracks peak fleet strength.
- **EnemyActionService (V5)** - Determines next action from goal+capability: produce_colonizer, produce_combat_ship, reinforce_fleet, create_fleet, assemble_fleet, move_to_target, colonize, attack, defend, develop.
- **EnemyActionExecutor (V5.1-5.4)** - Executes actions via existing services with stateless guards (prevents duplicate execution). Develop action builds buildings by priority (energy→workforce→raw materials→research).

### UI Support
- **StarMapPanelVmService** - View models for production/spaceport panels, error messages, fleet name suggestions.
- **GameSettingsService** - Global settings (fog of war toggle), opens options menu.
- **StarMapSensorService** - Computes sensor range cells (player only), fog layers (black/grey/visible), preview rings (R+1..R+2), exploration tracking. Fleet effective range = max(floor(sensorRange), max ship range). System gives 5-cell base range.

---

## 8. Data Models (`star-map.models.ts`)

### Core State
- **StarMapData** - Root save: factions, map (width/height/cellSizeVw/Vh), starSystems, fleets, currentView, camera, selections, exploredGridCells, shipStock, production, defaultView, saveVersion
- **Faction** - id, name, color, team (0 neutral/1 player/2+ enemy), ai flag, currencies, researchedTechnologies
- **StarSystem** - id, name, x,y (galaxy grid), planets count, color, planetsTiles, gridCol/gridRow, explored
- **PlanetTile** - id, name, factionId, x,y (system grid pos), type, size, population (float), buildings, explored, satisfaction (0-100), resourceTiles, shieldPoolCurrent
- **Fleet** - id, name, factionId, x,y (galaxy grid, floats), targetX/Y, speed, system (SystemLocation|null), gridCol/gridRow, ships (FleetShip[]), destroyed, sensorRange
- **FleetShip** - id, name, type, currentHp, destroyed
- **ShipType** - id, name, role, HP/shield/shieldRegen, attack/attackType/weakness, defense, speed, range, battleMoveRange, cost, maintenanceCost, buildTime, productionBuilding, fireRate

### Production/Stock
- **ShipStockEntry** - id, type, name, producedAtTick, originPlanetId
- **FactionShipStock** - factionId, ships[]
- **ProductionOrder** - id, shipTypeId, quantity, progress, startedAtTick
- **FactionProduction** - factionId, ordersByPlanet: Record<number, ProductionOrder[]>

### Economy
- **ResourceType** - 'credits'|'rawmaterials'|'research'|'energy'
- **ResourceRates** - Partial<Record<ResourceType, number>>
- **PlanetEconomy** - production/consumption/net, energy balance/efficiency, satisfaction, incomeMultiplier, workforce (available/required/efficiency), habitabilityDrift, buildingMoraleBonus
- **EconomyBreakdown** - faction totals with per-planet and fleet expense breakdowns
- **BuildingStats** - building definition (role, maintenance, production/consumption/energy, population/workforce/providesWorkforce, moraleRate, defense, productionBuildingKind, requiresOreProximity)

### Research
- **Technology** - id, name, description, researchCost, prerequisites[], unlocksShips[], unlocksBuildings[], bonuses[] (sensorRange)

### AI Types
- **AiStrategy** - 'expand'|'attack'|'defend'|'develop'
- **GoalType** - 'colonize'|'attack'|'defend'|'develop'
- **StrategicGoal** union types (ColonizeGoal/AttackGoal/DefendGoal/DevelopGoal)
- **ActionType** - 11 action types
- **ActionResult**, **CapabilityResult**, **CapabilityRequirement**

### Battle (transport)
- **Battle** - fleet1/fleet2, faction names/colors, attackerId/defenderId, type ('fleet'|'planet'), planetId/name/color
- **BattleOutcome** - winner/loser, per-side rosters with survivors/wipedOut, rounds, battle type

---

## 9. Data Files (`src/app/components/star-map/`)

| File | Contents |
|---|---|
| `star-map-data.json` | Initial galaxy: 14 star systems, 35 planets, 4 fleets (2 player + 2 enemy), 5 factions, 300×180 map, default view (SOL Earth) |
| `ship-data.json` | 11 ship types + colonizer (12 total): Scout, Fighter, Corvette, Frigate, Destroyer, Cruiser, Carrier, Battleship, Battlecruiser, Dreadnought, Colonizer. Full stats + fireRate. |
| `planet-data.json` | 17 buildings: turrets (Laser/Missile), shields, residential (S/M/L), social (Park/Hospital/School/Entertainment), power (Solar/Fusion), industry (Factory/Mining), spaceport, labs (S/L). With production/consumption/energy/workforce/morale. |
| `research-tree.json` | 24 technologies across engineering/military/industry/science/power/recon branches. Starting techs: basic_engineering, basic_science, basic_industry, basic_power (cost 0). Sensor bonuses: +1 each for basic/advanced/long-range radar (cumulative +3). |

**Starting Resources:** 1000 credits, 1000 raw materials, 1000 research points  
**Factions:** player (team 1, blue, not AI), enemy1 (team 2, red, AI), enemy2 (team 2, teal, AI), independent (team 0, yellow), unhabited (team 0, grey)

---

## 10. Time System

### Global GameTime
- Speeds: 1×, 2× (extendable union type)
- Pause preserves speed; setSpeed() un-pauses
- RAF loop always runs; `getScaledDeltaTime()` returns 0 when paused
- `gameElapsedTime` accumulates simulation seconds
- Auto-paused on blur/visibility hidden

### Battle Time (independent)
- Separate `BattleTimeService` instance
- Pause/1×/2× controls in battle header
- Frame-driven wait scheduler (no setTimeout) - waits advance by scaled delta
- Affects movement, AI ticks, shield regen, attack cooldowns, animation waits
- Global GameTime paused while in battle

---

## 11. Fog of War & Sensors

- **Sources (player only):** Fleet effective range (max of floor(sensorRange), max ship range in fleet) + player-owned systems provide 5-cell base range
- **Computation:** Euclidean circle (dx²+dy² ≤ range²)
- **Layers:** Black (never explored - fully hidden), Grey (explored but out of range - dimmed), Visible (in range - highlighted with faction color)
- **Preview Ring:** Cells at R+1..R+2 render as faint halo (low confidence) - not explored
- **Exploration:** Monotonic - once explored stays explored (`exploredGridCells` Set). Systems/planets marked explored when in range
- **Fleet Visibility:** Player always visible; enemy/neutral hidden outside sensor range (but still tracked for battle detection)
- **System View:** All fleets in current system visible regardless of sensor range
- **Toggle:** Sensor range overlay can be toggled in header HUD
- **Research Bonuses:** +1/+1/+1 sensor range from radar tech tree (cumulative +3)

---

## 12. Economy, Population & Satisfaction

- **Energy Efficiency:** 1.0 if production ≥ consumption; else production/consumption. Scales building production.
- **Workforce Efficiency:** min(1, available/required). Scales building production only (not consumption, not population income).
- **Satisfaction Multiplier:** satisfaction/100 (0-100). Scales credit income only.
- **Satisfaction Drift:** `(energyDir ±1 + habitabilityDrift + buildingMoraleBonus) × deltaTime`. Energy dir: -1 if short, +1 if sufficient. Habitation varies by planet type (earthlike/gasgiant 0, marslike -0.03, venuslike/desert -0.05, ice -0.08). Building morale from social (+) vs industry (-). Rebellion at 0 → independent.
- **Population Growth:** 0.005/s × satisfactionMult × (1+habitabilityDrift? actually habitabilityMultiplier = max(0,1+drift)) × remainingCapacity × deltaTime. Clamped to residential capacity (S:100, M:300, L:700). Independent planets (satisfaction 0) never grow. Floats, UI rounds for display.
- **Maintenance:** Building maintenance + fleet ship maintenance (per non-destroyed ship). Deducted from credits.
- **Credits Floored:** On accumulation; rawmaterials/research stored as floats.

---

## 13. Production, Stock & Assembly

- **Production Queue:** 1 order per planet. Cost deducted upfront at queue time. Progress += deltaTime / (buildTime / factoryPower). Factory power: 0.5 per Spaceship Factory. buildTime defaults to cost×0.1.
- **Global Stock:** Per-faction empire stock (per-instance entries). Completed ships added on tick. Ids shared with fleet ships (no collisions).
- **Fleet Assembly:** Requires Spaceport on owned planet. Create fleet (new) or reinforce existing from stock. Disband returns survivors to stock, marks fleet destroyed.
- **Stalled Orders:** Auto-cancel after 30s if factory lost, refund unbuilt portion proportionally. Tick early-returns if paused.

---

## 14. Research Tree (24 Technologies)

**Branches:**
- **Engineering:** basic → advanced → orbital → advanced_shipyards
- **Military:** basic_engineering + military_engineering → advanced_weapons → capital_ship_technology
- **Industry:** basic → advanced → advanced_manufacturing → urban_infrastructure
- **Science:** basic → advanced → advanced_research → applied_science
- **Power:** basic → improved → fusion → advanced_power_infrastructure
- **Recon/Sensors:** basic_science → basic_radar (+1) → advanced_radar (+1, total +2) → long_range_radar (+1, total +3)
- **Ship-Specific:** scout/fighter/corvette/frigate/destroyer/cruiser/carrier/capital ship branches, colonization_technology

**Unlocks:** Ships (11 types + colonizer), buildings (17 types), sensor range bonuses.

---

## 15. Save System

- **Storage:** `localStorage` key `orion_save_slots`
- **Slots:** 5 total (index 0 = autosave, 1-4 = manual). Each has `data: StarMapData | null`, `date: ISO string | null`
- **Active Session:** Always backed by autosave slot. `activateSlot()` copies manual slot to autosave for non-autosave loads. `currentSlot` normalized to autosave.
- **Auto-Save Triggers:** Enter/leave system, open/close planet view, open/close pause menu, exit to menu, battle trigger (fleet/planet), colonization/capture, component destroy
- **Migration:** Backfills missing fields (shipStock, production, researchedTechnologies, resourceTiles, ai flag), converts legacy vw coords (map width 200→grid cells)
- **Validation:** Structural + schema validation via `validateSaveData()`. Corrupt slots quarantined to backup key.
- **Battle Persistence:** Battle results written to autosave; `reloadAfterBattle()` reapplies on return.

---

## 16. Test Coverage

~335 tests total (334 passing, 1 pre-existing unrelated). Coverage includes:
- GameTime (28), Sensor (11), Resource deposits (10), Economy (34)
- Battle subsystem: state/grid/ship-stats/turn/movement/combat/animation/AI/result/grid-component/screen (59+ tests)
- Enemy AI pipeline: V3 (21), V4.1 (18), V4.2 (27), V4.3 (25), V5 (23), Executor (76)
- StarMap component (15), Research (28), Save (5), Planet screen (11)

---

## 17. Current State & Known Notes

**Implemented & Stable:**
- Full galaxy/system/planet views with fog of war & sensors
- Real-time fleet movement with trails
- Economy with population growth, satisfaction/morale, workforce
- Ship production + global stock + fleet assembly (spaceport)
- Research tree with 24 techs
- Multi-layer enemy AI (V3-V5.4) executing colonize/attack/defend/develop
- Real-time tactical battle minigame (18×7 grid)
- Planet battles with virtual defenses & shared shields
- Save/load with migration, autosave, slot management
- Responsive UI with CRT styling, HUD panels, minimap

**Design Notes:**
- Battle is real-time (no AP system) - movement continuous, attacks gated by animation lock only
- AI develop action builds by economy priority
- Fleet sensor range is floor-based (can increase with high-range ships)
- Credits floored on accumulation; research/raw materials as floats
- Population stored as float
- Time is runtime preference (not persisted)

**See Also:** `docs/architecture.md`, `docs/game-systems.md`, `docs/battle-screen.md`, `docs/battle-rules.md`, `docs/data-models.md`, `docs/invariants.md`, `docs/ship-production.md`, `docs/game-time.md`, `docs/ui-styling.md`

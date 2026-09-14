# Feature List & Status

> **Version:** 0.5  
> **Scope:** Angular 22 standalone, client-side, localStorage persistence  
> **Purpose:** Game designer review document — current feature inventory, how each feature works, and gaps that need prioritization.

---

## 1. Feature Matrix

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Complete | Fully implemented, stable, tested |
| ⚠️ Partial | Functional but incomplete or with known issues |
| ❌ Not Started | No implementation |
| 🛑 Known Bug | Functional but with a confirmed defect |

### Feature Inventory

| # | Feature | Status | Category |
|---|---------|--------|----------|
| 1 | Galaxy map (300×180 grid) | ✅ | Core |
| 2 | Star system view (18×10 grid) | ✅ | Core |
| 3 | Planet surface view | ✅ | Core |
| 4 | Fleet movement (galaxy + system) | ✅ | Core |
| 5 | Fog of war / sensor range | ✅ | Core |
| 6 | Fleet-vs-fleet battles | ✅ | Combat |
| 7 | Planet-vs-fleet battles | ✅ | Combat |
| 8 | Economy (resource production, satisfaction, morale) | ✅ | Economy |
| 9 | Ship production queue | ✅ | Production |
| 10 | Global ship stock (empire-level) | ✅ | Production |
| 11 | Fleet assembly (spaceport) | ✅ | Production |
| 12 | Save/load (1 autosave + 4 manual slots) | ✅ | Systems |
| 13 | Main menu (new game, load game) | ✅ | Systems |
| 14 | Pause menu (save, load, exit) | ✅ | Systems |
| 15 | Time controls (1×/2×/pause) | ✅ | Systems |
| 16 | Camera pan (arrows, drag, minimap, d-pad) | ✅ | UI |
| 17 | Context menu (click disambiguation) | ✅ | UI |
| 18 | Fleet info panel | ✅ | UI |
| 19 | System info panel | ✅ | UI |
| 20 | Planet info panel | ✅ | UI |
| 21 | Currency HUD (expandable breakdown) | ✅ | UI |
| 22 | Ship stock HUD | ✅ | UI |
| 23 | Header HUD (title, time, currencies, stock, research) | ✅ | UI |
| 24 | Production panel (queue, ETA, cancel) | ✅ | UI |
| 25 | Spaceport panel (create/reinforce/disband) | ✅ | UI |
| 26 | Building placement (planet surface) | ✅ | UI |
| 27 | Planet colonization | ✅ | Gameplay |
| 28 | Planet capture (undefended) | ✅ | Gameplay |
| 29 | Planet rebellion (satisfaction → 0) | ✅ | Gameplay |
| 30 | Planet habitability & morale drift | ✅ | Gameplay |
| 31 | Workforce & building efficiency | ✅ | Gameplay |
| 32 | CRT styling / parallax background | ✅ | Visual |
| 33 | Resource deposits (deterministic) | ✅ | Gameplay |
| 34 | Research tree (18 technologies) | ✅ | Systems |
| 35 | Sensor range bonuses (research) | ✅ | Core |
| 36 | Responsive layout (desktop/mobile) | ✅ | UI |
| 37 | Options / Credits screen | ❌ stub | Systems |
| 38 | Diplomacy | ❌ | Missing |
| 39 | Ship design (customization) | ❌ | Missing |
| 40 | AI opponents (full V5 pipeline) | ✅ | AI |
| 41 | Missions / objectives | ❌ | Missing |
| 42 | Multiplayer | ❌ | Missing |
| 43 | Audio | ❌ | Missing |
| 44 | Battle screen (tactical minigame) | ✅ | Combat |
| 45 | Planet population growth | ✅ | Economy |

---

## 2. Gameplay Loop

The core gameplay loop:

```
Galaxy Map → Select Fleet → Move to System → Enter System → Move to Planet
    → Colonize/Capture/Battle → Return to Map → Manage Economy/Production
    → Research New Techs → Build Ships → Assemble Fleets → Repeat
```

1. **Explore:** Fog of war hides unexplored galaxy cells. Player fleets and owned star systems (range 5) reveal cells. Newly explored cells stay permanently visible.
2. **Expand:** Move a colonizer-containing fleet to an unhabited planet to colonize it. Build residential blocks to grow population. Build a Spaceship Factory and Spaceport to enable production and fleet assembly.
3. **Build Economy:** Construct power plants to keep buildings powered (energy efficiency affects all production). Build residential blocks for workforce. Build mining complexes on resource tiles for raw materials. Build research labs for research points.
4. **Produce & Expand:** Queue ship production at planets with Spaceship Factories. Completed ships enter the empire-wide stock. Assemble them into fleets at planets with Spaceports.
5. **Research:** Spend accumulated research points on the technology tree (18 techs). Research unlocks new ship types, buildings, and sensor upgrades.
6. **Fight:** Move fleets into enemy territory. Fleet-vs-fleet battles trigger on same-cell collision. Planet-vs-fleet battles trigger when an enemy fleet arrives at a defended planet. Battles switch to a tactical turn-based minigame.
7. **Manage:** Monitor satisfaction/morale, build social infrastructure to counter planet-type penalties, reinforce fleets, and save regularly.

The game runs continuously when unpaused (time speeds 1× and 2×). All simulation (movement, AI, economy, production) pauses when the player views the battle screen or when the game is paused.

---

## 3. Feature Details

### 3.1 Galaxy Map

**Grid:** 300×180 cells, 1-indexed. Cell size is 2vw on desktop (≥1300px) and 3.5vw on mobile.

**Camera:** Panning via arrow keys, drag-to-pan (with pointer capture and 5px threshold to distinguish from clicks), minimap click-to-move, and d-pad overlay. Camera is clamped to map bounds. Background renders at 200% grid size with 0.3× parallax offset.

**Objects:** Star systems (with planets arranged in a zigzag arc) and fleets are placed on grid cells. Newly assembled fleets spawn on their host planet's system cells.

**Selection:** Click-to-select with mutual exclusion (fleet/system/planet — only one active at a time). Context menu appears when multiple objects overlap at the same cell.

**Movement:** Click on the map (with Move action active) to set a fleet's target. Speed is in vw/s, converted to cells/s via `speed / cellSizeVw / 10`. Movement snaps at 0.01 distance.

### 3.2 Star System View

**Grid:** 18×10 cells, 5vw each. Planets are positioned based on their `x`/`y` fields in the planet data (1-indexed system grid coordinates), with a fallback formula for out-of-bounds values.

**Fleet placement:** Fleets in the system are positioned at default coordinates (2.5, 32.5) vw and can be moved via click-to-move within the system grid.

**Visibility:** No fog of war inside systems — all fleets in the current system are visible regardless of sensor range.

### 3.3 Planet Surface

**Grid:** Size = `numericSize × 2 + 3` cells (5/7/9/11 for tiny/small/medium/big/huge). Grid is 3.36vw per cell. Surfaces larger than the viewport are pannable via mouse drag, touch drag, and d-pad overlay with continuous pan.

**Views:** Three tabs in the sidebar:
- **Details:** Planet info (type, size, population, satisfaction, economy breakdown)
- **Build:** Place buildings on the grid (player-owned planets only)
- **Production:** Queue ship production (requires Spaceship Factory)
- **Assembly:** Fleet creation/disband/reinforce (requires Spaceport)

**Building placement:** Select a building from the build menu, click a cell to preview placement, confirm to deduct credits and place it. Buildings cannot overlap, cannot be placed on resource tiles, and Mining Complexes must be adjacent to resource tiles.

### 3.4 Fleet & Ship System

**Ship types (11):** Scout, Fighter, Colonizer, Corvette, Frigate, Destroyer, Cruiser, Carrier, Battleship, Battlecruiser, Dreadnought. Each has hit points, shield, attack, defense, speed, range, cost, and maintenance cost. Build time defaults to `cost × 0.1` seconds per factory.

**Starting fleets:**
- Player: ORION (2 Frigates), PEGASUS (3 Cruisers)
- Enemy1: RAIDER (4 Destroyers)
- Enemy2: HUNTER (4 Scouts + 1 Destroyer)

**Fleet movement:** Target-based. Fleets display movement trails. In-system movement uses vw units directly; galaxy movement uses grid cells.

**Fleet state:** `destroyed` flag filters fleets from rendering, movement, collision, and economy. Survivors of battles return with damaged HP tracked per-ship.

### 3.5 Fog of War & Sensors

**Sensor sources (player faction only):**
- Fleet sensor range: `max(fleet.sensorRange floor, max ShipType.range among non-destroyed ships)` + research bonuses. Default floor: 3 cells.
- Star system sensor range: 5 cells (player-owned systems provide base visibility).
- Research bonuses: +1 per radar tier (Basic Radar → Advanced Sensors → Long-Range Scanning).

**Layers:**
- **Black fog:** Never-explored cells (fully hidden)
- **Grey fog:** Explored but outside current sensor range (dimmed overlay)
- **Visible:** Within sensor range (shown with faction-colored highlight)

**Preview ring:** Cells at distance R+1 to R+2 from a sensor source render as a faint halo — indicates the fleet is almost in range. Preview cells do NOT count as explored.

**Exploration:** Once a cell is explored, it stays explored forever (`exploredGridCells`, monotonic). Star systems are marked explored when their cell enters sensor range. Planets in system view are explored by fleet sensor range.

### 3.6 Combat — Strategic Layer

**Fleet-vs-Fleet battles:**
- Triggered by `StarMapBattleDetectionService` when two hostile fleets occupy the same galaxy grid cell.
- Neutral (team 0) fleets never fight. Same-team fleets never fight.
- The fleet with an active movement target is the attacker; the other is the defender.
- Each pair triggers only once (tracked by a `Set<string>` of sorted fleet-id pairs).

**Planet-vs-Fleet battles:**
- Triggered by `StarMapPlanetArrivalService` when a hostile fleet stops on a defended enemy planet (planet has defensive buildings or garrison).
- A virtual defense fleet is built from the planet's defense buildings (turrets become immobile ships; shield buildings contribute to a shared shield pool).

**Planet interactions:**
- **Uninhabited planet:** Fleet with a colonizer lands, colonizer is consumed, planet becomes owned.
- **Undefended enemy planet:** Captured immediately (flip `factionId`).
- **Same-faction/teammate planet:** Logged, ignored.
- **Shield-only planet:** No combat stacks → treated as undefended capture.

**Post-battle resolution:**
- Fleet battle: loser fleet marked `destroyed`; survivor roster (per-ship HP/destroyed) written back to the autosave slot.
- Planet battle: attacker wins → planet changes hands; defender wins → attacker fleet destroyed.
- Battle results accumulate via the autosave slot — no resurrection of destroyed fleets across save/load cycles.

### 3.7 Combat — Tactical Minigame

The battle screen (`/battle`) is a **self-contained turn-based tactical minigame** with its own 18×7 grid (4vw cells), AP system, and tactical AI. It receives two fleets via `BattleService`, deep-clones their ships, and returns a `BattleOutcome`. It never touches galaxy map, economy, production, or research state.

See [Battle Screen](./battle-screen.md) for full tactical rules.

**Key mechanics:**
- **AP system:** 50 AP per turn per side. Move costs vary by ship tier (1-5 AP/cell). Attack costs vary by tier (1-8 AP).
- **Stacks:** Ships of the same type group into stacks (max 5 per stack). All ships in a stack fire as a volley.
- **Damage:** `max(1, totalAttack - frontShip.defense)`, with overkill spilling to the next ship. Shield absorbs first, then hull HP.
- **Turn lifecycle:** Attacker turn → END TURN → Defender turn → END TURN → round++.
- **Tactical AI:** Non-player sides auto-play with a greedy attack→move→attack routine.
- **Animation lock:** A single `busy` counter blocks all input during movement/projectile/hit/explosion animations.

### 3.8 Economy System

**Resources:**
- **Stock (accumulated):** Credits (floored), Raw Materials (float), Research Points (float)
- **Flow (not stored):** Energy — used only to compute efficiency

**Income sources:**
- Building production (scaled by workforce efficiency and satisfaction)
- Population income: `population × 0.1` credits/s (scaled by satisfaction)

**Consumption:**
- Energy consumption from buildings (triggers ±1/s satisfaction drift if unmet)
- Building maintenance costs (credits/s)
- Ship maintenance costs (credits/s per non-destroyed ship)

**Efficiency model:**
- **Energy efficiency:** 1.0 if production ≥ consumption; otherwise `production / consumption`
- **Workforce efficiency:** `min(1, availableWorkforce / requiredWorkforce)` — scales building production only, not consumption or population income
- **Satisfaction multiplier:** `satisfaction / 100` — scales credit income only

**Satisfaction & morale:**
- Range: 0–100, default 100
- Drift per second (game time): `(energyDirection ±1 + habitabilityDrift + buildingMoraleBonus) × deltaTime`
  - Energy: -1 if energy < consumption, +1 if energy ≥ consumption
  - Habitability: earthlike/gasgiant = 0, marslike = -0.03, venuslike/desert = -0.05, ice = -0.08
  - Building morale: social buildings positive (+0.08 Entertainment Center, +0.03 Park), industry negative (-0.01 to -0.02)
- At 0% satisfaction: planet rebels → factionId set to 'independent' (same tick, before income)

### 3.9 Planet Population

- Grows continuously each 1-second economy tick: `0.005/s × satisfactionMultiplier × habitabilityMultiplier × (capacity - population) × deltaTime`
- Clamped to capacity (sum of residential building populations: Small 100 / Medium 300 / Large 700)
- Frozen when paused, 2× at speed 2×
- Independent planets (satisfaction locked at 0) never grow
- Population is a single float per planet — no individual citizens

### 3.10 Ship Production

**Flow:** Spaceship Factory → Production Order → Tick → Global Ship Stock

- One order per planet at a time (single production slot)
- Factory power: 0.5 progress/s per Spaceship Factory
- Build time: `shipType.buildTime / factoryPower` (default buildTime = `cost / 10`)
- Cost deducted up-front at queue time
- Ships added to faction-wide stock on completion
- Production gates: research-gated ship unlocks
- Stalled orders (factory destroyed) auto-cancel after 30s with proportional refund
- Production tick runs every frame, early-returns when paused (deltaTime ≤ 0)
- Progress, stock, and queue persist across saves

### 3.11 Fleet Assembly

**Triggers:** Fleet info panel "Reinforce" button, Spaceport panel "Create Fleet"

**Requirements:**
- Player must own at least one planet with a Spaceport building
- Ships are pulled from the empire-wide global stock (per-instance)
- Composition: typeId + count selection from available unlocked ships

**Actions:**
- **Create Fleet:** New fleet spawned at the host planet's system-grid cell
- **Reinforce:** Existing fleet receives ships from stock
- **Disband:** Fleet destroyed, surviving ships returned to stock, fleet marked `destroyed`

**Fleet properties:** Default speed 4, sensor range 3. Fleet ID is strictly greater than all existing fleet IDs.

### 3.12 Save System

**Slots:** 5 total (1 autosave slot 0 + 4 manual slots 1-4), stored in `localStorage` under `orion_save_slots`. Each slot is a full `StarMapData` snapshot with an ISO timestamp.

**Autosave triggers:**
- Entering/leaving systems
- Opening/closing planet view
- Opening pause menu
- Exiting to main menu
- Battle trigger (fleet and planet)
- Planet colonization/capture
- Component destroy

**Active session:** Always backed by the autosave slot. Loading a manual save copies it into autosave first. Speed is a runtime preference (not persisted).

**Migration:** Old saves without `shipStock`, `production`, `researchedTechnologies`, `resourceTiles`, or `ai` fields are backfilled automatically. Legacy vw-coordinate positions (map width 200) converted to grid cells.

### 3.13 Research Tree

**Data:** 18 technologies in `research-tree.json`, organized in a branching tree with prerequisites.

**Starting techs:** `basic_engineering`, `basic_science`, `basic_industry`, `basic_power` (all cost 0, no prerequisites)

**Branches:**
- **Engineering:** basic → advanced → orbital → shipyards (unlocks Corvette, Frigate, Cruiser, Carrier)
- **Military:** basic → military engineering → advanced weapons → capital ships (unlocks Destroyer, Battleship, Battlecruiser, Dreadnought)
- **Industry:** basic → advanced → applied manufacturing → urban infrastructure
- **Science:** basic → advanced → advanced research → applied science
- **Power:** basic → improved → fusion → advanced
- **Reconnaissance:** basic → scout, fighter, sensor upgrades

**Gates:** Research unlocks ships (via `isShipUnlocked`), buildings (via `isBuildingUnlocked`), and sensor range bonuses (via `getSensorRangeBonus`).

**UI:** `StarMapResearchTreeComponent` shows all technologies with status indicators (researched / available / locked). Clicking an available tech deducts research points and marks it researched.

### 3.14 Resource Deposits

**Generation:** Deterministic using Mulberry32 PRNG seeded by `planet.id × 4967297`. ~20% of planets selected via Fisher-Yates shuffle seeded by sum of all planet IDs. Each eligible planet gets 1 raw material tile (5% chance of a second).

**Rules:**
- Mining Complex buildings must be placed adjacent to (within 1 cell of) a resource tile
- Buildings cannot be placed directly on resource tiles
- Resource tile data persisted in `planet.resourceTiles`

### 3.15 Enemy AI

The AI pipeline is a layered system running every frame (respecting pause/speed via scaled delta time):

**Pipeline order:**
1. **V3 — Reactive Targeting** (`EnemyAiService`): Strength-based target selection. Categorizes player fleets as weak/comparable/strong based on `ratio = playerStrength / enemyStrength`. Prioritizes weak > comparable > strong, distance breaks ties. Commits to targets until invalidated (destroyed/empty).
2. **V4.1 — Strategy** (`EnemyStrategyService`): Evaluates every 2s. Decision order: DEFEND (player fleet within 5 cells of enemy planet) → ATTACK (player fleet within 15 cells, enemy 1.2× stronger) → EXPAND (fleet within 20 cells of unhabited planet) → DEVELOP (fallback).
3. **V4.2 — Goal** (`EnemyGoalService`): Selects concrete goals (colonize/attack/defend/develop) with specific targets. Committed until invalidated or strategy changes.
4. **V4.3 — Capability** (`EnemyCapabilityService`): Assesses whether the faction can currently pursue the goal (tech, ships, fleet, target validity, combat capability).
5. **V5 — Action** (`EnemyActionService`): Determines the next single action (produce_colonizer, produce_combat_ship, reinforce_fleet, create_fleet, assemble_fleet, move_to_target, colonize, attack, defend, develop).
6. **V5.1–V5.4 — Execution** (`EnemyActionExecutor`): Executes actions through existing game services:
   - `produce_colonizer`: queues a colonizer at the first factory planet
   - `produce_combat_ship`: queues the cheapest unlocked/affordable combat ship at the first factory planet
   - `reinforce_fleet`: replenishes a damaged/under-strength AI fleet from the global stock up to its peak strength; skips fleets that are engaged with an enemy
   - `create_fleet`: assembles a two-ship combat fleet at the nearest owned Spaceport when no usable combat fleet exists
   - `assemble_fleet`: moves a colonizer from stock into a fleet (reinforce or create new)
   - `move_to_target`: sets fleet movement target toward the goal target
   - `colonize`: colonizes unhabited planet at the fleet's grid cell
   - `attack`: validates same-cell engagement (battle detection handles actual battle start)
   - `defend`: validates fleet arrival at threatened system
   - `develop`: builds a building based on economy priority (energy → workforce → raw materials → research)

**AI factions:** Any faction with `ai: true` is controlled (dynamically derived from the factions array, replacing the old hardcoded enemy ID sets). Player and neutral factions are never modified by AI.

**Test coverage:** 230+ tests across all AI layers.

### 3.16 Input & UI

**Keyboard:**
- Arrow keys: camera pan
- Space: pause/resume
- 1/2: set speed to 1×/2×
- Escape: open pause menu

**Mouse/Touch:**
- Click: select objects, confirm actions
- Drag: camera pan (galaxy view), continuous pan (planet surface via d-pad)
- Double-click: not implemented

**Auto-pause:** Window blur, tab hidden, and portrait orientation trigger auto-pause (window blur/visibility only pause simulation; portrait shows overlay).

**Header HUD:** Title, time controls (⏸ 1× 2×), currency display, ship stock count, research tree button, sensor range toggle.

**Pause menu:** Overlay with save slots, load slots, and exit to main menu.

**Minimap:** 240×144 viewport showing explored systems and visible fleets. Click to pan camera.

---

## 4. Missing / Stub Features

| Feature | Status | Notes |
|---------|--------|-------|
| Diplomacy | ❌ | No diplomatic relations, treaties, or trade agreements. Team/faction is static. |
| Ship Design | ❌ | Ship types are fixed in JSON. No customship design, module fitting, or retrofit. |
| Missions/Objectives | ❌ | No quest system, victory conditions, or mission tracking. |
| Multiplayer | ❌ | Single-player only. No networking layer. |
| Audio | ❌ | No sound effects or music. |
| Options Screen | ❌ stub | `GameSettingsService` exists with `fogOfWarEnabled` toggle, but no UI for volume/graphics/other settings. |
| Save Metadata UI | ⚠️ partial | Slot dates are stored and displayed in the load menu, but no save slot rename/delete in UI (clearSlot exists in service). |

---

## 5. Known Limitations & Bugs

| # | Limitation | Impact | File(s) |
|---|-----------|--------|---------|
| 1 | School moraleRate = 0.01 | Very low compared to other social buildings; may be intentional or underpowered. | planet-data.json |
| 2 | Winner survivor roster does not persist per-ship | Battle outcome only writes back ship HP/destroyed flags and fleet wipedOut flag; fleet position is not updated after battle | star-map.ts |
| 3 | Single factory type | Only one Spaceship Factory building exists; no Small/Medium/Large factory tiers. `orbital_factory` is defined as a type but no building produces it. | planet-data.json, ship.service.ts |
| 4 | Develop action uses first-match building | AI building selection is first-match in planet-data.json order, no strategic scoring for placement. | enemy-action-executor.service.ts |
| 5 | No enemy fleet reinforcement | AI produces colonizers but does not produce combat ships or reinforce fleets from conquered planets. | enemy-action-executor.service.ts |
| 6 | Debug console.log statements | Many `console.log` debug statements remain in production code. | Throughout |
| 7 | No fleet re-supply / repair | Ships do not heal between battles; no repair facilities. | — |
| 8 | No trade routes / logistics | No inter-planet resource transfer; each planet is self-contained. | — |
| 9 | No victory conditions | Game has no win state; plays indefinitely. | — |

---

## 6. Technology Tree Overview

### Ship Unlocks

```
basic_engineering → Scout, Fighter, Colonizer
advanced_engineering → Corvette, Frigate
military_engineering → Destroyer
orbital_engineering → (prerequisite only)
advanced_shipyards → Cruiser, Carrier
advanced_weapons → (prerequisite only)
capital_ship_technology → Battleship, Battlecruiser, Dreadnought
scout_technology → Scout
fighter_technology → Fighter
corvette_technology → Corvette
frigate_technology → Frigate
destroyer_technology → Destroyer
cruiser_technology → Cruiser
carrier_technology → Carrier
colonization_technology → Colonizer
```

### Building Unlocks

```
basic_engineering → Spaceship Factory, Spaceport, Laser Turret, Missile Turret
basic_science → Small Research Laboratory
basic_industry → Small Residential Block, Mining Complex
basic_power → Solar Array
advanced_construction → Medium Residential Block
military_engineering → Planetary Shield, Hospital, School
advanced_industry → Entertainment Center, Park
fusion_power → Fusion Power Plant
advanced_research → Research Laboratory
urban_infrastructure → Large Residential Block
```

### Sensor Bonuses

```
basic_radar → +1 sensor range
advanced_radar → +1 sensor range (cumulative +2)
long_range_radar → +1 sensor range (cumulative +3)
```

---

## 7. Data Files

| File | Contents |
|------|----------|
| `star-map-data.json` | Initial galaxy: 14 star systems, 35 planets, 4 fleets, 5 factions, map config, default view |
| `ship-data.json` | 11 ship types with full stats (HP, attack, defense, speed, range, cost, maintenance) |
| `planet-data.json` | 17 building types with full stats (production, consumption, energy, workforce, morale, defense) |
| `research-tree.json` | 18 technologies with prerequisites, unlocks, and bonuses |

### Starting Resources
- 1,000 credits, 1,000 raw materials, 1,000 research points
- 4 starting technologies: basic_engineering, basic_science, basic_industry, basic_power

### Starting Factions
- **Player** (team 1, blue): starts at SOL with developed Earth
- **Enemy 1** (team 2, red, AI): starts with RAIDER fleet at distance
- **Enemy 2** (team 2, teal, AI): starts with HUNTER fleet at distance
- **Independent** (team 0, yellow): neutral, non-AI
- **Unhabited** (team 0, grey): no faction, no AI

---

## 8. Test Coverage Summary

| Module | Tests | Key Coverage |
|--------|-------|--------------|
| Game time service | 28 | Speed, pause, delta scaling, elapsed time |
| Sensor service | 11 | Range computation, fog layers, preview rings, fleet visibility |
| Resource deposits | 10 | Deterministic generation, selection, placement |
| Economy service | 34 | Habitability drift, workforce efficiency, population growth, pause/speed |
| Battle state | 8 | No input mutation, stack grouping, deployment |
| Battle grid | 9 | Bounds, distance, range, pathfinding, occupancy |
| Battle ship stats | 8 | All 13 ship tiers, stat resolution, unknown type fallback |
| Battle turn | 6 | Turn flip, AP reset, victory detection, animation blocking |
| Battle movement | 7 | AP cost, range cap, path blocking, animation lock |
| Battle combat | 9 | Damage formula, overkill spill, stack destruction, effect lifecycle |
| Battle animation | 6 | Busy counter, tick emission, reset |
| Battle AI | 5 | Attack/move/attack phases, end turn, immobile skip |
| Battle result | 5 | Input order, final HP, winners/losers, planet ID carry |
| Enemy AI (V3) | 21 | Target selection, strength priority, retargeting, pause safety |
| Enemy Strategy (V4.1) | 18 | Strategy selection, priority ordering, determinism |
| Enemy Goal (V4.2) | 27 | All goal types, commitment, invalidation, multi-faction |
| Enemy Capability (V4.3) | 25 | All capability checks, edge cases, reset |
| Enemy Action (V5) | 23 | Action types, preparation vs execution, edge cases |
| Enemy Action Executor (V5.1–V5.4) | 76 | All action executions, guards, building selection |
| Star Map component | 15 | Component creation, AI game-loop integration |
| Research service | 28 | Tech tree, status, research, unlocks, sensor bonus |
| Save game service | 5 | Slot persistence, migration (ai flag, researchedTechnologies) |
| Planet screen | 11 | Resource tile detection, building placement validation |

**Total:** ~335 tests (334 passing, 1 pre-existing unrelated failure)

---

## 9. Feature Dependencies & Roadmap Notes

### Critical Gaps Preventing Deeper Gameplay

1. **No combat ship production for AI** — AI only produces colonizers. Enemy fleets never grow or replace losses. This limits the strategic depth of conflict.
2. **No victory conditions** — The game has no win/lose state. Players can expand indefinitely with no endpoint.
3. **No diplomacy** — Enemy factions are permanently hostile. No option for alliances, trade, or tribute.
4. **No ship design** — All ship types are fixed. No customization or tech-driven upgrades to ship stats.
5. **Research Laboratory morale bug** — `moraleRate: 1` on research labs makes them effectively social buildings, which is likely unintended.
6. **Fleet tactics post-battle** — Winner survivor roster does not persist per-ship; fleet position not updated after battle

### Features Ready for Extension

- **Game time system** is designed for additional speeds (0.5×, 4×, 8×) — just extend the `GameSpeed` union type.
- **Production system** has `productionBuilding` discriminator supporting `orbital_factory` — just add the building type and ships.
- **Research tree** is fully data-driven — new techs added via JSON only.
- **Battle minigame** has weapon type effectiveness table and shield fields already in place — wiring them up is additive.
- **Save system** backfills optional fields — new data structures can be added with migration logic.

### Next Priority Areas (Designer Decision)

| Area | Current State | What's Needed |
|------|--------------|---------------|
| Victory conditions | ❌ | Define win/lose conditions, mission system |
| AI combat production | ✅ | `produce_combat_ship` queues the cheapest unlocked/affordable combat ship at a factory planet |
| AI fleet reinforcement | ✅ | `reinforce_fleet` / `create_fleet` replenish AI fleets from global stock via `FleetAssemblyService` |
| Diplomacy | ❌ | Faction relation system, trade, treaties |
| Ship design | ❌ | Custom ship construction, module system |
| Fleet tactics post-battle | ⚠️ | Persist fleet positions, apply repair, survivor roster |
| Orbital factories | ⚠️ | Add Orbital Factory building, ships requiring it |

---

*See also: [Architecture](./architecture.md), [Game Systems](./game-systems.md), [Battle Rules](./battle-rules.md), [Battle Screen](./battle-screen.md), [Data Models](./data-models.md), [Game Time](./game-time.md), [Ship Production](./ship-production.md), [Invariants](./invariants.md), [UI Styling](./ui-styling.md), [Game-State (Hungarian)](./game-state.md)*

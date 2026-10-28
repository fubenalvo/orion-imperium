# Battle Screen — Tactical Minigame Documentation

## Overview

The Battle Screen is a **fully self-contained real-time tactical combat minigame** that runs at the `/battle` route. It receives two fleets via the `BattleService` transport boundary, runs a speed-based tactical simulation on a 38×16 grid (72vw × 28vw), and returns a `BattleOutcome` with surviving/destroyed ships. It **never touches StarMap strategic state** — no fleet movement, economy, AI strategy, production, or research.

Gameplay rules (grid, reach, fire cadence, orders, targeting modes, AI) are specified in [Battle Rules](./battle-rules.md); this document covers the implementation structure.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        STAR MAP (Strategic)                     │
│  ┌──────────────┐    BattleService.setBattle(Battle)            │
│  │ StarMap      │ ──────────────────────────────────►           │
│  │ Component    │                                               │
│  └──────────────┘                                               │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Battle transport object
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BATTLE SCREEN (Tactical)                   │
│  ┌─────────────────┐                                           │
│  │ BattleScreen    │  Orchestrator: builds local state,        │
│  │ Component       │  forwards input to services, writes       │
│  └────────┬────────┘  BattleOutcome on "Back to Star Map"     │
│           │                                                        │
│   ┌───────┼───────┐                                              │
│   ▼       ▼       ▼                                              │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│ │State│ │Grid │ │Game  │ │Move │ │Cmbt │ │Anim │                  │
│ │Fact.│ │Geom.│ │Loop │ │Svc  │ │Svc  │ │Svc  │                  │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                │
│                                                                  │
│  ┌─────────────┐  ┌────────────┐                                │
│  │ BattleGrid  │  │ FleetPanel │  ← Presentational children    │
│  │ Component   │  │ Component  │                                │
│  └─────────────┘  └────────────┘                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │ BattleOutcome
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        STAR MAP (Strategic)                     │
│  ┌──────────────┐    BattleService.getBattleResult()            │
│  │ StarMap      │ ◄──────────────────────────────────           │
│  │ Component    │  reloadAfterBattle() → applyBattleResult()    │
│  └──────────────┘  (writes to AUTOSAVE slot)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/app/components/battle-screen/
├── battle-screen.component.ts      # Orchestrator component
├── battle-screen.component.html    # Template
├── battle-screen.component.scss    # Styles
├── battle-screen.component.spec.ts # Tests
├── battle-grid/
│   ├── battle-grid.component.ts    # Grid view (clicks, highlights, effects)
│   ├── battle-grid.component.html
│   ├── battle-grid.component.scss
│   └── battle-grid.component.spec.ts
├── battle-fleet-panel/
│   ├── battle-fleet-panel.component.ts   # Side roster panel
│   ├── battle-fleet-panel.component.html
│   ├── battle-fleet-panel.component.scss
│   └── battle-fleet-panel.component.spec.ts
└── battle/
    ├── battle.types.ts             # Core types, constants, interfaces
    ├── battle-state.ts             # State factory (createBattleState)
    ├── battle-grid.ts              # Pure grid math (bounds, distance, paths)
    ├── battle-game-loop.service.ts # RAF loop (raw real-time delta)
    ├── battle-movement.service.ts  # Grid movement (vw-based targeting)
    ├── battle-combat.service.ts    # Fire control (all stacks), attack resolution, Shield Pulse
    ├── battle-targeting.ts         # Fire-target selection: manual order, sticky target, modes
    ├── battle-animation.service.ts # Per-stack animation lock
    ├── battle-time.service.ts      # Battle-local clock (pause / speed, frame-driven waits)
    ├── battle-ai.service.ts        # Tactical AI (movement + Shield Pulse) for enemy side / AUTO
    ├── battle-test-clock.ts        # Test-only: drives the battle clock from fake timers
    ├── battle-result.ts            # BattleOutcome builder
    ├── battle-ship-stats.ts        # Ship stats from ShipService
    ├── *.spec.ts                   # Tests for each module
```

---

## Core Types (`battle.types.ts`)

### Constants
```typescript
BATTLE_FIELD_WIDTH_VW = 72, BATTLE_FIELD_HEIGHT_VW = 28   // Fixed battlefield size
BATTLE_GRID_COLUMNS = 38, BATTLE_GRID_ROWS = 16           // Grid density (cells)
BATTLE_CELL_WIDTH_VW = 72 / 38, BATTLE_CELL_HEIGHT_VW = 28 / 16
BATTLE_RANGE_UNIT_VW = 3.5         // vw per unit of the `range` stat (grid-independent)
ATTACK_RANGE_TOLERANCE = 1         // Extra reach in range units for the canAttack gate
MAX_STACK_SIZE = 5                 // Max ships per stack
ATTACKER_DEPLOY_COLS = [1, 3, 5, 7]       // Attacker slot columns (outer edge first)
DEFENDER_DEPLOY_COLS = [38, 36, 34, 32]   // Defender slot columns (outer edge first)
DEPLOY_ROW_ORDER = [8, 6, 10, 4, 12, 2, 14]
ANIMATION_MS = { move: 90, projectile: 160, hit: 100, explosion: 210 }
AI_ACTION_INTERVAL_MS = 400        // AI / AUTO decision tick
AI_ACTION_COOLDOWN_MS = 1000       // Per-stack AI re-plan cooldown
MOVE_REPLAN_INTERVAL_MS = 150      // Chase re-planning + manual order upkeep
FIRE_RATE_MULTIPLIER = 1.0         // Volley interval = 1000 / fireRate ms × this
SHIELD_REGEN_INTERVAL_MS = 2000    // Shield regeneration tick
BATTLE_DEBUG_LOG = false           // Enables battleDebug() console traces
```

The SCSS (`battle-grid.component.scss` `--cell-w`/`--cell-h`, `battle-planet.component.scss`)
derives cell sizes from the same 72/38 and 28/16 numbers; keep them in sync with the constants.

### Key Interfaces

```typescript
// Tactical unit — what moves, attacks, gets selected
interface BattleStack {
  stackId: string;           // e.g. "attacker:fighter:0"
  side: 'attacker' | 'defender';
  typeId: string;            // Ship type ID (scout, fighter, etc.)
  typeName: string;          // Display name
  role: string;              // Ship role (used by 'balanced' targeting)
  col: number;               // Anchor grid column (1-38)
  row: number;               // Grid row (1-16)
  size: number;              // Cells occupied in the row (1-3, by tier)
  ships: BattleShip[];       // Individual ships in this stack
  tier: number;              // Tier 1-5 (ship size)
  speed: number;             // Movement speed in VW/s (1-5 from ShipType.speed)
  attackRange: number;       // Attack range in range units (from ship.range)
  fireRate: number;          // Volleys per second
  immobile: boolean;         // True for planet defenses (they still fire)
  moving: boolean;           // Animation flags
  firing: boolean;
  destroyed: boolean;
  // Real-time movement fields (VW coordinates)
  x: number;                 // Current VW position (center of stack)
  y: number;
  targetX: number | null;    // Target VW position (null = stationary)
  targetY: number | null;
  // Orders and targeting (battle-local, never persisted)
  explicitAttackTargetId?: string | null; // Manual attack order
  manualMoveOrder?: boolean;              // Manual move in flight (AUTO keeps out)
  moveToAttackTargetId?: string | null;   // Stack being chased
  targetingMode?: BattleTargetingMode;    // 'balanced' | 'strongest' | 'weakest' | 'firepower'
  autoTargetId?: string | null;           // Sticky automatic target
  attackCooldownUntil?: number;           // Fire cooldown (battle ms)
  actionCooldownUntil?: number;           // AI re-plan cooldown (battle ms)
}

// Individual ship — HP tracked per ship, not per stack
interface BattleShip {
  shipId: number;            // Original FleetShip.id (for result mapping)
  name: string;
  typeId: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  alive: boolean;
}

// Complete simulation state
interface BattleModelState {
  round: number;             // Shield-regen tick counter
  stacks: BattleStack[];
  log: BattleLogEntry[];
  effects: BattleAttackEffect[];      // In-flight projectile/impact/explosion, one per firing stack
  winner: 'attacker' | 'defender' | null;
  // Fleet identity for result mapping
  attackerFleetId: number;
  defenderFleetId: number;
  attackerFactionId: string;
  defenderFactionId: string;
  attackerName: string;
  attackerColor: string;
  defenderName: string;
  defenderColor: string;
  battleType: 'fleet' | 'planet';
  planetId?: number;
  // Full rosters in input order (stacks reference same BattleShip objects)
  attackerShips: BattleShip[];
  defenderShips: BattleShip[];
}

// Transport input (from StarMap)
interface Battle {
  fleet1: BattleFleet;   // { id, name, factionId, ships: FleetShip[] }
  fleet2: BattleFleet;
  faction1Name: string;
  faction1Color: string;
  faction2Name: string;
  faction2Color: string;
  attackerId: number;    // Fleet ID of attacker
  defenderId: number;    // Fleet ID of defender
  type?: 'fleet' | 'planet';
  planetId?: number;
}

// Transport output (to StarMap)
interface BattleOutcome {
  winnerSide: 'attacker' | 'defender';
  winnerFleetId: number;
  loserFleetId: number;
  attacker: BattleFleetOutcome;  // { fleetId, side, factionId, ships[], survivors[], wipedOut }
  defender: BattleFleetOutcome;
  rounds: number;
  battleType: 'fleet' | 'planet';
  planetId?: number;
}
```

---

## Battle Flow

### 1. Entry (StarMap → BattleScreen)

**Trigger:** `StarMapBattleDetectionService.checkForBattles()` detects hostile fleets on same galaxy cell, or `StarMapPlanetArrivalService` detects fleet arriving at defended enemy planet.

```typescript
// StarMap calls:
this.battleService.setBattle({
  fleet1, fleet2,           // Full fleet objects (ships included)
  faction1Name, faction1Color,
  faction2Name, faction2Color,
  attackerId, defenderId,   // Determined by who was moving
  type: 'fleet' | 'planet',
  planetId?: number
});
this.router.navigate(['/battle']);
```

**BattleScreenComponent.ngOnInit():**
```typescript
this.battle = this.battleService.getBattle();
this.state = createBattleState(this.battle, shipService, planetBattleService);
// 1. Deep-clone both fleets' ships → BattleShip[] (never mutates originals)
// 2. Group by side + typeId → stacks (one per ship up to 28 ships, else max 5 ships each)
// 3. Deploy: occupancy-aware slots — attacker cols 1,3,5,7, defender cols 38,36,34,32,
//    rows centre-out from 8; immobile turrets first
// 4. Initialize VW positions (x, y) centered on each stack's footprint
// 5. Start RAF game loop
```

### 2. State Factory (`createBattleState`)

```typescript
// 1. Identify attacker/defender fleets from battle.attackerId/defenderId
// 2. toBattleShip(): Clone each FleetShip → BattleShip with stats from ShipService
//    - HP = shipType.hitPoints (full hull at battle start)
//    - attack/defense from ship type
//    - tier from TIER_LOOKUP (cost-based fallback); size = 1 / 2 / 3 cells by tier
// 3. buildStacks(): ≤ 28 ships → one stack per ship; otherwise group by typeId into
//    chunks of MAX_STACK_SIZE (5). targetingMode defaults to 'balanced'.
// 4. deploySide(): occupancy-aware placement for both sides
//    - immobile stacks first (outer slot column), then mobile stacks
//    - columns from the side's edge inward, rows DEPLOY_ROW_ORDER (centre-out)
//    - fallback: first free cell scanning inward from the edge
// 5. initializeStackPositions(): Set x/y to the VW centre of each stack's footprint
// 6. Return BattleModelState
```

### 3. Real-Time Game Loop

`BattleGameLoopService` runs requestAnimationFrame outside the Angular zone. Each frame it
advances `BattleTimeService` with the real delta (clamped to 0.1 s) and calls
`BattleScreenComponent.gameLoopCallback(scaledDelta)` — scaled by battle speed, 0 when paused.

`gameLoopCallback` (all accumulators use battle time):
```typescript
updateStackPositions()                         // every frame
ai.playAction(state)          every 400 ms     // enemy side: movement / Shield Pulse
ai.playAction(state, true)    every 400 ms     // AUTO only: player side, skips manual orders
movement.maintainAttackOrders()  every 150 ms  // re-chase out-of-reach manual targets
movement.updateMoveToAttackTargets() every 150 ms // re-plan chasing destinations
combat.runFireControl()                        // every frame, every stack, both sides
regenerateAllShields()        every 2000 ms
checkVictory(); anim.tick()                    // always, so the result overlay appears
```

### 4. Player Input and Orders

Orders are plain state changes on the stack (there is no command queue), so they apply
instantly — also while paused — and several stacks can be ordered during one pause.

1. **Click own stack** → `selectedStackId` set. Selection is UI-only and never changes any
   stack's orders. The panel shows the stack's order status and its TARGET mode buttons.
2. **Click a cell** → `orderMove()` → `BattleMovementService.moveStack()`. On success clears the
   attack order and sets `manualMoveOrder`; on failure shows "PATH BLOCKED" and keeps the
   previous order.
3. **Click an enemy** → `orderAttack()` → sets `explicitAttackTargetId`; starts a chase if the
   target is out of reach (or stops a running move if it is in reach). Fire control does the
   shooting on its normal cadence.
4. **TARGET buttons** → `setSelectedTargetingMode()` → `setTargetingMode()` (drops the sticky
   automatic target).

Grid feedback for the selected stack: range ring (effective reach), red pulse on enemies in
reach, gold outline on its manual target, red dashed line to its attack/chase target, blue
dashed line to its move destination.

### 5. Movement (`BattleMovementService.moveStack`)

```typescript
async moveStack(state, stackId, targetCol, targetRow): Promise<boolean>
1. Validate: stack exists, not destroyed, not immobile, not already at target
2. Check bounds (1-38, 1-16)
3. Check: isPathClear(path, stack)  // straight line, footprint-aware, no distance limit
4. Set VW target (targetX, targetY = centre of the destination footprint)
5. Set stack.moving = true (col/row update on arrival)
6. Return true (game loop handles VW interpolation)

async moveToAttack(state, stackId, targetStackId): Promise<boolean>
- already in reach → true, no movement
- findBestMoveToAttackCell() ?? findApproachCell() → moveStack(); sets moveToAttackTargetId
- false only when no progress is possible

maintainAttackOrders(state)   // re-issues moveToAttack for out-of-reach manual targets
stopStack(state, stackId)     // settles a moving stack on the nearest free cell
```

Grid searches (`getReachableCells`, `getMoveToAttackCells`, `findBestMoveToAttackCell`,
`findApproachCell`) build an `OccupancyMap` once per search; the best-cell searches rank
candidates first and trace straight-line paths only until the first reachable one.

### 6. Combat (`BattleCombatService.attackStack`)

```typescript
runFireControl(state)   // every frame
for each living stack (both sides, turrets included):
  clear orders/sticky targets that point at destroyed stacks
  skip if fire cooldown not elapsed, a volley is in flight, or no ship has attack
  target = selectFireTarget(state, stack)   // battle-targeting.ts
  if target: attackCooldownUntil = now + 1000 / fireRate; attackStack(...)

async attackStack(state, attackerStackId, targetStackId): Promise<boolean>
1. Validate: both stacks exist, alive, opposite sides, no winner yet
2. Reach check: canAttack() — absolute x/y distance ≤ (attackRange + 1) × BATTLE_RANGE_UNIT_VW
3. Animation sequence via anim.run():
   a) PROJECTILE (320ms): state.effect = { phase: 'projectile', from, to, targetStackId }
      attacker.firing = true; tick(); wait(320ms);
   b) DAMAGE CALCULATION:
      totalAttack = Σ alive ships in attacker stack .attack
      front = first alive ship in target stack
      damage = max(1, totalAttack - front.defense)
      for (ship of target.ships) if alive:
         applied = min(ship.hp, remaining)
         ship.hp -= applied; remaining -= applied
         if ship.hp ≤ 0: ship.hp = 0; ship.alive = false; kills++
      if all ships dead: target.destroyed = true
   c) LOG: push BattleLogEntry { round, side, attackerStack, defenderStack, damage, kills }
   d) IMPACT/EXPLOSION (200/420ms): state.effect = { phase: 'impact'|'explosion', ... }
      tick(); wait(200 or 420ms);
   e) CLEANUP: state.effect = null; attacker.firing = false; checkVictory(); tick()
4. Return true
```

**Damage Model:**
- **Stack volley**: All alive ships in stack fire once per attack
- **Defense**: Only the front (first alive) target ship's defense applies
- **Formula**: `damage = max(1, totalAttack - front.defense)`
- **Spillover**: Remaining damage continues to next ship in stack
- **No RNG**: Fully deterministic
- **Shields/weapon types**: Loaded from data and applied in `BattleCombatService.attackStack()` and `BattleAiService`. Shield absorbs before hull for immobile targets; weapon effectiveness scales via `attackType` vs `weakness`. See [Battle Rules](./battle-rules.md) §Combat.

### 7. Animation Lock (`BattleAnimationService`)

Animations are tracked **per stack** (`begin(stackId)` / `end(stackId)` / `isStackBusy`), plus a
global `isBusy` count. `run(fn, stackId)` balances begin/end even if `fn` throws.
`wait(ms)` delegates to `BattleTimeService.wait()` (battle time: frozen while paused).

- `isStackBusy` keeps a stack from starting a second volley while one is in flight, and blocks
  Shield Pulse for that Carrier only.
- `isBusy` (any animation) is used only by `showBattleResult`, so the result overlay appears
  after the final volley's animation. Player input is never blocked by animations.

### 8. AI (`BattleAiService.playAction`)

```typescript
async playAction(state, controlPlayerSides = false):
for each stack of the controlled side (enemy side, or player side for AUTO):
  skip if immobile, moving, on AI cooldown, or holding a manual order
  1. Carrier with an ally < 50% shield in reach → Shield Pulse
  2. Any enemy in reach → hold (fire control shoots)
  3. Else moveToAttack(nearest enemy)
  on any command → actionCooldownUntil = now + AI_ACTION_COOLDOWN_MS
```
- Deterministic, greedy; never fires; no strategic knowledge.
- Planet defense buildings (`immobile: true`) never move.

### 9. Result overlay

`BattleScreenComponent` derives the final `BattleOutcome` from the finished
`BattleModelState` and renders it as a modal overlay on `/battle` after the
final combat animation completes. The overlay sits above the tactical grid and
controls, dims the background, and prevents further battle input.

The result summary is aggregate-only:

- winner fleet name and side
- fleet or planet battle type
- planet result (`CAPTURED` or `DEFENDED`) for planet battles
- round count
- both fleet names
- surviving ships / total ships per side
- losses per side

The modal has a scrollable summary area and a fixed footer containing the only
close action, `BACK TO STAR MAP`. Clicking the backdrop or pressing Escape does
not dismiss it. The button keeps the existing persistence and navigation
contract described in the next section.

### 10. Exit (BattleScreen → StarMap)

**BattleScreenComponent.backToStarMap():**
```typescript
const outcome = buildBattleOutcome(this.state);
this.battleService.setBattleResult(outcome);

if (planet battle) {
  if (defender wins) setDestroyedFleetId(attacker.fleetId);
} else {
  setDestroyedFleetId(outcome.loserFleetId);  // Real fleet wiped out
}

if (planet) applyPlanetBattleResult(battle, outcome);  // Changes planet.factionId
else persistFleetBattleResult(outcome);  // Writes ship rosters to AUTOSAVE

this.router.navigate(['/star-map']);
```

**StarMap.reloadAfterBattle():**
```typescript
loadGame();  // Loads AUTOSAVE slot (cumulative)
removeDestroyedFleetFromService();
applyBattleResult(outcome):
  for each fleet in outcome:
    fleet.ships = outcome.ships.map(s => ({ id: s.shipId, name, type: s.typeId, currentHp: s.hp, destroyed: s.destroyed }))
    if wipedOut: fleet.destroyed = true
saveGame();  // Persists to AUTOSAVE
```

---

## Grid Geometry (`battle-grid.ts`)

| Function | Purpose |
|----------|---------|
| `isInBounds(col, row)` | 1 ≤ col ≤ 38, 1 ≤ row ≤ 16 |
| `cellDistance(a, b)` | Euclidean √(dc²+dr²) in cells |
| `isInRange(a, b, range)` | Grid-only helper: `dc²+dr² ≤ range²` (inclusive at exact range) |
| `absoluteDistanceVw(a, b)` | Euclidean distance between current absolute VW positions |
| `absoluteDistanceRangeUnits(a, b)` | Absolute distance in range units (÷ `BATTLE_RANGE_UNIT_VW`) |
| `isAbsolutePositionInRange(a, b, range)` | `distanceVw ≤ range × BATTLE_RANGE_UNIT_VW` |
| `effectiveAttackRange(stack)` / `canAttack(a, t)` | Authoritative reach: `attackRange + ATTACK_RANGE_TOLERANCE` |
| `linePath(from, to)` | Straight-line cells (Bresenham-ish) excluding origin |
| `isOccupied` / `isCellReserved` | Static footprint occupancy / in-flight destination reservation |
| `buildOccupancyMap(state, excludeId)` | One-shot occupancy + reservation snapshot for grid searches |
| `isPathClear(state, path, stack)` | Footprint-aware path check (destination also not reserved) |
| `cellToVw(cell)` | Centre of a cell in vw |
| `stackCenterVw(stack)` | VW centre of a stack's footprint |
| `vwToStackCell(stack, x, y)` | Convert VW coordinates to the stack's anchor cell |
| `getReachableCells(state, stack)` | Cells with a clear straight path (no distance limit) |
| `getAttackTargetIds(state, stack)` | Enemy stacks in reach |
| `getMoveToAttackCells(state, stack, target, range?)` | Reachable cells with the target in range |
| `findBestMoveToAttackCell(state, stack, target)` | Best firing cell (ally spread → cost → target distance) |
| `findApproachCell(state, stack, target)` | Fallback: reachable cell strictly closer to the target |
| `computeTargetScore(attacker, target, dist)` | 'balanced' targeting score |
| `checkVictory(state)` | Returns winner side or null |
| `regenerateAllShields(state)` | Restore all shield sides by regen amount |
| `updateStackPositions(state, deltaTime)` | Move stacks VW toward targets at speed |

---

## Planet Battles

- Same minigame, `battle.type === 'planet'`
- Defender fleet built by `PlanetBattleService` from planet's defense buildings
- Virtual ships: `immobile = true`, stats from `planet-data.json`
- Attacker wins → planet.factionId = attacker.factionId (in `applyPlanetBattleResult`)
- Virtual defender fleet (negative ID) never persists
- Attacker ship roster always written back (damaged winner returns damaged)

---

## Save/Load Behavior

- **Only AUTOSAVE slot (0)** used for battle persistence
- Battle result written to AUTOSAVE in `backToStarMap()` → `persistFleetBattleResult()` / `applyPlanetBattleResult()`
- `reloadAfterBattle()` loads same AUTOSAVE → cumulative fleet destructions persist
- **No tactical state saved** (grid positions, animations) — battle is a temporary minigame

---

## Battle-Local Time Controls

The battle minigame has its own independent time control system (`BattleTimeService`) with pause/1x/2x buttons in the battle header, mirroring the Star Map header. The global `GameTimeService` remains paused while on `/battle` and is not affected by battle controls.

**API (`BattleTimeService`):**
```typescript
type BattleSpeed = 0.625 | 1.25;   // shown as "1x" / "2x"; 0.625 is the default pace

state$: BehaviorSubject<{ speed: BattleSpeed; isPaused: boolean; battleElapsedTime: number }>
// BehaviorSubject: BattleScreenComponent subscribes with skip(1) so the synchronous replay
// does not run change detection before the view exists.

get speed(): BattleSpeed
get isPaused(): boolean
get battleElapsedTime(): number   // accumulated simulation seconds
get battleElapsedMs(): number     // battleElapsedTime * 1000

setSpeed(speed: BattleSpeed): void   // sets speed, un-pauses
pause(): void                        // freezes simulation, preserves speed
resume(): void                       // un-pauses, preserves speed
togglePause(): void                  // flips pause state

getScaledDeltaTime(realDeltaTime: number): number  // 0 if paused, else realDelta * speed
onTick(realDeltaTime: number): void                // accumulates battleElapsedTime, advances frame-driven waits
reset(): void                                      // speed=1, isPaused=false, elapsed=0, cancels pending waits
```

**Frame-Driven Wait Scheduler:**
- `BattleTimeService.wait(durationMs)` returns a Promise resolved by the frame-driven scheduler
- `onTick()` advances all pending waits by the scaled delta time
- Works with pause/speed: waits don't advance when paused, advance 2× at 2× speed
- No `setTimeout`/`setInterval` — deterministic under test by calling `onTick()`

**What Is Affected by Battle Time:**
| System | Affected? | Notes |
|--------|-----------|-------|
| Stack movement | Yes | `updateStackPositions` receives scaled delta |
| AI / AUTO ticks | Yes | Accumulator uses scaled delta |
| Shield regeneration | Yes | Accumulator uses scaled delta |
| Re-planning (chase + manual order upkeep) | Yes | Accumulator uses scaled delta |
| Fire cooldowns, AI cooldowns | Yes | Stored as battle-elapsed ms, frozen when paused |
| Animation waits (`anim.wait()`) | Yes | Delegates to `BattleTimeService.wait()` |

**What Is NOT Affected by Battle Time:**
| System | Reason |
|--------|--------|
| Global `GameTimeService` | Remains paused; battle controls don't modify it |
| `moveFailedUntil` hint | Wall-clock `performance.now()` for UI feedback |
| CSS animations | Background starfield, sensor pulse — pure CSS |

**Orders while paused:**
- There is no command queue. Move and attack orders are stored on the stack immediately and
  take effect when the simulation resumes, so any number of stacks can be ordered during a pause.
- Shield Pulse applies immediately (it is an instant shield change) and starts the Carrier's
  fire cooldown, which only runs down after resuming.

**Header Controls:**
- **⏸** — `battleTime.togglePause()`; active when paused
- **1x** — `setSpeed(0.625)`; **2x** — `setSpeed(1.25)`; dimmed when paused
- **AUTO** — toggles AUTO battle (player side AI for stacks without manual orders)

---

## Control Summary (Player)

| Action | How | Requirements |
|--------|-----|--------------|
| Select stack | Click own unit | — (never changes orders) |
| Move | Click a free cell | Stack selected, clear straight path |
| Attack order | Click any enemy | Stack selected; out-of-reach targets are chased |
| Targeting mode | TARGET buttons in the selection panel | Own stack selected |
| Shield Pulse | SHIELD PULSE button | Carrier selected, stationary, off cooldown, ally missing shield |

**Visual Feedback:**
- **Friend / foe** (fixed scheme, independent of faction colors; `playerSides` input on the grid):
  own stacks have blue corner brackets, blue hover and a pointer cursor; enemy stacks have a
  red chevron above them, red hover and a crosshair cursor. Buttons carry an
  `aria-label` of "Friendly …" / "Enemy …".
- **Selected stack**: Bright blue border + glow, dashed range ring showing effective reach
- **Enemies in reach**: Red pulsing border + glow
- **Manual attack target**: Gold outline; red dashed line from the stack
- **Move destination**: Blue dashed line
- **Order status** (panel): ATTACKING / CHASING / MOVING / AUTO TARGET
- **Firing**: recoil animation; **Projectile**: red line; **Impact**: white/red flash;
  **Explosion**: yellow/orange ring

---

## Test Coverage

| Module | Key Coverage |
|--------|--------------|
| `battle-state.spec.ts` | No input mutation, stack grouping, slot deployment (38×16), centre-out rows, no overlap of wide stacks on either side, turrets outermost, stat resolution |
| `battle-grid.spec.ts` | Grid bounds (38×16), physical range unit, reach tolerance, linePath, occupancy / reservations, reachable cells, attack targets, move-to-attack cells, approach fallback |
| `battle-targeting.spec.ts` | All four modes, tie-breaks, invalid targets, manual priority, opportunistic fire, sticky target, mode change, planetary shield durability |
| `battle-combat.service.spec.ts` | Damage formula, shields, weapon matchup, effects lifecycle, fire-control cadence (both sides), turrets fire, dead-order cleanup, simultaneous kills, no fire after victory, pause freezes cooldowns, Shield Pulse gating/cooldown |
| `battle-ai.service.spec.ts` | Holds when in reach (never fires), moves toward enemies, every idle stack per tick, determinism, immobile skipped, AUTO drives player side only and skips manual orders |
| `battle-movement.service.spec.ts` | Moves, bounds/occupancy, re-planning while chasing |
| `battle-screen.component.spec.ts` | Frame-stepped integration: equal cadence, order persistence across selection, chase + opportunistic fire, order cleared on kill, order replacement, AUTO vs manual, pause, targeting mode UI, turrets fire, full battles complete (AUTO on/off), persistence/outcome |
| `battle-animation`, `battle-ship-stats`, `battle-result`, grid/planet component specs | Lock balance, stat resolution, outcome mapping, rendering helpers |

Specs that use fake timers must drive the battle clock: service specs use
`startBattleTestClock()`; component specs stop the RAF loop and step `gameLoopCallback`
frame by frame (`runFrames`).

---

## Isolation Guarantees

| ❌ NOT in Battle Subsystem | ✅ ONLY in Battle Subsystem |
|---------------------------|----------------------------|
| StarMap strategic movement | Tactical grid (38×16 over 72×28vw) |
| Galaxy/system map logic | Speed-based movement (vw/s, real-time) |
| Economy/production/research | Stack grouping (max 5, by type) |
| Strategic AI (enemy-*) | Real-time game loop (RAF) |
| Fleet.x/y, targetX/Y | Combat (volley, defense, spillover) |
| Sensor range / fog of war | Animation lock (busy flag) |
| Save game internals | Tactical AI (greedy, deterministic, 400ms ticks) |
| Planet ownership logic | Result builder (preserves ship IDs) |
| Ship production | Shield regeneration (timer-based) |

**Dependencies IN (allowed):**
- `ShipService` — read-only ship type stats
- `PlanetBattleService` — virtual defense fleet builder
- `BattleService` — transport boundary only

**Dependencies OUT (none):**
- No imports from `star-map/` in `battle/`
- No strategic services injected into battle services

---

## Debugging

Set `BATTLE_DEBUG_LOG = true` in `battle.types.ts` to enable the `battleDebug()` traces
(`[ATTACK]`, `[MOVE-*]`, `[AI-*]`, `[SNAP-TO-GRID]`, `[TIME]`). They are off by default because
several sit in per-frame paths.

**Key state to watch:**
- `stack.explicitAttackTargetId` / `manualMoveOrder` — active manual orders
- `stack.autoTargetId` / `targetingMode` — automatic targeting
- `stack.attackCooldownUntil` vs `battleTime.battleElapsedMs` — fire readiness
- `anim.isStackBusy(stackId)` — volley in flight

---

## Common Issues

| Symptom | Likely Cause |
|---------|--------------|
| "PATH BLOCKED" on a cell click | Destination occupied/reserved or the straight path crosses a stack |
| Stack does not fire | Fire cooldown running, volley still in flight, or nothing within reach (check the range ring) |
| AUTO ignores a stack | The stack holds a manual order (by design) |
| Red targets don't pulse | Selected stack has no enemy within effective reach |
| Battle ends immediately | One side deployed with 0 stacks (empty fleet) |

---

## Extending the System

### Add New Ship Type
1. Add to `ship-data.json` (speed field 1-5 automatically becomes movement speed)
2. Add tier to `TIER_LOOKUP` in `battle-ship-stats.ts`
3. Stats auto-resolved via `ShipService`

### Add New Combat Mechanic
1. Modify `BattleCombatService.attackStack()` damage calculation
2. Add fields to `BattleShip` / `BattleShipStats` if needed
3. Update `battle-combat.spec.ts`

### Change Grid Size
1. Update `BATTLE_GRID_COLUMNS/ROWS` in `battle.types.ts` (cell sizes derive from them).
2. Update `--cell-w` / `--cell-h` in `battle-grid.component.scss` and the fallback in
   `battle-planet.component.scss`.
3. Update `ATTACKER_DEPLOY_COLS`, `DEFENDER_DEPLOY_COLS` and `DEPLOY_ROW_ORDER` to keep the
   opening formation's physical spacing.
4. Do **not** change `BATTLE_RANGE_UNIT_VW` or speeds — they are physical, so weapon reach and
   travel time stay the same. Stack `size` is in cells, so ships render smaller on a denser grid.

### Add Weapon Type Effectiveness
1. Add `attackType`, `weakness` to damage calc in `battle-combat.service.ts`
2. Add shield/regen handling
3. Update `BattleShipStats` interface

---

## Version History

| Date | Change |
|------|--------|
| Initial | Basic battle screen placeholder |
| Phase 1 | Full tactical minigame: state, grid, stacks, deployment, turn system, AP |
| Phase 2 | Movement (grid, AP, animation, path blocking) |
| Phase 3 | Combat (volley, damage, spillover, animations, victory) |
| Phase 4 | AI (attack/move/attack, end turn) |
| Phase 5 | Result mapping, StarMap integration, planet battles |
| Phase 6 | Cell size fix (5vw → 2.5vw), debug logging |
| Phase 7 | **Real-time conversion**: Removed AP system, removed turn cycling, replaced `BattleTurnService` with `BattleGameLoopService` (RAF), added speed-based VW movement, AI acts every 200ms, timer-based shield regen |
| Phase 8 | **Grid doubled to 38×16** with physical range units; shared fire control with equal cadence for both sides; persistent manual attack orders with chasing and opportunistic fire; per-stack targeting modes; AI limited to movement/Shield Pulse; AUTO respects manual orders; turrets fire; command queue removed; occupancy-map grid searches; debug logging gated |

---

## Performance Notes

- **Pure functions** in `battle-grid.ts`, `battle-result.ts`, `battle-ship-stats.ts` — no side effects, easily testable
- **Change detection** runs once per frame (`anim.tick()` → `detectChanges`). In a jsdom
  measurement with 40–50 stacks, the simulation itself averaged ≈ 0.3 ms per frame and change
  detection ≈ 1 ms; keep template getters cheap (no grid searches in getters).
- **Grid searches** use a per-search `OccupancyMap`, prune by range before tracing paths, and
  are throttled to `MOVE_REPLAN_INTERVAL_MS`.
- **RAF loop** runs outside Angular zone for smooth 60fps movement
- **Shallow state**: `BattleModelState` is flat, no deep nesting
- **Stack limit**: MAX_STACK_SIZE=5 caps visual complexity
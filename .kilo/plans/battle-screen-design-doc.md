# Battle Screen — Technical Design Document

> **Purpose:** Complete reference for the tactical battle minigame. Covers architecture, rules, data flow, and current implementation state so a game designer can understand exactly how battles work and plan future changes.

---

## 1. Overview

The Battle Screen is a **self-contained tactical minigame** that runs when two fleets collide on the star map. It receives two fleets via a transport object, simulates turn-based combat on an 18×7 grid, and returns a `BattleOutcome` that the overworld applies.

**Key architectural principle:** The minigame **never reads or mutates** StarMap / galaxy / economy / production / research state. It is a pure `INPUT → BATTLE → RESULT` box.

### 1.1 Entry / Exit Flow

```
StarMap collision detected
        │
        ▼
BattleService.setBattle(Battle) ──► Router.navigate('/battle')
        │
        ▼
BattleScreenComponent.ngOnInit()
  ├─ createBattleState()  ← deep-clones ships, builds stacks, deploys on grid
  ├─ BattleTurnService.checkVictory()
  └─ BattleAiService.playTurn() (if AI side starts)
        │
        ▼
Player/AI take turns (AP-driven)
        │
        ▼
Victory detected → BattleOutcome built via buildBattleOutcome()
        │
        ▼
Back to Star Map button
        │
        ▼
BattleService.setBattleResult(outcome) → StarMap.reloadAfterBattle()
```

---

## 2. Grid & Coordinate System

| Constant | Value | Description |
|----------|-------|-------------|
| `BATTLE_GRID_COLUMNS` | 18 | Grid width in cells |
| `BATTLE_GRID_ROWS` | 7 | Grid height in cells |
| `BATTLE_CELL_SIZE_VW` | 4 | Visual cell size = 4vw |
| Grid visual size | 72vw × 28vw | Full-width tactical grid |

- **1-indexed cells**: (1,1) = top-left, (18,7) = bottom-right
- **Attacker deploys left**: columns 1–4 (`ATTACKER_DEPLOY_COLS`)
- **Defender deploys right**: columns 18–15 (`DEFENDER_DEPLOY_COLS`)
- **Planet defenses deploy outermost first**: immobile turret stacks claim column 18, then
  overflow inward; garrison stacks fill the remaining defender cells behind them
- **Stack visual centre**: `stackCenterVw()` accounts for stack size and side direction (attacker grows right, defender grows left)

---

## 3. Core Types

### 3.1 BattleStack — The Tactical Unit

All movement, attack, targeting, and selection operate on **stacks**. Individual ships are internal HP bookkeeping only.

```typescript
interface BattleStack {
  stackId: string;           // e.g. "attacker:cruiser:0"
  side: 'attacker' | 'defender';
  typeId: string;            // ship type id (scout, cruiser, etc.)
  typeName: string;          // display name
  col: number;               // grid column (anchor)
  row: number;               // grid row
  ships: BattleShip[];       // 1–MAX_STACK_SIZE ships
  size: number;              // visual width: 1/2/3 cells (tier-based)
  tier: number;              // 1–5 (determines AP costs)
  moveApPerCell: number;     // AP cost per cell moved
  attackAp: number;          // AP cost to attack
  moveRange: number;         // max cells per turn
  attackRange: number;       // attack radius (Euclidean)
  immobile: boolean;         // true for planet defenses
  cellsMovedThisTurn: number;
  attackedThisTurn: boolean; // one attack per stack per turn
  moving: boolean;           // animation in progress
  firing: boolean;           // animation in progress
  moveMs: number;            // animation duration
  destroyed: boolean;
}
```

### 3.2 BattleShip — Internal HP Tracker

```typescript
interface BattleShip {
  shipId: number;      // maps back to overworld FleetShip.id
  name: string;
  typeId: string;
  hp: number;          // current hull
  maxHp: number;
  attack: number;      // raw attack value
  defense: number;     // raw defense value
  alive: boolean;
}
```

### 3.3 BattleModelState — Full Simulation State

```typescript
interface BattleModelState {
  round: number;                 // increments each attacker→defender cycle
  activeSide: 'attacker' | 'defender';
  ap: number;                    // current action points (shared pool)
  apPerTurn: number;             // refill amount (50)
  stacks: BattleStack[];
  phase: 'playerTurn' | 'aiTurn' | 'over';
  log: BattleLogEntry[];
  effect: BattleAttackEffect | null; // projectile/impact/explosion visual
  winner: 'attacker' | 'defender' | null;
  // ... faction ids, names, colors, battle type, planet id
  planetName?: string;           // planet-battle visual metadata
  planetColor?: string;
  defenderShieldPool?: {         // shared planetary shield (planet battles)
    current: number;
    max: number;
    regen: number;
  } | null;
  attackerShips: BattleShip[];   // full rosters in input order
  defenderShips: BattleShip[];
}
```

---

## 4. Action Points (AP) System

### 4.1 Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `AP_PER_TURN` | 50 | Refill per side per turn |
| Tier 1 | 2 AP/cell move, 2 AP/attack | scout, fighter, colonizer, corvette |
| Tier 2 | 3 AP/cell move, 3 AP/attack | frigate, destroyer |
| Tier 3 | 5 AP/cell move, 5 AP/attack | cruiser, carrier |
| Tier 4 | 6 AP/cell move, 6 AP/attack | battleship, battlecruiser |
| Tier 5 | 8 AP/cell move, 8 AP/attack | dreadnought |
| Virtual defense | 5 AP/cell move, 3 AP/attack | immobile planet buildings |

*AP costs = `Math.ceil(tier * 1.5)` (50% increase from base tier)*

### 4.2 AP Consumption Rules

- **Movement**: `steps × moveApPerCell` where `steps = max(|Δcol|, |Δrow|)` (Chebyshev distance)
- **Attack**: `attackAp` (flat per stack, once per turn)
- **Move-to-attack**: `moveCost + attackCost` (atomic, both must succeed)
- AP deducted **up-front** before animation starts (prevents overdrawing)

### 4.3 Turn Lifecycle (`BattleTurnService.endTurn()`)

```
1. Flip activeSide (attacker ↔ defender)
2. If new activeSide = attacker → round++
3. ap = apPerTurn (full refill)
4. For all stacks on NEW active side:
     cellsMovedThisTurn = 0
     attackedThisTurn = false
5. phase = isSidePlayerControlled(activeSide) ? 'playerTurn' : 'aiTurn'
6. checkVictory()
```

**Victory condition**: One side has zero alive stacks.

---

## 5. Stack Building & Deployment

### 5.1 Grouping Logic (`battle-state.ts:buildStacks()`)

1. **If roster ≤ 28 ships** (4 × ROW_ORDER.length): each ship = own stack
2. **Else**: group by `typeId`, split into chunks of `MAX_STACK_SIZE = 5`
3. Stack `size` (visual width):
   - Tier ≥ 5 → 3 cells
   - Tier ≥ 3 → 2 cells
   - Else → 1 cell

### 5.2 Deployment (`deployStacks()` / `deployDefenderStacks()`)

- `ROW_ORDER = [4, 3, 5, 2, 6, 1, 7]` (centre-out from row 4)
- Stacks fill columns left-to-right (attacker) or right-to-left (defender)
- Each column gets up to 7 stacks (one per row in ROW_ORDER)
- **Planet battles**: immobile defense stacks are deployed first into the outermost defender
  columns (18, 17, …); garrison stacks fill the remaining free defender cells behind them.
  Fleet-vs-fleet defenders have no immobile stacks and keep the original path.

---

## 6. Movement Rules

### 6.1 Basic Move (`BattleMovementService.moveStack()`)

- **Straight line only**: orthogonal + diagonal (Chebyshev path via `linePath()`)
- **Max steps per command**: limited by remaining `moveRange` AND `AP / moveApPerCell`
- **Path validation**: every intermediate cell must be in bounds and unoccupied
- **No pathfinding**: blocked path = move rejected
- **Animation**: CSS transition on `left`/`top` (180ms per cell), `moving` flag locks input

### 6.2 Move-to-Attack (`BattleMovementService.moveToAttack()`)

1. If already in direct attack range → delegate to combat
2. Find best attack position via `findBestMoveToAttackCell()`:
   - Minimizes move cost (closest to attacker)
   - Tie-break: closest to target
3. Validate total cost (move + attack) ≤ AP
4. Execute move, then attack atomically

---

## 7. Combat Rules

### 7.1 Attack Execution (`BattleCombatService.attackStack()`)

**Preconditions:**
- Attacker not `attackedThisTurn`
- Attacker has enough AP (`attackAp ≤ state.ap`)
- Target in range (Euclidean distance ≤ `attackRange`)
- Target different side, not destroyed

**Damage Calculation:**
```
totalAttack = SUM(attacker.ships.alive → attack)
frontShip = first alive ship in target.ships
damage = max(1, totalAttack - frontShip.defense)
```

**Damage Application:**
- Applied to target stack's ships **in order**
- Overkill spills to next ship
- Ship dies when `hp ≤ 0` → `alive = false`
- If all ships dead → `stack.destroyed = true`

**Animation Sequence:**
1. `projectile` (320ms) — line from attacker to target
2. `impact` (200ms) / `explosion` (420ms) — radial flash at target
3. `effect = null` → stack.firing = false

### 7.2 Attack Limits

- **One attack per stack per turn** (`attackedThisTurn` flag)
- Reset at start of side's next turn
- Weapon effectiveness applies (attacker `attackType` vs target `weakness`, 1.5×/1.0×/0.5×)
- Per-ship shields absorb before hull HP; in planet battles, immobile turret stacks are
  additionally protected by the shared planetary shield pool first

---

## 8. AI Behavior (`BattleAiService.playTurn()`)

Deterministic greedy controller for non-player sides:

```
1. ATTACK PHASE 1
   For each alive stack on active side (in stackId order):
     - Find best target (closest enemy in attackRange)
     - If found → attackStack()

2. MOVE PHASE
   For each stack that hasn't attacked:
     - Prefer move-to-attack: advance only far enough to bring nearest enemy into attackRange
     - If no target reachable this turn → move toward nearest enemy along straight line
     - Try longest legal approach first; shrink step count if path blocked

3. ATTACK PHASE 2 (post-move)
   For each stack that moved and hasn't attacked:
     - Re-check targets now in range
     - If found → attackStack()

4. END TURN
```

---

## 9. Visual State & Feedback

### 9.1 Stack CSS Classes (applied via `stackClasses()`)

| Class | Condition | Visual |
|-------|-----------|--------|
| `selected` | `stackId === selectedStackId` | Bright border, glow, higher z-index |
| `moving` | `stack.moving` | Blue border, glow |
| `firing` | `stack.firing` | (handled via effect) |
| `attack-target` | Enemy in direct attack range | Red border, pulse animation |
| `move-to-attack-target` | Enemy reachable via move+attack | Orange border, pulse animation |
| `spent` | **Computed centrally** (see below) | No border, dark bg, 50% opacity, not-allowed cursor |

### 9.2 "Spent" State — Central Computation

**Source:** `BattleScreenComponent.spentStackIds` getter (returns `Set<string>`)

**Logic per stack (active side only, not destroyed, not immobile, not animating):**

```
IF ap ≤ 0:
    spent = true
ELSE:
    reachableCells = getReachableCells(state, stack)
    attackTargets  = computeAttackTargetIds(state, stack)
    moveAttackTargets = getMoveToAttackTargetIds(state, stack)

    canMove       = reachableCells.length > 0       AND ap ≥ moveApPerCell
    canAttack     = attackTargets.length > 0        AND !attackedThisTurn AND ap ≥ attackAp
    canMoveAttack = moveAttackTargets.length > 0    AND ap ≥ moveApPerCell + attackAp

    spent = !(canMove || canAttack || canMoveAttack)
```

**Key properties:**
- Evaluated for **ALL active side stacks every change detection cycle**
- Uses actual grid utilities (`getReachableCells` accounts for blocked paths, occupancy, AP, moveRange)
- Selected ship uses pre-computed `moveCells`/`attackTargetIds` for accuracy
- Enemy stacks **never** get `spent` (remain clickable as targets)

### 9.3 AP Bar (Grid-Width Progress Bar)

- Width: 72vw (matches grid)
- Fill: `(ap / apPerTurn) × 100%` with 0.25s transition
- Overlay text: `"AP: X / 50"` centered with text-shadow

### 9.4 End Turn Button Pulse

`shouldPulseEndTurn` returns `true` when:
- `ap ≤ 0` (depleted), OR
- No player-controlled stacks have any valid action (move/attack/move-attack)

Pulse animation: 1.5s box-shadow + background cycle.

---

## 10. Ship Stats & Tier System

### 10.1 Tier Assignment (`battle-ship-stats.ts:TIER_LOOKUP`)

| Ship Type | Tier | Move AP/Cell | Attack AP | Move Range (60% of base) | Attack Range |
|-----------|------|--------------|-----------|--------------------------|--------------|
| Scout | 1 | 2 | 2 | 8 | 3 |
| Fighter | 1 | 2 | 2 | 6 | 2 |
| Colonizer | 1 | 2 | 2 | 3 | 1 |
| Corvette | 1 | 2 | 2 | 6 | 2 |
| Frigate | 2 | 3 | 3 | 5 | 3 |
| Destroyer | 2 | 3 | 3 | 4 | 3 |
| Cruiser | 3 | 5 | 5 | 3 | 3 |
| Carrier | 3 | 5 | 5 | 2 | 4 |
| Battleship | 4 | 6 | 6 | 2 | 4 |
| Battlecruiser | 4 | 6 | 6 | 3 | 5 |
| Dreadnought | 5 | 8 | 8 | 2 | 5 |

**Move Range** = `Math.ceil(shipData.battleMoveRange × 0.6)` (60% reduction, rounded up)

**Attack Range** = `shipData.range` (unchanged)

**Virtual Defense Ships** (planet buildings): Tier 3, immobile, moveRange 0, attackRange from planet-data.json. `planetary_shield` buildings are not ships: they add to one shared pool (`shieldPool` / `shieldPoolRegen`) that protects immobile turret stacks and regenerates on the defender turn.

---

## 11. Animation & Busy Lock

**`BattleAnimationService`** — single source of truth for "animation in flight":

- `busy` signal (true when `activeCount > 0`)
- `run(fn)` — wraps async sequence, guarantees `begin()`/`end()` balance
- `wait(ms)` — deterministic timeout (works with fake timers in tests)
- `tick()` — emits on `ticks$` for mid-animation view updates (effect phases)

**Gates:**
- End Turn button disabled while busy
- All movement/attack/selection input disabled while busy
- AI turn progression waits for busy to clear

---

## 12. Result & Overworld Integration

### 12.1 BattleOutcome Structure

```typescript
interface BattleOutcome {
  winnerSide: 'attacker' | 'defender';
  winnerFleetId: number;
  loserFleetId: number;
  attacker: BattleFleetOutcome;  // fleetId, side, factionId, ships[], survivors[], wipedOut
  defender: BattleFleetOutcome;
  rounds: number;
  battleType: 'fleet' | 'planet';
  planetId?: number;
}
```

### 12.2 Persistence

- **Fleet vs Fleet**: Both fleets' ship rosters (final HP + destroyed flags) written to autosave. Wiped fleet marked `destroyed = true`.
- **Planet Battle**: On attacker victory → planet `factionId` changes. Attacker roster always written back (damaged winner returns damaged). Virtual defense fleet never persisted.

---

## 13. Current Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Grid (18×7) | ✅ | 72vw × 28vw, 4vw cells |
| AP System (50/turn) | ✅ | Tier-based costs ×1.5 |
| Movement (straight line) | ✅ | Chebyshev, path validation |
| Move-to-Attack | ✅ | Atomic move+attack |
| Combat (stack volley) | ✅ | Sum attack vs front defense |
| Weapon Effectiveness | ✅ | attackType vs weakness: 1.5×/1.0×/0.5× |
| Per-Ship Shields | ✅ | Shield absorbs before hull; regen per side turn |
| Shared Planetary Shield | ✅ | Turret-only pool, regen on defender turn |
| Planet Visual | ✅ | Separate `BattlePlanetComponent`; not a stack |
| One attack/turn/stack | ✅ | `attackedThisTurn` flag |
| Turn Lifecycle | ✅ | Attacker→Defender, round counter |
| Victory Detection | ✅ | Zero alive stacks |
| AI Turn Logic | ✅ | Greedy: attack → move → attack → end |
| Animation Lock | ✅ | `BattleAnimationService` |
| AP Progress Bar | ✅ | Grid-width, smooth fill |
| Spent Visual | ✅ | Central computed, all stacks |
| End Turn Pulse | ✅ | AP=0 or no valid actions |
| Move Range 60% | ✅ | Rounded up |
| Deployment | ✅ | Centre-out, side-specific columns |
| Stack Grouping | ✅ | By type, max 5 per stack |
| Result Persistence | ✅ | Fleet + planet outcomes |

---

## 14. Known Constraints / Design Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| No pathfinding | Straight line only | Simplicity, predictability |
| One attack/stack/turn | Hard limit | Prevents focus-fire exploits |
| AP shared per side | Single pool | Forces tactical allocation |
| Weapon types | attackType vs weakness | Adds tactical matchups deterministically |
| Per-ship shields | Shield absorbs before hull | Reuses overworld ship stats |
| Shared planetary shield | Turret-only pool | Lets planet defenses survive without new unit types |
| Deterministic AI | No randomness | Reproducible, testable |
| Deep-clone on entry | Overworld never mutated | Safety, replayability |
| Stack = tactical unit | Not individual ships | UI/UX manageability |

---

## 15. Extension Points for Game Designer

### 15.1 Easy Tweaks (data-only)

- **AP_PER_TURN** → `battle.types.ts:25`
- **Tier AP multipliers** → `battle-ship-stats.ts:82-83` (`Math.ceil(tier * 1.5)`)
- **Move range %** → `ship-data.json` `battleMoveRange` values
- **Attack ranges** → `ship-data.json` `range` values
- **Ship HP/Attack/Defense** → `ship-data.json`
- **Deployment columns** → `battle.types.ts:35-36`
- **Animation durations** → `battle.types.ts:40-45`

### 15.2 Moderate Changes (code + data)

- **Max stacks per type** → `MAX_STACK_SIZE` (battle.types.ts:31)
- **Stack size tiers** → `battle-state.ts:112,153` (tier ≥5→3, ≥3→2, else 1)
- **Victory conditions** → `battle-turn.service.ts:50-62`
- **AI behavior** → `battle-ai.service.ts` (priority order, target selection)

### 15.3 Major Changes (architecture)

- **Per-ship actions** (not per-stack) → restructure `BattleStack` + all services
- **More defense building types** → extend `planet-data.json` + `PlanetBattleService`
- **Pathfinding** → replace `linePath` + `isPathClear` with A*
- **Initiative / simultaneous turns** → rewrite `BattleTurnService` + state machine

---

## 16. File Map

```
src/app/components/battle-screen/
├── battle-screen.component.ts/html/scss    # Orchestrator, UI, spent computation
├── battle-grid/
│   ├── battle-grid.component.ts/html/scss  # Grid rendering, stack visuals
│   └── *.spec.ts
├── battle-planet/                          # Separate planet visual + shield bubble
│   └── battle-planet.component.ts/html/scss/spec.ts
├── battle-fleet-panel/                     # Side roster panel (HP bars)
└── battle/
    ├── battle.types.ts                     # All interfaces, constants
    ├── battle-grid.ts                      # Pure grid math (reach, range, path)
    ├── battle-state.ts                     # State factory, stack building, deploy
    ├── battle-ship-stats.ts                # Ship type → combat stats mapping
    ├── battle-turn.service.ts              # Turn lifecycle, AP refill, victory
    ├── battle-movement.service.ts          # Move + move-to-attack
    ├── battle-combat.service.ts            # Attack resolution, damage
    ├── battle-ai.service.ts                # AI turn logic
    ├── battle-animation.service.ts         # Busy lock, animation timing
    ├── battle-result.ts                    # BattleModelState → BattleOutcome
    └── *.spec.ts
```

---

## 17. Testing Strategy

- **Unit tests**: All services have `.spec.ts` with deterministic fake-timer tests
- **Grid helpers**: `battle-grid.spec.ts` covers bounds, distance, occupancy, reachable cells
- **AI**: `battle-ai.spec.ts` tests attack/move priorities
- **Combat/Movement**: Verify AP costs, damage spill, animation locks
- **State factory**: `battle-state.spec.ts` tests stack building, deployment, deep-clone
- **Planet battles**: `planet-battle.service.spec.ts` and `battle-planet.component.spec.ts`
  cover the shared shield pool, defense-first deployment, and the separate planet visual

---

## 18. Open Questions / Future Considerations

1. **Initiative system?** Currently strict attacker→defender. Could add speed-based initiative.
2. **Morale / retreat?** No current mechanic. Could add at stack or fleet level.
3. **Terrain / obstacles?** Grid is empty. Could add nebulae, asteroids with modifiers.
4. **Fleet abilities / admiral traits?** No hook currently. Could attach to `Battle` transport.
5. **Multi-fleet battles?** Transport only supports 1v1. Would need `Battle.fleets[]`.
6. **Replay / log export?** `BattleModelState.log` exists but not exposed to UI.

---

*Document generated from codebase state as of 2026-09-11. For implementation details, see source files in `src/app/components/battle-screen/battle/`.*
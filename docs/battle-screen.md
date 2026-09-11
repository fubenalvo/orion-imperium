# Battle Screen — Tactical Minigame Documentation

## Overview

The Battle Screen is a **fully self-contained tactical combat minigame** that runs at the `/battle` route. It receives two fleets via the `BattleService` transport boundary, runs a turn-based, AP-driven tactical simulation on an 18×7 grid, and returns a `BattleOutcome` with surviving/destroyed ships. It **never touches StarMap strategic state** — no fleet movement, economy, AI strategy, production, or research.

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
│ │State│ │Grid │ │Turn │ │Move │ │Cmbt │ │Anim │                  │
│ │Fact.│ │Geom.│ │Svc  │ │Svc  │ │Svc  │ │Svc  │                  │
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
    ├── battle-turn.service.ts      # Turn lifecycle, AP, victory check
    ├── battle-movement.service.ts  # Grid movement with AP cost
    ├── battle-combat.service.ts    # Attack resolution, damage, animation
    ├── battle-animation.service.ts # Animation lock (busy flag)
    ├── battle-ai.service.ts        # Tactical AI for non-player sides
    ├── battle-result.ts            # BattleOutcome builder
    ├── battle-ship-stats.ts        # Ship stats from ShipService
    ├── *.spec.ts                   # Tests for each module
```

---

## Core Types (`battle.types.ts`)

### Constants
```typescript
BATTLE_GRID_COLUMNS = 18          // Grid width (cells)
BATTLE_GRID_ROWS = 7              // Grid height (cells)
BATTLE_CELL_SIZE_VW = 2.5         // Cell size in viewport width units
AP_PER_TURN = 10                  // Action Points per turn per side
MAX_STACK_SIZE = 5                // Max ships per visual stack
ATTACKER_DEPLOY_COLS = [1, 2, 3]  // Attacker deployment columns (left)
DEFENDER_DEPLOY_COLS = [17, 18, 16] // Defender deployment columns (right)
ANIMATION_MS = { move: 180, projectile: 320, hit: 200, explosion: 420 }
```

### Key Interfaces

```typescript
// Tactical unit — what moves, attacks, gets selected
interface BattleStack {
  stackId: string;           // e.g. "attacker:fighter:0"
  side: 'attacker' | 'defender';
  typeId: string;            // Ship type ID (scout, fighter, etc.)
  typeName: string;          // Display name
  col: number;               // Grid column (1-18)
  row: number;               // Grid row (1-7)
  ships: BattleShip[];       // Individual ships in this stack
  tier: number;              // AP tier (1-5 from ship cost)
  moveApPerCell: number;     // AP cost per cell moved
  attackAp: number;          // AP cost to attack
  moveRange: number;         // Max cells per turn (from ship.speed)
  attackRange: number;       // Attack range (from ship.range)
  immobile: boolean;         // True for planet defenses
  cellsMovedThisTurn: number;
  attackedThisTurn: boolean;
  moving: boolean;           // Animation flags
  firing: boolean;
  moveMs: number;            // Move animation duration
  destroyed: boolean;
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
  round: number;
  activeSide: 'attacker' | 'defender';
  ap: number;                // Current AP remaining
  apPerTurn: number;         // Always 10
  stacks: BattleStack[];
  phase: 'playerTurn' | 'aiTurn' | 'over';
  log: BattleLogEntry[];
  effect: BattleAttackEffect | null;  // projectile/impact/explosion
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
// 2. Group by side + typeId → stacks (max 5 ships each)
// 3. Deploy: attacker cols 1-3, defender cols 16-18, rows center-out from 4
// 4. Set activeSide = 'attacker', ap = 10, phase = playerTurn/aiTurn
// 5. If AI controls active side → runAiTurns()
```

### 2. State Factory (`createBattleState`)

```typescript
// 1. Identify attacker/defender fleets from battle.attackerId/defenderId
// 2. toBattleShip(): Clone each FleetShip → BattleShip with stats from ShipService
//    - HP = shipType.hitPoints (full hull at battle start)
//    - attack/defense from ship type
//    - tier from TIER_LOOKUP (cost-based: 1=≤150, 2=≤300, 3=≤450, 4=≤600, 5=≤750)
// 3. buildStacks(): Group by typeId, split into chunks of MAX_STACK_SIZE (5)
// 4. deployStacks(): Place on grid
//    - ROW_ORDER = [4, 3, 5, 2, 6, 1, 7] (center-out)
//    - Column cycles through ATTACKER_DEPLOY_COLS / DEFENDER_DEPLOY_COLS
// 5. Return BattleModelState
```

### 3. Turn Lifecycle

```
ATTACKER TURN (10 AP)
  └─ Player/AI spends AP on Move/Attack
  └─ END TURN pressed (or AI auto-ends)
     │
     ▼
DEFENDER TURN (10 AP)
  └─ Player/AI spends AP
  └─ END TURN
     │
     ▼
ROUND++ → ATTACKER TURN (10 AP)
```

**BattleTurnService.endTurn(state):**
```typescript
if (state.winner || anim.isBusy) return false;  // Blocked during animation

state.activeSide = otherSide(state.activeSide);
if (state.activeSide === 'attacker') state.round++;
state.ap = state.apPerTurn;  // Reset to 10

// Reset per-stack turn counters for NEW active side
for (stack of state.stacks) {
  if (stack.side === state.activeSide) {
    stack.cellsMovedThisTurn = 0;
    stack.attackedThisTurn = false;
  }
}
state.phase = isSidePlayerControlled(state, state.activeSide) ? 'playerTurn' : 'aiTurn';
checkVictory(state);
return true;
```

**Victory Check:** After every attack and at end of turn — side with 0 alive stacks loses.

### 4. Player Input

**Conditions to act (`canAct`):**
```typescript
get canAct(): boolean {
  return this.playerControlsActiveSide && !this.anim.isBusy;
}
```

**Selection Flow:**
1. **Click own stack** → `selectedStackId` set → `moveCells` (green) + `attackTargetIds` (red pulse) computed
2. **Click green cell** → `doMove()` → `BattleMovementService.moveStack()`
3. **Click red enemy stack** → `doAttack()` → `BattleCombatService.attackStack()`
4. **END TURN** → `turn.endTurn()` → if AI next → `runAiTurns()`

### 5. Movement (`BattleMovementService.moveStack`)

```typescript
async moveStack(state, stackId, targetCol, targetRow): Promise<boolean>
1. Validate: stack exists, not destroyed, correct side, not immobile, not animating
2. Check bounds (1-18, 1-7)
3. Calculate steps = max(|dc|, |dr|)  // 8-direction straight line
4. Check: cellsMovedThisTurn + steps ≤ moveRange
5. Check: steps * moveApPerCell ≤ state.ap
6. linePath() → all intermediate cells must be in bounds + unoccupied
7. Commit AP: state.ap -= cost; stack.cellsMovedThisTurn += steps
8. Animate: anim.run(() => {
      stack.moving = true; tick();
      stack.col = targetCol; stack.row = targetRow;  // Position commits immediately
      wait(steps * ANIMATION_MS.move);
      stack.moving = false; tick();
   })
9. Return true
```

### 6. Combat (`BattleCombatService.attackStack`)

```typescript
async attackStack(state, attackerStackId, targetStackId): Promise<boolean>
1. Validate: both stacks exist, alive, correct side, attacker not attackedThisTurn, AP sufficient
2. Range check: isInRange(attacker, target, attacker.attackRange)  // Euclidean dx²+dy² ≤ range²
3. Commit AP: state.ap -= attacker.attackAp; attacker.attackedThisTurn = true
4. Animation sequence via anim.run():
   a) PROJECTILE (320ms): state.effect = { phase: 'projectile', from, to, targetStackId }
      attacker.firing = true; tick(); wait(320ms);
   b) DAMAGE CALCULATION:
      totalAttack = Σ alive ships in attacker stack .attack
      front = first alive ship in target stack
      damage = max(1, totalAttack - front.defense)  // Per-ship defense, not summed
      // Apply damage ship-by-ship, overkill spills to next
      for (ship of target.ships) if alive:
         applied = min(ship.hp, remaining)
         ship.hp -= applied; remaining -= applied
         if ship.hp ≤ 0: ship.hp = 0; ship.alive = false; kills++
      if all ships dead: target.destroyed = true
   c) LOG: push BattleLogEntry { round, side, attackerStack, defenderStack, damage, kills }
   d) IMPACT/EXPLOSION (200/420ms): state.effect = { phase: 'impact'|'explosion', ... }
      tick(); wait(200 or 420ms);
   e) CLEANUP: state.effect = null; attacker.firing = false; checkVictory(); tick()
5. Return true
```

**Damage Model:**
- **Stack volley**: All alive ships in stack fire once per attack
- **Defense**: Only the front (first alive) target ship's defense applies
- **Formula**: `damage = max(1, totalAttack - front.defense)`
- **Spillover**: Remaining damage continues to next ship in stack
- **No RNG**: Fully deterministic
- **Shields/weapon types**: Loaded from data but **not applied** (per design)

### 7. Animation Lock (`BattleAnimationService`)

```typescript
// Single busy flag gates ALL input
private activeCount = 0;
readonly busy = signal(false);

begin(): void { activeCount++; busy.set(true); }
end(): void { activeCount = max(0, activeCount-1); busy.set(activeCount > 0); }

run<T>(fn): Promise<T> {
  begin();
  return Promise.resolve().then(fn).finally(() => end());
}

wait(ms): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
tick(): void { ticks$.next(); }  // Notifies view of mid-animation state changes
```

**What `isBusy` blocks:**
- END TURN button (`canEndTurn`)
- Stack selection (`canAct`)
- Movement input (`canAct`)
- Attack input (`canAct`)
- AI turn progression (`runAiTurns` loop checks `!state.winner && !isSidePlayerControlled...`)

### 8. AI (`BattleAiService.playTurn`)

```typescript
async playTurn(state):
1. Attack phase 1: Every in-range stack attacks nearest enemy
2. Move phase: Remaining stacks move toward nearest enemy (straight line, max moveRange)
3. Attack phase 2: Stacks that moved into range attack
4. endTurn()
```
- Deterministic, greedy
- Planet defense buildings (`immobile: true`) never move
- No strategic knowledge — pure tactical

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
| `isInBounds(col, row)` | 1 ≤ col ≤ 18, 1 ≤ row ≤ 7 |
| `cellDistance(a, b)` | Euclidean √(dc²+dr²) |
| `isInRange(a, b, range)` | dc²+dr² ≤ range² (inclusive at exact range) |
| `linePath(from, to)` | Straight-line cells (Bresenham-ish) excluding origin |
| `isOccupied(state, col, row, excludeStackId?)` | Any alive stack at cell |
| `getStackAt(state, col, row)` | Stack at cell or null |
| `cellToVw(cell)` | `{ x: (col-0.5)*2.5, y: (row-0.5)*2.5 }` — center in vw |
| `getReachableCells(state, stack)` | Within moveRange, AP budget, bounds, unoccupied, clear linePath |
| `getAttackTargetIds(state, stack)` | Enemy stacks within attackRange |

---

## AP Cost Model (Tier-Based)

| Tier | Ships (Cost) | Move AP/Cell | Attack AP | Move Range (speed) | Attack Range |
|------|--------------|--------------|-----------|---------------------|--------------|
| 1 | Scout (50), Fighter (75), Colonizer (100), Corvette (120) | 1 | 1 | 5, 5, 3, 4 | 3, 2, 1, 2 |
| 2 | Frigate (180), Destroyer (260) | 2 | 2 | 4, 3 | 3, 3 |
| 3 | Cruiser (400), Carrier (500) | 3 | 3 | 3, 2 | 3, 4 |
| 4 | Battleship (700), Battlecruiser (750) | 4 | 4 | 2, 3 | 4, 5 |
| 5 | Dreadnought (1200) | 5 | 5 | 1 | 5 |

**Example:** 5 fighters (tier 1) can each move 1 cell + attack = 10 AP total.
2 frigates (tier 2) moving 2 cells each = 8 AP, leaving 2 for one attack.

---

## Planet Battles

- Same minigame, `battle.type === 'planet'`
- Defender fleet built by `PlanetBattleService` from planet's defense buildings
- Virtual ships: `immobile = true`, `moveRange = 0`, stats from `planet-data.json`
- Attacker wins → planet.factionId = attacker.factionId (in `applyPlanetBattleResult`)
- Virtual defender fleet (negative ID) never persists
- Attacker ship roster always written back (damaged winner returns damaged)

---

## Save/Load Behavior

- **Only AUTOSAVE slot (0)** used for battle persistence
- Battle result written to AUTOSAVE in `backToStarMap()` → `persistFleetBattleResult()` / `applyPlanetBattleResult()`
- `reloadAfterBattle()` loads same AUTOSAVE → cumulative fleet destructions persist
- **No tactical state saved** (grid positions, AP, turn, animations) — battle is a temporary minigame

---

## Control Summary (Player)

| Action | How | Cost | Requirements |
|--------|-----|------|--------------|
| Select stack | Click own unit | — | Your turn, not busy |
| Move | Click green dashed cell | steps × tier AP | ≤ moveRange, ≤ AP, clear path |
| Attack | Click red pulsing enemy | tier AP | In range, not attacked this turn, ≤ AP |
| End Turn | Press END TURN button | — | Your turn, not busy |
| Cancel selection | Click own stack again / click empty | — | — |

**Visual Feedback:**
- **Selected stack**: Bright blue border + glow
- **Move cells**: Green dashed squares
- **Attack targets**: Red pulsing border + glow
- **Moving**: Blue border + "moving" class
- **Firing**: Red border + "firing" class
- **Projectile**: Red dashed line from attacker to target
- **Impact**: White/red radial flash
- **Explosion**: Yellow/orange expanding ring

---

## Test Coverage

| Module | Tests | Key Coverage |
|--------|-------|--------------|
| `battle-state.spec.ts` | 8 | No input mutation, stack grouping (5/5/2), deployment columns, row centering, stat resolution, planet immobile, player control check, fleet order independence |
| `battle-grid.spec.ts` | 9 | Grid bounds (18×7), Euclidean distance, range check, linePath, occupancy (ignores destroyed/excluded), reachable cells (moveRange, AP, blockers, paths), attack targets |
| `battle-ship-stats.spec.ts` | 8 | All 13 ship tiers, tier = moveAp = attackAp, speed/range reuse, combat stats, virtual defenses immobile, unknown type fallback |
| `battle-turn.spec.ts` | 6 | Turn flip, AP reset, round increment, victory detection, AI vs player phase, anim busy blocks |
| `battle-movement.spec.ts` | 7 | Valid move, AP cost, moveRange cap, bounds, occupancy, path blocking, anim lock |
| `battle-combat.spec.ts` | 9 | Damage formula, overkill spill, stack destruction → victory, effect lifecycle (projectile→impact→clear), range reject, same-side reject, double-attack reject, anim busy reject |
| `battle-animation.spec.ts` | 6 | begin/end balance, busy signal, run() wraps, wait timing, tick emission, reset |
| `battle-ai.spec.ts` | 5 | Attack in range, move toward enemy, post-move attack, end turn, immobile skipped |
| `battle-result.spec.ts` | 5 | Input order preserved, final HP/destroyed, survivors/wipedOut, winner/loser IDs, planetId carried |

**Total: 63 tests, all passing**

---

## Isolation Guarantees

| ❌ NOT in Battle Subsystem | ✅ ONLY in Battle Subsystem |
|---------------------------|----------------------------|
| StarMap strategic movement | Tactical grid (18×7, 2.5vw cells) |
| Galaxy/system map logic | AP system (10/turn, tier-based) |
| Economy/production/research | Stack grouping (max 5, by type) |
| Strategic AI (enemy-*) | Turn lifecycle (attacker→defender) |
| Fleet.x/y, targetX/Y | Movement (grid, straight line, AP) |
| Sensor range / fog of war | Combat (volley, defense, spillover) |
| Save game internals | Animation lock (busy flag) |
| Planet ownership logic | Tactical AI (greedy, deterministic) |
| Ship production | Result builder (preserves ship IDs) |

**Dependencies IN (allowed):**
- `ShipService` — read-only ship type stats
- `PlanetBattleService` — virtual defense fleet builder
- `BattleService` — transport boundary only
- `GameTimeService` — pause/resume during battle

**Dependencies OUT (none):**
- No imports from `star-map/` in `battle/`
- No strategic services injected into battle services

---

## Debugging

Enable console logs (already added in recent changes):
```typescript
// BattleScreenComponent
console.log('[BattleScreen] Initial state:', { attackerFactionId, defenderFactionId, activeSide, playerControlsActiveSide, animBusy, stacks });
console.log('[BattleScreen] onStackClick/onCellClick:', ...);
console.log('[BattleScreen] AI turn start/end:', ...);

// BattleAiService
console.log('[BattleAI] playTurn start/complete:', ...);
console.log('[BattleAI] attacking:', ...);
```

**Key state to watch:**
- `state.activeSide` — whose turn
- `state.ap` — AP remaining
- `anim.isBusy` — animation lock
- `playerControlsActiveSide` — can player act?
- `state.stacks.map(s => s.side)` — which stacks belong to whom

---

## Common Issues

| Symptom | Likely Cause |
|---------|--------------|
| Nothing happens on click | Not your turn (enemy is attacker), or `anim.isBusy` stuck |
| AI plays forever | `runAiTurns` safety counter (10) prevents infinite loop |
| END TURN disabled | `anim.isBusy === true` — wait for animation |
| Green cells don't appear | Stack not selected, or not your turn, or no AP/moveRange |
| Red targets don't pulse | Selected stack out of range, or no enemy in range |
| Battle ends immediately | One side deployed with 0 stacks (empty fleet) |

---

## Extending the System

### Add New Ship Type
1. Add to `ship-data.json`
2. Add tier to `TIER_LOOKUP` in `battle-ship-stats.ts`
3. Stats auto-resolved via `ShipService`

### Add New Combat Mechanic
1. Modify `BattleCombatService.attackStack()` damage calculation
2. Add fields to `BattleShip` / `BattleShipStats` if needed
3. Update `battle-combat.spec.ts`

### Change Grid Size
1. Update `BATTLE_GRID_COLUMNS/ROWS` in `battle.types.ts`
2. Update `ROW_ORDER` in `battle-state.ts` if rows change
3. Update `deployStacks()` column logic if columns change
4. Scale `BATTLE_CELL_SIZE_VW` in SCSS to fit viewport

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

---

## Performance Notes

- **Pure functions** in `battle-grid.ts`, `battle-result.ts`, `battle-ship-stats.ts` — no side effects, easily testable
- **OnPush-friendly**: `BattleAnimationService.ticks$` emits only on state change
- **No zone.js polling**: Animation uses `setTimeout` + `anim.run()` wrapper
- **Shallow state**: `BattleModelState` is flat, no deep nesting
- **Stack limit**: MAX_STACK_SIZE=5 caps visual complexity
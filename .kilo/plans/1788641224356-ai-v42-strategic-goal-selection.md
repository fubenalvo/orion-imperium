# AI V4.2 – Strategic Goal Selection Plan

## 1. Current Architecture Findings

### Existing layers (bottom to top)

| Layer | Service | Responsibility |
|---|---|---|
| V3 Tactical | `EnemyAiService` | Per-fleet player targeting, sets `fleet.targetX/Y` |
| V4.1 Strategic | `EnemyStrategyService` | Per-faction high-level intention (`expand`/`attack`/`defend`/`develop`) |

### Integration in `StarMap.gameLoopCallback` (`star-map.ts:1713-1758`)

```
this.enemyAiService.tick(gameDeltaTime, this.fleets, this.factions);
this.enemyStrategyService.tick(gameDeltaTime, this.fleets, this.factions, this.starSystems);
```

Both return `boolean changed`. Change detection fires when any system returns `true`.

### Available model data

- **Planets**: `StarSystem.planetsTiles[]` with `factionId`, `type`, `size`, `x`, `y`, `explored`, `id`, `index`, `population`, `buildings`
- **Systems**: `StarSystem` with `id`, `name`, `x`, `y`, `planetsTiles`, `explored`
- **Fleets**: `Fleet` with `factionId`, `x`, `y`, `ships[]`, `destroyed`, `targetX/Y`
- **Factions**: `Faction` with `id`, `name`, `team`, `color`, `currencies`
- **Ship types**: accessible via `ShipService.getShipType(typeId)` — same formula used by V3 and V4.1
- **Unhabited planets**: `planet.factionId === 'unhabited'` (V4.1 uses this exact string)
- **Team system**: `team === 1` = player, `team === 2+` = enemy, `team === 0` = neutral

### Existing patterns to follow

- Services are `@Injectable({ providedIn: 'root' })`
- Services use the same accumulator pattern for timed evaluation
- `reset()` clears all runtime state
- Tests use `TestBed.inject()` with helper factories
- Services never mutate input data (tests verify this)
- Logging format: `[Service Name] factionId: details`

---

## 2. Recommended `EnemyGoalService` Design

**Name**: `EnemyGoalService`  
**Location**: `src/app/components/star-map/enemy-goal.service.ts`  
**Test file**: `src/app/components/star-map/enemy-goal.service.spec.ts`

### Service shape

```typescript
@Injectable({ providedIn: 'root' })
export class EnemyGoalService {
  private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);
  private readonly STRATEGY_TICK_INTERVAL = 2; // reuse V4.1 cadence
  private accumulator = 0;
  private readonly currentGoals = new Map<string, StrategicGoal>();

  reset(): void { ... }

  tick(
    gameDeltaTime: number,
    currentStrategy: AiStrategy,
    factionId: string,
    fleets: Fleet[],
    factions: Faction[],
    starSystems: StarSystem[],
  ): boolean { ... }

  getGoal(factionId: string): StrategicGoal | undefined { ... }
}
```

### Key design decisions

1. **Single-faction tick**: Unlike `EnemyStrategyService` which evaluates all factions in one call, `EnemyGoalService.tick()` takes a single `factionId` and `currentStrategy`. The caller (`StarMap.gameLoopCallback`) loops over enemy factions. This keeps the method focused and avoids iterating factions twice.

2. **Same accumulator pattern**: Uses the same 2-second internal accumulator as V4.1. No new per-frame overhead.

3. **Goal commitment**: Once a goal is selected, it is kept until:
   - The strategy changes (different `currentStrategy` passed in)
   - The goal's validity predicate returns `false`
   - The faction has no fleets/planets (edge case)

4. **No execution**: The service only returns and stores goals. No movement, no colonization, no fleet assembly.

---

## 3. Goal Model

Add to `star-map.models.ts`:

```typescript
export type GoalType = 'colonize' | 'attack' | 'defend' | 'develop';

export interface ColonizeGoal {
  type: 'colonize';
  targetPlanetId: number;
  targetSystemId: string;
}

export interface AttackGoal {
  type: 'attack';
  targetFleetId: number;
}

export interface DefendGoal {
  type: 'defend';
  targetPlanetId: number;
  targetSystemId: string;
  // Optional: the threatening player fleet that caused this
  threateningFleetId?: number;
}

export interface DevelopGoal {
  type: 'develop';
}

export type StrategicGoal = ColonizeGoal | AttackGoal | DefendGoal | DevelopGoal;
```

**Rationale**: Each goal carries the minimum data needed to identify its target. `targetSystemId` is included alongside `targetPlanetId` because planets are nested inside systems and the system id is the stable reference. The `threateningFleetId` on `DefendGoal` is optional — useful for future execution but not required for selection.

---

## 4. Exact Goal Selection Rules

### 4.1 EXPAND → COLONIZE

**Input**: `currentStrategy === 'expand'`

**Algorithm**:
1. Get all enemy planets for this faction.
2. Get all enemy fleets for this faction (non-destroyed, has ships).
3. Get all unhabited planets across all systems.
4. Filter to candidate planets that are NOT already targeted by another enemy faction's current `colonize` goal.

**Scoring** (simple deterministic):
```
score = (20 / distanceFromNearestEnemyPlanet) * habitabilityWeight
```

Where:
- `distanceFromNearestEnemyPlanet` = min Euclidean distance from the candidate planet's system to any enemy-owned system (for this faction)
- `habitabilityWeight`: 
  - `earthlike` or `gasgiant` → 1.0
  - `desert` or `venuslike` → 0.8
  - `marslike` → 0.9
  - `ice` → 0.7
  - `tiny` size → 0.6, `small` → 0.8, `medium` → 1.0, `big`/`huge` → 1.1

**Tie-breaking** (in order):
1. Higher score
2. Lower distance
3. Lower `planet.id`
4. Lower `system.id`

**Invalidation conditions**:
- Planet `factionId !== 'unhabited'` (was colonized by someone)
- Planet/system no longer exists
- Same planet already targeted by another faction's goal

### 4.2 ATTACK → ATTACK

**Input**: `currentStrategy === 'attack'`

**Algorithm**:
1. Get all player fleets (faction.team === 1, not destroyed, has ships).
2. If no player fleets → invalidate goal, return `undefined`.
3. For each player fleet, calculate `playerStrength` using the same V3 formula.
4. For each enemy fleet, calculate `enemyStrength`.
5. For each player fleet candidate, compute `ratio = playerStrength / max(enemyStrength, 1)`.
6. Categorize: `weak` (≤0.75), `comparable` (≤1.5), `strong` (>1.5).

**Selection priority** (same as V3, but at goal level):
1. Weakest category first (weak > comparable > strong)
2. Within same category: closest distance to the faction's closest enemy fleet
3. Tie-break: lower `fleet.id`

**Result**: `{ type: 'attack', targetFleetId: playerFleet.id }`

**Invalidation conditions**:
- Target fleet `destroyed === true`
- Target fleet `ships.length === 0`
- Target fleet `factionId` is no longer a player faction (team !== 1)
- No valid player fleets remain

### 4.3 DEFEND → DEFEND

**Input**: `currentStrategy === 'defend'`

**Algorithm**:
1. Get all enemy-owned systems for this faction.
2. Get all player fleets.
3. For each enemy-owned system, find the closest player fleet and the distance.
4. The "threatened" system is the one with the smallest distance to any player fleet.
5. If the closest player fleet is within 5 cells → this is the defend target.

**Selection**:
- Target = the most-threatened planet (by closest player fleet distance)
- Prefer the planet in the most-threatened system
- Tie-breaking: lower `planet.id`, then lower `system.id`

**Result**: `{ type: 'defend', targetPlanetId: planet.id, targetSystemId: system.id, threateningFleetId: closestPlayerFleet.id }`

**Invalidation conditions**:
- Target system/planet no longer exists
- Target planet `factionId !== factionId` (was captured)
- No player fleets within threat distance of any enemy planet

### 4.4 DEVELOP → DEVELOP

**Input**: `currentStrategy === 'develop'`

**Result**: `{ type: 'develop' }` (no target)

**Invalidation**: Never invalidates by itself. Only replaced when strategy changes.

---

## 5. Goal Validity / Commitment Rules

### Commitment behavior

```typescript
// Pseudocode for tick()
if (currentGoal === undefined || strategyChanged || !isGoalValid(currentGoal, ...)) {
  currentGoal = selectNewGoal(currentStrategy, ...);
  if (currentGoal) {
    logGoalChange(factionId, currentGoal);
  }
}
```

### Validity predicates

```typescript
isColonizeGoalValid(goal, starSystems): boolean {
  const system = starSystems.find(s => s.id === goal.targetSystemId);
  if (!system) return false;
  const planet = system.planetsTiles.find(p => p.id === goal.targetPlanetId);
  if (!planet) return false;
  return planet.factionId === 'unhabited';
}

isAttackGoalValid(goal, fleets, factions): boolean {
  const fleet = fleets.find(f => f.id === goal.targetFleetId);
  if (!fleet || fleet.destroyed || fleet.ships.length === 0) return false;
  const playerFactionIds = getPlayerFactionIds(factions);
  return playerFactionIds.has(fleet.factionId);
}

isDefendGoalValid(goal, starSystems, fleets, factions): boolean {
  const system = starSystems.find(s => s.id === goal.targetSystemId);
  if (!system) return false;
  const planet = system.planetsTiles.find(p => p.id === goal.targetPlanetId);
  if (!planet || planet.factionId !== factionId) return false;
  // Also check that a threat still exists
  const playerFleets = getPlayerFleets(fleets, factions);
  return playerFleets.some(f => distanceToSystem(f, system) <= THREAT_DISTANCE);
}

isDevelopGoalValid(): boolean { return true; }
```

### Cross-faction deduplication

When selecting a `colonize` goal, check if another enemy faction already has a `colonize` goal targeting the same planet. If so, skip that planet in scoring. This prevents both enemies from pursuing the same expansion target.

---

## 6. Integration with V4.1

### `StarMap.gameLoopCallback` changes

Add after the strategy tick call:

```typescript
const strategyChanged = this.enemyStrategyService.tick(
  gameDeltaTime, this.fleets, this.factions, this.starSystems,
);

// NEW: Goal selection layer
const goalChanged = this.enemyGoalService.tick(
  gameDeltaTime,
  this.enemyStrategyService.getStrategy(factionId),
  factionId,
  this.fleets,
  this.factions,
  this.starSystems,
);

// ... loop over factions

// Update change detection condition
if (didMoveFleets || aiChanged || goalChanged || economyUpdated || visibilityChanged || productionChanged || strategyChanged) {
  this.ngZone.run(() => this.cdr.detectChanges());
}
```

**Important**: Since `EnemyGoalService.tick()` now takes a single faction, the loop in `gameLoopCallback` iterates over `this.enemyFactionIds` and calls it once per faction. The `goalChanged` return value is `true` if ANY faction's goal changed.

### `StarMap` constructor

Add `private enemyGoalService: EnemyGoalService` injection.

### `StarMap` reset

Add `this.enemyGoalService.reset()` alongside the existing `enemyAiService.reset()` and `enemyStrategyService.reset()`.

---

## 7. Files to Create/Change

### New files

| File | Description |
|---|---|
| `src/app/components/star-map/enemy-goal.service.ts` | New `EnemyGoalService` |
| `src/app/components/star-map/enemy-goal.service.spec.ts` | Tests for `EnemyGoalService` |

### Files to modify

| File | Changes |
|---|---|
| `src/app/components/star-map/star-map.models.ts` | Add `GoalType`, `StrategicGoal`, `ColonizeGoal`, `AttackGoal`, `DefendGoal`, `DevelopGoal` types |
| `src/app/components/star-map/star-map.ts` | Inject `EnemyGoalService`, call it in `gameLoopCallback`, add `reset()` call |
| `docs/game-state.md` | Add section 4.13 documenting the new V4.2 goal layer |

### Files NOT to modify

- `enemy-ai.service.ts` — V3 stays intact
- `enemy-strategy.service.ts` — V4.1 stays intact
- `enemy-ai.service.spec.ts` — existing tests must pass unchanged
- `enemy-strategy.service.spec.ts` — existing tests must pass unchanged

---

## 8. Test Plan

All tests use `TestBed` with the same factory patterns as existing V4.1/V3 tests.

### Tests for `EnemyGoalService`

1. **EXPAND selects a valid colonization target**
   - Setup: enemy faction with fleet at (0,0), unhabited planet at (10,10)
   - Expect: goal type is `colonize`, `targetPlanetId` matches, `targetSystemId` matches

2. **ATTACK selects a valid player fleet**
   - Setup: enemy fleet stronger than player fleet within engagement distance
   - Expect: goal type is `attack`, `targetFleetId` matches a valid player fleet

3. **DEFEND selects the most relevant threatened planet**
   - Setup: enemy planet at (5,5), player fleet at (3,3) within threat distance
   - Expect: goal type is `defend`, `targetPlanetId` and `targetSystemId` match the threatened planet

4. **DEVELOP produces a develop goal**
   - Setup: strategy is `develop`, no favorable conditions
   - Expect: goal type is `develop`, no target fields

5. **Invalid goals are replaced**
   - Setup: select a colonize goal, then change the planet to `factionId: 'player'`
   - Call `tick()` again
   - Expect: new goal selected (or undefined if no valid target exists)

6. **Valid goals remain committed**
   - Setup: select a colonize goal, call `tick()` again without changing state
   - Expect: same goal returned (no change)

7. **Changing strategy can replace the current goal**
   - Setup: current goal is `colonize` for `expand` strategy, then pass `attack` strategy
   - Expect: goal changes to `attack` type

8. **Multiple enemy factions maintain independent goals**
   - Setup: enemy1 has `expand`, enemy2 has `attack`
   - Expect: `getGoal('enemy1')` returns colonize, `getGoal('enemy2')` returns attack

9. **Selection is deterministic**
   - Setup: identical input state, call `reset()` and `tick()` twice
   - Expect: same goal selected both times

10. **Player/neutral game state is never modified**
    - Setup: various player/neutral fleets and planets
    - Call `tick()`
    - Expect: no mutation to any player/neutral object

11. **Existing V3 tests remain unchanged and pass**
    - Run full `enemy-ai.service.spec.ts` test suite

12. **Existing V4.1 tests remain unchanged and pass**
    - Run full `enemy-strategy.service.spec.ts` test suite

### Additional edge-case tests

- **Colonize goal skips planets already targeted by another faction**: enemy1 and enemy2 both try to colonize; ensure they get different planets if available.
- **Attack goal falls back when no valid targets**: all player fleets destroyed → goal becomes `undefined` (or `develop` if strategy changed).
- **Defend goal invalidates when threat disappears**: player fleet moves away from enemy planet → goal replaced.
- **Delta time 0/negative**: service returns `false` without selecting goals.
- **Goal persistence across accumulator cycles**: goal selected on one tick, same goal still valid after accumulator fires again.

---

## 9. Potential Edge Cases

| Edge Case | Handling |
|---|---|
| No enemy fleets for a faction | Cannot select attack/expand/defend goals. Strategy should be `develop`. Goal service returns `develop` or `undefined`. |
| No enemy planets for a faction | Cannot select defend goal. Strategy should be `expand` or `develop`. |
| All planets owned | Cannot select colonize goal. Falls through to next strategy's goal or `develop`. |
| Multiple unhabited planets with same score | Deterministic tie-breaking by `planet.id` then `system.id`. |
| Player fleet destroyed during evaluation | Fleet is filtered out before scoring. |
| Planet colonized by player between ticks | Validity check catches `factionId !== 'unhabited'`. |
| Goal selected, then strategy changes | New goal selected immediately on next tick (strategy mismatch triggers reselection). |
| Both enemy factions target same unhabited planet | Second faction's scorer skips that planet. If only one candidate exists and both factions want it, first to evaluate gets it (deterministic by faction iteration order). |
| Enemy fleet has 0 strength (no ships) | Filtered out by `getEnemyFleets` logic (V4.1 already does this). |
| Empty `starSystems` array | All selection methods handle empty arrays gracefully (return `undefined`/`develop`). |

---

## 10. Implementation Order

1. **Add goal types to `star-map.models.ts`** — no runtime impact, just type definitions.
2. **Create `enemy-goal.service.ts`** — implement the service with:
   - `reset()`, `tick()`, `getGoal()`
   - `selectColonizeGoal()`, `selectAttackGoal()`, `selectDefendGoal()`, `selectDevelopGoal()`
   - `isGoalValid()` with per-type predicates
   - Private helper methods reused from V4.1 pattern (`getEnemyFleets`, `getPlayerFleets`, `getEnemyPlanets`, `getUnhabitedPlanets`, `calculateFleetStrength`)
3. **Create `enemy-goal.service.spec.ts`** — implement all 12 tests plus edge cases.
4. **Wire into `StarMap`** — inject service, add to `gameLoopCallback`, add to `reset()`.
5. **Update `docs/game-state.md`** — add section 4.13.

### Reuse from V4.1 (to avoid duplication)

The following private methods are identical between `EnemyStrategyService` and `EnemyGoalService`:
- `getEnemyFleets(factionId, fleets)`
- `getPlayerFleets(fleets, factions)`
- `getEnemyPlanets(factionId, starSystems)`
- `getUnhabitedPlanets(starSystems)`
- `calculateFleetStrength(fleet)`

**Decision**: Extract these into a shared utility or duplicate them. Given the project's preference for small focused services and the AGENTS.md instruction to avoid unnecessary abstractions, **duplicate the methods** in `EnemyGoalService`. They are short (5-10 lines each) and duplicating avoids creating a new utility class or interface that would be over-engineering at this stage. If the third AI layer also needs them, refactoring can happen later.

### Logging format

Follow the existing convention:
```
[Enemy Goal] enemy1: expand -> { type: 'colonize', targetPlanetId: 5, targetSystemId: 'sys3' }
[Enemy Goal] enemy1: colonize -> { type: 'attack', targetFleetId: 12 }
```

---

## Validation Gates

After implementation:

1. `ng test` — all existing tests pass (V3: 21, V4.1: 14)
2. New tests: 12 required + 6 edge cases = 18 total for `EnemyGoalService`
3. `ng lint` / `ng build` — no compilation errors
4. Manual: game runs, no runtime errors in console, strategies and goals appear in logs

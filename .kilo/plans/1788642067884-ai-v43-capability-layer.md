# AI V4.3 – Capability Layer Plan

## 1. Current Architecture Findings

### Layer stack (existing)

```
EnemyStrategyService V4.1          →  expand | attack | defend | develop
        ↓
EnemyGoalService V4.2              →  colonize | attack | defend | develop  (with target)
        ↓
EnemyAiService V3                  →  fleet movement / battle targeting
```

### Timing
- **V4.1**: 2-second game-time accumulator (`STRATEGY_TICK_INTERVAL = 2`). Pause-safe.
- **V4.2**: Same 2-second accumulator, matching V4.1 cadence.
- **V3**: Every frame (scaled delta), pause-safe.
- All three are called from `StarMap.gameLoopCallback()` every frame, but only produce work when their accumulator fires.

### Key systems inspected

| System | Key facts for V4.3 |
|---|---|
| `ResearchService` | `isShipUnlocked(faction, shipTypeId)` checks if any researched tech lists the ship. `isResearched(faction, techId)` checks direct research. |
| `ShipService` | Stateless lookup of `ShipType` from `ship-data.json`. |
| `ShipStockService` | `getCount(data, factionId, typeId)` returns how many of a ship type are in global stock. `getStock()` returns the live array. |
| `PlanetBattleService.resolveUninhabitedArrival()` | Colonization actually requires a non-destroyed `colonizer` ship in the fleet. |
| `FleetAssemblyService` | Requires a spaceport to create/reinforce fleets from stock. |
| `SpaceportService` | `hasSpaceport(factionId, starSystems)` checks planet buildings. |
| Fleet strength formula | `sum(attack + defense + hitPoints/10 + shield/10)` per ship, resolved via `ShipService.getShipType()`. Identical in V3, V4.1, V4.2. |
| Initial enemy factions | `enemy1` and `enemy2` have NO `researchedTechnologies` in the seed data. `SaveGameService` backfills starting techs on load, but code must handle `undefined`. |
| Colonizer ship | `id: "colonizer"`, unlocked by `basic_engineering` (a starting tech). |

### What V4.2 already validates (goal validity)

- **colonize**: target system/planet exists and planet is still `unhabited`.
- **attack**: target fleet exists, not destroyed, has ships, is a player fleet.
- **defend**: target system/planet exists, planet is owned by faction, and a player fleet is within `THREAT_DISTANCE` (5 cells).
- **develop**: always valid.

V4.3 must **NOT** duplicate these validity rules. It must only add capability checks.

---

## 2. Capability Model Recommendation

### New types (added to `star-map.models.ts`)

```typescript
export interface CapabilityRequirement {
  type: string;
  satisfied: boolean;
  reason: string;
}

export interface CapabilityResult {
  canExecute: boolean;
  goalType: GoalType;
  factionId: string;
  requirements: CapabilityRequirement[];
}
```

### New service: `EnemyCapabilityService`

- Injectable, provided in root.
- Per-faction evaluation with the same 2-second accumulator pattern.
- Stateless with respect to game data: every `tick()` call receives the current game snapshot and derives results from it.
- Does **not** modify any game state.
- Does **not** replace V4.1 or V4.2.
- Exposes `getCapability(factionId)` for the future action layer.
- `reset()` clears stored results (called on game load alongside V4.1/V4.2 resets).

### Why a separate accumulator (not on-demand from GoalService)

- Keeps V4.3 as an independent layer that the future Action layer can query at any time.
- Matches the existing V4.1/V4.2 timing pattern.
- Avoids coupling capability evaluation to goal-selection timing.
- The 2s cadence is already "infrequent enough" that a parallel accumulator is not wasteful.

---

## 3. Exact Capability Checks for Each Goal Type

### 3.1 COLONIZE

Derived from actual game mechanics (`PlanetBattleService.resolveUninhabitedArrival`):

| # | Requirement | Check | Failure reason |
|---|---|---|---|
| 1 | `colonizer_technology` | `researchService.isResearched(faction, 'basic_engineering')` | `no_colonizer_technology` |
| 2 | `colonizer_unlocked` | `researchService.isShipUnlocked(faction, 'colonizer')` | `colonizer_not_unlocked` |
| 3 | `colonizer_available` | Ship stock count > 0 **OR** any enemy fleet has a non-destroyed colonizer ship | `no_colonizer_available` |
| 4 | `usable_fleet` | At least one non-destroyed enemy fleet exists (fleet strength > 0 is implied by having ships) | `no_usable_fleet` |
| 5 | `target_valid` | Goal target system and planet still exist, planet factionId is `unhabited` | `target_invalid` |

**Rationale:**
- The actual colonization step needs a colonizer ship in the fleet. The ship can come from stock (requires assembly at a spaceport later) or already be in a fleet.
- A fleet is needed to transport the colonizer to the target.
- The target must still be colonizable.
- We do **not** check for spaceport availability here because the Action layer will handle assembly; capability only reports what is missing.

### 3.2 ATTACK

| # | Requirement | Check | Failure reason |
|---|---|---|---|
| 1 | `available_fleet` | At least one non-destroyed enemy fleet with ships exists | `no_available_fleet` |
| 2 | `target_valid` | Goal target fleet still exists, not destroyed, has ships, is a player fleet | `target_destroyed` |
| 3 | `fleet_can_engage` | At least one enemy fleet has `calculateFleetStrength() > 0` | `no_combat_capability` |

**Rationale:**
- Reuses the same `calculateFleetStrength` formula as V3/V4.1/V4.2 (implemented locally, no refactoring).
- Does **not** check distance or strength advantage (those are strategy-selection concerns, not capability).
- The "can reach target" requirement from the prompt is not applicable because the game has no pathfinding—fleet movement is direct target assignment.

### 3.3 DEFEND

| # | Requirement | Check | Failure reason |
|---|---|---|---|
| 1 | `available_fleet` | At least one non-destroyed enemy fleet with ships exists | `no_available_fleet` |
| 2 | `target_valid` | Goal target system/planet exists and planet is still owned by the faction | `target_lost` |
| 3 | `threat_present` | At least one player fleet is within `THREAT_DISTANCE` (5 cells) of the target system | `no_threat` |

**Rationale:**
- Defend requires a fleet to respond.
- The defended planet must still be owned by the faction.
- If the threatening player fleet has moved away, the goal is no longer actionable (though V4.2's validity predicate should already catch this, the capability layer reports it explicitly).

### 3.4 DEVELOP

| # | Requirement | Check | Failure reason |
|---|---|---|---|
| 1 | `always_executable` | Always `true` | *(none)* |

**Rationale:**
- The prompt explicitly states: "For now, `develop` can be considered executable without a special military capability."

---

## 4. How Missing Requirements Are Represented

The `CapabilityResult.requirements` array contains one entry per check. Each entry has:

```typescript
{
  type: 'colonizer_available',   // stable identifier for the Action layer
  satisfied: false,               // true if the check passed
  reason: 'no_colonizer_available' // stable reason code, useful for UI/logging
}
```

The future Action layer can:
- Read `canExecute` for a quick yes/no.
- Filter `requirements` where `satisfied === false` to see what is missing.
- Use the `reason` codes to decide how to obtain the missing capability (e.g., "missing colonizer → queue production or assemble from stock").

**No persistent AI state stores capability flags.** All checks are derived from the live game snapshot passed into `tick()`.

---

## 5. Integration with V4.1/V4.2

### Call chain (future architecture)

```
EnemyStrategyService.tick()        → strategy per faction
        ↓
EnemyGoalService.tick(strategy)    → goal per faction
        ↓
EnemyCapabilityService.tick(goal)  → capability per faction   [NEW V4.3]
        ↓
[Future] EnemyActionService         → executes actions
        ↓
EnemyAiService.tick()              → movement / battle (unchanged)
```

### Game loop integration (`StarMap.gameLoopCallback`)

After the existing goal-service loop, add a per-faction capability evaluation loop:

```typescript
for (const factionId of this.enemyFactionIds) {
  const goal = this.enemyGoalService.getGoal(factionId);
  this.enemyCapabilityService.tick(
    gameDeltaTime,
    goal,
    factionId,
    this.fleets,
    this.factions,
    this.starSystems,
    this.shipStock,
    this.production,
  );
}
```

### Reset integration (`StarMap.loadGame`)

```typescript
this.enemyAiService.reset();
this.enemyStrategyService.reset();
this.enemyGoalService.reset();
this.enemyCapabilityService.reset();   // [NEW]
```

### No changes to V4.1, V4.2, or V3

- V4.1 strategy selection is untouched.
- V4.2 goal selection and validity predicates are untouched.
- V3 movement/battle targeting is untouched.

---

## 6. Timing / Update Mechanism

### Accumulator pattern

Same as V4.1/V4.2:

```typescript
private readonly STRATEGY_TICK_INTERVAL = 2; // seconds of game time
private accumulator = 0;

tick(gameDeltaTime: number, ...): boolean {
  if (gameDeltaTime <= 0) return false;
  this.accumulator += gameDeltaTime;
  if (this.accumulator < this.STRATEGY_TICK_INTERVAL) return false;
  this.accumulator -= this.STRATEGY_TICK_INTERVAL;
  if (this.accumulator < 0) this.accumulator = 0;
  // ... evaluate ...
}
```

### Why this is acceptable

- Evaluated at most once every 2s per faction, same as strategy/goal.
- The service is read-only, so even if results lag behind a goal change by one accumulator cycle, no harm is done.
- No per-frame evaluation.
- Pause-safe (deltaTime = 0 short-circuits).

### Alternative considered: on-demand evaluation

- Evaluate capability only when the goal changes.
- **Rejected** because the future Action layer needs to be able to query `getCapability()` at any time and get a fresh result. An on-demand-only model would require the Action layer to know when to trigger re-evaluation. The accumulator model keeps the service self-contained.

---

## 7. Files to Create / Change

### Create
| File | Purpose |
|---|---|
| `src/app/components/star-map/enemy-capability.service.ts` | New `EnemyCapabilityService` with `tick()`, `getCapability()`, `reset()`. Injects `ResearchService`, `ShipService`, `ShipStockService`. |
| `src/app/components/star-map/enemy-capability.service.spec.ts` | Vitest / Angular TestBed tests for V4.3. |

### Modify
| File | Change |
|---|---|
| `src/app/components/star-map/star-map.models.ts` | Add `CapabilityRequirement` and `CapabilityResult` interfaces. |
| `src/app/components/star-map/star-map.ts` | Inject `EnemyCapabilityService`; call `tick()` in `gameLoopCallback` per faction; call `reset()` in `loadGame()`. |
| `docs/game-state.md` | Add section **4.14 Enemy Capability Layer (V4.3)** documenting the new layer. |

### Do NOT modify
- `enemy-strategy.service.ts` (V4.1)
- `enemy-goal.service.ts` (V4.2)
- `enemy-ai.service.ts` (V3)
- `research.service.ts`
- `ship-stock.service.ts`
- `fleet-assembly.service.ts`
- `spaceport.service.ts`
- `production.service.ts`
- Any battle, economy, or movement system

---

## 8. Test Plan

### Colonization (5 tests)
1. **All prerequisites satisfied** → `canExecute: true`, all requirements satisfied.
2. **Missing colonizer technology** → `canExecute: false`, `colonizer_technology` unsatisfied with reason `no_colonizer_technology`.
3. **Missing colonizer ship** (not unlocked) → `canExecute: false`, `colonizer_unlocked` unsatisfied with reason `colonizer_not_unlocked`.
4. **No colonizer in stock or fleet** → `canExecute: false`, `colonizer_available` unsatisfied with reason `no_colonizer_available`.
5. **No usable fleet** → `canExecute: false`, `usable_fleet` unsatisfied with reason `no_usable_fleet`.

### Attack (3 tests)
6. **Valid combat fleet** → `canExecute: true`, all requirements satisfied.
7. **No enemy fleet** → `canExecute: false`, `available_fleet` unsatisfied with reason `no_available_fleet`.
8. **Target destroyed** → `canExecute: false`, `target_valid` unsatisfied with reason `target_destroyed`.

### Defense (3 tests)
9. **Valid defense scenario** → `canExecute: true`, all requirements satisfied.
10. **No enemy fleet** → `canExecute: false`, `available_fleet` unsatisfied with reason `no_available_fleet`.
11. **Threat moved away** → `canExecute: false`, `threat_present` unsatisfied with reason `no_threat`.

### Develop (1 test)
12. **Develop goal** → `canExecute: true`, single `always_executable` requirement satisfied.

### General (4 tests)
13. **Deterministic** — identical inputs produce identical `CapabilityResult` objects (deep equality or JSON stringify).
14. **No state mutation** — input fleets, factions, starSystems, shipStock, production arrays are unchanged after `tick()`.
15. **Multi-faction independence** — `enemy1` and `enemy2` produce independent results from the same input state.
16. **Existing tests pass** — `enemy-strategy.service.spec.ts`, `enemy-goal.service.spec.ts`, `enemy-ai.service.spec.ts`, and all other existing specs remain passing.

### Edge cases
- `gameDeltaTime <= 0` → returns `false`, no evaluation performed.
- `goal === undefined` → returns `false`, no evaluation performed.
- Faction with `researchedTechnologies === undefined` → treated as no techs researched (colonizer not researched).
- Enemy fleet with only destroyed ships → treated as no usable fleet.
- Colonizer exists only in another faction's stock/fleet → not counted.

---

## 9. Edge Cases and Design Decisions

### 9.1 Enemy factions without researchedTechnologies
The seed data (`star-map-data.json`) does not include `researchedTechnologies` for enemy factions. `SaveGameService` backfills starting techs on load, but the capability service must handle `faction.researchedTechnologies ?? []` defensively.

### 9.2 Fleet strength formula duplication
The `calculateFleetStrength` formula is duplicated in V3, V4.1, and V4.2. Per the constraint "Do not refactor unrelated systems," V4.3 implements its own local copy of the formula. A future cleanup pass could extract it, but that is out of scope.

### 9.3 Colonizer in fleet vs. in stock
If the faction has a colonizer in an existing fleet, `colonizer_available` is satisfied. If only in stock, it is also satisfied (the Action layer would need to assemble it into a fleet). We do **not** check whether the fleet *containing* the colonizer is the same fleet that would do the colonizing, because fleet composition is mutable at the Action layer.

### 9.4 No pathfinding / reachability
The game has no pathfinding. Fleet movement is direct (`targetX`/`targetY`). Therefore V4.3 does **not** check whether a fleet "can reach" a target. That would require either pathfinding or a movement simulation, which does not exist in the codebase.

### 9.5 Goal undefined
When `EnemyGoalService` has no goal for a faction (`getGoal()` returns `undefined`), `EnemyCapabilityService.tick()` returns `false` and does not evaluate or store a result.

### 9.6 Cached results
Results are stored in a `Map<string, CapabilityResult>`. When `getCapability()` is called before `tick()` has produced a result for the current cycle, it returns the previous cycle's result (or `undefined` if none exists yet). This mirrors V4.1/V4.2 behavior.

---

## 10. Implementation Order

1. **Add types to `star-map.models.ts`** — `CapabilityRequirement` and `CapabilityResult`.
2. **Create `enemy-capability.service.ts`** — implement the service with all four goal-type evaluators.
3. **Create `enemy-capability.service.spec.ts`** — implement the 16 tests from the test plan.
4. **Modify `star-map.ts`** — inject service, call `tick()` and `reset()`, wire into game loop.
5. **Update `docs/game-state.md`** — add section 4.14 for V4.3.
6. **Run existing tests** — verify V4.1, V4.2, V3, and all other specs still pass.
7. **Run new tests** — verify all 16 V4.3 tests pass.

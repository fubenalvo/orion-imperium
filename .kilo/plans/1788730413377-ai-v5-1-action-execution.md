# AI V5.1 – Action Execution for `produce_colonizer`

## 1. Current Architecture Findings

- **EnemyActionService (V5)** evaluates and returns `ActionResult` objects (e.g., `produce_colonizer`, `assemble_fleet`, `move_to_target`). It does **not** mutate game state.
- **StarMap.gameLoopCallback** runs every RAF frame. Order of systems:
  1. `StarMapMovementService.updateFleets()`
  2. `EnemyAiService.tick()` (V3 target selection)
  3. `EnemyStrategyService.tick()` (V4.1)
  4. `EnemyGoalService.tick()` (V4.2)
  5. `EnemyCapabilityService.tick()` (V4.3)
  6. `EnemyActionService.tick()` (V5)
  7. Sensor visibility update
  8. `ProductionService.tick()`
  9. Economy tick
- **ProductionService.queueOrder()** is the canonical player pathway to start production. It validates ship type, planet factory capacity, faction existence, and credit affordability, then deducts cost up-front and enqueues a `ProductionOrder`.
- **ProductionService.tick()** advances orders, completes them, and pushes finished ships into the faction's global stock via `ShipStockService.addToStock()`.
- **Save/load**: `StarMapData.production` and `StarMapData.shipStock` are persisted in `SaveGameService`. `migrateSave()` backfills empty arrays for older saves.
- **Faction safety**: `EnemyActionService` hard-codes `enemyFactionIds = new Set(['enemy1', 'enemy2'])`.
- **Duplicate execution risk**: `EnemyCapabilityService` does **not** inspect production queues. `EnemyActionService.canProduceColonizer()` also does **not** check for pending colonizer orders. Without prevention, the executor would queue a new colonizer every 2 s of game time.

## 2. Recommended Executor Design

Create a new service:

```
src/app/components/star-map/enemy-action-executor.service.ts
```

**Name**: `EnemyActionExecutor`

**Responsibilities**:
- Read the current `ActionResult` from `EnemyActionService`.
- If the action is `produce_colonizer` and the faction is an AI faction, execute it by calling `ProductionService.queueOrder()`.
- If execution fails or preconditions are no longer met, do nothing.
- Log once on successful execution.

**Non-responsibilities**:
- Do not evaluate goals, capabilities, or actions (that stays in `EnemyActionService`).
- Do not execute any action type other than `produce_colonizer`.
- Do not touch fleets, stock, or movement directly.

**Public API**:
```ts
tick(
  gameDeltaTime: number,
  action: ActionResult | undefined,
  factions: Faction[],
  starSystems: StarSystem[],
  production: FactionProduction[],
  shipStock: FactionShipStock[],
  fleets: Fleet[],
): boolean
```

Returns `true` if an action was successfully executed.

## 3. Exact Integration Point in the Game Loop

Insert the executor call **immediately after** the action evaluation loop in `StarMap.gameLoopCallback` and **before** sensor visibility / production tick:

```ts
// After action evaluation loop (around line 1873)
let actionExecuted = false;
for (const factionId of this.enemyFactionIds) {
  const action = this.enemyActionService.getAction(factionId);
  actionExecuted = this.enemyActionExecutor.tick(
    gameDeltaTime,
    action,
    this.factions,
    this.starSystems,
    this.production,
    this.shipStock,
    this.fleets,
  ) || actionExecuted;
}

const visibilityChanged = this.updateSensorVisibility();
const productionResult = this.productionService.tick(...);
```

This keeps the executor on the same RAF loop, uses the same scaled `gameDeltaTime`, and respects pause (executor returns early when `deltaTime <= 0`).

## 4. Exact Production Execution Flow

1. Executor receives `ActionResult` with `type === 'produce_colonizer'`.
2. Verifies faction is AI-controlled (`enemy1` or `enemy2`).
3. Verifies the action is still executable at execution time (re-check conditions, because game state may have changed since evaluation):
   - Faction exists.
   - `basic_engineering` researched.
   - `colonizer` ship unlocked.
   - Faction can afford `colonizer.cost`.
   - At least one owned planet has `Spaceship Factory` capacity > 0.
4. Checks for duplicate prevention (see §6).
5. Selects a production planet (see §5).
6. Calls `ProductionService.queueOrder(this, factionId, planetId, 'colonizer', 1, starSystems, factions)`.
7. If `result.ok`, logs `[Enemy AI] {factionId} executed produce_colonizer at planet {planetName}` and returns `true`.
8. If `result` is not ok (e.g., insufficient resources, no factory), does nothing and returns `false`.

## 5. Planet / Factory Selection Rule

Deterministic, simple:

1. Iterate all star systems in ascending `system.id` order.
2. Within each system, iterate planets in ascending `planet.id` order.
3. Pick the **first** planet that:
   - `planet.factionId === factionId`
   - `ProductionService.getPlanetCapacity(planet, 'spaceship_factory') > 0`

This matches the existing convention used in `EnemyActionService.canProduceColonizer()` (which already iterates systems and planets) and provides stable tie-breaking without strategic scoring.

## 6. Duplicate-Execution Prevention

**Mechanism**: Before queuing, check whether the faction already has an active or pending `ProductionOrder` for `shipTypeId === 'colonizer'` in `production`.

Implementation:
```ts
private hasPendingColonizerOrder(
  production: FactionProduction[],
  factionId: string,
): boolean {
  const factionProd = production.find((p) => p.factionId === factionId);
  if (!factionProd) return false;
  return Object.values(factionProd.ordersByPlanet).some((orders) =>
    orders.some((order) => order.shipTypeId === 'colonizer'),
  );
}
```

If `hasPendingColonizerOrder` returns `true`, the executor does nothing.

This is sufficient because:
- The action evaluation runs every 2 s.
- Once an order is queued, it persists in `StarMapData.production` across save/load.
- The executor skips re-queueing until the order completes (or is cancelled/refunded).
- If the order is cancelled or refunded, the next evaluation/execution cycle can queue a new one.

No complex state machine is required.

## 7. State Mutation Boundaries

| Layer | Mutates state? | What it touches |
|---|---|---|
| `EnemyActionService` | **No** | Reads game state, returns `ActionResult`. |
| `EnemyActionExecutor` | **Yes** | Calls `ProductionService.queueOrder()` only. |
| `ProductionService` | **Yes** | Deducts credits, mutates `production` queue. |
| `ProductionService.tick()` | **Yes** | Advances orders, pushes ships to `shipStock`. |

`EnemyActionExecutor` must never:
- Modify `factions`, `starSystems`, `fleets`, or `shipStock` directly.
- Call `ShipStockService.addToStock()` directly.
- Assemble fleets.

## 8. Save / Load Implications

- **No special handling required.** `ProductionService.queueOrder()` writes into the `FactionProduction` object already stored on `StarMap.production`.
- `StarMap.serializeGameState()` already includes `production` and `shipStock`.
- `SaveGameService.migrateSave()` already backfills empty arrays.
- `StarMap.loadGame()` restores `this.production` and `this.shipStock` and calls `enemyActionExecutor.reset()` (or equivalent) if needed.

Because the duplicate-prevention check reads from the same `production` array, a reloaded order is correctly recognized as pending and no duplicate is created.

## 9. Files to Create / Change

### Create
- `src/app/components/star-map/enemy-action-executor.service.ts`
- `src/app/components/star-map/enemy-action-executor.service.spec.ts`

### Change
- `src/app/components/star-map/star-map.ts`
  - Inject `EnemyActionExecutor` in constructor.
  - Call executor in `gameLoopCallback` after action evaluation.
  - Include `actionExecuted` in the change-detection condition.
- `docs/game-state.md`
  - Update AI pipeline documentation to show Action Execution layer.
  - Note that V5.1 currently implements only `produce_colonizer`.

## 10. Test Plan

### Unit tests: `enemy-action-executor.service.spec.ts`

1. **AI faction can start colonizer production** when action is `produce_colonizer` and all conditions are met.
2. **Correct production order is created** — `ProductionService.queueOrder` called with `'colonizer'`, quantity `1`, correct planet.
3. **Correct faction receives the order** — faction ID matches the action's `factionId`.
4. **Correct planet/factory is selected** — deterministic lowest system/planet ID with factory capacity.
5. **Credits are deducted** through `ProductionService.queueOrder` (verify the mock was called, not the deduction logic itself).
6. **Locked colonizer cannot be produced** — when `isShipUnlocked` returns false, executor does nothing.
7. **Insufficient credits prevent execution** — when faction cannot afford, executor does nothing.
8. **No factory capacity prevents execution** — when no planet has capacity, executor does nothing.
9. **Player faction cannot be modified** — action with `factionId === 'player'` is ignored.
10. **Independent / unhabited factions cannot be modified** — ignored.
11. **Repeated execution does not create duplicates** — when a pending colonizer order already exists, executor skips.
12. **Execution does not create a fleet immediately** — verify `FleetAssemblyService` is never called.
13. **Execution does not add colonizer to stock directly** — verify `ShipStockService.addToStock` is never called by the executor.
14. **Existing production behavior remains unchanged** — player production queue is untouched by executor.
15. **Pause safety** — when `gameDeltaTime <= 0`, executor returns `false` without calling `queueOrder`.

### Integration test: `star-map.spec.ts` (extend existing EnemyActionService integration block)

Add a test covering:
```
strategy → goal → capability → action = produce_colonizer
→ executor → production order created
```

Use mocked services. Call `component['gameLoopCallback'](2)` and verify:
- `ProductionService.queueOrder` was called once for `enemy1` with `'colonizer'`.
- The production array on `StarMap` now contains the order.
- Console log contains `[Enemy AI] enemy1 executed produce_colonizer at planet`.

### Regression tests
- All existing `enemy-action.service.spec.ts` tests pass (EnemyActionService remains read-only).
- All existing `star-map.spec.ts` tests pass.
- No other action types are affected.

## 11. Edge Cases

- **Action changes between ticks**: The executor reads the action every frame. If the action flips from `produce_colonizer` to something else, the executor simply does nothing.
- **Credits drop after evaluation but before execution**: The executor re-checks `canAfford` via `ProductionService.queueOrder` (which returns `insufficient_resources`). The executor treats any non-ok result as a safe no-op.
- **Factory destroyed between evaluation and execution**: `queueOrder` returns `no_factory`. Executor no-ops.
- **Colonizer unlocked mid-game**: Once unlocked, the capability service updates, the action service starts returning `produce_colonizer`, and the executor begins queuing.
- **Production order completes**: Once `ProductionService.tick` finishes the order, the colonizer enters stock. The duplicate-prevention check no longer finds a pending order, so if the capability/action pipeline still wants a colonizer, a new order can be queued.
- **Multiple enemy factions**: Executor processes each faction independently using the same `actionChanged` loop pattern.

## 12. Implementation Order

1. Create `EnemyActionExecutor` service with `tick()` method.
2. Implement duplicate-prevention helper (`hasPendingColonizerOrder`).
3. Implement planet selection helper (`selectProductionPlanet`).
4. Implement execution guard (faction type, action type, re-check of preconditions).
5. Wire `EnemyActionExecutor` into `StarMap.gameLoopCallback`.
6. Add unit tests for `EnemyActionExecutor`.
7. Add integration test in `star-map.spec.ts`.
8. Update `docs/game-state.md` AI architecture section.
9. Run existing test suite to confirm no regressions.

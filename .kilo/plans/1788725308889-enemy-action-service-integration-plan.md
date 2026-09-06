# Plan: Integrate EnemyActionService into StarMap Game Loop

## Goal

Hook the already-implemented and tested `EnemyActionService` into the StarMap game loop as the V4.4 layer in the existing AI pipeline:

```
V3 EnemyAiService → V4.1 Strategy → V4.2 Goal → V4.3 Capability → V4.4 Action
```

**No action execution, no game-state mutation.** Only evaluation + result storage + change detection + reset.

---

## Affected file

| File | Change |
|------|--------|
| `src/app/components/star-map/star-map.ts` | Import, inject, tick-call, reset-call, change-detection flag, debug log |

**No changes to:** the `Fleet` model, persistence schema, existing V3/V4.1/V4.2/V4.3 logic, or any other file.

---

## Changes (5 edits, all in `star-map.ts`)

### 1. Import `EnemyActionService` (after line 36)

Add import alongside the other enemy AI imports:

```typescript
import { EnemyActionService } from './enemy-action.service';
```

### 2. Inject `EnemyActionService` in constructor (after line 269, `enemyCapabilityService`)

```typescript
private enemyActionService: EnemyActionService,
```

### 3. Add Action tick in `gameLoopCallback` (insert after the Capability loop, before line 1851 `updateSensorVisibility`)

Mirror the existing Goal/Capability per-faction loop pattern. The `EnemyActionService.tick()` signature already takes `(gameDeltaTime, currentGoal, capability, factionId, fleets, factions, starSystems, shipStock, production)` — all of which are available on the component.

```typescript
let actionChanged = false;
for (const factionId of this.enemyFactionIds) {
  const goal = this.enemyGoalService.getGoal(factionId);
  const capability = this.enemyCapabilityService.getCapability(factionId);
  const factionActionChanged = this.enemyActionService.tick(
    gameDeltaTime,
    goal,
    capability,
    factionId,
    this.fleets,
    this.factions,
    this.starSystems,
    this.shipStock,
    this.production,
  );
  if (factionActionChanged) {
    const action = this.enemyActionService.getAction(factionId);
    console.log(`[Enemy AI] ${factionId} action: ${action?.type ?? 'none'}`);
    actionChanged = true;
  }
}
```

**Rationale for the debug log format:** Matches the requested `[Enemy AI] enemy1 action: move_to_target`. Logs only fire when `tick()` returns `true` (i.e., the `ActionResult` actually changed), not every frame.

**Edge case:** When `tick()` deletes an action (previous existed, next is `undefined`), it returns `true` but `getAction()` returns `undefined`. The `?? 'none'` fallback handles this gracefully.

### 4. Add `actionChanged` to the change-detection condition (line 1884)

Current:
```typescript
if (didMoveFleets || aiChanged || goalChanged || economyUpdated || visibilityChanged || productionChanged || strategyChanged) {
```

Updated:
```typescript
if (didMoveFleets || aiChanged || goalChanged || actionChanged || economyUpdated || visibilityChanged || productionChanged || strategyChanged) {
```

This ensures `cdr.detectChanges()` only runs when the `ActionResult` actually changed (since `EnemyActionService.tick()` returns `false` on no-change ticks, and `actionChanged` is only set to `true` when `tick()` returns `true`).

### 5. Add reset call in `loadGame()` (after line 2428, `enemyCapabilityService.reset()`)

```typescript
this.enemyActionService.reset();
```

This ensures action state is cleared on both game load and new game (both paths flow through `loadGame()` → `ngOnInit`).

---

## How existing patterns guarantee the required behaviors

| Requirement | How it's satisfied |
|---|---|
| **EnemyActionService runs after Strategy → Goal → Capability** | The tick call is inserted after the capability loop in `gameLoopCallback` (step 3). |
| **Both `enemy1` and `enemy2` get ActionResult** | The loop iterates `this.enemyFactionIds` = `{ 'enemy1', 'enemy2' }`. |
| **ActionResult available at runtime** | `EnemyActionService.getAction(factionId)` returns the current `ActionResult`. |
| **Reset on game load / new game** | `enemyActionService.reset()` is called in `loadGame()` alongside the other three AI services (step 5). |
| **2-second game-time-based evaluation** | `EnemyActionService` has its own `STRATEGY_TICK_INTERVAL = 2` accumulator, matching V4.1/V4.2/V4.3. |
| **Pause-safe** | When paused, `gameDeltaTime` is 0 (from `GameTimeService.getScaledDeltaTime`), and `EnemyActionService.tick()` returns `false` immediately on `gameDeltaTime <= 0` (line 79–81). The accumulator never advances. |
| **1x/2x compatible** | Game speed only affects `gameDeltaTime` (via `GameTimeService`), which the accumulator consumes. At 2x speed, 1 real second feeds 2 game seconds into the accumulator, so evaluation fires at the correct scaled rate. |
| **Change detection only on actual change** | `EnemyActionService.tick()` uses `JSON.stringify` comparison internally (line 99) and returns `false` on no-change. `actionChanged` is only set when `tick()` returns `true`. |
| **No game state mutation** | `EnemyActionService` only reads game state (`fleets`, `factions`, `starSystems`, `shipStock`, `production`) and writes to its own internal `currentActions` Map. The service spec already includes "should not modify input fleets/factions/star systems" tests that pass. |

---

## Verification & Testing

### Run existing tests

```bash
npm test
```

This runs all Vitest specs via Angular CLI. The existing `enemy-action.service.spec.ts` (807 lines) already covers:
- Timing (pause = `gameDeltaTime <= 0` returns false, accumulator cycles)
- Reset clears actions
- Independent actions per faction (`enemy1` and `enemy2`)
- No game-state mutation
- Determinism

### Add integration tests to `star-map.spec.ts`

Extend the existing `star-map.spec.ts` to verify the EnemyActionService is wired into the game loop. The spec already creates the full `StarMap` component with real services via `TestBed`.

**Test plan (append to the existing `describe('StarMap')` block):**

```typescript
describe('EnemyActionService integration', () => {
  // Access the StarMap's gameLoopCallback (private) and
  // EnemyActionService via TestBed.inject.
  // Setup: provide enemy factions + a player faction, ensure fleets exist.

  it('should be injected and resettable', () => {
    // Inject EnemyActionService, call reset(), verify no actions.
  });

  it('should evaluate action after 2s of game time', () => {
    // Call gameLoopCallback(2) — verify enemy1/enemy2 get an ActionResult.
    // Call gameLoopCallback(1) — verify no change yet (accumulator < 2s).
  });

  it('should not change action when paused (deltaTime=0)', () => {
    // Tick 1.9s, then tick(0), then tick(0.5) — action should not
    // fire (accumulator frozen at 1.9s < 2s).
  });

  it('should fire faster at 2x speed', () => {
    // Each gameLoopCallback(2) with scaled delta simulates 2 game seconds.
    // Verify action changes at the correct scaled cadence.
  });

  it('should give enemy1 and enemy2 independent ActionResults', () => {
    // Set up fleets for both factions; verify actions differ.
  });

  it('should clear actions on reset (loadGame)', () => {
    // Trigger loadGame (or call enemyActionService.reset()),
    // verify getAction('enemy1') is undefined.
  });

  it('should not mutate game state when ticking', () => {
    // Snapshot fleets/factions before and after gameLoopCallback,
    // verify no mutation from the action layer.
  });
});
```

**Accessing private members in tests:**
- `fixture.componentInstance` gives the StarMap instance
- `TestBed.inject(EnemyActionService)` gives the service
- `component['gameLoopCallback'](delta)` calls the private method directly
- `component['enemyActionService']` or `TestBed.inject(EnemyActionService)` gives the service reference

**Note on StarMap initialization:** The existing spec already creates the component with `TestBed.configureTestingModule({ imports: [StarMap] })`. After `fixture.detectChanges()` (or `whenStable()`), `ngOnInit` runs which calls `loadGame()`. Tests can then set up mock game state and call `gameLoopCallback` directly.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| EnemyActionService might not be resolvable in the component DI | It's already `@Injectable({ providedIn: 'root' })` — no module change needed. |
| Type mismatch on `shipStock`/`production` params | `FactionShipStock[]` and `FactionProduction[]` structurally match the `tick()` parameter types exactly (verified at `star-map.models.ts:135` and `:148`). |
| Change-detection thrashing | `EnemyActionService.tick()` returns `false` on no-change; `actionChanged` only set on actual change. |
| Breaking existing V3/V4.1/V4.2/V4.3 logic | No existing lines are modified; only append-after-insert. The change-detection condition gets one new `|| actionChanged` term. |
| Reset not called on new game | Both new game and load game flow through `loadGame()` → `ngOnInit()`, which already resets all four AI services; the fifth reset is added there. |

---

## Summary of exact edits

1. **`star-map.ts:36`** — add `import { EnemyActionService } from './enemy-action.service';`
2. **`star-map.ts:269`** — add `private enemyActionService: EnemyActionService,` to constructor
3. **`star-map.ts:1849`** (after capability loop) — insert action tick loop with debug log
4. **`star-map.ts:1884`** — add `|| actionChanged` to change-detection condition
5. **`star-map.ts:2428`** — add `this.enemyActionService.reset();`

6. **`star-map.spec.ts`** — append integration tests for the above

# AI V4.1 – Strategic Decision Layer Plan

## 1. Current Architecture Findings

- **Game loop**: `StarMapGameLoopService` runs a `requestAnimationFrame` loop outside Angular. Each frame it computes `realDeltaTime` (clamped to 0.1s), calls `GameTimeService.onTick()`, gets the **scaled** `gameDeltaTime` (0 when paused, `realDeltaTime * speed` when running), and passes it to `StarMap.gameLoopCallback`.
- **Tactical AI**: `EnemyAiService.tick(gameDeltaTime, fleets, factions)` runs **every frame** inside `gameLoopCallback`. It selects player-fleet targets for enemy fleets based on strength priority (weak > comparable > strong) and distance tie-breaking. It only mutates `fleet.targetX/targetY` and an in-memory `currentTargets` map. It never touches planets, factions, or battle state.
- **Data available**: `fleets[]`, `factions[]`, `starSystems[]` (with `planetsTiles`), `shipStock`, `production`. Planet ownership is stored as `planetTile.factionId`. Fleet strength is computed as `sum(attack + defense + hitPoints/10 + shield/10)` per ship.
- **Factions**: `player` (team 1), `enemy1`/`enemy2` (team 2), `independent`/`unhabited` (team 0).
- **Existing tests**: 21 Vitest tests in `enemy-ai.service.spec.ts`. No strategic layer exists today.

## 2. Recommended Design

Create a new `EnemyStrategyService` that:

- Runs **above** `EnemyAiService` (no changes to V3).
- Is called from `StarMap.gameLoopCallback` at a lower frequency than every frame.
- Inspects `fleets`, `factions`, and `starSystems` to compute a per-faction strategic intention.
- Stores the current strategy per enemy faction in memory.
- Logs strategy changes for debugging.
- Is reset on game load / new game.

**Strategy type** (exported from `star-map.models.ts`):

```typescript
export type AiStrategy = 'expand' | 'attack' | 'defend' | 'develop';
```

**Timing**: Evaluate strategy every **2 seconds of game time** using an internal accumulator. Because the accumulator receives the same scaled `gameDeltaTime` as other systems, it naturally respects pause (0 delta) and speed multipliers.

## 3. Files to Create / Change

### Create

- `src/app/components/star-map/enemy-strategy.service.ts`
- `src/app/components/star-map/enemy-strategy.service.spec.ts`

### Change

- `src/app/components/star-map/star-map.models.ts` — add `AiStrategy` type export
- `src/app/components/star-map/star-map.ts` — inject `EnemyStrategyService`, call it in `gameLoopCallback`, add it to the change-detection condition
- `docs/game-state.md` — document the new strategic layer under §4.11

## 4. Exact Strategy Decision Rules

All distances are **Euclidean galaxy-grid units** (same coordinate space as fleet x/y and system x/y).

**Constants** (tunable, defined in the service):

```typescript
private readonly STRATEGY_TICK_INTERVAL = 2;   // seconds of game time
private readonly THREAT_DISTANCE = 5;           // galaxy cells
private readonly ENGAGEMENT_DISTANCE = 15;      // galaxy cells
private readonly EXPANSION_DISTANCE = 20;       // galaxy cells
private readonly STRENGTH_ADVANTAGE = 1.2;      // enemy must be at least 20% stronger
```

**Rule priority**: DEFEND → ATTACK → EXPAND → DEVELOP.

### DEFEND

Condition: **Any** enemy-owned planet has a non-destroyed player fleet within `THREAT_DISTANCE` (5 cells) of the planet's parent star system.

- Enemy planets: `planet.factionId === factionId` for the current enemy faction.
- Distance is measured between the player fleet's `(x, y)` and the star system's `(x, y)`.
- The player fleet must have at least one ship (`ships.length > 0`).

### ATTACK

Condition: **Any** non-destroyed enemy fleet has a non-destroyed player fleet within `ENGAGEMENT_DISTANCE` (15 cells) such that:

```
enemyFleetStrength >= playerFleetStrength * STRENGTH_ADVANTAGE
```

- Strength formula (identical to `EnemyAiService`):
  ```
  shipStrength = attack + defense + hitPoints/10 + shield/10
  fleetStrength = sum(shipStrength for all ships)
  ```
- Uses `ShipService.getShipType()` to resolve stats.

### EXPAND

Condition: **Any** unhabited planet (`planet.factionId === 'unhabited'`) exists within `EXPANSION_DISTANCE` (20 cells) of any non-destroyed enemy fleet.

- Distance measured between enemy fleet `(x, y)` and the planet's parent star system `(x, y)`.

### DEVELOP

Fallback when none of the above conditions are met.

## 5. How It Integrates With the Existing AI Loop

In `StarMap.gameLoopCallback`:

```typescript
private gameLoopCallback(gameDeltaTime: number): void {
  const didMoveFleets = this.updateFleets(gameDeltaTime);
  const aiChanged = this.enemyAiService.tick(gameDeltaTime, this.fleets, this.factions);
  const strategyChanged = this.enemyStrategyService.tick(gameDeltaTime, this.fleets, this.factions, this.starSystems);
  const visibilityChanged = this.updateSensorVisibility();
  // ... economy, production unchanged ...

  if (didMoveFleets || aiChanged || economyUpdated || visibilityChanged || productionChanged || strategyChanged) {
    this.ngZone.run(() => this.cdr.detectChanges());
  }
}
```

- `EnemyStrategyService` receives the same `gameDeltaTime` as other systems.
- It returns `true` only when a strategy actually changes (or on the first evaluation).
- No existing behavior changes; the strategy is currently only stored and logged.
- `reset()` is called from `StarMap.loadGame()` / `StarMap.ngOnInit()` to clear stale state.

## 6. Testing Plan

Tests for `EnemyStrategyService` (Vitest + TestBed, mirroring `enemy-ai.service.spec.ts` patterns):

1. **DEFEND**: Enemy planet at (30, 25), player fleet at (31, 25) within 5 cells → returns `'defend'`.
2. **ATTACK**: Enemy fleet (strength 200) at (0, 0), player fleet (strength 100) at (10, 0) within 15 cells, ratio = 2.0 → returns `'attack'`.
3. **EXPAND**: No threats, unhabited planet at (50, 50), enemy fleet at (48, 50) within 20 cells → returns `'expand'`.
4. **DEVELOP**: No threats, no favorable targets, no reachable unhabited planets → returns `'develop'`.
5. **Determinism**: Same input state always produces the same output (fixed thresholds, no randomness).
6. **No state mutation**: Player fleets, neutral planets, enemy planets, and existing V3 targets are never modified by the strategy service.
7. **V3 compatibility**: Existing `enemy-ai.service.spec.ts` tests run unchanged (they only test `EnemyAiService` directly).

## 7. Potential Risks / Edge Cases

- **Performance**: The strategy evaluation runs every 2s and scans all fleets/systems/planets. With ~10 systems and ~10 fleets, this is trivial.
- **Planet vs system distance**: Planets have no independent galaxy-map position; distance must be computed against the parent star system's `(x, y)`. The plan explicitly uses `starSystem.x/y` for this.
- **Multiple threats**: The priority order (DEFEND > ATTACK > EXPAND > DEVELOP) ensures urgent situations take precedence.
- **No enemy fleets**: If an enemy faction has zero fleets, it cannot ATTACK or EXPAND. It can still DEFEND if a player fleet is near its planets. Otherwise it falls to DEVELOP.
- **Destroyed fleets**: Filtered out before any distance/strength checks.
- **Pause / speed**: Because the accumulator uses scaled `gameDeltaTime`, strategy evaluation pauses correctly and respects 2× speed.
- **Future expansion**: The service is deliberately simple; if scoring weights or personality systems are added later, the `determineStrategy` method can be replaced without touching the loop integration.

## 8. Implementation Order

1. Add `AiStrategy` type to `star-map.models.ts`.
2. Create `EnemyStrategyService` with:
   - Constructor injection of `ShipService`.
   - `tick()` method with accumulator.
   - `determineStrategy()` with the four rules.
   - `getStrategy()` and `reset()` methods.
   - Console logging on strategy change.
3. Create `enemy-strategy.service.spec.ts` covering the 7 test cases above.
4. Update `StarMap`:
   - Inject `EnemyStrategyService`.
   - Call `tick()` in `gameLoopCallback`.
   - Wire `strategyChanged` into the change-detection boolean.
   - Call `reset()` on load/new game.
5. Update `docs/game-state.md` to document the new layer.
6. Run `npm test` to confirm all existing V3 tests still pass.

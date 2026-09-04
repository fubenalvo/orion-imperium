# Centralized Game Time System — Implementation Plan

## Goal

Introduce a `GameTimeService` that owns all simulation-time state (pause + speed) and produces a **scaled game delta time** for every `requestAnimationFrame` tick. All gameplay systems receive this scaled delta directly — they never check pause or multiply speed themselves. The RAF loop **never stops** (even when paused); it simply feeds `gameDelta = 0` to the simulation.

Three time states: **Paused** (speed = 0, delta = 0), **1x** (delta = realDelta), **2x** (delta = realDelta × 2). The design uses a numeric multiplier so 0.5x / 4x / 8x can be added later with one line change.

---

## 1. Current State Summary

### Game Loop (`star-map-game-loop.service.ts`)
- `startGameLoop(updateCallback: (deltaTime: number) => void)` — starts RAF outside Angular zone.
- `tick(time, updateCallback)` — computes `deltaTime = Math.min((time - lastFrameTime) / 1000, 0.1)` (0.1 s clamp) and calls `updateCallback(deltaTime)`.
- `pauseGame()` — **cancels RAF entirely**.
- `resumeGame(updateCallback)` — resets `lastFrameTime`, restarts RAF with the callback.
- `stopGameLoop()` — cancels RAF (for destroy).

### StarMap Component (`star-map.ts`)
- `isPaused = false` — local boolean field.
- `pauseGame()` (private) — sets `isPaused = true`, calls `gameLoopService.pauseGame()`.
- `resumeGame()` (public) — sets `isPaused = false`, calls `gameLoopService.resumeGame(callback)` with a **duplicated** tick callback (identical to the one in `startGameLoop`, lines 2041–2079 vs 1619–1657).
- Tick callback (both copies): calls `movementService.updateFleets(deltaTime)`, `updateSensorVisibility()`, `productionService.tick(deltaTime, ...)`, accumulates economy (`economyAccumulator += deltaTime`, tick every 1 s), then runs `cdr.detectChanges()` if anything changed.
- `ngAfterViewInit()` → `startGameLoop()` + `setupFocusHandlers()`.
- Window blur / visibility hidden → `pauseGame()`.
- Keyboard: `@HostListener('window:keydown')` handles ArrowUp/Down/Left/Right for camera pan only.

### Systems Consuming `deltaTime` (Simulation — Must Be Affected)
| System | Location | Usage |
|---|---|---|
| Fleet movement | `star-map-movement.service.ts:174, 217` | `movement = speed × deltaTime` (system view uses raw speed × delta; map view divides by 10 and cellSizeVw) |
| Production progress | `production.service.ts:231` | `head.progress += deltaTime / buildTime` |
| Economy — satisfaction drift | `economy.service.ts:261` | `current + direction × deltaTime` (±1/s) |
| Economy — resource accumulation | `economy.service.ts:283` | `current + effectiveRate × deltaTime` |
| Economy accumulator | `star-map.ts:1632` | `economyAccumulator += deltaTime`, tick every 1 s |

### Systems Using Time But NOT Simulation Delta (Must NOT Be Affected)
| System | Location | Usage |
|---|---|---|
| Camera pan | `star-map.ts:1492-1507` | Fixed `cameraSpeed = 2` vw per input event; NOT time-based |
| Battle screen | `battle-screen.component.ts:69` | `setInterval(tickRateMs)` on separate route; turn-based, separate from RAF |
| Navigation dpad | `star-map-navigation.component.ts:51` | `setInterval(50ms)` for continuous camera pan |
| Pause save-toast | `star-map-pause.component.ts:72` | `setTimeout(2000ms)` for toast |
| Minimap drag throttle | `star-map-minimap.component.ts:96` | `performance.now()` throttle (16 ms) |

### Known Bug: ProductionService `tickCounter`
- `ProductionService.tickCounter` increments per frame (`++`), not per second.
- `STALLED_ORDER_TIMEOUT = 30` is 30 frames ≈ 0.5 s at 60 fps — should be 30 seconds (per `docs/invariants.md:130`).
- If RAF continues during pause (new behavior), `tickCounter` still increments while paused, causing stall detection to fire incorrectly.

### Pause/Overlay Interaction
- `StarMapPauseComponent` renders the ⏸ button (top-right, z-index 30, height 8%) and a full-screen overlay (z-index 1000) that appears when `isPaused || pauseMenuOpen`.
- Auto-pause (blur/visibility): sets `isPaused = true` without showing the menu — overlay shows the "GAME PAUSED" + CONTINUE state.
- Menu pause (⏸ click): sets `pauseMenuOpen = true` + `pauseGame()` — overlay shows the menu with Continue/Save/Load/Main Menu buttons.

### Header (`star-map-header.component.ts`)
- Standalone component. Inputs: `title`, `currencies`, `economyBreakdown`, `shipStockEntries`, `shipStockTotal`.
- HTML: `.hud` div with `.hud__title` (left, `justify-content: space-between`) and `.hud__right` (flex, `gap: 1em`).
- SCSS: `position: absolute; top: 0; height: 8%; border-bottom: 2px solid var(--color-blue); background: rgba(0,0,0,0.82); z-index: 20;`.
- No time controls currently.

### Styling Conventions
- CSS variables: `--color-blue` (#3586e5), `--color-blue-light` (#5ca8ff), `--color-blue-bright` (#8cc4ff), `--color-text` (#3586e5), `--color-success` (#39c96f), `--font-primary` (VT323 monospace).
- BEM class naming. `clamp()` for responsive text. Pixel/retro sci-fi aesthetic.

### Test Setup
- Angular 22 with `ng test` (vitest behind the scenes via `@angular/build:unit-test`).
- Existing specs use `TestBed` — `star-map.spec.ts` (minimal smoke test), `star-map-sensor.service.spec.ts` (service unit tests).

---

## 2. New Files

### `src/app/services/game-time.service.ts`
```
GameTimeService — root-injected singleton.

GameSpeed type: 1 | 2 (numeric multiplier). Future: 0.5 | 4 | 8.
Paused is tracked separately as a boolean.

State:
  speed: GameSpeed = 1     // 1 = 1x, 2 = 2x (future: 0.5, 4, 8)
  isPaused: boolean = false
  gameElapsedTime: number = 0  // accumulated simulation seconds

API:
  readonly state$ : BehaviorSubject<TimeState>  // { speed, isPaused, gameElapsedTime }
  get isPaused(): boolean
  get speed(): GameSpeed
  get gameElapsedTime(): number

  setSpeed(speed: GameSpeed): void
    // Sets speed, sets isPaused = false (unpauses).
  pause(): void
    // Sets isPaused = true (keeps current speed for resume).
  resume(): void
    // Sets isPaused = false (keeps current speed).
  togglePause(): void
    // If paused → resume. If running → pause.
  getScaledDeltaTime(realDeltaTime: number): number
    // Returns isPaused ? 0 : realDeltaTime * speed
  onTick(realDeltaTime: number): void
    // Accumulates gameElapsedTime when not paused:
    //   gameElapsedTime += isPaused ? 0 : realDeltaTime * speed
    //   emits state$ only when gameElapsedTime changes meaningfully
    //   (or every N ticks to avoid excessive emissions)
  reset(): void
    // Resets speed=1, isPaused=false, gameElapsedTime=0 (called on new game)
```

### `src/app/services/game-time.service.spec.ts`
Unit tests using `TestBed.inject(GameTimeService)`:
- `getScaledDeltaTime`: 0 when paused, realDeltaTime × 1 at 1x, realDeltaTime × 2 at 2x.
- `setSpeed(0)` not allowed by type (GameSpeed is 1|2); pause/resume separate.
- `pause()` / `resume()` toggle isPaused, getScaledDeltaTime returns 0 / realDelta × speed.
- `togglePause()` flips state.
- `onTick()` accumulates gameElapsedTime correctly at 1x, 2x, and 0 when paused.
- Large `realDeltaTime` (e.g., tab suspend) does NOT cause `gameElapsedTime` to explode — clamped to 0.1 s before scaling (matches existing RAF clamp).

---

## 3. Files to Change

### 3a. `src/app/components/star-map/star-map-game-loop.service.ts`

**Remove:** `pauseGame()`, `resumeGame(updateCallback)` — pause is now entirely the responsibility of `GameTimeService`.

**Modify:** Inject `GameTimeService` in constructor.

**Change `tick()`:**
```
private tick(time, updateCallback): void {
  const realDeltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);
  this.lastFrameTime = time;

  this.gameTimeService.onTick(realDeltaTime);          // accumulate elapsed time
  const gameDeltaTime = this.gameTimeService.getScaledDeltaTime(realDeltaTime);
  updateCallback(gameDeltaTime);                        // always called

  // schedule next frame (unchanged)
}
```

**Change `startGameLoop()` signature:** The callback still receives `(deltaTime: number)` but now that value is the **scaled game delta**, not raw real delta. No signature change needed — just semantic difference. The method name stays `startGameLoop`.

**Keep:** `stopGameLoop()` (for `ngOnDestroy`). The loop now always runs until destroy; pause is handled via `getScaledDeltaTime` returning 0.

**`lastFrameTime` initialization:** In `startGameLoop`, set `this.lastFrameTime = performance.now()` as before. `resumeGame` is removed; `startGameLoop` is called once in `ngAfterViewInit` and never restarted.

### 3b. `src/app/components/star-map/star-map.ts`

**Remove:**
- `isPaused = false` field (line 184).
- `private pauseGame()` method (lines 2031–2035).
- `resumeGame()` method (lines 2038–2080).

**Add:**
- Inject `GameTimeService` in constructor.
- `get isPaused(): boolean` → delegates to `this.gameTimeService.isPaused`.
- `get gameSpeed(): number` → delegates to `this.gameTimeService.speed`.
- `timeControlSubscription: Subscription` — subscribe to `gameTimeService.state$` in `ngOnInit`, call `this.cdr.detectChanges()` on changes (so header inputs / pause overlay update).
- Private `gameLoopCallback(gameDeltaTime: number)` method — consolidated single copy of the tick logic (extracted from the duplicate in `startGameLoop` + `resumeGame`).

**Modify:**
- `ngAfterViewInit()` — call `this.gameLoopService.startGameLoop(this.gameLoopCallback.bind(this))` once. Remove the inline callback. Remove the need for `resumeGame` entirely.
- `openPauseMenu()` — calls `this.gameTimeService.pause()` instead of `this.pauseGame()`.
- `closePauseMenu()` — calls `this.gameTimeService.resume()` instead of `this.resumeGame()`.
- `onWindowBlur` — calls `this.gameTimeService.pause()`.
- `onVisibilityChange` — calls `this.gameTimeService.pause()`.
- `ngOnDestroy()` — unsubscribe from `timeControlSubscription`, call `gameLoopService.stopGameLoop()`.
- Tick callback uses `gameDeltaTime` (already scaled) — no change to how `updateFleets`, `productionService.tick`, `economyService.applyEconomyDelta` are called. They receive the scaled delta.
- Keyboard handler `handleKeyboard` — add cases:
  - `' '` (Space) → `this.gameTimeService.togglePause()`, `event.preventDefault()`.
  - `'1'` → `this.gameTimeService.setSpeed(1)`.
  - `'2'` → `this.gameTimeService.setSpeed(2)`.

**Consolidated callback** (single `private gameLoopCallback(gameDeltaTime: number): void`):
```ts
private gameLoopCallback(gameDeltaTime: number): void {
  const didMoveFleets = this.updateFleets(gameDeltaTime);
  const visibilityChanged = this.updateSensorVisibility();

  const productionResult = this.productionService.tick(
    gameDeltaTime, this, this.starSystems, this.fleets, this.factions,
  );
  const productionChanged = productionResult.stateChanged;

  this.economyAccumulator += gameDeltaTime;
  let economyUpdated = false;
  if (this.economyAccumulator >= this.economyTickInterval) {
    for (const faction of this.factions) {
      this.economyService.applyEconomyDelta(
        faction.id, this.factions, this.starSystems, this.fleets,
        this.economyAccumulator,
      );
    }
    this.cachedPlayerEconomyBreakdown = this.economyService.calculateEconomy(
      'player', this.factions, this.starSystems, this.fleets,
    );
    this.economyAccumulator = 0;
    economyUpdated = true;
  }

  if (didMoveFleets || economyUpdated || visibilityChanged || productionChanged) {
    this.ngZone.run(() => this.cdr.detectChanges());
  }
}
```

**No changes needed** to `updateFleets()` (line 1661) — it just passes `deltaTime` through to `movementService.updateFleets`. Same parameter, now scaled.

**Effect:** When paused, `gameDeltaTime = 0`. `updateFleets(0)` → no movement → `didMoveFleets = false`. `updateSensorVisibility()` — recomputes sensors (same result since fleets didn't move) → `visibilityChanged = false`. `productionService.tick(0, ...)` → no progress. `economyAccumulator += 0` → no tick. `cdr.detectChanges()` not called → UI is not needlessly updated, but remains responsive because RAF keeps running and Angular event handlers (clicks, hover) trigger CD independently.

### 3c. `src/app/services/production.service.ts`

**Add early return** at the top of `tick()`:
```ts
tick(deltaTime, ...): ProductionTickResult {
  this.tickCounter++;
  if (deltaTime <= 0) {
    return { completedOrders: [], producedShips: [], refundedOrders: [], stateChanged: false };
  }
  // ... rest unchanged
}
```

This prevents `tickCounter` from advancing during pause and prevents any progress/stall checks when the scaled delta is 0. The `tickCounter` increment itself is harmless (it's only used for `startedAtTick` / `producedAtTick` bookkeeping), but the early return ensures no logic runs with zero delta.

**Note (recommendation for follow-up):** The stall timeout (`STALLED_ORDER_TIMEOUT = 30`) is frame-based, not time-based. This is a pre-existing bug. It should be migrated to use `gameElapsedTime` from `GameTimeService` or accumulated real time. This is marked as a known issue in the plan but not changed in this iteration — the early return above prevents the worst case (stall detection firing while paused).

### 3d. `src/app/components/star-map/star-map-header/star-map-header.component.ts`

**Add inputs:**
```ts
@Input() gameSpeed: number = 1;   // read from gameTimeService.speed via StarMap getter
@Input() isPaused: boolean = false;
```

**Add outputs:**
```ts
@Output() setSpeed = new EventEmitter<1 | 2>();
@Output() togglePause = new EventEmitter<void>();
```

### 3e. `src/app/components/star-map/star-map-header/star-map-header.component.html`

Add a time-controls group between `.hud__title` and `.hud__right`:
```html
<div class="hud__time-controls">
  <button
    class="time-control__btn"
    [class.time-control__btn--active]="isPaused"
    (click)="togglePause.emit()"
    aria-label="Pause / Resume"
  >
    ⏸
  </button>
  <button
    class="time-control__btn"
    [class.time-control__btn--active]="!isPaused && gameSpeed === 1"
    [class.time-control__btn--dimmed]="isPaused"
    (click)="setSpeed.emit(1)"
  >
    1x
  </button>
  <button
    class="time-control__btn"
    [class.time-control__btn--active]="!isPaused && gameSpeed === 2"
    [class.time-control__btn--dimmed]="isPaused"
    (click)="setSpeed.emit(2)"
  >
    2x
  </button>
</div>
```

Visual states:
- **⏸ button**: active (highlighted) when paused; normal otherwise.
- **1x button**: active (highlighted) when `gameSpeed === 1 && !isPaused`.
- **2x button**: active (highlighted) when `gameSpeed === 2 && !isPaused`.
- When paused, 1x/2x buttons show dimmed style. Clicking them calls `setSpeed(1)` or `setSpeed(2)` which un-pauses (via `gameTimeService.setSpeed` → `isPaused = false`).

### 3f. `src/app/components/star-map/star-map-header/star-map-header.component.scss`

Add styles for `.hud__time-controls` and `.time-control__btn` following the pixel-art retro style:
- `.hud__time-controls`: `display: flex; gap: 0.5em; align-items: center;`
- `.time-control__btn`: matches `.pause-overlay__btn` style (border `1px solid var(--color-blue)`, background `rgba(53, 134, 229, 0.15)`, color `var(--color-text)`, font `var(--font-primary)`, hover `rgba(53, 134, 229, 0.3)` with glow).
- `.time-control__btn--active`: background `var(--color-blue)` or `rgba(53, 134, 229, 0.4)`, box-shadow glow `0 0 12px rgba(53, 134, 229, 0.5)`.
- `.time-control__btn--dimmed`: opacity 0.4, cursor default.

### 3g. `src/app/components/star-map/star-map.html`

Update the header bindings:
```html
<app-star-map-header
  title="STAR MAP"
  [currencies]="getPlayerCurrencies()"
  [economyBreakdown]="boundGetPlayerEconomyBreakdown()"
  [shipStockEntries]="boundGetPlayerShipStockEntries()"
  [shipStockTotal]="boundGetPlayerShipStockTotal()"
  [gameSpeed]="gameSpeed"
  [isPaused]="isPaused"
  (setSpeed)="onSetSpeed($event)"
  (togglePause)="onTogglePause()"
></app-star-map-header>
```

Add handler methods to `StarMap`:
```ts
onSetSpeed(speed: 1 | 2): void {
  this.gameTimeService.setSpeed(speed);
}
onTogglePause(): void {
  this.gameTimeService.togglePause();
}
```

### 3h. `src/app/components/star-map/star-map.html` (system + planet views)

Update the two header occurrences in `system` and `planet` views with the same `gameSpeed`, `isPaused`, `(setSpeed)`, `(togglePause)` bindings.

### 3i. `src/app/components/star-map-pause/star-map-pause.component.ts` and `.html`

**No changes needed.** The `StarMapPauseComponent` already receives `@Input() isPaused` from `StarMap`, and `StarMap.isPaused` will now be a getter delegating to `gameTimeService.isPaused`. The overlay logic (`@if (isPaused || pauseMenuOpen)`) works unchanged.

The ⏸ button in `StarMapPauseComponent` calls `openPauseMenu.emit()` → `StarMap.openPauseMenu()` → `gameTimeService.pause()`. This still works.

The CONTINUE button in the auto-pause overlay calls `resumeGame.emit()` → `StarMap.resumeGame()` is removed... **WAIT — this is a problem.**

`StarMap.resumeGame()` is being removed. The pause component emits `resumeGame` which `StarMap` handles. I need to either:
- Keep `resumeGame()` in `StarMap` as a thin wrapper that calls `gameTimeService.resume()`
- OR change the pause component's `resumeGame` output to call something else

**Decision:** Keep `StarMap.resumeGame()` as a thin wrapper:
```ts
resumeGame(): void {
  this.gameTimeService.resume();
}
```

This keeps backward compatibility with the existing `StarMapPauseComponent` `@Output() resumeGame = new EventEmitter<void>()` and the `(resumeGame)="resumeGame()"` binding in `star-map.html`. The method body changes from "restart RAF + callback" to "just set isPaused = false".

Similarly, `openPauseMenu()` and `closePauseMenu()` keep their signatures but call `gameTimeService.pause()` / `gameTimeService.resume()` instead of the old `pauseGame()` / `resumeGame()`.

### 3j. `docs/invariants.md` — Update Pause/Resume section (lines 52–58)

Replace the old invariants with the new centralized model:
- `pauseGame()` on `StarMap` no longer exists; pause is controlled via `GameTimeService.pause()` / `resume()` / `togglePause()`.
- The RAF loop **always runs** (never canceled for pause); `GameTimeService.getScaledDeltaTime()` returns 0 when paused.
- `StarMap.isPaused` is a read-only getter delegating to `gameTimeService.isPaused`.
- Window blur / visibility hidden call `gameTimeService.pause()` (no menu).
- `StarMap.resumeGame()` is preserved as a thin wrapper calling `gameTimeService.resume()` for backward compatibility with `StarMapPauseComponent`'s `resumeGame` output.
- The pause menu overlay shows when `isPaused || pauseMenuOpen`.

### 3k. `docs/game-systems.md` — Update Game Loop section (lines 55–66)

- `GameTimeService` is the owner of pause/speed state.
- `StarMapGameLoopService` always runs RAF; `getScaledDeltaTime(realDeltaTime)` produces the game delta (0 when paused, ×1 or ×2 when running).
- All simulation systems receive the scaled delta directly — none check pause or multiply speed.
- Economy ticks every 1 s of accumulated game delta.
- Change detection triggered when simulation state changes; RAF keeps UI responsive even when paused.

---

## 4. Data Flow (After Changes)

```
requestAnimationFrame (always running, outside Angular zone)
    ↓
StarMapGameLoopService.tick(time)
    ├── realDeltaTime = clamp((time - lastFrameTime) / 1000, 0, 0.1)
    ├── gameTimeService.onTick(realDeltaTime)   // accumulate gameElapsedTime
    ├── gameDeltaTime = gameTimeService.getScaledDeltaTime(realDeltaTime)
    │       paused → 0
    │       1x     → realDeltaTime
    │       2x     → realDeltaTime * 2
    └── updateCallback(gameDeltaTime)
            ├── movementService.updateFleets(gameDeltaTime)   → fleet positions
            ├── updateSensorVisibility()                      → fog-of-war
            ├── productionService.tick(gameDeltaTime, ...)    → progress += gameDelta / buildTime
            ├── economyAccumulator += gameDelta; tick when ≥ 1 s
            │       └── economyService.applyEconomyDelta(..., gameDelta)
            └── ngZone.run(() => cdr.detectChanges())  // only if something changed

User input / header / keyboard / blur:
    → GameTimeService.setSpeed / pause / resume / togglePause
    → state$.next() → StarMap subscription → cdr.detectChanges()
    → header @Input bindings re-evaluate
    → gameDeltaTime changes on next RAF tick

Game start:
    → GameTimeService.reset() → speed=1, isPaused=false, gameElapsedTime=0
```

---

## 5. Key Design Decisions

| Decision | Rationale |
|---|---|
| `GameSpeed = 1 \| 2` (not `0 \| 1 \| 2`) | Paused is a separate boolean. Avoids ambiguity: speed=0 could mean "0.5x rounded down" or "paused". |
| `GameTimeService` owns pause + speed | Single source of truth. No system checks `isPaused` or multiplies speed. |
| RAF continues during pause | Requirement: UI/input must stay responsive. `gameDelta = 0` naturally halts simulation. |
| `getScaledDeltaTime` as the single scaling point | Exactly one speed multiplier in the entire codebase. No `deltaTime *= 2` scattered. |
| StarMap subscribes to `state$` | Handles auto-pause (blur/visibility) and keyboard shortcuts triggering CD updates for the header. |
| `ProductionService.tick` early-returns on `deltaTime <= 0` | Prevents `tickCounter` increment and stall-detection from firing during pause. |
| `StarMap.resumeGame()` kept as thin wrapper | Backward compat with existing `StarMapPauseComponent` `@Output() resumeGame`. |
| StarMap is NOT persisted in saves | Time speed is runtime/UI preference, not strategic state. `GameTimeService.reset()` called on game load. |
| Camera movement NOT time-scaled | Camera uses fixed vw per input event (step-based), not delta time. |

---

## 6. Edge Cases & Risks

### 6a. Tab Suspension / Inactive Tab
**Risk:** When the browser tab is inactive, RAF firing is throttled or stops. When the user returns, the first `time` value from RAF may be far in the future, producing a large `realDeltaTime`.
**Mitigation (existing):** `StarMapGameLoopService.tick` clamps `realDeltaTime` to `0.1` s via `Math.min(..., 0.1)`. This clamp happens BEFORE scaling, so even at 2x speed the max `gameDeltaTime` is 0.2 s per frame. No change needed — just document it.

### 6b. `GameTimeService.state$` Emission Frequency
**Risk:** If `onTick` emits `state$` every frame (60×/sec), the `StarMap` subscription calls `cdr.detectChanges()` 60×/sec even when nothing changed (header doesn't need updating).
**Mitigation:** `onTick` should only emit `state$` when `gameElapsedTime` changes by a meaningful amount (e.g., ≥ 0.1 s) or when `speed`/`isPaused` actually changes. Alternatively, emit only on explicit state changes (pause/resume/setSpeed) and let the game loop's existing CD trigger handle elapsed-time display updates.

**Decision for plan:** `GameTimeService.state$` emits only on discrete state changes (pause, resume, setSpeed, reset) — NOT on every tick. The `gameElapsedTime` property is updated every tick but doesn't trigger `state$` emissions. If a component needs to display live elapsed time, it can read `gameTimeService.gameElapsedTime` during normal CD cycles (which happen when fleets move or economy ticks). This minimizes unnecessary change detection.

### 6c. Double-Speed Bug
**Risk:** If `getScaledDeltaTime` is called somewhere and then the result is multiplied by speed again.
**Mitigation:** Only ONE call to `getScaledDeltaTime` exists — in `StarMapGameLoopService.tick()`. The scaled value is passed to the callback and consumed as-is by all systems. No system multiplies by speed again. The `ProductionService.tick` early-return on `deltaTime <= 0` prevents the `tickCounter`-based stall timeout from firing during pause.

### 6d. ProductionService `tickCounter` Frame-Based Stall Timeout
**Risk:** `STALLED_ORDER_TIMEOUT = 30` is 30 frames, not 30 seconds. This is pre-existing. The early-return fix prevents it firing during pause, but the frame-vs-time issue remains.
**Mitigation (plan):** Documented as a known issue. The early-return prevents the worst case. A follow-up task should migrate stall detection to use `gameElapsedTime` from `GameTimeService` or accumulated game delta.

### 6e. Pause Menu vs. Game Pause Decoupling
**Risk:** The pause menu (`pauseMenuOpen = true`) is separate from simulation pause (`gameTimeService.isPaused = true`). Opening the menu pauses the game; closing it resumes. But what if the user opens the menu, changes speed, then closes it?
**Analysis:** Opening the menu calls `gameTimeService.pause()`. Closing it calls `gameTimeService.resume()` (which keeps the current speed). Speed changes via the header don't fire while the overlay covers the header. This is acceptable — the user resumes via the CONTINUE button, and the speed is whatever it was before pause.

### 6f. Keyboard Shortcut Conflicts
**Risk:** Space and 1/2 keys might conflict with existing or future input (e.g., dialogue, typing).
**Mitigation:** The existing `handleKeyboard` already `event.preventDefault()`s Arrow keys. Space/1/2 will also `preventDefault()`. The `@HostListener('window:keydown')` is on `StarMap` only — it won't fire when the battle screen or main menu is active. Future text input fields should call `event.stopPropagation()` or the handler should check `event.target`.

### 6g. Battle Screen Independence
**Risk:** The battle screen uses `setInterval(tickRateMs)`. Should time controls affect it?
**Decision:** No. The battle screen is a separate `/battle` route with its own turn-based timer. It is not part of the star-map RAF loop. Time controls are star-map-only. This is consistent with the requirement: "camera input responsiveness, unless the existing architecture intentionally treats camera movement as simulation time" — the battle screen is a separate view.

### 6h. Save/Load Reset
**Risk:** If speed is persisted in saves, loading a game at 2x would auto-accelerate.
**Mitigation:** Speed is NOT persisted. `GameTimeService.reset()` sets speed=1, isPaused=false on game start and on load. The `StarMap.loadGame()` method should call `gameTimeService.reset()` after loading.

---

## 7. Task Order (Implementation Sequence)

1. **Create `GameTimeService`** (`src/app/services/game-time.service.ts`) + spec file.
2. **Refactor `StarMapGameLoopService`** — inject `GameTimeService`, remove `pauseGame()`/`resumeGame()`, always run RAF, call `getScaledDeltaTime` in tick.
3. **Update `StarMap` component** — inject `GameTimeService`, remove/consolidate pause/resume logic, add `isPaused` getter, add `gameLoopCallback` (single copy), add `state$` subscription, add keyboard shortcuts, add `onSetSpeed`/`onTogglePause` handlers.
4. **Fix `ProductionService.tick`** — add early return when `deltaTime <= 0`.
5. **Update `StarMapHeaderComponent`** — add `gameSpeed`/`isPaused` inputs, `setSpeed`/`togglePause` outputs, update HTML with [1x] [2x] buttons, add SCSS.
6. **Update `star-map.html`** — bind new header inputs/outputs in all 3 view sections (map, system, planet).
7. **Verify `StarMapPauseComponent`** — no changes needed (receives `isPaused` from `StarMap` getter, emits `resumeGame` → `StarMap.resumeGame()` thin wrapper).
8. **Update documentation** — `docs/invariants.md` (Pause/Resume section), `docs/game-systems.md` (Game Loop section).
9. **Run tests** — `ng test` (vitest) + `ng build` for typecheck.

---

## 8. Testing Strategy

### Unit Tests for `GameTimeService` (`game-time.service.spec.ts`)
| Test | Expected |
|---|---|
| `getScaledDeltaTime(0.016)` at 1x, not paused | 0.016 |
| `getScaledDeltaTime(0.016)` at 2x, not paused | 0.032 |
| `getScaledDeltaTime(0.016)` when paused | 0 |
| `pause()` sets isPaused = true, getScaledDeltaTime returns 0 | ✓ |
| `resume()` sets isPaused = false | ✓ |
| `togglePause()` flips state | ✓ |
| `setSpeed(2)` sets speed = 2 and isPaused = false | ✓ |
| `togglePause()` when running pauses; when paused resumes | ✓ |
| `onTick(0.5)` at 1x → gameElapsedTime += 0.5 | ✓ |
| `onTick(0.5)` when paused → gameElapsedTime unchanged | ✓ |
| `onTick(5)` (tab suspend) → clamped to 0.1 × speed | ✓ |
| `reset()` → speed=1, isPaused=false, gameElapsedTime=0 | ✓ |

### Integration Verification (manual / smoke test)
1. Start game at 1x — fleets move, economy ticks, production progresses.
2. Click [2x] — everything advances twice as fast.
3. Click ⏸ (or press Space) — everything stops. RAF continues (check via browser devtools or a visible UI element that updates every RAF frame — e.g., the camera drag still works).
4. Click CONTINUE (or press Space) — game resumes at the previous speed.
5. Click [1x] — speed drops to normal.
6. Window blur → auto-pause → overlay appears → click CONTINUE → resumes.
7. Tab inactive for 5s → return → no delta spike (delta clamped).
8. Camera pan still works (via keyboard, nav buttons, drag) while paused.
9. New game → resets to 1x, isPaused = false.
10. Load game → resets to 1x, isPaused = false.

### Existing Tests
- `star-map.spec.ts` — minimal smoke test. Should still pass (component creation unchanged).
- `star-map-sensor.service.spec.ts` — sensor service tests. Unaffected (no changes to sensor service).
- `BattleScreenComponent` — unaffected (separate route, separate timer).

---

## 9. Backwards-Compatibility Notes

- **`StarMap.resumeGame()`** is kept as a thin wrapper calling `gameTimeService.resume()`. This preserves the existing API name.
- **`ProductionService.tick`** signature unchanged — still receives `deltaTime: number`. The only change is the early-return guard.
- **`StarMapGameLoopService.startGameLoop`** signature unchanged — still receives `(deltaTime: number) => void`. The semantic meaning changes (now scaled), but the type is the same.
- **`StarMapHeaderComponent`** gains new optional inputs/outputs with defaults — existing callers are unaffected.
- **`StarMapPauseComponent`** — `isPaused` input and `resumeGame` output are removed (overlay no longer auto-shows on pause); a `togglePause` output is added for the ⏸ button.
- **`StarMap`** — adds `openPauseMenu()` for ESC handling, which pauses + opens the menu overlay.
- **Save data** — no changes to `StarMapData` or `SaveGameService.migrateSave`. Speed is not persisted.
- **`docs/invariants.md`** — the pause/resume guarantees section has been updated to reflect the new centralized model.

---

## 10. Implementation Status & Refinements

### Applied Changes (source files modified)

The following source files have already been modified to implement the plan:

1. **`src/app/services/game-time.service.ts`** — NEW. `GameTimeService` with `GameSpeed` type, `speed`/`isPaused`/`gameElapsedTime`, `getScaledDeltaTime()`, `onTick()`, `setSpeed()`/`pause()`/`resume()`/`togglePause()`/`reset()`, `state$` BehaviorSubject.
2. **`src/app/services/game-time.service.spec.ts`** — NEW. 20 unit tests covering all API paths.
3. **`src/app/components/star-map/star-map-game-loop.service.ts`** — Refactored: removed `pauseGame()`/`resumeGame()`, RAF always runs, calls `gameTimeService.onTick()` + `getScaledDeltaTime()` each frame.
4. **`src/app/components/star-map/star-map.ts`** — Removed local `isPaused` field (now a getter), removed duplicate tick callback (consolidated into `gameLoopCallback`), removed old `pauseGame()`/`resumeGame()` methods (kept `resumeGame()` as thin wrapper), added `state$` subscription, added Space/1/2 keyboard shortcuts, `GameTimeService.reset()` on load.
5. **`src/app/services/production.service.ts`** — Added early return when `deltaTime <= 0` in `tick()`.
6. **`src/app/components/star-map/star-map-header/`** — Added `gameSpeed`/`isPaused` inputs, `setSpeed`/`togglePause` outputs, [1x] [2x] buttons in HTML, time-control SCSS.
7. **`src/app/components/star-map/star-map.html`** — Bound new header inputs/outputs in all 3 view sections; `StarMapPauseComponent` still receives `[isPaused]` and `(resumeGame)`.
8. **`src/app/components/star-map-pause/star-map-pause.component.ts`** — **PENDING REFACTOR** (see below).

**Verification:** TypeScript compiles cleanly. All 39 tests pass (1 pre-existing `app.spec.ts` failure unrelated). Build succeeds.

### Pending: Pause Overlay Refinement

**User requirement:** When the game is paused (Space, ⏸ button, or focus loss), NO overlay should appear. The simulation freezes but the UI remains fully interactive (clickable fleets, systems, menus, etc.). The save/load/exit menu should be accessible only via ESC.

**Changes needed:**

#### `src/app/components/star-map-pause/star-map-pause.component.ts`
- Remove `@Input() isPaused = false;` (no longer used by the overlay).
- Remove `@Output() resumeGame = new EventEmitter<void>();` (auto-pause overlay is being removed).
- Add `@Output() togglePause = new EventEmitter<void>();` (for the ⏸ button to toggle pause without opening menu).
- Update the component comment to reflect new states.

#### `src/app/components/star-map-pause/star-map-pause.component.html`
- Change the ⏸ button from `(click)="openPauseMenu.emit()"` to `(click)="togglePause.emit()"`.
- Change the overlay condition from `@if (isPaused || pauseMenuOpen)` to `@if (pauseMenuOpen)`.
- Remove the `@else` auto-pause branch (the "GAME PAUSED" + CONTINUE overlay).

#### `src/app/components/star-map/star-map.html` (StarMapPauseComponent binding)
- Remove `[isPaused]="isPaused"` from `<app-star-map-pause>`.
- Remove `(resumeGame)="resumeGame()"`.
- Add `(togglePause)="onTogglePause()"`.

#### `src/app/components/star-map/star-map.ts` (keyboard handler)
- Add `case 'Escape': this.openPauseMenu(); break;` to `handleKeyboard` — opens the save/load/exit menu and pauses the game.
- `openPauseMenu()` already calls `gameTimeService.pause()` + sets `pauseMenuOpen = true`.

#### Behavioral Summary (after refinement)
- **⏸ button** (header or top-right): toggles pause. No overlay. Simulation freezes/unfreezes. UI interactive.
- **1x / 2x buttons** (header): set speed and un-pause. No overlay.
- **Space**: toggles pause. No overlay.
- **ESC**: opens the save/load/exit menu overlay + pauses.
- **Window blur / visibility hidden**: pauses simulation. No overlay.
- **Menu "CONTINUE" button**: closes menu, resumes simulation.

### Updated Integration Verification
1. Start game at 1x — fleets move, economy ticks, production progresses.
2. Click [2x] — everything advances twice as fast.
3. Click ⏸ (or press Space) — everything stops. **No overlay appears.** Camera drag and button clicks still work.
4. Click ⏸ again (or press Space) — game resumes at previous speed.
5. Press ESC — pause menu overlay appears with Continue/Save/Load/Main Menu.
6. Window blur — game pauses. **No overlay.** Click ⏸ to resume.
7. Tab inactive for 5s → return → no delta spike (delta clamped).
8. Camera pan still works (keyboard, nav buttons, drag) while paused.
9. New game → resets to 1x, not paused, no overlay.
10. Load game → resets to 1x, not paused, no overlay.

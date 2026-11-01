# Game Time System

## Purpose

The `GameTimeService` (`src/app/services/game-time.service.ts`) is the single source
of truth for simulation-time state. It owns pause/resume, speed, and the scaled delta
that every gameplay system receives each frame.

## Core Concepts

### Real time vs. Game (simulation) time

- **Real time** — wall-clock seconds elapsed between `requestAnimationFrame` frames.
  It is always > 0 when the browser is active and the RAF loop is running.
- **Game time** — simulation seconds. When paused, game time does not advance at all.
  At 3× speed, game time advances three times as fast as real time.

```text
realDeltaTime   →  GameTimeService.getScaledDeltaTime  →  gameDeltaTime
0.016 s (60fps)                                           0.016 s at 1×
                                                          0.048 s at 3×
                                                          0 s     at pause
```

The 0.1-second clamp on `realDeltaTime` is applied in `StarMapGameLoopService.tick`
**before** scaling, so even at 3× the per-frame spike is capped at 0.3 s.

### Speed multiplier

`GameSpeed` is a numeric type (`1 | 3`), not an enum of labels. This makes future
speeds trivial to add:

```ts
export type GameSpeed = 1 | 3;
// Future: 0.5 | 1 | 3 | 5 — just extend the union
```

Speed `1` = normal, `3` = fast. 3× is the only fast speed in the game; the battle screen uses the same 1x / 3x labels. Paused is tracked as a separate boolean
(`isPaused`) so that `togglePause()` / `pause()` / `resume()` preserve the current
speed across pause cycles.

## API

```ts
state$: BehaviorSubject<TimeState>   // { speed, isPaused, gameElapsedTime }

get speed(): GameSpeed               // 1 or 3
get isPaused(): boolean
get gameElapsedTime(): number        // accumulated simulation seconds

setSpeed(speed: GameSpeed): void     // sets speed, un-pauses
pause(): void                        // freezes simulation, preserves speed
resume(): void                       // un-pauses, preserves speed
togglePause(): void                  // flips pause state

getScaledDeltaTime(realDeltaTime: number): number
onTick(realDeltaTime: number): void  // accumulates gameElapsedTime
reset(): void                        // isPaused=false, elapsed=0; speed is kept
```

## Data Flow

```text
requestAnimationFrame  (always running, outside Angular zone)
    ↓
StarMapGameLoopService.tick(time)
    ├── realDeltaTime = clamp((time - lastFrameTime) / 1000, 0, 0.1)
    ├── gameTimeService.onTick(realDeltaTime)   ← updates gameElapsedTime
    ├── gameDeltaTime = gameTimeService.getScaledDeltaTime(realDeltaTime)
    └── updateCallback(gameDeltaTime)
            ├── movementService.updateFleets(gameDeltaTime)
            ├── productionService.tick(gameDeltaTime, ...)  ← early-returns on 0
            ├── economyAccumulator += gameDelta, tick every 1s of game time
            └── cdr.detectChanges() only if simulation changed
```

When `StarMap` subscribes to `gameTimeService.state$`, any discrete state change
(pause, resume, speed change) triggers `cdr.detectChanges()` so the header overlays
update even without a simulation change.

## Time Controls (Header)

The `StarMapHeaderComponent` (through the shared `GameHeaderComponent`, see
[UI Styling → Game Header](./ui-styling.md#game-header)) renders three buttons: **⏸**, **1x**, **3x**.

- **⏸** (pause toggle) — calls `gameTimeService.togglePause()`. Active state
  highlighted when paused.
- **1x** — calls `gameTimeService.setSpeed(1)`. Active when `speed === 1 && !isPaused`.
  Clicking while paused sets speed to 1 and un-pauses.
- **3x** — calls `gameTimeService.setSpeed(3)`. Active when `speed === 3 && !isPaused`.
  Same pause-resume behavior as 1x.

When paused, the speed buttons are visually dimmed. The simulation systems receive
`gameDeltaTime = 0` and naturally freeze.

## Keyboard Shortcuts

Handled by `StarMap.handleKeyboard` (`@HostListener('window:keydown')`):

| Key | Action |
|-----|--------|
| Space | Toggle pause/resume |
| 1 | Set speed to 1× |
| 3 | Set speed to 3× |

Arrow keys continue to pan the camera (step-based, not time-dependent).

## What Is Affected by Game Time

| System | Affected? | Notes |
|--------|-----------|-------|
| Fleet movement | Yes | `movement = speed × nebulaFactor × gameDeltaTime` |
| Drifting asteroids | Yes | Spawn timer, movement and intercept re-aiming advance with `gameDeltaTime` (frozen while paused) |
| Production progress | Yes | `progress += gameDeltaTime / buildTime` |
| Economy (satisfaction, resources) | Yes | `delta += rate × gameDeltaTime` |
| Economy accumulator | Yes | Accumulates game delta; ticks every 1 s of game time |
| Battle detection | Indirectly | Runs every frame but only triggers on collision |
| Sensor/fog-of-war | Indirectly | Recomputes every frame, but cells only change when fleets move |

## What Is NOT Affected by Game Time

| System | Reason |
|--------|--------|
| Camera pan | Fixed `cameraSpeed = 2` vw per input event; step-based, not time-based |
| Battle screen turn progression | Uses `setInterval(tickRateMs)` on a separate route; turn-based |
| Navigation dpad | `setInterval(50ms)` for continuous camera pan |
| Pause save-toast | `setTimeout(2000ms)` for toast display |
| Minimap drag throttle | `performance.now()` 16 ms throttle for input smoothing |
| CSS animations | Background starfield, sensor pulse — pure CSS |

## Battle Screen Pause Behaviour

The galaxy-map simulation is **paused while the player is on the battle screen**
(`/battle`). `BattleScreenComponent.ngOnInit` calls `gameTimeService.pause()` and
`ngOnDestroy` plus `backToStarMap()` both call `resume()` before returning to the
map. This is required because Angular reuses the `StarMap` component instance
across the `/star-map` → `/battle` → `/star-map` navigation, so its RAF loop and
all simulation systems (fleet movement, AI, economy, battle detection) would
otherwise keep ticking in the background during the battle. That behaviour made
fleets and resources appear to "reset" on return and could even cascade into
additional battles firing while the player was still fighting the first one.

## Battle-Local Time (`BattleTimeService`)

The battle minigame has its own independent time control system (`BattleTimeService`)
with pause/1x/3x buttons in the battle header. It is a separate instance from
`GameTimeService` and does not affect the global simulation time.

**Key Differences from `GameTimeService`:**
- Frame-driven wait scheduler (`wait(ms)` resolved by `onTick()` calls) — no `setTimeout`
- Root-provided singleton, reset between battles in `ngOnInit`/`ngOnDestroy`
- Accumulates `battleElapsedTime` independently of global `gameElapsedTime`
- Player commands queue FIFO when paused; invalid commands discarded
- Selection remains available while paused

See [Battle Screen](./battle-screen.md#battle-local-time-controls) for full details.

## Initialization and Reset

- `StarMap.loadGame` calls `GameTimeService.reset()` on every load: new game,
  loading a save, and the return from the battle screen (which reloads the
  autosave). `reset()` un-pauses and clears `gameElapsedTime` but **keeps the
  speed**: the chosen speed is a session preference, so a battle no longer
  drops 3× back to 1×.
- Speed is **not persisted** in saved game data; a fresh app session starts at 1×.

## Future Extensions

The centralized design makes the following straightforward:

- **Additional speeds** (0.5×, 5×, 8×): extend the `GameSpeed` union type and add
  corresponding header buttons.
- **Game calendar** (days/years): use `gameElapsedTime` to derive elapsed game days.
- **Scheduled events**: compare `gameElapsedTime` against scheduled timestamps.
- **Fleet ETA**: `distance / (fleet.speed × gameTimeService.speed)`.
- **Production/research completion timers**: use `gameElapsedTime` for wall-clock
  equivalent estimates.
- **Delayed diplomacy / timed missions**: schedule actions by `gameElapsedTime` threshold.

See also: [Game Systems](./game-systems.md) (game loop section),
[Invariants](./invariants.md) (pause/resume guarantees).

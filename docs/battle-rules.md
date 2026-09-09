# Battle Rules

The battle system is a **fully self-contained tactical minigame**. It receives two fleets
(attacker, defender) and returns a winner, surviving ships, and destroyed ships. It never
touches galaxy map logic, system map logic, economy, production, research, AI strategy,
strategic fleet movement, or save/load internals. See the [Architecture](./architecture.md)
and [Game Systems](./game-systems.md) docs for the input/output contract between StarMap and
the minigame.

## Battle Types

| Type | Defender | Trigger |
|---|---|---|
| Fleet vs Fleet | Enemy fleet | `StarMapBattleDetectionService` — hostile fleets on the same galaxy grid cell |
| Fleet vs Planet | Planet defenses | `StarMapPlanetArrivalService` — a non-teammate fleet stops on a defended enemy planet |

The **trigger conditions** are unchanged from the strategic side (see `docs/game-state.md`
§4.6). The tactically significant difference is in resolution: see below.

## Input / Output Contract (unchanged boundaries)

- **Input:** `StarMap` calls `BattleService.setBattle()` (or `setPlanetBattle()`, which sets
  `type = 'planet'`), saves, and navigates to `/battle`. The `Battle` transport object is
  passed through to `BattleScreenComponent`, which deep-clones the two fleets into
  battle-local state.
- **Output:** on "Back to Star Map", the minigame writes its `BattleOutcome` to
  `BattleService.setBattleResult()` and, when a *real* fleet was wiped out, the loser fleet
  id via `BattleService.setDestroyedFleetId()`. `BattleScreenComponent.backToStarMap()` then
  patches the **AUTOSAVE slot** (per-ship `currentHp`/`destroyed` rosters + wiped-out flag +
  planet ownership). `StarMap` applies it on the next `/star-map` navigation via
  `reloadAfterBattle()` → `removeDestroyedFleetFromService()`.

The active session is always backed by the AUTOSAVE slot, so battle results accumulate with
every earlier battle; a fleet destroyed in an earlier battle stays destroyed after a later
battle returns to the map.

## Tactical Grid

- 18 columns × 7 rows of 5vw cells — the **rendered** dimensions of the System View grid
  (`_star-map-system-view.scss`). Concepts (1-indexed cells, 5vw cell size,
  `floor(vw / 5) + 1` conversion) are reused; the minigame keeps its own constants
  (`battle.types.ts`) so it does not import `StarMapMovementService`.
- The attacker deploys on the left columns (1–2, expanding to 3 if needed); the defender
  deploys on the right columns (17–18, expanding to 16). Rows fill centre-out from row 4.
- Planet-defense buildings deploy as stacks in the defender columns with `immobile = true`.

## Ships and Stacks

- A **stack** is the tactical unit for movement, targeting, and selection. Every ship type in
  a side is grouped into one or more stacks, each holding at most `MAX_STACK_SIZE = 5` ships;
  e.g. 12 fighters become 3 stacks (5/5/2).
- Visually a stack renders up to 5 ship icons as a cluster inside its cell, a `×N` badge
  when N ≥ 2, and an aggregate hull bar. Clicking a stack selects the whole stack.
- Individual ship HP is tracked inside the stack. Damage is applied ship-by-ship in order;
  overkill spills to the next ship. When the last ship dies the stack is destroyed and
  removed from the grid.

## Action Points

Each side gets a shared pool of `AP_PER_TURN = 10` per turn. A ship's AP cost is its **size
tier** (derived from `ship-data.json`):

| Tier | Move AP / cell | Attack AP | Ships (cost) |
|---|---|---|---|
| 1 | 1 | 1 | scout (50), fighter (75), colonizer (100), corvette (120) |
| 2 | 2 | 2 | frigate (180), destroyer (260) |
| 3 | 3 | 3 | cruiser (400), carrier (500) |
| 4 | 4 | 4 | battleship (700), battlecruiser (750) |
| 5 | 5 | 5 | dreadnought (1200) |

The existing `speed` stat is the ship's movement range per turn; the existing `range` stat is
its attack range. With 10 AP per turn this reproduces the design intent: 5 fighters can each
move a cell and attack (10 AP), while 2 frigates consume most of the turn's AP.

## Movement

- Grid-based, 8-direction straight-line steps. One move command relocates a stack to a
  target cell up to its remaining move range away; every intermediate cell must be in bounds
  and unoccupied (no pathfinding).
- Moving costs `tier` AP per cell and is capped at `speed` cells per turn per stack.
- Immobile stacks (planet-defense buildings) cannot move.
- The stack's grid position is committed when the animation starts (CSS tween plays the
  move); the **animation lock** holds the turn until the tween finishes, so END TURN and all
  input are blocked during movement.

## Combat

- A stack may attack once per turn, costing `attackAp = tier` AP.
- Target must be an enemy stack within `range` (Euclidean: `dx² + dy² ≤ range²`, matching the
  project-wide sensor-range convention documented in `docs/invariants.md`).
- **Damage = whole-stack volley:** `totalAttack = Σ attack of alive ships in the firing
  stack`; `damage = max(1, totalAttack − frontTargetShip.defense)` — the same
  `max(1, attack − defense)` rule the strategic battle used, now aggregated over the stack.
  Defense is per-ship (the front target ship's `defense`), not summed.
- Damage is applied to the target stack's ships in order; overkill spills across ships. A
  stack with no alive ships is destroyed.
- Each attack appends a `BattleLogEntry` (round, side, stacks, damage, kills).

## Turn Lifecycle

```
deploy → ATTACKER TURN (10 AP) → END TURN → DEFENDER TURN (10 AP) → END TURN → round++ → ...
```

1. Attacker always acts first.
2. The active side spends AP on Move / Attack until it presses END TURN (or, for a
   non-player side, the tactical AI plays the turn automatically).
3. END TURN is only enabled when `BattleAnimationService.isBusy === false` — i.e. no ship is
   moving, no projectile is travelling, and no hit/explosion animation is playing.
4. `endTurn()` flips the active side, refills AP to `AP_PER_TURN`, resets each stack's
   `cellsMovedThisTurn` / `attackedThisTurn` for the new side, and increments the round when
   control returns to the attacker.
5. Victory is checked after every attack and at the end of every turn: the side with zero
   alive stacks loses; the battle ends with a winner declared.

## Non-Player Control

- The side whose `factionId !== 'player'` is controlled by a deterministic, greedy
  [tactical AI](./architecture.md) (`BattleAiService`). It lives entirely inside the
  battle-screen module and has no knowledge of the strategic `enemy-*` AI layers.
- AI plan per turn: (1) every in-range stack attacks its nearest enemy, (2) remaining stacks
  move toward the nearest enemy up to their move range, (3) stacks that moved into range
  attack again. Planet-defense buildings never move.

## Animation / State Locking

`BattleAnimationService` holds a single in-flight counter plus a `busy` signal:

- Every move and every attack is wrapped in `anim.run(fn)`, which balances a `begin()`/`end()`
  pair around the animation even if `fn` throws.
- The END TURN button is `[disabled]` while busy.
- The view, the input handlers, the movement/combat services, and the AI all re-check the busy
  flag, so a race in any one layer cannot advance state mid-animation.
- `ticks$` emits after every mid-animation state change (projectile → impact → explosion) so
  the OnPush view re-renders effect phases without polling.

## Outcome

The minigame returns a `BattleOutcome`:

- `winnerSide` / `winnerFleetId` / `loserFleetId`
- per-side rosters in input order with final `hp` and `destroyed` flags, plus `survivors`
  and `wipedOut`
- `rounds` and the `battleType` / `planetId`

## Limitations / Out of Scope

- No weapon-type effectiveness: `attackType`, `weakness`, and `shield` / `shieldRegen` are
  loaded but **not applied** in damage calculation (consistent with the prior implementation).
- No critical hits, evasion, or random factors — combat is deterministic.
- A virtual defense fleet (negative fleet id) never persists; only the attacker's real roster
  is written back after a planet battle. A garrisoned fleet parked on the planet is not
  touched (pre-existing simplification preserved).
- Leaving a battle mid-combat is not offered: BACK only appears once a winner is decided.

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

- 18 columns × 7 rows of 4vw cells (72vw × 28vw). Concepts (1-indexed cells, grid
  coordinates) are reused from the System View; the minigame keeps its own constants
  (`battle.types.ts`) so it does not import `StarMapMovementService`.
- The attacker deploys on the left columns (`ATTACKER_DEPLOY_COLS = 1, 2, 3, 4`); the
  defender deploys on the right columns (`DEFENDER_DEPLOY_COLS = 18, 17, 16, 15`). Rows
  fill centre-out from row 4.
- Planet-defense buildings deploy as `immobile = true` stacks in the **outermost defender
  column (18) first**, then overflow inward. Garrison stacks fill the remaining defender
  cells behind them. See [Planet Battles](#planet-battles).

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

Each side gets a shared pool of `AP_PER_TURN = 50` per turn. A stack's AP cost is derived
from its size tier (`Math.ceil(tier * 1.5)`):

| Tier | Move AP / cell | Attack AP | Ships (cost) |
|---|---|---|---|
| 1 | 2 | 2 | scout (50), fighter (75), colonizer (100), corvette (120) |
| 2 | 3 | 3 | frigate (180), destroyer (260) |
| 3 | 5 | 5 | cruiser (400), carrier (500) |
| 4 | 6 | 6 | battleship (700), battlecruiser (750) |
| 5 | 8 | 8 | dreadnought (1200) |

The `speed` stat is the ship's movement range per turn; the `range` stat is its attack
range. Virtual defense buildings (turrets) are tier 3, immobile, and use their building
definition's `range` for attacks.

## Movement

- Grid-based, 8-direction straight-line steps. One move command relocates a stack to a
  target cell up to its remaining move range away; every intermediate cell must be in bounds
  and unoccupied (no pathfinding).
- Moving costs `moveApPerCell` AP per cell and is capped at `moveRange` cells per turn per
  stack.
- Immobile stacks (planet-defense buildings) cannot move.
- The stack's grid position is committed when the animation starts (CSS tween plays the
  move); the **animation lock** holds the turn until the tween finishes, so END TURN and all
  input are blocked during movement.

## Combat

- A stack may attack once per turn, costing `attackAp` AP.
- Target must be an enemy stack within `range` (Euclidean: `dx² + dy² ≤ range²`, matching the
  project-wide sensor-range convention documented in `docs/invariants.md`).
- **Damage = whole-stack volley:** `totalAttack = Σ attack of alive ships in the firing
  stack`; `raw = max(1, totalAttack − frontTargetShip.defense)`. Defense is per-ship (the
  front target ship's `defense`), not summed.
- Weapon effectiveness scales raw damage by the attacker's `attackType` vs the front target
  ship's `weakness` using the table in `battle-grid.ts`: each attacker type has one strong
  matchup (1.5×), one neutral matchup (1.0×), and one resisted matchup (0.5×). The target's
  own `weakness` type is the resisted matchup. `max(1, floor(...))` keeps the damage floor.
- Shield absorbs damage before hull: each ship's own `shield` absorbs first; only overflow
  reaches hull HP. A stack with no alive ships is destroyed.
- Each attack appends a `BattleLogEntry` (round, side, stacks, gross volley damage, kills).

## Planet Battles

- A planet with defensive buildings spawns a virtual defender fleet (`id = -planet.id`) made
  of immobile turret stacks plus any garrison ships.
- `planetary_shield` buildings do **not** become ships. They grant one shared planetary
  shield pool:
  - `max` = sum of all shield-building `shield` values.
  - `current` starts at `max`.
  - It absorbs damage for **immobile turret stacks only**; garrison ships use their own
    per-ship shields.
  - At the start of each **defender turn**, the pool regenerates by the sum of all
    shield-building `shieldRegen` values, capped at `max`.
- The planet visual is presentation-only and never part of `BattleStack` or combat state.
  It is rendered separately by the battle grid, using the planet's name and type color.

## Turn Lifecycle

```
deploy → ATTACKER TURN (50 AP) → END TURN → DEFENDER TURN (50 AP) → END TURN → round++ → ...
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

- No critical hits, evasion, or random factors — combat is deterministic.
- The shared planetary shield generator is not a targetable unit; only its pool is part of
  the battle. Garrison ships are intentionally not protected by the shared pool.
- A virtual defense fleet (negative fleet id) never persists; only the attacker's real roster
  is written back after a planet battle. A garrisoned fleet parked on the planet is not
  touched (pre-existing simplification preserved).
- Leaving a battle mid-combat is not offered: BACK only appears once a winner is decided.

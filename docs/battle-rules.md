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

Battles are **real-time, speed-based** — there are no Action Points. Stacks move continuously at their
`speed` stat (vw/s, range 1–5 from `ship-data.json`). Both sides are active simultaneously; the
animation busy lock gates attacks only, not movement.

The `speed` stat is the ship's movement speed in vw/s. The `range` stat is its attack range.
Virtual defense buildings (turrets) are immobile (speed 0) and use their building definition's
`range` for attacks.

## Movement

- Real-time, grid-based 8-direction straight-line movement. One move command sets a stack's vw
  target; the RAF game loop interpolates the stack toward that target at `speed` vw/s. No AP cost,
  no move range limit — any reachable cell with a clear path is valid.
- Every intermediate cell along the path must be in bounds and unoccupied (no pathfinding through
  obstacles).
- Stacks can move while attacks are animating on other stacks; movement is never blocked by the
  animation lock.
- Immobile stacks (planet-defense buildings) cannot move.

## Combat

- A stack may attack freely, including while it is moving — there is no per-stack or per-turn
  attack limit. The only gate is the animation busy lock (no other animation in flight on that
  stack).
- Target must be an enemy stack within `range` at the moment the attack starts. Range is measured
  from the stacks' current absolute `x/y` centers in VW, not from their `col/row` anchors:
  `distanceVw <= attackRange * BATTLE_CELL_SIZE_VW`. The comparison is Euclidean and inclusive at
  the exact boundary.
- A projectile captures the attacker and target `x/y` positions when firing starts. It does not
  track a target that moves during the animation.
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
  - `current` starts at the persisted value on the planet tile (`shieldPoolCurrent`),
    or `max` if no persisted value exists (first battle after placement).
  - It absorbs damage for **immobile turret stacks only**; garrison ships use their own
    per-ship shields.
  - At the start of each **defender turn**, the pool regenerates by the sum of all
    shield-building `shieldRegen` values, capped at `max`.
- The planet visual is presentation-only and never part of `BattleStack` or combat state.
  It is rendered separately by the battle grid, using the planet's name and type color.

## Real-Time Model

Battles run on a real-time game loop (`BattleGameLoopService` — RAF with raw real delta time, not
`GameTimeService`, since the star-map clock is paused during battle):

```
RAF loop: updateStackPositions → AI tick (every 0.2s) → shield regen (every 1s) → checkVictory
```

1. **Stack positions** are updated every frame toward their `targetX`/`targetY` at `speed` vw/s.
   When a stack arrives, its `col`/`row` snaps to the destination cell.
2. **AI tick** fires one action every `AI_ACTION_INTERVAL_MS = 200` ms (configurable), gated by the
   animation busy lock. The AI picks one action per tick: attack → carrier shield boost → move.
3. **Shield regen** fires every `SHIELD_REGEN_INTERVAL_MS = 1000` ms for all living ships on both
   sides, plus the shared planetary shield pool in planet battles. The `round` counter increments
   per regen tick.
4. **Victory** is checked after every attack and every game-loop tick: the side with zero alive
   stacks loses; the battle ends with a winner declared.

## Non-Player Control

- The side whose `factionId !== 'player'` is controlled by a deterministic, greedy
  [tactical AI](./architecture.md) (`BattleAiService`). It lives entirely inside the
  battle-screen module and has no knowledge of the strategic `enemy-*` AI layers.
- AI plan per action (one action per 0.2s tick):
  1. Attack with the first stack that has an in-range enemy target.
  2. If no attack available, perform a Carrier Shield Pulse if a carrier can boost a damaged ally.
  3. If no attack or boost, move the nearest stack toward the nearest enemy (move-to-attack if
     possible).
  Planet-defense buildings never move.

## Animation / State Locking

`BattleAnimationService` holds a single in-flight counter plus a `busy` signal:

- Every attack is wrapped in `anim.run(fn)`, which balances a `begin()`/`end()` pair around the
  animation even if `fn` throws.
- The **animation lock** gates attacks only — movement is never blocked by it. Two stacks can
  attack simultaneously on different ticks, but only one attack animation can be in flight
  globally.
- The view, the input handlers, the combat services, and the AI all re-check the busy flag,
  so a race in any one layer cannot advance state mid-animation.
- `ticks$` emits after every mid-animation state change (projectile → impact → explosion) so
  the OnPush view re-renders effect phases without polling.

## Outcome

The minigame returns a `BattleOutcome`:

- `winnerSide` / `winnerFleetId` / `loserFleetId`
- per-side rosters in input order with final `hp` and `destroyed` flags, plus `survivors`
  and `wipedOut`
- `rounds` and the `battleType` / `planetId`
- **Planet battles only:** `defender.shieldPoolCurrent` and `defender.shieldPoolMax`
  on the defender fleet outcome, reporting the remaining shield pool after the battle
  and the pool's maximum capacity

## Limitations / Out of Scope

- No critical hits, evasion, or random factors — combat is deterministic.
- The shared planetary shield generator is not a targetable unit; only its pool is part of
  the battle. Garrison ships are intentionally not protected by the shared pool.
- A virtual defense fleet (negative fleet id) never persists; only the attacker's real roster
  is written back after a planet battle. A garrisoned fleet parked on the planet is not
  touched (pre-existing simplification preserved).
- Leaving a battle mid-combat is not offered: BACK only appears once a winner is decided.

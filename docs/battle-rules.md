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

- **38 columns × 16 rows** over a fixed **72vw × 28vw** battlefield (cells ≈ 1.89vw ×
  1.75vw). The grid was doubled from 19 × 8 in both directions; the battlefield's physical
  size did not change. Concepts (1-indexed cells) are reused from the System View; the
  minigame keeps its own constants (`battle.types.ts`) so it does not import
  `StarMapMovementService`.
- Grid cells drive movement, pathing, occupancy and clicks. **Range is physical**: one unit
  of a ship's `range` stat is `BATTLE_RANGE_UNIT_VW = 3.5vw` (the cell height of the old
  19 × 8 grid), independent of grid density. Speed is already physical (vw/s). Doubling the
  grid therefore changed neither weapon reach nor travel time.
- A stack occupies `size` consecutive cells in its row (1 for tier 1–2, 2 for tier 3–4, 3 for
  tier 5), growing right for attackers and left for defenders. On the denser grid ships render
  at half their former size and have four times as much room to manoeuvre.
- **Deployment slots** keep the old physical spacing: attacker anchor columns
  `ATTACKER_DEPLOY_COLS = 1, 3, 5, 7`, defender `DEFENDER_DEPLOY_COLS = 38, 36, 34, 32`
  (outer edge first), rows centre-out `DEPLOY_ROW_ORDER = 8, 6, 10, 4, 12, 2, 14`. Placement
  is occupancy-aware for both sides, so wide stacks never overlap; when the 28 slots are full,
  the first free cell scanning inward from the side's edge is used.
- Planet-defense buildings deploy as `immobile = true` stacks in the **outermost defender
  slot column first**, then overflow inward. Garrison stacks start one slot column inward
  from the last column used by turrets. See [Planet Battles](#planet-battles).

## Ships and Stacks

- A **stack** is the tactical unit for movement, targeting, and selection. Every ship type in
  a side is grouped into one or more stacks, each holding at most `MAX_STACK_SIZE = 5` ships;
  e.g. 12 fighters become 3 stacks (5/5/2).
- Visually a stack renders up to 5 ship icons as a cluster inside its cell, a `×N` badge
  when N ≥ 2, and an aggregate hull bar. Clicking a stack selects the whole stack.
- Individual ship HP is tracked inside the stack. Damage is applied ship-by-ship in order;
  overkill spills to the next ship. When the last ship dies the stack is destroyed and
  removed from the grid.

## Real-Time, Speed-Based

Battles are **real-time** — there are no Action Points or turns. Stacks move continuously at
their `speed` stat (vw/s, 1–5 from `ship-data.json`). Both sides act simultaneously.

The `range` stat is the attack range in range units (see [Tactical Grid](#tactical-grid)).
Virtual defense buildings (turrets) are immobile (speed 0), use their building definition's
`range`, and **do fire** like any other stack.

## Movement

- Real-time, grid-based 8-direction straight-line movement. One move command sets a stack's vw
  target; the RAF game loop interpolates the stack toward that target at `speed` vw/s. No AP cost,
  no move range limit — any reachable cell with a clear path is valid.
- Every intermediate cell along the path must be in bounds and unoccupied (no pathfinding through
  obstacles). The destination may also not be reserved by another in-flight stack.
- **Move-to-attack** (chasing a target) moves to the best free cell within
  `AI_MOVE_TO_ATTACK_RATIO` (0.9) of the attack range. When no such cell is reachable, the stack
  moves to the reachable cell closest to the target instead (it never retreats). Chasing stacks
  re-plan every `MOVE_REPLAN_INTERVAL_MS` (150 ms battle time) while the target moves.
- Immobile stacks (planet-defense buildings) cannot move.

### Maneuvering

Ships cannot slide sideways or backwards at full speed: they turn into a course.
(`battle/battle-heading.ts`)

- Every mobile stack has a hull `heading`. While moving, it turns toward the movement target at a
  tier-based rate: 240°/s for tier 1, then 180, 130 and 100, down to 75°/s for tier 5. Idle
  stacks turn back toward the enemy side. Turrets keep a fixed facing.
- Speed is multiplied by `maneuverSpeedFactor`, based on the angle between the heading and the
  direction of travel. Up to 20° the ship moves at full speed. From 20° to 160° the speed eases
  down on a smoothstep curve. From 160° on it stays at the tier floor: 40% for tier 1, then 35%,
  30% and 25%, down to 20% for tier 5. Speed never reaches 0, so every move completes.
- Final approaches under 0.3 field units (grid snaps) neither steer nor slow down.
- Only travel time changes. Paths, destinations, occupancy and reach are unaffected, and the AI
  doesn't model the slowdown.

## Combat

- **Fire control** (`BattleCombatService.runFireControl`) is the only place that decides when a
  stack fires. It runs every frame for every living stack of **both sides** (player, AUTO and enemy
  AI alike). A stack fires when its cooldown has elapsed, it has no volley in flight, and a target
  is in reach. Stacks may fire while moving.
- **Fire cadence is per class**, with the same rules for both sides: one volley every
  `(1 / fireRate) s × FIRE_RATE_MULTIPLIER` of battle time. Fleet size doesn't slow down the AI
  side. `fireRate` comes from `ship-data.json` (turrets: `planet-data.json`):

  | Class | fireRate (/s) | Class | fireRate (/s) |
  |---|---|---|---|
  | fighter | 4 | cruiser | 1.2 |
  | scout, corvette | 3 | battlecruiser | 0.9 |
  | frigate | 2.2 | battleship | 0.75 |
  | colonizer | 2 | dreadnought | 0.5 |
  | destroyer | 1.6 | laser turret | 2.5 |
  | carrier | 1.5 | missile turret | 0.8 |

  Each volley is jittered by up to ±8% (`fireJitter`, deterministic from stack id and time),
  so same-class stacks drift apart instead of firing in lockstep. During sustained fire the next
  volley is scheduled from the previous due time (`nextVolleyDueMs`), so frame or step
  rounding never lowers the cadence. After an idle gap it restarts from now, so stacks can't
  store shots for a burst.
- **Fire rate never changes damage per second.** Attack stats are balanced for
  `REFERENCE_FIRE_RATE = 1.5`. A volley deals `volleyShare = REFERENCE_FIRE_RATE / fireRate` of
  a *reference volley* (see damage below): a fighter deals 0.375 of one, 4 times a second, and
  a dreadnought deals 3 of one, every 2 s. Leftover fractions carry to the stack's next volley
  (`state.damageCarry`), so damage per second matches the reference exactly. At `fireRate 1.5`
  a volley is exactly the old single volley.
  - Fire rate does change *granularity*. Rapid-fire classes waste less overkill and spread
    damage more evenly, so they are slightly more effective against many small targets. Slow
    heavy volleys front-load damage. For example, in auto-resolve, 2 corvettes now beat 4 laser
    turrets without losses, where the old uniform cadence cost both sides 2 ships. With 5 turrets
    the fight is close again.
- **Whom to shoot** follows [Orders and Targeting](#orders-and-targeting).
- **Reach**: target must be an enemy whose absolute `x/y` centre is within
  `(attackRange + ATTACK_RANGE_TOLERANCE) × BATTLE_RANGE_UNIT_VW` when the volley starts
  (`ATTACK_RANGE_TOLERANCE = 1`, so every ship effectively reaches `range + 1`). Euclidean,
  inclusive at the boundary. The selected stack's range ring shows exactly this reach.
- **Laser bolts.** Every volley is a real projectile (`BattleProjectile` in
  `state.projectiles`), simulated on battle time by `BattleCombatService.updateProjectiles`:
  - At launch it is aimed once at the target's **current** `x/y` and then flies in a straight
    line at a constant `PROJECTILE_SPEED_VW_PER_S = 45`. It never changes direction or tracks.
  - It **hits only its intended target**, and only when its path (swept segment, so fast bolts
    cannot tunnel) crosses that target's hitbox: the drawn stack box, `size` cells × 1 cell,
    scaled by `PROJECTILE_HITBOX_SCALE = 0.925`, at the target's live position. Other stacks
    in the way are passed through.
  - If the target moved out of the line of fire, the bolt flies on and fizzles after
    `reach + PROJECTILE_OVERSHOOT_VW` (6vw) or when it leaves the battlefield: a **miss**, with no
    damage and no log entry. Misses are rare at short range and against slow ships; fast ships
    at long range can dodge.
  - Damage uses a snapshot of the firing stack taken at launch, so a bolt already in flight keeps
    its damage if the shooter is destroyed. The target's defense/shields are those at impact.
  - After a winner is decided, remaining bolts fly off without dealing damage, so the outcome is
    fixed at the moment of victory.
  - The fire cooldown is independent of flight time; a stack may have more than one bolt in
    flight.
- **Reference volley = whole stack:** `totalAttack = Σ attack of alive ships in the firing
  stack`; `raw = max(1, totalAttack − frontTargetShip.defense)`. Defense is per-ship (the
  front target ship's `defense`), not summed. It's subtracted once per *reference* volley,
  before the fire-rate split. Subtracting it from each small rapid-fire shot would let armor
  erase light classes.
- Weapon effectiveness scales raw damage by the attacker's `attackType` vs the front target
  ship's `weakness` using the table in `battle-grid.ts`: each attacker type has one strong
  matchup (1.5×), one neutral matchup (1.0×), and one resisted matchup (0.5×). The target's
  own `weakness` type is the resisted matchup. `max(1, floor(...))` keeps the damage floor of
  the reference volley. The applied damage is then `floor(reference × volleyShare + carry)`,
  which can be 0 for a single light shot, with the remainder carried over.
- Shield absorbs damage before hull: each ship's own `shield` absorbs first; only overflow
  reaches hull HP. A stack with no alive ships is destroyed.
- **Simultaneous fire on one target:** damage is applied when a bolt hits. If the target was
  already destroyed by another bolt, the later bolt flies on as a miss (no damage, no log entry).
  Victory is checked after every hit.
- Each damaging volley appends a `BattleLogEntry` (round, side, stacks, gross volley damage,
  kills).

## Orders and Targeting

Implemented in `battle-targeting.ts` (target choice), `BattleScreenComponent` (orders) and
`BattleMovementService.maintainAttackOrders` (chasing).

**Player orders** are plain state on the stack and apply immediately, also while paused:

- **Attack order** (click an enemy with a stack selected) sets `explicitAttackTargetId`.
  - The stack fires at that target whenever it is in reach.
  - While it is out of reach the stack chases it, and the order is re-issued on every re-plan
    tick, so a target moving away does not cancel the order.
  - Meanwhile the stack **fires opportunistically** at other in-reach enemies without dropping
    the order, and switches back as soon as the ordered target is in reach.
  - The order ends only when the target is destroyed (the stack returns to automatic targeting)
    or the player gives that stack a new order. Selecting other stacks, range loss, AUTO and the
    AI never clear it. If the target cannot be reached, the order stays and the stack keeps
    trying while still fighting whatever is in reach.
- **Move order** (click a cell) replaces any attack order, but only if the move is legal; a
  blocked move leaves the previous order untouched. AUTO leaves the stack alone until it
  arrives (`manualMoveOrder`).
- Re-clicking an enemy never bypasses the fire cooldown.

**Automatic targeting** applies whenever a stack has no in-reach manual target. Each stack has a
`targetingMode` (player-selectable per stack in the selection panel; the enemy AI uses
`balanced`). Only in-reach enemies are candidates:

| Mode | Prefers | Tie-breaks |
|---|---|---|
| `balanced` (default) | Original role-aware score: target role priority × 1000 + threat × 10 + role bonus + (range − distance) | — |
| `strongest` | Highest remaining hull + shield (+ shared planetary shield for immobile turrets) | higher firepower |
| `weakest` | Fewest reference volleys (= time to kill) for **this** attacker (uses the real damage formula: front defense, weapon matchup, floor 1) | lower durability |
| `firepower` | Highest Σ attack × `REFERENCE_FIRE_RATE` (damage per second; independent of fireRate) | lower durability |

All modes finally break ties by distance (nearer first) and then `stackId`, so selection is
deterministic. To avoid flip-flopping, the chosen automatic target is **sticky**
(`autoTargetId`): it is kept while alive and in reach, and dropped when it dies, leaves reach,
or the mode changes.

## Technology Combat Bonuses

Researched technologies can raise a faction's ship `attack` and `shield` per hull type (see [Research](./research.md)). The multipliers are stamped on the `Battle` (`combatBonuses`, per faction id and ship type) when the battle is created and applied once in `createBattleState`, to both the current and maximum shield. Planet defense (virtual) ships and battles without stamped bonuses (AI forecasts) use base stats. Overworld fleets are never modified.

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
  - On every shield-regen tick (`SHIELD_REGEN_INTERVAL_MS`), the pool regenerates by the sum
    of all shield-building `shieldRegen` values, capped at `max`.
- The planet visual is presentation-only and never part of `BattleStack` or combat state.
  It is rendered separately by the battle grid, using the planet's name and type color.

## Real-Time Model

Battles run on a real-time game loop (`BattleGameLoopService` — RAF, outside the Angular zone).
Delta time is scaled by the battle-local `BattleTimeService` (pause / 1x / 2x) and is 0 while
paused; the star-map `GameTimeService` stays paused during battle. Each frame
(`BattleScreenComponent.gameLoopCallback`) runs, in order:

1. **Headings** turn toward each stack's course, then **stack positions** move toward
   `targetX`/`targetY` at `speed` vw/s × the [maneuver factor](#maneuvering); on arrival `col`/`row`
   snap to the destination cell and a manual move order is completed.
2. **AI tick** every `AI_ACTION_INTERVAL_MS = 400` ms for the non-player side, plus a separate
   **AUTO tick** for the player side when AUTO battle is on (movement decisions only).
3. **Re-planning** every `MOVE_REPLAN_INTERVAL_MS = 150` ms: manual attack orders re-issue
   their chase; chasing stacks re-plan their destination.
4. **Fire control** for every stack (see [Combat](#combat)).
5. **Shield regen** every `SHIELD_REGEN_INTERVAL_MS = 2000` ms for all living ships on both sides,
   plus the shared planetary shield pool. The `round` counter increments per regen tick.
6. **Laser bolts and effects** advance (`updateProjectiles`) — also after victory, without
   damage, so the last bolts and explosion play out.
7. **Victory check** (also after every hit): the side with zero alive stacks loses.

While paused nothing in steps 1–6 advances: positions, cooldowns, bolts and effects are all on
battle time. Player orders can still be given and take effect on resume.

## Tactical AI and AUTO Battle

- The non-player side is controlled by a deterministic, greedy tactical AI (`BattleAiService`).
  It lives entirely inside the battle-screen module and has no knowledge of the strategic
  `enemy-*` AI layers.
- The AI decides **movement and Carrier Shield Pulse only**; it never fires (fire control does).
  Every AI tick, each controlled stack whose `AI_ACTION_COOLDOWN_MS` (1000 ms) has expired and
  that is not moving gets one decision:
  1. Carrier: Shield Pulse if an ally in reach is below 50 % shield.
  2. An enemy is already in reach: hold position.
  3. Otherwise move-to-attack the nearest enemy (approach fallback when blocked).
- Planet-defense buildings never move (they still fire).
- **AUTO battle** (header toggle, persisted in `localStorage`, on by default) runs the same AI for
  the **player side only**. It never commands a player stack that holds a manual order (attack
  target, or an in-flight manual move) — manual orders always win. Enabling AUTO does not give the
  enemy extra decisions.

## Carrier Shield Pulse

Restores the Carrier front ship's `shieldRegen` to every friendly ship within the Carrier's reach
(capped at `maxShield`). It requires the Carrier to be stationary, not mid-volley and off fire
cooldown, and at least one ally in reach must be missing shield (otherwise it does nothing and
costs nothing). It **consumes the Carrier's fire cooldown**, so it replaces a volley and cannot
be spammed. Other stacks animating elsewhere do not block it.

## Animation / State Locking

- Volleys no longer use the animation lock: bolts (`state.projectiles`) and impact /
  explosion effects (`state.effects`, each with a `remainingMs` lifetime) are plain battle
  state advanced by `updateProjectiles` on battle time, so they freeze on pause and run faster
  at 2x. The firing stack's `firing` flag (recoil highlight) is derived from its bolts during
  the first `ANIMATION_MS.muzzle` of flight.
- `BattleAnimationService` keeps its per-stack lock and battle-time `wait()`; fire control and
  Shield Pulse still respect `isStackBusy`.
- The result overlay appears once a winner is set **and** no bolt or effect remains, so the
  final hit is visible.
- Movement is never blocked by animations.
- `ticks$` emits every frame, which triggers change detection on the battle screen.

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
- Targeting modes and orders are battle-local; nothing about them is saved, so save data is
  unaffected.
- Pathing is straight-line only (no detours around obstacles); a blocked stack approaches as
  close as a straight line allows.
- The selection panel's DEF shows the sum over the stack's ships, while combat uses only the
  front ship's defense.

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
| Fleet vs Planet | Planet defenses | `StarMapPlanetArrivalService` — a fleet stops on a defended planet of a faction it is at war with |

Fleets fight only when their factions are at war ([Diplomacy](./diplomacy.md)). Only battles with a human side open this minigame; a fleet battle between two AI factions is auto-resolved on the spot (`autoResolveBattle`, see [Planet Capture](./planet-capture.md#auto-resolver-battle-auto-resolvets)).

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
their `speed` stat × `BATTLE_SPEED_MULTIPLIER` (0.6; vw/s, so 0.6–3 from the 1–5 in
`ship-data.json`). The multiplier is battle-only: the same `speed` drives galaxy movement. Both
sides act simultaneously.

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
  side. `fireRate` comes from `ship-data.json` (turrets: `planet-data.json`); the table lists the
  data values, actual volleys are `FIRE_RATE_MULTIPLIER` (3) times rarer:

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
- **Weapons charge.** A stack that was idle (battle start, or no volley due within the last
  interval) does not fire at once: it charges for one full interval first
  (`volleyDecision` in `battle.types.ts`, used by fire control and the auto-resolver alike). During
  sustained fire volleys follow the cadence above. Without the charge every engagement opened with
  a free full volley, and slow classes front-loaded up to one full interval of damage at t = 0 (a dreadnought
  volley wiped a fighter stack before the fighters fired).
- **Fire rate never changes damage per second.** Attack stats are balanced for
  `REFERENCE_FIRE_RATE = 1.5`. A volley deals `volleyShare = REFERENCE_FIRE_RATE / fireRate` of
  a *reference volley* (see damage below): a fighter deals 0.375 of one, 4 times a second, and
  a dreadnought deals 3 of one, every 2 s (both at `FIRE_RATE_MULTIPLIER` 1). Leftover fractions carry to the stack's next volley
  (`state.damageCarry`), so damage per second matches the reference exactly. At `fireRate 1.5`
  a volley is exactly the old single volley.
- **Battle length.** `FIRE_RATE_MULTIPLIER` (3, since 2026-11-02) stretches every interval while a
  volley keeps its damage, so it divides every class's damage per second equally and sets how long
  fights last without changing any matchup. `SHIELD_REGEN_INTERVAL_MS` scales with it (6 s), so
  shield regeneration keeps the same weight per point of damage. Measured shooting time
  (auto-resolve, all stacks engaged): 5 vs 5 frigates 14 s, 8 vs 8 mixed 18 s, 12 vs 12 destroyers
  23 s, 40 vs 40 21 s, late 4 dreadnoughts + 8 cruisers per side 43 s (at multiplier 1: 5–7 s and
  14 s). The approach before it takes roughly 8–10 s at the battle speed multiplier.
  - Fire rate does change *granularity*. Rapid-fire classes waste less overkill and spread
    damage more evenly, so they are slightly more effective against many small targets. Slow
    heavy volleys front-load damage. For example, in auto-resolve, 2 corvettes now beat 4 laser
    turrets without losses, where the old uniform cadence cost both sides 2 ships. With 5 turrets
    the fight is close again. (Measured before the hull-class and armour changes below.)
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
- **Reference volley** (`referenceVolleyDamage` in `battle-grid.ts`, the one formula behind
  combat, auto-resolve and the targeting estimate):

  `max(1, floor(totalAttack × weapon × hullClass × 100 / (100 + defense)))`

  - `totalAttack` = Σ attack of the alive ships in the firing stack.
  - `weapon`: the attacker's `attackType` vs the front target ship's `weakness`, from the table
    in `battle-grid.ts`: one strong matchup (1.2×), one neutral (1.0×) and one resisted (0.8×);
    the target's own `weakness` type is the resisted one. Deliberately milder than the hull-class
    cycle: at the former 1.5× / 0.5× the weapon type decided most fights and hid the hull roles.
  - `hullClass`: see [Hull Classes](#hull-classes).
  - Carrier aura: a covered target takes 15% less, see [Carrier Shield Aura](#carrier-shield-aura).
  - **Armour** is a percentage: `defense` (of the front target ship) reduces the volley by
    `defense / (100 + defense)` (defense 28 → −22%). It used to be subtracted flat from each
    volley, which made armour depend on stacking: fleets of up to 28 ships fight as one-ship
    stacks, so a fighter's 15 attack minus a dreadnought's 28 defense left 1, while 29 ships in
    stacks of five lost almost nothing to the same armour.

  The applied damage is then `floor(reference × volleyShare + carry)`, which can be 0 for a
  single light shot, with the remainder carried over.
- Shield absorbs damage before hull: each ship's own `shield` absorbs first; only overflow
  reaches hull HP. A stack with no alive ships is destroyed.
- **Simultaneous fire on one target:** damage is applied when a bolt hits. If the target was
  already destroyed by another bolt, the later bolt flies on as a miss (no damage, no log entry).
  Victory is checked after every hit.
- Each damaging volley appends a `BattleLogEntry` (round, side, stacks, gross volley damage,
  kills).

## Hull Classes

Every ship type has a `hullClass` in `ship-data.json`. The classes form a counter cycle;
`src/app/components/star-map/hull-class.ts` is the single source of truth for the table, the
armour rule and every player-facing text about it, and the AI uses the same table
([AI Pipeline](./ai-pipeline.md#military-production-and-deployment)).

| Class | Hulls | Strong vs (+35%) | Weak vs (takes +35%) | Why |
|---|---|---|---|---|
| Light | scout, fighter, corvette, frigate (and colonizer, outpost ship) | heavy | medium | big guns cannot track small, agile hulls |
| Medium | destroyer, cruiser, carrier | light | heavy | fast, accurate escort fire |
| Heavy | battleship, battlecruiser, dreadnought | medium | light | armour and heavy guns |

- Damage multiplier by attacker → target class: strong 1.35×, neutral 1.0×, weak 0.75×.
- **Siege:** heavy hulls deal 1.5× to static defenses (planet turrets, base and mining-station
  cores: the `structure` class). Structures deal 1.0× to every class, and light / medium hulls
  deal 1.0× to them.
- The class lives on `BattleShipStats.hullClass` and `BattleStack.hullClass` (stacks are
  homogeneous by type). A stack without a class (hand-built test stacks) counts as medium.
- The player sees the class and its matchups in the production dialog (badge on every ship
  card, full role, bonuses and stats for the selected hull) and on every research card that
  unlocks a combat hull (`HullRoleComponent`, texts from `describeHullRole`).

### Balance check

`hull-balance.spec.ts` resolves every pair of combat hulls (carrier excluded: it is a support
hull, checked separately in [Carrier Shield Aura](#carrier-shield-aura)) with equal credit budgets, both side assignments, and asserts
the cycle for every pair at 6,000 and 14,400 credits plus "no hull wins every matchup".
Measured remaining-budget score of the row hull (+ = row wins), 6,000 credits, 2026-11-02:

| | fighter | corvette | frigate | destroyer | cruiser | battleship | battlecruiser | dreadnought |
|---|---|---|---|---|---|---|---|---|
| fighter | · | −0.01 | 0.51 | −0.91 | −0.93 | 0.68 | 0.68 | 0.50 |
| corvette | 0.01 | · | 0.56 | −0.56 | −0.87 | 0.76 | 0.24 | 0.76 |
| frigate | −0.51 | −0.56 | · | −0.65 | −0.93 | 0.42 | 0.54 | 0.66 |
| destroyer | 0.91 | 0.56 | 0.65 | · | −0.47 | −0.82 | −0.75 | −0.80 |
| cruiser | 0.93 | 0.87 | 0.93 | 0.47 | · | −0.82 | −0.88 | −1.00 |
| battleship | −0.68 | −0.76 | −0.42 | 0.82 | 0.82 | · | 0.47 | −0.90 |
| battlecruiser | −0.68 | −0.24 | −0.54 | 0.75 | 0.88 | −0.47 | · | −0.80 |
| dreadnought | −0.50 | −0.76 | −0.66 | 0.80 | 1.00 | 0.90 | 0.80 | · |

Within a class the later-researched hull is somewhat stronger (cruiser over destroyer,
dreadnought over the other heavies), which keeps research worthwhile. With very small fleets
(2,400 credits: 2–3 heavies against 9 destroyers) heavy vs medium is close; the battleship
loses that one narrowly. Auto-resolve ignores range and movement, so the heavies' longer range
and the light hulls' agility in the real battle are not part of these numbers.

## Orders and Targeting

Implemented in `battle-targeting.ts` (target choice), `BattleScreenComponent` (orders) and
`BattleMovementService.maintainAttackOrders` (chasing).

**Player orders** are plain state on the stack and apply immediately, also while paused. Control
rule (shared with the star map): a left click only selects an own stack; every order is a right
click (touch: long press, see [Game Systems](./game-systems.md)):

- **Attack order** (right-click an enemy with a stack selected) sets `explicitAttackTargetId`.
  - The stack fires at that target whenever it is in reach.
  - While it is out of reach the stack chases it, and the order is re-issued on every re-plan
    tick, so a target moving away does not cancel the order.
  - Meanwhile the stack **fires opportunistically** at other in-reach enemies without dropping
    the order, and switches back as soon as the ordered target is in reach.
  - The order ends only when the target is destroyed (the stack returns to automatic targeting)
    or the player gives that stack a new order. Selecting other stacks, range loss, AUTO and the
    AI never clear it. If the target cannot be reached, the order stays and the stack keeps
    trying while still fighting whatever is in reach.
- **Move order** (right-click a cell) replaces any attack order, but only if the move is legal; a
  blocked move leaves the previous order untouched. AUTO leaves the stack alone until it
  arrives (`manualMoveOrder`).
- Re-ordering an attack on the same enemy never bypasses the fire cooldown.

**Automatic targeting** applies whenever a stack has no in-reach manual target. Each stack has a
`targetingMode` (player-selectable per stack in the selection panel; the enemy AI uses
`balanced`). Only in-reach enemies are candidates:

| Mode | Prefers | Tie-breaks |
|---|---|---|
| `balanced` (default) | Original role-aware score: target role priority × 1000 + threat × 10 + role bonus + (range − distance) | — |
| `strongest` | Highest remaining hull + shield (+ shared planetary shield for immobile turrets) | higher firepower |
| `weakest` | Fewest reference volleys (= time to kill) for **this** attacker (uses the real reference-volley formula: front armour, weapon matchup, hull class, floor 1) | lower durability |
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
Delta time is scaled by the battle-local `BattleTimeService` (pause / 1x / 3x) and is 0 while
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
5. **Shield regen** every `SHIELD_REGEN_INTERVAL_MS` (2000 ms × `FIRE_RATE_MULTIPLIER` = 6 s) for all living ships on both sides,
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
- The AI decides **movement only**; it never fires (fire control does), and the carrier's
  [shield aura](#carrier-shield-aura) is passive. Every AI tick, each controlled stack whose
  `AI_ACTION_COOLDOWN_MS` (1000 ms) has expired and that is not moving gets one decision:
  1. An enemy is already in reach: hold position.
  2. Otherwise move-to-attack the nearest enemy (approach fallback when blocked).
- Planet-defense buildings never move (they still fire).
- **AUTO battle** (header toggle, persisted in `localStorage`, on by default) runs the same AI for
  the **player side only**. It never commands a player stack that holds a manual order (attack
  target, or an in-flight manual move) — manual orders always win. Enabling AUTO does not give the
  enemy extra decisions.

## Carrier Shield Aura

The carrier (`shieldAura: 0.15` in `ship-data.json`) projects a passive shield field:

- **Coverage:** the carrier itself and every friendly stack within its gun reach
  (`(range + ATTACK_RANGE_TOLERANCE) × BATTLE_RANGE_UNIT_VW`, the same reach as its weapons).
  The auto-resolver has no positions, so there every ally of a living carrier is covered
  (`state.auraCoversAllAllies`).
- **Effect:** covered stacks take 15% less damage from every volley — a factor in
  `referenceVolleyDamage`, so animated combat, auto-resolve and the targeting estimate agree.
- **No stacking:** a stack takes the strongest covering aura only. Extra carriers add a weak gun
  and nothing else, so a carrier-only fleet loses to every equal-budget fleet.
- **Passive:** it never costs the carrier a volley and needs no decision from the player or the
  tactical AI. It ends when the carrier is destroyed.
- **Why damage reduction, not regeneration:** fleet battles are over in a few seconds, so an aura
  that regenerated shield on the regen tick measured as worthless at any strength
  (2026-11-02). The old Shield Pulse (restores `shieldRegen`, costs a volley) had the same
  problem and was replaced by the aura.
- **Carrier stats** were raised with it (hull 420, shield 280, armour 16): the balanced targeting
  mode shoots fleet-support ships first, and a fragile carrier died before its aura mattered.
- **Balance check** (`hull-balance.spec.ts`, auto-resolve, equal cost): one carrier with 10
  destroyers beats 12 destroyers, one with 6 cruisers beats 7 cruisers, one with 20 frigates
  beats 23 frigates, two with 16 destroyers beat 20 destroyers; 10 carriers lose to 19 destroyers,
  12 cruisers, 27 frigates and 4 dreadnoughts.
- **Display:** every living carrier draws a breathing shield-blue disc of its aura reach (own
  auras slightly brighter than enemy ones), covered friendly stacks get a steady shield-blue
  glow, and a selected carrier's panel states the effect. The production dialog and research
  cards show the aura line in the carrier's role (`describeHullRole`).

## Animation / State Locking

- Volleys no longer use the animation lock: bolts (`state.projectiles`) and impact /
  explosion effects (`state.effects`, each with a `remainingMs` lifetime) are plain battle
  state advanced by `updateProjectiles` on battle time, so they freeze on pause and run faster
  at 2x. The firing stack's `firing` flag (recoil highlight) is derived from its bolts during
  the first `ANIMATION_MS.muzzle` of flight.
- `BattleAnimationService` keeps its per-stack lock and battle-time `wait()`; fire control
  still respects `isStackBusy`.
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

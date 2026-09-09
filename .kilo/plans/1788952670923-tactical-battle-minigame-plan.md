# Tactical Battle Minigame — Implementation Plan

Replace the auto-resolving placeholder Battle Screen with a self-contained, turn-based,
AP-driven tactical space combat minigame (Imperium Galactica 1 inspired).

**Hard architectural constraint:** the minigame is a pure `INPUT → BATTLE → RESULT` box.
It never touches `StarMap`, galaxy/system map logic, economy, production, research,
AI strategy, strategic fleet movement, or save/load internals. It operates only on
battle-local state cloned from the two input fleets.

---

## 1. Existing BattleScreen architecture (what is being replaced)

| File | Current role |
|---|---|
| `src/app/components/battle-screen/battle-screen.component.ts` | View. Reads `BattleService`, starts a `setInterval(tickRateMs)`, calls `processStep()` per tick, runs `cdr.detectChanges()`. On "Back to Star Map" it mutates the AUTOSAVE slot and navigates to `/star-map`. |
| `battle-screen.component.html` | Two fleet panels + `VS` + battle log + summary. No grid, no player input. |
| `battle-screen.component.scss` | CRT/blue panel styling. |
| `src/app/services/battle.service.ts` | Owns `Battle`, `BattleState`, `destroyedFleetId`, `tickRateMs`. `startBattle()` seeds ship HP; `processStep()` auto-resolves exactly one attack per tick; `endBattle()` picks winner/loser. |

Behaviour today: **fully automatic**. The player watches a log fill up. There is no grid,
no positioning, no AP, no END TURN, no animations. Damage rule is `max(1, attack - defense)`
against the weakest-HP enemy ship.

Also present: `GameTimeService.pause()` in `ngOnInit` / `resume()` in `ngOnDestroy` and in
`backToStarMap()`. **This must be preserved** — it is what stops the galaxy simulation from
running behind the battle screen.

## 2. Existing battle input/output contract (must stay stable)

**Input (outside → battle), unchanged:**

1. `StarMapBattleDetectionService.checkForBattles()` (fleet-vs-fleet, same grid cell, hostile teams) → `BattleService.setBattle(battle)` → `StarMap.enterBattleScreen()` (autosave + `router.navigate(['/battle'])`).
2. `StarMapPlanetArrivalService.triggerPlanetBattle()` (defended enemy planet) → `BattleService.setPlanetBattle(battle)` → same `enterBattleScreen()`.

`Battle` shape (`battle.service.ts:333`):
`{ fleet1, fleet2, faction1Name, faction1Color, faction2Name, faction2Color, attackerId, defenderId, type?: 'fleet'|'planet', planetId?, capturedPlanetId? }`.
`capturedPlanetId` is declared but never read — dead field.

**Output (battle → outside), unchanged transport, extended payload:**

1. `BattleScreenComponent.backToStarMap()` writes the outcome into `SaveSlotId.AUTOSAVE` and navigates to `/star-map`.
2. `StarMap`'s `Router.events` subscription (`star-map.ts:292-301`) fires `reloadAfterBattle()` only for `/battle → /star-map`.
3. `reloadAfterBattle()` → `loadGame()` → `removeDestroyedFleetFromService()` reads `BattleService.getDestroyedFleetId()`, marks that fleet `destroyed`, clears selection, re-saves.

So the **only** channels back to the overworld are `BattleService` + the AUTOSAVE slot.
The minigame keeps exactly those two channels.

`processStep()`, `getTickRate()`, `setTickRate()`, `getCurrentRound()`, `getWeakestShip()`
are called **only** by `BattleScreenComponent` (verified by grep) → safe to delete.

## 3. Ship / fleet data relevant to combat

`ship-data.json` (11 types), fields already loaded by `ShipService`:

| id | cost | hp | shield | atk | def | speed | range |
|---|---|---|---|---|---|---|---|
| scout | 50 | 40 | 20 | 8 | 2 | 5 | 3 |
| fighter | 75 | 50 | 30 | 15 | 3 | 5 | 2 |
| colonizer | 100 | 30 | 10 | 2 | 2 | 3 | 1 |
| corvette | 120 | 90 | 50 | 22 | 5 | 4 | 2 |
| frigate | 180 | 130 | 80 | 28 | 8 | 4 | 3 |
| destroyer | 260 | 190 | 100 | 45 | 10 | 3 | 3 |
| cruiser | 400 | 280 | 160 | 60 | 14 | 3 | 3 |
| carrier | 500 | 320 | 220 | 30 | 12 | 2 | 4 |
| battleship | 700 | 450 | 250 | 90 | 20 | 2 | 4 |
| battlecruiser | 750 | 380 | 200 | 110 | 16 | 3 | 5 |
| dreadnought | 1200 | 700 | 400 | 160 | 28 | 1 | 5 |

`FleetShip` = `{ id, name, type, currentHp?, destroyed? }` — the per-ship record the
result must map back onto. Ship `id`s are unique per save (`ShipStockService.nextShipId`).

Planet battles add **virtual** ships whose `type` is a *building* id, resolved through
`PlanetBattleService.getVirtualShipType()` / `getBuildingAttack()` / `getBuildingDefense()`.
They have no `cost` and no `speed`. The minigame must handle them (immobile stacks).

`attackType` / `weakness` / `shield` / `shieldRegen` exist in data but are **not applied
anywhere today** (`docs/battle-rules.md` §Limitations).

## 4. System View grid concepts to reuse

- Rendered system grid (`.system-grid`, `_star-map-system-view.scss:17`): `width: 90vw; height: 35vw`, `grid-template-columns: repeat(18, 5vw)`, `grid-template-rows: repeat(7, 5vw)` → **18 × 7 cells of 5vw**.
- `StarMapMovementService.SYSTEM_CELL_SIZE_VW = 5`, `calculateSystemGridCell(vwX, vwY) → {col: floor(x/5)+1, row: floor(y/5)+1}` (1-indexed).
- `getSystemTileCenter(vwX, vwY)` snaps a click to a cell centre in vw.
- `star-map-sensor.service.ts:56-58` declares `SYSTEM_GRID_COLUMNS = 18`, `SYSTEM_GRID_ROWS = 10`, `SYSTEM_CELL_SIZE_VW = 5`.

⚠️ **Discrepancy:** the constants say 10 rows, the rendered grid is 7 rows (35vw / 5vw).
Sensor math uses 10; pixels only ever show 7. → Decision **D1** below.

**Reuse policy:** copy the *concepts* (1-indexed cells, 5vw cell size, `floor(vw/5)+1`
conversion, vw-unit positioning, `.fleet-cell` absolute positioning pattern) into
battle-local constants in `battle.types.ts`. **Do not import `StarMapMovementService`** —
it is a root-provided stateful singleton holding galaxy camera/cell state, and importing it
would couple the minigame to the StarMap subsystem.

Reusable visual patterns: `_star-map-ships.scss` (`.fleet-cell` absolute + `translate(-50%,-50%)`, `.fleet` panel, `ship-moving-float` / `target-pulse` keyframes), `_star-map-grid.scss`, and the `--color-blue*` / `--color-text*` palette in `src/styles.scss`. Font: `--font-primary` (VT323).

## 5. Proposed isolated architecture

New folder `src/app/components/battle-screen/battle/` — everything below is battle-local.

```
battle-screen.component.ts        orchestrator ONLY (view glue, no rules)
battle-screen.component.html/.scss
battle-grid/                      presentational grid + stacks + projectiles (dumb view)
battle-fleet-panel/               left/right roster panel (dumb view)
battle/
  battle.types.ts                 all interfaces + constants (grid, AP, tiers, durations)
  battle-ship-stats.ts            pure: type id → combat stats + AP tier
  battle-grid.ts                  pure: bounds, occupancy, distance, range, cell→vw
  battle-state.ts                 pure: factory + reducers over BattleModelState
  battle-movement.service.ts      move command validation + AP spend
  battle-combat.service.ts        attack command validation + damage + deaths
  battle-turn.service.ts          side/round/AP lifecycle + victory check
  battle-animation.service.ts     in-flight animation lock (the END TURN gate)
  battle-ai.service.ts            non-player side auto-turn (greedy)
  battle-result.ts                BattleModelState → BattleOutcome
```

Design notes:

- **Pure functions first.** `battle-ship-stats`, `battle-grid`, `battle-state`, `battle-result` are plain exported functions/objects, not `@Injectable`. This mirrors `star-map-resources.util.ts` / `star-map-display.util.ts` and makes them trivially Vitest-testable without `TestBed`.
- **Services hold no game data.** They are stateless transformers taking `BattleModelState` as an argument, matching the project convention (`StarMapMovementService.updateFleets(fleets, ...)`, `EconomyService.applyEconomyDelta(...)`, the `enemy-*` AI layers).
- **Only 4 injectables** (`movement`, `combat`, `turn`, `animation`, `ai` → 5). Fewer than the 9 suggested in the brief; a separate `BattleActionService` / `BattleInputService` / `BattleUnit` class would be over-engineering for Angular — actions are just methods on `movement`/`combat`, and input handling is 3 handlers on the component.
- **`BattleService` (root) is reduced to the transport boundary.** It keeps `setBattle` / `setPlanetBattle` / `getBattle` / `getDestroyedFleetId` / `setDestroyedFleetId` / `clearBattle`, drops the simulation, and gains `setBattleResult()` / `getBattleResult()`. All simulation types move into `battle.types.ts`.
- Component uses `ChangeDetectionStrategy.OnPush` + signals for the view model (per `angular-component` skill conventions), since the grid re-renders often during animations.

**Dependency direction:** `battle-screen.component` → battle services → `battle.types` / pure utils. Nothing in `battle/` imports from `components/star-map/**` except the read-only `ShipService` and `PlanetBattleService` (both root services over static JSON, no StarMap state).

## 6. Proposed battle state model

```ts
type BattleSide = 'attacker' | 'defender';
type BattlePhase = 'deploy' | 'playerTurn' | 'aiTurn' | 'animating' | 'over';

interface BattleShip {              // one real ship inside a stack
  shipId: number;                   // === FleetShip.id, the map-back key
  name: string;
  typeId: string;
  hp: number; maxHp: number;
  attack: number; defense: number;
  alive: boolean;
}

interface BattleStack {             // THE tactical unit
  stackId: string;                  // `${side}:${typeId}:${index}`
  side: BattleSide;
  typeId: string; typeName: string;
  col: number; row: number;         // 1-indexed, 18×7
  ships: BattleShip[];              // ≤ MAX_STACK_SIZE
  tier: number;                     // AP tier
  moveApPerCell: number; attackAp: number;
  moveRange: number; attackRange: number;
  immobile: boolean;                // planet defense buildings
  cellsMovedThisTurn: number;
  attackedThisTurn: boolean;
  destroyed: boolean;               // all ships dead
}

interface BattleModelState {
  round: number;
  activeSide: BattleSide;
  ap: number;                       // remaining this turn
  apPerTurn: number;                // 10
  stacks: BattleStack[];
  phase: BattlePhase;
  log: BattleLogEntry[];
  winner: BattleSide | null;
  attackerFleetId: number; defenderFleetId: number;
  battleType: 'fleet' | 'planet';
  planetId?: number;
}
```

Construction: `createBattleState(battle: Battle)` deep-clones both fleets' `ships`
(never mutates the input `Fleet` objects), resolves stats via `battle-ship-stats`,
groups into stacks, and deploys them.

Deployment (18 × 7):
- attacker stacks → columns **1–2**, defender stacks → columns **17–18**
- rows filled centre-out from row 4; overflow wraps to the second column
- planet-defense (virtual) stacks placed in columns 17–18 with `immobile = true`

## 7. Proposed ship stack representation

| Question | Proposal |
|---|---|
| Tactical unit | **The stack.** Move/attack/target/select all operate on stacks. Individual ships are internal HP bookkeeping only. |
| Grouping rule | Group by `side` + `typeId`. One stack per ship type per side. |
| Stack size cap | `MAX_STACK_SIZE = 5`. |
| Overflow | A side with 12 fighters becomes 3 stacks (5/5/2) on 3 distinct cells — never a 12-icon pile. |
| Visual scaling | Icon size fixed; **1–5 ship icons** rendered as a tight cluster inside the 5vw cell (grid of up to 5 slots). |
| Count indicator | Numeric badge `×N` shown whenever `N ≥ 2`. Below 2, no badge. |
| Selection | Click anywhere in the cell selects the whole stack (single `button` per stack, `.selected` class + `ship-selected-pulse`). |
| Damage | Volley damage is applied to ships in stack order; overkill spills to the next ship. |
| Deaths | Dead ships flip `alive = false`, their icon disappears, badge decrements. When the last ship dies → `stack.destroyed = true`, explosion animation, stack removed from the grid. |
| Stack HP bar | Aggregate `Σhp / ΣmaxHp` rendered as a bar under the icons (reuses the existing `.hp-bar` styling). |

Rationale: individual ships as tactical units would make a 12-fighter fleet 12 clickable
targets and 12 AP decisions per turn — unplayable. Stacks keep the AP economy readable
while `BattleShip[]` preserves the per-ship detail the result contract needs.

## 8. Proposed AP system (derived from `ship-data.json`, not invented)

`AP_PER_TURN = 10` (shared pool per side, per turn).

**Tier table** — explicit lookup keyed by ship type id, derived from the `cost` column
(50 → 1200, a 24× spread; a pure formula mis-buckets `carrier` at 500):

| Tier | Move AP / cell | Attack AP | Ship types (cost) |
|---|---|---|---|
| 1 | 1 | 1 | scout (50), fighter (75), colonizer (100), corvette (120) |
| 2 | 2 | 2 | frigate (180), destroyer (260) |
| 3 | 3 | 3 | cruiser (400), carrier (500) |
| 4 | 4 | 4 | battleship (700), battlecruiser (750) |
| 5 | 5 | 5 | dreadnought (1200) |

**Movement budget** = the existing `speed` stat (1–5) = max cells a stack may move per turn.
So `speed` stays meaningful and no new movement stat is invented.

**Fallback** for unknown / virtual (building) types: `tier = clamp(ceil(cost/150), 1, 5)`;
if `cost` is absent → `tier = 3`, `immobile = true`, `attackAp = 2`.

Validation against the brief's own example (10 AP):

| Composition | Spend | Matches brief? |
|---|---|---|
| 5 fighters (T1), each move 1 cell + attack | 5 × 2 = **10 AP** | ✅ "5 fighters perform several actions" |
| 2 frigates (T2), each move 1 cell + attack | 2 × 4 = **8 AP**; full 4-cell move + attack = 2 × 10 = over budget | ✅ "2 frigates consume most of the AP" |
| 1 dreadnought (T5), move 1 cell + attack | 5 + 5 = **10 AP** | ✅ capital ship eats the whole turn |
| 1 cruiser (T3), full 3-cell move + attack | 9 + 3 = 12 > 10 | ✅ must choose: move 2 + attack = 9 |

## 9. Proposed movement rules

- Grid-based, orthogonal + diagonal steps, 1 cell at a time; no pathfinding needed beyond per-step validation.
- Cost: `tier` AP per cell entered, deducted immediately per cell.
- Limits per turn per stack: `cellsMovedThisTurn < moveRange` **and** `ap >= tier` **and** target cell in bounds **and** target cell unoccupied.
- `immobile` stacks (planet buildings) can never move.
- A stack may move in several separate commands within one turn (no "move once" restriction) until `moveRange` or AP runs out.
- Moving does **not** prevent attacking in the same turn (IG1 allows both); attacking does not prevent further movement either — AP is the only gate.
- Interaction: select stack → legal destination cells highlighted → click a cell → animation service plays the tween → AP deducted on completion.
- **No change to `StarMapMovementService`.** Strategic movement is untouched.

## 10. Proposed attack / action rules

Actions available: **Move**, **Attack**, **End Turn**. (No repair/board/retreat in v1.)

- Target must be an enemy stack within `attackRange` = the ship type's existing `range` stat (1–5).
- Range metric: **Euclidean on cells**, `dx² + dy² <= range²` — matches the project-wide sensor-range convention (`docs/invariants.md` §Sensor Range).
- One attack per stack per turn (`attackedThisTurn`), cost `attackAp = tier`.
- **Damage = whole-stack volley:**
  `totalAttack = Σ attack of alive ships in the firing stack`
  `damage = max(1, totalAttack - frontTargetShip.defense)`
  — identical in form to the existing `max(1, attack - defense)` rule (`battle.service.ts:171`), just aggregated over the stack. Defense is taken from the *front* target ship only (per-ship semantics), not summed.
- Damage applied to the target stack's alive ships in order; overkill spills to the next ship; each ship reaching `hp <= 0` becomes `alive = false`.
- Stack with zero alive ships → `destroyed = true`, removed from the grid.
- Log entry appended per attack (round, side, stack names, damage, kills).
- `attackType` / `weakness` / `shield` / `shieldRegen` remain **unused**, exactly as today.

## 11. Proposed turn lifecycle

```
createBattleState()  →  round 1, activeSide 'attacker', ap 10, phase 'playerTurn'|'aiTurn'

loop:
  active side spends AP on Move / Attack commands
     each command → animation service plays → state commits on animation end
  END TURN pressed (button disabled while animation lock is held)
     → battle-turn.service.endTurn(state)
        - activeSide flips
        - ap = AP_PER_TURN
        - cellsMovedThisTurn = 0, attackedThisTurn = false for the new side's stacks
        - if new activeSide === 'attacker' → round++
        - if new side is AI-controlled → phase 'aiTurn', battle-ai.service runs
  victory check after every damage application AND at end of turn:
     a side with zero alive ships loses → phase 'over', winner set, summary + BACK shown
```

- Attacker always acts first (preserves today's `currentFleetId = attackerId` start).
- `round` increments when control returns to the attacker (same semantics as today's `battleState.round`).
- **AI turn:** `battle-ai.service` runs a deterministic greedy pass — for each of its stacks, in ascending tier order: if an enemy is in range → attack; else move toward the nearest enemy stack until AP or `moveRange` is exhausted. It emits the same command objects as the player so animations play identically, awaits each one, then calls `endTurn()`. The AI reads/writes **only** `BattleModelState` — it has no knowledge of `enemy-ai`/`enemy-strategy`/`enemy-goal` layers.
- Which side is AI: `battle.attackerId`/`defenderId` vs. `fleet.factionId === 'player'`. If **both** sides are non-player (AI-vs-AI collision) the AI plays both. If **both** are player-owned that cannot happen (same-team factions never fight, `star-map-battle-detection.service.ts:66`).

## 12. Proposed animation / state-locking mechanism

Single source of truth: `BattleAnimationService` with an in-flight counter.

```ts
begin(): void            // counter++
end(): void              // counter--
get busy(): boolean      // counter > 0   (exposed as a signal for OnPush)
run<T>(seq: () => Promise<T>): Promise<T>   // wraps begin/end, guarantees end() on throw
reset(): void            // counter = 0 (component destroy / battle end)
```

- **Every** visual sequence goes through `run()`: move tween, muzzle flash, projectile travel, hit flash, explosion, stack removal.
- Sequences are `await`-chained promises with fixed durations from `battle.types.ts`
  (`MOVE_CELL_MS = 180`, `PROJECTILE_MS = 320`, `HIT_FLASH_MS = 200`, `EXPLOSION_MS = 420`).
  Implemented as CSS transitions/keyframes on absolutely-positioned divs (no canvas),
  awaited with duration-matched `setTimeout` — deterministic and fake-timer testable.
- State commits **after** the animation resolves, so the visible grid never shows a
  half-resolved action.

**Locks enforced while `busy`:**
1. `END TURN` button `[disabled]` — the explicit requirement.
2. All grid clicks (stack select, move target, attack target) ignored by the component.
3. `movement`/`combat` services additionally re-check `busy` and reject, so the rule
   layer cannot be driven while an animation is in flight even if the view layer has a bug.
4. `battle-ai.service` awaits each command's animation before issuing the next.
5. `BACK TO STAR MAP` button only appears at `phase === 'over'`, at which point
   `reset()` has already drained the counter.

Defensive: `ngOnDestroy` calls `reset()` and clears any pending timers so a route change
mid-animation cannot leak a timer into the next battle.

## 13. Proposed battle result model

```ts
interface BattleShipOutcome { shipId: number; typeId: string; name: string; hp: number; destroyed: boolean; }

interface BattleFleetOutcome {
  fleetId: number;                  // real fleet id, or -planetId for virtual defenses
  side: BattleSide;
  factionId: string;
  ships: BattleShipOutcome[];       // FULL roster, in input order, with final hp/destroyed
  survivors: BattleShipOutcome[];   // convenience filter
  wipedOut: boolean;                // survivors.length === 0
}

interface BattleOutcome {
  winnerSide: BattleSide;
  winnerFleetId: number;
  loserFleetId: number;
  attacker: BattleFleetOutcome;
  defender: BattleFleetOutcome;
  rounds: number;
  battleType: 'fleet' | 'planet';
  planetId?: number;
}
```

`battle-result.ts` builds this purely from `BattleModelState` — it never reads live
`Fleet` objects, so the minigame cannot accidentally mutate overworld state.

`BattleScreenComponent.backToStarMap()` translates `BattleOutcome` into the two existing
channels:
- `BattleService.setDestroyedFleetId(loserFleetId)` **only when `wipedOut`** (keeps today's contract).
- `BattleService.setBattleResult(outcome)` — new, carries survivor rosters.
- AUTOSAVE patch:
  - fleet battle → for each real fleet, overwrite `fleet.ships` from `outcome.ships` (hp + destroyed flags); set `fleet.destroyed = true` when wiped out.
  - planet battle → keep `applyPlanetBattleResult()` semantics (attacker wins → `planet.factionId = attacker.factionId`; attacker loses → attacker fleet ships updated/destroyed). Virtual defense ships are discarded, never written back.
- Then `gameTimeService.resume()` + `router.navigate(['/star-map'])` — unchanged order.

`StarMap.removeDestroyedFleetFromService()` gains one step: after applying
`destroyedFleetId`, also apply `BattleService.getBattleResult()` survivor rosters onto the
matching fleets, then `clearBattle()`. This is the **only** StarMap-side change.

## 14. Files to create / modify

**Create — battle minigame**

```
src/app/components/battle-screen/battle/battle.types.ts
src/app/components/battle-screen/battle/battle-ship-stats.ts
src/app/components/battle-screen/battle/battle-grid.ts
src/app/components/battle-screen/battle/battle-state.ts
src/app/components/battle-screen/battle/battle-result.ts
src/app/components/battle-screen/battle/battle-movement.service.ts
src/app/components/battle-screen/battle/battle-combat.service.ts
src/app/components/battle-screen/battle/battle-turn.service.ts
src/app/components/battle-screen/battle/battle-animation.service.ts
src/app/components/battle-screen/battle/battle-ai.service.ts
src/app/components/battle-screen/battle-grid/battle-grid.component.ts|.html|.scss
src/app/components/battle-screen/battle-fleet-panel/battle-fleet-panel.component.ts|.html|.scss
```

**Create — tests** (see §15)

**Modify**

```
src/app/services/battle.service.ts        strip simulation, add setBattleResult/getBattleResult, re-export Battle/BattleOutcome
src/app/components/battle-screen/battle-screen.component.ts      full rewrite as orchestrator
src/app/components/battle-screen/battle-screen.component.html    grid layout + AP bar + END TURN + log
src/app/components/battle-screen/battle-screen.component.scss    battle grid / stack / projectile styling
src/app/components/star-map/star-map.ts   removeDestroyedFleetFromService(): apply survivor rosters
docs/battle-rules.md                      rewrite for tactical combat (see below)
docs/data-models.md                       replace BattleState/BattleLogEntry sections with the new models
docs/architecture.md                      update battle-screen + battle.service descriptions
docs/game-systems.md                      §Battle Detection / Battle outcome
docs/invariants.md                        §Battle State Machine
docs/game-state.md                        §4.6 Battle + §8 known limitations
```

**Delete:** nothing. `battle-screen.component.*` is rewritten in place so the `/battle`
route in `app.routes.ts` and all StarMap call sites stay untouched.

**Documentation strategy:** `docs/battle-rules.md` is already the designated combat-rules
source of truth per `AGENTS.md`. Rewrite it in place to describe the tactical minigame
(grid, AP tiers, stacks, turn lifecycle, animation lock, result contract) rather than
adding a new file — so `AGENTS.md`'s documentation list needs no change.

**Explicitly NOT modified:** `StarMapMovementService`, `StarMapBattleDetectionService`,
`StarMapPlanetArrivalService`, `PlanetBattleService`, `ShipService`, all `enemy-*` AI
layers, `EconomyService`, `ProductionService`, `SaveGameService`, `GameTimeService`,
`app.routes.ts`, `ship-data.json`.

## 15. Tests to create

Vitest + `TestBed`, colocated `.spec.ts`, `vi.fn()` mocks, `vi.useFakeTimers()` for the
animation service — matching `enemy-ai.service.spec.ts` / `star-map.spec.ts` conventions.

| Spec | Coverage |
|---|---|
| `battle-ship-stats.spec.ts` | tier table for all 11 types; `speed`→moveRange, `range`→attackRange; cost fallback formula; building/virtual type fallback (`immobile`, tier 3, attackAp 2); unknown type id |
| `battle-grid.spec.ts` | bounds (1..18 / 1..7); occupancy lookup; Euclidean range inclusivity at exactly `range`; cell↔vw conversion matches `floor(vw/5)+1` |
| `battle-state.spec.ts` | deep-clone (input `Fleet.ships` unmutated); grouping by side+typeId; `MAX_STACK_SIZE` 5 → 12 fighters = 3 stacks (5/5/2); deployment columns 1–2 / 17–18; HP init from `ShipType.hitPoints`; round-robin row fill |
| `battle-movement.service.spec.ts` | AP deducted per cell; rejected when AP < tier; rejected beyond `moveRange`; rejected out of bounds; rejected onto occupied cell; `immobile` rejected; multi-command accumulation within one turn |
| `battle-combat.service.spec.ts` | `max(1, Σattack − frontDefense)`; out-of-range rejected; already-attacked rejected; AP insufficient rejected; overkill spill to next ship; ship death → `alive=false`; stack wipe → `destroyed=true`; friendly-fire impossible; log entry written |
| `battle-turn.service.spec.ts` | side flip; AP reset to 10; per-stack counters reset; `round++` only on return to attacker; victory on zero alive ships; `endTurn` rejected while animation busy; phase → `over` |
| `battle-animation.service.spec.ts` | `busy` false→true→false; nested/concurrent `run()` keeps counter balanced; `end()` still called when the sequence throws; `reset()` drains; END TURN gate reads `busy` |
| `battle-ai.spec.ts` | deterministic (same state → same command list); never exceeds AP; attacks when in range else closes distance; `immobile` stacks never move; terminates and calls `endTurn`; does not mutate anything outside `BattleModelState` |
| `battle-result.spec.ts` | full roster preserved in input order with final hp/destroyed; `survivors` filter; `wipedOut`; winner/loser ids; planet battle carries `planetId`; virtual defense ships excluded from write-back set |
| `battle.service.spec.ts` | transport contract unchanged (`setBattle`/`getBattle`/`getDestroyedFleetId`/`clearBattle`); new `setBattleResult`/`getBattleResult`; `clearBattle` resets result |
| `battle-screen.component.spec.ts` | creates with a battle from `BattleService`; pauses `GameTimeService` on init and resumes on destroy; END TURN `disabled` while animating, enabled after; click handlers rejected while busy; `backToStarMap()` patches AUTOSAVE (fleet + planet variants), sets destroyedFleetId only when wiped out, resumes time, navigates `/star-map`; no battle → no crash |
| `star-map.spec.ts` (extend) | survivor roster applied on `reloadAfterBattle`; partially-damaged winner keeps its fleet with reduced ships; wiped-out loser still marked `destroyed`; `battleService.clearBattle()` called |

Run: `npm test` (`ng test`, builder `@angular/build:unit-test`, Vitest globals via `tsconfig.spec.json`).
Type check: `npx tsc -p tsconfig.app.json --noEmit`.

---

## Design decisions requiring your approval

**D1 — Grid dimensions: 18 × 7 or 18 × 10?**
The rendered `.system-grid` is `90vw × 35vw` = 18 × 7 cells of 5vw, but
`SYSTEM_GRID_ROWS = 10` in `star-map-sensor.service.ts:57` (used only for sensor math and
never visible). The brief says "same dimensions as the existing System View grid".
→ **Recommend 18 × 7**, because it is what the player actually sees and it fits the
existing 90vw × 35vw box without new layout work. Choosing 18 × 10 would make the battle
grid 50vw tall and require its own scrolling/scaling.

**D2 — Non-player side: automated tactical AI, or hot-seat?**
→ **Recommend a simple deterministic greedy AI** (`battle-ai.service`, §11). Enemy fleets
and planet defenses must be able to fight without a human, and every AI faction battle
would otherwise stall. Hot-seat would only work for player-vs-player, which cannot occur.

**D3 — Partial losses persist back to the overworld?**
Today the loser fleet is wholly destroyed and the winner's roster is untouched
(`docs/battle-rules.md` §Limitations). The brief requires the result to carry
"destroyed ships / surviving ships", which only matters if survivors persist.
→ **Recommend yes**: write per-ship `currentHp` / `destroyed` back for both sides
(§13). This is a real behaviour change — a damaged winner now returns to the map damaged,
and a fleet can lose ships without being wiped out. If you prefer to keep all-or-nothing,
the result model still reports survivors but `backToStarMap()` writes only the loser's
`destroyed` flag.

**D4 — Planet battles on the same tactical grid?**
→ **Recommend yes**, with defense buildings as `immobile` stacks in the defender columns
(§6/§8). Alternative: keep the old auto-resolver for planet battles and use the tactical
grid only for fleet battles — this means maintaining two battle systems.

**D5 — AP numbers** (10 AP/turn; tier table §8; moveRange = `speed`; attackRange = `range`; one attack per stack per turn).
→ **Recommend as specified** — it reproduces your "5 fighters vs 2 frigates" example
exactly. Confirm or adjust the tier boundaries.

**D6 — Weapon effectiveness and shields: in scope?**
`attackType`/`weakness`/`shield`/`shieldRegen` are in the data but unused everywhere today.
→ **Recommend out of scope for v1** so the damage rule stays `max(1, attack − defense)`
and the change set stays contained. Flag as a follow-up.

**D7 — Range metric: Euclidean or Chebyshev?**
→ **Recommend Euclidean** (`dx² + dy² <= range²`), matching the project-wide sensor-range
convention in `docs/invariants.md`. Chebyshev would make range 2 reach further diagonally.

**D8 — Volley model: whole-stack single volley, or per-ship shots?**
→ **Recommend whole-stack volley** (§10): one attack action, one projectile animation,
`Σattack` vs. the front ship's `defense`. Per-ship shots would mean N projectiles and N
animations per action, and would make large stacks overwhelmingly slow to resolve.

**D9 — Delete the old auto-simulation API** (`processStep`, `getTickRate`, `setTickRate`, `getCurrentRound`, `getWeakestShip`)?
→ **Recommend delete.** Grep confirms `BattleScreenComponent` is the only caller.

**D10 — Dead field `Battle.capturedPlanetId`** (declared, never read).
→ **Recommend remove** while `battle.service.ts` is being rewritten, or keep for
forward compatibility if you have a capture flow planned.

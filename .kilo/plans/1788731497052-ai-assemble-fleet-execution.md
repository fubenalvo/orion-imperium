# AI V5.2 – `assemble_fleet` action execution

## Goal

Make `EnemyActionExecutor` actually execute the V5 `assemble_fleet` `ActionResult`, so a produced colonizer sitting in the faction ship stock is moved into an AI-owned fleet via the existing `FleetAssemblyService`. Stop after the ship is in a fleet — no movement, no colonization.

The target state after V5.2:

```text
strategy (V4.1) → goal (V4.2) → capability (V4.3) → action (V5) → executor → ShipStockService → FleetAssemblyService → AI fleet with colonizer
```

## Confirmed design decisions

1. **Assembly policy = reinforce-first** (user confirmed): if the AI faction owns at least one usable, non-destroyed fleet that does not yet carry a colonizer, assemble into it via `FleetAssemblyService.reinforceFleet`. Only when no such fleet exists, create a new fleet via `FleetAssemblyService.createFleet` at the AI's deterministically first owned Spaceport planet.
2. **Deterministic selection, no new scoring**: reinforce candidate = faction fleet with lowest `fleet.id` (then `name` tie-break), mirroring the sort order already used by `EnemyActionService.findFleetWithColonizer` / `findBestEnemyFleet` (enemy-action.service.ts:352, :368). Create location = first entry of `SpaceportService.listSpaceports(factionId, ...)` sorted by ascending `system.id`, then ascending `planet.id`.
3. **Composition is always exactly `[{ typeId: 'colonizer', count: 1 }]`** — the current `assemble_fleet` action only ever means "a colonizer is in stock but no fleet carries one"; the executor keeps this generic shape by driving the existing assembly service with an `AssemblyRequest[]`.
4. **Idempotency = stateless state-fact guards** (same pattern as V5.1 `hasPendingColonizerOrder`, enemy-action-executor.service.ts:128): the executor keeps **no mutable state**; it re-checks game state every frame. The mutation itself flips the guard:
   - A non-destroyed faction fleet that already carries a living colonizer → skip (`return false`). Executed once, the fleet carries the colonizer, so every later frame is blocked.
   - Zero colonizers in faction stock → skip.
   This prevents duplicate assembly across frames while the 2s action re-evaluation window is still open (and also handles multi-colonizer stocks).
5. **Existing game rules are the source of truth**: assembly only happens when `FleetAssemblyService` accepts it. Both `reinforceFleet` and `createFleet` require the faction to own ≥1 Spaceport building (`fleet-assembly.service.ts:72`, `:153`). If no Spaceport exists, no mutation and no log (silent `return false`), exactly like failed `produce_colonizer` attempts.
6. Action `targetSystemId`/`targetPlanetId` (the *colonization* target) are ignored by the executor — no new target-selection logic. `targetId` is undefined for `assemble_fleet`, so selection is purely state-based per decision 2.

## Files to modify

### 1. `src/app/components/star-map/enemy-action-executor.service.ts` (main change)

- Add constructor deps: `ShipStockService`, `FleetAssemblyService`, `SpaceportService` (all `providedIn: 'root'`). Keep existing `ProductionService`, `ShipService`, `ResearchService`.
- Refactor `tick` into a dispatcher on `action.type`:
  - `produce_colonizer` → move the existing body verbatim into a private `executeProduceColonizer(...)` (guards and behavior unchanged; existing tests must stay green).
  - `assemble_fleet` → new private `executeAssembleFleet(action, starSystems, shipStock, fleets): boolean`.
  - everything else → `false` (unchanged; `move_to_target`, `colonize`, `attack`, `defend`, `develop`, `none` stay unexecuted).
- Keep the top-level guards identical: `gameDeltaTime <= 0`, no `action`, not an enemy faction id.
- New helpers:
  - `hasFleetWithColonizer(factionId, fleets): boolean` — any `!destroyed` faction fleet whose `ships` contain a living `colonizer`. Idempotency guard; checked first.
  - `selectReinforceFleet(factionId, fleets): Fleet | undefined` — non-destroyed faction fleets, has ≥1 living ship (`ships.some(s => !s.destroyed)`), no living colonizer; pick lowest `id` then `name`.
  - `selectAssemblySpaceport(factionId, starSystems): { system, planet } | undefined` — `SpaceportService.listSpaceports` sorted by `system.id` (localeCompare) then `planet.id`; first entry.
- Execution path:
  1. `if (hasFleetWithColonizer(...)) return false;` (duplicate/stale-action guard)
  2. `if (shipStockService.getCount({ shipStock }, factionId, 'colonizer') < 1) return false;`
  3. Reinforce candidate exists → `fleetAssemblyService.reinforceFleet({ shipStock, fleets }, starSystems, { factionId, fleetId: candidate.id, composition: [{ typeId: 'colonizer', count: 1 }] })`.
  4. Else → `fleetAssemblyService.createFleet({ shipStock, fleets }, starSystems, { factionId, fleetName: '', systemId, planetId, composition: [{ typeId: 'colonizer', count: 1 }] })`. Empty `fleetName` falls back to the service default `` `${factionId} Fleet` `` (fleet-assembly.service.ts:110).
  5. `if (!result.ok) return false;` (no partial state — the service validates stock before removing).
  6. Log once and `return true`.
- Logging (follow existing `[Enemy AI] ... executed ...` convention, enemy-action-executor.service.ts:119):
  - reinforce: `[Enemy AI] ${factionId} executed assemble_fleet: reinforced fleet ${fleet.name} with 1 colonizer`
  - create: `[Enemy AI] ${factionId} executed assemble_fleet: created fleet ${fleet.name} with 1 colonizer`
  No logging on failed/skipped frames.
- Update the class-level doc comment and `reset()` comment: V5.2 supports `produce_colonizer` + `assemble_fleet`; still no mutable executor state.

### 2. `src/app/components/star-map/enemy-action-executor.service.spec.ts`

- Extend `beforeEach` providers: add real `ShipStockService`, `SpaceportService`, `FleetAssemblyService`, and a `StarMapMovementService` mock `{ getPlanetGridPosition: vi.fn(() => ({ col: 2, row: 2 })) }` (create path only; static `systemCellSizeVw` stays intact on the real class). Keep existing mocked `ProductionService`, `ShipService`, `ResearchService`.
- Add a new `describe('assemble_fleet execution')` with the tests listed in the Tests section.

### 3. `src/app/components/star-map/star-map.spec.ts`

- Add one full-pipeline integration test inside `describe('EnemyActionService integration')` (mirrors `'should execute produce_colonizer through the full AI pipeline'`, star-map.spec.ts:206). No change to the component or game loop is needed.

### 4. `docs/game-state.md` (minimal doc update, no new doc file)

- Line 52 feature table: AI opponents → "V5.2 pipeline (... executes produce_colonizer + assemble_fleet)".
- Line 95 file-list comment: executor = "action execution (produce_colonizer, assemble_fleet)".
- Section 4.17 (lines ~391–410): add a short sub-block/`4.18 Enemy Action Execution (V5.1 → V5.2)` documenting the split:
  - `EnemyActionService` = decision / planning (no mutation).
  - `EnemyActionExecutor` = state mutation / execution through existing services.
  - Currently executable: `produce_colonizer`, `assemble_fleet`. Not yet executable: `move_to_target`, `colonize`, `attack`, `defend`, `develop`, `none`.
  - Note the executor runs every frame with stateless state-fact idempotency guards.
- Lines 575–576 (known limitations) and 620 (Hungarian summary): replace "execution is not yet implemented / do not execute actions" with accurate V5.2 wording.
- Optional: refresh spec-count references (star-map.spec and add `enemy-action-executor.service.spec.ts` to the test list). Keep this minimal.

No new source files and no changes to `enemy-action.service.ts`, strategy/goal/capability layers, models, save/load, or any other game system.

## Existing services and exact methods reused

- `ShipStockService.getCount(data, factionId, typeId)` — ship-stock.service.ts:46 (guard).
- `ShipStockService.removeFromStock(...)` — ship-stock.service.ts:86, invoked **inside** `FleetAssemblyService`; executor never calls it directly.
- `FleetAssemblyService.reinforceFleet(data, starSystems, request)` — fleet-assembly.service.ts:134 (existing fleet path).
- `FleetAssemblyService.createFleet(data, starSystems, request)` — fleet-assembly.service.ts:58 (no-fleet fallback; also performs spaceport/ownership/stock validation).
- `SpaceportService.listSpaceports(factionId, starSystems)` — spaceport.service.ts:25 (deterministic create location).
- `ProductionService.queueOrder` — reused unchanged for the `produce_colonizer` branch.

Both assembly entry points already enforce: stock-check before mutation (`checkStock`, fleet-assembly.service.ts:213), faction-scoped `removeFromStock` (wrong-faction stock cannot be popped), `enemy_fleet`/`fleet_not_found`/`no_spaceport` failure reasons with no partial state, and `stockEntryToFleetShip` conversion (fleet-assembly.service.ts:229) so the id space stays shared.

## Execution flow

```text
EnemyActionService (decision only, unchanged)
  → ActionResult { type:'assemble_fleet', factionId, goalType:'colonize', targetId:undefined }
  → EnemyActionExecutor.tick (every frame, scaled delta)
  → guards: enemy faction; no fleet already carrying a colonizer; ≥1 colonizer in faction stock
  → candidate fleet? yes → FleetAssemblyService.reinforceFleet
                      no  → FleetAssemblyService.createFleet at deterministic Spaceport planet
  → ShipStockService.removeFromStock (inside assembly service) → Fleet.ships.push(stockEntryToFleetShip(entry))
  → stock -1, fleet ships +1, same ship id never in both places
  → log once, return true
  → next frames blocked by the "fleet already carries colonizer" guard until the 2s action
    re-evaluation replaces assemble_fleet with move_to_target/colonize (unexecuted in V5.2)
```

After V5.2 the action layer's `evaluateColonizeExecute` (enemy-action.service.ts:218) naturally finds the assembled fleet and reports `move_to_target`/`colonize`; the executor ignores those, so the fleet neither moves nor colonizes yet.

## Tests

Executor unit tests (in the existing executor spec file), using **real** `ShipStockService`, `SpaceportService`, `FleetAssemblyService` so stock/fleet invariants are observable:

1. **Successful assembly** — enemy1 owns a Spaceport planet, has a usable fleet and 1 colonizer in stock → `tick` returns true; stock colonizer count 0; fleet `ships` grew by one colonizer with the same ship id.
2. **Colonizer assembly** — same as #1, asserts the added ship `type === 'colonizer'` (the V5.1-produced ship enters the AI fleet).
3. **No available ship** — empty stock → `tick` false; stock and fleets unchanged.
4. **Wrong faction safety** — colonizer only in enemy2's stock, action for enemy1 → false; enemy2 stock and enemy1 fleet unchanged.
5. **Player safety** — colonizer only in `player` stock (action enemy1) → false; player stock/fleet unchanged. Also `action.factionId === 'player'` → false.
6. **Duplicate execution** — stock with 2 colonizers: first `tick` moves exactly 1; second `tick` with the same action returns false and leaves 1 colonizer in stock, 1 colonizer in fleet.
7. **Existing fleet reinforcement** — asserts same fleet object/id, position (`x`, `y`, `system`, `gridCol`/`gridRow`) and `name` unchanged, `fleets.length` unchanged, ships count +1.
8. **New fleet creation** — no enemy1 fleet, enemy1-owned Spaceport planet, 1 colonizer in stock → `tick` true; exactly 1 new fleet with `factionId 'enemy1'`, one `colonizer` ship, galaxy position = host system `x`/`y`, `system.id` = host system, `gridCol`/`gridRow` from the movement mock, default name; stock 0.
9. **Failed assembly leaves no partial state** — fleet exists + stock colonizer but **no Spaceport** anywhere → false; stock and fleet unchanged (requirement 9).
10. **Stale-action idempotency** — fleet already carries a colonizer, another colonizer in stock, action still `assemble_fleet` → false, nothing moves.
11. **Guard rails** — paused (`delta<=0`), non-enemy faction, other action types (`none`, `move_to_target`) → false.
12. **Logging** — log emitted exactly on the successful execution (spy on `console.log`, existing pattern at executor spec line 308).

Integration test (`star-map.spec.ts`):

13. **End-to-end colonizer → fleet** — seed enemy1 with `basic_engineering` researched, add a `Spaceport` building to an existing enemy1-owned planet, add one colonizer to `component.shipStock` for enemy1 (RAIDER fleet id 3 already exists and is usable), then call `gameLoopCallback(2)`. Assert: `actionService.getAction('enemy1')?.type === 'assemble_fleet'`; RAIDER's `ships` contains a colonizer; enemy1 colonizer stock count is 0. Call `gameLoopCallback(2)` once more and assert still exactly one colonizer in the fleet (no duplication across loop iterations; movement/colonize not asserted).

Validation commands: `npm test` (Vitest via `ng test`), plus `npm run build` for type checking.

## Risks / notes

- **Spaceport dependency**: `FleetAssemblyService` requires the AI faction to own a Spaceport; the current `star-map-data.json` gives neither AI faction one (no factory either), so in a real map the chain stalls until such buildings exist. This is an existing game-rule constraint, deliberately respected (no mutation on failure). Out of scope: AI building production.
- **V3 interplay**: `EnemyAiService` (V3) steers every enemy fleet toward player fleets; after V5.2 the reinforced fleet may still be V3-chased until V5.3 `move_to_target` is implemented. Not addressed here by design (scope boundary).
- **Reinforce location**: `reinforceFleet` does not require the target fleet to be at the Spaceport (existing service semantics, same as the player reinforce UI). Ships are pushed into the chosen fleet wherever it is.
- **Executor constructor changes**: the existing executor spec's `TestBed` must gain the new providers; existing produce tests must remain green unchanged (they do not touch the new services).
- **No new mutable executor state**: `reset()` stays a no-op; no `Map`/executed-set to keep in sync with save/load.

## Out of scope (explicitly not implemented)

`move_to_target`, `colonize`, `attack`, `defend`, `develop`, retreat, new strategy/goal/capability logic, AI building logic, changes to V4.1/V4.2/V4.3/V5 decision layers, movement, colonization, and any big refactor.

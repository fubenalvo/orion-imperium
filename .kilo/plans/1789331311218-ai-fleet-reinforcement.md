# Plan: AI Fleet Reinforcement

> Date: 2026-09-14
> Scope: Enable AI to detect damaged fleets, reinforce from stock, and create new fleets. Do not code.

---

## Problem Statement

The AI currently has no mechanism to recover fleet strength after combat losses. When a fleet is destroyed or severely damaged, the AI falls back to `produce_combat_ship` (slow, queued production) but never pulls existing ships from stock to immediately reinforce, nor creates a new defensive fleet. This leads to extended periods of no combat capability.

---

## Design Decisions

### 1. Fleet Strength Measurement

**Decision**: Use existing `ShipService.calculateFleetStrength(ships)` — sum of `attack + defense + hitPoints/10 + shield/10` per ship.

**Rationale**: Already implemented, tested, and used in `EnemyCapabilityService.evaluateAttack()`. No new calculation logic.

### 2. Peak Strength Tracking

**Decision**: Track peak fleet strength per faction in `EnemyCapabilityService` via a `Map<string, number>`. Update peak whenever a fleet's strength increases (new ships added via assembly/production). No persistence needed — recalculated each session.

**Rationale**: Avoids modifying data models (no new Faction fields). AI internal state is ephemeral.

### 3. When Reinforcement is Requested

**Decision**: A faction needs reinforcement when any of its non-destroyed fleets has current strength < `reinforcementThreshold` (default 50%) of its peak strength, OR when the faction has zero combat-capable ships in all fleets.

**Rationale**: A fleet at 50% of peak is significantly degraded. Zero combat ships means no defense capability.

### 4. Minimum Reinforcement Threshold

**Decision**: Reinforcement only triggers if the target fleet would have ≥2 combat ships after reinforcement. A single-ship fleet provides no tactical flexibility.

**Rationale**: Avoids "meaningless one-ship fleets." The AI either reinforces meaningfully or not at all.

### 5. Assembly Location

**Decision**:
- **Reinforce existing fleet**: Ships added to fleet roster at current location (no movement). Uses `FleetAssemblyService.reinforceFleet`.
- **Create new fleet**: Placed at nearest owned Spaceport (deterministic: lowest system ID, then lowest planet ID). Uses `FleetAssemblyService.createFleet`.

**Rationale**: Matches existing `FleetAssemblyService` behavior. New fleets appear at the Spaceport they were assembled at (per invariants.md § Ship Production & Fleet Assembly).

### 6. Reinforcement vs New Fleet Creation Priority

**Decision** (ordered):
1. **Reinforce weakest existing fleet** (lowest current/peak strength ratio)
2. **Create new fleet** (if no existing fleet is viable but total combat strength is 0 and threat exists) with minimum composition of 2 combat ships
3. **Fall back to `produce_combat_ship`** (if can't reinforce or create due to economy/stock/spaceport constraints)

**Rationale**: Reinforcing existing fleets is cheaper (no new fleet ID, no positioning) and faster. New fleets are a last resort when no existing fleet can be saved.

### 7. Economy Guard

**Decision**: Do not reinforce if faction credits < `economyThreshold` (default: 3× cost of cheapest available combat ship). This prevents spending all resources on reinforcement while the economy is collapsing.

**Rationale**: A faction that can't sustain itself shouldn't drain reserves on fleet recovery. Production (`produce_combat_ship`) continues as a slower fallback since it's spread over time.

### 8. Destroyed Fleet Guard

**Decision**: Skip any fleet where `fleet.destroyed === true`.

**Rationale**: Trivial — destroyed fleets are excluded from all game logic per invariants.md.

### 9. Fleet In Battle Guard

Decision**: Skip reinforcement for fleets currently engaged in battle. Implementation: check if any fleet pair overlap (same grid cell, different teams, non-destroyed). This is computed from existing fleet positions — no new battle state tracking needed.

**Rationale**: Reinforcing a fleet mid-battle is tactically unsound (ships arrive at the battle site, not the front line). Future refinement: add a `BattleState` tracking layer.

### 10. Integration with Existing Pipeline

**Decision**: Extend the existing `defend` goal (V4.2) and `defend` capability (V4.3):

| Layer | Change |
|-------|--------|
| `EnemyCapabilityService.evaluateDefend()` | Add `fleet_needs_reinforcement` requirement |
| `EnemyActionService.evaluateDefendPrepare()` | Check reinforcement needs before `produce_combat_ship` fallback |
| `EnemyActionExecutor` | Add `reinforce_fleet` and `create_fleet` action execution |

**No changes to**: strategy layer (V4.1), goal selection (V4.2), player production, battle minigame.

### 11. New Action Types

| Action Type | Service Method | Purpose |
|-------------|---------------|---------|
| `reinforce_fleet` | `FleetAssemblyService.reinforceFleet` | Add ships from stock to existing fleet |
| `create_fleet` | `FleetAssemblyService.createFleet` | Create new fleet at Spaceport |

Both follow the existing pattern: action selected by `EnemyActionService`, executed by `EnemyActionExecutor`.

---

## Data Flow

```
EnemyCapabilityService.tick()
  ↓
evaluateDefend()
  fleet_needs_reinforcement = (currentStrength < 0.5 * peakStrength) || (totalCombatShips == 0)
  economy_ok = (credits >= 3 * cheapestCombatShipCost)
  not_in_battle = no fleet overlap detected
  ↓
EnemyActionService.evaluateDefendPrepare()
  if fleet_needs_reinforcement && economy_ok && not_in_battle:
    if any existing fleet damaged:
      → reinforce_fleet (target weakest fleet, composition from stock matching fleet's combat types)
    elif totalCombatShips == 0:
      → create_fleet (composition: 2x cheapest combat ship)
    else:
      → none
  elif !fleet_can_engage:
    → produce_combat_ship (existing fallback)
  else:
    → none
  ↓
EnemyActionExecutor.tick()
  reinforce_fleet → FleetAssemblyService.reinforceFleet(data, systems, {factionId, fleetId, composition})
  create_fleet → FleetAssemblyService.createFleet(data, systems, {factionId, fleetName, systemId, planetId, composition})
```

---

## Composition Selection for Reinforcement

When reinforcing an existing fleet, pull the same ship types the fleet already has (replace damaged with stock copies). If stock lacks matching types, pull the cheapest combat ship type available.

When creating a new fleet, use 2× the cheapest unlocked combat ship the faction can afford.

---

## Failure Modes and Fallbacks

| Failure | Fallback |
|---------|----------|
| No stock of needed ship type | `produce_combat_ship` (queued production) |
| No Spaceport | `produce_combat_ship` |
| Insufficient credits | `produce_combat_ship` |
| Fleet in battle | Skip, try again next tick |
| Economy collapsing | `produce_combat_ship` (slower but doesn't drain reserves) |
| No combat ships in stock or production | `develop` (build infrastructure for future production) |

---

## Test Matrix

### Capability Tests (`enemy-capability.service.spec.ts`)

| Test | Verifies |
|------|----------|
| Fleet needs reinforcement when below 50% peak | `fleet_needs_reinforcement` requirement is true |
| Fleet does not need reinforcement at full strength | `fleet_needs_reinforcement` is false |
| Fleet needs reinforcement when zero combat ships | `fleet_needs_reinforcement` is true |
| Fleet does not need reinforcement when economy collapsing | `fleet_needs_reinforcement` is false when credits low |
| Fleet needs reinforcement after peak drops (ships lost) | Peak tracking works correctly |
| Fleet does not need reinforcement for one-ship deficit | Threshold prevents micro-reinforcement |

### Action Tests (`enemy-action.service.spec.ts`)

| Test | Verifies |
|------|----------|
| defend prepare returns reinforce_fleet when fleet damaged | Action type is `reinforce_fleet` |
| defend prepare returns create_fleet when no existing fleet viable | Action type is `create_fleet` |
| defend prepare returns produce_combat_ship when can't reinforce | Action type is `produce_combat_ship` |
| defend prepare returns defend when fleet healthy | Action type is `defend` |
| defend prepare returns none when economy collapsing and no stock | Action type is `none` |
| reinforce_fleet composition matches fleet's existing combat types | Correct ship types selected |
| create_fleet uses minimum 2-ship composition | Composition has ≥2 ships |

### Executor Tests (`enemy-action-executor.service.spec.ts`)

| Test | Verifies |
|------|----------|
| reinforce_fleet adds ships from stock to fleet | Ships added, stock reduced |
| reinforce_fleet fails when insufficient stock | No state change, returns false |
| reinforce_fleet fails when fleet destroyed | No state change, returns false |
| reinforce_fleet fails when no Spaceport | No state change, returns false |
| reinforce_fleet does not duplicate ships | Stock count correct after multiple ticks |
| create_fleet creates fleet at nearest Spaceport | Fleet created at correct system/planet |
| create_fleet fails when no Spaceport | Returns false |
| create_fleet fails when insufficient stock | Returns false |
| create_fleet uses 2-ship minimum composition | Composition has exactly 2 ships |
| create_fleet skips one-ship composition | Never creates single-ship fleet |
| create_fleet fails when economy collapsing | Returns false when credits low |
| pause: no reinforcement when deltaTime is 0 | Returns false, no state change |
| multiple AI factions: independent reinforcement | Each faction makes own decision |

### Edge Case Tests

| Scenario | Expected Behavior |
|----------|-------------------|
| Fleet has 1 combat ship + 1 colonizer | Reinforce (has combat capability, 2 ships after) |
| Fleet has 0 ships (empty) | Create new fleet |
| Stock has only colonizers | Fall back to produce_combat_ship |
| Multiple damaged fleets | Reinforce weakest first |
| Fleet is at Spaceport vs in deep space | Reinforce at current location (no movement) |
| Faction has Spaceport but planet is unhabited | Create fleet at owned planet with Spaceport |

---

## Open Questions

1. **Fleet in battle detection**: Currently no per-fleet battle flag. Decision is to skip this guard in V1 and rely on natural flow. Future: add battle state tracking.
2. **Peak strength update trigger**: Need to determine exact hooks — production completion, assembly, battle outcome. Simplest: recalculate peak every strategy tick (every 2s).
3. **One-ship fleet threshold**: Is "≥2 combat ships after reinforcement" the right threshold? Yes for V1; prevents meaningless fleets while allowing small escorts.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|----|----------|------------|
| Peak tracking inaccurate due to timing | Medium | Recalculate every strategy tick (2s); peak only increases |
| AI drains reserves on reinforcement | Low | Economy guard (3× cost threshold) |
| Reinforcement creates fleet at wrong location | Low | Deterministic selection (lowest system/planet ID) |
| Reinforcement during battle wastes ships | Low | Skip in-battle fleets; future refinement |
| Test flakiness from peak tracking | Low | Deterministic; no randomness |

---

## Implementation Status (2026-09-14)

Implemented and verified.

**Files changed**

| File | Change |
|------|--------|
| `star-map.models.ts` | Added `reinforce_fleet` / `create_fleet` to `ActionType`; added `value?: number` to `CapabilityRequirement`; added `targetStrength?: number` to `ActionResult`; added `shipTypeId` to `ActionResult` (shared with combat production) |
| `enemy-capability.service.ts` | Added `REINFORCEMENT_THRESHOLD` and peak-strength `Map`, `updatePeakStrength()` called at the start of each strategy tick, `fleet_needs_reinforcement` requirement (with `value: peak`), and cleared peak state on `reset()`. `canExecute` ignores `fleet_needs_reinforcement` because it is an informational requirement, not a blocker |
| `enemy-action.service.ts` | `evaluateDefendPrepare()` now returns `reinforce_fleet` (under-strength), `create_fleet` (no combat capability), or `produce_combat_ship` (production fallback); added `canAffordReinforcement`, `selectWeakestFleet`, `selectReinforcementPlanet`; action carries `targetStrength` |
| `enemy-action-executor.service.ts` | Added `executeReinforceFleet` and `executeCreateFleet`; both use the real `FleetAssemblyService` / global stock. Guards: alive/owned fleet, target-strength dedup, active-engagement (co-located hostile fleet) skip |

**Deviations from the plan**

- Fleet-in-battle is detected by co-location with a hostile fleet instead of a battle-state flag, because no per-fleet battle state exists. It is a defensive guard; the galaxy simulation is paused while the battle screen is active.
- The economy guard is enforced in the action layer (`canAffordReinforcement`) rather than the capability layer, so the capability result stays a pure assessment.
- Reinforcement uses the real `FleetAssemblyService` in tests (spied) rather than a hand-rolled mock, guaranteeing Spaceport/stock rules match production behavior.

**Verification**

- `npx ng build` — succeeds.
- `npx ng test --headless` — 581 passed, 12 failed. All 12 failures are pre-existing battle-screen / `app.spec.ts` failures unrelated to this work.
- New coverage: `reinforce_fleet` (damaged fleet, combat losses, target-strength dedup, destroyed fleet, no stock, no combat ships, no Spaceport, paused, player faction, fleet not owned, multi-faction, active engagement, ally co-location, fleet identity + save/load round-trip), `create_fleet` (Spaceport, owned planet, no Spaceport, unknown ship type, player faction, paused, missing system, composition, combat-fleet dedup), `fleet_can_engage` for transport-only fleets, living-ship strength after battle losses, shield-pool `0` persistence, and the action-layer `reinforce_fleet`/`create_fleet` production.

---

## Post-Review Fixes (2026-09-14)

A `/review uncommitted` pass found that the first implementation looked correct but several new AI branches were unreachable in the real pipeline. All findings were fixed:

| Finding | Fix |
|---|---|
| `create_fleet` created without `shipTypeId` → never executed | `evaluateDefendPrepare` now selects a stock combat ship via `selectStockCombatShip` and passes its id |
| `reinforce_fleet` only reachable when there was no threat | `evaluateAction` evaluates the defend preparation first for the defend goal and returns `reinforce_fleet` before the execute branch |
| `fleet_can_engage` was equivalent to `available_fleet` (every hull has positive strength) | Combat capability now requires a living combat-role ship via shared `isCombatShipType` |
| Destroyed ships counted toward strength, so partial losses never triggered reinforcement | `totalFactionStrength` and the executor guard aggregate living ships only |
| Persisted `0` shield pool was treated as "no value" and restored to full | `planet-battle.service.ts` drops the `> 0` check and clamps with `Math.min` |
| `create_fleet` had no frame-loop dedup | New `hasCombatFleet` guard skips once a living combat fleet exists |
| `selectReinforcementPlanet` duplicated Spaceport detection | Now uses `SpaceportService.listSpaceports` with deterministic ordering |
| Unused `production` parameter in `executeCreateFleet` | Removed |
| Duplicated combat-role filter | Shared `isCombatShipType` in `ai-queries.ts` |
| Duplicated peak-strength aggregation | Shared `totalFactionStrength` helper |

Regression tests were added for each fixed behavior because the original tests passed while the features were broken (they mocked capability results that the real capability service could not produce).

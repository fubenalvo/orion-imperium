# Plan: AI Combat Ship Production Extension

> Date: 2026-09-14
> Scope: Extend AI production pipeline to produce combat ships when threatened or preparing to attack. Do not code.

---

## Current State Analysis

### Pipeline Architecture (5 layers)

```
V4.1 EnemyStrategyService
  ↓ determines strategy (defend/attack/expand/develop)
V4.2 EnemyGoalService
  ↓ selects concrete goal (colonize/attack/defend/develop)
V4.3 EnemyCapabilityService
  ↓ evaluates capabilities (canExecute + requirements)
V5 EnemyActionService
  ↓ determines next action (produce_colonizer/assemble_fleet/attack/move_to_target/defend/develop)
V5.1-V5.3 EnemyActionExecutor
  ↓ executes action (queueOrder/reinforceFleet/move/setTarget)
```

### Current Gap

**Attack path dead-end**: When AI strategy is `attack` but faction lacks combat ships:
1. `EnemyCapabilityService.evaluateAttack()` sets `fleet_can_engage = false`
2. `EnemyActionService.evaluateAttackPrepare()` returns `none` action
3. **No production path exists** — AI never produces combat ships

**Colonizer path works**:
1. `EnemyCapabilityService.evaluateColonize()` checks `colonizer_available`
2. If false, `EnemyActionService.evaluateColonizePrepare()` → `produce_colonizer`
3. `EnemyActionExecutor.executeProduceColonizer()` → `ProductionService.queueOrder()`

### Production Pattern (from `canProduceColonizer` at enemy-action.service.ts:383-424)

```typescript
canProduceColonizer(factionId, factions, starSystems): boolean {
  1. Research: isResearched(faction, 'basic_engineering')
  2. Unlock: isShipUnlocked(faction, 'colonizer')
  3. Cost: faction.credits >= colonizer.cost
  4. Capacity: productionService.getPlanetCapacity(planet, 'spaceship_factory') > 0
}
```

This pattern is exactly what combat ship production needs.

---

## Proposed Extension

### New Action Type

Add `produce_combat_ship` to `ActionType` in `star-map.models.ts`.

Same pattern as `produce_colonizer`:
- Queues a production order on a planet with `spaceship_factory`
- Ship enters stock when produced
- Fleet assembler later picks it up

### New Capability Requirements (EnemyCapabilityService)

For `attack` goal, add these requirements when `fleet_can_engage` is false:

| Requirement Type | Check | Purpose |
|---|---|---|
| `combat_ship_unlocked` | `researchService.isShipUnlocked(faction, shipId)` for cheapest combat ship | Faction can build this ship type |
| `combat_ship_affordable` | `faction.credits >= cheapestCombatShip.cost` | Faction can afford this ship |
| `combat_ship_capacity` | `productionService.getPlanetCapacity(planet, 'spaceship_factory') > 0` | Has a factory available |

### State Transitions

```
Strategy: attack
  Goal: attack
  Capability: fleet_can_engage = false
    ↓
  Action: produce_combat_ship (cheapest unlocked combat ship)
    ↓ Production order queued
    ↓ Ship produced → enters stock
    ↓ Fleet assembler picks up ship
    ↓ fleet_can_engage becomes true
    ↓ Action: assemble_fleet or attack
```

### Combat Ship Selection Logic

**Priority 1**: Cheapest unlocked combat ship the faction can afford.

Filter criteria:
1. `role !== 'Recon'` and `role !== 'Colonizer'` (not scout/colonizer)
2. `researchService.isShipUnlocked(faction, shipId)` (researched)
3. `faction.credits >= ship.cost` (affordable)
4. Choose the one with lowest `cost`

This ensures:
- AI doesn't produce ships it cannot afford
- AI uses existing research unlocks
- AI produces sensible combat types (not colonizers/recon)

### Prevention of Endless Colonizer Production When Threatened

Currently:
- Strategy `defend` is chosen when `isThreatened()` returns true
- But `evaluateDefendPrepare()` has no production fallback

Fix: When strategy is `defend` and AI has no combat ships, produce combat ships instead of colonizers.

Logic in `EnemyActionService.evaluateDefendPrepare()`:
```
if (no combat ships in faction):
  return produce_combat_ship
elif (no colonizers):
  return produce_colonizer (existing)
else:
  return none (already has both)
```

### Priority Order for Production

1. **Threatened + no combat ships** → produce_combat_ship (highest priority)
2. **Attack goal + no combat ships** → produce_combat_ship
3. **Colonize goal + no colonizers** → produce_colonizer (existing)
4. **Develop goal** → develop (existing)

### Continue Developing and Colonizing

Production should NOT block development or colonization:
- Colonize goals still produce colonizers when appropriate
- Develop goals still produce nothing (develop is a building action, not production)
- The new production path only activates when combat ships are needed

---

## Affected Services

| Service | Change | Type |
|---|---|---|
| `star-map.models.ts` | Add `produce_combat_ship` to `ActionType` union | Add |
| `enemy-capability.service.ts` | Add combat ship capability checks for attack goal | Modify |
| `enemy-goal.service.ts` | No changes needed | None |
| `enemy-action.service.ts` | Add `evaluateCombatShipPrepare()` and modify `evaluateAttackPrepare()`/`evaluateDefendPrepare()` | Modify |
| `enemy-action-executor.service.ts` | Add `produce_combat_ship` execution (same pattern as `produce_colonizer`) | Add |
| `enemy-ai.service.ts` | No changes needed | None |
| `enemy-strategy.service.ts` | No changes needed | None |

---

## Action Types

### `produce_combat_ship`

| Field | Value |
|---|---|
| `type` | `'produce_combat_ship'` |
| `targetSystemId` | Planet's system ID (where factory is) |
| `targetPlanetId` | Planet with available factory |
| `goalType` | `'attack'` or `'defend'` |

### Capability Checks for `produce_combat_ship`

| Requirement | Satisfied When |
|---|---|
| `combat_ship_unlocked` | Cheapest unlocked combat ship found |
| `combat_ship_affordable` | Faction credits ≥ ship cost |
| `combat_ship_capacity` | Planet has spaceship_factory with available capacity |

---

## Tests

### Capability Tests (enemy-capability.service.spec.ts)

| Test | Verifies |
|---|---|
| `attack goal requires combat capability` | `fleet_can_engage` requirement exists when AI has no combat ships |
| `attack goal marks combat_ship_unlocked when no ships researched` | `combat_ship_unlocked` requirement is false |
| `attack goal marks combat_ship_affordable when faction is broke` | `combat_ship_affordable` requirement is false |
| `attack goal marks combat_ship_capacity when no factory available` | `combat_ship_capacity` requirement is false |
| `attack goal canExecute when all combat requirements met` | `canExecute = true` |

### Action Tests (enemy-action.service.spec.ts)

| Test | Verifies |
|---|---|
| `attack prepare returns produce_combat_ship when cannot engage` | Action type is `produce_combat_ship` |
| `attack prepare returns none when no combat ship unlocked` | Action type is `none`, reason is `combat_ship_unlocked` |
| `attack prepare returns none when faction cannot afford` | Action type is `none`, reason is `combat_ship_affordable` |
| `defend prepare returns produce_combat_ship when threatened and no combat ships` | Action type is `produce_combat_ship` |
| `colonize prepare still returns produce_colonizer` | Existing behavior preserved |
| `develop goal still returns develop` | Existing behavior preserved |

### Executor Tests (enemy-action-executor.service.spec.ts)

| Test | Verifies |
|---|---|
| `produce_combat_ship queues production order` | `ProductionService.queueOrder` called with correct ship type |
| `produce_combat_ship uses spaceship_factory capacity` | Factory capacity checked and order placed on correct planet |
| `produce_combat_ship fails when no factory` | Returns `ok: false` |
| `produce_combat_ship fails when insufficient credits` | Returns `ok: false` |
| `produce_combat_ship does not duplicate order` | Returns `ok: false` if order already queued |

### Integration Tests

| Test | Verifies |
|---|---|
| AI produces combat ship then assembles fleet | Full flow: produce → stock → assemble → attack |
| AI does not produce colonizers when threatened and needs combat ships | Priority: combat > colonizer |
| AI continues colonizing when combat ships are available | Colonize goal still works alongside production |

---

## No Duplicate Production Logic

The new `produce_combat_ship` action reuses:
- `ProductionService.queueOrder()` — same as `produce_colonizer`
- `ShipService.getShipType()` — same as existing
- `ResearchService.isResearched()` — same as `canProduceColonizer`
- `ResearchService.isShipUnlocked()` — same as `canProduceColonizer`
- `ProductionService.getPlanetCapacity()` — same as `canProduceColonizer`

The selection logic (cheapest unlocked combat ship) is a new addition in `EnemyActionService`, not a duplicate of existing production logic.

---

## Data Structures

### New fields needed in ActionResult (already supported via targetSystemId/targetPlanetId)

No new fields needed. The action uses `targetSystemId` and `targetPlanetId` same as `produce_colonizer`.

### Combat ship selection helper

```typescript
private selectCheapestCombatShip(factionId: string, factions: Faction[]): ShipType | undefined {
  const faction = factions.find((f) => f.id === factionId);
  if (!faction) return undefined;
  
  const combatShips = this.shipService.getAllShipTypes().filter((ship) => {
    const role = ship.role;
    if (role === 'Recon' || role === 'Colonizer') return false;
    if (!this.researchService.isShipUnlocked(faction, ship.id)) return false;
    const credits = faction.currencies['credits'] ?? 0;
    if (credits < ship.cost) return false;
    return true;
  });
  
  combatShips.sort((a, b) => a.cost - b.cost);
  return combatShips[0];
}
```

---

## Test Matrix

| Test File | New Tests | Coverage |
|---|---|---|
| `enemy-capability.service.spec.ts` | 5 tests | Combat capability checks for attack goal |
| `enemy-action.service.spec.ts` | 6 tests | Action selection for produce_combat_ship |
| `enemy-action-executor.service.spec.ts` | 5 tests | Production order execution |
| `enemy-action-executor.service.spec.ts` (existing) | Modify | Verify produce_colonizer still works |
| `battle-combat.service.spec.ts` | N/A | Combat ships in battle unchanged |

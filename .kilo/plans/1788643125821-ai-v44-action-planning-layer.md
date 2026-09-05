# AI V4.4 – Action Planning Layer

## 1. Current Architecture Findings

### V4.1 Strategy (`EnemyStrategyService`)
- Output: `AiStrategy = 'expand' | 'attack' | 'defend' | 'develop'`
- Timing: 2s accumulator, returns `boolean` (changed)
- Priority: defend > attack > expand > develop

### V4.2 Goal (`EnemyGoalService`)
- Output: `StrategicGoal = ColonizeGoal | AttackGoal | DefendGoal | DevelopGoal`
- Timing: 2s accumulator, returns `boolean` (changed)
- Goal commitment: persists while valid and strategy matches

### V4.3 Capability (`EnemyCapabilityService`)
- Output: `CapabilityResult { canExecute, goalType, factionId, requirements[] }`
- Timing: 2s accumulator, returns `boolean` (changed)
- Requirements by goal:
  - COLONIZE: `colonizer_technology`, `colonizer_unlocked`, `colonizer_available`, `usable_fleet`, `target_valid`
  - ATTACK: `available_fleet`, `target_valid`, `fleet_can_engage`
  - DEFEND: `available_fleet`, `target_valid`, `threat_present`
  - DEVELOP: `always_executable`

### Game Systems Available for Querying (NOT mutation)
| System | Relevant APIs |
|--------|---------------|
| `ProductionService` | `getPlanetCapacity()`, `getPlanetPower()`, `listBuildableShipTypes()`, `queueOrder()` |
| `ShipStockService` | `getCount()`, `getStock()`, `getSummary()` |
| `SpaceportService` | `hasSpaceport()`, `listSpaceports()`, `isSpaceportPlanet()` |
| `FleetAssemblyService` | `createFleet()` (query only), `reinforceFleet()` |
| `StarMapMovementService` | `getPlanetGridPosition()`, `isFleetInSystem()` |
| `PlanetBattleService` | `resolveUninhabitedArrival()` |
| `ResearchService` | `isShipUnlocked()`, `isResearched()` |
| `ShipService` | `getShipType()`, `getAllShipTypes()` |

### Key Mechanics
- **Colonization**: Fleet arrives at planet grid cell → `resolveUninhabitedArrival()` checks for `colonizer` ship type in fleet → colonizer consumed, planet faction changed. Instant, no battle.
- **Fleet assembly**: Requires spaceport, pops ships from stock, creates Fleet at host system's grid cell.
- **Production**: Per-planet queue. One order at a time. `Spaceship Factory` = 1 slot, 0.5 power/s. Cost deducted up-front. Auto-cancels stalled orders after 30s.
- **Movement**: V3 sets `fleet.targetX/targetY`. Action planner must NOT set targets.

## 2. Recommended `EnemyActionService` Design

### Service Pattern
Follow V4.1-V4.3 exactly:
- `@Injectable({ providedIn: 'root' })`
- Per-faction action storage: `Map<string, ActionResult>`
- 2-second `STRATEGY_TICK_INTERVAL` accumulator
- `tick()` returns `boolean` (whether action changed)
- `getAction(factionId)` returns current action or `undefined`
- `reset()` clears accumulator and map

### Dependencies (all injected)
```typescript
constructor(
  private readonly shipService: ShipService,
  private readonly researchService: ResearchService,
  private readonly shipStockService: ShipStockService,
  private readonly productionService: ProductionService,
  private readonly spaceportService: SpaceportService,
  private readonly fleetAssemblyService: FleetAssemblyService,
  private readonly movementService: StarMapMovementService,
  private readonly shipStock: { factionId: string; ships: ShipStockEntry[] }[],
  private readonly production: { factionId: string; ordersByPlanet: Record<number, ProductionOrder[]> }[],
) {}
```

### Timing
- Same 2s accumulator as V4.1-V4.3
- `deltaTime <= 0` → return false immediately
- Action recalculated every tick cycle
- Result stored per faction, change detected via JSON comparison

### No Circular Dependencies
```
EnemyStrategyService V4.1
        ↓
EnemyGoalService V4.2
        ↓
EnemyCapabilityService V4.3
        ↓
EnemyActionService V4.4   ← new (reads V4.3 results)
        ↓
[future executor]          ← not built yet
```

`EnemyActionService` reads V4.3 results via `getCapability()`. It does NOT call V4.2, V4.1, or V3.

### Multi-faction
- One `ActionResult` per faction in the internal map
- Factions never overwrite each other
- `enemy1` and `enemy2` are the only enemy factions (consistent with V4.1-V4.3)

## 3. Exact Action Model

### Add to `star-map.models.ts`

```typescript
export type ActionType =
  | 'none'
  | 'produce_colonizer'
  | 'assemble_fleet'
  | 'move_to_target'
  | 'colonize'
  | 'attack'
  | 'defend'
  | 'develop';

export interface ActionResult {
  type: ActionType;
  factionId: string;
  goalType: GoalType;
  goal: StrategicGoal | undefined;
  targetId?: number;
  targetSystemId?: string;
  targetPlanetId?: number;
  reason: string;
}
```

### Field Semantics
| Field | Purpose |
|-------|---------|
| `type` | The next recommended action |
| `factionId` | Which faction this action belongs to |
| `goalType` | The goal driving this action |
| `goal` | Full goal object (for executor reference) |
| `targetId` | Fleet ID for attack/defend/move, planet ID for colonize |
| `targetSystemId` | System for colonization/defense |
| `targetPlanetId` | Planet for colonization/defense |
| `reason` | Human-readable explanation (from capability requirement or action rule) |

## 4. Exact Action Selection Rules

### Decision Logic (per faction)

```
1. If goal is undefined → NONE (reason: "no_goal")
2. Evaluate capability via V4.3
3. If canExecute → determine terminal action
4. If !canExecute → walk requirements in priority order, pick first unsatisfied → map to preparation action
```

### Requirement-to-Action Mapping

For **COLONIZE** goals, check requirements in order:
1. `colonizer_technology` unsatisfied → `NONE` (prerequisite missing, not a preparable action)
2. `colonizer_unlocked` unsatisfied → `NONE` (prerequisite missing)
3. `colonizer_available` unsatisfied:
   - If faction has `basic_engineering` AND colonizer is unlocked AND a planet has factory capacity → `PRODUCE_COLONIZER`
   - Else → `NONE` (cannot prepare)
4. `usable_fleet` unsatisfied → `NONE` (cannot prepare without any fleet)
5. `target_valid` unsatisfied → `NONE` (goal is stale)

If ALL satisfied:
6. Fleet with colonizer at target planet grid cell → `COLONIZE`
7. Fleet with colonizer exists but not at target → `MOVE_TO_TARGET`
8. Colonizer in stock but no fleet has it → `ASSEMBLE_FLEET`

For **ATTACK** goals, check requirements in order:
1. `available_fleet` unsatisfied → `NONE`
2. `target_valid` unsatisfied → `NONE`
3. `fleet_can_engage` unsatisfied → `NONE`

If ALL satisfied:
4. Enemy fleet within engagement range of target → `ATTACK`
5. Enemy fleet exists but not near target → `MOVE_TO_TARGET`

For **DEFEND** goals, check requirements in order:
1. `available_fleet` unsatisfied → `NONE`
2. `target_valid` unsatisfied → `NONE`
3. `threat_present` unsatisfied → `DEFEND` (no immediate threat, but maintain position)

If ALL satisfied:
4. Enemy fleet at or near threatened system → `DEFEND`
5. Enemy fleet exists but away from threatened system → `MOVE_TO_TARGET`

For **DEVELOP** goals:
- Always → `DEVELOP`

## 5. How Colonization Progresses Through Actions

### Step-by-step progression

```
PRODUCE_COLONIZER → (production completes) → ASSEMBLE_FLEET → (fleet assembled) → MOVE_TO_TARGET → (fleet arrives) → COLONIZE
```

### Step Details

| Step | Action | Condition | Future Executor |
|------|--------|-----------|-----------------|
| 1 | `PRODUCE_COLONIZER` | No colonizer in stock or fleet; faction has `basic_engineering`, colonizer unlocked, at least one planet with `Spaceship Factory`, credits >= colonizer cost | Call `ProductionService.queueOrder()` on a suitable planet |
| 2 | `ASSEMBLE_FLEET` | Colonizer in stock; faction has spaceport on owned planet; stock has 1+ colonizer | Call `FleetAssemblyService.createFleet()` with `[{typeId: 'colonizer', count: 1}]` |
| 3 | `MOVE_TO_TARGET` | Fleet with colonizer exists; fleet not at target planet grid cell | Set `fleet.targetX/Y` to target planet system cell |
| 4 | `COLONIZE` | Fleet with colonizer at target planet grid cell; planet still unhabited | `PlanetBattleService.resolveUninhabitedArrival()` handles consumption |

### "In position" definition for colonization
A fleet is at the colonization target when `fleet.gridCol` and `fleet.gridRow` match the target planet's grid position (via `movementService.getPlanetGridPosition(planet)`). Tolerance: exact match (no rounding issues since both are integers from the same function).

## 6. How Attack Progresses Through Actions

```
MOVE_TO_TARGET → (fleet arrives) → ATTACK
```

### Step Details

| Step | Action | Condition | Future Executor |
|------|--------|-----------|-----------------|
| 1 | `MOVE_TO_TARGET` | Fleet exists; fleet not at target fleet's x/y | Set `fleet.targetX/Y` to target fleet position |
| 2 | `ATTACK` | Enemy fleet at same grid cell as target fleet | Trigger battle via existing detection system |

### "In position" definition for attack
Fleet is in attack position when `Math.floor(fleet.x) === Math.floor(targetFleet.x)` and `Math.floor(fleet.y) === Math.floor(targetFleet.y)` (same grid cell).

## 7. How Defense Progresses Through Actions

```
MOVE_TO_TARGET → (fleet arrives) → DEFEND
```

### Step Details

| Step | Action | Condition | Future Executor |
|------|--------|-----------|-----------------|
| 1 | `MOVE_TO_TARGET` | Fleet exists; fleet not at threatened system's x/y | Set `fleet.targetX/Y` to threatened system position |
| 2 | `DEFEND` | Enemy fleet at or near threatened system grid cell | Existing V3 target selection + battle detection handles engagement |

### "In position" definition for defense
Fleet is in defensive position when `Math.floor(fleet.x) === Math.floor(system.x)` and `Math.floor(fleet.y) === Math.floor(system.y)` (same grid cell as the system).

## 8. How Production/Fleet Assembly/Movement Integrate

### Integration Principle
The action service is **read-only** with respect to game systems. It queries state but never calls mutation APIs.

### Production Query
```typescript
// Check if colonizer can be produced
const planet = findSuitableProductionPlanet(starSystems, factionId);
if (planet && productionService.getPlanetCapacity(planet, 'spaceship_factory') > 0) {
  const buildable = productionService.listBuildableShipTypes(planet);
  const canBuildColonizer = buildable.some(t => t.id === 'colonizer');
  // Also check faction.currencies.credits >= colonizer.cost
}
```

### Fleet Assembly Query
```typescript
// Check if fleet can be assembled
const hasSpaceport = spaceportService.hasSpaceport(factionId, starSystems);
const spaceports = spaceportService.listSpaceports(factionId, starSystems);
const stockCount = shipStockService.getCount(shipStockData, factionId, 'colonizer');
// canAssemble = hasSpaceport && stockCount > 0
```

### Movement Query (read-only position checks)
```typescript
// Check if fleet is at target
const planetCell = movementService.getPlanetGridPosition(planet);
const fleetAtTarget = fleet.gridCol === planetCell.col && fleet.gridRow === planetCell.row;

// Check if fleet is at system
const fleetAtSystem = Math.floor(fleet.x) === Math.floor(system.x) && Math.floor(fleet.y) === Math.floor(system.y);
```

### V3 Compatibility
- V3 `EnemyAiService` sets `fleet.targetX/Y` for enemy fleets based on strength ratios
- V4.4 does NOT set `fleet.targetX/Y`
- V4.4 only describes the strategic intent
- The future executor must reconcile V3 tactical targeting with V4 strategic targeting

## 9. Action Commitment/Recalculation Rules

### Timing
- Recalculated every 2 seconds of game time (same accumulator as V4.1-V4.3)
- `deltaTime <= 0` → no recalculation (paused)
- Result cached in `Map<string, ActionResult>` per faction

### When Action Changes
- Goal changes (V4.2 signals change)
- Capability result changes (V4.3 signals change)
- Game state changes that affect position/stock (next tick cycle catches it)

### What Does NOT Trigger Recalculation
- Per-frame position updates (movement is continuous)
- Individual ship HP changes
- Battle start/end (caught by next capability tick)

### Integration Point
The action service is called in the game loop AFTER the capability service:
```typescript
// In StarMap.gameLoopCallback, after capability tick:
for (const factionId of this.enemyFactionIds) {
  const capability = this.enemyCapabilityService.getCapability(factionId);
  this.enemyActionService.tick(
    gameDeltaTime,
    this.enemyGoalService.getGoal(factionId),
    capability,
    factionId,
    this.fleets, this.factions, this.starSystems,
    this.shipStock, this.production,
  );
}
```

Note: `star-map.ts` modification is deferred to the executor phase. The plan describes the integration point.

## 10. Files to Create/Change

### Create
1. `src/app/components/star-map/enemy-action.service.ts` — new service (~250-350 lines)
2. `src/app/components/star-map/enemy-action.service.spec.ts` — new tests (~500-600 lines)

### Modify
3. `src/app/components/star-map/star-map.models.ts` — add `ActionType` and `ActionResult` types (add after line 386)

### Defer (executor phase)
4. `src/app/components/star-map/star-map.ts` — add `enemyActionService` to constructor and call `tick()` in game loop
5. `docs/game-state.md` — add section 4.15

## 11. Test Plan

### Test Infrastructure
- `TestBed.configureTestingModule({})` — no imports needed (providedIn: 'root')
- Factory functions: `createFleet()`, `createPlanet()`, `createSystem()` matching existing patterns
- `afterEach: service.reset()`
- Shared faction array matching existing test factions

### COLONIZE Tests (5)
1. **Missing colonizer, production possible** → `PRODUCE_COLONIZER` when faction has `basic_engineering`, colonizer unlocked, planet with factory exists
2. **Available colonizer, no fleet** → `ASSEMBLE_FLEET` when stock has colonizer and spaceport exists
3. **Fleet with colonizer away from target** → `MOVE_TO_TARGET` when fleet has colonizer but not at planet grid cell
4. **Fleet at target with colonizer** → `COLONIZE` when fleet is at target planet cell
5. **Invalid colonization goal** → `NONE` when target planet is no longer unhabited

### ATTACK Tests (3)
6. **Valid attack, fleet away** → `MOVE_TO_TARGET` when fleet exists but not at target fleet cell
7. **Valid attack, fleet in position** → `ATTACK` when fleet is at target fleet cell
8. **Invalid attack goal** → `NONE` when target fleet is destroyed

### DEFEND Tests (2)
9. **Valid defend, fleet away** → `MOVE_TO_TARGET` when fleet exists but not at threatened system
10. **Fleet in defensive position** → `DEFEND` when fleet is at threatened system cell

### DEVELOP Test (1)
11. **Develop goal** → `DEVELOP`

### General Tests (4)
12. **Determinism** → identical inputs produce identical JSON output
13. **No state mutation** → input fleets, factions, systems, shipStock, production are not modified
14. **Multi-faction independence** → enemy1 and enemy2 get independent actions
15. **Accumulator timing** → result persists across tick boundaries, cleared on reset

### Total: 15 tests minimum

## 12. Edge Cases

### COLONIZE Edge Cases
- Colonizer in fleet but fleet is destroyed → treated as no colonizer available
- Multiple enemy fleets, only one has colonizer → action targets that fleet
- Planet has factory but faction cannot afford colonizer → `NONE` (not `PRODUCE_COLONIZER`)
- Colonizer unlocked but not buildable by any owned planet → `NONE`
- Stock has colonizer but no spaceport → `NONE` (not `ASSEMBLE_FLEET`)
- Fleet has colonizer but is inside a different system → `MOVE_TO_TARGET`
- Fleet already moving toward target (V3 set targetX) → check if current position matches, not target destination

### ATTACK Edge Cases
- Multiple enemy fleets, none near target → `MOVE_TO_TARGET` (pick any valid fleet)
- Fleet is at target but target fleet just moved → next tick recalculates
- Fleet has zero strength → capability service already reports `fleet_can_engage: false` → `NONE`

### DEFEND Edge Cases
- Threat just disappeared → capability reports `threat_present: false` → `DEFEND` (maintain position)
- Multiple enemy fleets, none at threatened system → `MOVE_TO_TARGET`

### General Edge Cases
- `undefined` goal → `NONE`
- `gameDeltaTime <= 0` → no state change, return false
- Faction has no `researchedTechnologies` field → treat as empty array
- Fleet has only destroyed ships → not a usable fleet
- Target system/planet doesn't exist in data → `target_valid: false` → `NONE`

## 13. Implementation Order

### Phase 1: Types (in `star-map.models.ts`)
1. Add `ActionType` union type
2. Add `ActionResult` interface

### Phase 2: Service Shell (in `enemy-action.service.ts`)
1. Create service class with constructor injection
2. Implement `reset()`, `tick()`, `getAction()`
3. Implement 2s accumulator pattern matching V4.1-V4.3
4. Implement change detection via JSON comparison

### Phase 3: Action Selection Logic
1. Implement `evaluateAction()` dispatch by `goal.type`
2. Implement `evaluateColonize()` with all 5 steps
3. Implement `evaluateAttack()` with 3 steps
4. Implement `evaluateDefend()` with 3 steps
5. Implement `evaluateDevelop()` → always `DEVELOP`

### Phase 4: Helper Methods
1. `findFleetWithColonizer()` — find enemy fleet containing a colonizer ship
2. `isFleetAtPlanet()` — check fleet position vs planet grid cell
3. `isFleetAtSystem()` — check fleet position vs system coordinates
4. `canProduceColonizer()` — check factory capacity + affordability
5. `canAssembleFleet()` — check spaceport + stock availability
6. `findBestFleet()` — pick a usable enemy fleet for movement actions

### Phase 5: Tests (in `enemy-action.service.spec.ts`)
1. Copy factory patterns from `enemy-capability.service.spec.ts`
2. Write all 15 tests per section 11
3. Verify no existing tests break (run full test suite)

### Phase 6: Validation
1. Run `ng test` or equivalent test command
2. Verify all 15 new tests pass
3. Verify all existing AI tests (V3, V4.1, V4.2, V4.3) still pass
4. Run lint/typecheck

## Dependency Flow (Confirmed)

```
EnemyStrategyService V4.1
        ↓
EnemyGoalService V4.2
        ↓
EnemyCapabilityService V4.3
        ↓
EnemyActionService V4.4   ← new
        ↓
[future executor]          ← not built yet
```

No circular dependencies. V4.4 reads V4.3 results via `getCapability()`. It queries game systems (production, stock, spaceport, movement) in read-only mode.

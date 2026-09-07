# Enemy AI Strategic Pipeline Completion Plan

## Overview
Complete the `EnemyActionExecutor` by adding execution support for the four currently placeholder action types: `colonize`, `attack`, `defend`, and `develop`. Keep the existing stateless executor philosophy and reuse all existing services.

## Current State
- Executor handles: `produce_colonizer`, `assemble_fleet`, `move_to_target`
- Action service already evaluates and returns `colonize`, `attack`, `defend`, `develop` actions
- Battle detection (`StarMapBattleDetectionService`) auto-triggers battles for same-cell hostile fleets
- Colonization logic exists in `StarMap.handleFleetPlanetArrival()` via `PlanetBattleService.resolveUninhabitedArrival()`
- Building placement is done in `StarMap.onBuildingConfirmed()` by pushing to `planet.buildings`
- Economy calculations exist in `EconomyService`

## Implementation Plan

### 1. Modify `enemy-action-executor.service.ts`

#### Add imports
- `PlanetBattleService` from `../../services/planet-battle.service`
- `EconomyService` from `../../services/economy.service`
- `PLANET_SIZE_MAP` from `./star-map.models`

#### Extend constructor
- Add `private readonly planetBattleService: PlanetBattleService`
- Add `private readonly economyService: EconomyService`

#### Extend `tick()` switch statement
Add cases for:
- `'colonize'` → `executeColonize()`
- `'attack'` → `executeAttack()`
- `'defend'` → `executeDefend()`
- `'develop'` → `executeDevelop()`

#### Implement `executeColonize()`
- Find the AI fleet with a living colonizer at the target planet's grid position
- Use `planetBattleService.resolveUninhabitedArrival(fleet)` to verify colonizer presence (reuses existing logic)
- Remove colonizer from fleet via `splice()`
- Set `planet.factionId = fleet.factionId`
- Guards (all checked every frame, stateless):
  - Target planet exists and is still `'unhabited'`
  - AI fleet exists, is not destroyed, and is at the planet's grid cell
  - Fleet has at least one living colonizer
- Return `false` on any guard failure (no state mutation)

#### Implement `executeAttack()`
- Find target player fleet by `goal.targetFleetId`
- Validate: exists, not destroyed, has at least one living ship
- Find AI attacker fleet at the same grid cell as the target
- Validate: exists, not destroyed, has at least one living ship
- Return `true` to signal action executed
- **Do NOT trigger battle** — `StarMapBattleDetectionService` handles it automatically
- Guards prevent duplicate/invalid execution

#### Implement `executeDefend()`
- Find target system by `goal.targetSystemId`
- Find AI fleet at the system's grid position
- Validate: system exists, fleet exists, not destroyed, has ships
- Return `true` to signal action executed
- Movement is already handled by the existing `move_to_target` case
- Guards prevent duplicate movement/execution

#### Implement `executeDevelop()`
- Select a developable planet owned by the AI faction (ascending system id, then planet id)
- Planet must have at least one free building slot (grid space)
- Select building based on priority:
  1. Energy shortage (`energyProduction < energyConsumption`) → `Fusion Power Plant` or `Solar Array`
  2. Workforce shortage (`workforceAvailable < workforceRequired`) → residential building
  3. Sufficient workforce, needs raw materials → `Spaceship Factory` or `Mining Complex`
  4. Fallback → `Research Laboratory` or `Small Research Laboratory`
- Check research unlock via `researchService.isBuildingUnlocked()`
- Check faction can afford building price
- Find valid placement position (no overlap with existing buildings or resource tiles, within grid bounds)
- Place building: deduct credits, push to `planet.buildings`
- Guards (stateless):
  - Planet is owned by faction
  - Building is research-unlocked
  - Faction has enough credits
  - Valid placement exists
  - Planet doesn't already have the selected building type (prevent duplicates)

#### Helper methods
- `selectDevelopPlanet(factionId, starSystems)` — first owned planet with free slot
- `selectDevelopBuilding(faction, planet)` — priority-based building selection
- `findValidPlacement(planet, buildingSize, buildingId)` — scan for valid x,y
- `canPlaceBuilding(planet, buildingSize, x, y, buildingId)` — overlap + bounds + resource check

### 2. Modify `enemy-action-executor.service.spec.ts`

#### Test setup updates
- Mock `PlanetBattleService` with `resolveUninhabitedArrival`
- Mock `EconomyService` with `calculatePlanetEconomy`
- Add shared helpers for creating planets with buildings, resource tiles, etc.

#### COLONIZE tests (6 tests)
1. Successful colonization — fleet at planet with colonizer → planet factionId changes, colonizer removed
2. Invalid planet — system/planet missing → no mutation
3. Already colonized planet — planet factionId not `'unhabited'` → no mutation
4. No colonizer — fleet at planet but no colonizer → no mutation
5. No valid fleet — no fleet at planet position → no mutation
6. Duplicate execution — second tick returns false, no double mutation

#### ATTACK tests (5 tests)
1. Valid attack state — both fleets exist, not destroyed, same cell → returns true
2. Invalid target — target fleet missing → returns false
3. Destroyed target — target fleet destroyed → returns false
4. Player safety — player fleets not modified
5. Duplicate battle prevention — fleet already at position, re-evaluation returns true but no state change

#### DEFEND tests (5 tests)
1. Valid defend — fleet at system position → returns true
2. Already at target position — fleet at system, returns true without movement
3. Invalid planet — system missing → returns false
4. Invalid threat — no fleet at system → returns false
5. Player safety — player fleets not modified

#### DEVELOP tests (8 tests)
1. Energy shortage → power building selected and placed
2. Workforce shortage → residential building selected and placed
3. Raw material need → industry building selected and placed
4. Research building fallback → research lab selected when no other need
5. Research lock → building not unlocked → no placement
6. No credits → insufficient funds → no placement
7. No valid placement — all positions overlap → no mutation
8. Duplicate prevention — building already exists → no second build

### 3. Update `docs/game-state.md`
- Document the four new executable action types
- Document the develop building selection priority
- Update total test count

## Validation
- Run full Vitest suite
- Ensure existing ~305 tests pass
- Ensure all new tests pass
- Fix any regressions

## Constraints
- Do not modify the action service or any other AI layer
- Do not create new services for battle or movement
- Reuse `PlanetBattleService.resolveUninhabitedArrival` for colonization
- Building placement uses the same overlap/grid logic as `StarMapPlanetScreenComponent`
- No mutable executor state added

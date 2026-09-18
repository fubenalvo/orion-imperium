# Plan: Battle Range from Absolute Positions

> Scope: tactical battle screen only. Grid cells remain authoritative for movement, path clearance, occupancy, deployment, and click cells.

## Goal

Make battle targetability use each stack's current visual position (`BattleStack.x/y`, in VW) instead of its grid anchor (`col/row`). Opposing stacks moving in opposite directions must be able to attack each other while passing if their centers are within range at that moment.

## Current findings

- `getAttackTargetIds()` and `computeCarrierBoostTargets()` in `battle/battle-grid.ts` use grid coordinates.
- `BattleCombatService.attackStack()` rejects moving attackers and performs a grid range check.
- AI target selection, low-shield Carrier checks, and move-toward-enemy filtering use grid range.
- Player auto-attack excludes moving stacks, and clicking an enemy while selected stack is moving redirects to movement instead of attacking.
- Projectile effects already capture `attacker.x/y` and `target.x/y` when the attack starts; they do not track a target that moves afterward.
- Movement/pathing remains grid-based, which should stay unchanged.

## Resolved decisions

- Apply the absolute-position rule to all range-based battle operations: hostile attacks, attack-target highlighting, AI targeting, move-to-attack eligibility, and Carrier Shield Pulse target selection.
- Use center-to-center Euclidean distance from `BattleStack.x/y`.
- `attackRange` remains expressed in grid cells; convert it to VW with `BATTLE_CELL_SIZE_VW` before comparison.
- A moving attacker and a moving target may attack each other. Movement continues during the attack animation.
- A projectile uses the attacker/target positions captured when firing starts; it does not track the target afterward.
- Carrier Shield Pulse remains usable only while the Carrier is stationary, but its target range uses absolute positions.
- Do not change movement/pathing/occupancy semantics to absolute coordinates.

## Implementation steps

1. **Add absolute range helpers in `src/app/components/battle-screen/battle/battle-grid.ts`**
   - Add a squared-distance helper for two absolute VW positions and/or `isAbsoluteInRange(attacker, target, attackRange)`.
   - Add a distance helper in cell units for AI scoring, preserving the existing `computeTargetScore()` contract.
   - Keep `isInRange()` and `cellDistance()` as grid helpers for movement/pathing.

2. **Update target and move-to-attack helpers in `battle-grid.ts`**
   - `getAttackTargetIds()`: compare current `x/y` centers.
   - `computeCarrierBoostTargets()`: compare current `x/y` centers.
   - `getMoveToAttackCells()`: keep grid occupancy/path checks, but test each candidate cell's visual center (including stack size/side offset) against the target's current `x/y`.
   - `findBestMoveToAttackCell()`: retain grid move-cost tie-breaking, but use absolute target distance for the target-side tie-break.
   - `getMoveToAttackTargetIds()`: use absolute direct-range checks and the updated move-to-attack cells.

3. **Update combat and Carrier Shield Pulse in `battle/battle-combat.service.ts`**
   - Remove the `attacker.moving` rejection from `attackStack()`.
   - Replace the grid range check with the absolute range helper.
   - Preserve the existing `from`/`to` snapshot and animation sequence.
   - Keep `carrierShieldBoost()`'s stationary Carrier gate; only its target selection changes through `computeCarrierBoostTargets()`.

4. **Update tactical AI in `battle/battle-ai.service.ts`**
   - Allow moving AI stacks to enter the attack branch; continue skipping moving stacks for movement and Carrier actions.
   - Make `bestTarget()` use absolute range and absolute Euclidean distance.
   - Make `hasLowShieldAlly()` use absolute Carrier range.
   - Make `moveTowardNearestEnemy()` filter and sort enemies by absolute range/distance; keep its fallback path and movement grid-based.

5. **Update player input and game loop in `battle-screen.component.ts`**
   - Let `onStackClick()` attempt a direct attack before considering movement, so a moving selected stack attacks immediately when the enemy is in absolute range.
   - Replace `moveTowardsAndAttack()`'s destination-grid prediction and custom grid range check with the shared absolute move-to-attack logic; remove `getEffectiveTargetPosition()` and `findBestMoveToAttackCellTowards()` if no longer used.
   - Remove the `attacker.moving` exclusion from `tryAutoAttack()` and from the player-stack filter in `gameLoopCallback()`.
   - Keep explicit-target, cooldown, animation-lock, and Carrier stationary rules unchanged.

6. **Update movement service and presentation**
   - In `battle/battle-movement.service.ts`, make `moveToAttack()` use absolute direct range and the updated shared move-to-attack cell helper.
   - In `battle-grid/battle-grid.component.ts`, update the position/range comment and allow the attack dot to remain visible while moving (preserve the existing firing/other gates).
   - Update stale comments in `battle/battle.types.ts`.

7. **Update documentation**
   - Update `docs/battle-rules.md` combat range wording to specify current absolute `x/y`, Euclidean center distance, and attacks while moving.
   - Update `docs/battle-screen.md` architecture, action table, range helper table, and troubleshooting text so it no longer says attacks require a stationary stack or use target grid cells.
   - Do not create a new documentation file.

8. **Update tests and fixtures**
   - Add a reusable test helper that updates `col/row` and the corresponding visual `x/y` together; do not make production range logic fall back to grid coordinates for old fixtures.
   - Add/adjust tests in:
     - `battle/battle-grid.spec.ts`: grid-far but visually close target, visually far but grid-close target, exact inclusive boundary, moving target/attacker, Carrier targets, and move-to-attack cells.
     - `battle/battle-combat.service.spec.ts`: moving attacker can fire in absolute range; moving target is evaluated at fire start; projectile retains the start-position snapshot.
     - `battle/battle-ai.service.spec.ts`: moving AI stack attacks a visually in-range enemy; update the “all moving” expectation.
     - `battle/battle-movement.service.spec.ts`: move-to-attack uses current absolute target position.
     - `battle-screen.component.spec.ts`: moving player stack can directly attack and auto-attack; update `placeAdjacent()` and other range fixtures to set `x/y`.
     - `battle-grid/battle-grid.component.spec.ts`: attack dot remains visible while moving.
   - Update stale test counts/documentation references if the number of tests changes.

## Files to change

- `src/app/components/battle-screen/battle/battle-grid.ts`
- `src/app/components/battle-screen/battle/battle-combat.service.ts`
- `src/app/components/battle-screen/battle/battle-ai.service.ts`
- `src/app/components/battle-screen/battle/battle-movement.service.ts`
- `src/app/components/battle-screen/battle/battle.types.ts`
- `src/app/components/battle-screen/battle-screen.component.ts`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`
- `src/app/components/battle-screen/battle/battle-grid.spec.ts`
- `src/app/components/battle-screen/battle/battle-combat.service.spec.ts`
- `src/app/components/battle-screen/battle/battle-ai.service.spec.ts`
- `src/app/components/battle-screen/battle/battle-movement.service.spec.ts`
- `src/app/components/battle-screen/battle-screen.component.spec.ts`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.spec.ts`
- `docs/battle-rules.md`
- `docs/battle-screen.md`

Tracked `.js` mirrors exist beside several battle TypeScript files, but recent project changes update the `.ts` sources only and Angular consumes TypeScript; do not edit generated/stale `.js` files unless a build explicitly requires it.

## Validation

1. Run `npm run build`.
2. Run `npm test -- --watch=false`.
3. If the test command requires the Angular builder directly, use `npx ng test --watch=false`.
4. Manually verify two opposing stacks moving toward each other from opposite sides: both should fire while moving when their visual centers enter range, and the projectile should use the positions from the moment each shot starts.

## Risks / notes

- Existing tests frequently mutate only `col/row`; after the production change they must also update `x/y`, or they will incorrectly fail.
- Keep grid and absolute coordinate systems clearly separated: grid for path/occupancy, VW `x/y` for range.
- Do not add target tracking to projectiles; that would change the agreed animation behavior.

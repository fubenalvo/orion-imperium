# Plan: Remove AP/Turn System from Battle Minigame — Real-Time Movement

## Objective
Replace the turn-based AP combat system in the battle minigame with real-time, speed-based movement modeled after the star-map fleet movement. AI acts every 0.2s (configurable). No other battle rules change.

---

## Design Decisions

### 1. Game Loop
- Create `BattleGameLoopService` (separate from `StarMapGameLoopService` because `GameTimeService` is paused during battle, returning 0 delta)
- RAF outside Angular zone, raw real delta time clamped to 0.1s
- Loop calls: movement update, AI tick accumulator, shield regen accumulator, then `anim.tick()` to trigger CD

### 2. Coordinate System
- Add `x`, `y`, `targetX`, `targetY` (vw floats) + `speed` (vw/s) to `BattleStack`
- Keep `col`, `row` (grid cells) for combat/range/pathing — updated when stack snaps to target
- Initialize `x`/`y` from `col`/`row` via `cellToVw()` (with visual offset for multi-cell stacks)
- `BattleStack.speed` from `ShipType.speed` (values 1-5 in ship-data.json)
- `updateStacks(state, deltaTime)` in MovementService: move toward targets at `speed * deltaTime` vw/s

### 3. AI Model
- `playAction(state)` replaces `playTurn(state)`: one move-or-attack per call
- Returns `true` if any action was taken, `false` otherwise
- Priority: attack in-range enemy → carrier shield boost → move toward nearest enemy
- Called by game loop every 0.2s (configurable `AI_ACTION_INTERVAL_MS`) when `!anim.isBusy`

### 4. Shield Regeneration
- Timer-based: every 1.0s (`SHIELD_REGEN_INTERVAL_MS`), regenerate ALL ships' shields (both sides) + shared planetary shield pool
- Replaces `BattleTurnService.regenerateShields()` / `endTurn()`

### 5. Turn/Phase Removal
- Remove `BattlePhase` type and `phase` field from `BattleModelState`
- Remove `activeSide`, `ap`, `apPerTurn` from `BattleModelState`
- Remove `cellsMovedThisTurn`, `attackedThisTurn`, `moveApPerCell`, `attackAp`, `moveRange`, `moveMs` from `BattleStack`
- Keep `round` field (repurpose as AI tick counter for "ROUNDS" display)
- `checkVictory` moves to `battle-grid.ts` as pure exported function

---

## Implementation Steps (Ordered)

### Step 1: `battle.types.ts` — Core types
- Remove: `AP_PER_TURN`, `BattlePhase`
- Remove from `BattleModelState`: `activeSide`, `ap`, `apPerTurn`, `phase`
- Remove from `BattleStack`: `moveApPerCell`, `attackAp`, `moveRange`, `cellsMovedThisTurn`, `attackedThisTurn`, `moveMs`
- Add to `BattleStack`: `speed`, `x`, `y`, `targetX`, `targetY`

### Step 2: `battle-ship-stats.ts` — Ship stats
- Remove from `BattleShipStats`: `moveApPerCell`, `attackAp`, `moveRange`
- Add: `speed` (from `ShipType.speed`)

### Step 3: `battle-state.ts` — State factory
- Update `createBattleState`: remove `ap`/`apPerTurn`/`activeSide`/`phase` init; init `speed`, `x`, `y`, `targetX: null`, `targetY: null` on stacks
- Update `buildStacks`: set new fields, remove old fields
- Keep `isSidePlayerControlled` (used for player input gating)

### Step 4: `battle-grid.ts` — Grid helpers & movement update
- Add: `checkVictory(state)` (moved from BattleTurnService)
- Add: `updateStackPositions(state, deltaTime)` — game-loop movement of all stacks
- Add: `vwToStackCell(stack, x, y)` — convert vw position to anchor col/row
- Remove AP/moveRange constraints from `getReachableCells`, `getMoveToAttackCells`, `getMoveToAttackTargetIds`
- Remove `cellsMovedThisTurn`/`attackedThisTurn` references

### Step 5: `battle-turn.service.ts` — Delete
- Move `checkVictory` to `battle-grid.ts`
- Move shield regen logic to `battle-grid.ts` helper `regenerateAllShields(state)`
- Delete service and its spec

### Step 6: `battle-movement.service.ts` — Rewrite movement
- `moveStack`: remove AP cost, moveRange check, `cellsMovedThisTurn` increment. Keep `isPathClear`. Set `targetX`/`targetY` to cell center vw (with visual offset). Set `moving = true`. Return `true` synchronously (awaited but resolves immediately).
- `moveToAttack`: simplify to `moveStack` to best attack cell only (no combined attack)
- Add `updateStacks(state, deltaTime)`: iterate stacks, move toward targets at `speed * deltaTime`, snap when distance ≤ 0.01, update `col`/`row` from vw, clear `moving`

### Step 7: `battle-combat.service.ts` — Remove AP/turn gates
- Remove: `attackedThisTurn` check, `attackAp > state.ap` check, `state.ap -= attacker.attackAp`
- Remove: `state.activeSide !== attacker.side` guard (both sides can act)
- Remove: `BattleTurnService` dependency; import `checkVictory` from `battle-grid`
- Keep: `isInRange` check, `isBusy` check, `stack.immobile` check, add `stack.moving` check (can't attack while moving)

### Step 8: `battle-ai.service.ts` — Rewrite AI
- Replace `playTurn(state)` with `playAction(state): Promise<boolean>`
- Single action: best in-range target → carrier shield boost → move toward nearest enemy
- No `endTurn()` call; no `attackedThisTurn`/`cellsMovedThisTurn` resets

### Step 9: `battle-screen.component.ts` — RAF game loop
- Inject `BattleGameLoopService`
- `ngOnInit`: start game loop callback that:
  - Moves stacks: `movement.updateStacks(state, deltaTime)`
  - Accumulates AI timer → every 0.2s if `!anim.isBusy`: `ai.playAction(state)`
  - Accumulates shield regen timer → every 1s: `regenerateAllShields(state)`
  - Calls `anim.tick()` to trigger CD
- Remove: `onEndTurn`, `runAiTurns`, `playerControlsActiveSide`, `canAct`, `canEndTurn`, `shouldPulseEndTurn`, `spentStackIds`, `phaseLabel`, `moveCells`, `attackTargetIds`, `moveToAttackTargetIds`, `carrierBoostTargetIds`, `canCarrierBoost`, `carrierBoostTargetIds`
- Update `onStackClick`: allow player to act on any of their stacks (check `isSidePlayerControlled(state, stack.side)` instead of `activeSide`)

### Step 10: `battle-screen.component.html` — Remove turn-based UI
- Remove: AP bar, END TURN button, ROUND/PHASE display, active-fleet span
- Remove: SHIELD PULSE button (carrier boost now auto for AI; player can click carrier for boost if implemented)
- Keep: planet shield bar, selection panel

### Step 11: `battle-grid.component.ts` — Real-time rendering
- Remove inputs: `ap`, `spentStackIds`, `activeSide`
- `stackVw(stack)`: return `{x: stack.x, y: stack.y}` directly (no col/row conversion)
- `hasAttackDot(stack)`: return `!stack.moving && !stack.firing && !stack.destroyed && !stack.immobile` (no `activeSide` check)
- Remove `stackClasses` spent class logic

### Step 12: `battle-grid.component.html` — VW positioning
- Stack cells: bind `left`/`top` to `stack.x`/`stack.y` (no CSS transition)
- Remove `stackTransition` method; remove CSS `transition` on `.stack-cell`

### Step 13: `battle-grid.component.scss` — Styles
- Remove `.stack-cell` transition
- Remove `.stack.spent` styles (no spent concept)
- Keep all other stack visual states

### Step 14: `battle-screen.component.scss` — Styles
- Remove `.battle-screen__ap-bar`, `.battle-screen__ap-fill`, `.battle-screen__ap-text` styles
- Remove `.end-turn-btn` pulse animation
- Keep rest

### Step 15: `battle-result.ts` — Outcome
- Keep `rounds: state.round` (now repurposed as AI tick counter)
- No other changes

### Step 16: Tests — Rewrite all spec files
- `battle-ai.service.spec.ts`: test `playAction` (one action per call, no AP checks)
- `battle-movement.service.spec.ts`: test `moveStack` sets target, `updateStacks` moves toward target
- `battle-combat.service.spec.ts`: test attack without AP cost, no `activeSide` check
- `battle-state.spec.ts`: test new fields init, no `ap`/`phase`
- `battle-grid.spec.ts`: test `getReachableCells` without AP/range constraints
- `battle-ship-stats.spec.ts`: test `speed` from ship data
- `battle-screen.component.spec.ts`: test game loop, no endTurn/AP
- `battle-grid.component.spec.ts`: test vw rendering, no spent/AP

---

## Constants

```typescript
// battle.types.ts
export const AI_ACTION_INTERVAL_MS = 200;  // AI acts every 200ms
export const SHIELD_REGEN_INTERVAL_MS = 1000;  // shield regen every 1s
```

---

## Validation Plan

1. TypeScript compiles (`ng build` or `tsc`)
2. Unit tests pass (`npm test`)
3. Manual battle: player can move stacks in real-time, attack without AP limits
4. AI acts every 0.2s, moves toward enemies, attacks in range
5. Shields regenerate continuously for both sides
6. Battle ends correctly when one side wiped out
7. Star-map outcome UI still shows "ROUNDS: N" (now AI tick count)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| TypeScript breakage from type changes | Apply all type changes (Step 1) first, then update consumers |
| AI too slow/fast | `AI_ACTION_INTERVAL_MS` is configurable constant |
| Movement stutter | RAF loop outside zone; clamp delta to 0.1s; `anim.tick()` triggers CD |
| Player vs AI action conflicts | `anim.isBusy` gates attacks only; movement is parallel |
| Shield regen imbalance | Timer-based for all sides simultaneously |
| `round` semantics change | Documented; star-map UI still works |

---

## Out of Scope

- Star-map / overworld changes
- Battle transport contract (`Battle`, `BattleOutcome`)
- Planet battle shared shield pool logic (only regeneration timing changes)
- Carrier shield boost for player (AI uses it; player UX deferred)
- Save/load of battle state

---

## File List (for reference)

Modified:
- `src/app/components/battle-screen/battle/battle.types.ts`
- `src/app/components/battle-screen/battle/battle-ship-stats.ts`
- `src/app/components/battle-screen/battle/battle-state.ts`
- `src/app/components/battle-screen/battle/battle-grid.ts`
- `src/app/components/battle-screen/battle/battle-movement.service.ts`
- `src/app/components/battle-screen/battle/battle-combat.service.ts`
- `src/app/components/battle-screen/battle/battle-ai.service.ts`
- `src/app/components/battle-screen/battle/battle-animation.service.ts` (no changes)
- `src/app/components/battle-screen/battle/battle-result.ts`
- `src/app/components/battle-screen/battle-screen.component.ts`
- `src/app/components/battle-screen/battle-screen.component.html`
- `src/app/components/battle-screen/battle-screen.component.scss`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.html`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`

Deleted:
- `src/app/components/battle-screen/battle/battle-turn.service.ts`
- `src/app/components/battle-screen/battle/battle-turn.service.spec.ts`

New:
- `src/app/components/battle-screen/battle/battle-game-loop.service.ts`

All spec files rewritten.
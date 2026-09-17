# Battle Screen Fix Plan

> **Scope:** Fix bugs, logical pitfalls, and inconsistencies identified in battle screen code review.  
> **Reference:** `.kilo/plans/1789669427713-battle-screen-experience.md` (context doc)

---

## Priority 1 — Bugs (fix immediately)

### Fix 1: Stale comment — BATTLE_CELL_SIZE_VW is 4vw, not 5vw
**File:** `src/app/components/battle-screen/battle/battle.types.ts:11-12`  
**Current:** Comment says "1-indexed cells, 5vw cell size"  
**Fix:** Change comment to "4vw cell size"

---

### Fix 2: Shield Pulse bypasses global animation lock
**File:** `src/app/components/battle-screen/battle/battle-combat.service.ts:164-202` (`carrierShieldBoost`)  
**File:** `src/app/components/battle-screen/battle-screen.component.ts:491-501` (`doCarrierBoost`)  
**Problem:** `carrierShieldBoost` checks `carrier.firing` but not `anim.isBusy`. A Carrier can Shield Pulse while another stack's projectile animation is in flight.  
**Fix:**
1. Add `this.anim.isBusy` check at start of `carrierShieldBoost()` — return false if busy.
2. Add `this.anim.isBusy` check in `doCarrierBoost()` before calling `carrierShieldBoost()`.

---

### Fix 3: Movement validation operator precedence bug
**File:** `src/app/components/battle-screen/battle/battle-movement.service.ts:45`  
**Current:** `if (!isInBounds(target.col, target.row) || target.col === stack.col && target.row === stack.row)`  
**Problem:** `&&` binds tighter than `||`, so the expression evaluates as `(isInBounds(...) || target.col === stack.col) && target.row === stack.row`. This accidentally returns false for same-cell moves (matching intent) but is structurally wrong.  
**Fix:** Add explicit parentheses: `if (!isInBounds(target.col, target.row) || (target.col === stack.col && target.row === stack.row))`

---

### Fix 4: setTimeouts survive component destroy
**File:** `src/app/components/battle-screen/battle/battle-animation.service.ts:62-64`  
**Problem:** `wait(ms)` creates `setTimeout` that fires even after the battle component is destroyed, potentially resolving state updates on stale objects.  
**Fix:** Track all pending timer IDs in a `Set<number>`. Add `cancelPendingTimers()` method that iterates the set and calls `clearTimeout` on each. Call `cancelPendingTimers()` in `reset()` and in `ngOnDestroy` of the battle screen component. Store timer IDs in the `Set` when `wait()` creates them.

---

### Fix 5: Documentation labels — "turn-based" is incorrect
**File:** `docs/game-state.md:551` — "BattleScreen: turn-based battle UI"  
**File:** `AGENTS.md:113` — "battle-screen/ Turn-based battle UI"  
**Fix:** Change both to "real-time battle UI"

---

## Priority 2 — Logical Pitfalls (fix with care)

### Fix 6: 28-ship fleet size boundary — abrupt behavior change
**File:** `src/app/components/battle-screen/battle/battle-state.ts:152`  
**Problem:** `maxIndividual = 4 * ROW_ORDER.length = 28`. Fleets ≤28 ships get one stack per ship; >28 ships get grouped into MAX_STACK_SIZE chunks. A 28-ship fleet gets 28 stacks; a 29-ship fleet gets 6 stacks (5+5+5+5+5+4).  
**Fix:** Add an inline comment above the `if (roster.length <= maxIndividual)` block explaining the boundary rationale (small fleets display individually for tactical clarity; large fleets group for performance/readability). Optionally raise `maxIndividual` or add a buffer zone with a log warning.

---

### Fix 7: isOccupied doesn't block intermediate cells during real-time movement
**File:** `src/app/components/battle-screen/battle/battle-grid.ts:133-148` (`isOccupied`)  
**Problem:** When a stack is mid-flight (has `targetX/targetY`), `isOccupied` only checks its origin cell and its destination cell (via `vwToStackCell`). Two stacks moving through the same intermediate cell can visually overlap.  
**Fix:** Add an optional `includeIntermediate?: boolean` parameter to `isOccupied`. When true, also check all cells along the stack's straight-line path from current `col/row` to `vwToStackCell(targetX, targetY)`. Only enable this for movement validation where precision matters; skip it for `getAttackTargetIds` and `getStackAt` where it's unnecessary. Note: this is a minor visual issue; acceptable as-is if documented.

---

### Fix 8: AI Shield Pulse is reactive, never proactive
**File:** `src/app/components/battle-screen/battle/battle-ai.service.ts:42-84` (`playAction`)  
**Problem:** AI only Shield Boosts when it has no attack and no move target. It won't boost a critically shielded carrier being swarmed.  
**Fix (recommended):** Add a new priority level between attack and move: after the attack loop, before the generic move loop, check if any AI carrier has a friendly stack within range whose shield fraction is below 0.5 (configurable threshold). If so, boost that carrier first. If no urgent boost needed, fall through to existing behavior.

---

### Fix 9: selectedStackId setter has side effect
**File:** `src/app/components/battle-screen/battle-screen.component.ts:95-104`  
**Problem:** The setter directly mutates `oldStack.explicitAttackTargetId = null` as a side effect, bypassing the state management flow.  
**Fix:** Instead of mutating in the setter, handle the cleanup in `selectedStack()` or in `onStackClick` before setting the new ID. Alternatively, make the explicit attack target clearing part of a proper state update method. The setter is called from template binding `[selectedStackId]`, so move the cleanup logic to `onStackClick` (line 379: before setting `this.selectedStackId = stack.stackId`, clear the previous target explicitly).

---

### Fix 10: vwToStackCell can produce out-of-bounds at grid edges
**File:** `src/app/components/battle-screen/battle/battle-grid.ts:208-216`  
**Problem:** At exact grid borders (e.g., `x: 72.0`), `vwToStackCell` can return `col: 19` which exceeds `BATTLE_GRID_COLUMNS = 18`. Callers don't validate the result.  
**Fix:** In `vwToStackCell`, clamp `anchorCol` to `[1, BATTLE_GRID_COLUMNS]` and `row` to `[1, BATTLE_GRID_ROWS]`. Alternatively, document that callers must validate and add validation in `isOccupied` and `getStackAt`.

---

## Priority 3 — Design Concerns (evaluate before fixing)

### Decision 11: Should explicit attacks have fire-rate cooldown?
**File:** `src/app/components/battle-screen/battle-screen.component.ts:676-695` (`doAttack`)  
**Current:** No cooldown set after explicit attack (line 688: "Don't set cooldown here"). Player can spam-click for immediate re-fire, limited only by animation lock.  
**Options:**
- **A:** Keep as-is (animation lock is sufficient gate). Intentional: lets skilled players burst-fire.
- **B:** Set `attackCooldownUntil` after explicit attacks too, same as auto-attack. More consistent but reduces player agency.
**Recommendation:** **A** — animation lock is already the gate, and manual attacks feel better without cooldown. Document the decision in a comment.

---

### Decision 12: buildBattleOutcome null-winner default
**File:** `src/app/components/battle-screen/battle/battle-result.ts:38`  
**Current:** `state.winner ?? 'attacker'` silently defaults to attacker winner if winner is null.  
**Fix:** Add a guard in `buildBattleOutcome` that throws or returns a sentinel when `state.winner === null`. Or: keep the default but add a comment explaining it's a defensive fallback that should never trigger in normal flow (since `backToStarMap` only runs post-victory). **Recommended:** Defensive comment + keep default, since `battleOutcome` getter already returns null when winner is null.

---

### Decision 13: Optional BattleShip fields without guaranteed defaults
**File:** `src/app/components/battle-screen/battle/battle.types.ts:73-87`  
**Problem:** `shield`, `maxShield`, `shieldRegen`, `attackType`, `weakness` are optional. Combat service provides fallbacks (`'kinetic'`, `'energy'`) but ship-data.json may not always have them.  
**Fix:** Make `toBattleShip()` in `battle-state.ts` always assign concrete values (fallbacks for missing data) and remove optionality from `BattleShip` interface — all fields become required. This eliminates null-check sprawl across combat services.

---

### Decision 14: Function calls in Angular template (battle-grid)
**File:** `src/app/components/battle-screen/battle-grid/battle-grid.component.html`  
**Problem:** `stackVw()`, `cellVw()`, etc. are called every change detection cycle. No OnPush strategy.  
**Fix:** Convert to OnPush change detection (`ChangeDetectionStrategy.OnPush`) and cache computed values in component properties updated via `ngDoCheck()` or getter-based memoization. **Only if performance is actually measured as a problem.** Otherwise: document why this is acceptable (small grid, 60fps is fine).

---

### Decision 15: Z-index layering for battle grid vs black vignette
**File:** `battle-screen.component.scss` line 132-134 (`battle-screen__content`)  
**Problem:** `battle-screen__content` has `z-index: -1` and `box-shadow: 0 0 200vw 200vw black`. Stacks rendered inside the grid component need to be visible above the black shadow.  
**Fix:** Verify visually that stacks render above the black vignette. If not, change `battle-screen__content` `z-index` to `0` or `1` and ensure `box-shadow` doesn't block interaction (it doesn't since it's pure CSS). **Recommended:** Test visually; if stacks are visible, no fix needed (just document the z-index choice).

---

## Execution Order

1. **Fix 1, 3, 5** — Trivial text/comment fixes (5 minutes)
2. **Fix 2, 4** — Animation lock and timer cleanup (1 hour)
3. **Fix 6** — Comment/boundary documentation (15 minutes)
4. **Fix 7, 10** — Grid edge cases (1 hour)
5. **Fix 8** — AI priority enhancement (1.5 hours)
6. **Fix 9** — State management refactor (1 hour)
7. **Fix 11-15** — Design decisions (need user input for each)

---

## Validation

- Run existing battle test suites: `npx vitest run src/app/components/battle-screen/`
- Verify no test regressions after each fix
- For Fix 2 (Shield Pulse lock): manually test by opening battle, clicking fast to trigger overlapping animations
- For Fix 3 (operator precedence): write a unit test with `target` same as `stack` to verify correct behavior
- For Fix 4 (timers): navigate away from battle during an animation and verify no console errors
- For Fix 7 (intermediate cells): deploy two stacks moving through the same intermediate cell and verify no visual overlap
- For Fix 8 (AI priority): create a scenario where AI carrier has a nearly-depleted ally and verify Shield Pulse fires before move
- Visual regression check for all fixes via browser

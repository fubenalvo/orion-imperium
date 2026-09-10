# Battle Screen: Flip Defender Ships + Individual Placement

## Goal
1. Flip right-side (defender) ships horizontally so they face the attacker.
2. Place ships individually in 4 columns per side; only stack when the 4 columns cannot hold all ships.

---

## Change 1 — Flip defender ships horizontally

**`battle-grid.component.html`**
- Add `[class.stack--defender]="stack.side === 'defender'"` to the `<button class="stack">` element.

**`battle-grid.component.scss`**
- Add:
  ```scss
  .stack--defender {
    transform: scaleX(-1);
  }
  ```

---

## Change 2 — Expand deployment to 4 columns + individual-first stacking

**`battle.types.ts`**
- Change `ATTACKER_DEPLOY_COLS` from `[1, 2, 3]` to `[1, 2, 3, 4]`.
- Change `DEFENDER_DEPLOY_COLS` from `[17, 18, 16]` to `[18, 17, 16, 15]`.

**`battle-state.ts`**
- Modify `buildStacks`:
  - Calculate `maxIndividual = 4 * ROW_ORDER.length` (28).
  - If `roster.length <= maxIndividual`, return one stack per ship (`ships: [ship]`, `size` from tier).
  - Otherwise fall back to current type-grouping + `MAX_STACK_SIZE` chunking logic.

---

## Test updates

**`battle-state.spec.ts`**

1. `deploys attacker on the left columns and defender on the right` (line 66)
   - Update assertions:
     - `expect(attacker.col).toBeLessThanOrEqual(4)` (was 3)
     - `expect(defender.col).toBeGreaterThanOrEqual(15)` (was 16)

2. `groups same-type ships into stacks capped at MAX_STACK_SIZE` (line 52)
   - Change fleet from 12 fighters to 30 fighters (or any number > 28).
   - Keep expectations: 6 stacks of 5, all ≤ MAX_STACK_SIZE.

3. Add a new test: `places each ship individually when total ships fit in 4 columns`
   - Use e.g. 12 fighters.
   - Expect 12 stacks, each with `ships.length === 1`.

---

## Files touched
- `src/app/components/battle-screen/battle-grid/battle-grid.component.html`
- `src/app/components/battle-screen/battle-grid/battle-grid.component.scss`
- `src/app/components/battle-screen/battle/battle.types.ts`
- `src/app/components/battle-screen/battle/battle-state.ts`
- `src/app/components/battle-screen/battle/battle-state.spec.ts`

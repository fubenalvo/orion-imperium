# Battle Screen Selection Panel — Enhancement Plan

## 1. Files that need to change

### `src/app/components/battle-screen/battle-screen.component.html`
- Extend the existing `.battle-screen__selection` block (lines 72-93) with the missing fields.
- Add ship count, total HP, total attack, total defense, movement AP cost, and immobile indicator.

### `src/app/components/battle-screen/battle-screen.component.ts`
- Add two pure getters on `BattleScreenComponent`:
  - `selectedStackTotalHp(stack)` — sum of `s.hp` over alive ships
  - `selectedStackMaxHp(stack)` — sum of `s.maxHp` over all ships
  - `selectedStackAttack(stack)` — sum of `s.attack` over alive ships
  - `selectedStackDefense(stack)` — sum of `s.defense` over alive ships
  - `selectedStackShipCount(stack)` — count of alive ships
- Reuse existing `selectedStack()` method; no new selection state.

### `src/app/components/battle-screen/battle-screen.component.scss`
- Add styles for the new rows (`.selection-stats` already exists; extend it or add a second row).

## 2. Files that only need to be inspected

- `src/app/components/battle-screen/battle/battle.types.ts` — confirms `BattleStack` already carries `tier`, `moveApPerCell`, `attackAp`, `moveRange`, `attackRange`, `immobile`, and `ships: BattleShip[]` with `hp`/`maxHp`/`attack`/`defense`/`alive`. No type changes needed.
- `src/app/components/battle-screen/battle/battle-ship-stats.ts` — confirms AP costs and ranges are derived from `ship-data.json` via `getBattleShipStats`; the stack already stores the resolved values.
- `src/app/components/battle-screen/battle/battle-state.ts` — confirms stacks are built from `getBattleShipStats` and carry all required fields.
- `src/app/components/battle-screen/battle/battle-combat.service.ts` — confirms damage uses `totalAttack = sum(alive attack)` and `front.defense`; panel should mirror this aggregation.
- `src/app/components/battle-screen/battle-grid/battle-grid.component.ts` — already has `hullFraction(stack)` doing the same HP aggregation; consider extracting a shared helper if DRY is desired (optional, low priority).
- `src/app/services/ship.service.ts` — confirms `ShipType` shape; no change needed.
- `src/app/components/star-map/star-map-fleet-info/star-map-fleet-info.component.html` — existing pattern for showing ship stats (ATK / DEF / count) in the overworld; use similar labeling.

## 3. What data will be displayed

All values come from the currently selected `BattleStack` (or nothing when no stack is selected). No new data sources.

| Field | Source | Notes |
|-------|--------|-------|
| Ship type / name | `stack.typeName` | Already shown |
| Surviving ships | `stack.ships.filter(alive).length` | New |
| Total HP | `sum(s.hp for alive)` | Already shown as aggregate |
| Max total HP | `sum(s.maxHp for all)` | Already shown |
| Attack | `sum(s.attack for alive)` | New — matches combat `totalAttack` |
| Defense | `sum(s.defense for alive)` | New — note: combat uses front-ship defense only; label as "DEFENSE (front)" or show both |
| Movement range | `stack.moveRange` | Already shown |
| Attack range | `stack.attackRange` | Already shown |
| Move AP cost | `stack.moveApPerCell` | New |
| Attack AP cost | `stack.attackAp` | Already shown as "AP" |
| Immobile | `stack.immobile` | New — show "IMMOBILE" badge for planet defenses |

## 4. How the selected stack will be passed to the UI

- No new state-management architecture. The component already owns `selectedStackId: string | null` and exposes `selectedStack(): BattleStack | null`.
- The template already uses `@if (selectedStack(); as stack)` to scope the panel.
- New getters will be computed from the same `stack` template variable, so no prop drilling or new inputs are required.
- The panel is already rendered inside `battle-screen.component.html`; it will simply display more fields.

## 5. Potential edge cases

- **No stack selected**: panel hidden via existing `@if (selectedStack(); as stack)`. No change needed.
- **Destroyed stack**: `selectedStack()` already filters out `s.destroyed`, so a destroyed stack cannot be selected. Safe.
- **Empty ships array**: `sum` over empty array = 0; HP fraction = 0 (existing code divides by `sum(maxHp)` which would be 0 → NaN). Guard the fraction with `maxHp > 0` check, matching `BattleGridComponent.hullFraction` which already does this.
- **Immobile stacks (planet defenses)**: `stack.immobile` is true; display a badge. Movement range is 0; that is correct to show.
- **Enemy stacks**: currently only own-side stacks can be selected (`onStackClick` only sets `selectedStackId` when `stack.side === activeSide`). Panel only ever shows player-owned stacks. No change needed.
- **Animation in progress**: selection persists during animation; getters are pure reads of current state, so values are always consistent.
- **Battle over**: panel still renders for the last selected stack; harmless. Could hide when `battleOver` if desired (optional).

## 6. Tests that should be added or updated

### `src/app/components/battle-screen/battle-screen.component.spec.ts`
- Add a test that selects a stack and asserts the new getters return correct aggregate values (ship count, total attack, total defense, move AP, attack AP).
- Add a test for an immobile (planet-defense) stack showing `immobile = true`.
- Add a test for the HP-fraction edge case where `maxHp` sum is 0 (should not produce NaN).
- Existing tests should continue to pass unchanged since no existing behavior is modified.

### `src/app/components/battle-screen/battle-grid/battle-grid.component.spec.ts`
- No changes required; `hullFraction` already guards against zero division.
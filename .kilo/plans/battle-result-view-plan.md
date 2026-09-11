# Battle Result View — Plan

## 1. Files to modify

### `src/app/components/battle-screen/battle-screen.component.html`
- Replace the current one-line `.battle-screen__summary` block (lines 104-111) with a compact Battle Result view.
- Keep the existing BACK TO STAR MAP button.

### `src/app/components/battle-screen/battle-screen.component.ts`
- Add a `battleOutcome` getter that builds the outcome from the current `BattleModelState` (reuses `buildBattleOutcome` from `./battle/battle-result`).
- Add a `getPlanetResultLabel()` helper that returns `'CAPTURED'` / `'DEFENDED'` / `''` based on `outcome.battleType` + `outcome.winnerSide`.
- No new state; no persistence changes.

### `src/app/components/battle-screen/battle-screen.component.scss`
- Add styles for the result view layout (header, side panels, meta row).

### `src/app/components/battle-screen/battle-screen.component.spec.ts`
- Add tests for the new getters and the planet-result label.

## 2. Existing BattleOutcome fields that can be reused

All requested data is already present in `BattleOutcome` (`battle.types.ts:176-185`):

| Requested | Field | Source |
|-----------|-------|--------|
| winner | `winnerSide`, `winnerFleetId` | `buildBattleOutcome` |
| attacker result | `attacker: BattleFleetOutcome` | `fleetOutcome` |
| defender result | `defender: BattleFleetOutcome` | `fleetOutcome` |
| surviving ships | `*.survivors: BattleShipOutcome[]` | `fleetOutcome:63` |
| destroyed ships | `*.ships` filtered by `destroyed === true` | `fleetOutcome:56-62` |
| remaining HP | `BattleShipOutcome.hp` (already `Math.max(0, Math.round(s.hp))`) | `fleetOutcome:60` |
| number of rounds | `rounds` | `buildBattleOutcome:44` |
| battle type | `battleType` | `buildBattleOutcome:45` |
| planet id (planet battles) | `planetId` | `buildBattleOutcome:46` |

`BattleFleetOutcome` also carries `wipedOut`, `fleetId`, `side`, `factionId` for labeling.

## 3. Missing information that would require changing BattleOutcome

**None required.** The planet-battle outcome ("captured" vs "defended") is fully derivable from existing fields:
- `battleType === 'planet'` AND `winnerSide === 'attacker'` → planet **captured** by attacker
- `battleType === 'planet'` AND `winnerSide === 'defender'` → planet **defended**
- `battleType === 'fleet'` → no planet line

`planetId` is already present for planet battles. No `BattleOutcome`, `buildBattleOutcome`, or persistence change is needed.

## 4. Proposed UI structure

Reuse the existing `BattleFleetPanelComponent` (`battle-fleet-panel/`) which already renders fleet name, alive/total ship count, per-ship HP bars, destroyed styling, and winner/loser result badges. It currently is **not** rendered on the battle screen, so wiring it in is additive.

```
.battle-screen__result
  .result-header
    "BATTLE COMPLETE" title
    "ROUND N" + battle type badge
    planet result badge (planet battles only)
  .result-sides (flex row)
    app-battle-fleet-panel  [attacker, result = winner/loser]
    app-battle-fleet-panel  [defender, result = winner/loser]
  .result-footer
    "BACK TO STAR MAP" button (existing)
```

- `BattleFleetPanelComponent` inputs to wire: `fleetName`, `factionColor`, `roster` (= `outcome.attacker.ships`), `result` (= `'winner'`/`'loser'`/`null` derived from `winnerSide`).
- The panel already shows survivors count and per-ship HP; destroyed ships are shown with strikethrough + red bar via existing `.ship-row.destroyed` styles.
- Add a small meta line under the header for rounds / battle type / planet result.

## 5. Edge cases

- **No outcome yet / battle not over**: the result view is only rendered when `battleOver` (`state.winner != null`), so it never shows mid-battle.
- **Both sides wiped out**: `winner` is set by `checkVictory` before the result is built; `buildBattleOutcome` defaults `winnerSide` to `'attacker'` if `state.winner` is null, but this path is unreachable because the result view only renders after `winner` is set.
- **Planet battle, defender wins**: `winnerSide === 'defender'` → label "DEFENDED"; attacker fleet is the loser and may be wiped out (handled by existing `outcome.attacker.wipedOut`).
- **Empty rosters**: `BattleFleetPanelComponent.aliveCount` and `hullFraction` already handle empty arrays (`roster.filter`, `maxHp > 0` guard).
- **Virtual defense fleet (planet battle)**: the defender fleet id is negative (`-planet.id`) but `BattleOutcome.defender.fleetId` carries it; the panel shows it as a normal fleet. This is consistent with the existing outcome — no special-casing needed.
- **Back-to-map flow unchanged**: `backToStarMap()` still calls `setBattleResult`, `setDestroyedFleetId`, and persistence exactly as before. The result view is purely presentational.

## 6. Tests needed

### `battle-screen.component.spec.ts`
- Add a test that sets `state.winner` and asserts the `battleOutcome` getter returns the correct `winnerSide`, `rounds`, `battleType`.
- Add a test for `getPlanetResultLabel()` returning `'CAPTURED'` (attacker wins, planet battle), `'DEFENDED'` (defender wins, planet battle), and `''` (fleet battle).
- Add a test that the existing `backToStarMap()` behavior is unchanged (outcome persisted, loser id set, navigation) — guards against regression.

### `battle-result.spec.ts`
- No changes required; `buildBattleOutcome` is unchanged.

### Visual regression
- Manual check that the result view renders above the grid and the BACK button still navigates to `/star-map`.
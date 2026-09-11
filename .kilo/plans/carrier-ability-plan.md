# Carrier Shield Pulse — Plan

## 1. Proposed Carrier ability

**Shield Pulse.** The Carrier can spend its attack action to emit a shield
pulse. Every friendly stack within the Carrier's attack range has its ships'
shield restored by the Carrier's shieldRegen value, capped at each ship's
maxShield. The Carrier marks `attackedThisTurn` and spends `attackAp`.

This is the only Carrier-specific ability in this version. No other ship
gains abilities.

## 2. Why it fits the existing mechanics

The Carrier is already the odd one out vs the Cruiser:

| | Cruiser | Carrier |
|---|---|---|
| role | Line Ship | Fleet Support |
| attack | 60 (energy) | 30 (missile) |
| shield / regen | 160 / 10 | 220 / 12 |
| range | 3 | 4 |
| moveRange | 3 | 2 |
| cost | 400 | 500 |

The Cruiser is a damage dealer; the Carrier is a slow, long-range, high-shield
support ship with weak guns. Shield Pulse gives the Carrier a *non-damage*
action that leverages its two strongest existing attributes — shieldRegen and
long range — without touching the basic attack system. It is useful but not
mandatory: a fleet can win without ever using it, but a Carrier becomes a
valuable back-line buff unit.

It reuses the existing action model exactly: an action costs `attackAp` and
sets `attackedThisTurn`, so the Carrier cannot both pulse and attack in one
turn, and the turn lifecycle (AP refill, counter reset) handles the rest.

## 3. AP cost

`stack.attackAp` — the same tier-based attack cost the Carrier already pays
for a normal attack. For a tier-3 Carrier that is `ceil(3 * 1.5) = 5` AP.

## 4. Target/range rules

- No targeting: the pulse affects **all friendly stacks** whose centre is
  within the Carrier's `attackRange` (4), using the existing `isInRange`
  helper (Euclidean cell distance, same as attack targeting).
- Line-of-sight is not checked (it is a pulse, not a projectile).
- Destroyed stacks are skipped (they have no ships to restore).
- The Carrier itself is not affected (it already regenerates shield normally).
- Each affected ship's shield is restored by the **front alive Carrier ship's
  `shieldRegen`**, capped at that ship's `maxShield`.

## 5. State changes required

New method on `BattleCombatService`:

```ts
carrierShieldBoost(state: BattleModelState, carrierStackId: string): boolean
```

- Looks up the Carrier stack; returns false if it is destroyed, not a
  Carrier (`typeId !== 'carrier'`), not the active side, already acted this
  turn, or lacks the AP.
- Deducts `stack.attackAp` from `state.ap`, sets `stack.attackedThisTurn = true`.
- For every friendly stack within `stack.attackRange`, for every alive ship:
  `ship.shield = Math.min(ship.maxShield ?? 0, (ship.shield ?? 0) + carrierRegen)`.
- Returns true.

No new fields are needed on `BattleStack` or `BattleModelState` —
`attackedThisTurn` already gates "one action per stack per turn", and the
existing AP/turn lifecycle handles the rest. `BattleOutcome` and
`BattleLogEntry` are unchanged (the pulse is not logged to avoid touching
the outcome model).

## 6. UI requirements

- `BattleScreenComponent`: add a `canCarrierBoost` getter (selected stack is
  a Carrier, active side, can act, not yet acted, enough AP) and a
  `doCarrierBoost()` method that calls `combat.carrierShieldBoost(...)`.
- A new action button (e.g. "SHIELD PULSE") rendered alongside the existing
  move/attack controls, visible only when `canCarrierBoost` is true.
- `BattleGridComponent`: add a `carrierBoostTargetIds` input and a
  `computeCarrierBoostTargets(state, stack)` helper in `battle-grid.ts` so
  affected friendly stacks can be highlighted (e.g. a cyan ring) while the
  Carrier is selected. Pure read of existing state — no new combat logic.
- The selection panel already shows shield values, so no change is needed
  there; restored shield will animate naturally via the existing CSS
  transition.

## 7. AI implications

`BattleAiService.playTurn` gains one small step: after the normal
attack/move/attack phases, for each unacted Carrier stack with enough AP,
use `carrierShieldBoost` when at least one friendly ship in range is below
its maxShield. This is a deterministic, greedy fallback — it only fires when
the Carrier has nothing better to do, so it never overrides a profitable
attack. No other AI behavior changes.

## 8. Tests

### `battle-combat.service.spec.ts`
- `carrierShieldBoost` restores shieldRegen to a damaged friendly stack in
  range, capped at maxShield.
- It is capped at maxShield (over-heal clamped).
- It does not affect the Carrier itself.
- It does not affect stacks out of range.
- It does not affect enemy stacks.
- It returns false when the stack is not a Carrier / destroyed / wrong side /
  already acted / insufficient AP.
- It spends `attackAp` and sets `attackedThisTurn`.

### `battle-grid.spec.ts` (or `battle-grid` helper tests)
- `computeCarrierBoostTargets` returns only friendly, non-destroyed stacks
  within range.

### `battle-ai.service.spec.ts`
- AI uses Shield Pulse as a fallback when a Carrier cannot attack and an
  ally needs shield.

### `battle-screen.component.spec.ts`
- `canCarrierBoost` is true for a Carrier that can act; false for a Cruiser,
  a destroyed Carrier, or one that already acted.

### No changes required
- `battle-turn.service.spec.ts`, `battle-result.spec.ts`, `battle-state.spec.ts`,
  `battle-ship-stats.spec.ts`, `battle-movement.service.spec.ts`,
  `battle-screen.component.spec.ts` (existing tests) — the ability is
  additive and does not alter existing behavior.
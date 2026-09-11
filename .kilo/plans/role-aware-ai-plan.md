# Role-Aware AI Target Selection — Plan

## 1. Target scoring approach

`BattleAiService.bestTarget()` currently picks the nearest in-range enemy
(same-type tie broken by `stackId`). Replace the distance-only sort with a
**scored, deterministic** selection:

```
score = primaryRoleScore + threatWeight + distancePenalty
```

- **Primary role score** (the new part): the attacker's role vs the target's
  role determines a coarse preference. E.g. an Anti-Ship destroyer prefers
  high-value combat ships; a Fleet Support carrier prefers to suppress the
  most threatening enemy; an Interceptor prefers fast, low-tier targets.
- **Threat weight**: derived from the target's existing combat stats
  (`attack`, `hp`, `shield`) — no new data. High-attack enemies are
  prioritized.
- **Distance penalty**: keep the existing "nearest first" bias so the AI
  still behaves greedily and doesn't charge across the map.

Ties at every comparison step are broken by `stackId` (string compare), so
the result is fully deterministic.

## 2. How existing ship roles/data will be reused

The `role` field already exists in `ship-data.json` for all 11 ship types
(Recon, Interceptor, Light Combat, Escort, Anti-Ship, Line Ship, Fleet
Support, Heavy Combat, Heavy Assault, Capital Ship, Colonizer). It is not
yet copied into the battle sim, so:

- Add `role` to `BattleShipStats` (`battle-ship-stats.ts`) and copy it into
  `BattleShip` in `toBattleState()` (`battle-state.ts`) — the same tiny,
  additive path used for `attackType`/`weakness`/`shield`. Single source of
  truth, no duplication.
- The AI then reads `stack.ships[0].role` (stacks are homogeneous by type
  per `buildStacks`).

A small `ROLE_PREFERENCE` table in `battle-grid.ts` (next to
`WEAPON_EFFECTIVENESS`) maps `(attackerRole, targetRole) -> number`. It is
data, not logic — every entry is a constant.

## 3. How ties remain deterministic

- Every comparison is a total order: score (number) → distance (number) →
  `stackId` (string). No two stacks have the same `stackId`, so the winner is
  unique.
- The scoring function is pure — no state, no RNG, no time dependence.
- Re-running `playTurn` on an identical state produces an identical log
  (existing determinism test continues to pass).

## 4. Files to modify

- `battle-ai.service.ts` — replace `bestTarget()` with the scored version;
  `moveTowardNearestEnemy()` unchanged (it already sorts by distance +
  `stackId`).
- `battle-grid.ts` — add `ROLE_PREFERENCE` table and a pure
  `roleTargetScore(attackerStack, targetStack)` helper (keeps the AI thin).
- `battle-ship-stats.ts` — add `role` to `BattleShipStats` and the three
  return paths (real / virtual / unknown).
- `battle-state.ts` — copy `role` into `BattleShip` in `toBattleShip()`.
- `battle-ship-stats.spec.ts` / `battle-state.spec.ts` — assertions for the
  new `role` field.
- `battle-ai.service.spec.ts` — new target-selection tests.

## 5. Tests required

- `bestTarget` prefers a high-threat target over a nearer low-threat one
  when both are in range.
- `bestTarget` still prefers the nearest when threat scores are equal
  (distance tie-break).
- `bestTarget` is deterministic across two identical states (re-run the
  existing determinism test, plus a role-specific variant).
- The role preference table is consulted (e.g. an Anti-Ship role prefers a
  Cruiser over a Colonizer at equal distance).
- Existing AI tests still pass (attack in range, move-then-attack,
  immobile turrets, AP cap, turn flip).
- `role` is copied from ship data into `BattleShip` (fighter = Interceptor,
  dreadnought = Capital Ship, laser turret = defense).

## 6. Constraints honored

- No randomness, no pathfinding, no minimax, no lookahead, no multi-turn
  planning.
- Attack range, AP, movement, already-attacked state, blocked paths, and
  combat rules are all still respected — only the *ordering* of candidates
  changes.
- `BattleOutcome`, persistence, and the overworld are untouched.
- The four-phase turn structure (attack → move → attack → carrier boost →
  end) is unchanged.
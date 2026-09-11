# Shield Absorption in BattleCombatService — Plan

## 1. Files to change

### `src/app/components/battle-screen/battle/battle-combat.service.ts`
- Modify the damage-application loop in `attackStack()` (currently lines 71-83) to absorb damage with each target ship's shield before touching hull HP.

### `src/app/components/battle-screen/battle/battle-combat.service.spec.ts`
- Update 2 existing tests that now see shield absorption.
- Add 5 new tests covering the requested shield edge cases.

## 2. Existing tests that must be updated

Both previously asserted HP reduction that shield now absorbs first.

### `applies max(1, totalAttack - frontDefense) and deducts AP`
- Setup: 5 fighters (attack 15 each = 75) vs 1 frigate (defense 8) → damage 67.
- Frigate shield = 80 (ship-data.json). 67 < 80 → shield fully absorbs.
- **New assertions:** `def.ships[0].shield` ≈ 13 (80 - 67), `def.ships[0].hp` unchanged (130), `alive` true, `kills` 0.
- Keep: AP deduction, `attackedThisTurn`, log length 1.

### `spills overkill across a defender stack until a ship dies`
- Setup: 5 fighters (75) vs 2 scouts (defense 2) → damage 73.
- Scout shield = 20, HP = 40.
- Ship 1: shield 20 → 0 (remaining 53), hull 40 → 0, **dies**, remaining 13, kills 1.
- Ship 2: shield absorbs 13 → shield 7, hull untouched (40), alive.
- **New assertions:** `dead` length 1, `wounded` length 1, `wounded[0].hp` 40, `wounded[0].shield` 7, `kills` 1.

## 3. New tests to add

All go through `combat.attackStack(...)` with fake timers, matching the existing test style.

1. **damage absorbed completely by shield**
   - 1 fighter (attack 15) vs 1 frigate (defense 8) → damage 7. Frigate shield 80.
   - Assert: shield 73, hp 130, alive true, kills 0.

2. **shield depleted with remaining damage reaching HP**
   - Build a custom defender stack via `createBattleState`, then manually set `ship.shield` / `ship.hp` on the defender's ships before attacking. This makes the assertion independent of ship-data.json values and directly tests the loop.
   - Example: defender ship shield 20, hp 40; attacker deals 50 damage.
   - Assert: shield 0, hp reduced by (damage - oldShield) = 30, alive true.

3. **damage greater than shield + HP**
   - Custom defender ship: shield 20, hp 40. Attacker deals 100 damage.
   - Assert: ship destroyed (hp 0, alive false), kills 1, single-ship stack → stack destroyed.

4. **zero/empty shield**
   - Defender ship with `shield: 0` (or a virtual turret like `laser_turret`, which has shield 0).
   - Assert: behavior identical to pre-shield — HP reduced by full damage, shield stays 0.
   - Guards the `ship.shield ?? 0` fallback path.

5. **multiple ships in a stack (overkill + shield)**
   - Two defender ships: ship A shield 20 hp 40, ship B shield 10 hp 30. Attacker deals 80.
   - Expected: A shield 20→0, A hp 40→0 (dies, remaining 20), B shield 10→0 (remaining 10), B hp 30→20 (alive).
   - Assert: A destroyed, B alive with hp 20 shield 0, kills 1.

## 4. Implementation detail (the loop change)

Replace:
```ts
const applied = Math.min(ship.hp, remaining);
ship.hp -= applied;
remaining -= applied;
if (ship.hp <= 0) { ship.hp = 0; ship.alive = false; kills++; }
```
With (per ship, inside the existing `for (const ship of target.ships)` loop):
```ts
// Shield absorbs damage first; only overflow reaches hull HP.
const shieldHp = ship.shield ?? 0;
const shieldDamage = Math.min(shieldHp, remaining);
ship.shield = shieldHp - shieldDamage;
remaining -= shieldDamage;
if (remaining <= 0) {
  continue;
}
const applied = Math.min(ship.hp, remaining);
ship.hp -= applied;
remaining -= applied;
if (ship.hp <= 0) {
  ship.hp = 0;
  ship.alive = false;
  kills++;
}
```

Notes:
- `ship.shield ?? 0` keeps compatibility with test fixtures that build `BattleShip` literals without shield fields.
- The `damage` value pushed to `state.log` is unchanged (gross volley damage `max(1, totalAttack - front.defense)`).
- `kills` still counts hull-HP-zero deaths (requirement 5).
- Minimum-damage floor (`Math.max(1, ...)`) is untouched (requirement 6).
- No changes to AP, movement, range, attack frequency, AI, deployment, `BattleOutcome`, or persistence.

## 5. Constraints honored

- Reuses existing combat architecture; change is localized to the damage-application loop.
- No shield regeneration implemented (explicitly out of scope).
- `BattleOutcome` / `buildBattleOutcome` / persistence untouched — shield state is battle-local only.

## 6. Validation

- Run `ng test` — expect the 2 updated tests + 5 new tests to pass; all other combat/movement/AI/state tests unaffected (the 15 pre-existing failures are unrelated and unchanged).
- Run `ng build` — must succeed (only pre-existing budget warnings acceptable).
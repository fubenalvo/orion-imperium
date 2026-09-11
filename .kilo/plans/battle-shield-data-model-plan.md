# Battle Shield Data Model — Plan

## 1. Files to change

### `src/app/components/battle-screen/battle/battle.types.ts`
- Extend `BattleShip` with shield fields.
- Extend `BattleShipStats` with shield fields.

### `src/app/components/battle-screen/battle/battle-ship-stats.ts`
- Add `shield` and `shieldRegen` to the returned `BattleShipStats` for real ships (from `ShipType`) and virtual defense ships (from `planet-data.json`).

### `src/app/components/battle-screen/battle/battle-state.ts`
- Copy `shield` / `shieldRegen` into each `BattleShip` in `toBattleShip()`.

### `src/app/components/battle-screen/battle/battle-ship-stats.spec.ts`
- Add assertions for the new shield fields.

### `src/app/components/battle-screen/battle/battle-state.spec.ts`
- Add a test that shield values are copied into `BattleShip` and that the input fleet is not mutated.

## 2. New/modified fields

### `BattleShip` (`battle.types.ts:66`)
```ts
export interface BattleShip {
  shipId: number;
  name: string;
  typeId: string;
  hp: number;
  maxHp: number;
  shield: number;          // NEW: current shield, starts at maxShield
  maxShield: number;       // NEW: max shield from ship data
  shieldRegen: number;     // NEW: regen rate from ship data
  attack: number;
  defense: number;
  alive: boolean;
}
```

### `BattleShipStats` (`battle-ship-stats.ts:27`)
```ts
export interface BattleShipStats {
  // ... existing fields ...
  shield: number;          // NEW
  shieldRegen: number;     // NEW
}
```

### `BattleShipOutcome` / `BattleOutcome`
- **No change.** Shield is intentionally omitted from the outcome for this step (per constraints). `buildBattleOutcome` already only maps `hp`/`destroyed`; shield state is battle-local and not persisted.

## 3. Where shield values are copied into BattleShip

Single copy point: `toBattleShip()` in `battle-state.ts:76-97`.

```ts
function toBattleShip(ship, shipService, planetBattleService): BattleShip {
  const stats = getBattleShipStats(ship.type, shipService, planetBattleService);
  const hp = shipService.getShipType(ship.type) != null ? stats.maxHp : (ship.currentHp ?? stats.maxHp);
  return {
    shipId: ship.id,
    name: ship.name,
    typeId: ship.type,
    hp,
    maxHp: stats.maxHp,
    shield: stats.shield,        // NEW: starts fully charged
    maxShield: stats.shield,     // NEW
    shieldRegen: stats.shieldRegen, // NEW
    attack: stats.attack,
    defense: stats.defense,
    alive: true,
  };
}
```

`stats.shield` is read once from `ShipType.shield` (real ships) or the planet-data defense block (virtual ships). No new shield values are invented.

## 4. How deep-cloning/self-contained state is preserved

- `createBattleState()` already deep-clones each `FleetShip` into a fresh `BattleShip` object via `toBattleShip()`. Adding primitive `shield`/`maxShield`/`shieldRegen` fields is fully compatible with this path.
- The overworld `Fleet`/`FleetShip` objects are never mutated (verified by existing `battle-state.spec.ts` test "does not mutate the input fleet ships"). The new fields are set on the cloned `BattleShip` only.
- `BattleShipStats` is a read-only resolved interface; `getBattleShipStats` is pure and deterministic, so shield values are stable across the battle.
- `BattleModelState.attackerShips` / `defenderShips` reference the same `BattleShip` objects as the stacks, so shield state is shared consistently (same as HP today).

## 5. Tests needed

### `battle-ship-stats.spec.ts`
- For a real ship (e.g. `frigate`): assert `stats.shield === 80` and `stats.shieldRegen === 6` (from `ship-data.json`).
- For a virtual defense ship (e.g. `laser_turret`): assert shield defaults to `0` (turrets have no shield in `planet-data.json`).
- For unknown type ids: assert shield/shieldRegen default to `0`.

### `battle-state.spec.ts`
- Add a test that `createBattleState` copies shield values onto each `BattleShip` (e.g. a frigate's `BattleShip.maxShield === 80`, `shield === 80`, `shieldRegen === 6`).
- Extend the existing "does not mutate the input fleet ships" test to also assert the input `FleetShip` has no `shield` property added.

### `battle-screen.component.spec.ts`
- Add a test that the selection-panel getters (already added in the prior task) still pass with the extended `BattleShip` — guards against regressions in template binding.

## 6. Compatibility concerns

- **Existing spec files construct `BattleShip` literals** (`battle-grid.spec.ts:16-39`, `battle-movement.service.spec.ts`, `battle-combat.service.spec.ts`, `battle-ai.service.spec.ts`). Adding required fields would break these. Two options:
  - (a) Make the new fields optional with defaults (`shield?`, `maxShield?`, `shieldRegen?`) — safest, no test breakage.
  - (b) Make them required and update all literal constructors in spec files.
  - **Recommendation: (a)** — optional fields with documented defaults (`0` for ships without shield data). This keeps the change minimal and avoids touching combat/movement/AI tests.
- **`BattleShipOutcome`** intentionally stays shield-free so `BattleOutcome` and persistence are unchanged.
- **Virtual defense fleets**: the `Planetary Shield` building is currently filtered out of virtual fleets entirely (`planet-battle.service.ts:63-66`) and only contributes to an unused `shieldPool`. For this step, virtual turret ships get `shield: 0` / `shieldRegen: 0` (they have no shield in `planet-data.json`). The shield-building handling is out of scope for this data-model step.
- **UI**: the selection panel and fleet panel read `hp`/`maxHp`/`attack`/`defense` only; shield fields are additive and do not affect existing bindings.
- **No combat/turn/AI/outcome changes** — this step is data-model only.
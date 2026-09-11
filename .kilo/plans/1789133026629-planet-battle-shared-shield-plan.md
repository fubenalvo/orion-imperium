# Planet Battle — Shared Shield & Tactical Defense Plan

## Goal

Make planet battles tactically readable on the existing 18×7 battle grid:

- planet defense turrets deploy in the defender's **outermost column** (column 18),
- defense stacks stay **immobile** but remain targetable and fight through the existing combat rules,
- the **Planetary Shield** building becomes a **shared shield pool** that protects only the planet's turret stacks,
- the shared pool regenerates on the defender's turn,
- the planet itself gets a **separate visual element** (not a `BattleStack`), so the grid communicates "this is a planet battle" without faking a ship.

This plan builds on the uncommitted shield/effectiveness/carrier/UI work already present in the working tree. Do not revert or bypass those changes.

## Resolved Decisions

- `planetary_shield` is **not** a unit and **cannot be targeted**. It grants a shared shield pool.
- Shared pool `max` = sum of `shield` from all `planetary_shield` buildings on the planet.
- Shared pool `current` starts at `max`.
- Shared pool absorbs damage **only** for defender stacks with `stack.immobile === true` (turret stacks). Garrison ships use their own per-ship shields.
- At the start of the **defender's turn**, add the sum of all shield-building `shieldRegen` values to the pool, capped at `max`.
- Defense deployment is only changed when a planet battle contains immobile defender stacks. Fleet-vs-fleet deployment must remain exactly as today.
- The planet visual is a separate presentational component using CSS plus the existing `planet-surface-noise-light.png` / `planet-clouds.png` assets. No new binary art is required.
- Shared shield state is battle-local. It is **not** written to `BattleOutcome` or saves.

## Current Baseline (already in working tree)

- `BattleShip` has optional `shield`, `maxShield`, `shieldRegen`, `attackType`, `weakness`, and `role`.
- `BattleCombatService.attackStack()` applies weapon effectiveness, then per-ship shield absorption, then hull damage.
- `BattleTurnService.endTurn()` regenerates per-ship shields for the newly-active side.
- `PlanetBattleService.createVirtualDefenseFleet()` builds virtual defense ships, filters out the shield building, and accumulates an unused `shieldPool`.
- `battle-state.ts` deploys attacker and defender with the same `deployStacks()` helper.
- `BattleModelState` has no shared shield pool and no planet visual metadata.
- The battle screen already has selection panel, result view, carrier Shield Pulse, and per-stack shield UI.

## Ordered Implementation Tasks

### 1. Extend battle transport and model types

File: `src/app/components/battle-screen/battle/battle.types.ts`

- Add:
  ```ts
  export interface BattleShieldPool {
    current: number;
    max: number;
    regen: number;
  }

  export interface BattlePlanetVisual {
    name: string;
    color: string;
  }
  ```
- Extend `BattleFleet` with optional:
  ```ts
  shieldPool?: number;
  shieldPoolRegen?: number;
  ```
- Extend `Battle` with optional:
  ```ts
  planetName?: string;
  planetColor?: string;
  ```
- Extend `BattleModelState` with optional:
  ```ts
  defenderShieldPool?: BattleShieldPool | null;
  planetName?: string;
  planetColor?: string;
  ```
- Keep `defenderShieldPool` optional so existing `BattleModelState` test fixtures do not break.

### 2. Make `PlanetBattleService` provide the shared pool

File: `src/app/services/planet-battle.service.ts`

- Accumulate both values while iterating defense buildings:
  ```ts
  let totalShield = 0;
  let totalShieldRegen = 0;
  ...
  if (def.type === 'shield') {
    totalShield += def.shield ?? 0;
    totalShieldRegen += def.shieldRegen ?? 0;
    continue;
  }
  ```
- Return a typed `VirtualDefenseFleet extends Fleet` carrying:
  ```ts
  shieldPool: totalShield;
  shieldPoolRegen: totalShieldRegen;
  ```
- Keep the shield building filtered out of `virtualShips`.
- Keep `getBuildingHitPoints()` behavior for turrets (`attack * 3`).

New file: `src/app/services/planet-battle.service.spec.ts`

Cover:

- turrets become virtual ships,
- shield building becomes a pool, not a ship,
- multiple shield buildings sum shield and shield regen,
- garrison ships are appended but do not contribute to the pool,
- virtual fleet id uses `-planet.id`.

### 3. Pass planet metadata through the transport

File: `src/app/components/star-map/star-map-planet-arrival.service.ts`

- Import `PLANET_TYPE_COLORS` from `./star-map.models`.
- In `triggerPlanetBattle()`, pass to `setPlanetBattle()`:
  ```ts
  planetName: targetPlanet.name,
  planetColor: PLANET_TYPE_COLORS[targetPlanet.type] ?? '#ffffff',
  ```
- Add an edge-case guard after `createVirtualDefenseFleet()`:
  - if `defenseFleet.ships.length === 0`, treat the planet as undefended: capture it immediately, save, and do not navigate to `/battle`.
  - This prevents a zero-defender battle when a planet has only a shield building.

### 4. Initialize shared pool and deploy defenses in `createBattleState()`

File: `src/app/components/battle-screen/battle/battle-state.ts`

- Read `defenderFleet.shieldPool` / `defenderFleet.shieldPoolRegen` and initialize:
  ```ts
  const shieldPool = battle.type === 'planet' ? (defenderFleet.shieldPool ?? 0) : 0;
  const shieldPoolRegen = battle.type === 'planet' ? (defenderFleet.shieldPoolRegen ?? 0) : 0;

  defenderShieldPool:
    shieldPool > 0
      ? { current: shieldPool, max: shieldPool, regen: shieldPoolRegen }
      : null,
  planetName: battle.planetName,
  planetColor: battle.planetColor,
  ```
- Add a dedicated defender deployment path:
  - Partition defender stacks into:
    - `defenseStacks = stacks.filter((s) => s.immobile)`
    - `garrisonStacks = stacks.filter((s) => !s.immobile)`
  - If `defenseStacks.length === 0`, call the existing `deployStacks(defenderStacks, DEFENDER_DEPLOY_COLS)` unchanged.
  - Otherwise:
    1. Place `defenseStacks` first in `DEFENDER_DEPLOY_COLS` order (`18, 17, 16, 15`), rows in `ROW_ORDER`, wrapping to the next column when a column is full.
    2. Place `garrisonStacks` into the remaining free defender cells, outer-to-inner, preserving deterministic stack order.
    3. Skip any cell whose stack footprint would be out of bounds or occupied.
  - Defense stacks are identified by `immobile`; only virtual defense buildings produce `immobile` stacks today.
  - Keep attacker deployment unchanged.

Update `src/app/components/battle-screen/battle/battle-state.spec.ts`:

- planet battle with 2 turrets + garrison places turrets in column 18,
- garrison fills remaining defender cells without overlap,
- `defenderShieldPool` initializes from the virtual fleet,
- no shield building => `defenderShieldPool === null`,
- fleet-vs-fleet deployment remains unchanged (existing tests must still pass).

### 5. Apply shared shield absorption in combat

File: `src/app/components/battle-screen/battle/battle-combat.service.ts`

- Keep damage calculation unchanged, including `weaponMultiplier()` and `Math.max(1, ...)`.
- After computing `damage`, before the per-ship loop:
  ```ts
  let remaining = damage;
  if (target.immobile && state.defenderShieldPool && state.defenderShieldPool.current > 0) {
    const absorbed = Math.min(state.defenderShieldPool.current, remaining);
    state.defenderShieldPool.current -= absorbed;
    remaining -= absorbed;
  }
  ```
- Feed `remaining` into the existing per-ship shield/hull loop.
- Keep `state.log[0].damage` as the gross volley damage and keep `kills` counting unchanged.
- Shared pool is applied only when `target.immobile` is true, so garrison ships and all fleet-battle targets are unaffected.

Update `src/app/components/battle-screen/battle/battle-combat.service.spec.ts`:

- shared pool fully absorbs a volley; turret hull is untouched,
- shared pool partially absorbs; overflow damages turret hull,
- shared pool depletes across multiple turret stacks,
- garrison stack is not protected by the shared pool,
- per-ship shields still work unchanged for fleet battles.

### 6. Regenerate the shared pool on the defender's turn

File: `src/app/components/battle-screen/battle/battle-turn.service.ts`

- After the existing per-ship `regenerateShields(state)` call, add:
  ```ts
  this.regenerateSharedShield(state);
  ```
- Implement:
  ```ts
  private regenerateSharedShield(state: BattleModelState): void {
    const pool = state.defenderShieldPool;
    if (!pool || state.activeSide !== 'defender') {
      return;
    }
    if (pool.regen <= 0) {
      return;
    }
    pool.current = Math.min(pool.max, pool.current + pool.regen);
  }
  ```
- This mirrors per-ship regen and runs only at the quiescent `endTurn()` point.

Update `src/app/components/battle-screen/battle/battle-turn.service.spec.ts`:

- defender turn regenerates the shared pool by `shieldPoolRegen`,
- attacker turn does not regenerate it,
- regen caps at `max`,
- multiple shield buildings sum their regen,
- no pool => no-op.

### 7. Add the separate planet visual and shared shield UI

New component:
`src/app/components/battle-screen/battle-planet/battle-planet.component.ts|html|scss|spec.ts`

- Inputs:
  ```ts
  @Input() planet: BattlePlanetVisual | null = null;
  @Input() shieldFraction = 0;
  ```
- Renders:
  - a circular planet body tinted with `planet.color`,
  - the planet name label,
  - a shield bubble/aura whose opacity and scale reflect `shieldFraction`.
- Positioned absolutely inside the battle grid:
  - anchored to the defender's outermost column centre (`left: 70vw; top: 14vw;` for the current 4vw grid),
  - width/height roughly `20–22vw`,
  - `transform: translate(-50%, -50%)`,
  - `z-index: 1` so it sits behind move highlights (`z-index: 2`) and stacks (`z-index: 10`),
  - `pointer-events: none`.
- Uses existing assets only:
  - `planet-surface-noise-light.png`,
  - `planet-clouds.png`,
  - `--planet-color` CSS variable.
- Renders nothing when `planet` is null.

File: `src/app/components/battle-screen/battle-grid/battle-grid.component.ts|html`

- Import `BattlePlanetComponent`.
- Add:
  ```ts
  @Input() planet: BattlePlanetVisual | null = null;
  @Input() planetShieldFraction = 0;
  ```
- Render `<app-battle-planet [planet]="planet" [shieldFraction]="planetShieldFraction" />` before the movement highlights.

File: `src/app/components/battle-screen/battle-screen.component.ts|html|scss`

- Add getters:
  ```ts
  get planetVisual(): BattlePlanetVisual | null
  get planetShield(): BattleShieldPool | null
  get planetShieldFraction(): number
  ```
- Pass `[planet]="planetVisual"` and `[planetShieldFraction]="planetShieldFraction"` to `<app-battle-grid>`.
- Add a shared shield indicator in the header, visible only when `planetShield` exists:
  - label `PLANET SHIELD`,
  - a bar filled by `planetShieldFraction * 100`,
  - text `current / max`.
- Fleet battles render no planet visual and no shared shield row.

Update specs:

- `battle-planet.component.spec.ts`: renders planet + name when input is set; renders nothing when null; shield fraction affects the bubble.
- `battle-grid.component.spec.ts`: passes planet and shield fraction through to the child.
- `battle-screen.component.spec.ts`: planet battle exposes `planetVisual` and `planetShield`; fleet battle does not.

### 8. Documentation

Update after the implementation:

- `docs/battle-rules.md`:
  - Tactical Grid: defenses occupy the defender's outermost column (18); garrison fills the remaining defender cells.
  - Combat: document the shared planetary shield pool (absorbs for turret stacks only, regenerates on the defender's turn).
  - Limitations: correct the stale "No shields in combat" statement.
- `docs/data-models.md`:
  - document `BattleFleet.shieldPool` / `shieldPoolRegen`,
  - document `BattleModelState.defenderShieldPool`, `planetName`, `planetColor`.
- `.kilo/plans/battle-screen-design-doc.md`:
  - update the virtual-defense/immobile and "No shields in combat" sections to match the implemented shared pool.

No new documentation file is required, so `AGENTS.md` does not need a new entry.

## Data Flow

```text
StarMap planet arrival
  -> PlanetBattleService.createVirtualDefenseFleet(planet, garrison)
       turrets -> virtual ships
       planetary_shield -> shieldPool + shieldPoolRegen
  -> BattleService.setPlanetBattle({ fleet2: defenseFleet, planetName, planetColor })
  -> createBattleState()
       defense stacks -> column 18 (outermost)
       garrison stacks -> remaining defender cells
       defenderShieldPool -> { current, max, regen }
  -> BattleCombatService.attackStack()
       target.immobile && pool.current > 0 -> pool absorbs first
       remainder -> per-ship shield / hull
  -> BattleTurnService.endTurn()
       activeSide === 'defender' -> pool.current += pool.regen, capped at max
  -> BattleGrid / BattleScreen
       planet visual + shield bubble + PLANET SHIELD bar
```

## Edge Cases

- **No shield building**: `defenderShieldPool` is null; no shared shield UI; combat behaves exactly as the existing per-ship path.
- **Multiple shield buildings**: shield and regen values sum; pool max stays constant because shield generators are not destructible units in this design.
- **Garrison present**: garrison ships keep their own per-ship shields and are never protected by the shared pool.
- **Turret stack destroyed**: the shared pool remains and still protects other turret stacks.
- **No turrets and no garrison**: `defenseFleet.ships.length === 0`; capture the planet directly instead of starting a battle.
- **Overkill**: shared pool absorbs first; leftover damage spills into the existing per-ship shield/hull loop.
- **Fleet vs fleet**: attacker and defender deployment, combat, and regen behavior must remain byte-for-byte unchanged.
- **Planet visual overflow**: the visual may extend slightly past the grid edge; it must remain `pointer-events: none` and clipped only by the existing screen container if necessary.

## Risks / Constraints

- The working tree already contains uncommitted battle WIP. Implement on top of it; do not reset or revert unrelated changes.
- Using `stack.immobile` as the defense marker is safe today because only virtual defense buildings produce immobile stacks. If a future ship or ability becomes immobile, introduce an explicit `isDefense` flag then.
- Adding required fields to `BattleStack` or `BattleModelState` would churn many test fixtures. Prefer optional model-state fields and no new required `BattleStack` fields.
- Shared pool damage must not be applied to garrison stacks; the `target.immobile` predicate is the single guard.
- Keep the `damage` value in `BattleLogEntry` as the gross volley value to avoid breaking existing combat assertions.
- The planet visual component must not intercept clicks or stack selection.

## Validation

1. Capture a baseline test run before changes and record pre-existing failures.
2. Run the battle and planet specs:
   - `planet-battle.service.spec.ts`,
   - `battle-state.spec.ts`,
   - `battle-combat.service.spec.ts`,
   - `battle-turn.service.spec.ts`,
   - `battle-grid.component.spec.ts`,
   - `battle-screen.component.spec.ts`,
   - `battle-planet.component.spec.ts`.
3. Run `npm test` (or `ng test --watch=false`) and `npm run build`.
4. Manual smoke test:
   - build a planet with 2 turrets, 1 Planetary Shield, and a garrison fleet,
   - verify turrets start in column 18 and the garrison fills the remaining defender cells,
   - verify the planet visual appears only in planet battles and uses the planet's type color,
   - verify the shared shield absorbs damage for turrets only,
   - verify the shared shield regenerates at the start of each defender turn,
   - verify the PLANET SHIELD bar and bubble update,
   - verify a fleet-vs-fleet battle is visually and mechanically unchanged.

## Out of Scope

- making the Planetary Shield generator a destructible target,
- shared shield protection for garrison ships,
- new planet image assets or 3D planet rendering,
- persisting shared shield state to saves or `BattleOutcome`,
- changing AP, movement, weapon effectiveness, carrier behavior, or fleet-battle deployment.

## Open Questions / Assumptions

- None blocking. The main assumption is that shield generators remain non-destructible battlefield infrastructure, so the pool max is constant for the whole battle. If generators become destructible later, the pool max and the regen source must be recomputed when a generator is destroyed.

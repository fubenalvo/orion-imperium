# Plan: Planet Habitability/Morale Drift + Workforce-Based Building Efficiency

## Goal
Add two mechanics to the existing planet/economy system, without refactoring the working economy core:
1. Planet-type-based morale drift (habitability) ticked via the existing game-time economy loop, offset by social/entertainment buildings.
2. Workforce availability (residential-provided vs building-required) driving a simple `efficiency` multiplier on building production.

Scope: economy, planet-data, models, production integration, planet Details UI, save/load compat, unit tests. Out of scope: AI, diplomacy, research tree, new UI panels, population simulation, citizen entities.

## Current-state findings (verified against the codebase)
- `PlanetType` (`star-map.models.ts:10`): `'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert'`. No `barren`/`ocean`/`terran`/`gasgiant`-habitable distinction exists; map the new mechanic onto these six actual types.
- `planet-data.json` **already declares** `workforce`, `moraleRate`, `population`, `role` per building — but `BuildingStats` (`star-map.models.ts:247-255`) does **not** include them. `BuildingType` in `star-map-planet-screen.component.ts:23-46` does. `data-models.md:140` documents `population, workforce, moraleRate` as "optional demographic fields (not yet applied)". So no new data plumbing is needed for `moraleRate`/`workforce` requirement — only values need adjusting/adding.
- `EconomyService.calculatePlanetEconomy` (`economy.service.ts:63`) iterates `planet.buildings`, looks up defs by name via `buildingStatsByName`. Production rates are plain numbers added to a `production` object. This is the single place to scale building production by workforce efficiency.
- Satisfaction drift already exists in `applyEconomyDelta` (`economy.service.ts:257-262`): `±1 * deltaTime` based on energy balance, gated by the 1-second accumulator in `star-map.ts:1688-1699`. The accumulator is fed **scaled** `gameDeltaTime` from `GameTimeService.getScaledDeltaTime` (0 at pause, `*speed` at 2x). **=> pause/1x/2x behaviour is already handled for free if the new drift is added here and multiplied by `deltaTime`.**
- `StarMapData` is the save root; satisfaction is the only morale-related persisted field and already defaults to `100` when missing. All new values are either (a) on `PlanetTile.type` (persisted), or (b) looked up fresh from `planet-data.json` by building name each tick — so **no save migration is required** and old saves keep working.
- UI: planet Details tab is `star-map-planet-screen.component.html` (default `@case`). It receives `planetEconomy: PlanetEconomyEntry` and already renders Satisfaction (`@case ... SATISFACTION`, `:258-262`). Planet-info component (`star-map-planet-info.component.html`) renders an Economy block.
- Tests: vitest (`tsconfig.spec.json` → `vitest/globals`; `angular.json` test = `@angular/build:unit-test`; `ng test`). Plain `describe/it/expect` works (see `star-map-resources.spec.ts`). `ShipService` has no DI deps, so `new EconomyService(new ShipService())` runs in a pure unit test without TestBed.

## Resolved design decisions
1. **Habitability map** (new exported const `PLANET_TYPE_HABITABILITY` in `star-map.models.ts`, near `PLANET_TYPE_COLORS`). Decimal per-second morale drift keyed on the six real `PlanetType`s:
   - `earthlike: 0`, `gasgiant: 0` (not surface-colonisable; moot), `marslike: -0.03`, `venuslike: -0.05`, `desert: -0.05`, `ice: -0.08`.
   - This maps the user's categories (Terran→earthlike=0, Desert→desert=-0.05, Ice→ice=-0.08; "Ocean/habitable"=0 → earthlike; "Barren"=strongly negative → none exists, so the harshest real type, `ice`/`desert`, carry the negative values). `gasgiant: 0` is safe because gas giants are not colonised.
2. **Additive drift model** (honors "don't rewrite the working energy drift"). Total per-second satisfaction delta = `energyDirection(±1) + (habitabilityBase + Σ building.moraleRate)`, all `× deltaTime`, clamped `[0,100]`. The energy-based rebellion mechanic is untouched. *Risk/tuning note:* the existing `±1/s` energy drift dominates the small habitability values; habitability is a secondary modifier. Shrinking the energy drift magnitude is explicitly out of scope.
3. **`moraleRate` units**: redefine the JSON `moraleRate` as a **per-second** morale drift contribution (decimal), since it is currently unused. Updated values in `planet-data.json`:
   - `Park` (Central Park): `0.03`; `Entertainment Center`: `0.08`; `Hospital`: `0.02`; `School`: `0.01`; `Fusion Plant`: `-0.01`; `Spaceship Factory`: `-0.02`; `Mining Complex`: `-0.01`; all others `0`. (Matches the user's two explicit examples exactly: Park +0.03, Entertainment +0.08.)
4. **Workforce model** (minimal JSON + interface changes, no rebalancing of existing `workforce` requirement values):
   - Add `providesWorkforce?: number` to `BuildingStats`.
   - `planet-data.json`: add `providesWorkforce: 20/50/100` to Small/Medium/Large Residential; set those three residential entries' `workforce` (requirement) to `0` so residential are pure providers (matches the user's example: residential only provides). All other buildings keep their existing `workforce` requirement values untouched.
   - `availableWorkforce = Σ providesWorkforce` on `role === 'housing'` buildings; `requiredWorkforce = Σ workforce` (requirement) across **all** buildings.
   - `workforceEfficiency = requiredWorkforce > 0 ? Math.min(1, available / required) : 1` (floor 0).
5. **Production integration**: in `calculatePlanetEconomy`, multiply each building's `production` rate by `workforceEfficiency` (applies to both the displayed `PlanetEconomyEntry` and the rates applied in `applyEconomyDelta`, since both flow through `calculatePlanetEconomy`). Consumption and the `pop * 0.1` credit contribution are **not** scaled (a half-staffed factory still uses power; population tax is a separate planet-level income). Documented as a v1 simplification.
6. **Morale drift** exposed as a pure method `getMoraleDriftPerSecond(planet): number` (= `PLANET_TYPE_HABITABILITY[planet.type] + Σ building.moraleRate`), consumed by `applyEconomyDelta` and by tests.
7. **View-model fields** added to `PlanetEconomy`/`PlanetEconomyEntry` (computed, not persisted): `workforceAvailable`, `workforceRequired`, `workforceEfficiency`, `habitabilityDrift`, `buildingMoraleBonus`.
8. **Save/load**: no `migrateSave` changes needed — new values are data-driven/computed. Only confirm `satisfaction ?? 100` default remains (already present at `economy.service.ts:103`).
9. **Test runner**: `ng test` (vitest, single run watches via vitest). Typecheck: `npx tsc --noEmit -p tsconfig.app.json` or `ng build`. (No `lint`/`typecheck` npm scripts exist.)

## File changes (ordered, minimal)
1. `src/app/components/star-map/star-map.models.ts`
   - Add `providesWorkforce?: number;` to `BuildingStats` (and `workforce`, `moraleRate`, `role`, `population` if not present — they are absent today, so add them to keep TS happy).
   - Add `PLANET_TYPE_HABITABILITY: Record<PlanetType, number>` const + export.
   - Add `workforceAvailable`, `workforceRequired`, `workforceEfficiency`, `habitabilityDrift`, `buildingMoraleBonus` to `PlanetEconomy` and to `PlanetEconomyEntry`.
2. `src/app/components/star-map/planet-data.json`
   - Residential blocks: set `workforce: 0`, add `providesWorkforce: 20 | 50 | 100` on Small/Medium/Large.
   - Adjust `moraleRate` to per-second decimals (Park 0.03, Entertainment Center 0.08, Hospital 0.02, School 0.01, Fusion Plant -0.01, Spaceship Factory -0.02, Mining Complex -0.01, rest 0).
3. `src/app/services/economy.service.ts`
   - In `calculatePlanetEconomy`: pre-compute `workforceAvailable/required` + `buildingMoraleBonus` from building defs; compute `workforceEfficiency`; multiply building `production` accumulation by `workforceEfficiency`; return new view-model fields.
   - Add `getMoraleDriftPerSecond(planet): number`.
   - In `getPlanetEconomyBreakdown`: pass through the new fields.
   - In `applyEconomyDelta`: replace `current + direction * deltaTime` with `current + (energyDirection + moraleDrift) * deltaTime`, clamped `[0,100]`; keep rebellion check.
4. `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html`
   - DETAILS tab: add a WORKFORCE row (`available/required`, e.g. `70 / 100`), a WORKFORCE EFFICIENCY row; extend the Satisfaction block to show Habitability + Entertainment (building morale sum), e.g. `Satisfaction: 72`, `Habitability: -0.05`, `Entertainment: +0.08`. No new panel — use existing `.planet-sidebar__info-row` pattern.
   - (Optional, low effort) mirror a Workforce Efficiency line in `star-map-planet-info.component.html` Economy block.
5. `docs/data-models.md` + `docs/invariants.md`
   - Update the `BuildingStats`/`PlanetEconomy`/`PlanetEconomyEntry` field lists and the satisfaction-drift invariant to mention the additive habitability/morale term and the workforce-efficiency production scaling.
6. `src/app/services/economy.service.spec.ts` (NEW) — vitest, `new EconomyService(new ShipService())`.

## Test cases (all 9 required, plus a couple of edge cases)
Built with `PlanetTile` helpers + real `planet-data.json` via the service.
1. `earthlike` → `getMoraleDriftPerSecond === 0`.
2. `desert` → `getMoraleDriftPerSecond < 0` (=== -0.05 + 0 = -0.05 with no buildings).
3. `ice` → `getMoraleDriftPerSecond < 0` (=== -0.08).
4. `desert` + `Entertainment Center` → `getMoraleDriftPerSecond === -0.05 + 0.08 = +0.03` (positive, offsets).
5. Workforce: residential 70 provided, factories requiring 55 → `workforceEfficiency === 1` (and `calculatePlanetEconomy().workforceEfficiency === 1`).
6. Provided 50, required 100 → `workforceEfficiency === 0.5`.
7. Production scaling: planet producing rawmaterials, 50% workforce → `calculatePlanetEconomy().production['rawmaterials']` === `base * 0.5`.
8. Pause: `applyEconomyDelta(planet, deltaTime = 0)` → satisfaction unchanged.
9. 2× speed: morale drift scales linearly with `deltaTime` — `applyEconomyDelta(planet, 2.0)` on a clone changes satisfaction by exactly `2×` the change from `applyEconomyDelta(planet, 1.0)`; plus cite `GameTimeService.getScaledDeltaTime` returns `2×` at 2× (already in `game-time.service.spec.ts`). This proves 2× speed → 2× morale ticks (accumulator receives 2× scaled delta → twice as many 1s economy ticks).
- Edge cases: no buildings → `workforceEfficiency === 1`, `habitabilityDrift === 0` for earthlike, moraleRate sum === 0. `requiredWorkforce === 0` → efficiency 1 (no stall). Satisfaction clamp never exceeds `[0,100]`.

## Validation steps (implementation agent runs these)
- `npx tsc --noEmit` (or `ng build`) — typecheck models/service/UI consistency.
- `npm test` (vitest `ng test`) — run `economy.service.spec.ts` (+ existing specs still pass).
- Manually (in-app): confirm Details panel shows workforce, efficiency, habitability; confirm desert planet satisfaction drifts down and an Entertainment Center visibly offsets it; confirm pause freezes; confirm 2× quickens drift; confirm rawmaterials production halves when residential are removed.

## Risks & open items
- Energy drift (±1/s) dominates habitability (±0.05–0.08/s). Not changed here per the "don't rewrite working systems" constraint; flag for a future balancing pass (could shrink energy drift to ±0.2/s) — **explicitly out of scope for this task**.
- `moraleRate` JSON values were previously integers (unused); changing them to decimals is safe (nothing reads them yet). Documented in `data-models.md`.
- Consumption is intentionally not scaled by workforce efficiency. If a reviewer prefers scaling consumption too, that is a one-line change in `calculatePlanetEconomy`; **decided: do not scale consumption.**
- Residential `workforce` requirement set to `0` (was 2/4/8). This is a deliberate simplification so residential are pure providers; the tiny old requirement was never read by any system.

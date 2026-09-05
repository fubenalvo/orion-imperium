# Plan: Simple Planet Population Growth

Small, isolated population growth that reuses the existing habitability, satisfaction, game-time, and economy-tick systems. **Does not** add a new timer, service, population cap field, food, migration, buildings, or AI changes.

## Design decisions (resolved)
- **Capacity source:** the existing residential buildings' `population` field (Small=100, Medium=300, Large=700). This is already per-building data in `planet-data.json`; a new `getPopulationCapacity(planet)` helper sums it. It is distinct from `providesWorkforce` (workforce), so the workforce formula is **untouched**.
- **Habitability source:** reuse `PLANET_TYPE_HABITABILITY` (already in `star-map.models.ts`) → `habMod = max(0, 1 + drift)`. Reuses existing values (earthlike 1.0, desert 0.95, ice 0.92, marslike 0.97, venuslike 0.95, gasgiant 1.0).
- **Satisfaction source:** existing `planet.satisfaction` (0..100) → `satMod = max(0, min(1, satisfaction/100))`. At 0 satisfaction → no growth (stops). Decline below 0 is **not** implemented (v1), see Risks.
- **Where:** inside the existing `EconomyService.applyEconomyDelta` per-planet loop (step 4), after satisfaction + resource deltas. `applyEconomyDelta` is called from the 1-second accumulator in `star-map.ts` that is fed the **scaled** delta → pause (delta 0) and 2× (double delta, double tick rate) work for free. No new timer/loop.
- **Scope of planets:** grow every owned, non-independent planet (mirrors where the existing satisfaction drift already runs — consistent, minimal branch). An independent/flipped planet and any planet with `cap <= 0` are skipped (no-op).
- **Population type:** kept as a `number` (fractional growth allowed internally for smoothness); display rounded via `number:'1.0-0'` in the two UI spots that show raw population. No new persisted field.

## Proposed formula
```
baseGrowthPerSec = 0.005   // POPULATION_GROWTH_BASE_RATE, easily tunable

remaining = max(0, cap - pop)
if cap <= 0 or remaining <= 0: growth = 0
satMod  = max(0, min(1, satisfaction / 100))      // 0 (starving) .. 1 (full)
habMod  = max(0, 1 + PLANET_TYPE_HABITABILITY[type])  // ~0.92 .. 1.0
growth  = baseGrowthPerSec * satMod * habMod * remaining * deltaTime   // satisfaction points/sec
pop     = min(cap, max(0, pop + growth))         // clamp to [0, cap]
```
- Good world, far from cap, full satisfaction → grows fastest.
- Near cap (`remaining → 0`) → slows to 0 (logistic-ish, self-limiting).
- Satisfaction 0 → `satMod 0` → stops (satisfies "very low satisfaction → stops growing").
- Habitability lowers the ceiling (ice/mars grow slower than earthlike).

Worked test numbers (base 0.005): earthlike, 1 Small Residential (cap 100), pop 0, sat 100, hab 1, delta 1s → `0.005 * 1 * 1 * 100 * 1 = 0.5` pop/s.

## Files to change (minimal)
1. `src/services/economy.service.ts`
   - Add `private static readonly POPULATION_GROWTH_BASE_RATE = 0.005;`
   - Add `getPopulationCapacity(planet): number` → sum `stats.population` for `role === 'housing'` buildings (reuse `buildingStatsByName`).
   - Add `calculatePopulationGrowth(planet, deltaTime): number` (pure: the formula above, no mutation) — for tests + the applier.
   - In `applyEconomyDelta`, per-planet loop, after step 3 (resource deltas): `if (planet.factionId !== 'independent') { const c = this.getPopulationCapacity(planet); const g = this.calculatePopulationGrowth(planet, deltaTime); if (g > 0) planet.population = Math.min(c, Math.max(0, (planet.population ?? 0) + g)); }`
   - Add `populationGrowth` (per second, the delta applied this tick) to `PlanetEconomyEntry` so the UI can surface it (optional display). Computed in `calculatePlanetEconomy`/`getPlanetEconomyBreakdown`.
2. `src/services/economy.service.spec.ts` (NEW — append a `Population growth` describe block)
3. `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html` — pipe the raw population display to `number:'1.0-0'` (it now may be fractional). (Details tab already shows population; no new row strictly required, but a small "GROWTH +0.5/s" line is a nice affordance — optional.)
4. `src/app/components/star-map/star-map-planet-info/star-map-planet-info.component.html` — pipe raw population to `number:'1.0-0'`.
5. `docs/invariants.md`, `docs/data-models.md`, `docs/game-state.md` — document the growth formula, cap source, and that it is derived (no save impact).

## Cap & clamping
- `cap = Σ residential.building.population` (existing data field). If 0 (no housing), growth is a no-op — prevents a colonized-but-unhoused planet from ballooning.
- After growth: `pop = min(cap, max(0, pop + growth))` so population never exceeds capacity and never goes negative.

## Pause & 2× speed
- `applyEconomyDelta` is invoked by the 1-second accumulator at `star-map.ts:1688-1706`, which does `economyAccumulator += gameDeltaTime` (scaled) and only fires when `>= 1`. `gameDeltaTime` is `0` while paused and `realDelta * speed` while running (GameTimeService). Therefore: pause → no accumulator growth → no fire → no population change; 2× → accumulator fills 2× faster → twice as many per-second ticks → population grows 2× per real second. **No additional pause/speed code is needed.** Verified at the same level the morale drift already is.

## Tests to add (in `economy.service.spec.ts`, vitest, plain `new EconomyService(new ShipService())`)
Use a helper planet: `earthlike` + 1 × Small Residential Block (cap 100), sat 100, pop 0, owned by `player`, wrapped in a system + faction for `applyEconomyDelta` (mirror the existing spec helpers).
1. Good earthlike planet grows: `calculatePopulationGrowth(...)` ≈ 0.5 at deltaTime 1 (cap 100, sat 100, hab 1).
2. Desert/ice grow slower than earthlike at identical satisfaction/housing (habitability modifier).
3. Low satisfaction slows growth: sat 25 → ~1/4 the growth of sat 100; sat 0 → 0.
4. Cap respected: when `pop === cap`, growth is 0; a tick never pushes population above cap (via `applyEconomyDelta`).
5. Decline/stops at 0 satisfaction: growth is 0 (no negative).
6. 2× linearity: `growth(planet, 2.0) ≈ 2 × growth(planet, 1.0)` (proves 2× game-time scales growth).
7. Pause: `applyEconomyDelta(..., deltaTime = 0)` leaves `planet.population` unchanged.
8. No housing: cap 0 → growth 0 (no unbounded growth).
9. Integration: one `applyEconomyDelta` tick at deltaTime 1 increases `planet.population` for a good, housed planet; does not change it for an independent planet or a cap-full planet.

## Risks / out of scope (v1)
- Population decline (not stop) at very low satisfaction is intentionally omitted; `satMod` floors at 0. Can be added later with a small negative term.
- Enemies also grow (consistent with where satisfaction drift already runs). If this over-strengthens AI over long games, add `if (factionId === 'player')` guard in `applyEconomyDelta` — a one-line change.
- `baseGrowthPerSec = 0.005` is a balance knob; tune if growth feels too fast/slow.
- Consumption/production of the grown population's `pop * 0.1` credit income flows through the existing `calculatePlanetEconomy` automatically (no change needed) — a positive feedback loop by design for v1.
- No save migration: `planet.population` already persists; cap is recomputed from buildings each tick.

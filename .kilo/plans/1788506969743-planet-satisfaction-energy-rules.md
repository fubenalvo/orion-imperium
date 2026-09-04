# Planet Satisfaction & Energy Reporting Plan

## Overview

Wire up planet satisfaction (elégedettség) as a real gameplay stat that responds to energy availability, scales that planet's credit income, and ultimately flips the planet to the `independent` faction when it hits 0. While we're at it, fix the sidebar so the player can see actual energy production (currently broken — see `star-map-planet-screen.component.html:148` where `getEnergyForPlanet` is called but the displayed value is unclear and there is no production breakdown).

## Design Decisions

| Decision | Choice |
|---|---|
| Satisfaction storage | New `satisfaction: number` field on `PlanetTile`, range 0..100, default 100 |
| Initial satisfaction on capture / new game | 100 (peaceful) |
| Drop / recover rate | Symmetric ±1 / second |
| Drop condition | `energyProduction < energyConsumption` (i.e. net energy < 0) |
| Recover condition | `energyProduction >= energyConsumption` |
| Income coupling | Credits production from the planet is scaled by `satisfaction / 100`. Other resources are NOT scaled (raw materials and research continue at full efficiency). Maintenance is never scaled. |
| Population tax coupling | Yes — `pop * 0.1` is part of credits production, so it inherits the multiplier automatically. |
| Energy multiplier on production | Already handled by `efficiency = prod/cons` in `EconomyService`. We do NOT change that. |
| 0% → faction flip | When satisfaction reaches 0, set `planet.factionId = 'independent'`, satisfaction stays 0. Buildings remain intact, garrison fleet (if any) remains on planet. Persisted in save. |
| Recovery after flip | Not automatic — once independent, satisfaction is locked at 0 until the planet is re-conquered via battle (out of scope for this plan; future PR). |
| Save compatibility | Treat `satisfaction === undefined` as 100 on load (backward compatible). |
| Sidebar energy display | Replace single `ENERGY` row with `ENERGY  prod / cons` plus `ENERGY BAL  net` row. `BAL` text rendered red when negative. |
| Other sidebar rows | Add `INCOME /s`, `SATISFACTION %` (red below 50), keep `POPULATION`, `RAW MATERIALS /s`. Drop the old `DAILY TAX` row (it was already redundant with the economy block). |

## Files Modified

| File | Change |
|---|---|
| `src/app/components/star-map/star-map.models.ts` | Add `satisfaction: number` to `PlanetTile`; add `satisfaction?: number` to `PlanetEconomyEntry` |
| `src/app/components/star-map/star-map-data.json` | Backfill `satisfaction: 100` on every starting planet (or omit; loader handles undefined) |
| `src/app/services/economy.service.ts` | New `updateSatisfaction(...)` step in `applyEconomyDelta`; expose `incomeMultiplier` per planet; trigger flip; return `satisfaction` in breakdowns |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html` | Replace `ENERGY` / `DAILY TAX` rows with the new layout (prod/cons/bal, income, satisfaction, raw materials) |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss` | Add `.planet-sidebar__info-row--danger` modifier (red text), optional `.planet-sidebar__info-row--warn` (yellow <50%) |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts` | Accept new inputs from parent (`planetEconomy` already plumbed) — minimal changes; read satisfaction + energy prod/cons/bal from `planetEconomy` |
| `src/app/components/star-map/star-map.ts` | Stop reading energy via the old `getEnergyForPlanet` closure for the sidebar; rely on `planetEconomy` (already passed in). Inject nothing new. |
| `docs/data-models.md` | Document the new `satisfaction` field and its semantics |
| `docs/battle-rules.md` | Cross-reference: independent planets can be re-conquered (note: implementation deferred) |
| `docs/invariants.md` | Add invariant: `satisfaction ∈ [0, 100]`; `satisfaction === 0 ⇔ factionId === 'independent'` for previously-owned planets |

## Implementation Steps

### 1. Extend Data Model (`star-map.models.ts`)

```ts
export interface PlanetTile {
  // ... existing fields ...
  satisfaction?: number; // 0..100, defaults to 100 when undefined
}
```

`PlanetEconomyEntry` gains:

```ts
satisfaction: number;          // current value (0..100)
incomeMultiplier: number;      // satisfaction / 100, applied to credits
```

`PlanetEconomy` (used inside the service) gains:

```ts
satisfaction: number;
```

### 2. Backfill Starting Data (`star-map-data.json`)

Either add `"satisfaction": 100` to every planet object, or rely on the loader default. Recommend omitting in JSON and defaulting to 100 in the service — keeps the diff small and the file is the source of truth only for newly authored content.

### 3. Update `EconomyService`

a) `calculatePlanetEconomy` now also returns `satisfaction` (taken from the planet) and computes `incomeMultiplier = satisfaction / 100`.

b) New private method `updateSatisfactionForPlanet(planet, energyDeficit: boolean, deltaTime)`:

```ts
private updateSatisfactionForPlanet(planet: PlanetTile, energyShort: boolean, dt: number) {
  const current = planet.satisfaction ?? 100;
  if (current <= 0) return; // locked at 0 once independent (handled separately)
  const direction = energyShort ? -1 : +1;
  const next = Math.max(0, Math.min(100, current + direction * dt));
  planet.satisfaction = next;
}
```

c) `applyEconomyDelta` integration (sketch):

```ts
for (const planet of ownedPlanets) {
  const economy = this.calculatePlanetEconomy(planet); // already done today
  const energyShort = economy.energyProduction < economy.energyConsumption;
  this.updateSatisfactionForPlanet(planet, energyShort, deltaTime);

  // Apply credits with multiplier (only stock resource affected for now)
  for (const resource of STOCK_RESOURCES) {
    const netRate = planetEconomy.netRates[resource] ?? 0;
    const multiplier = resource === 'credits' ? (planet.satisfaction ?? 100) / 100 : 1;
    const effective = netRate * planetEconomy.efficiency * multiplier;
    // ... existing currency mutation, replace `effectiveRate` with `effective`
  }
}
```

d) Rebellion check — after updating satisfaction, if `planet.satisfaction === 0 && planet.factionId !== 'independent'`, set `planet.factionId = 'independent'`. This must happen BEFORE the credits are written, so we don't double-count income on the tick the planet flips. Implementation:

```ts
if ((planet.satisfaction ?? 100) <= 0 && planet.factionId !== 'independent') {
  planet.factionId = 'independent';
}
```

e) `getPlanetEconomyBreakdown` must include `satisfaction` and `incomeMultiplier` so the sidebar can render them.

### 4. Sidebar UI (`star-map-planet-screen.component.html`)

Replace lines 146..154:

```html
<div class="planet-sidebar__info-row">
  <span>ENERGY</span>
  <span>{{ planetEconomy.energyProduction | number: '1.0-0' }} / {{ planetEconomy.energyConsumption | number: '1.0-0' }}</span>
</div>
<div class="planet-sidebar__info-row" [class.planet-sidebar__info-row--danger]="planetEconomy.energyBalance < 0">
  <span>ENERGY BAL</span>
  <span>{{ planetEconomy.energyBalance | number: '1.0-0' }}</span>
</div>
<div class="planet-sidebar__info-row">
  <span>INCOME</span>
  <span>{{ planetEconomy.netRates['credits'] * (planetEconomy.incomeMultiplier ?? 1) | number: '1.0-0' }}/s</span>
</div>
<div class="planet-sidebar__info-row" [class.planet-sidebar__info-row--warn]="(planetEconomy.satisfaction ?? 100) < 50"
     [class.planet-sidebar__info-row--danger]="(planetEconomy.satisfaction ?? 100) <= 0">
  <span>SATISFACTION</span>
  <span>{{ planetEconomy.satisfaction ?? 100 | number: '1.0-0' }}%</span>
</div>
```

Keep the existing economy block (credits/rawmaterials/research rates, efficiency) — drop the redundant `CREDITS` row from it since `INCOME` already covers it. Keep rawmaterials/research because they are not affected by satisfaction.

### 5. SCSS Additions (`star-map-planet-screen.component.scss`)

```scss
.planet-sidebar__info-row--danger {
  color: #ff5252;
}
.planet-sidebar__info-row--warn {
  color: #ffb74d;
}
```

### 6. StarMap Wiring (`star-map.ts`)

No new injection needed. The existing `applyEconomyDelta` call at lines 1227 and 1590 already runs once per game loop tick. Verify `this.economyService` is already injected (line 16 confirms). The change in the service is enough; the parent component does not need any new glue.

However: the sidebar currently shows `getEnergyForPlanet(planet!)` — that helper lives in `EconomyService` and returns `energyProduction`. With the new layout we want both prod AND cons, so we read both from `planetEconomy` instead. This means `getEnergyForPlanet` is no longer referenced from the template. Leave the method on the service for backward compat with any other consumer (search first; if unused, delete it).

### 7. Save Compatibility

`SaveGameService` stores the full `StarMapData` JSON. Adding an optional field is automatically compatible. On load, any planet without `satisfaction` will be treated as 100 (handled by the `?? 100` defaults). No schema migration code required.

### 8. Documentation Updates

- `docs/data-models.md`: document `PlanetTile.satisfaction` (0..100, default 100, locked at 0 for `independent`).
- `docs/invariants.md`: add:
  - `0 ≤ satisfaction ≤ 100` for all planets.
  - If a planet previously belonged to a player faction and now has `factionId === 'independent'`, its `satisfaction === 0`.
  - `credits` production from a planet is multiplied by `satisfaction / 100`; raw materials and research are not.
- `docs/battle-rules.md`: cross-link the re-conquer mechanic for `independent` planets (deferred to a future PR).

## Data Flow

```
game tick (deltaTime)
  → EconomyService.applyEconomyDelta
      for each owned planet:
        compute prod/cons/net/efficiency
        energyShort = prod < cons
        update satisfaction by ±deltaTime if not already 0
        if satisfaction == 0 && factionId != 'independent':
          factionId = 'independent'   ← rebellion
        multiply credits netRate by satisfaction/100
        write currency deltas (credits scaled, others unchanged)
  → PlanetScreen sidebar re-renders via @Input planetEconomy binding
  → red text appears when energyBalance < 0 or satisfaction < 50
```

## Edge Cases

| Case | Behaviour |
|---|---|
| Planet already at 0% and not independent (legacy state from older save) | On next tick, the rebellion check fires once and flips it. |
| Planet at 0% after rebellion | `updateSatisfactionForPlanet` early-returns; cannot recover. |
| Player demolishes / removes a power plant → energyShort becomes true | Satisfaction drops at -1/s, income shrinks proportionally. |
| Player adds a power plant → energyShort false | Satisfaction recovers at +1/s, income grows back. |
| Energy exactly equals demand (balance = 0) | Treated as NOT short (recover branch). |
| Negative credits income while satisfaction > 0 | Income multiplier reduces it further; maintenance still paid in full. |
| Credits go negative | Already handled by `Math.floor(newValue)` not clamping — current behaviour preserved. |
| Owned but has zero buildings | Energy production = 0, consumption = 0 → not short → satisfaction stable. Income comes only from population tax and is scaled by satisfaction (always 100 on a fresh capture). |
| Independent planet (already flipped) | Owned-planets iteration skips it (filtered by `factionId !== 'independent'`), so no further satisfaction drift. |

## Validation Plan

1. **Sidebar shows prod/cons**: Build a planet with 1 solar_array + 1 fusion_plant + 2 small_residential. Confirm sidebar shows e.g. `140 / 18` and a green balance `+122`.
2. **Energy short → red**: Manually drop the player to one solar_array while keeping enough consumers to exceed it (e.g. 4 factories). Confirm `ENERGY BAL` row turns red and satisfaction begins ticking down at 1/s.
3. **Production halts with energy short**: Confirm `efficiency` is already < 1 in the economy block and that the rawmaterials row drops accordingly. (Pre-existing behaviour.)
4. **Income multiplier**: Confirm `INCOME` row equals `credits net * (satisfaction / 100)`.
5. **Satisfaction recovery**: Restore energy by removing one factory. Confirm satisfaction ticks up at 1/s, income grows with it.
6. **Rebellion**: Force satisfaction to ~5 by waiting, then either (a) wait to 0, or (b) set `planet.satisfaction = 0` in dev tools. Confirm faction flips to `independent`, buildings stay, planet no longer contributes to the player's income.
7. **Save / load**: Save the game after rebellion, reload, confirm planet is still `independent` with satisfaction 0.
8. **No double-count on rebellion tick**: Confirm the credits tick where the planet flips produces 0 income from that planet.

## Out of Scope (Future PRs)

- Re-conquering independent planets (battle wiring already supports it; just needs UI prompt and satisfaction reset to 50 on capture).
- Using `moraleRate` per building as an additional satisfaction modifier (already in JSON, currently unused).
- Satisfaction-driven population growth/decay.
- Player notifications / event log entries on the rebellion moment.
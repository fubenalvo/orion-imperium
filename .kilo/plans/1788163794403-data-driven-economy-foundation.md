# Economy System Foundation Plan

## 1. Context Summary

### Current Architecture
- **EconomyService**: Faction-level credits only. `calculateEconomy()` computes `pop * 0.1` income minus building/fleet maintenance. `applyEconomyDelta()` applies net credits change to `faction.currencies['credits']`.
- **Building data**: `planet-data.json` defines buildings with `energyConsumption`, `energyProduction`, `maintenanceCost`. Instances in `PlanetTile.buildings` only store `{ name, size, x, y }`.
- **PlanetTile**: Has `population`, `buildings[]`. No per-planet economy state.
- **Faction**: `currencies: Record<string, number>` already supports `credits`, `rawmaterials`, `research`.
- **Game loop**: `StarMapGameLoopService` provides `deltaTime` (seconds, clamped to 0.1). Economy ticks every 1 second via accumulator.
- **Save/load**: Serializes full `StarMapData`; no derived economy state persisted.
- **UI**: `FactionCurrenciesComponent` shows currencies + credits breakdown overlay. Planet info/planet screen show hardcoded `ENERGY` and `DAILY TAX`.

### Key Insight
`energy` is a **flow resource** (production/consumption rate), not a stock. It determines `efficiency`, which scales production of stock resources (`credits`, `rawmaterials`, `research`). Energy is NOT accumulated in `faction.currencies`.

---

## 2. Files to Inspect (Already Done)
- `src/app/services/economy.service.ts`
- `src/app/components/star-map/planet-data.json`
- `src/app/components/star-map/star-map.models.ts`
- `src/app/components/star-map/star-map.ts`
- `src/app/components/star-map/star-map.html`
- `src/app/components/star-map/star-map-data.json`
- `src/app/components/star-map/star-map-planet-info/star-map-planet-info.component.ts`
- `src/app/components/star-map/star-map-planet-info/star-map-planet-info.component.html`
- `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts`
- `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html`
- `src/app/components/star-map/faction-currencies/faction-currencies.component.ts`
- `src/app/components/star-map/faction-currencies/faction-currencies.component.html`
- `src/app/services/save-game.service.ts`
- `src/app/components/star-map/star-map-game-loop.service.ts`
- `src/app/app.ts`
- `angular.json`, `package.json`, `docs/architecture.md`, `docs/data-models.md`

---

## 3. Design Decisions

### 3.1 Resource Type Abstraction
Introduce `ResourceType` union and `ResourceRates` map aligned with existing `Record<string, number>` patterns:

```ts
export type ResourceType = 'credits' | 'rawmaterials' | 'research' | 'energy';
export type ResourceRates = Partial<Record<ResourceType, number>>;
```

Energy is included in `ResourceRates` for calculation convenience but is NOT a stock resource.

### 3.2 Building Data Structure
Add `production` and `consumption` fields to building definitions in `planet-data.json`. Preserve existing `energyConsumption`/`energyProduction` for backward compatibility; EconomyService reads `production`/`consumption` first, falls back to old fields.

**Values adapted to existing game design:**
- Solar Array: `production: { "energy": 40 }` (was energyProduction: 40)
- Fusion Power Plant: `production: { "energy": 100 }` (was energyProduction: 100)
- Mining Complex: `production: { "rawmaterials": 5 }`, `consumption: { "energy": 20 }` (was energyConsumption: 20)
- Industrial Factory: `production: { "rawmaterials": 10 }`, `consumption: { "energy": 30 }` (was energyConsumption: 30)
- Research Laboratory: `production: { "research": 5 }`, `consumption: { "energy": 25 }` (was energyConsumption: 25)
- Defense/social/housing: `consumption: { "energy": <existing energyConsumption value> }`

### 3.3 Planet Economy Calculation
Add pure calculation method:

```ts
calculatePlanetEconomy(planet: PlanetTile): PlanetEconomy
```

Returns non-mutating `PlanetEconomy` with `production`, `consumption`, `net`, `energyProduction`, `energyConsumption`, `energyBalance`, `efficiency`.

**Population → credits integration:** Include `population * 0.1` as a credits production source in `calculatePlanetEconomy`. This satisfies "structure the system so that population-based production can be represented as another production source later" without implementing population growth.

### 3.4 Energy Efficiency Rule
Simple deterministic formula:
- `energyProduction >= energyConsumption` → `efficiency = 1.0`
- `energyProduction < energyConsumption` → `efficiency = energyProduction / energyConsumption` (range 0–1)

All non-energy production/consumption rates are multiplied by `efficiency`. Energy itself is not scaled by efficiency.

### 3.5 Faction Economy Aggregation
`calculateEconomy()` remains the entry point but returns an extended `EconomyBreakdown` that includes new resource-level aggregates. Existing fields (`incomePerSecond`, `expensePerSecond`, `netPerSecond`) are preserved for backward compatibility and represent the credits component of the new system.

### 3.6 Delta-Time Application
`applyEconomyDelta()` applies all stock resources over `deltaTime`:

```ts
for each resource in ['credits', 'rawmaterials', 'research']:
  netRate = planetEconomy.net[resource] * efficiency
  faction.currencies[resource] += netRate * deltaTime
```

Energy is NOT accumulated. Only stocks change.

### 3.7 Backward Compatibility
- Old saves without new fields load fine: `production`/`consumption` default to `{}`, fallback to `energyConsumption`/`energyProduction` if present.
- Buildings without `production`/`consumption` contribute 0.
- Existing `getEnergyForPlanet()` and `getTaxForPlanet()` are updated to read from building definitions via economy service, preserving display behavior.

---

## 4. Files to Change

| File | Change |
|------|--------|
| `src/app/components/star-map/planet-data.json` | Add `production`/`consumption` to all building definitions. Keep old energy fields. |
| `src/app/components/star-map/star-map.models.ts` | Add `ResourceType`, `ResourceRates`, `PlanetEconomy`, update `EconomyBreakdown`. |
| `src/app/services/economy.service.ts` | Major refactor: add `calculatePlanetEconomy()`, extend `calculateEconomy()`, extend `applyEconomyDelta()`. Generic iteration over production/consumption maps. |
| `src/app/components/star-map/star-map.ts` | Update `getEnergyForPlanet()` and `getTaxForPlanet()` to use economy service. Pass new planet economy data to UI. |
| `src/app/components/star-map/star-map-planet-info/star-map-planet-info.component.ts` | Add economy input. |
| `src/app/components/star-map/star-map-planet-info/star-map-planet-info.component.html` | Show economy section. |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts` | Add economy input. |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html` | Show economy section in sidebar. |
| `src/app/components/star-map/faction-currencies/faction-currencies.component.ts` | Add resource rates display. |
| `src/app/components/star-map/faction-currencies/faction-currencies.component.html` | Show all resource rates, not just credits. |

---

## 5. Implementation Steps (Ordered)

1. **Add types to `star-map.models.ts`** — `ResourceType`, `ResourceRates`, `PlanetEconomy`, extend `EconomyBreakdown` and `PlanetEconomyEntry`/`BuildingEconomyEntry`.

2. **Update `planet-data.json`** — Add `production` and `consumption` to all 13 building definitions. Preserve old `energyConsumption`/`energyProduction`.

3. **Refactor `economy.service.ts`**:
   - Build `buildingStats` map with new `production`/`consumption` fields.
   - Add `calculatePlanetEconomy(planet): PlanetEconomy` — pure, no mutation.
   - Add helper `getPlanetEnergy(planet)` for backward-compatible energy reads.
   - Update `calculateEconomy()` to aggregate per-planet economies into extended `EconomyBreakdown`.
   - Update `applyEconomyDelta()` to apply all stock resources using `efficiency`.

4. **Update `star-map.ts`**:
   - Replace hardcoded `getEnergyForPlanet` with economy-based lookup.
   - Replace hardcoded `getTaxForPlanet` with economy-based lookup.
   - Add `getPlanetEconomy()` bound method.
   - Update template bindings to pass economy data to child components.

5. **Update planet info component** — Add `planetEconomy` input, render economy section.

6. **Update planet screen component** — Add `planetEconomy` input, render economy section in sidebar.

7. **Update faction currencies component** — Display per-resource production/consumption/net rates in overlay.

8. **Verify save/load** — No changes needed; economy is recalculated from state.

---

## 6. Verification Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Planet with 2 Mining Complex | +10 rawmaterials/s |
| 2 | Solar Array (+10) + Mining Complex (-2) + Research Lab (-3) | energy production: 10, consumption: 5, balance: +5 |
| 3 | Energy production 5, consumption 10 | efficiency = 0.5, production halved |
| 4 | +5 rawmaterials/s over 2s | +10 rawmaterials accumulated |
| 5 | Multiple planets | Independent updates per planet |
| 6 | Existing save loads | No errors, missing fields default to 0 |

---

## 7. Out of Scope (Explicitly)
- Population growth
- Food system
- Morale/technology/morale bonuses
- Research spending
- Colonization, fog of war, AI economy, diplomacy, trade
- Advanced energy prioritization
- Combat/fleet changes
- Random events

---

## 8. Architectural Concerns / Next Steps

1. **Building definition vs instance**: Currently `PlanetBuilding` instances don't carry `id`. The economy service resolves definitions by `name`. If buildings ever need upgrades/levels, adding `buildingId` to instances would be cleaner than name-based lookup.

2. **Population as production source**: Currently hardcoded as `pop * 0.1`. The new system treats it as a planet-level production entry. Future population growth should modify `planet.population`, and the economy will automatically adjust.

3. **Energy as non-stock**: This is an intentional simplification. If future designs need energy storage (batteries, etc.), the `ResourceType` union already supports adding it as a stock.

4. **Fleet maintenance in credits**: Fleet expenses remain credits-only in this iteration. The `EconomyBreakdown.fleetExpenses` is preserved unchanged.

5. **UI styling**: Changes follow existing panel/SCSS patterns. No new screens or redesigns.

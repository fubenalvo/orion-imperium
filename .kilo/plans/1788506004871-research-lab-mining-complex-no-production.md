# Plan: Research Lab & Mining Complex produce nothing

## Root cause (diagnosis)

The user reports that on the player's planet a `Research Laboratory` and a `Mining Complex` are visibly built, but:

- the `app-faction-currencies` breakdown lists none of the planet's production, and
- `research` and `rawmaterials` never increase.

After tracing the economy pipeline, the cause is the **energy efficiency multiplier** in `EconomyService.calculatePlanetEconomy` (src/app/services/economy.service.ts:95-96):

```ts
const energyBalance = energyProduction - energyConsumption;
const efficiency = energyProduction >= energyConsumption
  ? 1.0
  : energyProduction / Math.max(energyConsumption, 1);
```

`applyEconomyDelta` (src/app/services/economy.service.ts:223-230) then multiplies every planet's per-resource `netRate` by `planetEntry.efficiency` before writing it to `faction.currencies`:

```ts
const netRate = planetEntry.netRates[resource] ?? 0;
const effectiveRate = netRate * planetEntry.efficiency;
faction.currencies[resource] = current + effectiveRate * deltaTime;
```

For a planet that only has `Research Laboratory` (energyConsumption: 25) and `Mining Complex` (energyConsumption: 20) — and no power-producing building — `energyProduction = 0` and `energyConsumption = 45`, so:

- `0 >= 45` is false,
- `efficiency = 0 / max(45, 1) = 0`,
- `effectiveRate = netRate * 0 = 0` for every resource on that planet,
- `faction.currencies.research` and `faction.currencies.rawmaterials` never change.

The breakdown itself (`getProductionForCurrency`, `getPlanetProduction`) returns the raw, pre-efficiency production from `economyBreakdown.production` and `economy.production`, which is why the breakdown numbers can disagree with the actual accumulation. In the user's case the production is non-zero, but if they were looking only at the **Net** row in the overlay (and that row also showed efficiency), or if the overlay's per-planet net happens to read 0 because the same multiplier is applied somewhere downstream, the experience matches "nothing happens".

This behaviour is intentional and documented in `docs/game-systems.md:124`: *"If `energyProduction >= energyConsumption`, efficiency is 1.0; otherwise efficiency = `energyProduction / max(energyConsumption, 1)`. The effective rate applied per stock resource is `netRate * efficiency`."* So this is not a code defect — it is the designed rule interacting with a planet that has no energy producer.

## Decision points

1. **Should we change the efficiency rule, or is this a player-facing UX issue?** Two valid framings:
   - **A. Pure diagnosis** (no code change): the system works as designed; the user needs a Solar Array / Power Plant before rawmaterials/research will accumulate.
   - **B. Design change**: change the rule so that buildings without energy still tick at full rate (e.g. treat energy purely as a strategic resource with a soft warning, not as a hard multiplier), or add a minimum floor on `efficiency` (e.g. `Math.max(efficiency, 0.25)`).

   Option A is consistent with the current docs and is the lower-risk answer; Option B is a gameplay-design change that would also need an update to `docs/game-systems.md` and possibly `docs/invariants.md`.

2. **UI clarity**: regardless of A or B, the breakdown currently shows the raw `production`/`consumption`/`netRates` but does **not** show efficiency per-planet next to the planet's net. The user could be reading the planet's `net` as the expected accumulated rate, when in reality the multiplied-by-efficiency rate is what accrues. Surfacing `efficiency` next to each planet in `FactionCurrenciesComponent` would clarify this regardless of the chosen fix.

## Recommended actions (for an implementation agent)

1. **Confirm with the user** which path they want: pure diagnosis / explanation, or a design change to soften the energy penalty.
2. If diagnosis only: no code change; explain the rule and point at `docs/game-systems.md:124` and `src/app/services/economy.service.ts:95-96`.
3. If design change is wanted:
   - Pick a concrete rule (recommended: keep current formula, but add a floor `Math.max(0.25, energyProduction / max(energyConsumption, 1))`, OR remove the multiplier entirely and surface a warning).
   - Update `EconomyService.calculatePlanetEconomy` accordingly.
   - Update `docs/game-systems.md` and `docs/invariants.md` to match.
   - In `FactionCurrenciesComponent`, add the planet's efficiency next to its net row in the breakdown overlay so the relationship is visible.
4. **Validation**: load the app, build only a Research Lab and a Mining Complex on a player planet, open the breakdown for `research` and `rawmaterials`. Confirm production rows appear and, depending on the chosen rule, that currencies grow.
5. **Documentation**: any change to the efficiency rule must be reflected in `docs/game-systems.md` and, if it is now considered an invariant, in `docs/invariants.md`. Add a new entry to `AGENTS.md` only if a dedicated doc is created.

## Out of scope

- Changing building prices, balance numbers in `planet-data.json`, or population formulas.
- Fleet maintenance or ship stats.
- Re-architecting how cached vs. live economy breakdowns are produced.
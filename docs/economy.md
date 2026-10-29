# Economy

The faction economy: what resources are produced, what everything costs, how upkeep is charged, and the rules the AI follows to stay solvent. Player and AI use exactly the same rules and code paths.

Related: [Ship Production](./ship-production.md) (queue, stock, fleet assembly), [AI Pipeline](./ai-pipeline.md) (AI economy manager), [Game Time](./game-time.md) (scaled delta), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Building output, energy, workforce, morale, upkeep points, price, raw cost | `src/app/components/star-map/planet-data.json` |
| Ship cost, raw cost, upkeep points | `src/app/components/star-map/ship-data.json` |
| Research costs | `src/app/components/star-map/research-tree.json` |
| Income, upkeep, administration, arrears, the economy tick | `EconomyService` (`src/app/services/economy.service.ts`) |
| Purchase rules (afford / pay / refund) | `src/app/services/resource-cost.ts` |
| Ship order charging and refunds | `ProductionService` |
| AI spending policy | `EnemyEconomyService` |

## Resources

- **Credits** (stock, integer): population income minus upkeep. Spent on buildings and ships.
- **Raw materials** (stock): Spaceship Factory 6/s, Mining Complex 15/s (needs an ore tile; ~20% of planets have one), plus a population trickle of `0.002 × population`/s. Building output scales with workforce efficiency; the trickle does not. Spent on buildings and ships.
- **Research** (stock): research labs. Spent only on technologies.
- **Energy** (flow, never stored): an energy-short planet produces at `production / consumption` efficiency and loses 1 satisfaction/s.
- **Population**: capped by housing; `0.1 credits/s` per inhabitant at 100% satisfaction.

## The economy tick

`StarMap.gameLoopCallback` accumulates scaled game delta and, once ≥ 1 s has accumulated, calls `EconomyService.applyEconomyDelta` once per faction with the accumulated delta. This is the **only** place income and upkeep are applied, so costs are charged exactly once per tick and are frame-rate independent (many small ticks ≈ one large tick, within integer rounding). A paused game (delta 0) changes nothing. The headless simulation harness (`ai-simulation.spec.ts`) mirrors this loop.

Order within one tick (per faction):

1. **Satisfaction drift** on owned planets (+1/s with enough energy, −1/s when short, plus habitability and building morale). A planet reaching 0 rebels to `independent` *before* income is computed, so it neither pays nor costs its old owner on that tick.
2. **Effective breakdown** (`calculateEconomy`) from the post-drift state; `net[r] × delta` is applied to raw materials and research.
3. **Credits**: `credits + carried fraction + netPerSecond × delta`, floored; the fractional remainder is carried per faction in memory (not saved — at most one credit is lost on reload).
4. **Arrears**: credits never go below 0. If the treasury cannot cover the upkeep, the unpaid part is waived and every owned planet loses `2 × (unpaid / due)` satisfaction per second. A small shortfall is outweighed by the +1/s energy drift; a large one leads toward rebellion unless income recovers or upkeep is cut (disbanding a fleet moves its ships to the cheaper reserve).
5. **Population growth.**

## Effective rates (what the HUD shows)

`calculateEconomy` returns effective per-second rates; the HUD (`FactionCurrenciesComponent`) and the planet screen show these numbers, and the tick applies exactly them:

- planet credit income = `pop × 0.1 × energy efficiency × satisfaction/100 × AI difficulty multiplier`
- raw/research production = `building output (workforce-scaled) × energy efficiency × AI difficulty multiplier` (+ the population raw trickle)
- `expensePerSecond` = building upkeep + colony administration + ship upkeep
- `netPerSecond = incomePerSecond − expensePerSecond`; `net['credits']` is the same number

The AI difficulty multiplier (`ai-difficulty.ts`) scales production only, never costs, and is 1 for the human.

## Upkeep

`maintenanceCost` in the data files is in **upkeep points per second**; one point costs `UPKEEP_CREDITS_PER_POINT = 0.3` credits/s (the single upkeep tuning knob).

- **Buildings**: every building instance on an owned planet.
- **Fleet ships**: every non-destroyed ship in a non-destroyed fleet of the faction.
- **Reserve ships** (faction ship stock): `RESERVE_SHIP_UPKEEP_FACTOR = 0.5` of the fleet rate — mothballed, but not free, so the stock is not an upkeep loophole.
- **Colony administration**: every owned planet beyond the first adds `3%` of each planet's credit income as an expense, capped at `45%` (`administrationShare`). A fresh colony raises the share on the whole empire before its own income grows, so over-expansion costs real money, while total income can never turn negative from administration alone.

Ownership changes, destruction, fleet creation/disbanding and production completion need no bookkeeping: upkeep is recomputed from the current state on every tick.

Reference homeworld at game start (1400 pop, 2 Large Residential, Fusion Plant, Laser Turret, Research Lab, starting fleet of 2 frigates + 3 cruisers): income 140/s, building upkeep 32.7/s, fleet upkeep 21/s, net ≈ 86/s.

## Prices

Buildings (credits / raw materials):

| Role | Building | Price |
| --- | --- | --- |
| Housing | Small / Medium / Large Residential | 400/50, 1200/150, 3000/400 |
| Power | Solar Array / Fusion Power Plant | 600/100, 2500/400 |
| Research | Small Research Laboratory / Research Laboratory | 1000/100, 3000/300 |
| Industry | Mining Complex / Spaceship Factory | 1500/100, 3000/400 |
| Military | Spaceport | 4000/600 |
| Defense | Laser / Missile Turret / Planetary Shield | 800/150, 1000/200, 3500/600 |
| Social | Central Park / School / Hospital / Entertainment Center | 800/50, 1500/150, 2000/200, 3000/250 |

Rationale: early basics (housing, solar, turret) cost a few seconds to a minute of starting net income; core infrastructure (factory, Spaceport) costs about a minute each; large/specialised buildings cost several minutes. Every building also adds permanent upkeep, so a building is a trade-off against warships and expansion.

Ships keep their credit `cost`; `rawMaterialCost` is 50% of it (rounded to 5), colonizer 100 credits / 150 raw. Build time is unchanged (`cost × 0.1 / factory power`).

Research costs in `research-tree.json` are 5× the original values (whole tree: 35,375 points), so the tree takes roughly 30–40 minutes of AI play instead of ~3.5 minutes.

## Purchases

All purchases go through `resource-cost.ts` (`buildingCost`, `shipCost`, `canAffordCost`, `payCost`, `refundCost`). `payCost` is all-or-nothing: it checks credits and raw materials before deducting either, so a failed purchase changes nothing and a balance never goes negative through a purchase.

- **Buildings** (`StarMap.onBuildingConfirmed`, `EnemyEconomyService.tryConstruct`): paid in full when placed; there is no construction time and no refund.
- **Ships** (`ProductionService.queueOrder`): paid in full at queue time; the charge is recorded on the order as `paid`. Completion moves ships to the stock for free, and assembling or reinforcing fleets from the stock never charges. Cancel and every auto-cancel (factory lost, planet lost or captured, unknown type) refund the un-built fraction of `paid` (rounded), so a refund can never exceed the charge.

## AI spending policy (summary)

Full details in [AI Pipeline](./ai-pipeline.md#ai-economy-manager-enemyeconomyservice). The AI uses the same costs and the same `EconomyService` numbers as the HUD:

- **Reserve**: optional purchases leave credits and raw materials for committed needs (next colonizer, a missing factory or Spaceport — only while net income is positive — and the next warship).
- **Upkeep headroom**: a purchase's upkeep must fit the projected net (current net minus queued ships' upkeep): emergency power — always; core (housing, factory, Spaceport) — net ≥ 0, or a deficit the treasury can carry for 300 s; warships — leave `10% / personality military preference` of gross income; optional buildings — leave 25%. The gap keeps ~15% of income structurally available for warship upkeep.
- **Military target** includes the strength that 12% of gross income can sustain in upkeep, so the navy scales with the economy.
- **Space**: while a factory or Spaceport is missing, no other building may take the last room for it.
- **Raw materials**: a Mining Complex is built on an ore planet while raw income is below 15/s.

## Save compatibility

No save-format change. Missing `rawmaterials`/`research` read as 0. Production orders without `paid` (written before this economy) are treated as credits-only (`ship cost × quantity`), so cancelling them refunds credits only; a malformed `paid` falls back to the same rule. Loading never charges, refunds or re-applies upkeep: everything is derived from the saved state, and the economy accumulator restarts at 0.

## Construction time (not implemented)

Buildings complete instantly. Adding construction time would need: a persistent per-building state (e.g. `constructionRemaining`), skipping unfinished buildings in `EconomyService.calculatePlanetEconomy`, `ProductionService` capacity, `SpaceportService` and AI counting (the AI must count them as planned to avoid double-building), save validation/defaults for the new field, planet-screen rendering, and a decision on refunds when a planet changes hands mid-construction.

## Known limitations

- The fractional credit carry is in memory (≤ 1 credit lost per load).
- Late-game AI factions still accumulate a credit surplus (~100–200k after 30 minutes) because planet surfaces fill up and warship counts are capped; the next sink would be construction time, building upgrades or larger military caps.
- An energy-short planet earns nothing; a faction whose only planet is energy-short with less than a Solar Array's price (600) cannot recover.

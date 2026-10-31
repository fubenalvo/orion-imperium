# Economy

The faction economy: the three resources (credits, raw materials, research points), finite raw-material deposits, what everything costs, how upkeep is charged, and the rules the AI follows to stay solvent. Player and AI use exactly the same rules and code paths.

Design goal: raw materials come only from **finite deposits** on planets and asteroids, and warships are mostly raw materials, so an empire's deposits run dry over time and expansion (new colonies, asteroid mining) becomes an economic necessity rather than an arbitrary bonus.

Related: [Ship Production](./ship-production.md) (queue, stock, fleet assembly), [AI Pipeline](./ai-pipeline.md) (AI economy manager, AI asteroid mining), [Research](./research.md) (research prices), [Territory](./territory.md#mining-stations) (mining stations), [Game Time](./game-time.md) (scaled delta), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Building output, energy, workforce, morale, upkeep points, price, raw cost | `src/app/components/star-map/planet-data.json` |
| Ship cost, raw cost, upkeep points | `src/app/components/star-map/ship-data.json` |
| Research costs (research points; the credit part is derived) | `src/app/components/star-map/research-tree.json`, `RESEARCH_CREDITS_PER_POINT` in `research.service.ts` |
| Planet deposit sizes and richness, deposit status, raw-supply outlook | `raw-deposits.ts` (`PLANET_DEPOSIT_CONFIG`, `RAW_OUTLOOK_CONFIG`) |
| Asteroid deposit sizes and extraction rates | `system-asteroids.ts` (`SYSTEM_ASTEROID_CONFIG`) |
| Asteroid station extraction | `mining-station.ts` |
| Income, upkeep, administration, arrears, the economy tick | `EconomyService` (`src/app/services/economy.service.ts`) |
| Purchase rules (afford / pay / refund) | `src/app/services/resource-cost.ts` |
| Ship order charging and refunds | `ProductionService` |
| AI spending policy | `EnemyEconomyService` |

## Resources

- **Credits** (stock, integer): population income minus upkeep. The universal currency: buildings (mostly), research (together with research points), the credit part of ships, and all upkeep.
- **Raw materials** (stock): the physical industrial resource. Produced only by extracting **finite deposits** ([Finite deposits](#finite-deposits)) — a Mining Complex on a planet deposit (15/s × deposit richness, workforce- and energy-scaled) and asteroid mining stations (each asteroid's own rate) — plus a small population trickle of `0.002 × population`/s, the one never-depleting source ([Economic safety](#economic-safety)). The Spaceship Factory produces no raw materials. Spent mostly on ships, partly on buildings.
- **Research** (stock): research points from research labs (unchanged). Spent only on technologies, always together with credits ([Research](./research.md)).
- **One-off windfalls:** collecting a drifting asteroid adds its cargo (raw materials and/or research points) directly to the collecting faction's stock, outside the economy tick. See [Star Map Terrain](./star-map-terrain.md#drifting-asteroids).
- **Energy** (flow, never stored): every owned planet has a colony core (+10) plus its power buildings. An energy-short planet produces at `production / consumption` efficiency, and the shortfall lowers its satisfaction drift in proportion ([Energy and satisfaction](#energy-and-satisfaction)).
- **Population**: capped by housing; `0.1 credits/s` per inhabitant at 100% satisfaction.

## Finite deposits

Every raw-material source except the population trickle is a deposit with a fixed original size. Mining only ever reduces it; nothing refills it.

| | Planet deposit | Asteroid deposit |
| --- | --- | --- |
| Where it lives | `PlanetTile.rawDeposit = { total, remaining, richness }`, present exactly when the planet has deposit tiles (`resourceTiles`) | `SystemAsteroid.totalRawMaterials` (original), `rawMaterials` (remaining), `extractionRate` |
| Size | by planet size: tiny 20k, small 28k, medium 40k, big 52k, huge 64k, ±20% | 3,000–7,000 (one asteroid in ten holds one; version-1 belts 2,000–4,000) |
| Extraction | Mining Complex: 15/s × richness (0.8–1.25) × workforce × energy efficiency × technology × gain multiplier; a second mine on the same deposit empties it twice as fast | station: the asteroid's `extractionRate` (3–8/s) × gain multiplier |
| Lifetime of one mine / station | ~15–100 minutes (a medium planet ~45) | ~6–40 minutes |
| Who may mine | the planet's owner (mines are buildings) | the station's owner; stations need a deposit the faction surveyed itself |

Planets hold large, slow reserves; asteroids small ones at varied speeds. Values are data-driven (`PLANET_DEPOSIT_CONFIG`, `SYSTEM_ASTEROID_CONFIG`) and generated deterministically (planet id; galaxy seed + system + cell), so a deposit always belongs to its celestial body and survives ownership changes.

**Depletion.** When `remaining` reaches 0 the deposit is depleted for good: the economy tick extracts nothing more, the mine or station stays (with its upkeep) but is idle, the planet screen, planet info panel and asteroid hover card say DEPLETED, and the player gets a map notice for each of their deposits that runs dry during a tick (`minedDepositsOf`). A Mining Complex cannot be placed on a depleted deposit (player planet screen and AI placement). Depleted deposits stay part of the world and of the save.

**Status vocabulary** (`raw-deposits.ts`): `unmined` (deposit, no mine/station), `active` (being mined), `depleted`, `none`. The UI shows remaining / total, the extracted percentage, the current mining rate and (planet screen) the time until empty.

## Economic safety

Deposits run out, so the economy guarantees a way back:

- **Starting deposit:** every homeworld is generated with a deposit (`GalaxyGenerator` gives it deposit tiles; `ensurePlanetResources` keeps existing tiles), so no empire depends on luck for its first mine.
- **Starting stock:** 2,500 raw materials (× AI difficulty start multiplier) — the first Spaceship Factory (750) and Mining Complex (375) with room for a Spaceport.
- **Emergency floor:** the population trickle (`POPULATION_RAW_RATE`, 2.8/s on a full homeworld) never depletes. It is deliberately small; it lets an empire whose deposits are all gone still afford a Mining Complex on a new colony or an outpost ship (500 raw) within minutes, but it cannot sustain a fleet.
- **Windfalls:** drifting asteroids still carry one-off raw cargo ([Star Map Terrain](./star-map-terrain.md#drifting-asteroids)).
- **New sources:** ~20% of all planets carry a deposit, and every system's asteroid belt holds at least one, so expansion always has targets. There is no regeneration and no ship scrapping; recovery is by expansion.

## Energy and satisfaction

Energy decides two things on a planet: production efficiency and the energy part of the satisfaction drift. Both come from `EconomyService.calculatePlanetEconomy`.

- **Colony core:** every planet owned by a faction (not unowned, not `independent`) gets `COLONY_CORE_ENERGY` = 10 energy on top of its power buildings. It is flat (energy technologies scale only power buildings). It lets a new colony run its first housing blocks (3–12 energy each) before a Solar Array, and gives the homeworld (100 from its Fusion Power Plant) room for the usual first Mining Complex + Spaceship Factory.
- **Efficiency:** `1` when production ≥ consumption, otherwise `production / consumption`. All building output and credit income are multiplied by it.
- **Energy drift** (`energySatisfactionDrift`): `1 − 4 × shortfall`, at least `−1`, where `shortfall = 1 − efficiency`. Fully powered → +1/s; 4% short → +0.84/s; 25% short → 0; 50% or more short → −1/s. A small overshoot costs output but no longer leads to rebellion; a severe shortage still does (from 100% in ~100 s).
- **Total drift** (`PlanetEconomy.satisfactionDrift`) = energy drift + habitability + building morale. The economy tick applies it (arrears come on top, see below).

**Player feedback** (all derived, nothing saved):

- Planet screen: the satisfaction figure shows the drift per second; a red alert appears while the planet is short on energy (with the output loss) or while satisfaction is falling (with the estimated seconds to rebellion).
- Build list: each building shows its energy use or output (`EN`), red when building it would leave the planet short; the tooltip and the placement panel show the planet's energy after building. The preview uses the listed values, so it slightly understates a power building's output under energy technologies.
- Map notices (`planet-stability.ts`, from snapshots taken right before and after each economy tick): a player planet newly short on energy (once, again only after it recovered), satisfaction falling through 50% and 20%, and a planet lost to rebellion.

## The economy tick

`StarMap.gameLoopCallback` accumulates scaled game delta and, once ≥ 1 s has accumulated, calls `EconomyService.applyEconomyDelta` once per faction with the accumulated delta. This is the **only** place income and upkeep are applied, so costs are charged exactly once per tick and are frame-rate independent (many small ticks ≈ one large tick, within integer rounding). A paused game (delta 0) changes nothing. The headless simulation harness (`ai-simulation.spec.ts`) mirrors this loop.

Order within one tick (per faction):

1. **Satisfaction drift** on owned planets (the energy drift from [Energy and satisfaction](#energy-and-satisfaction), plus habitability and building morale). A planet reaching 0 rebels to `independent` *before* income is computed, so it neither pays nor costs its old owner on that tick.
2. **Effective breakdown** (`calculateEconomy`) from the post-drift state; `net[r] × delta` is applied to raw materials and research, except that deposit mining (planet mines and asteroid stations, `depositMiningPerSecond`) adds what it actually extracted from each deposit this tick (each capped by what is left, and subtracted from it) instead of its nominal rate.
3. **Credits**: `credits + carried fraction + netPerSecond × delta`, floored; the fractional remainder is carried per faction in memory (not saved — at most one credit is lost on reload).
4. **Arrears**: credits never go below 0. If the treasury cannot cover the upkeep, the unpaid part is waived and every owned planet loses `2 × (unpaid / due)` satisfaction per second. A small shortfall is outweighed by a positive energy drift; a large one leads toward rebellion unless income recovers or upkeep is cut (disbanding a fleet moves its ships to the cheaper reserve).
5. **Population growth.**

## Effective rates (what the HUD shows)

`calculateEconomy` returns effective per-second rates; the HUD (`FactionCurrenciesComponent`) and the planet screen show these numbers, and the tick applies exactly them:

- planet credit income = `pop × 0.1 × energy efficiency × satisfaction/100 × AI difficulty multiplier`
- raw/research production = `building output (workforce-scaled) × energy efficiency × AI difficulty multiplier` (+ the population raw trickle); a mine's raw output is also × deposit richness, and 0 once its deposit is depleted
- `depositMiningPerSecond` = the deposit-mining part of raw production (planet mines + stations); the HUD's raw breakdown shows it next to the population trickle
- `expensePerSecond` = building upkeep + colony administration + ship upkeep
- `netPerSecond = incomePerSecond − expensePerSecond`; `net['credits']` is the same number

The AI difficulty multiplier (`ai-difficulty.ts`) scales production only, never costs, and is 1 for the human. War exhaustion above 25 reduces the same gains linearly down to −30% at 100 for the human and the AI alike (`gainMultiplier` = difficulty × (1 − exhaustion penalty); see [Diplomacy](./diplomacy.md#war-exhaustion)). Peace treaties move credits and raw materials between factions outside the economy tick ([Diplomacy](./diplomacy.md#peace-treaties-peace-treatyts)), and so do paid credit demands at peace ([Financial demands](./diplomacy.md#financial-demands-and-ultimatums)). Both go through the one atomic transfer (`resource-transfer.ts` `transferResources`): every amount is checked against the giver's whole-unit stock first, and either all of it moves or nothing does, so diplomacy can never make credits negative. An AI never pays a demand out of its spending reserve (`EnemyEconomyService.getSpendingReserve`) and never more than 60% of its credits; an AI's own demand never asks for more than half of the target's credits.

## Upkeep

`maintenanceCost` in the data files is in **upkeep points per second**; one point costs `UPKEEP_CREDITS_PER_POINT = 0.3` credits/s (the single upkeep tuning knob).

- **Buildings**: every building instance on an owned planet.
- **Fleet ships**: every non-destroyed ship in a non-destroyed fleet of the faction.
- **Reserve ships** (faction ship stock): `RESERVE_SHIP_UPKEEP_FACTOR = 0.5` of the fleet rate — mothballed, but not free, so the stock is not an upkeep loophole.
- **Colony administration**: every owned planet beyond the first adds `3%` of each planet's credit income as an expense, capped at `45%` (`administrationShare`). A fresh colony raises the share on the whole empire before its own income grows, so over-expansion costs real money, while total income can never turn negative from administration alone.

Ownership changes, destruction, fleet creation/disbanding and production completion need no bookkeeping: upkeep is recomputed from the current state on every tick.

Reference homeworld at game start (1400 pop, 2 Large Residential, Fusion Plant, Laser Turret, Research Lab, starting fleet of 2 frigates + 3 cruisers): income 140/s, building upkeep 32.7/s, fleet upkeep 21/s, net ≈ 86/s.

## Prices

Cost structure (nominal amounts; all values in the data files):

| Activity | Credits | Raw materials | Research points |
| --- | --- | --- | --- |
| Warships | ~25% | ~75% (raw = 3 × credits) | — |
| Buildings | ~80% | ~20% (raw = 25% of the credit price) | — |
| Research | 2 × the RP cost | — | the technology's cost |
| Ship / building upkeep | per second | — | — |
| Colonizer | 1,200 (high) | 400 (moderate) | — |
| Outpost ship (mining infrastructure) | 600 | 500 | — |
| Mining Complex (mining infrastructure) | 1,500 | 375 | — |
| Ship repair | free: docking at a Spaceport restores ships ([Fleet Organization](./fleet-organization.md)) | — | — |

Buildings (credits / raw materials):

| Role | Building | Price |
| --- | --- | --- |
| Housing | Small / Medium / Large Residential | 400/100, 1200/300, 3000/750 |
| Power | Solar Array / Fusion Power Plant | 600/150, 2500/625 |
| Research | Small Research Laboratory / Research Laboratory | 1000/250, 3000/750 |
| Industry | Mining Complex / Spaceship Factory | 1500/375, 3000/750 |
| Military | Spaceport | 4000/1000 |
| Defense | Laser / Missile Turret / Planetary Shield | 800/200, 1000/250, 3500/875 |
| Social | Central Park / School / Hospital / Entertainment Center | 800/200, 1500/375, 2000/500, 3000/750 |

Ships (credits / raw materials): Scout 50/150, Fighter 75/225, Corvette 120/360, Frigate 180/540, Destroyer 260/780, Cruiser 400/1,200, Carrier 500/1,500, Battleship 700/2,100, Battlecruiser 750/2,250, Dreadnought 1,200/3,600.

Rationale: early basics (housing, solar, turret) cost a few seconds to a minute of starting net income; core infrastructure (factory, Spaceport) costs about a minute each; large/specialised buildings cost several minutes. Every building also adds permanent upkeep, so a building is a trade-off against warships and expansion. Warships keep their credit `cost` because it also sets build time (`cost × 0.1 / factory power`) and is the ship's "value" for war losses and border penalties; their weight moved to raw materials, so one mine (~15/s) pays for a cruiser in about 80 seconds and a large fleet needs several deposits. The colonizer and outpost ship carry an explicit `buildTime` (10 s and 35 s, as before) because their credit price rose.

Research prices (research points from the tree, scaled by technologies already researched, plus `RESEARCH_CREDITS_PER_POINT` = 2 credits per point) are described in [Research](./research.md). Technology bonuses change several economy rates (energy, raw and research output, building and ship upkeep, population growth); `EconomyService` applies them through `ResearchService.getModifiers` for the owning faction, so the HUD, the economy tick and the AI see the same numbers.

## Purchases

All building and ship purchases go through `resource-cost.ts` (`buildingCost`, `shipCost`, `canAffordCost`, `payCost`, `refundCost`). `payCost` is all-or-nothing: it checks credits and raw materials before deducting either, so a failed purchase changes nothing and a balance never goes negative through a purchase. Research is paid by `ResearchService.researchTechnology` with the same all-or-nothing rule over research points and credits.

- **Buildings** (`StarMap.onBuildingConfirmed`, `EnemyEconomyService.tryConstruct`): paid in full when placed; there is no construction time and no refund. The planet screen shows both prices and marks the part the player cannot pay; a mine on a planet without a live deposit shows NO DEPOSIT / DEPLETED instead.
- **Ships** (`ProductionService.queueOrder`): paid in full at queue time; the charge is recorded on the order as `paid`. Completion moves ships to the stock for free, and assembling or reinforcing fleets from the stock never charges. Cancel and every auto-cancel (factory lost, planet lost or captured, unknown type) refund the un-built fraction of `paid` (rounded), so a refund can never exceed the charge.

## AI spending policy (summary)

Full details in [AI Pipeline](./ai-pipeline.md#ai-economy-manager-enemyeconomyservice). The AI uses the same costs and the same `EconomyService` numbers as the HUD:

- **Reserve**: optional purchases leave credits and raw materials for committed needs: next colonizer, a missing factory or Spaceport (only while net income is positive), the first housing of every colony, the first mine on an unmined live deposit, the credits of a technology whose research points are already banked, and the next warship.
- **Upkeep headroom**: a purchase's upkeep must fit the projected net (current net minus queued ships' upkeep): emergency power — always; core (housing, factory, Spaceport) — net ≥ 0, or a deficit the treasury can carry for 300 s; warships — leave `10% / personality military preference` of gross income; optional buildings — leave 25%. The gap keeps ~15% of income structurally available for warship upkeep.
- **Military target** includes the strength that 12% of gross income can sustain in upkeep, so the navy scales with the economy.
- **Space**: while a factory, a Spaceport or the first mine on a live deposit is missing, no other building may take the last room for it.
- **Raw materials**: every owned planet with a live deposit gets a Mining Complex (never a depleted one); while raw materials are the binding constraint (`isRawConstrained`: credits for two preferred warships but not their raw materials) a large deposit gets a second one and no extra factories are built. Warships save for the preferred hull when income covers the gap within 90 s instead of buying the cheapest hull.
- **Research**: when the labs are too slow (the most expensive available technology's RP is more than 180 s away while its credits are there) research buildings move first and ignore the warship part of the reserve.
- **Expansion and asteroid mining**: colony targets are valued by their deposits in proportion to raw-supply pressure, and an outpost ship is sent to survey and mine asteroid belts when the faction's mining is about to run dry ([AI Pipeline](./ai-pipeline.md#asteroid-mining-enemyminingservice)).

## Save compatibility

No save version bump; every new field is optional and filled on load (`SaveGameService.migrateSave` and `StarMap.ensureResourceTiles`, both idempotent):

- `PlanetTile.rawDeposit`: planets with deposit tiles but no reserve (saves from before finite deposits) get their deterministic deposit, full. Saved reserves — partly mined or depleted — are kept exactly; a malformed one is regenerated. Planets without tiles never have one.
- `SystemAsteroid.totalRawMaterials` / `extractionRate`: an untouched deposit's original size is its remaining amount; a deposit that already had a station is regenerated from the belt's own generator version to recover its original size. Rates come from a deterministic hash.
- `SystemAsteroid.surveyedBy` (AI surveys) starts empty.
- Existing credits, raw materials, research points, buildings, mines and stations are untouched. Old saves keep their homeworld as it was (only new games guarantee a homeworld deposit).

Missing `rawmaterials`/`research` read as 0. Production orders without `paid` (written before this economy) are treated as credits-only (`ship cost × quantity`), so cancelling them refunds credits only; a malformed `paid` falls back to the same rule. Loading never charges, refunds or re-applies upkeep: everything is derived from the saved state, and the economy accumulator restarts at 0.

## Construction time (not implemented)

Buildings complete instantly. Adding construction time would need: a persistent per-building state (e.g. `constructionRemaining`), skipping unfinished buildings in `EconomyService.calculatePlanetEconomy`, `ProductionService` capacity, `SpaceportService` and AI counting (the AI must count them as planned to avoid double-building), save validation/defaults for the new field, planet-screen rendering, and a decision on refunds when a planet changes hands mid-construction.

## Known limitations

- The fractional credit carry is in memory (≤ 1 credit lost per load).
- Late-game AI factions still accumulate a credit surplus (~50–350k after 30 minutes), now with raw materials as the binding constraint on their fleets; research prices absorb part of it.
- No ship dismantling or recycling: the only recovery from exhausted deposits is expansion (plus the trickle and drifting asteroids).
- Mining stations cannot be captured or dismantled, but hostile warships stopped in their system attack and can destroy them, which stops extraction; Turret Research I–III arms them ([Territory](./territory.md#station-defense)).
- A planet 25% or more short on energy loses satisfaction; a faction whose only planet is in that state with less than a Solar Array's price (600) may not recover in time.

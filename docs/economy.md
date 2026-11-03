# Economy

The faction economy: the three resources (credits, raw materials, research points), finite raw-material deposits, planet types, what everything costs, how upkeep is charged, the Bank, the Trading Post exchange, and the rules the AI follows to stay solvent. Player and AI use exactly the same rules and code paths.

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
| Per-planet building cap (`maxPerPlanet`) | `building-placement.ts` (`isBuildingLimitReached`) |
| Ship order charging and refunds | `ProductionService` |
| AI spending policy | `EnemyEconomyService` |

## Resources

- **Credits** (stock, integer): population income minus upkeep. The universal currency: buildings (mostly), research (together with research points), the credit part of ships, and all upkeep.
- **Raw materials** (stock): the physical industrial resource. Produced only by extracting **finite deposits** ([Finite deposits](#finite-deposits)) — a Mining Complex on a planet deposit (15/s × deposit richness, workforce- and energy-scaled) and asteroid mining stations (each asteroid's own rate) — plus a small population trickle of `0.002 × population`/s, the one never-depleting source ([Economic safety](#economic-safety)). The Spaceship Factory produces no raw materials. Spent mostly on ships, partly on buildings.
- **Research** (stock): research points from research labs (unchanged). Spent only on technologies, always together with credits ([Research](./research.md)).
- **Trade deliveries:** civilian traders pay credits to the owners of the Trading Posts they connect, on arrival and outside the economy tick ([Trade Network](./trade-network.md#cargo-and-payout)).
- **One-off windfalls:** collecting a drifting asteroid adds its cargo (raw materials and/or research points) directly to the collecting faction's stock, outside the economy tick. See [Star Map Terrain](./star-map-terrain.md#drifting-asteroids).
- **Energy** (flow, never stored): every owned planet has a core building (Colony Center +10, Capital +20; [Colony cores](#colony-cores)) plus its power buildings. An energy-short planet produces at `production / consumption` efficiency, and the shortfall lowers its satisfaction target in proportion ([Energy and satisfaction](#energy-and-satisfaction)).
- **Population**: capped by housing plus the core building × the planet type's population factor ([Planet types](#planet-types)); `POPULATION_CREDIT_RATE` = `0.085 credits/s` per inhabitant at 100% satisfaction (was 0.1, lowered against the credit glut).

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

**Depletion.** When `remaining` reaches 0 the deposit is depleted for good: the economy tick extracts nothing more, the mine or station stays but is idle (a Mining Complex keeps its upkeep; an asteroid mining station on a depleted asteroid pays none), the planet screen, planet info panel and asteroid hover card say DEPLETED, and the player gets a map notice for each of their deposits that runs dry during a tick (`minedDepositsOf`). A Mining Complex cannot be placed on a depleted deposit (player planet screen and AI placement). Depleted deposits stay part of the world and of the save.

**Status vocabulary** (`raw-deposits.ts`): `unmined` (deposit, no mine/station), `active` (being mined), `depleted`, `none`. The UI shows remaining / total, the extracted percentage, the current mining rate and (planet screen) the time until empty.

## Economic safety

Deposits run out, so the economy guarantees a way back:

- **Starting deposit:** every homeworld is generated with a deposit (`GalaxyGenerator` gives it deposit tiles; `ensurePlanetResources` keeps existing tiles), so no empire depends on luck for its first mine.
- **Starting stock:** 2,500 raw materials (× AI difficulty start multiplier) — the first Spaceship Factory (750) and Mining Complex (375) with room for a Spaceport.
- **Emergency floor:** the population trickle (`POPULATION_RAW_RATE`, 2.4/s on a full homeworld) never depletes. It is deliberately small; it lets an empire whose deposits are all gone still afford a Mining Complex on a new colony or an outpost ship (500 raw) within minutes, but it cannot sustain a fleet.
- **Windfalls:** drifting asteroids still carry one-off raw cargo ([Star Map Terrain](./star-map-terrain.md#drifting-asteroids)).
- **New sources:** ~20% of all planets carry a deposit, and every system's asteroid belt holds at least one, so expansion always has targets. There is no regeneration and no ship scrapping; recovery is by expansion.

## Energy and satisfaction

Energy decides two things on a planet: production efficiency and the energy factor of the satisfaction target. Both come from `EconomyService.calculatePlanetEconomy`.

- **Core building:** every planet owned by a faction has a core building ([Colony cores](#colony-cores)): the Colony Center gives 10 energy, the Capital 20. Core energy is flat (energy technologies and the Venus-like bonus scale only power buildings). It lets a new colony run its first housing blocks (3–12 energy each) before a Solar Array, and gives the homeworld (100 from its Fusion Power Plant) room for the usual first Mining Complex + Spaceship Factory.
- **Efficiency:** `1` when production ≥ consumption, otherwise `production / consumption`. All building output and credit income are multiplied by it.
- **Satisfaction target** (`PlanetEconomy.satisfactionTarget`, pure rules in `comfort.ts`): satisfaction moves toward it at 1 point per second, up and down (`satisfactionDrift` is the change over the next second). Arrears come on top (see below).
  - **Comfort part:** `100 × (1 − (1 − floor) × uncovered share)`, see [Comfort](#comfort). 100 on a planet that needs no comfort.
  - **Energy factor:** `max(0, 1 − 2 × shortfall)`, where `shortfall = 1 − efficiency`. 4% short → target ×0.92; 25% short → ×0.5; 50% or more short → 0, which leads to rebellion. A small overshoot costs output and a little satisfaction, never the planet.
  - **Offsets:** `100 × (habitability + building morale)` percentage points (ice −8, a factory −2, a mine or fusion plant −1). They apply only on a planet above the free population, so the opening keeps 100%.
  - Clamped to 0 … 100. A fully powered planet is not pushed up by energy any more: the target is the ceiling.

## Comfort

The counterweight to population income in the mid and late game ([Late Economy](./late-economy.md) has the design, measurements and tuning). Rules in `comfort.ts` (`COMFORT_CONFIG`), derived each time from population and buildings; nothing is saved.

- **Need:** `max(0, population − 5,000) × type factor / 500` comfort points. Type factors: earthlike 1, gas giant 1.3, Mars-like 1.4, desert 1.6, Venus-like 1.6, ice 2.
- **Provided:** Central Park 1, School 2, Hospital 3, Entertainment Center 4 points (`planet-data.json` `comfort`); +15% with at least one of each of the four (full set).
- **Coverage:** `provided / need`, at most 1 (1 when nothing is needed).
- **Effect:** the people above the free population that coverage does not reach count at the floor (60%) in the satisfaction target: `uncovered share = (excess / population) × (1 − coverage)`. The target falls smoothly from the free population on (no cliff), every point counts, and comfort alone never drives a planet below 60% or into rebellion.
- **Cost:** comfort buildings carry a high upkeep (Park 25, School 45, Hospital 65, Entertainment Center 85 points) and no morale. Both the upkeep and the lost income grow with population, i.e. with income; for a wide empire (higher upkeep scale and administration) a covered person costs about what they earn.
- **Unlocks:** Advanced Industry (Park, Entertainment Center), Advanced Science (School, Hospital).
- **Display:** the planet screen always shows need, provided points, coverage and the target (and from what population comfort starts); the build list shows each comfort building's `+N CF`.

**Player feedback** (all derived, nothing saved):

- Planet screen: the satisfaction meter marks the target and shows the drift per second; a red alert appears while the planet is short on energy (with the output loss) or while it is heading for rebellion (target 0, with the estimated seconds).
- Build list: each building shows its energy use or output (`EN`), red when building it would leave the planet short; the tooltip and the placement panel show the planet's energy after building. The preview uses the listed values, so it slightly understates a power building's output under energy technologies.
- Map notices (`planet-stability.ts`, from snapshots taken right before and after each economy tick): a player planet newly short on energy (once, again only after it recovered), satisfaction falling through 50% and 20%, and a planet lost to rebellion.

## The economy tick

`StarMap.gameLoopCallback` accumulates scaled game delta and, once ≥ 1 s has accumulated, calls `EconomyService.applyEconomyDelta` once per faction with the accumulated delta. This is the **only** place income and upkeep are applied, so costs are charged exactly once per tick and are frame-rate independent (many small ticks ≈ one large tick, within integer rounding). A paused game (delta 0) changes nothing. The headless simulation harness (`ai-simulation.spec.ts`) mirrors this loop.

Order within one tick (per faction):

1. **Satisfaction** on owned planets moves toward its target ([Energy and satisfaction](#energy-and-satisfaction)). A planet reaching 0 rebels to `independent` *before* income is computed, so it neither pays nor costs its old owner on that tick.
2. **Effective breakdown** (`calculateEconomy`) from the post-drift state; `net[r] × delta` is applied to raw materials and research, except that deposit mining (planet mines and asteroid stations, `depositMiningPerSecond`) adds what it actually extracted from each deposit this tick (each capped by what is left, and subtracted from it) instead of its nominal rate.
3. **Credits**: `credits + carried fraction + netPerSecond × delta`, floored; the fractional remainder is carried per faction in memory (not saved — at most one credit is lost on reload).
4. **Arrears**: credits never go below 0. If the treasury cannot cover the upkeep, the unpaid part is waived and every owned planet loses `2 × (unpaid / due)` satisfaction per second. A small shortfall is recovered by the move toward the target; a large one leads toward rebellion unless income recovers or upkeep is cut (disbanding a fleet moves its ships to the cheaper reserve).
5. **Population growth.**

## Effective rates (what the HUD shows)

`calculateEconomy` returns effective per-second rates; the HUD (`FactionCurrenciesComponent`) and the planet screen show these numbers, and the tick applies exactly them:

- planet credit income = `pop × 0.085 × energy efficiency × satisfaction/100 × AI difficulty multiplier`
- raw/research production = `building output (workforce-scaled) × energy efficiency × AI difficulty multiplier` (+ the population raw trickle); a mine's raw output is also × deposit richness, and 0 once its deposit is depleted
- `depositMiningPerSecond` = the deposit-mining part of raw production (planet mines + stations); the HUD's raw breakdown shows it next to the population trickle
- `expensePerSecond` = building upkeep + colony administration + ship upkeep + station upkeep (all upkeep already × the empire upkeep scale; `upkeepScale` in the breakdown)
- `netPerSecond = incomePerSecond − expensePerSecond`; `net['credits']` is the same number

The AI difficulty multiplier (`ai-difficulty.ts`) scales production only, never costs, and is 1 for the human. War exhaustion above 25 reduces the same gains linearly down to −30% at 100 for the human and the AI alike (`gainMultiplier` = difficulty × (1 − exhaustion penalty); see [Diplomacy](./diplomacy.md#war-exhaustion)). Peace treaties move credits and raw materials between factions outside the economy tick ([Diplomacy](./diplomacy.md#peace-treaties-peace-treatyts)), and so do paid credit demands at peace ([Financial demands](./diplomacy.md#financial-demands-and-ultimatums)). Both go through the one atomic transfer (`resource-transfer.ts` `transferResources`): every amount is checked against the giver's whole-unit stock first, and either all of it moves or nothing does, so diplomacy can never make credits negative. An AI never pays a demand out of its spending reserve (`EnemyEconomyService.getSpendingReserve`) and never more than 60% of its credits; an AI's own demand never asks for more than half of the target's credits.

## Upkeep

Upkeep is the economy's main **credit sink**: it grows with the empire, so a large empire's income does not pile up unspent.

`maintenanceCost` in the data files is in **upkeep points per second**; one point costs `UPKEEP_CREDITS_PER_POINT = 0.3` credits/s (the base rate), multiplied by the **empire upkeep scale**.

- **Empire upkeep scale** (`empireUpkeepScale`): `1 + min(0.8, 0.07 × (owned planets − 1))` — ×1 with one planet, ×1.35 with six, ×1.7 with eleven, ×1.8 from thirteen. It applies to every upkeep below (buildings, fleet and reserve ships, stations), not to administration. A one-planet start pays the base rate, so the early build-up is unchanged; the cost bites as the empire grows. A flat higher base rate (0.4–0.5) was tried and starved the early game: Spaceports came minutes late, the first warships did not come at all, and an AI lost its homeworld. The HUD's credit overlay shows the current scale under Expenses.
- **Buildings**: every building instance on an owned planet, × the planet type's upkeep factor ([Planet types](#planet-types)).
- **Fleet ships**: every non-destroyed ship in a non-destroyed fleet of the faction. Ship upkeep points grow faster than combat strength with hull size (`ship-data.json`): scout 2, fighter 4, corvette 7, frigate 12, destroyer 20, cruiser 32, carrier 40, battleship 64, battlecruiser 70, dreadnought 120 (colonizer 5, outpost ship 6, Swarm Constructor 10). Light hulls are ~1.3–1.5× their old upkeep, capital ships ~2–2.2×, so a large heavy navy is the most expensive thing an empire can keep.
- **Reserve ships** (faction ship stock): `RESERVE_SHIP_UPKEEP_FACTOR = 0.5` of the fleet rate — mothballed, but not free, so the stock is not an upkeep loophole.
- **Stations**: every completed space base costs `SPACE_BASE_UPKEEP_POINTS = 25` points, every completed Dyson anchor `DYSON_ANCHOR_UPKEEP_POINTS = 300` ([Dyson Swarm](./dyson-swarm.md); its small bonus — power-plant energy, ship raw-material discount or research — is applied in the economy and production rules, see [Anchor bonuses](./dyson-swarm.md#anchor-bonuses)), every completed asteroid mining station `MINING_STATION_UPKEEP_POINTS = 15` (construction sites cost nothing, see [Territory](./territory.md#construction)) while its asteroid has raw materials left (a station on a depleted asteroid stays until destroyed but pays no upkeep, since it cannot be dismantled). Stations are structures, so the building-upkeep technology modifier applies. Bases come from the live `SpaceBaseService` registry, mining stations from the asteroids.
- **Colony administration**: every owned planet beyond the first adds `3%` of each planet's credit income as an expense, capped at `45%` (`administrationShare`). A fresh colony raises the share on the whole empire before its own income grows, so over-expansion costs real money, while total income can never turn negative from administration alone.

Ownership changes, destruction, fleet creation/disbanding and production completion need no bookkeeping: upkeep is recomputed from the current state on every tick.

Reference homeworld at game start (earthlike, 1200 pop, Capital, 1 Large Residential, Fusion Plant, Laser Turret, Research Lab; the human's starting fleet of 2 scouts + 1 fighter; one planet, so scale ×1): income 102/s, building upkeep 29.1/s (the Capital is free), fleet upkeep 2.4/s, net ≈ 70/s (the planet screen shows 73/s, before fleet upkeep). Before the colony cores it was 1400 pop and net ≈ 84/s. A Normal AI starts with 2 frigates (7.2/s).

Effect of the 2026-11 credit-sink changes (empire upkeep scale, station upkeep, progressive ship upkeep, smaller starting fleets, population income 0.085, research 4 credits per point, planet types), measured in `ai-simulation.spec.ts` (economy validation, 30-minute games, 3 and 5 AIs):

| At minute 30 | Before | After |
| --- | --- | --- |
| Unspent credits | 46–207k (average 136k) | 9–29k (average 16k) |
| Unspent raw materials | small | 26–59k (average 46k) |
| Upkeep share of gross income | 59–72% | 72–83% |
| Ships per AI | 43–93 | 18–29 |
| Technologies | 22–31 | 15–20 |
| Ticks in arrears | 0 | 0 |

Credits are now the binding resource and raw materials pile up instead; the Trading Post is the (expensive) valve between them. The game is deliberately slower; the simulation thresholds were adjusted to the new pace.

## Planet types

`planet-types.ts` (`PLANET_TYPE_TRAITS`) is the source of truth for what a planet's type changes; the satisfaction offset stays in `PLANET_TYPE_HABITABILITY` (`star-map.models.ts`) and the comfort factor in `comfort.ts`. The earthlike world is the ideal home; every other type is a trade-off — a lower population ceiling (= less credit income) and pricier building upkeep (heating, cooling, domes) — against one advantage:

| Type | Population ceiling | Building upkeep | Advantage | Satisfaction offset | Comfort factor |
| --- | --- | --- | --- | --- | --- |
| Earthlike | 100% | ×1 | — | 0 | ×1 |
| Mars-like | 75% | ×1.15 | deposit mining ×1.25 | −3 | ×1.4 |
| Desert | 70% | ×1.15 | deposit mining ×1.25 | −5 | ×1.6 |
| Venus-like | 60% | ×1.3 | power buildings ×1.25 (geothermal; not the colony core) | −5 | ×1.6 |
| Ice | 60% | ×1.3 | research buildings ×1.25 | −8 | ×2 |
| Gas giant | 50% | ×1.2 | gas harvesting: +3 raw/s while populated (never depleted) | 0 | ×1.3 |

The satisfaction offset (percentage points of the target) and the comfort factor apply only above the free population ([Comfort](#comfort)).

- The ceiling multiplies the housing capacity (`getPopulationCapacity`, floored); growth fills the remaining capacity, so a harsh world also grows to a smaller size.
- The upkeep factor multiplies every building on that planet, on top of the empire upkeep scale; the AI prices a new building for that planet the same way.
- Homeworlds are always earthlike. A planet whose population is above its ceiling (an older save, an AI starting colony) drops to the ceiling on the next economy tick.
- The planet info panel and the planet screen show the type's effects ("World type").
- AI colonization scores a type by `0.4 + 0.6 × ceiling / upkeep factor` (earthlike 1.0 … gas giant ≈ 0.65, see [AI Pipeline](./ai-pipeline.md)).

## Colony cores

Every planet a faction owns has exactly one core building (`role: "core"`, `autoPlaced: true` in `planet-data.json`; rules in `colony-core.ts`). The core carries the planet's base values, so they are tuned in the building data instead of hidden constants (it replaced the old invisible `COLONY_CORE_ENERGY`):

| Core | Where | Size | Population | Workforce | Energy |
| --- | --- | --- | --- | --- | --- |
| Capital | generated homeworlds | 3×3 | 500 | 100 | 20 |
| Colony Center | every other owned planet | 2×2 | 150 | 30 | 10 |

- **Free and permanent:** no price, no upkeep, `maxPerPlanet` 1. No technology unlocks a core and the build list hides `autoPlaced` buildings, so neither the player nor the AI can build one; there is no demolition.
- **Placement:** automatic, at the free spot nearest to the grid center (`centerOutPlacementOrder`, the AI's construction order): by the galaxy generator in the starting layouts, by `PlanetOwnershipService.transferPlanet` whenever a faction (not `unhabited`, not `independent`) takes a planet without a core (colonization, capture, battle), and by `StarMap.ensureColonyCores` on load. If terrain leaves no room, the nearest spot free of buildings and deposits is cleared of terrain; a core is missing only on a grid that is completely built over.
- **Ownership:** the core stays with the planet through capture and rebellion. A captured Capital stays a Capital; a rebel (independent) planet keeps its core but earns nothing. Independent civilizations have no core until someone takes them.
- **Economy:** `EconomyService` treats the core like housing for the population ceiling and workforce (`providesHousing`), and adds its energy without technology or planet-type multipliers. A planet without a core has no base energy, housing or workforce.
- **Effect:** a fresh colony grows to 150 people (×the planet type's ceiling) without any housing, so it earns a little at once.

**Start balance (2026-11, with the cores).** Against the credit glut of the opening, the homeworld's second Large Residential Block became the Capital (1200 people instead of 1400) and housing costs 1.5× (Large 4500/1125, upkeep unchanged). The start net fell from ≈ 84 to ≈ 70 credits/s, and a Large Residential Block repays its price in ~3.7 minutes of growth instead of ~3. Lowering the per-inhabitant income (0.07–0.08) or raising housing upkeep was tried and rejected: it cut the net margin for the whole game, the AI's over-expansion brake then stopped colonization, and AIs fell into arrears. Measured in `ai-simulation.spec.ts` (the AI uses the same rules):

| | Before | After |
| --- | --- | --- |
| AI Spaceport (15-minute medium game) | ~200 s | ~245 s |
| AI first colony | ~205 s | ~250 s |
| Colonies / ships at 15 minutes | 3 / 9–10 | 3 / 8–12 |
| Large map, 5 AIs, 30 minutes: planets / warships | 32 / 116 | 36 / 90 |

The AI expands a little more (colonies are cheaper to start) and keeps fewer warships (more colonies raise the empire upkeep scale while credits bind). The simulation thresholds that measure pace were adjusted; see the comments in the spec.

## Bank

`bank` (`planet-data.json`, role `finance`): a 2×2 building (3000 credits, 750 raw, 10 upkeep points, 8 energy, 40 workforce) that produces **12 credits/s**, unlocked by Advanced Industry. It is an ordinary credit-producing building: its output is scaled by workforce, energy efficiency and satisfaction like every building's credit production, so an independent planet's Bank earns nothing. At most one per planet (`maxPerPlanet`, see below), so Banks add up across planets but cannot be stacked on the homeworld. Net value at full output: about +9 credits/s with one planet (upkeep 3/s) and about +6.6 at the largest empire upkeep scale (×1.8), before the planet type's upkeep factor — the price is repaid in roughly 5–6 minutes. The AI builds Banks by personality ([Trade Network](./trade-network.md#ai)).

## Per-planet building cap

A building with `maxPerPlanet` in `planet-data.json` (Bank and Trading Post: 1) cannot be placed on a planet that already holds that many (`isBuildingLimitReached`, checked first by `checkBuildingPlacement` and by the AI's placement search). The build list marks it ALREADY BUILT. A planet that holds more from an older save keeps them; only new ones are refused.

## Trading Post

`trading_post` (`planet-data.json`, role `trade`): a 2×2 building (2500 credits, 600 raw, 15 upkeep points, 10 energy, 20 workforce, at most one per planet), unlocked by the starting technology Basic Industry. A planet with a Trading Post gets a TRADE tab on the planet screen, where its owner exchanges credits and raw materials in lots of 100 / 500 / 1000 (`trade.ts`):

- buying raw costs `TRADE_BUY_CREDITS_PER_RAW` = 4 credits per unit (price rounded up);
- selling raw pays `TRADE_SELL_CREDITS_PER_RAW` = 0.25 credits per unit (proceeds rounded down).

The rates are deliberately bad: a round trip keeps 1/16 of the value, buying the raw part of a cruiser (1200) costs 4800 credits, and a Mining Complex produces raw at ~0.4 credits of upkeep per unit. It is a last resort when one resource runs dry, not a way to run an economy. Every trade is atomic and re-checked by `executeTrade` (post on the planet, owned by the trader, enough stock); a refused trade changes nothing. The post does not need power or workforce to trade. The AI builds posts by personality for the trade network ([Trade Network](./trade-network.md#ai)) and buys raw materials at one only when raw materials, not credits, hold back its warships and it has a large credit surplus ([AI Pipeline](./ai-pipeline.md#raw-purchases-and-the-reserve-exit)). Every planet with a Trading Post is also a node of the civilian trade network and keeps two traders ([Trade Network](./trade-network.md)). Their deliveries pay the post owner the cargo value and the destination owner a 20% port fee, in credits, outside the economy tick (a windfall like collected asteroids).

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
| Ship repair | free, over time: at an own Spaceport (5% hull/s), at an own space base with Orbital Repair Docks (2.5%/s), and in the reserve ([Fleet Organization](./fleet-organization.md#repair)) | — | — |

Buildings (credits / raw materials):

| Role | Building | Price |
| --- | --- | --- |
| Housing | Small / Medium / Large Residential | 600/150, 1800/450, 4500/1125 |
| Core (never bought) | Capital / Colony Center | free, no upkeep ([Colony cores](#colony-cores)) |
| Power | Solar Array / Fusion Power Plant | 600/150, 2500/625 |
| Research | Small Research Laboratory / Research Laboratory | 1000/250, 3000/750 |
| Industry | Mining Complex / Spaceship Factory | 1500/375, 3000/750 |
| Military | Spaceport | 4000/1000 |
| Defense | Laser / Missile Turret / Planetary Shield | 800/200, 1000/250, 3500/875 |
| Social (comfort) | Central Park / School / Hospital / Entertainment Center | 800/200, 1500/375, 2000/500, 3000/750 ([Comfort](#comfort): 1/2/3/4 points, 25/45/65/85 upkeep points) |
| Finance / trade | Bank / Trading Post | 3000/750, 2500/600 |

Ships (credits / raw materials): Scout 50/150, Fighter 75/225, Corvette 120/360, Frigate 180/540, Destroyer 260/780, Cruiser 400/1,200, Carrier 500/1,500, Battleship 700/2,100, Battlecruiser 750/2,250, Dreadnought 1,200/3,600.

Rationale: early basics (housing, solar, turret) cost a few seconds to a minute of starting net income; core infrastructure (factory, Spaceport) costs about a minute each; large/specialised buildings cost several minutes. Every building also adds permanent upkeep, so a building is a trade-off against warships and expansion. Warships keep their credit `cost` because it also sets build time (`cost × 0.1 / factory power`) and is the ship's "value" for war losses and border penalties; their weight moved to raw materials, so one mine (~15/s) pays for a cruiser in about 80 seconds and a large fleet needs several deposits. The colonizer and outpost ship carry an explicit `buildTime` (10 s and 35 s, as before) because their credit price rose. The Swarm Constructor (100,000 credits, 10,000 raw materials, 120 s) is the exception to "mostly raw materials": it is a civilian ship and a deliberate late-game credit sink ([Dyson Swarm](./dyson-swarm.md#research-and-the-anchor-ship)).

Research prices (research points from the tree, scaled by technologies already researched, plus `RESEARCH_CREDITS_PER_POINT` = 4 credits per point) are described in [Research](./research.md). Technology bonuses change several economy rates (energy, raw and research output, building and ship upkeep, population growth); `EconomyService` applies them through `ResearchService.getModifiers` for the owning faction, so the HUD, the economy tick and the AI see the same numbers.

## Purchases

All building and ship purchases go through `resource-cost.ts` (`buildingCost`, `shipCost`, `canAffordCost`, `payCost`, `refundCost`). `payCost` is all-or-nothing: it checks credits and raw materials before deducting either, so a failed purchase changes nothing and a balance never goes negative through a purchase. Research is paid by `ResearchService.researchTechnology` with the same all-or-nothing rule over research points and credits.

- **Buildings** (`StarMap.onBuildingConfirmed`, `EnemyEconomyService.tryConstruct`): paid in full when placed; there is no construction time and no refund. The planet screen shows both prices and marks the part the player cannot pay; a mine on a planet without a live deposit shows NO DEPOSIT / DEPLETED instead.
- **Ships** (`ProductionService.queueOrder`): paid in full at queue time; the charge is recorded on the order as `paid`. Completion moves ships to the stock for free, and assembling or reinforcing fleets from the stock never charges. Cancel and every auto-cancel (factory lost, planet lost or captured, unknown type) refund the un-built fraction of `paid` (rounded), so a refund can never exceed the charge.

## AI spending policy (summary)

Full details in [AI Pipeline](./ai-pipeline.md#ai-economy-manager-enemyeconomyservice). The AI uses the same costs and the same `EconomyService` numbers as the HUD:

- **Reserve**: optional purchases leave credits and raw materials for committed needs: next colonizer, a missing factory or Spaceport (only while net income is positive), the first housing of every colony, the first mine on an unmined live deposit, the credits of a technology whose research points are already banked (for the technologist: of the technology research is saving for), and the next warship.
- **Upkeep headroom**: a purchase's upkeep (priced with the faction's empire upkeep scale) must fit the projected net (current net minus queued ships' upkeep): emergency power — always; core (housing, factory, Spaceport) — net ≥ 0, or a deficit the treasury can carry for 300 s; warships — leave `10% / personality military preference` of gross income; optional buildings — leave 25%. The gap keeps ~15% of income structurally available for warship upkeep.
- **Over-expansion brake**: the AI starts a new colony only if its net credit income stays ≥ 0 after the colony's own cost to the empire (`marginalColonyCost`: the administration step on the whole income plus the upkeep-scale step on all scaled upkeep), or its credits cover the resulting deficit for 300 s (`canSupportNewColony`). Assault targets are braked the same way with the whole economy recomputed as if the target were already owned (`canSupportCapture`, see [Planet Capture](./planet-capture.md#ai-assaults)); a capture that improves the net is always allowed.
- **Military target** includes the strength that 12% of gross income can sustain in upkeep, so the navy scales with the economy.
- **Space**: while a factory, a Spaceport or the first mine on a live deposit is missing, no other building may take the last room for it.
- **Raw materials**: every owned planet with a live deposit gets a Mining Complex (never a depleted one); while raw materials are the binding constraint (`isRawConstrained`: credits for two preferred warships but not their raw materials) a large deposit gets a second one and no extra factories are built. Warships save for the preferred hull when income covers the gap within 90 s instead of buying the cheapest hull.
- **Research**: when the labs are too slow (the most expensive available technology's RP is more than 180 s away while its credits are there) research buildings move first and ignore the warship part of the reserve.
- **Expansion and asteroid mining**: colony targets are valued by their deposits in proportion to raw-supply pressure, and an outpost ship is sent to survey and mine asteroid belts when the faction's mining is about to run dry ([AI Pipeline](./ai-pipeline.md#asteroid-mining-enemyminingservice)).

## Save compatibility

No save version bump; every new field is optional and filled on load (`SaveGameService.normalizeSave` and `StarMap.ensureResourceTiles`, both idempotent). Since 0.3.0 only format 12+ saves load at all ([Versioning](./versioning.md)); the repairs below remain as idempotent load-time fallbacks:

- `PlanetTile.rawDeposit`: planets with deposit tiles but no reserve (saves from before finite deposits) get their deterministic deposit, full. Saved reserves — partly mined or depleted — are kept exactly; a malformed one is regenerated. Planets without tiles never have one.
- `SystemAsteroid.totalRawMaterials` / `extractionRate`: an untouched deposit's original size is its remaining amount; a deposit that already had a station is regenerated from the belt's own generator version to recover its original size. Rates come from a deterministic hash.
- `SystemAsteroid.surveyedBy` (AI surveys) starts empty.
- Existing credits, raw materials, research points, buildings, mines and stations are untouched. Old saves keep their homeworld as it was (only new games guarantee a homeworld deposit).
- The 2026-11 balance values (income, upkeep, research price, planet types, housing prices) apply to old saves at once: nothing about them is stored.
- Colony cores: on load every faction-owned planet without a core gets a Colony Center (`StarMap.ensureColonyCores`, idempotent) — old homeworlds too, since a save does not record which planet was the homeworld. Old homeworlds keep their two Large Residential Blocks. A non-earthlike planet above its new population ceiling drops to it on the first tick; existing starting fleets stay as they were; the Trading Post is available immediately (Basic Industry is a starting technology).

Missing `rawmaterials`/`research` read as 0. Production orders without `paid` (written before this economy) are treated as credits-only (`ship cost × quantity`), so cancelling them refunds credits only; a malformed `paid` falls back to the same rule. Loading never charges, refunds or re-applies upkeep: everything is derived from the saved state, and the economy accumulator restarts at 0.

## Construction time (not implemented)

Buildings complete instantly. Adding construction time would need: a persistent per-building state (e.g. `constructionRemaining`), skipping unfinished buildings in `EconomyService.calculatePlanetEconomy`, `ProductionService` capacity, `SpaceportService` and AI counting (the AI must count them as planned to avoid double-building), save validation/defaults for the new field, planet-screen rendering, and a decision on refunds when a planet changes hands mid-construction.

## Known limitations

- The fractional credit carry is in memory (≤ 1 credit lost per load).
- Late-game AI factions still hold a credit stock, but smaller: with comfort ([Late Economy](./late-economy.md#results)) the 90-minute net is 0–21% of gross income (was 18–41%) and the stock 0–4 minutes of income (was up to 6.7). The rest is mostly navies at their ship cap; the Dyson Swarm ([Dyson Swarm](./dyson-swarm.md#tuning-phase-7)) and AI raw purchases at the Trading Post absorb part of it.
- No ship dismantling or recycling: the only recovery from exhausted deposits is expansion (plus the trickle and drifting asteroids).
- Mining stations cannot be captured or dismantled, but hostile warships stopped in their system attack and can destroy them, which stops extraction; Turret Research I–III arms them ([Territory](./territory.md#station-defense)).
- A planet 25% or more short on energy heads for half satisfaction or less; a faction whose only planet is in that state with less than a Solar Array's price (600) may not recover in time.

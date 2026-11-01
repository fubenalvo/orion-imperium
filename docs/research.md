# Research and Technology

How technologies are defined, what each one does in gameplay, how costs progress, and how the AI chooses research. Player and AI use the same rules and code.

Related: [Economy](./economy.md) (research income, upkeep), [AI Pipeline](./ai-pipeline.md#research-enemyresearchservice), [Battle Rules](./battle-rules.md) (combat bonuses), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Technologies: cost, prerequisites, unlocks, bonuses, descriptions | `src/app/components/star-map/research-tree.json` |
| Rules: status, price (`getResearchPrice`: research points + credits), purchase, unlocks, aggregated bonuses (`getModifiers`), effect text | `ResearchService` |
| Consumers of bonuses | `EconomyService` (energy/raw/research output, building/ship upkeep, population growth), `ProductionService` (build speed), `StarMapSensorService` + `EnemyIntelService` (sensor range), `createBattleState` via `Battle.combatBonuses` (attack/shield), `StarMapBattleDetectionService.stationTurretsOf` (station turrets, also drawn on the station markers) |
| AI choice | `EnemyResearchService` |
| UI | `StarMapResearchTreeComponent` |

## Model

- **Research points** (`faction.currencies.research`) come from research buildings (see [Economy](./economy.md)); they are the scarce, lab-produced resource and the only thing that measures scientific capacity. Research is an **instant purchase**: when a technology's current price is available it can be bought; there is no in-progress state. The UI shows the time to afford a technology from the current research and credit income.
- **Price**: research needs scientific capacity *and* funding. Research points: `researchCost × (1 + 0.02 × researched non-starting technologies)`, rounded (`ResearchService.getResearchCost`, `RESEARCH_COST_GROWTH_PER_TECH`). Credits: `RESEARCH_CREDITS_PER_POINT` (4; was 2, raised as a credit sink — see [Economy](./economy.md#upkeep)) × that research-point cost (`getResearchCreditCost`). `getResearchPrice` returns both; it is the one price rule for `canResearch`, `getResearchBlocker`, `researchTechnology`, the UI and the AI. Early choices stay cheap; a research leader pays more for the late tree, which damps runaway research advantages. Research never costs raw materials.
- **Purchase** is all-or-nothing: `researchTechnology` checks both parts (reasons `insufficient_research`, then `insufficient_credits`) before deducting either, so a technology is never researchable while either resource is short and a failed attempt charges nothing.
- **Effects** are either **unlocks** (`unlocksShips`, `unlocksBuildings`) or **bonuses** (`bonuses`). Every ship and building is unlocked by exactly one technology (tested).
- **Bonus aggregation** (`ResearchService.getModifiers`): bonuses of the same type add up; multipliers are `1 + Σ value` (two +15% energy technologies → ×1.30); reductions are negative and floored at ×0.25. Ship combat bonuses apply per listed hull and also add up (fighter: +25% fighter tech + 15% advanced weapons → ×1.40).
- **Exactly once, save-safe**: modifiers are derived from `researchedTechnologies` whenever needed (cached by that list) and never stored. Loading a save recomputes them; duplicated or unknown ids in a save never count twice. Bonuses act from the moment of research onward and never retroactively (e.g. build speed only speeds up remaining production progress).
- **Combat bonuses** are stamped on a `Battle` when it is created (`ResearchService.buildCombatBonuses` in battle detection, planet arrival and AI invasions) and applied once per battle in `createBattleState`. Battle ships are rebuilt from the overworld fleet for every battle, so nothing is written back. The AI's battle forecast (`EnemyInvasionService.forecastFleetBattle`) deliberately ignores research: the AI does not know which technologies its opponents have.

## Technology inventory

Costs are base costs (before scaling). Depth = prerequisite steps from the starting technologies.

| Technology | Depth | Cost | Category | Effect (implemented in) |
| --- | --- | --- | --- | --- |
| Basic Engineering / Science / Industry / Power | 0 | 0 | Starting unlock | Scout, Fighter, Colonizer; Factory, Spaceport, turrets; Small Research Lab; Small Residential, Mining Complex; Solar Array |
| Advanced Engineering | 1 | 800 | Unlock | Corvette, Frigate |
| Military Engineering | 1 | 1000 | Unlock | Destroyer, Planetary Shield |
| Advanced Industry | 1 | 800 | Unlock + bonus | Park, Entertainment Center; −10% building upkeep (EconomyService) |
| Improved Power | 1 | 600 | Bonus | +15% energy from power buildings (EconomyService) |
| Advanced Science | 1 | 700 | Unlock | Hospital, School |
| Basic Radar | 1 | 500 | Bonus | +1 sensor range (sensors, AI intel) |
| Scout Technology | 1 | 400 | Bonus | +1 sensor range |
| Fighter Technology | 1 | 600 | Bonus | +25% battle damage: Scout, Fighter |
| Advanced Construction | 2 | 1400 | Unlock | Medium Residential |
| Orbital Engineering | 2 | 1800 | Bonus | +25% ship construction speed (ProductionService) |
| Advanced Manufacturing | 2 | 1800 | Bonus | +25% raw materials from buildings (EconomyService) |
| Fusion Power | 2 | 1200 | Unlock | Fusion Power Plant |
| Advanced Research | 2 | 1400 | Unlock | Research Laboratory |
| Advanced Radar | 2 | 1500 | Bonus | +1 sensor range |
| Corvette Technology | 2 | 1200 | Bonus | +20% damage and shields: Corvette, Frigate |
| Frigate Technology | 2 | 1500 | Bonus | +15% shields: all warships |
| Destroyer Technology | 2 | 1800 | Bonus | +25% damage, +20% shields: Destroyer |
| Advanced Weapons | 2 | 2400 | Bonus | +15% damage: all warships; prerequisite for capital ships |
| Advanced Shipyards | 3 | 2600 | Unlock | Cruiser, Carrier |
| Urban Infrastructure | 3 | 3000 | Unlock | Large Residential |
| Advanced Power | 3 | 2500 | Bonus | +15% energy from power buildings (stacks to +30%) |
| Applied Science | 3 | 3000 | Bonus | +25% research from research buildings |
| Long-Range Radar | 3 | 3500 | Bonus | +1 sensor range |
| Colonization Technology | 3 | 2200 | Bonus | +50% population growth (EconomyService) |
| Capital Ship Technology | 3 | 5500 | Unlock | Battleship, Battlecruiser, Dreadnought |
| Cruiser Technology | 4 | 4500 | Bonus | +20% damage and shields: Cruiser, Battlecruiser |
| Carrier Technology | 4 | 4500 | Bonus | −15% ship upkeep (fleet and reserve) |
| Turret Research I | 1 | 700 | Bonus | +1 defense turret on every space base and mining station (`createBattleState` via the station defense roster, [Territory](./territory.md#station-defense)) |
| Turret Research II | 2 | 1600 | Bonus | +1 turret (2 total); also needs Military Engineering |
| Turret Research III | 3 | 3000 | Bonus | +1 turret (3 total, a missile turret); also needs Advanced Weapons |

Base total: 58,000 points. With cost scaling the full tree costs roughly 70–75k points.

## Progression rationale

Costs follow prerequisite depth and value (the average cost rises with depth — tested): one-step technologies 400–1000 (bought from the 1000 starting points and the first minutes of research income), two-step 1200–2400, three/four-step 2200–5500. Economic multipliers (energy, raw output, research, upkeep) are moderate (10–25%) so early ones help without making later ones irrelevant; capital ships and the heavy-hull technologies are the expensive late investments. Research competes with the rest of the economy through research-building prices and upkeep (labs cost 1000–3000 credits and 6–12 credits/s).

Measured in the 30-minute economy validation simulation (`ai-simulation.spec.ts`, 3 AIs medium + 5 AIs large): 10th technology at 7–9 minutes; all depth-1 technologies by 15–26 minutes; only technologists finish the tree (~29 minutes); other personalities hold 20–29 of 31 technologies at 30 minutes. Before this rework the whole tree (then with no-op technologies) was bought in ~3.5 minutes (original costs) and ~20–25 minutes (uniform 5× costs).

## AI research (summary)

`EnemyResearchService` scores every technology whose prerequisites are met by `(direct value + 0.5 × best follow-up value) / current cost`. Values come from the faction's real situation: upkeep reductions by today's upkeep share of income, energy by the tightest planet energy margin, raw output by raw income, research output by research income, growth by planets below housing capacity, sensors by expansion, ship combat bonuses by the share of the faction's own fleet strength in the affected hulls × military need, station turrets by the number of stations it owns (bases + mining stations; near zero without any) × military need, ship unlocks by strength gain × military need. Personality weights (economy, research, expansion, offense/defense) scale the matching values; under threat, peacetime values are divided by the military need. A technology is affordable for the AI only if both its research points and its credits are, and the credits must leave the price of a missing Spaceship Factory / Spaceport untouched. It saves for a clearly better (≥1.5× score) technology only if research and credit income reach both parts within 180 s; otherwise it buys the best affordable one, so it never stalls. The AI economy manager keeps the credits of a technology whose points are already banked, and builds research labs first when its labs are too slow ([AI Pipeline](./ai-pipeline.md#construction-and-spending-policy)). It only uses information the faction has (own economy and fleets, perceived hostile fleets).

## UI

The research screen shows, per technology: name, flavour description, **Effects** (generated from the data by `ResearchService.describeEffects`, so the text cannot drift from the rules), current price in RP and credits (the part the faction cannot pay is highlighted), prerequisites, what it leads to, status, and why it cannot be researched now (missing prerequisites, or the research points and/or credits still needed, each with the time at current income). An available technology that is not yet affordable also shows a meter of how much of its price is already banked (the scarcer resource decides).

Layout (presentation only, no effect on the rules):

- **Tiers.** Technologies are grouped into rows by prerequisite depth: no prerequisites = tier I, otherwise one more than the deepest prerequisite (`StarMapResearchTreeComponent.getTier`). The tier is derived from the technology data, not stored on it, so adding or re-wiring technologies needs no UI change.
- **Header.** Current research points and income, current credits, and overall progress (researched / total).
- **Filters.** All / Available / Researched / Locked, with counts. The filter is component state only; it is not saved.

Visual styling follows the design system in [UI Styling](./ui-styling.md#design-system).

## Known limitations

- AI fleet-strength estimates (military targets, forecasts) use base ship stats; research combat bonuses affect actual battles only.
- The AI never values the remaining technologies at zero; it eventually researches everything, including bonuses for hulls it does not build.
- Research is an instant purchase; there is no research queue or partial progress.

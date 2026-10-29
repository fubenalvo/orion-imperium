# AI Pipeline

System-level description of how AI-controlled factions (`Faction.ai === true`) make and execute decisions on the star map. Per-layer details (exact predicates, action types) live in [Game State §4.13–4.18](./game-state.md#413-enemy-ai-v3). Battle-screen tactical AI is separate: see [Battle Rules](./battle-rules.md). Production and assembly rules the AI relies on: [Ship Production](./ship-production.md).

## Execution flow

`StarMap.gameLoopCallback` runs once per animation frame with the scaled game delta (0 when paused, see [Game Time](./game-time.md)):

1. Fleet movement (`StarMapMovementService.updateFleets`), arrivals, battle detection.
2. `StarMapAiTickService.tick` — the whole AI pipeline:
   0. Per faction: `EnemyIntelService` — fog-of-war knowledge and the perceived view every decision layer uses (every 2 s); `EnemyPlanService` — strategic assessment and posture (every 5 s, first immediately); `EnemyFleetService` — fleet roles and movement for every fleet the pipeline is not using (every 2 s, first decision on the first frame), including planet assaults executed by `EnemyInvasionService`; `EnemyResearchService` — buys one technology (every 5 s, first decision immediately).
   After the tick, `StarMap` takes any queued AI assault on a player planet (`takePendingPlayerBattle`) and opens the battle screen.
   1. `EnemyAiService` — legacy reactive pursuit; only for AI fleets nobody else manages (in practice none).
   2. `EnemyStrategyService` — one strategy per faction (`expand | attack | defend | develop`), every 2 s.
   3. `EnemyGoalService` — concrete goal per faction, every 2 s.
   4. `EnemyCapabilityService` — can the faction pursue the goal, every 2 s.
   5. `EnemyActionService` — the single next action per faction, every 2 s.
   6. `EnemyActionExecutor` — executes the current action every frame, through the regular game services (production, fleet assembly, movement targets, planet ownership).
   7. `EnemyEconomyService` — background economy per faction (construction, military production, deployment), every 2 s, **independent of the current goal**.
   8. `EnemyProgressService` — deadlock detection and targeted replanning (every 10 s).
3. Production, then the 1 s economy tick.

Layers 2–5 only inspect state; the executor, the economy, fleet and research services and `EnemyAiService` (fleet targets) mutate game state. Movement set in frame N takes effect in frame N+1 because movement runs before the AI.

The strategic pipeline pursues one goal per faction at a time (colonize, attack, defend or develop). Economic management does not compete for that slot: it runs in `EnemyEconomyService` for every faction on every decision interval, so a faction keeps building and arming while a colonization run is in progress or while it has no goal at all.

## Scheduling

Strategy ticks once for all factions. Goal, capability and action are called **once per faction per frame**, so each keeps a `Map<factionId, accumulator>`. A single shared accumulator (the original implementation) advanced N times per frame and processed only the faction whose call crossed the threshold — every other AI faction never planned.

## Fog of war (EnemyIntelService)

When the game's fog of war is on (`GameSettingsService.fogOfWarEnabled`, the player's setting), each AI faction knows only what its sensors have seen, using the player's sensor rules (owned systems: radius 5 + research bonus; fleets: `getFleetSensorRange`).

- **Knowledge kept separate from the world:** charted systems with last-seen planet snapshots (owner, population, buildings); currently visible hostile fleets (the real objects); remembered hostile fleets as frozen copies at the last-seen position. A sighting is dropped when its spot is seen empty or after 300 s, and is *uncertain* after 60 s. Star positions are public; planet contents are not.
- **Who uses the view:** plan, strategy, goal, capability, action, fleet operations, research and the economy's threat/target checks receive `getView(faction)`. Own and allied fleets and own planets in the view are the real objects, so decisions about own assets act on live state.
- **Who uses the real world:** the executor, invasion and construction act on the authoritative state, which re-validates every decision before anything changes (e.g. a colonization target taken by someone else since it was last seen simply fails and the goal is reselected). The executor's attack movement heads for the target's last-known position.
- **Exploration:** fleet operations sends one free fleet (never the home guard) to the nearest uncharted system within 1.5 × colonization reach; explorers only abort for a stronger hostile within 7 cells. Factions without planets explore from their fleets.
- **Interception** only targets visible, non-uncertain fleets; remembered fleets still count as danger.
- With fog disabled, the view is the real world — the AI sees what the player sees.
- `EnemyAiService` (legacy pursuit) is not fog-aware; it is dormant because every AI fleet is owned by the pipeline or fleet operations.

## AI debug panel

`EnemyDebugService` builds per-faction snapshots on demand: priority and strategy, primary goal and action, colonization objective and action, fleet objectives (role and target per fleet), last completed and last failed action with reason, shortages (unsatisfied capability requirements, energy/workforce/satisfaction problems, missing factory or Spaceport), recent replans, seconds since the last progress, credits, research points and intel coverage. On the star map **F9** toggles `AiDebugPanelComponent`; snapshots refresh about once per real second only while it is open and never mark the save dirty. Optional console output of new replan events (off by default, max 10 lines per refresh) is the only AI logging.

## Save/load and bounded state

All AI state is in-memory and rebuilt after a genuine load or new game (`resetAiPipeline` resets every service, including intel, reach and progress). **Returning from the battle screen is not a load:** the battle screen is a separate route, so `StarMap` is recreated and re-reads the autosave, but the session continues (game time was paused). `StarMap.enterBattleScreen` calls `StarMapAiTickService.suspendForBattle()`, the next `StarMap` initialization takes that flag and calls `resumeAfterBattle()` instead of the reset: charted systems, sightings, goals, fleet roles, assaults, failed targets and their retry clocks are kept. Only state holding objects of the previous load is discarded — cached intel views (rebuilt on the next tick) and queued, not yet fought player battles (their assaults return to the pre-launch state and are re-queued from the reloaded fleets). Every other load (main-menu new game or load, pause-menu load, re-entering the map without a battle) resets. What must survive is in the save itself: ownership, fleets, stock, production queue, research. Loading therefore cannot replay or duplicate an action: goals and fleet roles are re-derived from the saved world within one decision interval. Stale world references are repaired by the rules that own them — production orders on a planet that no longer belongs to the faction are refunded and dropped (`ProductionService.tick`), invalid goals fail validation and are reselected.

Diagnostic histories are capped (replan events 200, assault reports 200); per-entity maps (assignments, peak strength, motion samples, carrier bindings, sightings) are pruned when their fleet or target disappears.

## Strategic posture (EnemyPlanService)

One assessment per faction scores its situation and publishes a posture that the other layers follow (so they no longer apply separate, contradictory thresholds):

| Score | Meaning |
|---|---|
| economy (0..1) | share of owned planets energy-short or below 40% satisfaction |
| defense (0..2) | hostile fleet strength within 25 cells of owned systems / own living fleet strength |
| expansion (0..1) | unhabited planets within the faction's reach (`EnemyReachService`) |
| offense (0..1) | reachable hostile planets × strength surplus after covering the threat |
| research (0..1) | affordable technologies waiting |

Personality weights multiply the scores; the highest weighted score is the **primary priority** (`stabilize`, `defend`, `expand`, `attack`, `research`, or `develop` when nothing scores ≥ 0.15). Posture consumers:

- `allowParallelColonization` (expansion available, threat within the personality's tolerance, economy stable) → `EnemyGoalService` parallel colonization objective;
- `allowAssault`, `homeGuardFraction` (personality home guard + 0.4 × threat), `assaultMinSurvival` → `EnemyFleetService` assaults;
- `militaryTargetMultiplier` (personality × (1 + threat)) and the ship cap → `EnemyEconomyService`;
- primary `attack`/`defend` → combat orders on every idle factory; `stabilize` → only emergency and core-infrastructure construction; `research` (or a research-heavy personality) → research buildings before defense and growth.

The neutral case (balanced, no threat, stable economy) reproduces the Phase 4 constants.

## Multiple objectives

Per faction, running concurrently without cancelling each other:

- economy (construction, production, deployment) — `EnemyEconomyService`;
- research — `EnemyResearchService`;
- fleet roles (garrison, intercept, retreat, regroup, assault) — `EnemyFleetService`;
- the **primary goal** (colonize / attack / defend / develop) — strategy → goal → capability → action → executor;
- a **parallel colonization objective** — `EnemyGoalService.getColonizationGoal`, evaluated with the same capability and action rules (`EnemyCapabilityService.evaluate`, `EnemyActionService.planColonizationAction`) and executed as a second executor action. When the primary goal changes from colonize to a military goal, its target and timer are handed over to this slot, so a colonization run is not cancelled by a defend/attack situation. It never duplicates the primary's target; the slot is cleared when the posture disallows it. With `concurrentColonizations: 2` (expansionist) the slot also runs beside a colonize primary.

Each colonizer carrier is bound to one colonization objective (`EnemyActionService.carrierTargets`), so two objectives never steer the same fleet; an objective without a free carrier produces or assembles its own. A carrier waiting without orders blocks a second assembly; carriers already travelling do not.

## Deadlock detection (EnemyProgressService)

Progress metrics per faction: owned planets, buildings, researched technologies, living combat ships. Detectors, each replanning only the affected objective and at most once per 60 s:

| Detector | Condition | Recovery |
|---|---|---|
| no_valid_action | primary action is `none` with the same reason for 60 s | abandon the primary goal; its colonize target / attack target is skipped for a while |
| repeated_failure | assemble/create/reinforce/colonize action current for 90 s without one successful execution | abandon the primary goal |
| stuck_fleet | a fleet with a movement order has not moved for 30 s | pipeline fleet: abandon the goal it serves; managed fleet: `EnemyFleetService.releaseFleet` |
| stagnation | no metric improved for 240 s while the posture still shows opportunities | abandon both goal slots so the pipeline re-selects |
| saturated | same, but no opportunity in reach | recorded only |

## Adaptive colonization reach (EnemyReachService)

reach = `AI_COLONIZATION_REACH` (60) × personality reach (expansionist 1.35) × adaptive bonus. The plan widens the bonus by 0.25 (up to 2×) after 60 s without any target in reach while unhabited planets exist and the faction is not threatened. Strategy, goal and plan all read reach from this service. Colonization timeouts grow with distance (120 s + 1.5 × travel time at 0.2 cells/s, at least 480 s).

## Personalities and difficulty

Data in `ai-personality.ts` and `ai-difficulty.ts`. Personalities never change rules or grant resources:

| | balanced | expansionist | militarist | technologist |
|---|---|---|---|---|
| score weights (eco/def/exp/off/res) | 1/1/1/1/1 | 1/0.8/1.6/0.7/0.9 | 1/1.2/0.8/1.6/0.9 | 1.1/1/0.9/0.8/1.6 |
| military target / ship cap | ×1 | ×0.8 | ×1.5 | ×0.9 |
| assault min survival / home guard | 50% / 30% | 60% / 30% | 35% / 25% | 60% / 35% |
| colonization reach / concurrent runs | ×1 / 1 | ×1.35 / 2 | ×1 / 1 | ×1 / 1 |
| factories per planet / parallel military production | 1 / no | 1 / no | 2 / yes | 1 / no |
| research buildings per planet | 1 | 1 | 1 | 2 (and research first) |

Difficulty affects decision quality: Normal/Hard judge interceptions and retreats with a battle forecast (real combat rules); Easy uses summed strength and decides fleet moves every 4 s instead of 2 s. `attackStrengthAdvantage` sets the accepted risk (with a forecast: the attackers must keep ≥ 1 − 1/advantage of their strength). The income multiplier remains the only economic advantage.

## Fleet movement ownership

Exactly one subsystem writes each AI fleet's `targetX/targetY`:

| Fleet | Owner |
|---|---|
| carries a living colonizer, or is the fleet of a current `move_to_target` / `defend` action (`StarMapAiTickService.getReservedFleetIds`) | `EnemyActionExecutor` (strategic pipeline) |
| every other AI fleet | `EnemyFleetService` (roles below) |
| anything neither manages | `EnemyAiService` legacy pursuit (15-cell acquire range, only clears targets it set) |

`EnemyAiService` receives the union of pipeline and fleet-service fleets as `reservedFleetIds`. Because `EnemyFleetService` decides on the first frame, the legacy pursuit is dormant for generated games; it is kept as a fallback and for its unit-tested behavior.

## Fleet roles (EnemyFleetService)

Decided every 2 s per faction, using `ShipService.calculateFleetStrength` (living ships only). Hostile = other non-neutral team.

| Role | When | Order |
|---|---|---|
| retreat | the hostiles within 14 cells would beat the fleet and the own fleets within 7 cells (forecast; Easy: summed strength), and the fleet is not in a Spaceport system | primary Spaceport system |
| regroup | living strength < 50% of the fleet's peak; held until back to 80% | primary Spaceport system (where new ships are deployed into parked fleets) |
| intercept | hostile within 25 cells of an owned system (or 14 of a free fleet) that the nearest free fleets (up to 4, plus those already intercepting it) are judged able to beat — battle forecast on Normal/Hard, summed strength × `attackStrengthAdvantage` on Easy | follow the target; dropped after 90 s, when the target is > 40 cells from AI territory, or when the group no longer outguns it |
| assault | planned every 10 s when none is active: a reachable hostile planet the group can take according to a battle forecast (see [Planet Capture](./planet-capture.md#ai-assaults)) | target system; launch when gathered |
| garrison | default | the primary Spaceport system first, then one fleet per other owned system; posts are kept while valid |

The primary Spaceport system is the first Spaceport by (system id, planet id) — the same ordering `EnemyEconomyService` uses for deployment.

## Strategic combat decisions

- **Threat / opportunity significance:** `EnemyStrategyService` only chooses `defend` or `attack` over a hostile fleet worth at least 25% of the faction's total fleet strength. Smaller intruders (a lone scout) are handled by fleet interception and cannot hold the faction in `defend`/`attack` and block expansion.
- **Attack hysteresis:** the strategy starts an attack only with `attackStrengthAdvantage`; the action layer keeps it while the attacking fleet is not weaker than the target and returns `none` (`target_too_strong`) once it is. The released fleet falls back to fleet operations (retreat/regroup).
- **Defend:** sent only if the fleet has at least 50% of the threatening fleet's strength (planet defenses help); otherwise `none` (`threat_too_strong`).
- **Fleet choice:** attack/defend use the faction's strongest living fleet that carries no colonizer.
- Combat itself is never simulated by the AI: battles start on shared galaxy cells (`StarMapBattleDetectionService`) and are resolved by the battle screen; `StarMap.applyBattleResult` writes the outcome (ships flagged `destroyed`, wiped fleets `destroyed`), which the next decisions see as lost strength.

## Game rules the AI economy relies on

Verified in code; if any of these change, revisit `EnemyEconomyService`:

- **Credits are the only currency anything spends** (ship cost, building price). Raw materials are produced but never consumed; research points are spent only by the research tree; building `maintenanceCost` is shown in the economy breakdown but never deducted. Credits therefore cannot go negative through upkeep — the real economic failure mode is satisfaction loss from an energy deficit (−1/s) leading to rebellion.
- Credit income is `population × 0.1 × satisfaction`; population is capped by housing capacity, so **housing is the growth building**.
- Workforce shortages only scale resource production (`EconomyService.calculatePlanetEconomy`), never energy output or satisfaction.
- Ships are built one order at a time per Spaceship Factory (build time `cost × 0.1 / 0.5`: colonizer 20 s, fighter 15 s) into the faction-wide stock. Leaving the stock requires a Spaceport. `FleetAssemblyService.reinforceFleet` does not check fleet location, so the AI only reinforces fleets that are physically in a Spaceport system.
- AI-assembled fleets move at 0.2 cells/s on the galaxy map (speed 4 / 10 / `GALAXY_MOVEMENT_CELL_SIZE_VW` 2, independent of window width).

## Construction and spending policy

`EnemyEconomyService.tryConstruct` (also used by the executor's `develop` action) places at most one building per faction per 2 s of game time; a search that finds nothing also waits one interval. Rule tiers, each tried over all owned planets (ascending system id, then planet id):

| Tier | Condition | Builds | Reserve |
|---|---|---|---|
| E1 | planet energy shortage | power | ignored |
| E2 | planet workforce shortage | housing | ignored |
| I1 | faction has no Spaceship Factory | Spaceship Factory | ignored |
| I2 | factory but no Spaceport | Spaceport | ignored |
| D | planet has no defense building | defense (turret) | respected |
| G | planet has no housing, or population ≥ 90% of capacity | housing | respected |
| R | planet has no research building | research | respected |
| P | wealthy (credits > 3000) and planet has no factory | Spaceship Factory | respected |

- **Safety:** the planet economy is evaluated with the candidate added; it is placed only if it does not create or worsen an energy deficit, nor a workforce deficit (power buildings are exempt from the workforce check because workforce never scales energy output — otherwise a fresh colony deadlocks between housing and power). If the safety check fails, an enabling power/housing building (up to two levels) is built first.
- **Reserve:** optional tiers and military production leave credits for the faction's committed needs: the next colonizer (when an unhabited planet exists and none is in stock, fleets or the queue), a missing Spaceport, and the next military ship. An unaffordable rule falls through to the next, so a shortage changes the decision instead of deadlocking.
- Research unlocks, credits and grid placement (including ore proximity) are always checked.

## Military production and deployment

- **Target strength** (fleets + stock + queued, living ships): `80 + 60 × planets`, raised to 1.5 × the strength of hostile fleets within 25 cells of AI systems. When wealthy (credits > 3000) the target is multiplied by `2 + floor(credits / 3000)`, turning surplus credits into military.
- **Count cap:** 24 combat ships, 60 when wealthy — production is bounded regardless of income.
- Normally one combat order at a time (factory queues stay free for colonizers); when wealthy every idle factory gets one order per decision.
- **Hull choice:** strength per credit is nearly flat across hulls and build time is proportional to cost, so the binding limit is the ship cap. With a comfortable budget the AI builds the strongest unlocked hull costing at most a quarter of its budget; when credits are tight, the best strength per credit. Research therefore pays off by unlocking heavier hulls.
- **Deployment:** stocked combat ships join the smallest parked fleet in the primary Spaceport system that has fewer than 12 living ships, otherwise a new fleet is created there. Reinforcement through the `reinforce_fleet` action also requires the fleet to be in a Spaceport system — ships never teleport. A faction that lost every fleet recovers through the same path.

## Research (EnemyResearchService)

- Uses `ResearchService.canResearch` / `researchTechnology` — the same authoritative rules as the player's research tree (prerequisites, research-point cost, no duplicates). Research is an instant purchase, so there is no in-progress state; one technology per 5 s decision.
- Score = (direct value + 0.5 × best value it makes researchable next) / cost. Direct value: a combat hull stronger than the best unlocked one (strength ratio × military need), economically useful buildings (fusion plant, larger housing, research lab), small value for sensor bonuses. Military need rises to ×3 when hostile fleets stronger than the faction's are near its systems.
- When nothing is affordable the service waits; it never issues an attempt the research service would reject. Research points come from research buildings built by the economy manager (one per planet, upgraded to the full laboratory once researched).

## Colonization

1. **Target:** `EnemyGoalService` scores unhabited planets by proximity, habitability and size; systems where another faction already owns a planet score half. Targets farther than `AI_COLONIZATION_REACH` (60 cells, shared with the strategy's expansion check) from the faction's territory are ignored. Planets targeted by another AI faction are skipped.
2. **Prerequisites:** missing factory or Spaceport → the action layer returns `develop` (reasons `missing_factory_for_colonizer` / `missing_spaceport_for_assembly`), and the economy service builds them.
3. **Production:** `produce_colonizer` queues one colonizer.
4. **Assembly:** `assemble_fleet` puts the colonizer into a fleet parked at a Spaceport, or creates a new fleet there (also when the faction has no fleet at all). Ships never teleport into distant fleets.
5. **Travel:** `move_to_target` to the target system; the carrier is reserved so nothing else retargets it. No-op once parked at the destination.
6. **Arrival / colonize:** arrival is judged on the galaxy map (`Math.floor(fleet.x/y)` equals the system cell). The executor colonizes with the colonizer-carrying fleet, removes that colonizer, sets `planet.factionId`, and retires the fleet if it is now empty. The planet is no longer `unhabited`, so this runs exactly once.
7. **Next objective:** the goal becomes invalid and the next goal is selected on the following goal tick.

**Failure recovery:** a colonization goal still unfinished after 480 s (production + assembly + ~300 s maximum travel, with margin) is abandoned and its target is skipped for 600 s. A lost colonizer is simply rebuilt while the goal is valid; a faction with no remaining targets gets no colonize goal and keeps developing through the economy service.

## Change reporting

`tick` methods return "game state changed this frame"; the result drives Angular change detection and the autosave dirty flag. No-op movement orders and repeated attack/defend confirmations return `false`.

## Save/load

AI pipeline state is in-memory only and fully rebuilt from the game snapshot. `StarMap.loadGame` calls `StarMapAiTickService.resetAiPipeline()`, which resets every layer including the executor and the economy service — except on a battle-screen return, which keeps AI memory (see [Save/load and bounded state](#saveload-and-bounded-state)). Failed-target memory and goal timers are not persisted in the save (a genuine reload gives stuck targets a fresh attempt).

## Known limitations

- All generated AI factions share team 2 (no AI-vs-AI war); they do not share intel with each other. AI planet battles against non-player defenders are auto-resolved with the simplifications listed in [Planet Capture](./planet-capture.md#auto-resolver-battle-auto-resolvets).
- AI-vs-AI conflict is still absent (shared team), so personalities compete for land but never fight each other.
- Resource efficiency (credits spent / earned) stays at 5–10% in 15–20 minute simulations: without upkeep, income outgrows every sink: after ~10 minutes AI factions hold 100k–300k unspent credits even with the wealth-driven military and factory rules. Fixing this needs either game-side upkeep or AI research/stronger ship tiers.
- Offensive planning is limited to one assault at a time per faction against targets within colonization reach; there is no multi-front campaign or staging of reinforcements.
- Garrisons create one small fleet per owned system; there is no fleet merging.
- Once nothing valuable remains, research also buys zero-value technologies (e.g. ones unlocking ships it already has); points have no other use.

## Tests

- Per-layer unit tests: `enemy-*.service.spec.ts` (including economy, fleet, research, invasion, plan, progress and intel services).
- `ai-acceptance.spec.ts` — real `StarMap` sessions through `NewGameService` / `SaveGameService`: five-AI new game and independent planning, save/load during AI activity (no duplicate ships, fleets, orders or technologies; progress continues), autosave/dirty cadence, fog of war in a real game, and the F9 debug panel.
- `ai-simulation.spec.ts` — headless multi-minute games on generated galaxies mirroring the game-loop order (without battles). Scenarios: 2 and 5 AIs; small, medium and large maps; with and without player fleets; fixed and jittered frame times; mid-game save/load; minimal starting infrastructure; energy-deficit homeworld; homeworld without construction space; no credits for a Spaceport; a sudden credit shortage; no valid expansion target; loss of every fleet. Phase 6 adds a fog-of-war compliance check to every scenario (colonize and assault targets must be charted, interception targets visible or remembered), 40-minute games on small, medium and large maps, bounded-state checks, and a maximum-load performance test (1 human + 5 AIs, 250+ living ships: about 0.03 ms of AI work per frame, worst frame under 4 ms). Phase 5 adds parallel colonization under a defend strategy, a stuck-fleet scenario, an evaluation league (small Easy vs Hard, medium with 3 AIs for 20 minutes, large with 5 AIs; assertions: no inactive 5-minute window, planet growth, ≥ 12 technologies, ≤ 3 deadlock replans per faction, Hard outperforms Easy), personality comparisons (militarists build more warships, expansionists colonize at least as much, technologists finish research sooner) and a large-map adaptive-reach regression. Phase 3 scenarios add 15-minute research progression, fleet assembly/reinforcement, an enemy patrol through AI territory, a weak intruder plus a much stronger fleet near AI homes, and injected heavy losses. Assertions cover research prerequisites/no duplicates/non-negative points, heavier hulls after research, combat ships only after a Spaceport and only unlocked types, ship-count accounting and unique ship ids, never contacting a stronger fleet with weaker forces, retreat of an exposed fleet, interception of weak intruders, regroup after losses, per-faction scheduling, paced construction, homeworld stability, non-negative credits, infrastructure and colonization deadlines derived from the rules above, colonizer accounting, development of every owned planet, energy balance, military production and deployment, colonizer-fleet order ownership and a low rate of "state changed" frames.

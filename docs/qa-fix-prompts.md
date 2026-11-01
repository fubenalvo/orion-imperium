# QA Fix Prompts (2026-11-01)

Standalone task prompts from the QA session of 2026-11-01. Each section below is meant to be copied as-is into a coding-agent session: it states the problem, the evidence, the files involved, the task and the acceptance criteria. One prompt = one bug or one balance question.

**Evidence source.** Headless AI games run with a temporary probe built on the `ai-simulation.spec.ts` harness (`runScenario` with `resolvePlayerFleetBattles` and `continueAfterOutcome`, snapshots every 5 minutes). The stand-in player is passive (builds nothing, never negotiates). Runs:

| Label | Map | AIs | Difficulty | Civilizations | Duration |
|---|---|---|---|---|---|
| M3N | medium, 15 systems | 3 (expansionist, militarist, technologist) | Normal | yes | 60 min |
| L5H | large, 19 systems, seed 777 | 5 (expansionist ×2, militarist, technologist, balanced) | Hard | yes | 45 min |
| S2E | small, 8 systems, seed 99 | 2 (technologist, balanced) | Easy | no | 40 min |

No interactive (browser) play session was done; UI/onboarding findings are not covered here. Related backlog: [Review Backlog](./review-backlog.md). When a prompt is done, remove it from this file and update the documentation it touches, as `AGENTS.md` requires.

---

## 1. Done — AI over-expansion and conquest into upkeep arrears

Fixed on 2026-11-01: colony brake (`canSupportNewColony`), conquest brake (`canSupportCapture`), no upkeep for mining stations on depleted asteroids. Measured on the 60-minute medium and 45-minute large Hard runs: 0 arrears ticks for every AI (before: up to 1631), captures still happen. A per-colony "must pay for itself" rule was measured and found unnecessary. See [AI Pipeline](./ai-pipeline.md#colonization), [Planet Capture](./planet-capture.md#ai-assaults), [Territory](./territory.md). Side effect to watch: with no AI stuck in arrears, late-game treasuries grow faster (prompt 8).

---

## 2. [Bug/UI] Star system panel always shows status "UNEXPLORED"

**Problem.** The system info panel shows `Status: UNEXPLORED` for every system, including the player's home system (backlog item 7).

**Cause.** The value is hard-coded in `src/app/components/star-map/star-map-system-info/star-map-system-info.component.html` (line ~22: `<span class="ui-stat__value">UNEXPLORED</span>`).

**Task.** Bind the status to real state: use the existing exploration / fog-of-war data (see `docs/star-map-terrain.md`, `StarMapSensorService` and the explored/charted flags on systems) to show at least *Unexplored*, *Explored* and, where it makes sense, the owner (e.g. *Your system*, *Enemy*, *Contested*). Use only information the player legitimately has.

**Acceptance.**
- Home system shows an explored/owned status from the first frame.
- An uncharted system still shows *Unexplored*; after a player fleet visits it, the status changes.
- A component test covers the three cases.
- Remove backlog item 7 from `docs/review-backlog.md`.

---

## 3. Done — Ship build time does not scale with order quantity

Fixed on 2026-11-01: a request for N ships is queued as N single-ship orders (full price charged once, `paid` shared per order), so total time = unit time × N, ships arrive one by one and a cancel refunds only unbuilt ships. Old multi-ship orders are split on load. See [Ship Production](./ship-production.md#one-ship-per-order).

---

## 4. [Balance] Easy difficulty eliminates a new player too early

**Problem.** In S2E (small map, 2 Easy AIs) a passive player lost their homeworld at **minute 16**; on Normal/medium it took 32 minutes, on Hard/large 35. A first-time player who is still learning the planet surface and the energy rule can easily play close to passively for the first 10–15 minutes, so Easy is harsher than its label. Small maps make it worse because the AI is close.

**Files.** `src/app/components/star-map/ai-difficulty.ts` (`AI_DIFFICULTY_PROFILES.easy`: `attackStrengthAdvantage 1.6`, `incomeMultiplier 0.75`, `reactionInterval 2`), `src/app/components/star-map/enemy-invasion.service.ts`, `src/app/components/star-map/enemy-plan.service.ts`, `src/app/services/game-outcome.service.ts`.

**Task.** Give Easy (and to a lesser degree Normal) an early-game grace period against the human player: e.g. no planet assaults on the player before a difficulty-dependent game time (Easy ~25 min, Normal ~12 min, Hard none), and/or a higher strength advantage required to attack the player's homeworld specifically. Use the saved game clock so it survives save/load. AI-vs-AI behavior must not change.

**Acceptance.**
- Simulation: small map, 2 Easy AIs, passive player survives at least 25 minutes (several seeds); Hard behavior unchanged.
- The grace period is visible to the player somewhere (e.g. a diplomacy/notice hint) or at least documented.
- Update `docs/ai-pipeline.md` (personalities and difficulty) and `docs/new-game-generation.md` (AI difficulty).

---

## 5. [Balance] Heavy hulls are less cost-efficient than destroyers; the AI builds a destroyer monoculture

**Problem.** Across all runs the AIs built mostly destroyers (22–31 per faction), a few cruisers and dreadnoughts, and **never a battleship or carrier**. Per `docs/battle-rules.md`, damage per second is independent of `fireRate` (reference volley), so efficiency is roughly `attack / cost`. From `ship-data.json` (raw cost is always 3× credit cost, so ratios hold for both):

| Hull | attack / credit | (HP + shield) / credit | upkeep / cost |
|---|---|---|---|
| fighter | 0.20 | 1.07 | 5% |
| corvette | 0.18 | 1.17 | 6% |
| destroyer | 0.17 | 1.12 | 8% |
| cruiser | 0.15 | 1.10 | 8% |
| battleship | 0.13 | 1.00 | 9% |
| battlecruiser | 0.15 | 0.77 | 9% |
| dreadnought | 0.13 | 0.92 | 10% |

Heavy hulls are 20–35% worse per credit in firepower, not better in durability, and pay progressively more upkeep. Defense barely helps them because it is subtracted once per reference volley of a whole stack, not per shot. The only advantages are range and research-gated bonuses, so late-tech hulls feel like a downgrade.

**Files.** `src/app/components/star-map/ship-data.json`, `docs/battle-rules.md`, `src/app/components/battle-screen/battle/` (damage formula), the AI hull choice in `src/app/components/star-map/enemy-economy.service.ts` (military production).

**Task.** Decide and implement a progression where each tier is at least as cost-efficient as the previous in *some* dimension that matters. Options (pick one, justify it in the docs): (a) raise HP/shield per credit of heavy hulls (e.g. dreadnought ≥ 1.3 EHP/credit), (b) make defense meaningful against light stacks (e.g. subtract defense per attacking ship in the stack, capped), (c) give heavy hulls a role bonus (planet assault / station damage multiplier, range that matters in battle). Keep upkeep progression as a deliberate counterweight but not a double penalty.

**Acceptance.**
- A small headless battle comparison (auto-resolve, equal credit budgets) shows no single hull dominating every matchup; document the numbers.
- AI simulations: hull mix after 40 minutes includes at least two classes above destroyer for Normal/Hard factions.
- Update `docs/battle-rules.md` and `docs/ship-production.md`.

---

## 6. [Balance] The carrier is never worth building

**Problem.** The carrier has attack 30 for 500 credits (0.06 attack/credit, a third of a destroyer) and its only special is Shield Pulse (restores `shieldRegen` to allies in reach, replacing its volley). No AI built one in ~2.5 hours of simulated play. See prompt 5 for the efficiency table.

**Files.** `src/app/components/star-map/ship-data.json`, `docs/battle-rules.md` (Carrier Shield Pulse), battle AI in `src/app/components/battle-screen/battle/`, AI hull selection in `enemy-economy.service.ts`.

**Task.** Make the carrier a real support choice: e.g. Shield Pulse restores a percentage of max shield (not the flat `shieldRegen`) to every ally in reach, or the carrier launches fighter stacks at battle start, or it grants a passive shield-regen aura that does not cost its volley. Then let the AI include carriers in fleets above a size threshold.

**Acceptance.**
- Auto-resolve comparison: a fleet with one carrier beats the same-cost fleet without it in a mid-size battle.
- AI simulations: carriers appear in Normal/Hard fleets by minute 40.
- Update `docs/battle-rules.md` and `docs/ai-pipeline.md` (military production).

---

## 7. [Balance/Diplomacy] AI–AI wars stop early; the mid/late game is a peaceful build-up

**Problem.** In L5H all five Hard AIs were at peace with each other from about minute 15 to the end, and there were **0 AI-vs-AI battles in 45 minutes**. In M3N there were 8, all involving the militarist. Meanwhile the human starts at war with everyone (`INITIAL_WAR_LOCK_SECONDS` = 4 min) and is the natural common target. The AIs then just accumulate resources (see prompt 8).

**Files.** `src/app/components/star-map/enemy-diplomacy.service.ts` (personality table around lines 125–145: `peaceBias`, `warRatio`, `maxWars`, `warOpinionMax`; war decisions; AI–AI settlement), `src/app/components/star-map/diplomacy.ts` (opinion drift, truce), `docs/diplomacy.md`.

**Task.** Add pressure toward AI–AI conflict over time: e.g. opinion of a peace partner drifts down when it is a strong neighbour (border contact, territory overlap, relative growth), war appetite rises when the AI has a large idle fleet or a large treasury, and the AI–AI settlement becomes less attractive for militarists. The human must not become a *less* likely target as a side effect only — keep the existing human-facing rules.

**Acceptance.**
- Simulation: large map, 5 AIs, 45 min: at least two distinct AI–AI wars after minute 15 and at least one AI–AI planet capture (several seeds).
- No faction is at war with more than `maxWars` + 1 parties.
- Update `docs/diplomacy.md`.

---

## 8. [Balance] Late-game credit glut returns on Hard

**Problem.** At minute 30 AI treasuries are fine (7–50k), but afterwards they balloon: L5H minute 45 — 406k, 184k, 135k credits; M3N technologist 30k → 121k between minutes 55 and 60. The AI runs out of spending targets (research tree done, fleet reaches its size limit — the militarist plateaued at 35 ships).

**Files.** `src/app/components/star-map/enemy-economy.service.ts` (spending policy, military production limits), `src/app/components/star-map/enemy-research.service.ts`, `docs/economy.md`, `docs/ai-pipeline.md`.

**Task.** Give the AI meaningful late-game credit sinks and use them: upgrade/replace old hulls with heavier ones (depends on prompt 5), build stations and defenses on border planets, fund wars (prompt 7), use the Trading Post to convert credits when raw-starved (prompt 10). Optionally add a late-game sink for everyone (e.g. repeatable "future tech" research with small bonuses) — if so, also for the human.

**Acceptance.**
- Simulation: Hard large map 45–60 min: no AI holds more than ~5 minutes of its own gross income in credits for longer than 5 minutes.
- Economy validation assertions still pass.
- Update `docs/economy.md` (upkeep / AI spending policy) and `docs/ai-pipeline.md`.

---

## 9. [Balance] Raw materials pile up in long games

**Problem.** Backlog item 10 noted 26–59k raw materials at minute 30; longer runs are much worse: M3N minute 60 — 89k, 93k and **210k**; L5H minute 45 — 128k–203k. Raw income keeps scaling with mines while spending plateaus.

**Files.** `src/app/services/economy.service.ts` (extraction), `src/app/components/star-map/planet-data.json` (mine outputs), `src/app/components/star-map/ship-data.json` (raw costs), `src/app/components/star-map/enemy-economy.service.ts` (AI mine construction), `docs/economy.md` (deposits and depletion).

**Task.** Pick one approach and justify it: faster deposit depletion at high extraction, a raw-material upkeep for ships/stations, diminishing returns per mine on the same planet, or having the AI stop building mines when its raw stock exceeds N minutes of its own raw spending (and convert surplus through the Trading Post). Coordinate with prompt 10 so starved factions do not get worse.

**Acceptance.**
- Simulation: no AI holds more than ~10 minutes of its own raw spending in stock at minutes 30 and 60 (medium and large maps).
- Update `docs/economy.md`; update backlog item 10 in `docs/review-backlog.md`.

---

## 10. [Balance] Raw-material supply is very uneven between factions

**Problem.** In the same L5H game where others sat on 100–200k raw, the second expansionist (`enemy5`) stayed at 0–5k raw from minute 20 to 45 and only reached 7 planets. Deposit luck decides a faction's whole military/expansion capacity; there is no catch-up path besides the Trading Post (which the AI rarely uses for this).

**Files.** `src/app/services/galaxy-generator.service.ts` (deposit generation), `src/app/components/star-map/enemy-economy.service.ts`, `src/app/components/star-map/enemy-mining.service.ts` (asteroid mining stations), `src/app/components/star-map/trade.ts`, `docs/economy.md`, `docs/territory.md`.

**Task.**
1. Measure deposit distribution per starting position (total raw within N jumps of each homeworld) across several seeds; add a fairness constraint to galaxy generation if the spread is large.
2. Make a raw-starved AI actively fix it: prioritize asteroid surveying and mining stations, colonize deposit-rich planets, and use the Trading Post to buy raw with surplus credits.

**Acceptance.**
- Generator test: the raw within reach of each homeworld differs by at most a defined ratio (e.g. 1.5×) for every seed in the test set.
- Simulation: no AI spends more than 5 consecutive minutes below the raw cost of its cheapest useful warship after minute 10.
- Update `docs/new-game-generation.md` and `docs/economy.md`.

---

## 11. [Design/UX] Expansion barely increases net credit income — decide and communicate

**Problem.** AIs with 13–16 planets spend 75–95% of their gross income on upkeep; their net credit income is about the same as the passive player's single homeworld (~85 credits/s net). Colonies pay off in population, raw materials, research and territory, but not in credits. A player who watches the credit counter will conclude expansion is not worth it.

**Files.** `src/app/services/economy.service.ts` (empire upkeep scale, colony administration), `docs/economy.md` (upkeep), the header resource tooltip / planet info panel components under `src/app/components/star-map/`.

**Task.**
1. First break down the AI upkeep in the simulation (buildings vs ships vs stations vs administration) to see what actually eats the income; record the result in `docs/economy.md`.
2. If colony administration / empire scale is the main cost, tune it so a developed colony is net positive in credits after a few minutes; if fleet upkeep dominates, leave it (it is the intended sink).
3. Either way, show the player a per-planet net contribution (income − upkeep − administration) on the planet info panel and an upkeep breakdown in the credit tooltip.

**Acceptance.**
- The breakdown numbers are documented.
- The player can see on screen why their net income changes when they colonize.
- Update `docs/economy.md` and `docs/ui-styling.md` if new UI is added.

---

## 12. [Test infra] Make the long-game QA probe a permanent, opt-in report

**Problem.** The probe used for this QA session (5-minute snapshots of planets, ships, credits, raw, techs, population and relations per faction, plus ownership history and per-faction traces) was a throwaway copy of the `ai-simulation.spec.ts` harness. It found issues the existing suites miss (prompts 1, 7, 8, 9) because those run ≤ 40 minutes, mostly without civilizations, and assert per-run totals rather than trends.

**Files.** `src/app/components/star-map/ai-simulation.spec.ts` (`runScenario`, `leagueRows`, `economyRows`), `docs/ai-pipeline.md` (Tests).

**Task.**
1. Export the harness helpers into a shared test utility (e.g. `ai-simulation.harness.ts`) so other specs can reuse them without copying 650 lines.
2. Add an opt-in long-game report spec (skipped unless an env flag such as `QA_LONG=1` is set) that runs 60-minute medium/large games with civilizations and prints a time-series table to stdout.
3. Fix the research currency key in any snapshot (`research`, not `researchpoints`).
4. Promote the cheap, stable checks into the regular suites: arrears limit with civilizations (prompt 1), at least one AI–AI war on 5-AI maps (prompt 7, once fixed).

**Acceptance.**
- `ng test` time does not grow noticeably without the flag.
- With the flag, the report prints in under ~2 minutes.
- Update `docs/ai-pipeline.md` (Tests).

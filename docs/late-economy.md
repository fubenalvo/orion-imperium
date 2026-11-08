# Late-Game Credit Surplus

Status: **implemented (2026-11-02).** This document records why the comfort need exists, how it and the AI safeguards work, how the values were set, and what was measured. The rules themselves are described in [Economy](./economy.md#comfort) (comfort, satisfaction target) and [AI Pipeline](./ai-pipeline.md) (comfort tier, raw purchases, reserve exit, expansion brake); those are the sources of truth for current behavior.

**Goal:** from the mid game on, credits stop piling up unspent, while the opening stays as it is and no AI personality gets stuck.

Related: [Economy](./economy.md), [AI Pipeline](./ai-pipeline.md), [Dyson Swarm](./dyson-swarm.md#tuning-phase-7) (the late-game sink measured first), [Planet Surface](./planet-surface.md) (building space), [Planet Capture](./planet-capture.md) (after-capture satisfaction, rebellion, conquest brake).

## The problem, measured

All measurements: headless 90-minute games (`ai-simulation.spec.ts`, 1/10 s frames, passive stand-in player). Scenarios: medium map with 3 AIs (technologist, militarist, balanced) and large map (seed 4242) with 4 AIs (balanced, expansionist, militarist, technologist).

**Where the money came from.** Medium map, the richest empire (balanced):

| minute | planets | population | gross income /s | from population | expenses /s | credit stock |
|---|---|---|---|---|---|---|
| 30 | 7 | 9k | 800 | 95% | 590 | 18k |
| 60 | 11 | 56k | 4,900 | 98% | 3,600 | 245k |
| 90 | 13 | 140k | 12,000 | 99% | 8,200 | 4.1M |

- Income is almost entirely `population × 0.085`. From minute ~45 on, housing drives population, and with it income, faster than costs rise.
- Satisfaction was 100% on every planet all game: energy added +1/s, the worst planet type cost −0.08/s. Planet type and social buildings barely mattered.
- At minute 90 every empire kept 18–41% of its gross income as net surplus.

**Not every surplus has the same cause.** On the large map the militarist held 1.0M credits with ~4k raw materials: raw materials bound its fleet, and the AI never used the Trading Post exchange.

## Experiments with housing capacity (rejected)

Large map, housing capacity changed for the whole game:

| variant | credit stock at 90 min | stuck AIs |
|---|---|---|
| A — baseline | 360k – 1.0M | none |
| B — all residential capacity halved | 0 for three AIs, negative net | three AIs in lasting arrears; the expansionist built no warship |
| C — Medium and Large halved | 0 for two AIs | balanced and expansionist in arrears |
| D — Large halved (700 → 350) | 74k / 0 / 1.0M / 176k | the expansionist in arrears; the militarist still holds 1.0M |

Rejected because it hits the opening (the homeworld starts with a Large block), creates a poverty trap (income falls, per-planet costs do not, and the AI only builds housing with a non-negative net), and does not reach the raw-bound militarist. The optional milder cut (Large 700 → 500) was **not needed** and was not made.

## What was built

1. **Comfort need** ([Economy](./economy.md#comfort), `comfort.ts`): population above a free amount needs comfort points from Park / School / Hospital / Entertainment Center, with a full-set bonus and planet-type factors. People the comfort does not reach count at the floor in the planet's satisfaction target. The comfort buildings carry a high upkeep.
2. **Target-based satisfaction** (replaces the drift sum): satisfaction moves toward a target at 1/s. Energy only punishes (a factor on the target); habitability and building morale are offsets above the free population.
3. **AI comfort and safeguards** ([AI Pipeline](./ai-pipeline.md#construction-and-spending-policy)): the comfort tier, housing that waits for comfort and counts its expected net income, research value for comfort technologies, the stricter colony/capture brake, and the reserve exit.
4. **AI raw purchases** at the Trading Post ([AI Pipeline](./ai-pipeline.md#raw-purchases-and-the-reserve-exit)).

Saves need no migration: comfort, need and target are derived, never stored.

## Values and why

| value | set to | reason |
|---|---|---|
| free population | 5,000 | 3,000 (plan) cut the 30-minute income by up to 12%; 4,000 left the opening intact but slowed an Easy balanced AI to 9 technologies in 40 minutes (AT-12 needs 11). At 5,000 the 30-minute numbers equal the baseline exactly. |
| people per comfort point | 500 | 1,000 and 700 left late net shares of 20–25%; 500 compensates the higher free population. |
| type factors | earthlike 1, gas giant 1.3, Mars-like 1.4, desert 1.6, Venus-like 1.6, ice 2 | the plan's start values; stricter factors were not needed. |
| comfort points | Park 1, School 2, Hospital 3, Entertainment 4 | plan |
| comfort upkeep (points) | 25 / 45 / 65 / 85 | about 21 points per comfort point; was 5–25 with morale |
| full-set bonus | +15% | plan |
| floor | 0.6 | kept. It must stay above the AI's stability threshold (40), or an AI with neglected planets would stay in its `stabilize` posture. |
| target shape | `1 − (1 − floor) × uncovered share` | the plan's `max(floor, coverage)` dropped a planet to 60% as soon as it passed the free population by one person (a cliff), and a linear-in-coverage version had the same cliff. Weighting by the uncovered share of the population makes the loss grow smoothly and makes every point count. |
| colony runway deficit cap | 2% of gross income | a full treasury let an expansionist settle colonies into a permanent −100…−160/s. |

## Results

Same scenarios, minute 90, net as a share of gross income and credit stock in minutes of gross income:

| | baseline net | now net | baseline stock | now stock |
|---|---|---|---|---|
| medium technologist | 41% | 21% | 6.7 min | 4.0 min |
| medium militarist | 29% | 21% | 4.0 min | 3.9 min |
| medium balanced | 32% | 13% | 5.7 min | 2.2 min |
| large balanced | 23% | 3% | 2.8 min | 0.1 min |
| large expansionist | 32% | 15% | 1.0 min | 0.8 min |
| large militarist | 18% | 0% | 2.2 min | 0.0 min |
| large technologist | 34% | 12% | 2.7 min | 0.4 min |

- **Opening:** Spaceport times, first-colony times and 30-minute incomes are identical to the baseline.
- **No stuck AI:** no arrears, no rebellions, no rejected orders; every faction researched ≥ 24 technologies and built warships. Late satisfaction is 90–97% on average (planets above the free population carry the industry and type offsets and some uncovered people).
- **Not every surplus goes away.** The medium militarist and technologist still hold ~1M credits: their navies sit at the ship cap (`WEALTHY_SHIP_CAP`) and they are not raw-bound, so neither comfort nor raw purchases reach the rest. The Dyson Swarm is the sink meant for that ([Dyson Swarm](./dyson-swarm.md)).
- **Wide empires feel comfort most:** the empire upkeep scale and the administration share make comfort dearer for many planets. A wide empire ends near a zero net; the stricter colony brake and the reserve exit keep it out of arrears.
- Militarists research fewer technologies than before (24 vs 34 on the medium map): their research credits now compete with comfort.

## Problems found while tuning

Each is now covered by a rule (see [AI Pipeline](./ai-pipeline.md)):

- With the rule but no AI support, most AIs sank into a poverty trap by minute 30 (capital at 60%).
- The AI first covered tiny needs with an Entertainment Center; the comfort choice now scores the *needed* points per upkeep.
- Comfort and housing built on the treasury runway pushed a wide expansionist into a lasting deficit; they now use the `net` upkeep tier with their expected income gain.
- Without that income gain, a faction with full planets never built housing again at a zero net.
- Research reserved the credits of every next technology, so growth housing never fit; once comfort is needed, growth housing ignores the research credits.
- Colonizers ordered in good times settled later into a deficit; the brake now runs again when a colonizer arrives.

## Acceptance test

`ai-simulation-late-economy.long.spec.ts`, "AI simulation — late economy" (large map, 4 personalities, 90 minutes; runs with `npm run test:long`, not in the default `npm test`; ~200 s): for every AI ≤ 10 arrears ticks, no rebellion, no rejected order, negative-net streak ≤ 300 s, ≥ 20 technologies, warships, ≥ 3 colonies; net ≤ 20% of gross income at minute 90; every AI has planets that need comfort. The opt-in report (`ORION_ECONOMY_REPORT=1`, both scenarios, `ORION_ECONOMY_MINUTES` for other sample minutes) prints per-faction samples (income, expenses, credits, coverage, the three largest planets) and summaries (opening times, colonies, gains and losses). The Dyson acceptance test still passes.

## Decisions (2026-11-02)

- **Comfort buildings:** Park, School, Hospital and Entertainment Center, each with its own value; a full set gives an extra bonus.
- **Planet-type factors:** ×1 … ×2, stricter only if measurements favored it (they did not).
- **Display:** the comfort need is always visible on the planet screen.
- **AI raw purchases:** accepted; the militarist's surplus becomes a larger navy.
- **Comfort floor:** 60%, flexible; kept.
- **Housing cut:** not the main lever (experiments A–D); not made.

## Open points

- The remaining surplus of AIs at their ship cap. Raising the cap or giving rich AIs another sink (e.g. Dyson building for more personalities) would address it.
- Whether the player finds comfort a chore: the display is always on, and a built comfort building keeps working without attention.

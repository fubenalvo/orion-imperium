# Dyson Swarm (Design — not implemented)

Status: **design agreed on 2026-11-02.**

| Phase | State |
| --- | --- |
| 0. Station construction time | implemented ([Territory](./territory.md#construction)) |
| 1. Ring geometry | implemented (this section: [Ring geometry](#ring-geometry)) |
| 2. Technology, ship, deployment, anchor panel | implemented ([Implementation (phase 2)](#implementation-phase-2)) |
| 3. Upkeep and bonuses | implemented ([Anchor bonuses](#anchor-bonuses); the upkeep came with phase 2) |
| 4. Victory and news | implemented ([Victory](#victory-the-warm-up), [Global news](#global-news)) |
| 5. Diplomacy | implemented ([Diplomacy](#diplomacy)); the AI's peace refusal during a warm-up came with it |
| 6. AI | implemented ([AI](#ai)) |
| 7. Tuning and acceptance tests | done ([Tuning](#tuning-phase-7)) | This document is the plan and the source of truth for the feature until the implementation lands; each phase must update it (and the documents it names) to describe the implemented behavior.

The Dyson Swarm is a late-game **alternative victory** and **credit / raw-material sink**. Eight fixed anchor slots ring the central black hole. A faction that holds a completed Dyson Anchor on **every** slot and keeps all of them for a 5-minute warm-up wins. Anchors are expensive to bring there, expensive to keep, cannot be captured and are visible to everyone, so an empire heading for this victory becomes the obvious target of the others.

Related: [Territory](./territory.md) (claims, space bases, station defense), [Star Map Terrain](./star-map-terrain.md#black-holes-navigation-obstacles) (the black hole), [New Game Generation](./new-game-generation.md) (black hole placement and clearance), [Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice) (victory / defeat), [Diplomacy](./diplomacy.md), [Economy](./economy.md#upkeep), [Research](./research.md), [Ship Production](./ship-production.md), [AI Pipeline](./ai-pipeline.md).

## Design goals

- Give rich late-game empires something worth spending credits and raw materials on (AI factions currently pile up 50–350k credits after 30 minutes, see [Economy](./economy.md)).
- A second path to victory besides conquest and the diplomatic victory, which still forces fighting: the ring must be completed **and** held.
- Reuse existing systems: anchors are space bases (station defense model, destroy-only, deployed from a ship), the victory goes through `GameOutcomeService`.
- No capture mechanic: stations stay destroy-only. Losing the ring means rebuilding it.

## Ring geometry

The galaxy always has exactly one black hole, centered on the map, with a no-fly radius of 4 cells; every star system is at least `blackHoleClearance` (14 / 16 / 18 by map size) from its center ([New Game Generation](./new-game-generation.md)). The ring lives in the empty band between the two.

**Slots.** There are always **8 slots**, on every map size and with any number of factions. The positions come from the black hole center (`cx`, `cy`), not from the save:

```text
(cx ± 6.5, cy ± 2.5) and (cx ± 2.5, cy ± 6.5)
```

Why 8: the black hole center lies on a half cell (the 4×4 span is centered on `x + 1.5`), so these offsets land exactly on integer cells, where bases sit. All eight slots are at the same distance (√48.5 ≈ 6.96 cells, about 3 cells outside the no-fly edge), within 1.5° of an exact 45° spacing, and at least 5 cells apart. The layout is mirror-symmetric on both axes, like the home-system ellipse, so no faction is closer to the ring than another. A layout check for 9 and 10 slots found no even grid fit: radii varied by up to 0.5 cells, angles by about 4°, and 10 slots came down to 3 cells apart.

Because the slots are derived from the black hole, they need no saved state.

**Implementation.**
- **`dyson-ring.ts` (pure):** `DYSON_RING_CONFIG`, `buildDysonRing`, `isInDysonRingZone`, `dysonWedgeAt`, `dysonSlotAtCell`, `dysonWedgePath`.
- **`DysonRingService`:** holds the current map's ring. `StarMap.loadGame` calls `configure(specialObjects)` on every load, and the headless simulation does the same. A map without a black hole has no ring.
- **`revision`:** feeds the `TerritoryService` cache key.

**Wedges.** Each slot owns one **45° annular sector** of the ring. The sector runs from the no-fly edge (radius 4) to radius 10 (the slot plus 3 cells) and spans the angle between two boundaries at multiples of 45° from the +x axis. The angle is `atan2(row − cy, col − cx)`, and grid rows grow downwards. Each slot sits within 1.5° of the middle of its wedge.

The eight wedges tile the ring without gaps, so a faction holding every slot shows a closed ring in its color. A grid cell belongs to a wedge by the same cell coordinates the territory map already uses.

Because the center is on a half cell, some cells lie exactly on a 45° diagonal. They always go to the steeper wedge (1, 2, 5 or 6). This keeps the wedges mirror-symmetric on both axes: the four flat wedges have equal cell counts, and so do the four steep ones. Cells of the no-fly disc are in the ring zone but in no wedge.

**Ring zone precedence (territory).** The ring zone is every cell within 10 cells of the center: all wedges plus the no-fly disc, which nobody ever claims. In `territory.ts` (`DysonClaims`):

1. A cell in the ring zone belongs to the owner of its wedge's **completed** anchor, or to nobody. An empty wedge or one under construction claims nothing.
2. No other claim source ever claims a ring cell. This overrides the "a system claim beats a base claim" rule ([Territory](./territory.md#territory)). On the small map a system 14 cells from the center has a 7-cell claim disc that reaches into the ring, and the ring cuts it off.
3. An ordinary space base may only be deployed outside the ring zone. Inside it, `validateBaseDeployment` refuses with `dyson_ring`. The base's claim disc is cut by the ring, as above.

Until anchors exist (phase 2), `DysonRingService.claims` reports no wedge owners, so the whole ring zone is unclaimed.

Consequences:

- A slot is never inside another faction's territory, so the "no deployment in foreign territory" rule can never lock a faction out of an empty slot.
- Wedges are ordinary territory everywhere else: border violations at peace and sensor rules work as they do for bases.

**Generation** (galaxy generator version 8):
- A nebula edge keeps at least `outerRadius + generationClearance` = 11 cells from the black hole center. Version 7 allowed nebulae down to 8 cells.
- Asteroid belts needed no change. A belt's navigation capsule already keeps `minPassage` (6) beyond the no-fly edge, so its band ends at least 10.5 cells from the center.
- `validateGeneratedGalaxy` rejects any nebula or belt that reaches into the ring zone.

Older saves are not supported (see phase 2 and [Versioning](./versioning.md)), so no ring cleanup is needed for them.

**Tests** (`dyson-ring.spec.ts`):
- slots on exact integer cells, equidistant and in their own wedges, for every map size;
- the wedges tile the ring with mirror-symmetric cell counts;
- the ring cuts system and base discs, so no slot is ever in foreign territory;
- wedge claims;
- ordinary bases refused in the zone.

The generator spec's 150-galaxy validation covers the terrain rule.

**Display.** The galaxy view's `dyson-layer` sits above the fog (z 6), because the ring is known to every empire. It draws faint warm, dashed wedge outlines and a dashed diamond on each empty slot; the diamond disappears once an anchor stands on the slot. The layer is presentation only: anchors are base markers above it.

## Station construction time (applies to every station)

This is a general rule for every station, introduced together with the swarm (phase 0). Stations are no longer finished on deployment:

| Station | Construction time (game time) |
|---|---|
| Space base (radar) | 60 s |
| Mining station | 180 s |
| Dyson Anchor | 300 s |

- The ship is consumed when construction starts. A site that is destroyed loses the ship.
- **A construction site** is a station object on the station's position:
  - it does not fire back (no turrets) and has no shield pool, only a small hull;
  - it is attacked by the usual rules: war, the same triggers as the finished station;
  - it is destroyed if the attacker wins.
- While under construction the station claims no territory, senses nothing, extracts nothing, gives no bonus and pays no upkeep. It still **reserves its spot**: one station per asteroid, one anchor per slot, base spacing.
- The timer runs on scaled game time and freezes while paused.
- The AI must count its own construction sites as planned. This matters for mining stations, so it does not deploy a second outpost ship on the same asteroid.
- Save: the remaining construction time is an optional field on the station; missing means complete. An additive optional field needs no `SAVE_VERSION` bump ([Versioning](./versioning.md)).

## Research and the anchor ship

- **Technology:** *Stellar Engineering* (`stellar_engineering`, research cost 6,000) unlocks the anchor ship.
  - It is the most expensive technology; the next most expensive cost 4,500.
  - Prerequisites: Applied Science and Advanced Power, the ends of the research and power branches, so the technologist reaches it first. That puts it at depth 4 of the tree.
- **Ship:** *Swarm Constructor* (`swarm_constructor`, role `DysonAnchor`).
  - **Very expensive:** 100,000 credits and 10,000 raw materials (phase 7). 120 s build time, 10 upkeep points.
  - **Very slow:** speed 1, half the outpost ship's speed of 2.
  - **Fragile:** 40 HP, no shield, attack 1, defense 1. Its battle icon is `public/ships/swarm_constructor.svg`.
  - Prices and upkeep were set by the phase 7 measurement ([Tuning](#tuning-phase-7)).
  - It is not a combat ship (`isCombatShipType` excludes it, like the outpost ship).
  - It is built and moved like any ship: in a fleet, with escorts. A fleet moves at its slowest ship's speed, so escorts slow down with it.
- **No cap** on how many anchor ships a faction may build or have in flight.

## Anchor lifecycle

1. **Deploy.** A fleet with an anchor ship that is stopped on an empty slot cell shows DEPLOY ANCHOR. The only requirements are:
   - the slot is empty (no anchor, no site);
   - the faction has the technology.

   Territory, base spacing and star distance do not apply to slots, and anchors cannot be deployed anywhere else. The ship is consumed and a construction site appears. The deployment triggers a global news item and the diplomatic effects below.
2. **Construction** (300 s). The site is vulnerable and undefended.
3. **Completed anchor.**
   - Defense: the shared [station defense](./territory.md#station-defense), exactly like an ordinary space base: core hull, 0–3 turrets from Turret Research, shield pool. Stronger defenses may come later.
   - Territory: its wedge.
   - Upkeep: 300 points/s (a radar base costs 25), scaled by the empire upkeep scale like all station upkeep ([Tuning](#tuning-phase-7)).
   - Sensor: a completed anchor is a sensor source exactly like a space base (radar), with the same range and research bonus. A construction site senses nothing.
4. **End.** An anchor ends in one of two ways:
   - **Destroyed** in battle. It is never captured.
   - **Demolished** by its owner (DEMOLISH on the anchor panel). This refunds nothing and frees the slot.

   A freed slot can be built on again by anyone, with any bonus.

**Always visible.** Anchors and construction sites (slot, owner, state, construction time left) are visible to every faction regardless of fog of war, including the AI fog of war (`EnemyIntelService`). This differs from ordinary bases, which are only shown once explored.

### Implementation (phase 2)

- **Data:** an anchor is a `SpaceBase` with `kind: 'dyson'`, `dysonSlot` (0–7) and the optional `dysonBonus`.
  - A base without `kind` is an ordinary radar base.
  - These are additive optional fields, so there is no `SAVE_VERSION` bump ([Versioning](./versioning.md)).
  - `SpaceBaseService.restore` drops an anchor without a valid slot or on a slot an earlier anchor already holds, and clears an unknown bonus.
- **Rules:** `dyson-anchor.ts`, with `validateAnchorDeployment`, the bonus list and `dysonWedgeOwners`. Mutations live in `SpaceBaseService`: `deployAnchor`, `chooseBonus`, `demolish`, `checkAnchor`.
  - Ordinary base spacing ignores anchors.
  - `collectClaims` gives an anchor no disc claim; `TerritoryService` passes the completed anchors' wedge owners to the territory map.
- **Shared paths:** anchors use every base path unchanged:
  - construction (300 s);
  - battles (`checkBaseBattles`, station defense, construction site while being built);
  - sensors (a completed anchor is in `completeBases`, the radar sources);
  - save (`StarMapData.spaceBases`).
- **Upkeep:** `DYSON_ANCHOR_UPKEEP_POINTS` = 300 (phase 7), in `EconomyService.getStationUpkeepPerSecond`. A radar base costs 25.
- **UI:**
  - **Fleet panel:** a DEPLOY ANCHOR button is shown when the fleet carries a Swarm Constructor. When the button is disabled, the panel explains why.
  - **Map:** anchor markers are always visible regardless of fog. They show a gold frame and a round core, and get a highlight while their panel is open.
  - **Anchor panel:** clicking an anchor opens `StarMapAnchorInfoComponent`, with owner, construction progress, defense, the bonus and DEMOLISH… behind an inline confirmation. The owner can pick the bonus once.
  - **Notices:** deploying, completing and demolishing your own anchor show a map notice.
- **Not yet:**

## Anchor bonuses

Each anchor provides **one small empire-wide bonus**. The owner picks it **once** on the anchor's info panel: during construction or after completion, whichever comes first. The pick cannot be changed. To change it, the owner has to demolish the anchor (no refund) and build a new one. The bonus only applies while the anchor is **completed** and owned. Bonuses of the same type from several anchors add up.

Rule: bonuses must stay **well below the anchor's upkeep in value**, so the swarm remains a net sink and a holder pays for its victory attempt. The starting set is deliberately tiny; more may be designed later:

| Bonus | Effect per anchor (`DYSON_BONUS_VALUES`) | Applied in |
|---|---|---|
| Stellar Power | +0.01 to the power-building energy multiplier, added to the research multiplier like a research bonus (so +1% of base output each) | `EconomyService.calculatePlanetEconomy` (all economy, AI and planet-screen paths) |
| Orbital Foundries | −1% raw-material cost of every ship (per unit, rounded to whole units); credits unchanged | `ProductionService.shipCostFor`: what `queueOrder` charges and the player's production panel shows |
| Swarm Observatory | +0.1 research points per second (1 every 10 s), a flat faction-level source like asteroid mining | `EconomyService.calculateEconomy` (production and net); the economy tick pays it out |

Rules shared by all three:
- `dysonBonusEffects` sums the bonuses of the faction's **completed** anchors. A construction site counts nothing, and its panel says the bonus takes effect on completion.
- The AI's affordability checks still use the undiscounted ship price (`shipCost`), which can only make them more cautious. The AI does not pick bonuses yet (phase 6).

Value check: an anchor costs 300 upkeep points ≈ 90 credits/s before the empire upkeep scale. A Swarm Observatory's 0.1 research/s is worth about 0.4 credits/s at the 4-credits-per-point research price. The other two are 1% of power output or ship raw spending.

No credit-income or upkeep-reduction bonus: that would undo the sink.

## Victory: the warm-up

- When one faction holds a **completed** anchor on **all 8 slots**, a **warm-up of 300 s** of game time starts.
- If that faction loses any anchor in the meantime (destroyed or demolished), the warm-up is cancelled and resets to zero. It starts again from zero as soon as the ring is complete again.
- When the warm-up ends, that faction wins:
  - the human player → victory;
  - an AI faction → defeat for the player, with its own wording on the game-end dialog.
- Only anchors of one faction count; allies' or peace partners' anchors are not combined.
- The warm-up only runs while the holder owns at least one planet. A holder that loses its last planet has the warm-up cancelled as if it had lost an anchor. Reaching the technology already takes a working economy, but an empire can still lose its planets while its anchors stand.
- `GameOutcomeService` adds the rule next to the conquest and diplomatic victories. The outcome stays sticky ([Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice)).
- Save: the active warm-up (faction and time left) is stored, so a reload continues it.
- UI: while a warm-up runs, every player sees a countdown on the map (holder's color, time left).

**Implementation.**
- **Pure rules (`dyson-victory.ts`):**
  - `DYSON_WARMUP_SECONDS` = 300;
  - `dysonRingHolder` (the faction with completed anchors on all slots and at least one planet);
  - `advanceDysonWarmup` (events started / cancelled / completed). A completed warm-up is terminal.
- **`DysonVictoryService`:** holds the state. Every frame, `StarMap.updateDysonSwarm` ticks it with the scaled delta, so a paused game freezes it.
- **Save:** `StarMapData.dysonWarmup = { factionId, remaining }`, an additive optional field (no `SAVE_VERSION` bump). It is sanitized on load, so the reload after the battle screen continues the countdown.
- **Outcome:** on `completed`, StarMap runs the game outcome check. `GameOutcomeService.evaluate` reads `dysonWarmup.remaining === 0` before the conquest rules: victory if the holder is allied, defeat otherwise.
- **Display:**
  - the countdown banner (`.dyson-countdown`, bottom centre) shows `DYSON SWARM · holder · m:ss`;
  - the game-end dialog uses its own Dyson wording (`StarMap.dysonWinnerName`).
- The headless AI simulation ticks the warm-up too (no outcome check there).
- **Tests:** `dyson-victory.spec.ts` covers the pure rules, the outcome rule and the news diff. `dyson-victory.starmap.spec.ts` covers a real StarMap session: player victory with the save round trip, and AI defeat after a cancelled and restarted warm-up.

## Global news

Dyson events are announced to **everyone**, regardless of fog of war:

- anchor construction started (faction, slot);
- anchor completed;
- anchor destroyed (the attacker is not named: the news is derived from the anchor list, see below);
- anchor demolished;
- warm-up started;
- warm-up cancelled.

The human player gets them as ordinary map notices, which are transient; no persistent news log is planned. Persistent information is on the map instead: the always-visible anchors and sites, and the warm-up countdown. The AI reads the same facts from the always-visible anchor state, not from the notices.

**Implementation.**
- **Diffing (`dyson-news.ts`):** the news compares two anchor snapshots instead of hooking every code path. `snapshotDysonAnchors` and `diffDysonAnchors` find:
  - started: a new site;
  - completed: a site that became complete, or an anchor that appeared already complete;
  - removed: demolished when `SpaceBaseService.demolish` marked it (`takeDemolished`), otherwise destroyed.
- **Why diffing:** the battle screen only edits the autosave, and the registry is restored on the reload. A diff reports an anchor destroyed there exactly like one destroyed in an AI-vs-AI battle.
- **Baseline:** the previous snapshot lives in `DysonVictoryService.anchorsSeen`, a root service, because StarMap is destroyed while the battle screen is open. Only a fresh load (not the battle return) re-seeds it.
- **Wording:**
  - several events of the same kind and faction in one frame become one line ("X completed 8 Dyson anchors");
  - the player's own deploy and demolish are not repeated, because their buttons already show a notice;
  - the "who" of a destruction is not reported.

## Diplomacy

- **Opinion:** starting each anchor (deployment) lowers every other faction's opinion of the builder by `DYSON_ANCHOR_OPINION_PENALTY` = 8, once per anchor. The full ring costs 64 opinion with every empire.
- **Casus belli:** a faction holding **3 or more anchors** (construction sites count) is a legitimate target. Against it:
  - declaring war costs **no reputation** (normally −5);
  - **breaking a truce** is allowed and costs no reputation (normally −40);
  - the **surprise-attack** penalty (normally −15 for attacking within 1 minute of one's own declaration) does not apply.

  The target's own opinion of the declarer still drops as usual; that relation is already hostile.

  Why the truce is included: the truce lasts `TRUCE_SECONDS` = 600 s, the warm-up only 300 s. Without the waiver, a builder could sign peace with everyone and finish the warm-up behind the truces.

  The waiver only applies to actions against the casus belli target, and only while it holds 3+ anchors. It is checked at the moment of the declaration or the breach.
- Anchors are stations: they can only be attacked at war. A border violation in a wedge at peace costs opinion like any trespass ([Territory](./territory.md#border-violations)).
- **No peace during a warm-up:** while a faction's warm-up runs, no AI proposes or accepts peace with it. Otherwise a truce could shield the warm-up.

**Implementation.**
- **Constants (`dyson-anchor.ts`):** `DYSON_ANCHOR_OPINION_PENALTY`, `DYSON_CASUS_BELLI_ANCHORS` = 3, `dysonAnchorCount` (construction sites included).
- **Opinion:** applied in `SpaceBaseService.deployAnchor` to every treaty partner of the builder, so player and AI deployments are treated the same way.
- **Casus belli:** `DiplomacyService.isDysonCasusBelli(target)` is checked inside `declareWar` and `breakTreaty`.
  - The reputation change is skipped.
  - The new war is pre-marked `surpriseRecorded`, so `recordHostileAct` never charges the surprise penalty.
  - The event carries `dysonCasusBelli`, so the notice says "Casus belli: the Dyson swarm".
  - The Diplomacy screen's confirmation (`consequenceFor`, `DiplomacyRowVm.dysonCasusBelli`) states the waived costs.
- **No peace during a warm-up:** `EnemyDiplomacyService.assessWar` adds the visible factor `dyson` ("Dyson warm-up running", −2). `evaluateTreaty` refuses outright (acceptance 0) when the other side is the warm-up holder, and `respondToProposal` makes no counter-offer. This covers AI offers to the player, answers to the player's offers, and AI–AI settlements.
- **Tests:** `dyson-diplomacy.spec.ts`.
- The AI uses the casus belli and breaks truces against a warm-up holder through `EnemyDysonService` ([AI](#ai)).

## AI

Personalities decide who builds. Everyone reacts to a threat. There is no coalition logic: each AI reacts on its own.

| Personality | Builds anchors | Against other factions' anchors |
|---|---|---|
| technologist | **always pursues the swarm** once it has the technology: builds and escorts anchor ships, defends its anchors, picks bonuses | defends, destroys |
| militarist | **never** | **aggressive hunter:** uses the casus belli and destroys anchors |
| balanced | opportunistic, when it has a large credit surplus (mainly for the bonuses) | reacts |
| expansionist | rarely or never | reacts |

Threat response, the same for every personality, scaled by its aggression:

- Another faction holds 3+ anchors → candidate war declaration (casus belli) and an **anchor assault** objective.
- Another faction's warm-up is running → anchor assault becomes the top military priority.
  - **Any** personality may break a truce with the holder. Today only treacherous personalities break truces.
  - No AI accepts or proposes peace with a faction whose warm-up is running.

### Implementation (phase 6)

**Personality data:** `ai-personality.ts` `dyson`.

| | balanced | expansionist | militarist | technologist |
|---|---|---|---|---|
| `build` | `rich` (credits ≥ price + 40,000) | `never` | `never` | `always` |
| `huntAnchors` (anchors that make a rival a target) | 5 | 6 | 3 | 6 |
| `researchValue` (worth of Stellar Engineering) | 2 | 0 | 0 | 8 |

**Research:** `EnemyResearchService.directValue` adds `researchValue` for the technology that unlocks the Swarm Constructor; the lookahead pulls Applied Science and Advanced Power along. Without this, a non-combat ship unlock would be worth nothing.

**`EnemyDysonService`:** runs every 3 s per AI faction, after the asteroid mining in `StarMapAiTickService`.

1. **Build** (if `build` ≠ `never` and the technology is researched).
   - **Queueing:** at most `MAX_CONSTRUCTORS` constructors queued, in stock or flying at once: 2 for `always`, 1 for `rich`. A new one is queued only with a free slot, the full price in hand (plus the surplus for `rich`), a Spaceport, a Spaceship Factory and upkeep headroom. The headroom check is `EnemyEconomyService.getProjectedNet` minus the upkeep of every anchor under way (this one included), which must stay ≥ 5 credits/s.
   - **Escort:** a stocked constructor leaves the first Spaceport with up to 3 stocked warships, so the fleet moves at the constructor's speed.
   - **Deployment:** the fleet flies to the nearest free slot no other own constructor is heading for, and deploys through `SpaceBaseService.deployAnchor`, the player's rule. If the slot was taken meanwhile, it retargets.
   - **Bonus:** picked at once. Swarm Observatory for `always` builders, Orbital Foundries otherwise.
2. **Hunt.**
   - **Target:** a rival with ≥ `huntAnchors` anchors (sites included), or — for every personality — the holder of a running warm-up, which takes precedence.
   - **Contest:** a builder (`build` ≠ `never`, technology researched) that finds the ring full without owning all of it targets the rival with the most anchors, whatever its threshold.
   - **No peace with the target:** `EnemyDiplomacyService` refuses peace with the empire the AI is hunting (`EnemyDysonService.isHuntTarget`), as with a warm-up holder. Otherwise an AI–AI settlement a minute after the declaration, and its 10-minute truce, ended every hunt.
   - **War:** at peace the AI declares war (free: casus belli). A truce is broken only against a warm-up holder.
   - **Fleets:** at war, free combat fleets get a hunt order. Normally that is one fleet with ≥ 3 living warships (completed anchors have turrets). During a warm-up it is every free fleet but one, kept home, whatever its size.
   - **Targets on the ring:** hunters fly onto the target's anchor cells, construction sites first, then the nearest. The ordinary base battle (`checkBaseBattles`) does the rest.
3. **Guard.** A builder with ≥ 3 completed anchors parks its second-strongest free combat fleet on its own anchor nearest to that fleet. The strongest fleet stays with `EnemyFleetService` for home defense and assaults. An attacker reaching that cell meets the guard first.

**Ownership:**
- Fleets carrying a Swarm Constructor (`isCivilianMissionFleet`, shared with outpost fleets) and fleets on a Dyson order (`getOrderedFleetIds`) are reserved by `StarMapAiTickService.getReservedFleetIds`.
- `EnemyFleetService`, goal fleet selection, warship deployment and the action executor skip them.
- `EnemyProgressService` clears a stuck Dyson fleet's target so the service re-plans.
- **Releasing an order:** it ends when the target no longer qualifies or has no anchors left, the war is over, the fleet has no warships, or the guard's anchors fall below 3. The fleet then returns to `EnemyFleetService`.

**State:** the decision clock and the orders, in memory, cleared by `resetAiPipeline` (kept across a battle return like all AI memory).

**Tests:**
- `enemy-dyson.spec.ts`: building by personality (two parallel constructors for a technologist), escort, slot choice, deployment and bonus, a free war and site-first targeting, threshold and weak-fleet refusal, truce breach and all-but-one during a warm-up, reserved fleets untouched, release, contesting a full ring with peace refused, guard, research value.
- `enemy-dyson.starmap.spec.ts`: the real game loop. A militarist fleet destroys a rival AI's anchors, and a technologist's constructor reaches the ring and deploys.

**Limitations:**
- No battle forecast against a station's defense: the 3-warship rule stands in for it.
- One hunt target at a time.
- Guards are not sized by the threat.
- The AI never demolishes anchors.
- No coalition logic (by design).
- The swarm is late-game: see [Tuning](#tuning-phase-7) for when AIs get there.

## Tuning (phase 7)

**Measured** with headless 90-minute games (`ai-simulation.spec.ts`, "AI simulation — Dyson Swarm", 1/10 s frames, the passive stand-in player).

**Medium map, 3 AIs** (technologist, militarist, balanced):
- Stellar Engineering at ~51 min (technologist) and ~55 min (balanced); the militarist never researches it.
- First anchors ~13 min later, then one every 3–5 minutes. The ring is full at ~82 min, split between the two builders.
- After that the builders contest it, and the militarist hunts the technologist. Anchors are destroyed on both sides; no warm-up within 90 min.
- Anchor upkeep: 7–12% of the technologist's gross income, 2–4% for the much richer balanced empire.
- The swarm cost the technologist ~1.1M credits (stock 3.1M → 1.95M by minute 90).

**Large map, 4 AIs:** Stellar Engineering at 62–78 min, one technologist not at all. 3 anchors each for the two builders; raw materials are tight for some.

**Changes from these runs:**
- **Price and upkeep:** ship 15,000 → 100,000 credits and 6,000 → 10,000 raw materials; anchor upkeep 60 → 300 points. Late AI economies earn 5–12k credits/s and hold millions by minute 90, so the old prices were negligible.
- **Pace:** a technologist runs two constructors at once (one each took ~10 minutes per anchor).
- **Stalemate:** builders contest a full ring, and an AI refuses peace with its hunt target. Before this, two builders froze the ring at 4 + 4, and peace settlements ended every hunt.
- **Harness gap fixed:** the simulation now runs station battles (`checkBaseBattles`, `checkMiningStationBattles`) like StarMap. Before, hunters stood on anchor cells without fighting, and mining stations were never attacked in simulations.

**Acceptance test** (same file, medium scenario, ~70 s):
- the technologist researches Stellar Engineering and builds ≥ 3 anchors;
- the militarist never builds;
- at least one anchor is destroyed;
- the technologist's anchor upkeep is ≥ 3% of its gross income;
- no AI has rejected production orders or lasting arrears.

**Conclusion:** the Dyson Swarm is a late-game path. AIs reach it after ~50–80 minutes, and between rival builders and hunters a full ring rarely survives long. A player focused on it can get there sooner. Credit stockpiles still grow into the millions late in long games: the swarm absorbs a share of it, not all of it ([Economy](./economy.md)).

## Implementation phases

Each phase updates this document and the documents it touches.

0. **Station construction time:**
   - sites for bases and mining stations;
   - AI accounting for its own sites;
   - save field;
   - [Territory](./territory.md) update.
1. **Ring geometry:**
   - a pure module for slot positions, wedge membership and ring zone precedence in `territory.ts`;
   - generation exclusion for nebulae and belts;
   - rendering of empty slots and wedges.
2. **Technology, ship, deployment:**
   - DEPLOY ANCHOR;
   - the anchor info panel (state, bonus pick, DEMOLISH);
   - always visible regardless of fog;
   - anchors stored as space bases with a kind and slot index (additive optional fields, no `SAVE_VERSION` bump).

   **Save compatibility** follows [Versioning](./versioning.md). The swarm is meant for a MINOR release (0.4.0), which may raise `MIN_SUPPORTED_SAVE_VERSION` to the new format, so no migration is written for the swarm, the ring zone, or nebulae and belts lying on the ring. Older saves are then rejected and listed as incompatible.
3. **Upkeep and bonuses:** upkeep in `EconomyService`, bonus aggregation where each bonus applies.
4. **Victory and news:** warm-up state and saving, `GameOutcomeService`, countdown UI, global news.
5. **Diplomacy:** opinion hit per anchor, casus belli.
6. **AI:** the build / defend / assault behavior above, by personality.
7. **Tuning and acceptance tests** in `ai-simulation.spec.ts`. Targets:
   - a technologist completes the ring in some long games against passive opponents;
   - militarists destroy anchors when someone reaches 3+;
   - holding all 8 anchors costs a noticeable share of a late-game empire's credit income (the target share is set here);
   - the swarm absorbs most of the late-game AI surplus.

## Open questions

- Whether the full-ring upkeep should grow with the number of anchors held (progressive), so the final slots cost more than the first.
- Late-game credit stockpiles in long games are larger than any current sink, the swarm included.
- The construction site's hull value (300) and the bonus sizes were not tuned by simulation.

# Diplomacy

Treaties, opinion, reputation, war exhaustion and peace negotiations: who may fight whom, what wars cost, how peace is negotiated and enforced, and how the AI decides. Player and AI follow exactly the same rules and code paths.

Related: [Planet Capture](./planet-capture.md) (capture rules, game outcome), [Economy](./economy.md) (exhaustion penalty), [AI Pipeline](./ai-pipeline.md) (where AI treaty decisions run), [Battle Rules](./battle-rules.md) (battle triggers), [New Game Generation](./new-game-generation.md) (teams and starting relations), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Relation kinds, hostility rule, planet-attack rule; opinion, reputation and exhaustion values and their events; treaty state changes (`startWar`, `startPeace`); time-based updates (`tickDiplomacyTime`); load normalization; all tuning constants | `src/app/components/star-map/diplomacy.ts` |
| Peace treaty model (resources only), feasibility validation | `src/app/components/star-map/peace-treaty.ts` |
| Credit demand model (kinds, rules table, validation, flavor text, save sanitizing) | `src/app/components/star-map/diplomatic-demand.ts` |
| Atomic resource transfer between factions (treaties and demands; never touches treaty state) | `src/app/components/star-map/resource-transfer.ts` |
| Treaty actions (declare war, break treaty, execute treaty), AI proposals to the player, treaty events; demand actions (issue, accept, refuse, carry out, back down) and the open (saved) demands | `DiplomacyService` (`src/app/services/diplomacy.service.ts`) |
| AI judgment: war assessment, treaty evaluation, counter-offers, AI–AI settlement, proposals, war decisions; demand planning, demand evaluation, threat follow-through | `EnemyDiplomacyService` (`src/app/components/star-map/enemy-diplomacy.service.ts`) |
| War-loss recording | `BattleOutcomeService` (ship losses, surprise attacks), `PlanetOwnershipService.transferPlanet` (planet losses) |
| Exhaustion penalty on output | `EconomyService` (`gainMultiplier`) |
| Persisted state | `Faction.relations`, `Faction.reputation`, `Faction.demandCooldown`, `Faction.emptyThreats`, `StarMapData.diplomaticDemands` (`star-map.models.ts`) |
| UI | `StarMapDiplomacyComponent` (overview), `StarMapPeaceNegotiationComponent` (negotiation), view models in `star-map-diplomacy-vm.ts`, actions in `StarMap` |
| Diplomatic victory | `GameOutcomeService` |

## Relation kinds and the hostility rule

`getRelationKind(a, b)` is the one classification every system uses:

| Kind | When | Effect |
| --- | --- | --- |
| `self` | same faction | — |
| `allied` | same non-neutral `team` | permanent; never fight, planets off limits. Only on pre-diplomacy saves (all AIs on team 2) |
| `neutral` | either side on team 0 (`independent` rebels, `unhabited`) | neutral fleets never fight; neutral rebel planets can be captured by anyone (`canAttackPlanetOf`) |
| `war` / `peace` | every other pair (a *treaty pair*) | stored in `Faction.relations[otherId]` |

`areFactionsHostile(a, b)` ⇔ `war`: battle detection, AI threat and target selection, attack orders and the legacy AI layers use it (or `hostileFactionIds`). Planet capture uses `canAttackPlanetOf`. New games give every participant its own team and start everyone at war with everyone (opening lock, see below).

## Time

The game is real-time: there are no turns, rounds or diplomatic steps. Every diplomatic timer (war lock, truce, war duration, AI proposal lifetime and cooldown, AI decision interval) is in seconds of scaled game time, and every rate (opinion and reputation drift, war exhaustion) is **per minute of game time** (`SECONDS_PER_MINUTE` = 60), applied continuously as `rate × delta / 60` on every frame by `DiplomacyService.tick` → `tickDiplomacyTime` (and `EnemyDiplomacyService.tick`, `BorderService.tick`), called from `StarMap.gameLoopCallback` with the scaled delta. Nothing advances on a player action. Everything freezes while paused (delta 0), resumes from the same state, runs 3× at speed 3, and there is no partial state to save.

The UI shows durations as game time through `formatGameDuration` (`diplomacy.ts`): "45 s", "4 min 30 s", "1 h 5 min" — war duration, truce time left, wait before negotiating, open proposal time.

## Relation data (per pair, stored on both factions)

| Field | Side | Meaning |
| --- | --- | --- |
| `state` | symmetric | `war` / `peace` |
| `lockRemaining` | symmetric | at war: minimum war duration before negotiation; at peace: the truce |
| `truce` | symmetric | the post-treaty truce is running |
| `warSeconds`, `declaredBy`, `surpriseRecorded` | symmetric | current war's age, declarer (absent for opening wars), surprise penalty applied |
| `opinion` | per side | holder's opinion of the other, −100…+100 |
| `demandCooldown` | per side | game seconds until the holder may demand credits from the other again |
| `demandsReceived`, `demandsRefused` | per side | decaying memory of the other's demands on the holder / of the holder's demands the other refused |
| `warExhaustion` | per side | holder's exhaustion in this war, 0…100 |
| `shipsLostValue`, `planetsLost` | per side | holder's losses in this war |

`Faction.reputation` (−100…+100) is per faction, and so are `Faction.demandCooldown` and `Faction.emptyThreats` (see below). Demand cooldowns and memories survive war and peace. Only `startWar` / `startPeace` change the treaty state and they always write both sides; `adjustOpinion`, `adjustReputation`, `recordShipLosses`, `recordPlanetLoss`, `recordHostileAct` and `tickDiplomacyTime` change the values.

## Opinion

A's opinion of B. Changes: B declares war on A −30; B breaks a truce with A −60; peace signed +10 both; B takes one of A's planets by force −10; B raids one of A's traders while at peace −(5 + cargo / 200), at most −20 ([Trade Network](./trade-network.md#raids)); drift per minute of game time: +1 at peace up to +60, −0.5 at war down to −50.

**Effective opinion** = opinion + 0.5 × the other's reputation (clamped). This is how reputation reaches *every* faction: each AI judges a faction by its own history with it plus that faction's general trustworthiness.

## Reputation

Declaring war −5 (0 against an empire with 3+ Dyson anchors, see [Dyson Swarm](./dyson-swarm.md#diplomacy)); not carrying out a refused ultimatum −3; **surprise attack** −15 (the declarer attacks — fleet battle, planet battle or capture — within 1 minute of game time after its own declaration; once per war); breaking a truce −40 (0 against a Dyson casus belli target, whose war also carries no surprise-attack penalty); raiding a peace partner's trader −2, a civilian trader −1 ([Trade Network](./trade-network.md#raids)); a truce that runs out unbroken +5 for both; while at war with nobody +0.5 per minute up to +50.

## War exhaustion

Per faction per war. Grows by:

- +1 per minute of game time at war (only while both sides are alive);
- ship losses: `40 × lost value / max(2000, own fleet value before the loss)` — relative to the navy, so a big empire losing a frigate is not shaken;
- severe defeat: +5 when a fleet worth ≥ 1000 credits is wiped out;
- lost planet: `8 + population / 200`, max 20.

Effects:

- **Output penalty:** above 25, credit income and raw/research production fall linearly to −30% at 100 (`getWarExhaustionPenalty`, the faction's worst war). Applied through `EconomyService`, so HUD, tick and AI see the same numbers. Costs and upkeep are unaffected; below 25 there is no penalty, so short wars do not hurt.
- **Peace pressure:** own exhaustion and the gap to the enemy's raise the AI's will for peace (see below).
- **No new wars:** an AI whose worst exhaustion is ≥ 40 declares no new war.
- Reset to 0 on peace (and on a new war).

## Peace, truce and war declarations

- **Peace is permanent.** It ends only by a war declaration or a treaty breach.
- A peace treaty starts a **truce** of `TRUCE_SECONDS` = 600 s (10 minutes of game time). During it `declareWar` is refused (`truce`); only `breakTreaty` can end it (an explicit, confirmed action — treachery). After the truce, peace stays and war may be declared normally.
- A war must last `WAR_MIN_DURATION_SECONDS` (60 s) before negotiation; the opening wars of a new game are locked for `INITIAL_WAR_LOCK_SECONDS` (4 minutes). Separately, a hidden **opening grace** keeps every AI from attacking the human player during the first 4 minutes of game time ([Planet Capture](./planet-capture.md#opening-grace-opening-gracets)); the two durations are independent constants that happen to be equal.

## Peace treaties (`peace-treaty.ts`)

`PeaceTreaty = { proposerId, recipientId, items }`; each item has a giver (one of the two parties) and is `credits` or `rawmaterials` (positive whole amount). An empty item list is a white peace.

**Planets and star systems are not negotiable.** They change owner only through normal play — conquest, colonization, rebellion ([Planet Capture](./planet-capture.md)) — so territory, colonization and ownership never depend on a treaty. Neither the player, nor the AI (proposals, counter-offers, AI–AI settlements) can offer or demand them. Any other item kind (e.g. built by stale code) fails validation as `unsupported_item` and never executes.

`validateTreaty` (shared by UI, AI and execution) requires: a treaty pair at war, war lock expired, both sides alive, givers are parties, only resource items, amounts positive integers and covered by the giver's current stock.

`DiplomacyService.executeTreaty` is atomic: it re-validates, then — since validation guarantees every step succeeds — moves resources, starts peace with the truce, resets exhaustion and loss counters, gives +10 opinion both ways, and emits a `peace` event. An invalid treaty changes nothing and the war continues.

## AI judgment (`EnemyDiplomacyService`)

Deterministic and explainable.

**War assessment** — `assessWar(ai, enemy)` sums named factors into a *peace pressure* (positive = wants peace):

| Factor | Value |
| --- | --- |
| War aims (baseline) | −0.2 |
| Military balance | `0.5 × log2(enemy strength / own)`, clamped ±1 |
| War exhaustion | `0.6 × own/100 + 0.3 × (own − enemy)/100` |
| Fleet losses | `0.5 × (own − enemy lost value) / scale`, ±0.5 |
| Planets lost | `0.15 × (own − enemy planets lost)`, ±0.6 |
| Relations | `0.3 × effective opinion / 100` |
| Second front | +0.25 (≥ 2 wars, not the primary enemy, enemy not much weaker) |
| Empire collapsing | +0.5 (≤ 1 planet vs an enemy with ≥ 3) |
| Out of reach | +0.3 (empires farther apart than 1.5 × `WAR_REACH`) |
| Empty treasury | +0.15 (credits < 20% of scale) |
| Temperament | personality `peaceBias`; a negative (warlike) bias is scaled by `1 − own exhaustion / 100`, so a long war wears it off |

`scale` ≈ one minute of the AI's income (`max(2000, population × POPULATION_CREDIT_RATE × 60)`, the same income rate as the economy); **peace value** = pressure × scale, in credits: what ending this war is worth to the AI (negative = it wants to be paid).

**Treaty evaluation** — `evaluateTreaty`: terms value for the AI (`termsValue`: credits ×1, raw materials ×1.2; given resources count negative). The AI **accepts iff the terms are feasible and terms + peace value ≥ 0**. The acceptance meter is `0.5 + margin / (2 × scale)`, so 0.5 is exactly the threshold; the dialog shows the margin in credits and every factor.

**Counter-offer** — `counterOffer`, from the refused terms: (1) pay less; (2) ask the other side for credits, then raw materials, never more than it holds. Only a feasible counter the AI itself accepts is returned; otherwise the proposal is refused (e.g. when the other side cannot pay enough).

**Periodic review** (every `DECISION_INTERVAL` = 10 s, deterministic faction order; runs first in the AI tick):

- *AI vs AI*: if both peace values sum to ≥ 0 they settle — white peace if both are ≥ 0, otherwise the more eager side pays the other's price (credits, then raw) if it can — and both re-check the final terms before execution.
- *AI vs human*: with pressure ≥ 0.1 and no open proposal or cooldown (`OFFER_COOLDOWN` = 180 s of game time), the AI proposes white peace plus credits up to half its peace value (≤ 40% of its treasury); the proposal stays open `PEACE_OFFER_SECONDS` (90 s of game time).
- *War*: with fewer wars than `maxWars` and exhaustion < 40, the AI declares war on the weakest peace partner within `WAR_REACH` whose strength ratio ≤ `warRatio` and whose effective opinion ≤ `warOpinionMax`. During a truce only a treacherous personality breaks it, and only at ratio ≤ half `warRatio` and effective opinion ≤ −40.
- *Restless (warlike personalities)*: with fewer wars than `minWars`, the limits loosen to `restlessWarRatio` and `restlessOpinionMax`, so the AI declares war on almost any neighbour in reach that is not stronger than it and not a close friend. (Ratios above 1 were tried: a militarist then attacked stronger empires and was broken by them.) Restlessness needs money: the AI must hold at least half its `scale` in credits (`RESTLESS_MIN_TREASURY`), so a broke warmonger rebuilds first. Truces are still kept (except by militarist treachery above), and exhaustion ≥ 40 still blocks new wars.

| Personality | peaceBias | warRatio | maxWars | warOpinionMax | treachery | minWars | restlessWarRatio | restlessOpinionMax |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| balanced | 0 | 0.6 | 1 | 10 | no | 0 | — | — |
| expansionist | −0.3 | 0.65 | 1 | 15 | no | 1 | 0.9 | 65 |
| militarist | −0.45 | 0.85 | 2 | 30 | yes | 1 | 1 | 75 |
| technologist | +0.15 | 0.5 | 1 | 0 | no | 0 | — | — |

**Warlike and peaceful temperaments** (2026-11-03, `isWarlikePersonality`). Militarists and expansionists are *warlike*: their negative `peaceBias` makes them settle only when they are losing or exhausted (and otherwise ask to be paid), and `minWars` 1 makes them look for a new war as soon as the 10-minute truce after a peace runs out. Balanced and technologist AIs keep the earlier, peaceful behavior. This was added because in long games every AI settled into peace by about minute 15 ([QA prompt 7](./qa-fix-prompts.md)). Measured in `ai-simulation.spec.ts` (30-minute medium and large games): the warlike AIs stay at war with another AI for 28–30 of the 30 minutes (mostly by never settling the opening wars), peak war exhaustion stays at 30–43, nobody falls into arrears, and they research a little less (10–16 technologies against 18–20 for the technologist). In the 90-minute Dyson run, wars between AIs keep starting and ending until the end of the game. What keeps a warlike neighbour at peace: being stronger than it (ratio above its `restlessWarRatio`), a very high effective opinion (above `restlessOpinionMax`; peace drift alone reaches 60, so it takes reputation too), a war it is already fighting elsewhere, or its own exhaustion. The Diplomacy screen marks warlike empires with a WARLIKE chip next to the personality.

**Information:** diplomacy uses real total fleet strength, losses and exhaustion — treated as public knowledge (envoys, intelligence); tactical layers still only use sensor data.

## Financial demands and ultimatums

Peace-time credit demands between treaty partners (`diplomatic-demand.ts`). At war, payments belong to the peace negotiation, so demands are only possible at peace; they carry only credits. Player and AI use the same model, rules and code path (`EnemyDiplomacyService.makeDemand` → `DiplomacyService.issueDemand`).

| Kind | Meaning | Target's opinion when made | Refusal: demander's opinion of target (× AI tolerance) / target's of demander | After payment: demander / payer |
| --- | --- | --- | --- | --- |
| `request` | asks for financial support | 0 | −6 / −1 | +4 / 0 |
| `tribute` | the stronger side expects payment; no explicit war threat | −4 | −12 / −3 | +2 / −3 |
| `threat` | ultimatum: pay or face war | −8 | −20 / −5 | +2 / −6 |

Every demand the target still remembers from the same demander (`demandsReceived`, fades 0.2 per minute) costs another −3 opinion and makes it resist harder, so repeated demands sour relations. Payment never buys significant goodwill.

**Rules** (`validateDemand`, shared by issuing, answering and paying): two living treaty partners at peace; a whole amount ≥ `MIN_DEMAND_CREDITS` (100) that the target holds now; no threat during a truce (it could only be enforced by breaking the treaty). `DiplomacyService.canIssueDemand` adds: the demander's global cooldown (`Faction.demandCooldown`: the AI personality's value, 180 s for the human) and per-target cooldown (600 s), at most one open demand per pair, and at most `MAX_PENDING_PLAYER_DEMANDS` (2) demands waiting for the human at once (no notice spam). All cooldowns are game time, live on the factions and are saved.

**Payment** (`acceptDemand`) is one transaction: re-validated, then the credits move through the shared atomic `transferResources` (`resource-transfer.ts`, also used by `executeTreaty`). It never starts peace or a truce, and on failure nothing changes. An AI pays at most its *spendable* credits: above the `EnemyEconomyService.getSpendingReserve` reserve and at most 60% of its stock.

**Lifecycle.** An AI target answers at once (AI–AI demands need no UI and leave no stored state). A demand to the human waits as `pending` for `DEMAND_RESPONSE_SECONDS` (120 s of game time); letting it expire counts as a refusal. When an AI refuses the human's threat, the human gets a `follow_through` entry: declare war or back down within 60 s; letting it expire counts as backing down. Open demands are saved (`StarMapData.diplomaticDemands`) and restored after every load, so a reload cannot skip a decision or its consequences. Any war or peace between the pair voids its open demands; offers and demands of other pairs are never touched.

**AI judgment** (deterministic, no randomness):

- *Planning* (`planDemand`, every decision interval between the peace and the war review, once the AI is off its global cooldown). Per peace partner it may demand from: a **threat** when it can start a war (war limit, exhaustion < 40), there is no truce, the target is within `WAR_REACH`, its strength ratio is ≤ `threatRatio` (× 1.2 after a recent refusal: it escalates) and the effective opinion is ≤ `warOpinionMax` + 25; otherwise **tribute** when the ratio is ≤ `tributeRatio`, no truce, within 1.5 × `WAR_REACH` and opinion ≤ 30; otherwise a **request** when its own treasury is below a quarter of its scale, it does not dislike the target and was not refused twice recently. Amount = own scale × `demandShare` × kind multiplier (request 0.4, tribute 0.8, threat 1.2), capped at half of the target's credits (an AI target: also its spendable credits), rounded down to tens. It picks the harshest kind, then the weakest target. While a demand between it and a target is open, it does not declare war on that target in parallel.
- *Answering* (`evaluateDemand`): named factors like `assessWar`. All kinds: cost to the treasury (−0.6 × amount / scale), repeated demands. Request: reluctance −0.1, relations 0.8 × effective opinion / 100, the demander's need +0.15, `generosity`. Tribute / threat: pride (−0.25 / −0.15), balance of power (0.6 / 1.0 × `0.5 × log2(their strength / own)`, ±1), relations 0.2 × opinion, `yieldBias`; threats also: out of reach −0.4, the demander cannot take on another war −0.3, its empty threats −0.2 each, already at war elsewhere +0.2. Pays iff valid, affordable and the sum ≥ 0.
- *Follow-through* (`assessFollowThrough`, when its threat is refused, from the state at that moment): impossible if `declareWar` would refuse (truce), it is at its war limit or exhausted, or out of reach — then it bluffs. Otherwise `followThrough` + military balance (`0.4 × log2(own / theirs)`, ±0.8) − 0.3 × effective opinion / 100 + 0.15 × its own empty threats; ≥ 0 → war through the normal `DiplomacyService.declareWar` (all its checks and penalties), < 0 → bluff.

**Credibility.** Backing down (an AI bluff, or the human not enforcing a refused ultimatum) costs −3 reputation and adds one `Faction.emptyThreats` (cap 5, fades 0.1 per minute). Every empire then takes its threats less seriously, and the bluffer is pushed to carry out the next one; carrying out a threat forgives one empty threat.

| Personality | demandCooldown | demandShare | threatRatio | tributeRatio | followThrough | refusalTolerance | yieldBias | generosity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| balanced | 480 s | 0.5 | 0.5 | 0.65 | −0.3 | 1 | 0 | 0.05 |
| expansionist | 420 s | 0.6 | 0.55 | 0.7 | −0.15 | 1.1 | −0.05 | 0 |
| militarist | 300 s | 0.8 | 0.8 | 0.9 | +0.35 | 1.4 | −0.2 | −0.1 |
| technologist | 720 s | 0.35 | 0.3 | 0.45 | −0.9 | 0.7 | +0.1 | +0.15 |

## Border violations

A fleet inside the territory of an empire its faction is at peace with violates its borders: the owner's opinion of the intruder drops on entry and while the fleet stays, scaled by fleet value and by repeated incidents. It never declares war; it only feeds opinion (and through it the AI's war and treaty decisions). `FactionRelation.passageRights` is prepared for future passage treaties (revoked by `startWar`). See [Territory](./territory.md#border-violations).

## Battles between AIs

Only battles with a human side open the battle screen. Two AI factions at war that meet are auto-resolved immediately (`autoResolveBattle`) and the outcome is written to the live fleets via `BattleOutcomeService.applyFleetBattleOutcome`, which also records the war losses. A pair that fought once is not re-triggered while it shares the cell.

## Player UI

- **Header DIPLOMACY button** (badge = open AI proposals, incoming demands and pending ultimatum follow-throughs); map notices announce war declarations, treaty breaches, signed peace, honored truces of the player, new AI proposals and the demand events listed below.
- **Diplomacy screen** (gauges with icons; exact numbers in tooltips): summary — your reputation as a two-way bar (−100…+100) with a word (Honourable / Trusted / Neutral / Doubtful / Treacherous) and, only while relevant, a crossed-swords war count with your exhaustion slider and the output penalty; per empire: relation chip with an icon (crossed swords + war duration / hourglass + truce time left / handshake + peace), their attitude to you as a two-way bar plus a word (≥50 Friendly, ≥20 Cordial, >−20 Neutral, >−50 Wary, else Hostile), fleet comparison as a 3-segment meter (Weaker green / Even amber / Stronger red), planets, at war the exhaustion of both sides as YOU / THEM sliders (0–100, tick at 25 where the output penalty starts), the other empires they fight (their peaces and reputation are no longer shown), open proposal (REVIEW / DECLINE), and NEGOTIATE PEACE / DECLARE WAR… / BREAK TREATY…. War and breach go through an inline confirmation stating the exact consequences.
- **Demands on the Diplomacy screen**: at peace, DEMAND CREDITS… opens an inline form (Request support / Demand tribute / Ultimatum, amount up to their credits, the consequences of the chosen kind, SEND); when unavailable the disabled button's tooltip says why (cooldown, open demand, too poor). An incoming AI demand shows on the demander's card: kind, amount, time left, the message in the demander's voice (tone by personality and kind), what refusing may cost, ACCEPT / DECLINE. The screen never reveals whether an AI threat is a bluff. A refused ultimatum of the player shows DECLARE WAR / BACK DOWN with its timer. The header badge counts open proposals, incoming demands and pending follow-throughs; map notices announce demands to the player, expiries, bluffs and AI–AI ultimatums that were paid.
- **Negotiation dialog** (pauses the game; resumes on close if it was running): both sides' standing (opinion, reputation, exhaustion, treasury), the AI's terms on the table (proposal or counter-offer: ACCEPT TERMS / EDIT AS DRAFT / DECLINE), a two-column draft — *you demand* (their credits and raw materials) and *you offer* (yours) — and the AI's live judgment of the draft (meter with the threshold mark, verdict with the missing value, every factor). SEND PROPOSAL → the AI accepts (executed at once), counters, or refuses. Accepting AI terms re-checks the AI's agreement against the current state first ("withdrawn" if the situation changed).

## Diplomatic victory

`GameOutcomeService`: victory requires that every inhabited planet is allied or owned by an AI at peace with the player (rebel planets still block), no AI at war with the player has a living fleet, and — if a peace partner still owns an inhabited planet — the allied side owns more than 50% of the inhabited planets.

## Persistence and save compatibility

- Open demands are saved in `StarMapData.diplomaticDemands` (a new game gets `[]` from `SaveGameService.normalizeSave` on its first load) and restored by `DiplomacyService.restoreDemands` after every load (also the reload after a battle), which drops malformed entries, unknown factions and pairs no longer at peace. Demand cooldowns, memories and empty threats are optional fields on `Faction` and `FactionRelation` that `normalizeRelations` defaults and clamps.
- `Faction.relations` and `Faction.reputation` are saved with the factions; no save-version bump. `SaveGameService.normalizeSave` runs `normalizeRelations` on every load: missing entries become war, missing values get defaults (opinion 0, exhaustion 0, counters 0, reputation 0), values are clamped, symmetric fields are reconciled (disagreement → war).
- Not saved (rebuilt within one decision interval): open AI peace proposals (unlike demands, see above), proposal cooldowns, the event queue, the AI decision clock, an open negotiation. `resetAiPipeline` clears them on a genuine load / new game; a battle-screen round trip keeps them.

## Testing

- `diplomacy.spec.ts`: relation kinds and planet rule; v0 migration, clamping, legacy alliance, idempotence; per-minute exhaustion, opinion drift, honored truce, peace reputation, freezing while paused / for eliminated factions; ship/planet loss bookkeeping, surprise attacks, output penalty; `DiplomacyService` war/breach consequences and truce, atomic execution (resources move, planets never do, truce, exhaustion reset), infeasible terms change nothing, planet/system items rejected (`unsupported_item`), payer short of resources meanwhile, save round-trip, negotiation locks, proposal expiry; `EnemyDiplomacyService` factors, acceptance threshold, counter-offers (feasible, self-accepted, within the other side's means), refusal without a counter, AI–AI settlement with payment and white peace, proposals to the player, war declaration (opinion, truce, treachery, exhaustion), never a planet or system item in any AI treaty, pause; real-time timers (duration formatting, continuous rates, everything frozen at zero delta and resuming, no "turn" in the screen view models); economy penalty; diplomatic victory; AI-vs-AI auto battles with loss recording; capture vs rebellion bookkeeping.
- `diplomatic-demand.spec.ts`: an AI demanding from the player (deterministic), paying (exact atomic transfer), refusing a request (opinion only), a refused threat carried out (normal war declaration) or bluffed (reputation, lasting credibility loss), the player demanding through the same path, AI acceptance and refusal, the player's follow-through (war, or expiry = backing down), AI–AI demands, never paying more than held or spendable, cooldowns (also across a save round trip and while paused), the cap on demands waiting for the player, save/load of pending demands with their deadline and expiry after a reload, no ultimatum or war through a truce, no interference with other open offers and demands.
- `ai-simulation.spec.ts`: the harness mirrors the game loop (diplomacy tick with alive factions, AI-vs-AI auto battles). League and long-duration runs play real new games (AI wars and treaties), resolve player fleet battles as AUTO, and keep simulating after the passive stand-in player is defeated (`continueAfterOutcome`).

## Known limitations

- No alliances, trade, recurring tribute (each tribute demand is a one-off payment; the demander may demand again after its cooldowns), shared intel, or passage treaties (the passage flag exists, nothing grants it yet).
- Demands carry credits only (no raw materials), and only at peace.
- Planets and systems cannot be traded diplomatically (by design).
- Fleet-strength comparisons ignore research bonuses and stock ships.
- The AI proposes peace to the player only when it wants out; a winning AI at war does not dictate peace terms (it answers the player's proposals with counter-offers). At peace it may demand tribute or threaten war (see above).

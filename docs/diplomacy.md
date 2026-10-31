# Diplomacy

Treaties, opinion, reputation, war exhaustion and peace negotiations: who may fight whom, what wars cost, how peace is negotiated and enforced, and how the AI decides. Player and AI follow exactly the same rules and code paths.

Related: [Planet Capture](./planet-capture.md) (capture rules, game outcome), [Economy](./economy.md) (exhaustion penalty), [AI Pipeline](./ai-pipeline.md) (where AI treaty decisions run), [Battle Rules](./battle-rules.md) (battle triggers), [New Game Generation](./new-game-generation.md) (teams and starting relations), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Relation kinds, hostility rule, planet-attack rule; opinion, reputation and exhaustion values and their events; treaty state changes (`startWar`, `startPeace`); time-based updates (`tickDiplomacyTime`); load normalization; all tuning constants | `src/app/components/star-map/diplomacy.ts` |
| Peace treaty model (resources only), feasibility validation | `src/app/components/star-map/peace-treaty.ts` |
| Treaty actions (declare war, break treaty, execute treaty), AI proposals to the player, treaty events | `DiplomacyService` (`src/app/services/diplomacy.service.ts`) |
| AI judgment: war assessment, treaty evaluation, counter-offers, AI–AI settlement, proposals, war decisions | `EnemyDiplomacyService` (`src/app/components/star-map/enemy-diplomacy.service.ts`) |
| War-loss recording | `BattleOutcomeService` (ship losses, surprise attacks), `PlanetOwnershipService.transferPlanet` (planet losses) |
| Exhaustion penalty on output | `EconomyService` (`gainMultiplier`) |
| Persisted state | `Faction.relations`, `Faction.reputation` (`star-map.models.ts`) |
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

The game is real-time: there are no turns, rounds or diplomatic steps. Every diplomatic timer (war lock, truce, war duration, AI proposal lifetime and cooldown, AI decision interval) is in seconds of scaled game time, and every rate (opinion and reputation drift, war exhaustion) is **per minute of game time** (`SECONDS_PER_MINUTE` = 60), applied continuously as `rate × delta / 60` on every frame by `DiplomacyService.tick` → `tickDiplomacyTime` (and `EnemyDiplomacyService.tick`, `BorderService.tick`), called from `StarMap.gameLoopCallback` with the scaled delta. Nothing advances on a player action. Everything freezes while paused (delta 0), resumes from the same state, runs 2× at speed 2, and there is no partial state to save.

The UI shows durations as game time through `formatGameDuration` (`diplomacy.ts`): "45 s", "4 min 30 s", "1 h 5 min" — war duration, truce time left, wait before negotiating, open proposal time.

## Relation data (per pair, stored on both factions)

| Field | Side | Meaning |
| --- | --- | --- |
| `state` | symmetric | `war` / `peace` |
| `lockRemaining` | symmetric | at war: minimum war duration before negotiation; at peace: the truce |
| `truce` | symmetric | the post-treaty truce is running |
| `warSeconds`, `declaredBy`, `surpriseRecorded` | symmetric | current war's age, declarer (absent for opening wars), surprise penalty applied |
| `opinion` | per side | holder's opinion of the other, −100…+100 |
| `warExhaustion` | per side | holder's exhaustion in this war, 0…100 |
| `shipsLostValue`, `planetsLost` | per side | holder's losses in this war |

`Faction.reputation` (−100…+100) is per faction. Only `startWar` / `startPeace` change the treaty state and they always write both sides; `adjustOpinion`, `adjustReputation`, `recordShipLosses`, `recordPlanetLoss`, `recordHostileAct` and `tickDiplomacyTime` change the values.

## Opinion

A's opinion of B. Changes: B declares war on A −30; B breaks a truce with A −60; peace signed +10 both; B takes one of A's planets by force −10; drift per minute of game time: +1 at peace up to +60, −0.5 at war down to −50.

**Effective opinion** = opinion + 0.5 × the other's reputation (clamped). This is how reputation reaches *every* faction: each AI judges a faction by its own history with it plus that faction's general trustworthiness.

## Reputation

Declaring war −5; **surprise attack** −15 (the declarer attacks — fleet battle, planet battle or capture — within 1 minute of game time after its own declaration; once per war); breaking a truce −40; a truce that runs out unbroken +5 for both; while at war with nobody +0.5 per minute up to +50.

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
- A war must last `WAR_MIN_DURATION_SECONDS` (60 s) before negotiation; the opening wars of a new game are locked for `INITIAL_WAR_LOCK_SECONDS` (4 minutes).

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
| Temperament | personality `peaceBias` |

`scale` ≈ one minute of the AI's income (`max(2000, population × 0.1 × 60)`); **peace value** = pressure × scale, in credits: what ending this war is worth to the AI (negative = it wants to be paid).

**Treaty evaluation** — `evaluateTreaty`: terms value for the AI (`termsValue`: credits ×1, raw materials ×1.2; given resources count negative). The AI **accepts iff the terms are feasible and terms + peace value ≥ 0**. The acceptance meter is `0.5 + margin / (2 × scale)`, so 0.5 is exactly the threshold; the dialog shows the margin in credits and every factor.

**Counter-offer** — `counterOffer`, from the refused terms: (1) pay less; (2) ask the other side for credits, then raw materials, never more than it holds. Only a feasible counter the AI itself accepts is returned; otherwise the proposal is refused (e.g. when the other side cannot pay enough).

**Periodic review** (every `DECISION_INTERVAL` = 10 s, deterministic faction order; runs first in the AI tick):

- *AI vs AI*: if both peace values sum to ≥ 0 they settle — white peace if both are ≥ 0, otherwise the more eager side pays the other's price (credits, then raw) if it can — and both re-check the final terms before execution.
- *AI vs human*: with pressure ≥ 0.1 and no open proposal or cooldown (`OFFER_COOLDOWN` = 180 s of game time), the AI proposes white peace plus credits up to half its peace value (≤ 40% of its treasury); the proposal stays open `PEACE_OFFER_SECONDS` (90 s of game time).
- *War*: with fewer wars than `maxWars` and exhaustion < 40, the AI declares war on the weakest peace partner within `WAR_REACH` whose strength ratio ≤ `warRatio` and whose effective opinion ≤ `warOpinionMax`. During a truce only a treacherous personality breaks it, and only at ratio ≤ half `warRatio` and effective opinion ≤ −40.

| Personality | peaceBias | warRatio | maxWars | warOpinionMax | treachery |
| --- | --- | --- | --- | --- | --- |
| balanced | 0 | 0.6 | 1 | 10 | no |
| expansionist | +0.05 | 0.65 | 1 | 15 | no |
| militarist | −0.2 | 0.85 | 2 | 30 | yes |
| technologist | +0.15 | 0.5 | 1 | 0 | no |

**Information:** diplomacy uses real total fleet strength, losses and exhaustion — treated as public knowledge (envoys, intelligence); tactical layers still only use sensor data.

## Border violations

A fleet inside the territory of an empire its faction is at peace with violates its borders: the owner's opinion of the intruder drops on entry and while the fleet stays, scaled by fleet value and by repeated incidents. It never declares war; it only feeds opinion (and through it the AI's war and treaty decisions). `FactionRelation.passageRights` is prepared for future passage treaties (revoked by `startWar`). See [Territory](./territory.md#border-violations).

## Battles between AIs

Only battles with a human side open the battle screen. Two AI factions at war that meet are auto-resolved immediately (`autoResolveBattle`) and the outcome is written to the live fleets via `BattleOutcomeService.applyFleetBattleOutcome`, which also records the war losses. A pair that fought once is not re-triggered while it shares the cell.

## Player UI

- **Header DIPLOMACY button** (badge = open AI proposals); map notices announce war declarations, treaty breaches, signed peace, honored truces of the player and new AI proposals.
- **Diplomacy screen**: summary (your reputation, worst exhaustion and its output penalty, wars); per empire: relation chip (war + its duration / truce + time left / peace), their opinion of you and their reputation (centred −100…+100 bars), exhaustion you / them, planets, fleet comparison, their wars and peaces, open proposal (REVIEW / DECLINE), and NEGOTIATE PEACE / DECLARE WAR… / BREAK TREATY…. War and breach go through an inline confirmation stating the exact consequences.
- **Negotiation dialog** (pauses the game; resumes on close if it was running): both sides' standing (opinion, reputation, exhaustion, treasury), the AI's terms on the table (proposal or counter-offer: ACCEPT TERMS / EDIT AS DRAFT / DECLINE), a two-column draft — *you demand* (their credits and raw materials) and *you offer* (yours) — and the AI's live judgment of the draft (meter with the threshold mark, verdict with the missing value, every factor). SEND PROPOSAL → the AI accepts (executed at once), counters, or refuses. Accepting AI terms re-checks the AI's agreement against the current state first ("withdrawn" if the situation changed).

## Diplomatic victory

`GameOutcomeService`: victory requires that every inhabited planet is allied or owned by an AI at peace with the player (rebel planets still block), no AI at war with the player has a living fleet, and — if a peace partner still owns an inhabited planet — the allied side owns more than 50% of the inhabited planets.

## Persistence and save compatibility

- `Faction.relations` and `Faction.reputation` are saved with the factions; no save-version bump. `SaveGameService.migrateSave` runs `normalizeRelations` on every load: missing entries become war, missing values get defaults (opinion 0, exhaustion 0, counters 0, reputation 0), values are clamped, symmetric fields are reconciled (disagreement → war). Diplomacy v0 saves load with their war/peace states; a v0 peace has no truce.
- Not saved (rebuilt within one decision interval): open AI proposals, proposal cooldowns, the event queue, the AI decision clock, an open negotiation. `resetAiPipeline` clears them on a genuine load / new game; a battle-screen round trip keeps them.

## Testing

- `diplomacy.spec.ts`: relation kinds and planet rule; v0 migration, clamping, legacy alliance, idempotence; per-minute exhaustion, opinion drift, honored truce, peace reputation, freezing while paused / for eliminated factions; ship/planet loss bookkeeping, surprise attacks, output penalty; `DiplomacyService` war/breach consequences and truce, atomic execution (resources move, planets never do, truce, exhaustion reset), infeasible terms change nothing, planet/system items rejected (`unsupported_item`), payer short of resources meanwhile, save round-trip, negotiation locks, proposal expiry; `EnemyDiplomacyService` factors, acceptance threshold, counter-offers (feasible, self-accepted, within the other side's means), refusal without a counter, AI–AI settlement with payment and white peace, proposals to the player, war declaration (opinion, truce, treachery, exhaustion), never a planet or system item in any AI treaty, pause; real-time timers (duration formatting, continuous rates, everything frozen at zero delta and resuming, no "turn" in the screen view models); economy penalty; diplomatic victory; AI-vs-AI auto battles with loss recording; capture vs rebellion bookkeeping.
- `ai-simulation.spec.ts`: the harness mirrors the game loop (diplomacy tick with alive factions, AI-vs-AI auto battles). League and long-duration runs play real new games (AI wars and treaties), resolve player fleet battles as AUTO, and keep simulating after the passive stand-in player is defeated (`continueAfterOutcome`).

## Known limitations

- No alliances, trade, tribute outside peace treaties, shared intel, or passage treaties (the passage flag exists, nothing grants it yet).
- Planets and systems cannot be traded diplomatically (by design).
- Fleet-strength comparisons ignore research bonuses and stock ships.
- The AI proposes peace to the player only when it wants out; a winning AI never proactively demands tribute (it answers the player's proposals with counter-offers instead).

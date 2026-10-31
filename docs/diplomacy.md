# Diplomacy

Treaties between empires: who may fight whom, how war and peace change, how the AI decides, what the player can do, and how peace affects victory. Player and AI follow the same treaty rules.

Related: [Planet Capture](./planet-capture.md) (capture rules, game outcome), [AI Pipeline](./ai-pipeline.md) (where AI treaty decisions run), [Battle Rules](./battle-rules.md) (battle triggers), [New Game Generation](./new-game-generation.md) (teams and starting relations), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Relation kinds, the hostility rule, planet-attack rule, normalization, lock countdown, minimum durations | `src/app/components/star-map/diplomacy.ts` |
| Treaty actions (declare war, sign peace), AI peace offers to the player, proposal cooldown, treaty events | `DiplomacyService` (`src/app/services/diplomacy.service.ts`) |
| AI treaty decisions and the answer to the player's proposals | `EnemyDiplomacyService` (`src/app/components/star-map/enemy-diplomacy.service.ts`) |
| Persisted treaty state | `Faction.relations` (`star-map.models.ts`) |
| Diplomacy screen | `StarMapDiplomacyComponent` (`star-map-diplomacy/`), rows built by `StarMap.getDiplomacyRows` |
| Diplomatic victory | `GameOutcomeService` |

## Relation kinds

`getRelationKind(a, b)` is the one classification every system uses:

| Kind | When | Effect |
| --- | --- | --- |
| `self` | same faction | — |
| `allied` | same non-neutral `team` | permanent; no treaty can change it. Fleets never fight, planets are off limits |
| `neutral` | either side on team 0 (`independent` rebels, `unhabited`) | neutral fleets never fight; neutral *planets* can be captured by any non-neutral faction (`canAttackPlanetOf`) |
| `war` / `peace` | any other pair (a *treaty pair*) | stored in `Faction.relations[otherId]` |

**Hostility rule:** `areFactionsHostile(a, b)` ⇔ the relation is `war`. Battle detection, AI threat and target selection, attack orders, the reinforcement "in battle" check and the legacy AI layers all use it (or `hostileFactionIds`). Planet capture uses `canAttackPlanetOf` (war, or a neutral rebel owner; never `unhabited`).

A missing treaty entry between a treaty pair reads as `war`, but every new game and every load fills the entries explicitly (`normalizeRelations`), so the default only matters for transient objects (tests).

### Teams

New games give every participant its own team (human 1, AIs 2, 3, …), so nobody is a permanent ally. Saves from before diplomacy keep their teams: all AIs on team 2 stay permanently allied and every human/AI pair is at war, which is exactly the old hostility rule. The `team` field therefore still means "permanent alliance"; it is no longer the war/peace switch.

## Treaty state and locks

`FactionRelation = { state: 'war' | 'peace', lockRemaining }`, stored on **both** factions.

- **Symmetric:** only `setTreatyState` writes relations, always on both sides. `normalizeRelations` (new game, every load) repairs a save where the sides disagree (war wins, the safer reading), clamps invalid locks and drops entries toward allied, neutral or unknown factions. It is idempotent.
- **Locks** (`lockRemaining`, game seconds) prevent flip-flopping: a new war cannot end before `WAR_MIN_DURATION_SECONDS` (60), a new peace holds for `PEACE_MIN_DURATION_SECONDS` (180), and the starting wars of a new game are locked for `INITIAL_WAR_LOCK_SECONDS` (240) so the opening is not instantly pacified. `DiplomacyService.tick` counts locks down with the scaled game delta in `StarMap.gameLoopCallback`, so they freeze while paused and run 2× at speed 2.
- **Start of a new game:** everyone is at war with everyone (with the opening lock).

## Effects of peace

- Fleets of the two factions never fight (battle detection skips the pair).
- Planets of the partner cannot be captured or assaulted — by the player (arrival only orbits) or the AI (`EnemyInvasionService.isHostilePlanet`). A player fleet may still be ordered onto a peace partner's planet; it just parks there. Permanent allies' planets stay blocked for move orders as before.
- Running interceptions, attack goals and player attack orders against the partner end (they all re-check hostility).
- Peace partners' fleets are not counted as threats by the AI economy, plan and research layers.

## Battles between AIs

Battle detection opens the interactive battle screen only when a human side is involved. When two AI factions at war meet, `StarMapBattleDetectionService` auto-resolves the battle immediately with `autoResolveBattle` (the resolver also used for AI planet assaults) and writes the result to the live fleets via `BattleOutcomeService.applyFleetBattleOutcome`; the player is never pulled into a fight they are not part of. StarMap re-checks the game outcome afterwards (fleet losses can end the game). A pair that fought once is not re-triggered while it shares the cell (the existing `triggeredBattles` rule), so a draw leaves both fleets in place; a goal stuck on such a target is replanned by `EnemyProgressService`.

AI planet assaults on another AI's planet are auto-resolved as before (only human defenders get the battle screen).

## AI decisions (`EnemyDiplomacyService`)

Runs first in every AI tick (`StarMapAiTickService`), so the whole pipeline sees treaties signed that frame. Every `DECISION_INTERVAL` (10 s) of game time each living AI faction reviews its relations, in faction order (deterministic):

**Peace** with a war enemy whose lock has expired, if `wantsPeace(ai, enemy)`:

| Reason | Condition |
| --- | --- |
| `outmatched` | enemy fleet strength ≥ `peaceRatio` × own (personality) |
| `collapsing` | the AI owns ≤ 1 planet, the enemy ≥ `COLLAPSE_ENEMY_PLANETS` (3), and the enemy is not clearly weaker (ratio ≥ 0.8) |
| `second_front` | the AI has ≥ 2 wars, this enemy is not its *primary* enemy, and the enemy is not much weaker (ratio ≥ `SECOND_FRONT_MIN_RATIO`, 0.75) |

The primary enemy is the war enemy with the lowest `empire distance × max(0.5, strength ratio)` — the nearest, weighted toward weaker ones. Two AIs sign peace only when **both** want it. Consequence: a dominant AI never lets a much weaker enemy off (the outmatched side's ratio is the other side's inverse), so AI–AI peace mostly happens between comparable empires that have other, nearer enemies.

Toward the human the AI does not sign; it makes a **peace offer** (`DiplomacyService.addOffer`, open for `PEACE_OFFER_SECONDS`, 60), then waits `OFFER_COOLDOWN` (150 s) before offering again.

**War:** an AI with fewer wars than its personality's `maxWars` declares war on at most one peace partner per review whose lock has expired, that lies within `WAR_REACH` (120 cells between the empires) and whose strength ratio is ≤ `warRatio` (the weakest such neighbour).

| Personality | peaceRatio | warRatio | maxWars |
| --- | --- | --- | --- |
| balanced | 1.4 | 0.6 | 1 |
| expansionist | 1.25 | 0.65 | 1 |
| militarist | 2.0 | 0.85 | 2 |
| technologist | 1.1 | 0.5 | 1 |

**Information:** treaty decisions use the real total living fleet strength of both factions, not the fog-of-war view — rough military power is treated as public knowledge for diplomacy. Tactical layers still only use what their sensors report. Eliminated factions (no planet, no living fleet) take no part.

## Player actions (Diplomacy screen)

Opened with the **DIPLOMACY** button in the star map header (a badge counts open AI peace offers; a map notice announces each new offer, AI war declarations and AI–AI treaties). One card per other participant: relation chip, planets, a coarse fleet-strength comparison (weaker / comparable / stronger than the player's, ratio < 0.75 / > 1.33), whom it is at war / peace with, lock timer, and actions:

- **Propose peace** (at war, lock expired): the AI answers with the same `wantsPeace` rule it uses itself. A refusal starts `PROPOSAL_REFUSAL_COOLDOWN_SECONDS` (45 s) before the next proposal to that AI.
- **Accept / decline** an open AI offer.
- **Declare war** (at peace, lock expired).

The screen does not pause the game. Player treaty changes are saved immediately and re-check the game outcome.

## Diplomatic victory

`GameOutcomeService` (see [Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice)): victory requires that every inhabited planet is allied or owned by an AI **at peace** with the player (independent rebel planets still block), that no AI **at war** with the player has a living fleet, and — if any peace partner still owns an inhabited planet — that the allied side owns more than `DIPLOMATIC_VICTORY_PLANET_SHARE` (50%) of the inhabited planets. The share guard stops "sign peace with everyone early" from being an instant win. Victory is sticky as before.

## Persistence and save compatibility

- `Faction.relations` is saved with the factions; no save-version bump. `SaveGameService.migrateSave` runs `normalizeRelations` on every load (any version): pre-diplomacy saves get explicit war entries for every human/AI pair and keep their allied AI team.
- Not saved (rebuilt within one decision interval): open AI offers, proposal and offer cooldowns, the treaty event queue, the AI decision clock. `resetAiPipeline` (genuine load / new game) clears them; a battle-screen round trip keeps them (the services are not reset on `resumeAfterBattle`).

## Testing

- `diplomacy.spec.ts`: relation kinds, planet-attack rule, normalization and idempotence, legacy-save alliance, lock countdown; `DiplomacyService` locks, offers, events; `EnemyDiplomacyService` peace, offers, war declarations, pause; diplomatic victory and its share guard; AI-vs-AI auto-resolved battles, peace/allied no-fight, human battles still open the screen.
- `ai-simulation.spec.ts`: the harness mirrors the game loop (lock countdown, AI-vs-AI battle auto-resolve; `resolvePlayerFleetBattles` stands in for the player choosing AUTO in whole-game health runs). Scenarios whose premise is "AIs against the player" opt into the pre-diplomacy world with `aiAlliance: true`; league and long-duration runs play real new games with AI wars and treaties.

## Known limitations

- Only war and peace; no alliances, trade, tribute or shared intel between AIs.
- The fleet-strength comparison shown to the player and used by the AI ignores research combat bonuses and stock ships.
- AI–AI battles have no interactive view; the player learns about them only through their results.

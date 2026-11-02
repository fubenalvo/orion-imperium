# Civilian Trade Network

Autonomous civilian traders fly between planets that have a Trading Post. They carry cargo valued in credits, pay the post owners on delivery, and can be raided. Independent civilizations (neutral planets with a Bank and a Trading Post) are the network's first nodes; any faction's Trading Post joins it.

Related: [Economy](./economy.md#trading-post) (the Trading Post building and its exchange, the Bank), [Star Map Terrain](./star-map-terrain.md#drifting-asteroids) (drifting asteroids, the pattern this system follows), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Status

Implemented (phases 2–7 of the plan): the data model, save version 11, slot reconciliation, trips (destination choice, routing, movement), cargo with its payout, the UI (map layer, trader panel, TRADE tab figures), raids (player raid orders, hull damage, loot, diplomatic cost, escalating respawn), independent civilizations (generation, conquest, victory rule) and the AI (commerce construction, civilization assault gate, raids).

## Code

- `src/app/components/star-map/trade-network.ts` — pure rules: `TRADE_NETWORK_CONFIG`, network nodes (`tradePosts`), slots (`desiredTraderSlots`), `reconcileTraders`, save sanitizing.
- `src/app/components/star-map/trade-network.service.ts` — `TradeNetworkService`, the live state of the session: `restore` / `serialize`, the per-frame `tick`.
- Persisted types: `Trader`, `TraderCargo`, `TraderRespawn`, `TradeNetworkState` in `star-map.models.ts`; `StarMapData.tradeNetwork`.
- `star-map-trader-info/` — the trader panel (presentational); the map glyphs are drawn by `StarMapGalaxyViewComponent` (`TraderMapView`).
- `StarMap` restores the service on every load, writes `serialize()` into every save, and calls `tick` from the game loop with the scaled game delta.

## Why traders are not fleets

Traders live only in `TradeNetworkService`, never in `StarMapData.fleets`. Many systems read `fleets` (ship upkeep, AI intel and targeting, battle detection, game outcome, the fleet sidebar, fleet organization, border violations, anomaly triggers, asteroid collection), and every one of them would need an exception for an unarmed, ownerless ship. Drifting asteroids already showed the alternative: a separate entity with its own service, save block and rendering layer.

## Network nodes and slots

- A **node** is a planet that has at least one Trading Post and is not `unhabited`. A planet with several posts (possible only in saves made before the one-per-planet cap) is one node. Independent and rebel planets are nodes too.
- Every node owns `tradersPerPost` (2) **slots**. A slot is the pair `(homePlanetId, slot)`.
- The network holds at most `maxTraders` (60) traders. Slots are filled in planet-id order, so the cap is deterministic.
- Nodes and slots are derived from planet buildings each time; they are never saved.
- **Affiliation is derived**: a trader works for the current owner of its home planet. A captured or rebelling post therefore needs no update in this system.

## Reconciliation

`reconcileTraders` brings the saved traders in line with the current slots. It is the only place traders are created, and it is idempotent, so loading, reloading after a battle and reconciling every second can never create a duplicate.

| Situation | Result |
| --- | --- |
| Two traders in one slot | the lowest id stays, the others are removed |
| A slot whose node is gone, trader docked | removed |
| A slot whose node is gone, trader travelling | marked `retiring`: it finishes its trip, delivers its cargo and is then removed |
| A retiring trader's slot comes back | it takes the slot again; no new trader is built |
| A slot with a pending respawn | stays empty until the respawn's `secondsLeft` reaches 0 |
| An empty slot | a new trader, docked at its home node's star system, `hull` full, no cargo, first departure after 5–30 s (seeded rng) |

`TradeNetworkService.restore` reconciles at once; `tick` counts respawns down and reconciles every `reconcileInterval` (1 s) of game time, so a Trading Post that is built, captured or lost is picked up without event wiring. A paused game (delta 0) changes nothing.

## Trips

All tuning is in `TRADE_NETWORK_CONFIG`.

1. **Docked:** a trader waits `dockSeconds` (20 s; a new trader 5–30 s) at its port, the star system cell of a node.
2. **Departure:** `destinationCandidates` orders the other nodes by a weighted draw without replacement (weight `1 / max(distance, 5 cells)`: near nodes are preferred, far ones still get trade); the previous port (`lastPortPlanetId`) goes last, so a trader only flies back when no other node exists. The first candidate with a route (`StarMapMovementService.planGalaxyRoute`: around black holes and asteroid belts) becomes the destination. With none reachable the trader stays docked and retries after `retryDockSeconds` (30 s), so disconnected nodes never block anything.
3. **Cargo:** loaded at departure, valued by the planned route length: 25 credits per cell, rounded to 10, between 200 and 2000 (`cargoValueForRoute`). The goods label comes from the origin planet's type and is cosmetic.
4. **Travel:** 0.25 cells/s (slower than warships), × the nebula slowdown at the current position, along the cached route. The route is planned only at departure; after a load it is re-planned once from the saved position.
5. **Arrival:** `payDelivery`, then the trader docks at the destination (`portPlanetId`; the old port becomes `lastPortPlanetId`). A retiring trader is removed after its delivery.

**Destination lost mid-trip:** if the destination stopped being a node, the trader flies on to another node with the same cargo (no new value). A travelling trader with no route to any node at all is lost with its cargo (`stranded`), and its slot refills at home; with static terrain this needs every other node to vanish during the trip.

## Cargo and payout

Cargo is **credits only**. Raw materials come only from finite deposits ([Economy](./economy.md)), and resources are per faction, so moving them "between planets" would mean nothing. The value is created by commerce and exists only in the hold until delivery.

On delivery (`payDelivery`):

- the **home post's owner** (the trader's current affiliation) receives the cargo value;
- the **destination's owner** receives a port fee of 20% on top (`portFeeShare`);
- neutral owners (independent civilizations, rebels) receive nothing — a civilian trader between two civilian nodes pays nobody, it is only a raid target;
- a faction owning both ends receives both (120%).

Amounts are whole credits. Like collected asteroids, trade income is a windfall outside the economy tick: no difficulty or war-exhaustion multiplier applies. A battle-return reload restores credits and traders from the same snapshot, so a delivery can neither repeat nor vanish.

Expected size: a typical 50-cell trip (~220 s with the stop) carries 1250 credits, so a node's two traders earn its owner about 11 credits/s plus port fees, against the Trading Post's 4.5–8 credits/s upkeep.

## UI

Minimal by design, so traders do not clutter the map:

- **Galaxy map:** only **travelling** traders are drawn (a docked one sits on its star system), as a small boxy hauler — container segments inside a hull outlined in the home post owner's color (neutral civilians: the independent gold), turned toward the next route point. Same layer as drifting asteroids: above fog and trails, below fleets, so fleets stay clickable. No label and no route line unless selected (dashed ring).
- **Fog of war** (`StarMap.isTraderVisible`): the player's own traders are always visible; every other trader only inside the player's sensor or preview cells, like enemy fleets. With fog off, all are visible.
- **Trader panel** (`StarMapTraderInfoComponent`, click a trader): affiliation in its owner's color ("Independent" for neutral owners), home post, current leg (planet and system names), arrival time (remaining route with nebula slowdown), cargo goods and value, hull. Refreshed at most every 0.5 game seconds from the game loop; it closes when the trader docks or leaves sensor range. Trader and asteroid selection exclude each other.
- **TRADE tab** of a player planet with a Trading Post: this post's traders (en route / docked / rebuilding), traders inbound to it, network size (posts, traders), and the empire's trade income over the last 5 minutes of game time (`recentIncome`, an in-memory ledger: a load starts it at 0). The exchange stays below it.
- **No delivery notices:** deliveries are frequent, so they do not post map notices; the TRADE tab figure is the feedback.

## Raids

Traders are unarmed. A raid is not a battle: there is no battle screen and the trader never fights back; its hull simply wears down while a raider stays close. Code: `processRaids` / `destroyTrader` in the service, `raidBlocker`, `respawnDelay`, `applyRaidConsequences` in `trade-network.ts`, the player pursuit in `fleet-raid-orders.ts`.

**Who may raid whom** (`raidBlocker`): never one's own or a permanent ally's trader (same non-neutral team), and neutral factions never raid. Civilian traders and every other empire's traders may be raided, **at peace too** — with consequences (below), never a war by itself.

**Explicit order only.** A fleet damages a trader only while it carries a raid order on it (`Fleet.raidTraderId`). Fleets that just pass a trader never raid it, so nobody angers a peace partner by accident.

**Damage:** while a fleet with a raid order is within `raidRadius` (1 cell) of the **travelling** trader, the hull (300) loses the summed base attack of the fleet's living warships per second (`raidDamagePerSecond`; recon, colonizer and outpost ships do not count, technology bonuses do not apply). Two frigates need about 6 s, the starting scout fleet about 20 s. Several fleets add up. Docked traders cannot be damaged, and a trader that escapes is repaired in its next port.

**Destruction** (`destroyTrader`), when the hull reaches 0:

- the raiding fleet's faction takes `lootShare` (75%) of the cargo value, in whole credits; the rest is lost;
- the diplomatic cost (`applyRaidConsequences`): a trader of an empire **at peace** with the raider lowers that empire's opinion of the raider by `5 + cargo / 200` (at most 20), and the raider loses 2 reputation; a **civilian** trader costs the raider 1 reputation; an enemy **at war** costs nothing;
- the slot waits for a respawn of `120 s × 2^(recent losses − 1)`, at most 600 s (`respawnDelay`). A node's loss count (`TradeNetworkState.losses`) is forgotten after 600 s without a loss. This, docked traders being safe, and cargo being loaded only at departure keep a fleet parked at a node from farming its traders.

**Player raid orders** (`fleet-raid-orders.ts`): a raid is ordered only by a right-click on the trader with a player fleet selected, the same gesture as intercepting an asteroid; there is no RAID button. A left-click opens the trader panel, which shows the diplomatic cost (or why the trader cannot be raided) and the player fleets already raiding it. Issuing the order shows a map notice that repeats the cost; a fleet without warships, an allied trader or an unreachable trader get a notice instead of an order. The order is a pursuit: the fleet's galaxy target is re-aimed at the trader whenever it drifted half a cell. It ends — with a map notice — when the trader docks, may no longer be raided, leaves sensor range, or cannot be reached; it ends silently when the trader is gone. Any move, intercept or attack order replaces it, and it replaces them. AI fleets are not steered by it (see [AI](#ai)).

**Notices and saving:** the player gets a notice for a kill (loot, and the opinion / reputation cost) and for the loss of one of their own traders. A raid the player took part in is saved at once, like a collected asteroid.

## Independent civilizations

Peaceful neutral cultures, generated at New Game (`civilizations.ts`, `generateCivilizationSystems`, called by `GalaxyGeneratorService`, generator version 7). They are the network's first nodes and the reason it exists before any empire builds a Trading Post.

**What they are — and are not.** A civilization is planets owned by the existing neutral `independent` faction and tagged with `PlanetTile.civilization` (its name, e.g. "Veyra Concord"). It has no fleets, no diplomacy, no AI and no simulation: its existence is ownership, buildings and its traders. Like every `independent` planet it earns nothing and has no colony-core energy while independent.

**Generation:**

- **Count:** 3 / 4 / 5 extra star systems on small / medium / large maps (`CIVILIZATION_CONFIG.systemsBySize`), on top of the preset's regular systems. When no position qualifies, a civilization is skipped, so a galaxy can have fewer (tests check the average stays within one of the target).
- **Placement:** after everything else (regular systems, fleets, nebulae, belts) from its own rng stream (seed XOR a salt), so a seed's regular galaxy is identical with or without civilizations. Best-candidate sampling with the same rules as regular systems (map margin, black hole clearance, minimum system spacing, belt clearance) plus: at least 1.3 × the minimum spacing from every home system, 4 cells from every starting fleet, and a route to the home systems (one shared navigation graph). Therefore no civilization ever shares a system with a player.
- **System:** 2–4 planets with globally unique names and an unused star name. Planet 1 is the **capital** (earthlike / marslike / desert, medium to huge): Large and Medium Residential, Fusion Power Plant, **Bank**, **Trading Post**, Planetary Shield, 2 Laser and 2 Missile Turrets — 150 workforce for 146 required, 110 energy (with the colony core once owned) for 77 used, so a conqueror inherits a working planet. Half the time planet 2 is a second world (Medium Residential, Solar Array, Laser and Missile Turret). Population is 80% of the housing capacity after the planet type's ceiling; satisfaction 60. Settled planets get their surface terrain at once; deposits follow on first load like any other planet.
- **Validation** (`validateGeneratedGalaxy`): regular systems still match the preset count; at most the configured number of civilization systems; tagged planets are `independent`; no player planet in a civilization system; every civilization system has a planet with a Bank and a Trading Post; connectivity and spacing rules cover every system.

**Conquest.** Civilization worlds are captured with the normal rules ([Planet Capture](./planet-capture.md)): `canAttackPlanetOf` allows any empire to attack a neutral owner; the turrets make it a planet battle (battle screen for the player, auto-resolve for AIs). Any ownership change removes the tag (`PlanetOwnershipService.transferPlanet`), so the planet becomes ordinary — a later rebellion makes a rebel planet, not the civilization again. A capture keeps satisfaction at 60 (the capture floor is 40). The Trading Post stays, so the conqueror's network gains the node and its two traders at once (affiliation is derived).

**Victory.** Civilization worlds take no part in the final reckoning: an `independent` planet with a tag is skipped when `GameOutcomeService` counts inhabited planets, so it never blocks a conquest victory. Untagged rebel planets still do.

**UI.** The planet info panel and the planet screen show the civilization's name instead of "Independent", with a one-line note (neutral, no fleets, trades, can be conquered).

**AI.** AI empires may conquer civilization worlds, but only after a personality-dependent time (see [AI](#ai)). Before that gate existed, and with weaker defenses, an AI took a capital about 2 minutes into a simulated game.

## AI

The AI uses the same rules and code paths as the player; these are its decisions. Tuning lives in `AiPersonalityProfile` (`ai-personality.ts`); see also [AI Pipeline](./ai-pipeline.md).

| Personality | Banks | Trading Posts | Civilization assaults from |
| --- | --- | --- | --- |
| Technologist | on every established planet | 2 | 20 min |
| Balanced | on half of them | 1 | 12 min |
| Expansionist | on a third of them | 2 | 10 min |
| Militarist | none — with a large surplus (15 000+ credits) on half of them | none — with a surplus 1 | 8 min |

**Commerce construction** (`EnemyEconomyService`, commerce tier). An optional construction tier after research and before extra factories (`commerceCandidates`). A Bank or Trading Post goes only on an established planet (population ≥ 600) that has the spare workforce and energy for it, so commerce never creates or deepens a shortage. It also never slows a fresh colony or the factories that build colonizers: both happened in simulations before these limits. The upkeep check counts a building's own credit income: the Bank's output, and for a Trading Post `TRADING_POST_EXPECTED_INCOME` (8 credits/s, below the ~11/s of an average node). A building that earns more than it costs is allowed even when the optional-upkeep headroom is used up. A raw-bound faction with more than 15,000 credits may have one Trading Post even if its personality builds none, to buy raw materials there ([AI Pipeline](./ai-pipeline.md#raw-purchases-and-the-reserve-exit)).

**Civilization assaults** (`EnemyFleetService.planAssault`). An `independent` planet with a civilization tag is not an assault target before the personality's `civilizationAssaultAfter` game seconds. Game time comes from the saved game clock (`StarMapData.gameSeconds`, passed to the AI as `gameSeconds`), so a reload neither restarts nor skips the gate. After the gate a civilization world is scored like any other planet and still needs a winning forecast. The capital is defended by a Planetary Shield, 2 Laser and 2 Missile Turrets, the second world by a Laser and a Missile Turret.

**Raids** (`EnemyFleetService`, `raid` role). At each fleet decision, if no fleet of the faction is raiding, one free fleet with a warship (never the home guard) is sent after the nearest travelling trader that:
- the faction can see;
- is within 30 cells of that fleet and 45 cells of its territory;
- `raidBlocker` allows;
- belongs to a civilian owner or a war enemy. A peace partner's trader is never raided, so the AI never pays the diplomatic cost of piracy. Raiding a civilian trader still costs it 1 reputation, like the player.

The fleet carries `Fleet.raidTraderId` only while it has the raid role: a sweep at the end of every decision clears the marker of any fleet that lost the role (retreat, regroup, pipeline takeover). The hunt ends when the trader docks, disappears, leaves sight, stops being a valid target, or after 150 s.

**Simulation coverage** (`ai-simulation.spec.ts`). The harness runs the trade network like `StarMap`. Older scenarios use galaxies without civilizations (`generate(config, seed, { civilizations: false })`, a headless-only option), so they keep testing the regular galaxy. Two 20-minute scenarios, one per seed with different personalities, check:
- commerce construction by personality;
- that no civilization world falls before its captor's gate;
- that AI raids never hit a peace partner.

A 10-minute scenario checks AI health with civilizations.

## Save compatibility

`StarMapData.tradeNetwork = { version, nextId, rngState, traders, respawns, losses? }` and the optional `Fleet.raidTraderId` (a missing field means no raid order; an order pointing at a trader that no longer exists ends on the next frame). `losses` is optional; malformed entries are dropped. `SaveGameService.normalizeSave` gives a new game an empty state on its first load, and the load reconciliation then creates the traders of every existing Trading Post. A malformed state is only a validation warning: `sanitizeTradeNetworkState` drops malformed traders and respawns (or the whole state), keeps ids unique and below `nextId`, and reconciliation rebuilds what is missing.

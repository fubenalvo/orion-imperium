# Territory, Borders and Space Bases

Empire territory on the galaxy map, the diplomatic cost of entering it, space bases (deployable outposts that extend territory), asteroid mining stations (the outpost ship's second use, inside star systems) and the station defense model both station types share. Player and AI follow the same rules through the same code.

Related: [Diplomacy](./diplomacy.md) (opinion, war and peace), [Planet Capture](./planet-capture.md) (ownership pathway, planet battles), [Battle Rules](./battle-rules.md) (combat), [Ship Production](./ship-production.md) (building the outpost ship), [Star Map Terrain](./star-map-terrain.md) (obstacles), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Claim radii, system claim owner, overlap rule, per-cell owner map, render geometry | `territory.ts` (pure) |
| Cached territory, colonization rule (`canColonizeIn`) | `TerritoryService` (`territory.service.ts`) |
| Base config, deployment validation, base defense roster | `space-base.ts` (pure) |
| Shared station defense: core stats, turret progression, shield pool, defense roster builder, surviving-state extraction, mining station addressing | `station-defense.ts` (pure) |
| Live base registry, deploy / destroy, save restore / serialize | `SpaceBaseService` (`space-base.service.ts`) |
| Border violations (detection, opinion penalty, incident memory) | `BorderService` (`border.service.ts`) |
| Station battle triggers | `StarMapBattleDetectionService.checkBaseBattles` (bases), `checkMiningStationBattles` (mining stations) |
| Station battle result (both types) | `BattleOutcomeService.applyStationBattleOutcome` |
| Turret research level | `turret_research_1..3` in `research-tree.json` (`stationTurrets` bonus), `ResearchService.getModifiers().stationTurrets` |
| Passage rights flag | `FactionRelation.passageRights`, `hasPassageRights` (`diplomacy.ts`) |
| Mining station rules (deployment, hover feedback, extraction) | `mining-station.ts` (pure) |
| Deposit status, per-faction survey records | `raw-deposits.ts` |
| AI outpost ships and station deployment | `EnemyMiningService` |
| Mining extraction in the economy tick | `EconomyService.calculateEconomy` / `applyEconomyDelta` |
| Persisted state | `StarMapData.spaceBases`, `SystemAsteroid.miningStation` (both with optional `shieldPoolCurrent` / `hullCurrent`), `FactionRelation.borderIncidents` / `passageRights` |
| UI | territory layer + base markers in `StarMapGalaxyViewComponent`; DEPLOY BASE / DEPLOY MINING and territory notices in `StarMapFleetInfoComponent`; asteroid hover card and station markers in `StarMapSystemGridViewComponent`; turret pips shared by both markers in `_station-turrets.scss`; wiring in `StarMap` |

All grid values use the movement grid convention: a position `(x, y)` lies in cell `(floor(x), floor(y))`; stars and bases sit on integer cells; distances are Euclidean between cell coordinates.

## Territory is derived, never stored

Territory is computed from planet owners and bases, so it can never disagree with them. Nothing about territory is saved.

**Claim sources**

- **Star system:** claims a disc of `systemClaimRadius` = 11 cells around its star (1.5 × the original 7, rounded up) for its *claim owner* — the non-neutral faction owning the most planets there (ties: higher total population, then lower faction id). A system with no non-neutral planet owner claims nothing. Systems are generated 22–30+ cells apart, so neighbouring system discs can touch; the overlap rule below decides those cells.
- **Space base:** claims a disc of `baseClaimRadius` = 5 cells around itself for its owner.

Neutral factions (team 0: `independent` rebels, `unhabited`) never own territory.

**Overlap rule** — every cell has at most one owner:

0. the **Dyson ring zone** (every cell within 10 cells of the black hole center) is outside this rule. No system or base claim ever takes a ring cell; a wedge belongs only to the owner of its completed Dyson anchor, otherwise to nobody ([Dyson Swarm](./dyson-swarm.md#ring-geometry)). Until anchors exist the whole ring zone is unclaimed, and an ordinary base cannot be deployed in it (`dyson_ring`);
1. a system claim beats a base claim (taking a planet always takes its system's space, even against a foreign base);
2. otherwise the nearest claim source wins (squared cell distance);
3. ties go to the older source (systems by their order in `starSystems`, bases by lower id).

`TerritoryMap.systemTerritoryOwner(system)` is the system's own claim owner, or — for an unowned system — the owner of its star cell (a base claim can cover an empty system).

### Event-driven updates

`TerritoryService.get(starSystems, factions)` returns a cached `TerritoryMap` and rebuilds it only when an input changed: `PlanetOwnershipService.revision` (every owner change goes through `transferPlanet`), `SpaceBaseService.revision` (deploy, destroy, restore), a different `starSystems` / `factions` array (load, new game) or the grid size. Ownership changes therefore update borders immediately (capture, colonization, rebellion) without any per-frame map scan. Code that writes `PlanetTile.factionId` directly (only tests) must call `invalidate()`.

`StarMap.refreshTerritoryViews` runs every frame but only rebuilds the SVG paths when the cached map instance changed.

## Border violations

A fleet is **violating a border** while it stands in a cell owned by another empire its faction is **at peace** with, unless that empire granted it passage. At war there is no violation (the sides fight instead); own, allied and neutral space is free.

`BorderService.tick` (every `checkInterval` = 1 s of game time, from `StarMap.gameLoopCallback` right after the diplomacy tick) applies, for the territory owner's opinion of the intruder:

- **entry:** `incidentOpinion` (−2) × size × repeat, and the owner remembers one more incident;
- **staying:** `opinionPerMinute` (−3) × size × repeat per minute of game time, continuously.

`size` = fleet value / 1000 clamped to [0.25, 3] (a scout barely matters, a battle fleet weighs ×3). `repeat` = 1 + 0.5 × min(4, remembered incidents before this one). Remembered incidents (`FactionRelation.borderIncidents`, per side) fade by 0.2 per minute of game time and survive war, peace and load normalization.

**A border violation is never a war declaration.** The service only changes opinion; the treaty state is untouched. The consequence reaches the AI through its normal opinion-driven decisions (a lower opinion makes an AI more willing to declare war and less willing to accept terms, see [Diplomacy](./diplomacy.md#ai-judgment-enemydiplomacyservice)).

Runtime state (which fleet is inside whose territory) is not saved. After any load the first check only re-registers fleets already inside — they were counted before the save — so a load never creates an incident.

Player feedback: a map notice when a player fleet starts a violation or a foreign fleet violates the player's territory, and a warning line in the fleet panel while the selected fleet is violating a border.

### Passage rights (prepared)

`FactionRelation.passageRights` on the owner's side means "the owner lets the other pass freely". `hasPassageRights(owner, guest)` requires peace; `BorderService` already honors it, `startWar` revokes it and load normalization drops it at war. Nothing grants it yet — a future passage treaty only needs to set the flag.

## Colonization rule

An uninhabited planet cannot be colonized in a system lying in another empire's territory (`systemTerritoryOwner` is someone else) unless the colonizer is at war with that empire. Own and neutral space is always open. `TerritoryService.canColonizeIn` is the single rule:

- player: `StarMapPlanetArrivalService.getColonizablePlanet` (hides COLONIZE) / `colonize` (re-checks) and `getTerritoryBlocker` (fleet panel explanation);
- AI: `EnemyGoalService` filters colonize candidates and drops a goal whose target fell into foreign territory; `EnemyActionExecutor.executeColonize` re-checks.

## Space bases

### Outpost ship

`outpost_ship` (`ship-data.json`, role `Outpost`): built like any ship, carried in fleets, unlocked by Basic Engineering. It is not a combat ship (`isCombatShipType` excludes it, so the AI never builds it as a warship). It has two deployment targets, both consuming the ship: a **space base** in open galaxy space (below) and a **mining station** on an asteroid deposit inside a star system ([Mining stations](#mining-stations)). The fleet panel offers the one that fits where the fleet is: DEPLOY BASE on the galaxy map, DEPLOY MINING inside a system.

### Deployment

DEPLOY BASE in the fleet panel (player) — the AI does not deploy bases yet but would use the same functions. `validateBaseDeployment` requires:

- a living outpost ship in a stopped fleet (`targetX/Y` null) on the galaxy map (not inside a system view);
- a non-neutral owner, a cell inside the map and outside every navigation obstacle (black hole zone, asteroid belt);
- at least `minStarDistance` = 3 cells from every star (bases sit in open space; systems are claimed by colonies);
- a cell that is **not another empire's territory** (own or neutral space only — at war and at peace alike);
- at least `minBaseSpacing` = 10 cells from every other base, own or foreign;
- outside the Dyson ring zone around the black hole (`dyson_ring`; the zone is reserved for Dyson anchors, [Dyson Swarm](./dyson-swarm.md#ring-geometry)).

`SpaceBaseService.deploy` re-checks, removes one outpost ship, creates the base on the fleet's cell (named after the nearest star, e.g. "Vega Outpost") as a [construction site](#construction) and retires a fleet left without living ships, like colonization does. The base claims territory and senses only once complete (60 s).

A **Dyson anchor** is a space base of kind `dyson` on a ring slot, deployed by a Swarm Constructor instead of an outpost ship. It follows its own placement, territory, upkeep and bonus rules ([Dyson Swarm](./dyson-swarm.md#implementation-phase-2)) and shares everything else on this page: construction, station defense, battles, sensors, save. Ordinary base spacing ignores anchors.

A base is permanent and immobile. It cannot be moved, carried or captured; it only ends by destruction. Its only functions are observation (a sensor source of `sensorRange` = 6 cells + research bonus for a player base — the game's "radar station") and territory. It has no economy, research or production; it does cost upkeep (25 points/s, see [Economy](./economy.md#upkeep)).

### Combat

A fleet whose faction is at war with a base's owner and enters the base's cell attacks it (`checkBaseBattles`, after fleet-vs-fleet detection each frame; a pair is triggered once until the next battle return). The base fights with the shared [station defense](#station-defense) model:

- `buildBaseDefenseFleet` produces the virtual defense fleet (id `-(10 000 000 + base.id)`, never written back) from the base's persisted hull and shield and its owner's current turret level, or the passive construction site while the base is being built ([Construction](#construction)).
- The battle is a `Battle` of `type: 'planet'` with `spaceBaseId` set (and no `planetId`).
- `BattleOutcomeService.applyStationBattleOutcome`: on attacker victory the base is removed — its territory claim and its sensor coverage disappear with it (the sensor layer reads the live registry every frame, territory is rebuilt on the registry revision) — otherwise it keeps its remaining shield and hull. The AI-vs-AI path applies the result to the live registry (`SpaceBaseService.destroy` / `setDefenseState`); the battle screen applies it to the autosave snapshot and the reload after the battle restores the registry from it.

## Station defense

Space bases and mining stations are both **stations** and share one defense model (`station-defense.ts`); there is no per-type combat code. Their primary functions stay separate: a base senses and claims territory, a mining station extracts its asteroid — neither ever gains the other's function.

| Part | Rule |
| --- | --- |
| Hull | The **station core** (`station_core`: 900 HP, 30 energy attack, defense 15, range 4, resolved by `PlanetBattleService.getVirtualShipType`), an immobile virtual unit. Its hit points are the station's own health; what is left after a battle it survives is persisted (`hullCurrent`). There is no repair yet. |
| Turrets | 0–3, added in the order `laser_turret`, `laser_turret`, `missile_turret` (the planet turret buildings, same stats as on planets). The count is the **owner's** Turret Research level: Turret Research I, II and III each add one (`stationTurrets` bonus, summed by `ResearchService.getModifiers`, clamped by `stationTurretCount`). |
| Shield | One shared pool of 250 (+12 regeneration per regen tick) over every immobile unit, persisted after a battle (`shieldPoolCurrent`), like a planetary shield. |
| Destruction | The station is destroyed when the attacker wins (core and every turret destroyed). A station is never captured. |
| Under construction | A single passive `construction_site` unit instead of core, turrets and shield ([Construction](#construction)). |

**Turret Research I–III** (`turret_research_1..3`) is one empire-wide progression for every station type — there are no type-specific turret technologies. The level is derived from `researchedTechnologies` whenever a station battle is built or a marker is drawn and is never stored on a station, so researching a level upgrades every existing base and mining station at once, a newly deployed station starts at the current level, and a save always shows the turrets of its saved research.

**Combat path.** A station battle is a `type: 'planet'` battle (static defenses) naming its station with `spaceBaseId` or `miningStation` (`{ systemId, col, row }`, the asteroid), never `planetId`. A human side opens the battle screen ("STATION BATTLE", result DESTROYED / DEFENDED); AI vs AI is auto-resolved at once (`autoResolveBattle`) and applied to the live state. Both types end in `BattleOutcomeService.applyStationBattleOutcome`, which writes back the attacker roster and war losses, removes a destroyed station or stores the survivor's shield and hull.

**Display.** Both markers show one small lit pip per turret in the owner's color along their top edge (`_station-turrets.scss`); the base keeps its turning ring, the mining station its rotated frame. The base click notice and the mining station hover card add `Turrets n/3 · Hull h/900`.

## Construction

Stations are not finished on deployment (`station-construction.ts`). Deployment consumes the outpost ship and leaves a **construction site** on the station's spot. The station completes after a fixed construction time of scaled game time:

| Station | `STATION_CONSTRUCTION_SECONDS` |
| --- | --- |
| Space base | 60 s |
| Mining station | 180 s |

The site is a real `SpaceBase` / `MiningStation` record with `constructionRemaining` set (seconds left). What that means:

- **It reserves its spot.** One station per asteroid and the base spacing count sites. The AI treats an asteroid with a site as taken, so it never sends a second outpost ship there.
- **It has none of the station's functions.** Every consumer asks `isStationComplete`:
  - territory: `TerritoryService` reads `SpaceBaseService.completeBases`;
  - sensors: `StarMap.updateSensorVisibility` passes `completeBases`;
  - extraction and the HUD rate: `activeMiningStationsOf`;
  - upkeep: `EconomyService.getStationUpkeepPerSecond`.
- **It can be attacked** by the usual station battle rules. It fights as a single `construction_site` unit (`CONSTRUCTION_SITE_STATS`: 300 HP, no attack, no turrets, no shield), so any hostile warship fleet destroys it without losses. The ship is lost with it.
- **Completion:** `StarMap.updateStationConstruction` advances every site each frame by the scaled delta, so a paused game freezes it. The headless simulation does the same.
  - A completed base bumps `SpaceBaseService.revision`, so territory and sensors update on the same frame.
  - The site's battle damage is dropped: the finished station starts at full hull and shield.
  - The player gets a map notice when one of their own stations completes.
- **Display:**
  - A base site is a dim, still silhouette with a progress arc in the owner's color. It shows no claim ring and no turret pips.
  - A mining site has a dotted frame labelled `BUILDING · n S`.
  - The base click notice and the mining hover card say "Under construction · n s left". A foreign site's hover card does not reveal the deposit.

## Mining stations

The outpost ship's second use (`mining-station.ts`): inside a star system it can be turned into a mining station on a surveyed asteroid deposit of the system's asteroid belt ([Game Systems](./game-systems.md#star-system-view)).

### Deployment

DEPLOY MINING in the fleet panel (player; it replaces DEPLOY BASE while the fleet is inside a system). Same pattern as the base: the station goes where the fleet stands. `validateMiningStationDeployment` requires:

- a living outpost ship in a fleet of a non-neutral faction;
- the fleet is inside a star system and stopped (no galaxy target, no in-system target);
- the fleet's system cell holds an asteroid (`asteroidUnderFleet`) that passes `asteroidMiningBlocker`:
  - no station on it yet (**one station per asteroid**),
  - surveyed **by the deploying faction** (the deposit must be known to it: `surveyed` for the player, `surveyedBy` for an AI; see the survey rule in [Game Systems](./game-systems.md#star-system-view)),
  - `rawMaterials > 0` (barren rocks are never targets),
  - the system is not in another empire's territory (`systemTerritoryOwner` is the deployer or nobody: the same own-or-neutral rule as bases and colonization).

`deployMiningStation` re-checks, removes one outpost ship, sets `asteroid.miningStation = { factionId, constructionRemaining: 180 }` and retires a fleet left without living ships, exactly like a base deployment. No battle, territory or sensor change follows. The station is a [construction site](#construction) for 180 s, and extracts and pays upkeep only once complete. After that it defends itself at its owner's current turret level ([Station defense](#station-defense)).

A completed mining station costs upkeep (15 points/s, see [Economy](./economy.md#upkeep)) while its asteroid still has raw materials. A station on a depleted asteroid is idle and costs nothing: stations cannot be dismantled, so an upkeep on dead stations would be a permanent drain (in the 2026-11-01 QA runs most AI stations were depleted by minute 40, and they were the largest part of a shrunken empire's deficit).

Storing the station on the asteroid ties it to its asteroid, system and owner by construction and makes a second station on the same asteroid unrepresentable.

### Extraction

Each completed station with a remaining deposit extracts its asteroid's own `extractionRate` (3–8 raw materials per second of game time, generated per asteroid; `MINING_STATION_CONFIG.extractionPerSecond` = 5 is only the fallback) × the faction's gain multiplier (AI difficulty × war exhaustion, like building output). It runs inside the economy tick, not on its own timer:

- `calculateEconomy` adds the stations' nominal rate to the faction's raw production and net, so the HUD shows it.
- `applyEconomyDelta` replaces that nominal rate with what `extractMiningStations` actually takes this tick: each station takes at most its remaining deposit and subtracts it from `asteroid.rawMaterials`. A deposit never goes negative and nothing is credited twice.

A 3,000–7,000 deposit (2,000–4,000 in belts generated before finite-deposit tuning) lasts about 6–40 minutes. A depleted station stays on its asteroid and produces nothing; the asteroid stays occupied and the deposit never refills ([Economy](./economy.md#finite-deposits)). The owner is notified when it runs dry. After deployment a station no longer depends on territory: it keeps mining if its system later falls into another empire's territory.

### Combat

A fleet attacks a mining station when its faction is **at war** with the station's owner, it is **stopped in the station's star system** (on the system's galaxy cell, no galaxy target — in-system movement does not matter) and it carries at least one **warship** (`isCombatShipType`: not a scout, colonizer or outpost ship) — `checkMiningStationBattles`, after the fleet and base checks each frame. The rule uses the galaxy cell, not system-view positions, because AI fleets never get in-system positions; it therefore works the same for player and AI in any view and AI fleets that garrison or assault a system engage its hostile stations without dedicated planning. Civilian convoys are ignored so a colonizer or outpost fleet parked in a contested system is not thrown away. Each (station, fleet) pair triggers once until the next battle return; a fleet fights one station at a time (with several hostile stations an AI fleet works through them in one frame, an interactive battle takes them one by one).

The station fights with the [station defense](#station-defense) model. Destroying it deletes `asteroid.miningStation`: extraction stops on that tick, the asteroid and its remaining deposit stay (a new outpost ship may build there later), and no other station, base or planet is touched.

### Hover feedback

In the system view, hovering an asteroid shows a ring and a small card (`describeAsteroidForFaction`, computed only for the hovered rock):

| Tone | Case |
| --- | --- |
| valid (green) | surveyed deposit, free, own or neutral space, and a player outpost fleet is in this system; the card says whether one is already in position |
| invalid (red) | barren; occupied by another faction's station; foreign territory; or no outpost ship in this system |
| neutral (dim) | unsurveyed (the deposit amount is never shown before the survey) |
| own (owner color) | the player's station: remaining / original deposit, extracted %, extraction rate — or DEPLETED |

Deposit cards show the remaining amount and the asteroid's extraction rate. Stations are drawn as a rotated frame in the owner's color around the rock, labeled with the remaining amount and the share left, or DEPLETED; a depleted station's frame is dashed and dimmed, so unmined deposits (amber glow), active stations and depleted ones are told apart at a glance. Hover never blocks clicks: events bubble to the grid, so move orders onto an asteroid work as before.

## Rendering

- **Territory layer** (`.territory-layer`, galaxy view): one SVG in grid units under the fog (z 4, like nebulae), so unexplored space stays dark and every star, planet, fleet and marker stays on top. Per empire: a faint, softly blurred fill (7%, own 10%) and a thin border on the cell edges facing other owners — solid for the player, dashed for foreign empires; neutral space is untinted. Paths come from `buildTerritoryShapes` (row runs for the fill, merged edge runs for the border).
- **Base claim** circles: faint dashed rings in the owner's color.
- **Base markers** (`.space-base`): a slowly turning dashed ring around a lit core in the owner's color, with the name below, between the fog and the fleets. Own bases are always shown; foreign bases once their cell was explored (static structures stay known); all of them with fog of war disabled. The click shows a notice and bubbles to the map, so move and attack orders onto a base cell work as usual.

## Persistence and save compatibility

- `StarMapData.spaceBases` (ordinary bases and Dyson anchors, `kind` / `dysonSlot` / `dysonBonus`). `normalizeSave` gives a new game `[]` on its first load; `validateSaveData` rejects a non-array and only warns about malformed entries, which `SpaceBaseService.restore` drops. A destroyed base is removed, so every stored base is alive. Base ids are `max + 1`.
- `FactionRelation.borderIncidents` and `passageRights` are optional relation fields (no version bump of their own); `normalizeRelations` keeps them (passage only at peace).
- Territory, the active violation set and the cache are runtime only.
- Station defense state is the optional `hullCurrent` and `shieldPoolCurrent` on `SpaceBase` and `MiningStation` (no version bump; missing = full). Turret counts are never saved — they follow the saved research.
- Construction state is the optional `constructionRemaining` on `SpaceBase` and `MiningStation` (no version bump; missing or not a positive number = complete), so a reload continues a site's timer.
- Mining stations are saved as the optional `SystemAsteroid.miningStation` inside `StarSystem.asteroidBelt` (no version bump; older saves simply have none). `ensureSystemAsteroidBelts` drops a malformed station on load instead of regenerating the belt, so survey state and other stations are kept. The remaining deposit (`rawMaterials`, fractional while being mined), the original size (`totalRawMaterials`), the rate (`extractionRate`) and AI surveys (`surveyedBy`) are saved with it; belts from before these fields get them on load ([Economy](./economy.md#save-compatibility)).

## Edge cases

- Planets of several empires in one system: the claim owner is the majority holder; the other empires' planets are still theirs, only the space belongs to the majority.
- A base cannot be built inside foreign territory, but a colony captured later inside a base's claim takes those cells (system beats base).
- Capturing the last planet of a system hands its whole disc to the conqueror immediately; losing it to rebels (team 0) leaves the space unclaimed (or to a covering base).
- A border violation and the war declaration stay separate: entering, staying or repeating only costs opinion.
- Fleets inside a system's view stand on the star cell, so a system's territory also covers fleets parked in it.
- Bases do not count for victory or defeat ([Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice)): an empire with bases but no planet and no fleet is eliminated; its bases stay until destroyed.
- A fleet passing over a hostile base's cell mid-route attacks it, exactly like passing through a hostile fleet's cell.

## Testing

- `territory.spec.ts`: claim owner (majority, population and id ties, neutrals), disc radius, overlap rule (system beats base, nearest, older), render shapes, cache invalidation on ownership change and on base restore/destroy, colonization rule (peace blocks, war allows, own/neutral space; the AI goal layer skips a peace partner's system and targets it at war), border violations (size scaling, ongoing cost, no war, intruder view unchanged, repeats cost more, war / passage / own territory exempt, load seeding, incident decay and normalization).
- `mining-station.spec.ts`: every mining deployment rule, deploy mutation (ship consumed, station on the right asteroid and system as a construction site, owner faction, fleet retirement), no extraction or upkeep before completion, one station per asteroid, barren asteroids refused, base deployment still working from the same ship type, extraction in the economy tick (owner only, deposit capped and depleted, depleted station kept), hover tones, save slot round trip and malformed-station cleanup.
- `space-base.spec.ts`: every deployment rule, deploy mutation (ship consumed, name, territory only after completion), fleet retirement and spacing, peace partner territory, base as player sensor source, defense roster and persisted shield, AI-vs-AI destruction removing the claim, no battle at peace, player base battle transport, battle-screen outcome (removal, surviving shield, wiped attacker), save migration, slot round trip, validation of malformed bases.
- `station-defense.spec.ts`: construction sites (passive roster, destroyed by any warship fleet without losses, completion dropping site damage, frozen while paused), one turret research progression (three technologies, no per-type variants), levels 0–III giving 0–3 turrets to existing bases and mining stations alike (owner's research, not the attacker's), new deployments at the current level, roster with persisted hull and shield, AI-vs-AI mining station destruction (extraction stops, deposit stays), a holding station keeping shield and hull, trigger rules (war, stopped, in the system, warship only), player station battle transport, isolation from other stations / bases / planets, a destroyed player base leaving the sensor layer, battle-screen outcome on mining stations, separate station functions, hover defense line, save/load of defense state with research-derived turrets.

## Known limitations

- The AI does not deploy space bases (it builds outpost ships only for mining stations, see [AI Pipeline](./ai-pipeline.md#asteroid-mining-enemyminingservice)), does not plan assaults on bases, and does not route its fleets around peace partners' territory (it pays the same opinion cost as the player would).
- No passage treaties yet (the flag exists).
- Mining stations cannot be captured or dismantled, and a depleted station is not removed (only destruction removes it).
- Station hull damage is never repaired, and the shield pool does not regenerate outside battles (like planets).
- The AI does not plan attacks on ordinary bases or mining stations, or defend its own: AI fleets engage them only where their other orders take them (bases on their route, mining stations in systems they stop in), and the AI's assault forecast ignores stations in the target system. Dyson anchors are hunted and guarded by `EnemyDysonService` ([Dyson Swarm](./dyson-swarm.md#ai)).
- Research raw-output bonuses do not apply to mining stations (only the faction gain multiplier does); they do apply to planet mines.

# Territory, Borders and Space Bases

Empire territory on the galaxy map, the diplomatic cost of entering it, and space bases (deployable outposts that extend territory). Player and AI follow the same rules through the same code.

Related: [Diplomacy](./diplomacy.md) (opinion, war and peace), [Planet Capture](./planet-capture.md) (ownership pathway, planet battles), [Battle Rules](./battle-rules.md) (combat), [Ship Production](./ship-production.md) (building the outpost ship), [Star Map Terrain](./star-map-terrain.md) (obstacles), [Data Models](./data-models.md), [Invariants](./invariants.md).

## Sources of truth

| What | Where |
| --- | --- |
| Claim radii, system claim owner, overlap rule, per-cell owner map, render geometry | `territory.ts` (pure) |
| Cached territory, colonization rule (`canColonizeIn`) | `TerritoryService` (`territory.service.ts`) |
| Base config, station core stats, deployment validation, base defense roster | `space-base.ts` (pure) |
| Live base registry, deploy / destroy, save restore / serialize | `SpaceBaseService` (`space-base.service.ts`) |
| Border violations (detection, opinion penalty, incident memory) | `BorderService` (`border.service.ts`) |
| Base battle trigger | `StarMapBattleDetectionService.checkBaseBattles` |
| Base battle result | `BattleOutcomeService.applySpaceBaseBattleOutcome` |
| Passage rights flag | `FactionRelation.passageRights`, `hasPassageRights` (`diplomacy.ts`) |
| Persisted state | `StarMapData.spaceBases`, `FactionRelation.borderIncidents` / `passageRights` |
| UI | territory layer + base markers in `StarMapGalaxyViewComponent`; DEPLOY BASE and territory notices in `StarMapFleetInfoComponent`; wiring in `StarMap` |

All grid values use the movement grid convention: a position `(x, y)` lies in cell `(floor(x), floor(y))`; stars and bases sit on integer cells; distances are Euclidean between cell coordinates.

## Territory is derived, never stored

Territory is computed from planet owners and bases, so it can never disagree with them. Nothing about territory is saved.

**Claim sources**

- **Star system:** claims a disc of `systemClaimRadius` = 7 cells around its star for its *claim owner* — the non-neutral faction owning the most planets there (ties: higher total population, then lower faction id). A system with no non-neutral planet owner claims nothing. Systems are generated 22–30+ cells apart, so system discs rarely touch.
- **Space base:** claims a disc of `baseClaimRadius` = 5 cells around itself for its owner.

Neutral factions (team 0: `independent` rebels, `unhabited`) never own territory.

**Overlap rule** — every cell has at most one owner:

1. a system claim beats a base claim (taking a planet always takes its system's space, even against a foreign base);
2. otherwise the nearest claim source wins (squared cell distance);
3. ties go to the older source (systems by their order in `starSystems`, bases by lower id).

`TerritoryMap.systemTerritoryOwner(system)` is the system's own claim owner, or — for an unowned system — the owner of its star cell (a base claim can cover an empty system).

### Event-driven updates

`TerritoryService.get(starSystems, factions)` returns a cached `TerritoryMap` and rebuilds it only when an input changed: `PlanetOwnershipService.revision` (every owner change goes through `transferPlanet`), `SpaceBaseService.revision` (deploy, destroy, restore), a different `starSystems` / `factions` array (load, new game) or the grid size. Ownership changes therefore update borders immediately (capture, colonization, cession, rebellion) without any per-frame map scan. Code that writes `PlanetTile.factionId` directly (only tests) must call `invalidate()`.

`StarMap.refreshTerritoryViews` runs every frame but only rebuilds the SVG paths when the cached map instance changed.

## Border violations

A fleet is **violating a border** while it stands in a cell owned by another empire its faction is **at peace** with, unless that empire granted it passage. At war there is no violation (the sides fight instead); own, allied and neutral space is free.

`BorderService.tick` (every `checkInterval` = 1 s of game time, from `StarMap.gameLoopCallback` right after the diplomacy tick) applies, for the territory owner's opinion of the intruder:

- **entry:** `incidentOpinion` (−2) × size × repeat, and the owner remembers one more incident;
- **staying:** `opinionPerTurn` (−3) × size × repeat per diplomatic turn (60 s), continuously.

`size` = fleet value / 1000 clamped to [0.25, 3] (a scout barely matters, a battle fleet weighs ×3). `repeat` = 1 + 0.5 × min(4, remembered incidents before this one). Remembered incidents (`FactionRelation.borderIncidents`, per side) fade by 0.2 per turn and survive war, peace and load normalization.

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

`outpost_ship` (`ship-data.json`, role `Outpost`): built like any ship, carried in fleets, unlocked by Basic Engineering. It is not a combat ship (`isCombatShipType` excludes it, so the AI never builds it as a warship).

### Deployment

DEPLOY BASE in the fleet panel (player) — the AI does not deploy bases yet but would use the same functions. `validateBaseDeployment` requires:

- a living outpost ship in a stopped fleet (`targetX/Y` null) on the galaxy map (not inside a system view);
- a non-neutral owner, a cell inside the map and outside every navigation obstacle (black hole zone, asteroid belt);
- at least `minStarDistance` = 3 cells from every star (bases sit in open space; systems are claimed by colonies);
- a cell that is **not another empire's territory** (own or neutral space only — at war and at peace alike);
- at least `minBaseSpacing` = 10 cells from every other base, own or foreign.

`SpaceBaseService.deploy` re-checks, removes one outpost ship, creates the base on the fleet's cell (named after the nearest star, e.g. "Vega Outpost"), bumps the revision (territory and sensors update at once) and retires a fleet left without living ships, like colonization does.

A base is permanent and immobile. It cannot be moved, carried or captured; it only ends by destruction. Its only functions are observation (a sensor source of `sensorRange` = 6 cells + research bonus for a player base) and territory. It has no economy, upkeep, research or production.

### Combat

A fleet whose faction is at war with a base's owner and enters the base's cell attacks it (`checkBaseBattles`, after fleet-vs-fleet detection each frame; a pair is triggered once until the next battle return). The base fights exactly like a planet's static defenses — no parallel combat system:

- `buildBaseDefenseFleet` produces a virtual defense fleet (id `-(10 000 000 + base.id)`, never written back) with the **station core** (`station_core`: 900 HP, 30 energy attack, defense 15, range 4, resolved by `PlanetBattleService.getVirtualShipType`) and the planet turret types `laser_turret`, `laser_turret`, `missile_turret`, all immobile, under a shared shield pool of 250 (+12 regeneration). The pool left after a battle is persisted (`SpaceBase.shieldPoolCurrent`), like a planet's.
- The battle is a `Battle` of `type: 'planet'` with `spaceBaseId` set (and no `planetId`); the battle screen shows a station instead of a planet ("STATION BATTLE", result DESTROYED / DEFENDED).
- A human side opens the battle screen; AI vs AI is auto-resolved immediately (`autoResolveBattle`) and applied to the live registry.
- `BattleOutcomeService.applySpaceBaseBattleOutcome`: the attacker roster is written back (damage, losses, wipe-out); on attacker victory the base is removed — its territory claim disappears with it — otherwise it keeps its remaining shield. War losses are recorded like every battle. The battle screen applies it to the autosave snapshot; the reload after the battle restores the registry from it.

## Rendering

- **Territory layer** (`.territory-layer`, galaxy view): one SVG in grid units under the fog (z 4, like nebulae), so unexplored space stays dark and every star, planet, fleet and marker stays on top. Per empire: a faint, softly blurred fill (7%, own 10%) and a thin border on the cell edges facing other owners — solid for the player, dashed for foreign empires; neutral space is untinted. Paths come from `buildTerritoryShapes` (row runs for the fill, merged edge runs for the border).
- **Base claim** circles: faint dashed rings in the owner's color.
- **Base markers** (`.space-base`): a slowly turning dashed ring around a lit core in the owner's color, with the name below, between the fog and the fleets. Own bases are always shown; foreign bases once their cell was explored (static structures stay known); all of them with fog of war disabled. The click shows a notice and bubbles to the map, so move and attack orders onto a base cell work as usual.

## Persistence and save compatibility

- `StarMapData.spaceBases` (save version 7). `migrateSave` gives older saves `[]`; `validateSaveData` rejects a non-array and only warns about malformed entries, which `SpaceBaseService.restore` drops. A destroyed base is removed, so every stored base is alive. Base ids are `max + 1`.
- `FactionRelation.borderIncidents` and `passageRights` are optional relation fields (no version bump of their own); `normalizeRelations` keeps them (passage only at peace).
- Territory, the active violation set and the cache are runtime only.

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
- `space-base.spec.ts`: every deployment rule, deploy mutation (ship consumed, name, territory), fleet retirement and spacing, peace partner territory, base as player sensor source, defense roster and persisted shield, AI-vs-AI destruction removing the claim, no battle at peace, player base battle transport, battle-screen outcome (removal, surviving shield, wiped attacker), save migration, slot round trip, validation of malformed bases.

## Known limitations

- The AI does not build or deploy outpost ships, does not plan assaults on bases, and does not route its fleets around peace partners' territory (it pays the same opinion cost as the player would).
- No passage treaties yet (the flag exists).

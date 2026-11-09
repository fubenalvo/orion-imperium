# Ship Equipment (Engine / Weapon / Defense modules)

> **Status: Phases 1–8b of the roadmap implemented (catalog, stat resolver,
> persistence, battle, map speed, production / inventory / install rules /
> research unlocks, UI, battle info and displays, AI, module balance pass).**
> The player and every AI personality build, install and use modules; each
> module has its own technology. Only the optional extensions of Phase 9
> are still the plan; sections B–D describe the design the implementation
> follows, and the "Implemented so far" notes record where it differs
> as each phase lands (see [Implementation roadmap](#e-implementation-roadmap)).
> Written 2026-11-08 from an inspection of the code at commit `30f72c4`;
> the design decisions were made the same day (see
> [Decisions](#decisions-2026-11-08)).

## Implemented so far (Phases 1–8)

### Phase 1: catalog and resolver

| File | Contents |
|---|---|
| `src/app/components/star-map/equipment-data.json` | The module catalog: 3 standard modules, 3 engines, 3 weapons, 4 defense modules ([C.2](#c2-recommended-initial-catalog)), and `restrictedHulls` (colonizer, outpost ship and swarm constructor accept the engine slot only) |
| `src/app/components/star-map/equipment.ts` | Types (`EquipmentSlot`, `EquipmentDefinition`, `ShipLoadout`), catalog access, `moduleInSlot` / `resolveLoadout` (unknown id, wrong slot or locked hull slot → standard), `loadoutKey` ('' for a standard loadout), `moduleBuildTime` (default price / 10 s), `describeModuleEffects` (UI text from the data) |
| `src/app/components/star-map/ship-stats.ts` | `resolveShipStats(shipType, loadout?, research?)`: hull → research multipliers on attack and shield → fixed module additions → floors (only on stats a module changed); `fireRate` vs `hullFireRate`; `strategicSpeedBonus`, `effectiveFleetSpeed` (stored speed + lowest engine bonus of living ships, unchanged for standard engines) |
| `equipment.spec.ts`, `ship-stats.spec.ts` | Catalog sanity (one standard per slot adding nothing, prices, slot/stat placement, fire-rate factor limits, one weapon per damage type and one defense per profile), loadout fallbacks, and the identity guarantee: a standard loadout resolves to exactly `getBattleShipStats` for every hull |

### Phase 2: persistence and carry-through

- **Fields:** `FleetShip.equipment?` (both declarations: `star-map.models.ts`
  and `battle.types.ts`), `ShipStockEntry.equipment?` (`ShipLoadout`), and
  `StarMapData.equipmentInventory?` (`FactionEquipmentInventory[]`,
  `{ factionId, modules: Record<moduleId, count> }`). StarMap keeps the
  inventory in `equipmentInventory`, writes it in `serializeGameState` and
  reads it in `loadGame` (missing = `[]`). Nothing adds modules to it yet.
- **Carry-through:** `copyEquipment(source)` (`equipment.ts`) returns a copy
  of the source's loadout to spread into a rebuilt record. It is used where
  a stock entry becomes a fleet ship (`FleetAssemblyService.stockEntryToFleetShip`,
  `FleetOrganizationService.toFleetShip`) and back (`applyPlan`'s reserve
  branch, `ShipStockService.disbandFleet`). Fleet ships moved between fleets
  were already the same record objects.
- **Battle write-back:** `shipsFromOutcome(ships, previous)` takes the
  fleet's roster before the battle and keeps every field of a ship it finds
  there, changing only hull and the destroyed flag. All three
  `BattleOutcomeService` paths and `StarMap.applyBattleResult` (which had
  its own copy of the old code) pass the roster. Destroyed ships keep their
  loadout on the wreck record; it no longer counts anywhere.
- **Validation** (`save-validation.ts`): a non-object loadout, an unknown
  slot or an empty module id is an error; an unknown module or a module in
  the wrong slot is a warning (kept in the save, resolves to standard). The
  inventory must be an array of `{ factionId, modules }` with non-negative
  integer counts; unknown or standard module ids there are warnings.
- **Save format:** additive optional fields, no `SAVE_VERSION` bump.
- **Tests:** `src/app/services/equipment-persistence.spec.ts` covers
  `copyEquipment`, `shipsFromOutcome`, a resolved fleet battle applied
  through `BattleOutcomeService`, reinforcement from the stock, fleet
  organization with the reserve, disband, validation and `normalizeSave`.
  There are eight rebuild sites, not the six listed in A.3: the audit
  missed `StarMap.applyBattleResult`, and the Fleet Command draft
  (`fleet-organization-draft.ts`) copies reserve entries for display only
  (its plan carries ids, so it needs no change).

### Phase 3: battle

The battle rules are in [Battle Rules → Ship Equipment](./battle-rules.md#ship-equipment).
In short:

- `battle-state.ts`: `withEquipment` after `withCombatBonus` (per-ship
  values via `resolveShipStats` with the same research factors);
  `stackMotionFields` (stack speed, reach, `fireRate`, `hullFireRate`,
  `turnRateBonus`, `loadout`); grouping by type + `loadoutKey` above the
  28-ship limit. Standard ships and stacks get no new fields.
- `battle.types.ts`: `BattleShip.equipment?`, `BattleStack.hullFireRate?` /
  `turnRateBonus?` / `loadout?`; `volleyShare` splits by `hullFireRate`;
  new `damagePerSecondFactor`.
- `battle-heading.ts`: `turnRate(stack)` = tier rate + bonus, floor
  `MIN_TURN_RATE` (45 °/s).
- `battle-targeting.ts`: `firepower` and `volleysToKill` include the
  damage-per-second factor.
- **Identity check:** six auto-resolved battles of standard fleets (with
  research bonuses, mixed hulls, fleets above 28 ships) produced
  byte-identical outcomes before and after the Phase 2–3 changes
  (2026-11-08, a one-off comparison, not kept as a test).
- **Tests:** `battle-equipment.spec.ts` (standard loadouts build the same
  state and outcome as ships without the field, module values and research
  order, civil hulls, per-stack motion values, loadout grouping, fire rate
  and damage per second, turn-rate floor, an upgraded side winning an
  otherwise equal fight on either side). `hull-balance.spec.ts` is
  unchanged and passes.

### Phase 4: map speed

- `StarMapMovementService.galaxyCellsPerSecond(fleet)` uses
  `effectiveFleetSpeed` whenever it is given the fleet's ships (every fleet
  caller passes the fleet itself); callers that pass only `{ speed }` keep
  the plain stored speed. Galaxy movement, the remaining-travel ETA,
  drifting-asteroid intercepts and every AI estimate go through it.
- The in-system step (`fleet.system` movement, vw/s) uses
  `effectiveFleetSpeed(fleet)` too, scaled by `SYSTEM_SPEED_FACTOR` (0.5).
- `strategicSpeedBonus` skips ships without an engine module, because the
  movement step calls it per moving fleet per frame.
- Fleet panel: the Speed row shows the effective speed, plus
  "(base N)" and a tooltip when an engine changes it
  (`StarMapFleetInfoComponent.speed`, computed from its `fleet` input, so
  StarMap is unchanged).
- `Fleet.speed` is never rewritten, so saves are unchanged and fleets with
  standard engines move exactly as before.
- **Tests:** `fleet-speed-equipment.spec.ts` (old rate for standard engines
  and for `{ speed }`-only callers, base + 1 with Warp Drive in the galaxy
  and in a system, the slowest engine limits the fleet, a destroyed ship no
  longer does, starting-fleet bases, ETA); two Speed-row tests in
  `star-map-fleet-info.component.spec.ts`.

### Phase 5: production, inventory, install rules, research

- **Research:** `Technology.unlocksEquipment` (first on eight existing
  technologies; since Phase 8b one technology per module, table in
  [Research](./research.md)), `isEquipmentUnlocked`,
  an "Unlocks ship equipment" effect line, and `validateTechnologies`
  rejects unknown or standard module ids.
- **Production** ([Ship Production → Equipment orders](./ship-production.md#equipment-orders)):
  `ProductionOrder.equipmentId`, `queueEquipmentOrder` (reason `locked` when
  not researched), `moduleCostFor`, `resolveOrderItem`; the tick adds built
  modules to the inventory and reports `producedModules`. Ship orders behave
  as before (the ship branch of the tick is unchanged apart from going
  through `resolveOrderItem`).
- **Inventory** (`equipment-inventory.ts`): `inventoryOf`, `inventoryCount`
  (unknown, standard or malformed counts read 0), `addToInventory`,
  `takeFromInventory`; the only writers of counts.
- **Location** (`SpaceportService.spaceportPlanetNear`,
  `EQUIPMENT_SPACEPORT_RANGE_CELLS` = 2): the B.6 rule, Chebyshev distance
  from the fleet's system cell to the planet's 2 × 2 footprint.
- **Install / uninstall** (`services/ship-equipment.service.ts`,
  `ShipEquipmentService`): `install`, `uninstall`, `canCustomizeFleet`,
  `canCustomizeReserve`, `describeFailure`. Free, atomic, faction-agnostic.
  Reserve ships: the faction owns an operational Spaceport. Unknown ids on
  a ship stay where they are; installing over one adds nothing to the
  inventory.
- **Save validation:** an equipment order may have `shipTypeId: ''`; its
  `equipmentId` must be a non-empty string (error), an unknown module is a
  warning (refunded by the tick).
- **Tests:** `src/app/services/ship-equipment.service.spec.ts` (unlocks,
  inventory helpers, ordering and its failures, building into the
  inventory, shared queue with ships, refunds on cancel and capture, unknown
  module orders, no split on load, order validation, the 2-cell rule with
  diagonals, unfinished and foreign Spaceports, install / swap / uninstall,
  civil hulls, every failure changing nothing, reserve ships, quarantined
  ids, conservation over 300 random operations).

### Phase 6: UI

- **Ordering modules:** the planet's NEW PRODUCTION ORDER dialog
  (`StarMapProductionPanelComponent`) has SHIPS / EQUIPMENT tabs. The
  EQUIPMENT tab lists every upgrade module (slot, effect lines from
  `describeModuleEffects`, price, build time, count in the inventory;
  locked modules disabled with "Needs <technology>"). QUEUE emits
  `QueueOrderRequest` with `equipmentId`; `StarMap.onQueueOrder` sends it to
  `queueEquipmentOrder`. The view model (`StarMapPanelVmService`) adds
  `modules`; `describeProductionError` covers `locked`. Queue rows show the
  module name.
- **Notice:** when a player module finishes, a map notice says it is in the
  equipment inventory and where to install it.
- **Entry point:** the fleet panel has a SHIP CUSTOMIZATION button (ORGANIZE
  FLEETS look) for player fleets with a living ship; enabled by
  `StarMap.canCustomizeFleet` (the 2-cell rule), otherwise disabled with the
  reason as tooltip and a "Near a Spaceport" hint.
- **Screen:** `star-map/ship-customization/` = `ShipCustomizationComponent`
  (one component) + `ship-customization-view.ts` (pure view model: roster,
  stat lines, comparison, module options). Hosted by StarMap in a `@defer`
  block like Fleet Command (own lazy chunk; StarMap imports the component's
  request types with `import type`, a mixed import would stop the split).
  Opening pauses the game, every CONFIRM is applied at once through
  `ShipEquipmentService` (`onCustomizationInstall` / `onCustomizationUninstall`),
  a failure shows `describeFailure`, and closing autosaves if anything
  changed and resumes the game if it was running. Map shortcuts are off
  while it is open; Escape peels back pick → slot → screen.
- **Layout and flow:** as in [D.5](#d5-layout-and-flow): roster (fleet, then
  the reserve when it can be refitted) with hull meters and three slot pips;
  the hull as line art (blueprint variant of its battle SVG) on a blueprint grid with three hardpoints (engine at the
  stern, weapon at the bow, defense above; upgraded ones amber, civil hulls'
  weapon / defense "Locked"); the resolved stats; the slot's modules with
  counts, "in production" counts and lock state, a REMOVE entry for an
  upgraded slot; the comparison (only changed values, better green / worse
  red, damage per second, damage type and profile, map-speed bonus and the
  fleet's map speed, with "(slowest engine)" when another ship holds the
  fleet back). On screens under 1100 px the columns stack and the body
  scrolls.
- **Tests:** `ship-customization.component.spec.ts` (view model and the
  screen flow), `star-map-production-panel.component.spec.ts` (EQUIPMENT
  tab), two button tests in `star-map-fleet-info.component.spec.ts`.
  Checked in the running game at 1600 × 900 and 900 × 800: open, swap with
  the old module returned, civil hull, pause and resume, autosave, ordering
  and the queue row.

### Phase 7: battle info and displays

- **Battle screen** ([Battle Screen → Ship info window and paused start](./battle-screen.md#ship-info-window-and-paused-start)):
  left click on any stack opens `BattleShipInfoComponent` (modules, values,
  matchup with the selected own stack); enemies are inspected, never
  selected. Battles start paused while the HOLD toggle is on
  (`BattleSettingsService.pausedStart`, default on, remembered per browser);
  a banner explains how to start; Space toggles pause. Decided 2026-11-08 as
  a toggle (open question 7 in the first version of F).
- **Fleet panel ATK / DEF** (`star-map-display.util.ts`): totals and per-type
  rows use `resolveShipStats` (installed modules, no research); a type with
  mixed equipment shows its rounded average. Standard fleets show the same
  numbers as before.
- **Fleet Command:** `ShipClassGroup.upgraded` counts ships with at least one
  upgrade; the row shows an amber "◆N" before the count (reserve included,
  the draft now copies reserve loadouts). The column header ATK / DEF uses
  the same resolved values as the fleet panel.
- **Research screen:** the "Unlocks ship equipment" line gets the weapons
  icon. Effect icons are matched to lines by position, and in Phase 5 the
  new line had shifted every later bonus icon by one; fixed here.
- **Tests:** `battle-ship-info.component.spec.ts`, new block in
  `battle-screen.component.spec.ts`, `equipment-display.spec.ts` (ATK/DEF,
  Fleet Command count, research icons). Checked in the running game: paused
  start with banner, enemy info with matchup, Space to start, Fleet Command
  and fleet panel totals agree.

### Phase 8: AI

- `EnemyEquipmentService` (`enemy-equipment.service.ts`), run by
  `StarMapAiTickService` after mining, every 5 s per AI faction. Rules,
  tuning and measurements: [AI Pipeline → Ship equipment](./ai-pipeline.md#ship-equipment-enemyequipmentservice).
  In short: it builds the module most of its combat ships would gain from
  against the hostile navy it has seen (weapon by damage type, defense by
  profile; no engines), one order at a time, only on a factory the economy
  left idle and only from surplus credits beyond its spending reserve
  (personality `equipment.minSurplusCredits`: militarist and balanced
  2500, expansionist and technologist 3000); it installs inventory modules
  on ships at a Spaceport planet and in the reserve, heaviest hulls first.
- `ShipService.calculateFleetStrength` counts installed modules, so the AI's
  forecasts and attack decisions see refitted fleets (the player's and its
  own). Standard ships count exactly as before. Military need and nearby
  threat use `{ includeEquipment: false }` (hull strength, Phase 8b).
- Ledger kinds `equipment_queued` / `equipment_installed`.
- **Difference from the design (E, Phase 8):** the design said militarists
  refit first by navy coverage; the coverage gate was dropped after
  measuring (a wealthy faction's military target grows with its credits,
  so the gate never opened). The surplus gate and the idle-factory rule keep
  hulls first instead.
- **First switch-on (before 8b):** refitting AIs decided the AI-vs-AI wars of the long
  simulations (Dyson scenario: the technologist fell from 1,319 to 76
  credits/s of income and never reached Stellar Engineering), also with the
  technologist excluded and with doubled module prices. Cause: with fixed
  values a module on a light or medium hull is worth about a hull per
  credit, with no upkeep and outside the ship cap, which breaks C.1's
  value-per-price limit; late-game AIs have the surplus to refit
  everything. Details: [AI Pipeline → Ship equipment](./ai-pipeline.md#ship-equipment-enemyequipmentservice).
  The AI was kept off until Phase 8b.
- **Tests:** `enemy-equipment.spec.ts` (threat weighting, counter choice,
  install rules, ordering gates, strength).

### Phase 8b: module balance pass

- **AI on for every personality** (`EnemyEquipmentService.ENABLED_BY_DEFAULT
  = true`, decided 2026-11-08: equipment should help the non-militarist
  AIs too).
- **One technology per module** (decided 2026-11-08, replacing "existing
  technologies"): Ion Drives, Laser Optics, Guided Missiles, Energy
  Shielding, Mass Drivers, Fusion Drives, Kinetic Armor, Point Defense,
  Warp Field Theory, Shield Harmonics (1000–2600 points, each behind the
  technology that unlocked the module before; table in
  [Research](./research.md#technology-inventory)). A faction can buy the
  one module it wants without a military research path. The AI values
  them by the combat ships that would carry the module
  ([AI Pipeline](./ai-pipeline.md#ship-equipment-enemyequipmentservice)).
- **Laser Cannon** toned down to attack +6 and fire rate ×1.1 (was +8,
  ×1.2): the only module clearly better per price than hulls.
  `module-balance.spec.ts` (battle-screen) pins this: in an equal-resource
  mirror auto-resolve, a pure stat module may not beat the same credits
  spent on hulls by more than 5% (budgets 14,400 and 43,200), and an
  equally large refitted fleet must not lose. Other prices are unchanged.
- **AI economy fixes** found in the long simulations (details in
  [AI Pipeline](./ai-pipeline.md#ship-equipment-enemyequipmentservice)):
  hull-only military need and threat, a 120 s deficit runway in the
  spending reserve and in research, the colony brake counting the new
  colony's starter-building upkeep, the militarist's surplus 1500 → 2500.
- **Late surplus:** the late-economy test's net-share limit rose to 0.30
  ([Late Economy](./late-economy.md#acceptance-test)); modules carry no
  upkeep and do not absorb the late credit hoard (open point, see F).
- `npm run test:long` passes with every AI refitting.

Every ship gets three equipment slots: **Engine**, **Weapon**, **Defense**.
Ships leave the factory with standard equipment. Upgrade modules are built in
Spaceship Factories into an empire-wide inventory and installed, free of
charge, from a dedicated Ship Customization screen while the fleet is near an
own Spaceport planet. A module adds the **same fixed amount** to a stat on
every hull. This is the Imperium Galactica idea, fitted onto the existing
ship, production, battle, economy and save systems. It does not add a
parallel system.

Related: [Battle Rules](./battle-rules.md), [Ship Production](./ship-production.md),
[Fleet Organization](./fleet-organization.md), [Economy](./economy.md),
[Research](./research.md), [Data Models](./data-models.md),
[Versioning](./versioning.md), [AI Pipeline](./ai-pipeline.md),
[UI Styling](./ui-styling.md), [Battle Screen](./battle-screen.md).

## Decisions (2026-11-08)

| Question | Decision | Where it is applied |
|---|---|---|
| Do engines change map (strategic) speed? | **Yes.** Engines affect galaxy and system movement as well as battle movement | [B.4](#b4-ship-stat-calculation), [C.2](#c2-recommended-initial-catalog), Phase 4 |
| How are modules acquired? | **Built in Spaceship Factories**, through the existing production queue | [B.5](#b5-production-and-inventory-rules), Phase 5 |
| Pricing | **Every module has its own price; the stronger the module, the higher the price. Installing is free** | [C.5](#c5-cost-model) |
| Where can equipment be installed? | **Within 2 system-grid cells of an own planet that has an operational Spaceport** | [B.6](#b6-location-rule), [D.2](#d2-entry-point) |
| How does a module change a stat? | **By a fixed amount, the same on every ship type** (not a multiplier of the hull's value) | [B.1](#b1-principles), [B.4](#b4-ship-stat-calculation), [C](#c-gameplay-design) |
| May the AI see installed equipment? | **Yes**: equipment is visible hardware. AI battle forecasts include it | [B.4](#b4-ship-stat-calculation), Phase 8 |
| How does the player see enemy equipment? | **The battle screen opens paused**, and a **left click on any ship** (own or enemy) opens an info window with its equipment and stats | [D.6](#d6-battle-screen-paused-start-and-ship-info-window), Phase 7 |
| Third, missile-resisting defense module? | **Yes: Point-Defense Array**, so every defense profile can be chosen (decided by design) | [C.2](#c2-recommended-initial-catalog) |
| Does the weapon module set the fire rate? | **Yes, and fire rate changes damage per second.** The weapon gives a fire-rate factor on the hull's own rate; this is the one modifier that is a multiplier, not a fixed value | [B.4](#b4-ship-stat-calculation), [C.1](#c1-design-limits-from-the-existing-balance), [C.2](#c2-recommended-initial-catalog) |
| Reserve ships | **Can be customized too**: the screen lists the reserve next to the fleet | [B.5](#b5-production-and-inventory-rules), [D.5](#d5-layout-and-flow) |
| Civil hulls (colonizer, outpost ship, swarm constructor) | **Engine slot only**; weapon and defense slots are locked | [C.4](#c4-factory-equipment-per-ship-class) |
| Research gating | **One technology per module** (Phase 8b; first decided as existing technologies) | [C.2](#c2-recommended-initial-catalog) |
| Missile interception mechanic | **No**; the Point-Defense Array's missile resistance covers it | [C.2](#c2-recommended-initial-catalog) |
| Destroyed ships, resale | **Modules are lost with the ship; no resale** | [B.5](#b5-production-and-inventory-rules) |
| Module upkeep | **None for now**; revisit after the Phase 8 long simulations | [C.5](#c5-cost-model) |
| Paused battle start | **A toggle in the battle header, on by default**, remembered in `localStorage` like AUTO | [D.6](#d6-battle-screen-paused-start-and-ship-info-window) |

---

## A. Existing architecture

### A.1 Relevant files

| Area | File | What it does today (verified in code) |
|---|---|---|
| Ship type data | `src/app/components/star-map/ship-data.json` | 13 ship types. Per type: `hitPoints`, `shield`, `shieldRegen`, `attack`, `attackType`, `weakness`, `defense`, `speed`, `range`, `battleMoveRange`, `cost`, `rawMaterialCost`, `maintenanceCost`, `fireRate`, `hullClass`, optional `buildTime`, `shieldAura` (carrier) |
| Ship type access | `src/app/services/ship.service.ts` | `ShipService`: `getShipType`, `getAllShipTypes`, `calculateFleetStrength` (attack + defense + hp/10 + shield/10 per living ship, used by ~10 AI services). Declares the full `ShipType` interface |
| Ship type (older copy) | `star-map.models.ts` `ShipType` | A second, narrower `ShipType` interface (no `hullClass`, `fireRate`, `shieldAura`). Two definitions of one concept |
| Ship instance | `star-map.models.ts` `FleetShip` | `{ id, name, type, currentHp?, destroyed? }`. No per-ship stats: every stat comes from the type |
| Battle transport ship | `battle-screen/battle/battle.types.ts` `FleetShip` | A third declaration of the same shape, used by `Battle.fleet1/2.ships` |
| Reserve ship | `star-map.models.ts` `ShipStockEntry`, `FactionShipStock` | Per-instance stock entries `{ id, type, name, producedAtTick?, originPlanetId?, currentHp? }`, one list per faction in `StarMapData.shipStock` |
| Fleet | `star-map.models.ts` `Fleet` | `ships: FleetShip[]`, a stored **`speed`** that drives galaxy and system movement, and `system: SystemLocation \| null` (in-system position in vw) |
| Production | `services/production.service.ts` | Per-planet FIFO queue of single-ship `ProductionOrder`s; only the head order progresses. Price charged at queue time and recorded in `paid`. On completion mints `ShipStockEntry` records. The tick **refunds and drops any order whose `shipTypeId` is unknown**. Stall timeout, ownership-change refunds |
| Stock | `services/ship-stock.service.ts` | Stock helpers; `disbandFleet` turns fleet ships back into stock entries; `repairDuplicateShipIds` |
| Fleet creation / reinforce | `services/fleet-assembly.service.ts` | `createFleet` (new fleets get `DEFAULT_FLEET_SPEED = 4`), `reinforceFleet` (AI only, Spaceport-gated), `stockEntryToFleetShip` |
| Fleet organization | `services/fleet-organization.service.ts` | Atomic merge / split / reserve plans (`applyPlan`), `canUseReserve`, `toFleetShip` |
| Spaceport | `services/spaceport.service.ts` | `isSpaceportPlanet` (via `operationalBuildings`, so unfinished Spaceports don't count), `listSpaceports`, `spaceportAt(factionId, {x,y})`: Spaceport in the same **galaxy cell** (star system) |
| System grid | `star-map/system-grid.ts`, `StarMapMovementService` | 36 × 14 cells of 2.5vw. A planet occupies a 2 × 2 footprint (`SYSTEM_PLANET_FOOTPRINT`) whose top-left cell is `getPlanetGridPosition`; `calculateSystemGridCell(vwX, vwY)` turns a fleet's in-system vw position into a cell |
| Fleet panel | `star-map-fleet-info/` | Inputs-only presentational component. Shows status, speed, actions (COLONIZE, DEPLOY…, DISBAND), the ORGANIZE FLEETS button, ATK/DEF totals and the per-type roster |
| StarMap wiring | `star-map.ts`, `star-map.html` | `openFleetManager` / `closeFleetManager` / `onFleetManagerApply`: opens a `@defer` overlay, pauses `GameTimeService`, applies atomically, re-runs sensors, autosaves. `enterBattleScreen`: autosaves, suspends AI, navigates to `/battle` |
| Panel view model | `star-map-panel-vm.service.ts` | Builds the fleet roster summary (ATK/DEF per type) from `getShipType` |
| Battle stats | `battle-screen/battle/battle-ship-stats.ts` | `getBattleShipStats(typeId, …)`: type → `BattleShipStats` (incl. tier lookup, `speed × BATTLE_SPEED_MULTIPLIER`, virtual turrets, station cores) |
| Battle state | `battle-screen/battle/battle-state.ts` | `createBattleState`: `toBattleShip` copies per-ship attack / defense / shield / regen / attackType / weakness into `BattleShip`; `withCombatBonus` applies research multipliers; `buildStacks` groups ships **by `typeId`** and copies stack-level `speed`, `attackRange`, `fireRate`, `tier`, `hullClass`, `shieldAura` from the type |
| Damage formula | `battle-screen/battle/battle-grid.ts` | `referenceVolleyDamage` (the one formula for animated combat, auto-resolve and targeting), `WEAPON_EFFECTIVENESS` table, `weaponMultiplier`, shield regen |
| Volley application | `battle-screen/battle/battle-combat.service.ts` | `applyVolleyDamage`: Σ attack of living ships; attackType of the attacker's front ship; defense / weakness of the target's front ship |
| Maneuvering | `battle-screen/battle/battle-heading.ts` | Turn rate (240 … 75 °/s) and thrust floor **by stack tier** |
| Battle screen | `battle-screen/battle-screen.component.ts`, `battle/battle-time.service.ts` | `ngOnInit` builds the state and calls `battleTime.reset()`, which leaves the battle **running** (not paused). Orders already work while paused. `onStackClick` (left click) **selects own stacks only; a click on an enemy does nothing**. The bottom command bar shows the selected own stack |
| Hull classes | `star-map/hull-class.ts` | Light / medium / heavy cycle (±35%), siege ×1.5, `armorFactor = 100 / (100 + defense)`, `describeHullRole` texts |
| Auto-resolve | `battle-screen/battle/battle-auto-resolve.ts` | Same `createBattleState` + `applyVolleyDamage`, no grid. Used for AI-vs-AI battles and AI forecasts |
| Battle write-back | `services/battle-outcome.service.ts` | `shipsFromOutcome` **rebuilds** `FleetShip` records from outcome rosters (`id, name, type, currentHp, destroyed`) |
| Planet garrison | `services/planet-battle.service.ts` | Garrison ships are copied with `...ship`, so extra fields survive |
| Research | `research-tree.json`, `services/research.service.ts` | `unlocksShips`, `unlocksBuildings`, `bonuses` (`shipAttack`, `shipShield` per hull, `shipBuildSpeed`) → `buildCombatBonuses` stamped on the `Battle` |
| Economy | `services/economy.service.ts`, `services/resource-cost.ts` | Three spendable resources (`credits`, `rawmaterials`, `research`); `payCost` / `refundCost` / `canAffordCost` are the all-or-nothing purchase helpers for player and AI. Ship upkeep per type (`maintenanceCost`), reserve at half rate |
| Saves | `services/save-game.service.ts`, `services/save-validation.ts` | localStorage slots; `SAVE_VERSION = MIN_SUPPORTED = 12`; `validateSaveData` checks ships (id, type, `currentHp`) and production orders (**`shipTypeId` must be a non-empty string**, unknown = warning); `normalizeSave` runs idempotent repairs; additive optional fields need no version bump |
| AI production | `enemy-economy.service.ts` | Hull choice by class shortfall and counter mix, strength via `calculateFleetStrength` |
| AI forecast | `enemy-invasion.service.ts`, `enemy-fleet.service.ts` | `autoResolveBattle` on live fleet records, **without** research bonuses |
| Other fleet sources | `galaxy-generator.service.ts`, `pirate-incursion.ts`, `anomaly.service.ts` | Create `FleetShip` records directly (starting fleets get `speed` 6–8, pirates 4) |
| Production UI | `star-map-production-panel/`, `star-map-planet-screen/` | The planet's production section and the "New production order" dialog (ship cards with `HullRoleComponent`) |
| Visual assets | `public/ships/<typeId>.svg`, `battle-grid/ship-icons.ts` | One SVG per hull with `id="ship"`, bow right, faction color via `currentColor`. `SHIP_ICONS` / `shipIconFor` |
| UI kit | `src/styles.scss`, `src/styles/_ui.scss`, `public/ui/console-frame.svg`, `hull-role/` | `--ui-*` tokens, `ui.glass` + `ui.brackets` console frame, buttons, tabs; `HullRoleComponent` |

### A.2 Current data flow

```
ship-data.json ──▶ ShipService.getShipType(typeId)
                         │
 Factory order ──▶ ProductionService.tick ──▶ ShipStockEntry (stock, per faction)
                                                   │  createFleet / applyPlan / reinforceFleet
                                                   ▼
                                     Fleet.ships: FleetShip {id, name, type, currentHp}
                                                   │  battle detection / planet arrival / AI invasion
                                                   ▼
            Battle {fleet1, fleet2, combatBonuses} ──▶ createBattleState
                     toBattleShip: stats = getBattleShipStats(ship.type)   (per type!)
                     withCombatBonus: × research attack / shield
                     buildStacks: group by typeId, stack stats from type
                                                   │
                  animated battle (BattleCombatService) or autoResolveBattle
                                                   ▼
            BattleOutcome rosters ──▶ BattleOutcomeService: fleet.ships = shipsFromOutcome(...)
```

All ship stats are **per type**. Per-ship state is only hull damage and the
destroyed flag. Battle ships already carry per-ship attack, defense, shield,
regen, attackType and weakness, but today these always equal the type values.

### A.3 Facts that shape the design

1. **The damage-type counter already exists.** `WEAPON_EFFECTIVENESS` maps
   attacker `attackType` × target `weakness` to 1.2 / 1.0 / 0.8. The field
   name `weakness` is misleading: a target **resists** its own `weakness`
   type (0.8×) and is weak to the type before it in the cycle:

   | Target profile (`weakness`) | Takes 0.8× from | 1.0× from | 1.2× from |
   |---|---|---|---|
   | `energy` | energy | missile | kinetic |
   | `kinetic` | kinetic | energy | missile |
   | `missile` | missile | kinetic | energy |

   So the **Weapon module sets `attackType`** and the **Defense module sets
   the defense profile (`weakness`)**. No new counter system is needed.
   Battle Rules deliberately keeps this table milder than the hull-class
   cycle: at 1.5× / 0.5× the weapon type decided most fights and hid the
   hull roles. Equipment must respect the same limit.
2. **Battle stacks are homogeneous by type.** `buildStacks` groups by
   `typeId` (for fleets of more than 28 ships). Stack-level `speed`,
   `attackRange`, `fireRate`, `tier` and the front ship's `attackType` are
   assumed to hold for every ship in the stack. Differently equipped ships
   of one type must go into different stacks.
3. **Strategic speed is not a ship stat.** Galaxy and system movement use
   the stored `Fleet.speed`, read in exactly two places
   (`StarMapMovementService.galaxyCellsPerSecond` and the in-system step in
   `StarMapMovementService`), plus the fleet panel display. It is 4 for
   assembled, split and pirate fleets and 6–8 for generated starting
   fleets, and nothing derives it from `ShipType.speed`. Engines that change
   map speed therefore need one effective-speed helper (see [B.4](#b4-ship-stat-calculation)).
4. **Ship records are rebuilt field by field in six places.** A new field on
   `FleetShip` would be silently dropped at:
   `FleetAssemblyService.stockEntryToFleetShip`,
   `FleetOrganizationService.toFleetShip` and its fleet → reserve branch in
   `applyPlan`, `ShipStockService.disbandFleet`, and
   `shipsFromOutcome` in `battle-outcome.service.ts`. The last one runs
   **after every battle**, so a naive implementation would strip all
   equipment from every ship that fights.
5. **Fleets reach the battle by reference.** Battle detection, planet
   arrival, anomalies and AI invasions put live `Fleet` objects into
   `Battle.fleet1/2`, and the battle state factory deep-clones them. A field
   on `FleetShip` is therefore visible to `createBattleState` and to AI
   forecasts without changes to the transport.
6. **Research combat bonuses are multipliers per hull** (`withCombatBonus`,
   attack and shield). To keep module values truly fixed, modules are
   added **after** the research multiplier (see [B.4](#b4-ship-stat-calculation)).
7. **The production queue is ship-only.** `ProductionOrder.shipTypeId` is
   required by save validation, and the tick refunds any order whose ship
   type it doesn't know. An equipment order stored as a fake ship id would
   be refunded on the first tick, so equipment orders need their own field
   and both the tick and validation must learn about it.
8. **The existing Spaceport rule is system-wide.** The reserve and repair
   use "the fleet stands in a star system that holds an own operational
   Spaceport" (`spaceportAt` / `canUseReserve`). The equipment rule is
   stricter (2 cells from the planet), so it needs its own helper. The
   reserve rule stays as it is.
9. **The battle screen starts running and ignores enemy clicks.**
   `battleTime.reset()` in `ngOnInit` leaves the battle unpaused, and
   `onStackClick` returns without effect for enemy stacks. Orders while
   paused are already supported, so a paused start needs no new order
   logic.

### A.4 Reusable systems

- `ProductionService` (queue, single-unit orders, `paid` and refunds, stall timeout, ownership cancellation, `shipBuildSpeed` bonus) for building modules.
- `resource-cost.ts` (`payCost`, `canAffordCost`, `missingResources`) for prices.
- `ResearchService` unlock pattern (`unlocksShips` → add `unlocksEquipment`), `describeEffects`, research card categories (`weapons`, `shields` icons exist).
- `SpaceportService.isSpaceportPlanet`, `StarMapMovementService.calculateSystemGridCell` / `getPlanetGridPosition` for the location gate.
- The Fleet Command pattern: `@defer` overlay, game paused while open, atomic service call, sensor refresh, autosave (`openFleetManager` / `onFleetManagerApply`).
- `BattleTimeService.pause()` and the existing pause button / Space handling on the battle screen.
- `ShipStockService.repairDuplicateShipIds` and the validation style in `save-validation.ts` (errors for broken shapes, warnings plus quarantine for unknown ids).
- `public/ships/*.svg` + `ship-icons.ts` for the large ship illustration (vector, faction color through `currentColor`).
- `HullRoleComponent` and `describeHullRole` for the hull-class line on the selected ship.
- Design system mixins (`ui.glass`, `ui.brackets` modal weight, sunken / raised surfaces, buttons, tabs) used by Fleet Command, Research and Production.
- `hull-balance.spec.ts` style (equal-budget auto-resolve matrix) for module balance checks.
- `ai-simulation.harness.ts` and the `*.long.spec.ts` suite for AI phases.

---

## B. Proposed architecture

### B.1 Principles

- **Factory equipment adds nothing.** A ship with only standard equipment
  resolves to exactly the stats it has today, in battle and on the map.
  Existing fleets, saves, the AI, `hull-balance.spec.ts` and every battle
  and movement test are unaffected until a player installs an upgrade. This
  is the main guard against balance drift and is pinned by a test.
- **Definitions are separate from instances.** Module definitions live in one
  data file. A ship stores only module **ids** per slot. The inventory stores
  **counts** per module id.
- **Fixed values (decided 2026-11-08).** A module adds the same amount to a
  stat on every ship type: a Railgun gives a fighter and a dreadnought the
  same +16 attack. A module is worth the same on any hull, so one price per
  module is fair. Type overrides (weapon damage type, defense profile) are
  not values and simply replace the hull's type. **One exception (decided
  2026-11-08): the weapon's fire-rate factor** multiplies the hull's own
  fire rate and changes damage per second (see [B.4](#b4-ship-stat-calculation)).
- **One stat resolver.** One pure function turns (ship type, loadout,
  research bonus) into stats. Battle, map movement, displays and the AI all
  use it.

### B.2 Data model

```ts
// equipment.ts (new, pure)
export type EquipmentSlot = 'engine' | 'weapon' | 'defense';

/* Stats a module may change. Closed set so the resolver stays exhaustive. */
export type EquipmentStat =
  | 'attack' | 'range'                            // weapon
  | 'battleSpeed' | 'turnRate' | 'strategicSpeed' // engine
  | 'shield' | 'shieldRegen' | 'defense';         // defense

/* Fixed amount added to one stat, the same on every hull (may be negative for trade-offs). */
export interface EquipmentModifier {
  stat: EquipmentStat;
  add: number;
}

/* Weapon modules only: factor on the hull's fireRate (standard weapon = 1). Changes DPS. */
// EquipmentDefinition.fireRateFactor?: number

export interface EquipmentDefinition {
  id: string;                    // 'railgun', 'energy_shield', ...
  name: string;
  slot: EquipmentSlot;
  description: string;
  /* Standard (factory) modules: add nothing, never in inventory, cannot be built. */
  standard?: boolean;
  modifiers: EquipmentModifier[];
  attackType?: WeaponType;       // weapon: replaces the hull's attackType
  fireRateFactor?: number;       // weapon: × the hull's fireRate; more shots = more damage per second
  resistType?: WeaponType;       // defense: replaces the hull's defense profile (`weakness`)
  /* Price of one module, charged when the factory order is queued. Stronger modules cost more. */
  price?: { credits: number; rawmaterials: number };
  /* Seconds at one Spaceship Factory (productionPower 1); default price.credits / 10, like ships. */
  buildTime?: number;
}

/* Per-ship loadout. Missing slot = the hull's standard module. */
export type ShipLoadout = Partial<Record<EquipmentSlot, string>>;
```

Units of each stat (so the catalog values mean the same everywhere):

| Stat | Unit (same as) | Hull range today |
|---|---|---|
| `attack` | `ShipType.attack` | 8 – 175 |
| `range` | range units (`ShipType.range`) | 1 – 5 |
| `battleSpeed` | `ShipType.speed` (before `BATTLE_SPEED_MULTIPLIER`) | 1 – 5 |
| `turnRate` | degrees per battle second (`battle-heading.ts`) | 75 – 240 |
| `strategicSpeed` | `Fleet.speed` | 4 (assembled), 6 – 8 (starting fleets) |
| `shield` | `ShipType.shield` | 20 – 480 (0 for the swarm constructor) |
| `shieldRegen` | `ShipType.shieldRegen` per regen tick | 0 – 6 |
| `defense` | `ShipType.defense` (armour, percentage rule) | 1 – 35 |

Fire rate is not in the fixed-value list: a fixed +0.3 shots/s would be +8%
on a fighter (4/s) and +60% on a dreadnought (0.5/s). The weapon's
`fireRateFactor` scales the hull's own rate instead ([B.4](#b4-ship-stat-calculation)).

Changes to existing models (all **optional and additive**):

| Model | Field | Default when missing |
|---|---|---|
| `FleetShip` (`star-map.models.ts` and `battle.types.ts`) | `equipment?: ShipLoadout` | standard equipment in every slot |
| `ShipStockEntry` | `equipment?: ShipLoadout` | standard equipment |
| `StarMapData` | `equipmentInventory?: FactionEquipmentInventory[]` | empty inventory for every faction |
| `ProductionOrder` | `equipmentId?: string` (set = this order builds one module) | missing = ship order (today's behavior) |
| `Technology` | `unlocksEquipment?: string[]` | unlocks nothing |
| `BattleStack` (battle-local, not saved) | `loadout?: ShipLoadout`, `turnRateBonus?: number` | standard / 0 |

```ts
export interface FactionEquipmentInventory {
  factionId: string;
  modules: Record<string, number>;  // module id → available count (integer ≥ 0)
}
```

Why counts and not per-module instance records: modules have no state (no
wear, no damage, no ids anywhere else). Counts can't be duplicated by
reference bugs, are trivially validated and are small in localStorage.
Ships are per-instance because they carry hull damage. Modules don't need
that.

Standard modules: one per slot (`standard_engine`, `standard_weapon`,
`standard_defense`), adding nothing. The standard weapon keeps the hull's
own `attackType` and the standard defense keeps its own `weakness`. So
"different factory equipment per class" is already given by the hull data.

### B.3 Files and services

| File | Kind | Responsibility |
|---|---|---|
| `star-map/equipment-data.json` (new) | data | The module catalog (the source of truth for module stats, prices and build times) |
| `star-map/equipment.ts` (new) | pure | Types, catalog access, `loadoutOf(ship)`, `loadoutKey(loadout)` (stable string for stack grouping), `isUnlocked`, `describeModule` / comparison texts (one source of UI text, like `hull-class.ts`) |
| `star-map/ship-stats.ts` (new) | pure | `resolveShipStats(shipType, loadout, research?)` → `ResolvedShipStats`, and `effectiveFleetSpeed(fleet)`. **The** centralized stat calculation |
| `services/ship-equipment.service.ts` (new) | service | Inventory (`getInventory`, `addToInventory`, `install`, `uninstall`), each atomic and checked: ownership, location rule, slot match, inventory count. No prices: installing is free. Faction-agnostic, so the AI uses it in a later phase |
| `services/production.service.ts` (extended) | service | Queues and builds equipment orders next to ship orders (see [B.5](#b5-production-and-inventory-rules)) |
| `services/spaceport.service.ts` (extended) | service | `spaceportPlanetNear(factionId, fleet, starSystems, maxCells = 2)` for the location rule ([B.6](#b6-location-rule)) |
| `star-map/ship-customization/` (new) | component(s) | The full-screen Ship Customization screen (see [D](#d-ui-design)) |
| `battle-screen/battle-ship-info/` (new) | component | The battle screen's ship info window ([D.6](#d6-battle-screen-paused-start-and-ship-info-window)) |

Not introduced: no new ship type, fleet type, battle path, economy
resource or tick. Equipment has no per-second behavior, so the economy tick
isn't touched (upkeep: see [F](#f-open-questions)).

### B.4 Ship-stat calculation

```
ShipType (hull base) ──▶ × research multiplier (attack, shield; per hull, as today)
                     ──▶ + Σ module.add (one module per slot, same value on every hull)
                     ──▶ floors (see below)
                     attackType = weapon.attackType ?? type.attackType
                     weakness   = defense.resistType ?? type.weakness

                     fireRate   = hull fireRate × weapon.fireRateFactor (standard = 1)

effectiveFleetSpeed(fleet) = fleet.speed + min(strategicSpeed bonus of living ships)
```

**Fire rate and damage per second (decided 2026-11-08).** Today a volley
deals `volleyShare = REFERENCE_FIRE_RATE / fireRate` of a reference volley,
so fire rate never changes damage per second. With equipment the share is
computed from the **hull's** fire rate, while the cadence uses the resolved
one:

- `BattleStack.fireRate` = resolved rate (cadence in fire control and
  auto-resolve);
- new `BattleStack.hullFireRate` (missing = `fireRate`) feeds `volleyShare`;
- so damage per shot stays as today and a factor of 1.2 gives 20% more
  shots, which is 20% more damage per second, on the hull's attack **and**
  the module's added attack.

The standard weapon has factor 1, so factory ships keep exactly today's
cadence and damage per second. The targeting estimate (`firepower` mode,
`weakest` mode's time-to-kill), `shotScale` and the AI strength
calculation (Phase 8) must use the same `fireRate / hullFireRate` ratio so
they agree with combat. This is the one modifier that grows with the hull's
attack: a Laser Cannon's +10% shots are worth more on a dreadnought than on a
fighter, accepted with the decision.

**Order: research first, modules second.** Research multiplies only the
hull's own attack and shield, so a +16 Railgun stays exactly +16 with any
research. In code this is `toBattleShip` (hull) → `withCombatBonus`
(research, unchanged) → a new `withEquipment` step. Forecasts and displays
call `resolveShipStats`, which applies the same order.

**Floors.** Negative trade-offs can't push a stat below a working value:
battle speed ≥ 0.5, turn rate ≥ 45 °/s, attack ≥ 1, range ≥ 1, shield,
regen and armour ≥ 0. With the initial catalog no hull reaches a floor
except the slowest one (dreadnought speed 1 with Railgun and Kinetic
Barrier: 1 − 0.3 − 0.2 = 0.5).

**Battle** (Phase 3):

- `getBattleShipStats` keeps resolving the hull. The new `withEquipment`
  step adds the modules per ship after `withCombatBonus`.
- `buildStacks` groups by `typeId + '|' + loadoutKey`, stores the stack's
  `loadout`, and takes stack-level `speed` (hull speed + battle-speed bonus,
  then × `BATTLE_SPEED_MULTIPLIER`) and `attackRange` from the resolved
  stats, and `fireRate` / `hullFireRate` as described above. Stack ids stay
  `${side}:${typeId}:${index}`. Nothing parses them (verified).
- Maneuvering: `battle-heading.ts` reads turn rate by `stack.tier`; it adds
  `stack.turnRateBonus` (°/s) and applies the floor. Tier itself (stack
  size, render size, thrust floor) stays the hull's.
- `referenceVolleyDamage` is **not changed**. It already reads per-ship
  `attack`, `defense`, `attackType` and `weakness`. `volleyShare` switches to
  `hullFireRate`; `applyVolleyDamage` and the targeting estimate change only
  through that.
- Auto-resolve and AI forecasts inherit everything through
  `createBattleState`. Forecasts see the defender's real equipment
  (decided 2026-11-08: equipment is visible hardware). They still ignore
  research, as today.

**Map movement** (Phase 4):

- `Fleet.speed` stays the stored **base** speed. It is not rewritten when
  equipment changes, so saves and the 4 vs 6–8 base speeds are untouched.
- `effectiveFleetSpeed(fleet)` = `fleet.speed` + the **lowest**
  `strategicSpeed` bonus among the fleet's living ships (standard engine =
  0). A fleet moves at the pace of its slowest-engined ship, so only a fleet
  fitted throughout with faster engines gets faster. A fleet with only
  standard engines moves exactly as today.
- Both movement reads (`galaxyCellsPerSecond`, the in-system step) and the
  fleet panel's Speed figure and ETA use the helper. AI route planning goes
  through `galaxyCellsPerSecond`, so the AI sees the same speeds.
- Merging, splitting, reinforcing and losing ships in battle change a
  fleet's speed with no extra bookkeeping.

Other consumers:

- the fleet panel ATK/DEF summary (`star-map-panel-vm.service.ts`) switches
  to resolved stats in Phase 7;
- `calculateFleetStrength` (AI) takes loadouts into account in Phase 8;
- sensor range (`StarMapSensorService` uses `ShipType.range`) **stays on the
  hull value by design**. A Missile Launcher's longer reach is a weapon
  property, not a sensor upgrade.

### B.5 Production and inventory rules

**Building modules** reuses the ship production pipeline:

- An equipment order is a `ProductionOrder` with `equipmentId` set. It goes
  into the same per-planet FIFO queue as ship orders, needs a Spaceship
  Factory on that planet (`productionBuilding` = `spaceship_factory`) and
  uses the planet's `productionPower` and the `shipBuildSpeed` research
  bonus. A Spaceport is not needed to build, only to install.
- Queueing charges the module's `price` with `payCost` and records it in
  `paid`. Cancelling, a stalled factory and a planet changing owner refund
  the unbuilt share, exactly as for ships.
- One module per order, like ships ("one ship per order").
- On completion the tick adds one module to the ordering faction's
  inventory instead of minting a stock ship.
- `shipTypeId` on an equipment order: the tick, `getOrderEta`,
  `rebaseFromSave` and validation must branch on `equipmentId` **before**
  the ship-type lookup, or the order is refunded as an unknown ship
  ([A.3](#a3-facts-that-shape-the-design) point 7). Proposed: equipment
  orders store `shipTypeId: ''` and validation accepts an empty
  `shipTypeId` only when `equipmentId` is set. An order with an unknown
  `equipmentId` is refunded, like an unknown ship type.
- A module can be ordered only once it is unlocked by research (checked at
  queue time, like ship unlocks).

**Inventory.** Conservation invariant, per faction and module id:
**inventory count + modules installed on living ships (fleets and stock)
changes only through a completed factory order (+1) and destruction of a
ship carrying it (−1).**

| Action | Effect | Preconditions |
|---|---|---|
| Factory order completes | inventory +1 | none (checked at queue time) |
| Install module M into slot S of ship X | inventory[M] −1; previous non-standard module of S → inventory +1; X.equipment[S] = M. **Free** | ship is the faction's and alive; a civil hull only in the engine slot; M.slot = S; inventory[M] ≥ 1; location: a fleet ship's fleet meets the [location rule](#b6-location-rule), a reserve ship needs the screen opened from such a fleet (service check: the faction owns an operational Spaceport, the reserve's docking rule). All checked before anything changes |
| Uninstall slot S of ship X | X's module → inventory +1; slot back to standard. Free | same location rule |
| Ship destroyed in battle | its modules are **lost** (decided) | none (the record stays with `destroyed: true` and keeps its loadout, but it no longer counts) |
| Sell a module | **not possible** (decided) | — |
| Ship moved to / from the reserve, merged, split, disbanded | loadout travels with the ship | none |
| Faction removed | inventory dropped (like orphaned stock) | none |

Because a swap returns the old module in the same transaction, replacing is
one operation and can't create or lose a module. Standard modules are never
counted, so "removing" an upgrade leaves no empty slot.

### B.6 Location rule

Decided 2026-11-08: a fleet can be customized when it is **within 2
system-grid cells of an own planet with an operational Spaceport**.

- The fleet has an in-system position (`fleet.system !== null`) in a star
  system that contains a planet owned by the fleet's faction for which
  `SpaceportService.isSpaceportPlanet` is true (unfinished Spaceports don't
  count).
- Distance: the fleet's cell is `calculateSystemGridCell(fleet.system.x,
  fleet.system.y)`. The planet occupies a 2 × 2 footprint starting at
  `getPlanetGridPosition(planet)`. The distance is the Chebyshev distance
  (diagonals count as one step, like the 8-direction grid) from the fleet's
  cell to the **nearest footprint cell**. A fleet on the planet is at 0. A
  fleet qualifies at 0, 1 or 2.
- The rule is checked when the screen opens and again by
  `ShipEquipmentService` on every install / uninstall. The game is paused
  while the screen is open, so the fleet can't drift out of range mid-edit.
- A fleet that is still moving but currently in range qualifies.
- This rule is for equipment only. The reserve and repair keep their
  system-wide Spaceport rule ([Fleet Organization](./fleet-organization.md#reserve)).
- Edge case: a fleet in the galaxy view whose `fleet.system` is `null`
  (it has no in-system position) does not qualify. The button explains
  why ("Move within 2 cells of a Spaceport planet").

### B.7 Save / load compatibility

- **No `SAVE_VERSION` bump.** Every addition is an optional field with a safe
  default (missing loadout = standard, missing inventory = empty, missing
  `equipmentId` = ship order). This is the rule in
  [Versioning](./versioning.md#save-format-version), the same approach as
  `ShipStockEntry.currentHp`.
- `StarMap.serializeGameState` writes `equipmentInventory`. Fleets, stock
  and production already serialize whole records, so loadouts and equipment
  orders persist once the carry-through fixes below are in.
- `validateSaveData` (new checks):
  - `equipment` must be an object whose keys are slots and whose values are
    non-empty strings → otherwise error;
  - an unknown module id, or one in the wrong slot → **warning**, and the
    slot resolves to standard at runtime. The raw id stays in the save
    (quarantine, like unknown ship types), so a later catalog that knows the
    id gets it back;
  - inventory: array of `{ factionId, modules }` with non-negative integer
    counts → otherwise error; unknown module ids → warning, ignored;
  - production orders: `equipmentId`, when present, must be a non-empty
    string, and then an empty `shipTypeId` is allowed; unknown
    `equipmentId` → warning (the tick refunds it).
- `ProductionService.rebaseFromSave` splits legacy multi-unit ship orders.
  It must leave equipment orders alone (they are always single-unit).
- `normalizeSave`: no repair needed beyond what validation covers. Optional
  idempotent cleanup: drop `equipment` keys that hold the standard id.
- **Carry-through fixes (mandatory, Phase 2):** route all six rebuild sites
  from [A.3](#a3-facts-that-shape-the-design) through one helper (for
  example `shipRecordFields(ship)` returning id, type, name and equipment).
  Change `shipsFromOutcome` to update `currentHp` / `destroyed` on the
  **existing** fleet records by `shipId` instead of building new ones.
  Unknown ids keep today's behavior. Each site gets a round-trip test.
- Older game versions loading a newer save ignore loadouts and the inventory
  (they copy records field by field and drop them). A save with a queued
  equipment order fails their validation (empty `shipTypeId`), so they
  refuse that save rather than corrupting it. Acceptable within the 0.x
  line; note it in `CHANGELOG.md` when shipped.
- The battle screen's paused start and info window are battle-local UI
  state and add nothing to saves.

---

## C. Gameplay design

### C.1 Design limits (from the existing balance)

- **Fixed values change hulls by different shares.** +16 attack is +107% on
  a fighter (15) and +9% on a dreadnought (175). Modules therefore matter
  most, in relative terms, on light and medium hulls. The limit is not a
  percentage but **value per price**: a module's added stats per credit
  must stay clearly below what the same credits buy as extra hulls (light
  hulls give about 0.15–0.2 attack and 0.4 shield per credit). Modules
  then pay off through what extra hulls don't give: no upkeep (ship upkeep
  is progressive), no extra fleet size, and the damage-type / profile
  choice. The balance spec checks this with equal budgets that include
  module prices.
- The hull-class cycle (±35%) stays the primary matchup: it multiplies the
  whole volley, module attack included. The damage-type table (±20%) stays
  secondary.
- Combat is deterministic. No dodge rolls, no crits. Evasion already comes
  from the projectile model: bolts are aimed once and miss a target that has
  moved, so faster, more agile ships dodge more at long range. Engines get
  their evasion from that, with no new stat.
- **Fire rate.** The hull's own fire rate still never changes damage per
  second. The weapon's `fireRateFactor` does (decided 2026-11-08): ×1.2 is
  20% more damage per second. It is the strongest lever in the catalog and
  grows with the hull's attack, so factors stay between 0.85 and 1.2.
- Map speed: a fleet moves at its slowest ship's engine. Faster fleets reach
  targets, borders and reinforcements earlier, which matters a lot in a
  real-time game, so strategic bonuses stay small (≤ +1 on a base of 4).

### C.2 Recommended initial catalog

Starting values to be tuned with a balance spec. Every value is **added**,
the same on every hull, in the units of [B.2](#b2-data-model). Prices are per
module (credits / raw materials), ordered by strength within each slot
([C.5](#c5-cost-model)). Build time defaults to price.credits / 10 seconds at
one factory.

**Standard (factory, all hulls):** `standard_engine`, `standard_weapon`,
`standard_defense`. Add nothing; the weapon keeps the hull's `attackType`
and the defense keeps the hull's profile. Not buildable, no price.

**Engines** (each one a different trade between map and battle movement)

| Module | Map speed | Battle speed | Turn rate | Price | Unlock (existing tech) |
|---|---|---|---|---|---|
| Ion Engine | +0.5 | +0.5 | −20 °/s (wide turns) | 150 / 100 | Ion Drives |
| Fusion Engine | 0 | +0.3 | +60 °/s (agile) | 300 / 200 | Fusion Drives |
| Warp Drive | +1 | −0.3 | 0 | 500 / 300 | Warp Field Theory |

Effect examples: Ion on a scout (speed 5) +10%, on a dreadnought (speed 1)
+50%; Fusion turn rate on a fighter (240 °/s) +25%, on a dreadnought
(75 °/s) +80%. Engines help slow heavy hulls most.

**Weapons**

| Module | Sets attackType | Effect | Fire rate | Trade-off | Price | Unlock |
|---|---|---|---|---|---|---|
| Missile Launcher | missile | attack +8, range +1 | ×0.85 (slow salvos) | fewer shots | 150 / 100 | Guided Missiles |
| Laser Cannon | energy | attack +6 | ×1.1 (rapid fire) | none beyond type | 250 / 150 | Laser Optics |
| Railgun | kinetic | attack +16 | ×1.0 | battle speed −0.3 (mass) | 300 / 250 | Mass Drivers |

How they compare (damage per second relative to today, before the damage-type
table): a fighter (attack 15) gets 1.30× with a Missile Launcher, 1.54× with a
Laser Cannon and 2.07× with a Railgun; a dreadnought (attack 175) gets 0.89×,
1.14× and 1.09× (Laser values since Phase 8b). The Railgun is the light-hull weapon, the Laser Cannon the
heavy-hull weapon, and the Missile Launcher trades damage on heavy hulls for
reach.

**Defense** (one module per profile, plus one profile-neutral premium module)

| Module | Sets profile (resists) | Effect | Trade-off | Price | Unlock |
|---|---|---|---|---|---|
| Energy Shield | energy (weak to kinetic) | shield +40 | none beyond profile | 200 / 150 | Energy Shielding |
| Point-Defense Array | missile (weak to energy) | armour +3, shield +20 | none beyond profile | 250 / 200 | Point Defense |
| Kinetic Barrier | kinetic (weak to missile) | armour +6 | battle speed −0.2 (mass) | 250 / 250 | Kinetic Armor |
| Advanced Shield Generator | keeps the hull's profile | shield +60, shield regen +3 | none | 500 / 300 | Shield Harmonics |

Notes:

- **Point-Defense Array** (decided by design on 2026-11-08) completes the
  profile set: with it every one of the three profiles can be chosen. Its
  flavor is anti-missile flak; in the rules that is the missile profile's
  0.8× resistance, not a separate interception mechanic.
- Armour is a percentage rule (`defense / (100 + defense)`), so a fixed +6
  gives a fighter (3) 2.9% → 8.3% reduction and a dreadnought (35)
  25.9% → 29.1%.
- Engines have no "Mk" ladder. Each one is a different trade (map speed vs
  battle speed vs turning), so there are no simple linear upgrades.
- The weapon pick is mainly a **damage-type** choice against the enemy's
  defense profiles, plus raw attack. The defense pick is a **profile**
  choice against the enemy's weapon types, plus durability.
- Each module has its own technology (Phase 8b; Phase 5 first used
  existing technologies), listed in its technology's `unlocksEquipment`.

### C.3 Counter relationships

No new table. The existing `WEAPON_EFFECTIVENESS` cycle, driven by modules:

```
 Railgun (kinetic) ──1.2×──▶ Energy Shield        (energy profile)
 Laser   (energy)  ──1.2×──▶ Point-Defense Array  (missile profile)
 Missile (missile) ──1.2×──▶ Kinetic Barrier      (kinetic profile)
 Every weapon deals 0.8× to the profile of its own type.
```

The resulting play: look at the enemy's weapon mix (perceived fleets, or the
battle screen's info window at the start of a battle), then pick the defense
profile that resists it. Pick the weapon that beats the enemy's profiles. A
refit needs modules built in advance and a trip to a Spaceport planet, so
specializing is a commitment, not a per-battle toggle.

### C.4 Factory equipment per ship class

All hulls start with the standard modules, which reproduce today's stats.
Their effective factory profile, from `ship-data.json`:

| Hull | Class | Factory weapon type | Factory defense profile (resists) | Weak to |
|---|---|---|---|---|
| Scout | light | kinetic | energy | kinetic |
| Fighter | light | kinetic | energy | kinetic |
| Corvette | light | energy | kinetic | missile |
| Frigate | light | energy | missile | energy |
| Destroyer | medium | kinetic | missile | energy |
| Cruiser | medium | energy | kinetic | missile |
| Carrier | medium | missile | kinetic | missile |
| Battleship | heavy | kinetic | energy | kinetic |
| Battlecruiser | heavy | missile | energy | kinetic |
| Dreadnought | heavy | kinetic | missile | energy |
| Colonizer, Outpost Ship, Swarm Constructor | light (civil) | kinetic | energy | kinetic |

Civil hulls (colonizer, outpost ship, swarm constructor) get **the engine
slot only** (decided 2026-11-08). Their weapon and defense hardpoints are
shown locked ("civil hull"). Their combat stats are token values, but an
engine matters: a civil ship with a standard engine would otherwise cap an
escorting fleet's map speed, and a Warp Drive gets a colonizer to its target
sooner.

### C.5 Cost model

Decided 2026-11-08:

- Every module has its **own fixed price** (credits + raw materials) in
  `equipment-data.json`, paid when the factory order is queued. Within a
  slot, **the stronger the module, the higher the price**.
- Module values are fixed too ([B.1](#b1-principles)), so a module is worth
  the same on every hull and one price per module is fair. No hull-scaled
  fee is needed.
- **Installing and uninstalling are free.** The only cost of a refit is
  building the module and bringing the fleet to a Spaceport planet.
- Equipment adds **no upkeep** (decided 2026-11-08: none for now), so
  `EconomyService` stays untouched. Revisit after the Phase 8 long
  simulations: upkeep-free power is the main reason to buy modules instead
  of more hulls.
- Nothing is refunded when a ship carrying modules is destroyed, and modules
  can't be sold.

---

## D. UI design

### D.1 Hosting: overlay inside StarMap, built like the Battle Screen

The Battle Screen is an independent full-screen component, but it is also
a **separate route** (`/battle`), and that costs a lot: StarMap autosaves,
suspends the AI tick and navigates; the battle patches the AUTOSAVE slot;
StarMap reloads the whole game state on return (`reloadAfterBattle`).

For customization, the recommendation is to take the Battle Screen's
**structure** (own folder, standalone root component, child components,
pure logic in plain `.ts` files) and the Fleet Command dialog's **hosting**:
a full-screen `@defer` overlay rendered by StarMap, game paused while open,
changes applied to live state through a service, autosave on close. Reasons:

- equipment changes are small, instant edits of live data, exactly like
  fleet organization;
- no save/reload round trip, no AI suspension, no risk of a lost change
  between autosave and navigation;
- the selected fleet, camera and view are kept;
- the component stays out of the initial bundle through `@defer`.

A route is still possible later if the screen grows (it would need the same
autosave-patch pattern as the battle).

### D.2 Entry point

- `StarMapFleetInfoComponent` gets two inputs, `canCustomize` and
  `customizeBlockedReason`, and a `customize` output. The button, labeled
  **SHIP CUSTOMIZATION** and styled like ORGANIZE FLEETS, shows for every
  player fleet with a living hull that can take equipment.
- Enabled only when the fleet meets the [location rule](#b6-location-rule)
  (within 2 system cells of an own Spaceport planet). When disabled, the
  tooltip and a dim hint read "Move within 2 cells of a Spaceport planet".
- StarMap: `openShipCustomization()` / `closeShipCustomization()`, mirroring
  `openFleetManager`: pause with `GameTimeService.pause()`, resume on close
  only if it was running, ignore map shortcuts while open, autosave on close
  if anything changed, refresh the fleet panel (speed and ETA can change).
  Both fleet-panel instances (galaxy and system view) in `star-map.html`
  get the binding.

### D.3 Ordering modules

Modules are built in factories, so ordering lives in the existing production
UI:

- The planet's "New production order" dialog gets an **Equipment** section
  (or tab) next to the ship cards: one card per unlocked module with slot,
  effect summary ("+16 attack · kinetic"), price and build time; locked
  modules show the technology needed. Ordering uses the same quantity
  picker (N single orders).
- The production queue lists equipment orders with the module name and an
  icon per slot.
- The customization screen shows for each module "N in inventory · M in
  production" so the player knows what is coming. It does not queue orders
  itself in the first UI phase (an ORDER shortcut that queues at the nearest
  factory planet is a later convenience).

### D.4 Component structure

```
star-map/ship-customization/
  ship-customization.component.{ts,html,scss}   the whole screen: roster, blueprint + hardpoints,
                                                inventory, comparison, confirm/cancel, Escape
  ship-customization-view.ts                    pure view model (roster, stat lines, comparison, options) — unit tested
```

As built, the screen is one component: the parts share most of their
state (selected ship, slot, pick), and the stylesheet stays well under the
20 kB budget. Split it into child components if it grows.

Inputs: the fleet, the faction's inventory, counts in production, unlocked
module ids. Outputs: `install`, `uninstall` and `close` events. StarMap calls
`ShipEquipmentService` and passes the updated state back. A rejected action
shows the service's failure text, like `describeFailure` in Fleet Command.

### D.5 Layout and flow

```
┌─ SHIP CUSTOMIZATION · 1st Fleet · Sol system ───────────────────────────── [X] ┐
│ ROSTER            │              BLUEPRINT                │ INVENTORY · WEAPON    │
│ ▸ Cruiser  ×3     │     ┌──────────[ WEAPON ]               │  Laser Cannon   2 · 1⚙│
│   Cruiser #12 ◆◆◇ │     │     ╱‾‾‾‾‾‾‾‾‾‾‾‾╲                │  Railgun        0     │
│   Cruiser #13 ◇◇◇ │ [ENGINE]═<   (ship SVG)  >             │  Missile Launch. 1    │
│ ▸ Destroyer ×4    │     │     ╲____________╱                │───────────────────────│
│   …               │     └──────────[ DEFENSE ]              │ COMPARISON            │
│                   │  hull class badge · role              │ ATK 66 → 76  (+10)    │
│                   │  stat strip: HP SH REG ARM ATK SPD RNG │ type energy → energy  │
│ fleet map speed 4 │                                       │ install: free         │
│                   │                                       │ [CANCEL]   [CONFIRM]  │
└───────────────────┴───────────────────────────────────────┴───────────────────────┘
```

1. Opens with the fleet's first customizable ship selected.
2. Roster rows: class icon (from `ship-icons.ts`), name, hull meter and three
   small slot pips (filled = upgraded). Below the roster: the fleet's
   effective map speed and which ship limits it. Under the fleet, a
   collapsible **RESERVE** group lists the global stock by class (decided
   2026-11-08); its ships are customized the same way.
3. Blueprint: the hull as cyan line art (`public/ships/blueprint/<type>.svg`,
   generated from the battle art `public/ships/<type>.svg` by
   `npm run sprites:blueprints`, `scripts/ship-blueprints/generate.mjs`:
   outlines only, small details dropped; the coloured battle art was too
   busy here) on a blueprint grid, with three framed hardpoints joined
   to the hull by leader lines: Engine at the stern, Weapon at the bow,
   Defense above the hull. Each shows the installed module's name and icon.
   The selected one gets the amber selection bar.
4. Clicking a hardpoint fills the inventory column with that slot's modules:
   name, count in inventory, count in production (⚙). A module with 0 in
   inventory is listed but can't be confirmed; locked modules show the
   technology needed.
5. Picking a module fills the comparison card: description, stat changes
   for **this** ship as absolute numbers ("ATK 66 → 76"), damage-type and
   profile change ("now resists kinetic · weak to missile"), for engines
   the fleet's new map speed, "install: free", CONFIRM / CANCEL. A REMOVE
   action returns the module and restores the standard one.
6. CONFIRM applies at once (game is paused). The roster pips, the stat strip,
   the fleet speed and the inventory counts update. Esc cancels the pending
   pick, then closes.
7. Later convenience (not in the first UI phase): "apply to all Cruisers in
   this fleet".

Style: the command-console design system (modal console frame, sunken
inventory, raised blueprint, cyan values, amber selection, Share Tech Mono).
Stay inside the look chosen on 2026-11-03 ([UI Styling](./ui-styling.md#design-system)).
Mind the 20 kB per-stylesheet budget: shared partials only where their
selectors are used.

### D.6 Battle screen: paused start and ship info window

Decided 2026-11-08. This is a change to the existing Battle Screen, useful
on its own and essential once ships carry equipment: the player needs a
moment to see what they are fighting.

**Paused start.**

- Every battle the player opens starts **paused** while the new **PAUSED
  START** toggle in the battle header is on (default on, decided
  2026-11-08). The setting lives in `BattleSettingsService` next to AUTO and
  is remembered in `localStorage` the same way (its own key). When on,
  `ngOnInit` calls `battleTime.pause()` after `battleTime.reset()`. A banner over the
  battlefield reads "BATTLE PAUSED · inspect ships, give orders, press ▶ or
  Space to start", and the header pause button shows its active state.
- Orders already work while paused ([Battle Screen](./battle-screen.md)),
  so the player can also deploy targeting modes and attack orders before
  the first shot. Weapon charge, cooldowns and the AI tick run on battle
  time and don't advance while paused, so the paused start changes no
  battle outcome.
- AUTO battle and AI-vs-AI auto-resolve are unaffected (auto-resolve never
  opens the screen).
- Tests that assume the battle runs from frame 1 must unpause first.

**Ship info window.**

- Left click on **any** stack, own or enemy, opens the info window. On an
  own stack it also selects it, as today. On an enemy stack it only opens
  the window (no selection, no order). Right click keeps its order meaning.
  Clicking empty space or Esc closes the window. It works while paused and
  while running.
- Content: faction color edge, hull name and class badge (`HullRoleComponent`
  compact), ship count and hull / shield meters of the stack, the three
  slots with the installed module names (standard ones dimmed), the
  resolved stats (attack, damage type, defense profile "resists X · weak to
  Y", armour as % reduction, shield, regen, battle speed, range), and, when
  an own stack is selected and the window shows an enemy, the matchup line
  ("your Cruiser deals 1.2× · takes 0.8×", from `weaponMultiplier` and
  `hullClassMultiplier`). Fire rate is shown as shots per second.
- Stacks are homogeneous by type **and loadout** ([B.4](#b4-ship-stat-calculation)),
  so one window always describes one loadout. The data comes from
  `BattleStack.loadout` and the battle ships' resolved stats. Nothing new
  is computed in the template.
- Planet turrets and station cores show the same window without equipment
  slots.
- Component: `battle-screen/battle-ship-info/`, a small presentational
  component placed in the command-bar area or as a floating framed card
  next to the stack, styled like the battle's existing framed panels.

---

## E. Implementation roadmap

Each phase is independently testable and leaves the game playable. Run
the affected specs while working, `npm test` before finishing each phase,
and `npm run test:long` after Phases 3, 4, 5 and 8.

| Phase | Scope | Tests / acceptance | Depends on |
|---|---|---|---|
| **1. Catalog and resolver** (done 2026-11-08) | `equipment-data.json`, `equipment.ts`, `ship-stats.ts` (`resolveShipStats` with research-then-modules order and floors, `loadoutKey`, `effectiveFleetSpeed`). No runtime consumer yet | Standard loadout reproduces every ship type's stats exactly and leaves fleet speed unchanged; each module adds exactly its declared values on every hull, with and without research bonuses; floors hold; unknown ids resolve to standard; catalog sanity (one standard per slot, slots valid, prices ≥ 0, price rises with strength within a slot) | — |
| **2. Persistence and carry-through** (done 2026-11-08) | `equipment?` on both `FleetShip` declarations and `ShipStockEntry`; `equipmentInventory` on `StarMapData`, serialize/load; validation; the six carry-through fixes (`shipsFromOutcome` updates records in place) | Loadout survives: save/load, stock ↔ fleet, merge/split, disband, fleet battle, planet battle, AI auto-resolve. Old saves load with standard loadouts. No gameplay change yet | 1 |
| **3. Battle integration** (done 2026-11-08) | `withEquipment` after `withCombatBonus`, stack grouping by loadout key, `BattleStack.loadout`, stack speed/range from resolved stats, `turnRateBonus` in `battle-heading.ts` | Factory fleets give **identical** outcomes to before (golden comparison of auto-resolve results); mixed loadouts split into separate stacks; each module's effect visible in auto-resolve; `hull-balance.spec.ts` unchanged | 1, 2 |
| **4. Map speed** (done 2026-11-08) | `effectiveFleetSpeed` in `galaxyCellsPerSecond`, the in-system step, the fleet panel Speed figure and ETA | Standard fleets move and ETA exactly as before (movement specs unchanged); a fully Warp-fitted fleet is +1 faster; one standard ship caps the fleet; losing that ship in battle speeds the fleet up | 1, 2 |
| **5. Production, inventory and research** (done 2026-11-08) | `ProductionOrder.equipmentId`, queue / tick / ETA / refund / validation / `rebaseFromSave` for equipment orders; `ShipEquipmentService` (install, uninstall, all atomic, free); `SpaceportService.spaceportPlanetNear` (2-cell rule); `unlocksEquipment` in research + "unlocked by exactly one technology" test; `describeEffects` lists module unlocks | Equipment orders build into the inventory, refund on cancel / stall / planet loss, are never refunded as unknown ships, survive save/load; conservation invariant under random operation sequences; every failure changes nothing; location rule at distance 0, 2 and 3 (and diagonals); AI-faction calls work the same | 2 |
| **6. Customization UI** (done 2026-11-08) | Equipment section in the production dialog and queue; fleet-panel button; StarMap open/close/pause/autosave; the `ship-customization/` component tree | Component specs (enable rule, flow, confirm/cancel, failure text, counts in production); run the app (Playwright) and check desktop and narrow layouts | 3, 4, 5 |
| **7. Battle info and displays** (done 2026-11-08) | Battle screen paused start and ship info window ([D.6](#d6-battle-screen-paused-start-and-ship-info-window)); fleet-panel ATK/DEF from resolved stats; Fleet Command rows show an "upgraded" marker; research cards show module unlocks | Battle screen specs: starts paused, Space / ▶ starts it, outcome identical with and without the paused start, enemy left click opens the window without selecting, own left click selects and opens; panel values match battle stats | 3 (the paused start alone has no dependency and can ship first) |
| **8. AI** (done 2026-11-08) | `calculateFleetStrength` with loadouts; AI orders modules in its factories and installs them at its Spaceport planets by personality (militarist first), choosing profile and weapon from perceived enemy damage types; respects the spending policy and the factory capacity it needs for ships | AI unit specs; `npm run test:long`, check APM ledger and that no personality starves its economy or its ship production | 5 (7 for debug display) |
| **8b. Module balance pass** (done 2026-11-08: one technology per module, Laser toned down, AI on for every personality, AI economy fixes; module upkeep not needed) | An equal-budget auto-resolve spec for modules (like `hull-balance.spec.ts`, budgets including module prices and the upkeep a hull would cost over a game); retune module values / prices (or add module upkeep) until a refit is clearly worse per price than a hull (C.1); switch `EnemyEquipmentService.ENABLED_BY_DEFAULT` on and re-measure every long simulation | Module spec passes; `npm run test:long` passes with the AI refitting; refits visible in a 60-minute game | 8 |
| **9. Optional extensions** | An ORDER shortcut on the customization screen; "apply to all ships of this class"; module upkeep if Phase 8 shows it is needed | Per feature | 6, 8 |

Documentation per phase: rewrite this file from design into the current
rules, and update [Battle Rules](./battle-rules.md) (equipment in the
damage path, stack grouping), [Battle Screen](./battle-screen.md) (paused
start, info window), [Ship Production](./ship-production.md) (equipment
orders), [Data Models](./data-models.md) (new fields),
[Invariants](./invariants.md) (module conservation, location rule),
[Fleet Organization](./fleet-organization.md) (loadouts travel with ships,
fleet speed follows the slowest engine), [Game Systems](./game-systems.md)
(movement speed), [Research](./research.md) (module unlocks),
[Economy](./economy.md) (module prices) and [AI Pipeline](./ai-pipeline.md)
(Phase 8).

### Risks

| Risk | Where | Mitigation |
|---|---|---|
| Equipment silently stripped | the six record-rebuild sites, especially `shipsFromOutcome` after every battle | One copy helper; round-trip tests per site (Phase 2, before any gameplay) |
| Equipment orders refunded as unknown ships | `ProductionService.tick`, `rebaseFromSave`, `getOrderEta`, save validation all assume `shipTypeId` | Branch on `equipmentId` first in every one of them; dedicated specs |
| Light hulls overpowered by fixed values | +16 attack doubles a fighter | Value-per-price limit (C.1) checked by an equal-budget spec including module prices; tune values there |
| Fire-rate factor breaks agreement between systems | combat, auto-resolve, targeting estimate, `shotScale`, AI strength all derive damage per second | One helper for the `fireRate / hullFireRate` ratio; a spec comparing auto-resolve and targeting estimates for a Laser-fitted stack |
| Upkeep-free power late game | ship upkeep is progressive, modules have none | Measured in Phase 8b: not needed for balance (modules stay at or below hulls per price), but modules do not absorb the late credit hoard either (F) |
| Factory capacity contention | modules and ships share one queue per planet | Intended (it's the cost of building modules). Watch the AI in Phase 8 so it doesn't starve ship production |
| Stack stats wrong for mixed loadouts | `buildStacks` groups by type only; front-ship attackType decides a stack's weapon | Group by loadout key; test with mixed fleets above the 28-ship limit |
| More stacks than deployment slots | many distinct loadouts of one type in a big fleet | Placement already falls back to any free cell; worst case is visual crowding. Measure with a 40-ship mixed fleet |
| Balance drift | any non-zero standard module, faster map movement | Identity tests (battle and movement); long AI sims |
| AI blindness before Phase 8 | forecasts see equipment (decided), but `calculateFleetStrength` ignores it | Until Phase 8 AI ships carry only standard modules; the AI may underrate an upgraded player fleet in strength comparisons until then |
| Faster player fleets vs AI timing | AI threat and intercept estimates use `galaxyCellsPerSecond` | They read the same helper, so they see true speeds; check opening-grace and defense tests in Phase 4 |
| Paused start breaks battle tests | specs that expect fire from frame 1 | Unpause explicitly in those specs; the outcome-equality spec guards the rules |
| Doc / code drift | see "Discrepancies" below | Fix the texts in the phase that touches those files |
| Stylesheet budget | a large new screen | Child components with their own small stylesheets; reuse global classes |

### Discrepancies found during the audit (not fixed in Phase 1)

- ~~`docs/battle-rules.md` says the battle `speed` stat "drives galaxy
  movement".~~ Fixed in Phase 4: the text now describes `Fleet.speed` and
  the engine bonus.
- The header comment of `battle-combat.service.ts` still says the weapon
  table is 1.5× / 1.0× / 0.5×. The table in `battle-grid.ts` is 1.2× / 1.0×
  / 0.8×.
- `ShipType` is declared twice (`ship.service.ts`, `star-map.models.ts`) and
  `FleetShip` twice (`star-map.models.ts`, `battle.types.ts`). New fields
  must be added to both until they are unified.
- Generated starting fleets move at speed 6–8, while every fleet assembled
  or split later moves at 4.
- Compiled `.js` files are tracked next to many `.ts` sources (e.g.
  `star-map.js`, `ship.service.js`). They are stale artifacts. Edit only the
  `.ts` files.

---

## F. Open questions

None. Every design question was answered on 2026-11-08; see
[Decisions](#decisions-2026-11-08). The only deferred point is module
upkeep, to be reconsidered after the Phase 8 long AI simulations. Catalog
values and prices are starting values that the balance specs tune.

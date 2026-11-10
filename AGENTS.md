# AI Coding Instructions

## Code Documentation

All code comments and documentation must be written in English.

The primary goal of comments is to preserve important context for future developers and AI coding agents.

### When to add comments

Add comments when the intent, reasoning, constraint, or behavior cannot be understood easily from the code itself.

Comments are especially valuable for:

- non-obvious implementation decisions
- the reason behind an unusual approach
- important business or gameplay rules
- invariants and assumptions
- edge cases
- limitations or constraints imposed by external systems
- interactions between different systems
- unintuitive lifecycle or state-management behavior
- performance-related decisions
- workarounds for engine, framework, platform, or third-party limitations
- behavior that a future developer might accidentally break
- code whose correct behavior depends on information that is not obvious from the implementation

### What comments should explain

Prefer explaining why something is done rather than describing what the code does.

Good:

```ts
// We intentionally cache this value because recalculating it every frame
// causes unnecessary allocations when hundreds of entities are active.
```

Bad:

```ts
// Calculate the value.
const value = calculateValue();
```

Do not write comments that merely restate the code, variable names, or function names.

Bad:

```ts
// Get the player.
const player = getPlayer();
```

## Complex systems

Complex systems should be documented at the system level.

When appropriate, add class-level or module-level documentation explaining:

- the purpose of the system
- its responsibilities
- important invariants
- important assumptions
- how it interacts with other systems
- important state transitions
- significant constraints
- non-obvious design decisions

Do not document every function mechanically. Focus on information that would otherwise have to be rediscovered by reading and reasoning through the entire implementation.

## Keep documentation accurate

Comments and documentation are part of the codebase and must remain consistent with the implementation.

Never invent behavior that is not supported by the code or project requirements.

If the intended behavior is unclear, do not guess. Ask for clarification or explicitly mention the uncertainty.

When modifying code:

- update nearby comments if the documented behavior changes
- update relevant documentation files if system behavior, rules, architecture, data models, or invariants change
- remove or correct documentation that becomes obsolete

Documentation should describe the current implementation, not historical behavior, unless the historical context is itself important.

## AI-oriented documentation

Write comments and documentation so that a future AI coding agent can quickly understand the relevant context without having to infer everything from the implementation.

Prefer documenting:

- design intent
- constraints
- invariants
- relationships between systems
- reasons behind architectural decisions
- known edge cases
- important consequences of changing the code
- dependencies between systems
- authoritative sources of truth for game rules and data

Avoid documenting obvious implementation details.

## Running tests

- `npm test` (`ng test`) runs every spec except the multi-minute AI game simulations (`*.long.spec.ts`); about 1.5 minutes.
- `npm run test:long` runs only the `*.long.spec.ts` simulations (about 5–6 minutes); `npm run test:all` runs everything.
- While working, run only the affected specs (`npx ng test --watch=false --include <path>`). Run the full `npm test` once before finishing, and `npm run test:long` only after changes to AI behavior, economy, diplomacy or balance values.
- A new test that plays a game for minutes belongs in a `*.long.spec.ts` file; keep the default suite fast. See `docs/ai-pipeline.md` (Tests).

## Documentation files

For sufficiently complex systems, prefer creating dedicated Markdown documentation rather than putting large amounts of information into source-code comments.

Documentation should describe systems, rules, relationships, constraints, and design decisions rather than simply duplicating source code.

The project currently contains the following documentation files:

- `docs/architecture.md` — overall project architecture and major system relationships
- `docs/battle-rules.md` — battle and combat rules (ship equipment in battle: stat order, stack grouping by loadout, weapon fire rate and damage per second; grid, reach, fire cadence and weapon charge, battle length and speed multipliers, damage formula with percentage armour, hull classes — the light/medium/heavy counter cycle, siege bonus and the equal-budget balance table —, the passive carrier shield aura, orders, targeting modes, tactical AI)
- `docs/battle-screen.md` — battle minigame implementation (incl. the ship info window and the paused start): file structure, game loop, services, time controls, testing approach
- `docs/data-models.md` — important data structures and domain models
- `docs/game-systems.md` — major gameplay systems and their responsibilities
- `docs/invariants.md` — rules and conditions that must always remain true
- `docs/ship-production.md` — ship production, global stock, and fleet assembly pipeline
- `docs/first-contact.md` — first contact in every game mode (implemented; as-built notes and the first skirmish measurement in its Implementation section): unknown empires until met (`StarMapData.contacts`, missing = everyone known), the contact trigger (sensor sightings, player and AI), the formal contact dialogue (greeting, two temperament-based questions with three replies, closing stance, gift), the evaluation table and the seeded warlike roll, warlike empires after contact (negative peace drift, opinion-blind restless wars, the grudge clock against stronger empires), AI–AI contact, campaign hooks, skirmish balance to measure, save compatibility, tests, and the near-final dialogue content per temperament and campaign faction
- `docs/fleet-organization.md` — fleet merging, splitting and ship redistribution: co-location rule, atomic plan validation, fleet retirement, new-fleet ids and position, the Spaceport-only reserve (stock ↔ fleet, replaces REINFORCE; same rule for the AI), ship repair (Spaceports, space bases with Orbital Repair Docks, the reserve; damage carried through the reserve; the green repair aura), game pause while editing, Fleet Command dialog UX, save compatibility
- `docs/research.md` — technologies and research: effect inventory (unlocks and bonuses per technology), bonus aggregation and where each bonus is applied, research price (research points + credits) and its scaling, AI research selection, research UI, save compatibility
- `docs/economy.md` — faction economy: the three resources (credits, raw materials, research points), finite raw-material deposits on planets and asteroids (sizes, extraction, depletion), economic safety (starting deposit, emergency trickle), energy and satisfaction (core building energy, proportional energy drift, shortage/rebellion warnings and the build-list energy preview), the economy tick, upkeep as the credit sink (empire upkeep scale, progressive ship upkeep, station upkeep) and colony administration, colony cores (Capital / Colony Center: auto-placed core building with the planet's base population, workforce and energy; placement, ownership, the 2026-11 start balance and its measured AI effect), planet types (population ceiling, upkeep factor, per-type advantage), the empire-wide resource exchange (open with any own Trading Post, used from the header resource overlay), arrears, cost structure and building/ship/research prices, purchase and refund rules, AI spending policy summary, save compatibility
- `docs/game-time.md` — centralized game time, pause/speed controls, and scaled delta flow
- `docs/ui-styling.md` — UI styling guide (incl. the Ship customization screen treatment and its generated blueprint hull art): the design system (`--ui-*` tokens, `_ui.scss` mixins, the command-console look: console panels, the metallic console frame, Share Tech Mono, buttons, tabs, shared content classes, containing-block rules), per-screen UI treatments, font, screen overlay, HudDots, the shared game header (layout, sizing token, responsive rules), space scenery (shared backdrop / star / planet mixins, per-screen compositions, wrapping nebula field, backdrop-over-fog rule) and the main menu, motion and sound (`_motion.scss`: dialog power on / off via `animate.enter` / `animate.leave`, panel boot, view-change sweep, button states, list stagger, `ValueFlashDirective`, the synthesized `UiSoundService` (UI sounds, order sounds, battle sounds: public/sfx samples with synthesized fallbacks, the engine loop, the battle bus) with its Options toggle, `MusicService` (scene tracks from `public/music/` with crossfades, map-notice and fanfare stingers, MUSIC toggle and volume), reduced motion)
- `docs/new-game-generation.md` — New Game setup, procedural galaxy generation, AI difficulty (decision quality, tempo values and their 2026-11-09 measurements, adaptive difficulty: `AiAdaptiveDifficultyService`, `Faction.aiAdaptiveFactor`, the global ADAPTIVE AI Options setting `AiSettingsService`), and generated-save persistence
- `docs/planet-capture.md` — authoritative planet ownership pathway, capture rules, after-capture satisfaction floor and rebellion grace, planet battle paths (interactive vs auto-resolve), battle outcome application, the hidden opening grace (no AI attack on the player; by difficulty Easy 10 / Normal 6 / Hard 4 minutes; values to keep watching), game outcome (victory/defeat) rules
- `docs/star-map-terrain.md` — galaxy terrain and map events: black holes as navigation obstacles (no-fly radius, routing, failure handling), nebulae (generation, movement and sensor penalties, rendering), drifting asteroids (spawning, rewards, interception, AI salvage role, persistence), impassable asteroid belts (capsule geometry, generation, connectivity guarantee, rendering), balance values
- `docs/planet-construction.md` — planetary building construction: construction time per building (table), construction sites (occupy cells and limits, no effect, no upkeep before completion; `operationalBuildings`), the scaled clock (pause, game speed), construction speed (Capital core factor, Advanced Construction / Urban Infrastructure), parallel sites without a queue, cancel refunds and ownership-change cancellation, save compatibility, AI planning with sites and committed upkeep, the surface construction visual and the BUILD-tab construction list
- `docs/planet-surface.md` — planet surface view: grid sizes, procedural terrain (field, biomes, blocked-cell mask), surface persistence and save migration, construction rules on terrain, terrain/street/sprite rendering, building sprite generator (`npm run sprites:buildings`), camera zoom (wheel, pinch, slider), the build list's building info box (click a row for details and a BUILD button, `building-info.ts`)
- `docs/diplomacy.md` — diplomacy: relation kinds and the single hostility rule, real-time diplomatic timing (seconds and per-minute rates of game time, no turns), opinion, reputation, war exhaustion (growth, output penalty), permanent peace and the 10-turn truce, war declarations and treaty breaches, peace treaties (resources only — no planets or systems; validation, atomic execution), peace-time financial demands and ultimatums (request / tribute / threat, cooldowns, AI planning, acceptance and war-or-bluff follow-through, credibility, saved pending demands), AI war assessment / treaty evaluation / counter-offers / war decisions and personalities, AI-vs-AI battles, Diplomacy screen and negotiation dialog, diplomatic victory, save compatibility
- `docs/territory.md` — empire territory and space bases: derived territory (system and base claims, claim owner, overlap rule, event-driven cache), border violations (peace-only trespass, opinion penalty by fleet value / duration / repeats, never a war; prepared passage rights), the colonization rule in foreign territory, the outpost ship and base deployment rules, station construction time (construction sites: 60 s base, 180 s mining station; no function until complete, passive in battle), asteroid mining stations (deployment on surveyed deposits, one per asteroid, extraction in the economy tick, hover feedback, combat), the shared station defense model (core hull, 0–3 turrets from Turret Research I–III for bases and mining stations alike, shield pool, one static-defense combat and outcome path), territory rendering, save compatibility
- `docs/exploration-anomalies.md` — exploration anomalies: hidden events in systems, on asteroids and in open space (generation and tuning, hidden / discovered / active / resolved lifecycle, player-only triggering, exactly-once resolution, event types and data-driven choice effects, pirate ambush through the existing fleet-battle pipeline, event dialog and map markers, save compatibility)
- `docs/trade-network.md` — civilian trade network: traders as a separate entity (not fleets), network nodes (planets with a Trading Post), two trader slots per node, global cap, idempotent slot reconciliation (no duplicates, retiring traders), derived affiliation, respawns, save compatibility, trips and routing, credit cargo and payout, trader UI, raids (orders, damage, loot, diplomatic cost, escalating respawn), independent civilizations (generation as extra systems, conquest, victory exclusion), AI behavior (Bank / Trading Post construction by personality, civilization assault gate on the saved game clock, raid role)
- `docs/versioning.md` — game version (package.json, semver 0.MINOR.PATCH, release tags and CHANGELOG.md) and save format version (SAVE_VERSION, MIN_SUPPORTED_SAVE_VERSION): bump rules, migrations only within a MINOR line, drawing a compatibility line at a MINOR release (0.3.0 = format 12), loader behavior for unsupported saves (rejected, never modified, listed as incompatible)
- `docs/dyson-swarm.md` — Dyson Swarm alternative victory (design; phases 0–4 implemented: station construction time, ring geometry, Stellar Engineering / Swarm Constructor / anchor deployment, anchor panel with one-time bonus and DEMOLISH, anchor upkeep and bonus effects, the 5-minute warm-up victory with countdown and saved state, global Dyson news by anchor diffing, opinion cost per anchor, the 3-anchor casus belli and no AI peace during a warm-up, the AI by personality — EnemyDysonService building, hunting and guarding), the campaign rules of Mission 7 (Dampener, coalition warm-up, AI plan overrides, price and upkeep factors): 8 fixed anchor slots around the central black hole, wedge territory and ring zone precedence (dyson-ring.ts, DysonRingService), generation and validation keeping nebulae and belts off the ring, station construction time for every station type, the anchor ship and lifecycle (destroy-only, demolish), one-time anchor bonuses, the 5-minute warm-up victory, global news, casus belli, AI by personality, implementation phases and open questions
- `docs/late-economy.md` — the mid/late-game credit surplus (implemented): measured income composition (population is ~99%), rejected housing-capacity cuts (A–D experiments, the poverty trap), what was built (comfort need, target-based satisfaction, AI comfort tier and safeguards, AI raw purchases), every tuned value with its reason (free population 5,000, 500 people per point, the smooth uncovered-share target, the 2% colony runway cap), before/after results per personality, problems found while tuning, the acceptance test and opt-in report, decisions, open points; current rules live in economy.md (Comfort) and ai-pipeline.md
- `docs/pirate-incursion.md` — pirate incursion dynamic event: quiet-galaxy trigger, warband arrival and Pirate Haven, raiders taking turns and draining credits, the outlaw faction (always at war, outside diplomacy, no planets or victory), strength from the median empire, end and cooldown, save compatibility, open points
- `docs/tutorial-hints.md` — tutorial hint system: the new-game opening it teaches, the hint bubble (one sentence, close, TUTORIAL OFF, arrow, placement next to the anchor, highlight ring, never blocks input), the step table (contextual one-offs, homeworld, ships, star map) with when / anchors / done conditions, the skip rule and priority, persistence (TUTORIAL checkbox above START on New Game, on by default; on/off and progress saved in `StarMapData.tutorial`, battle-return merge), the paused start of a tutorial game, implementation (TutorialService, tutorial-steps.ts, tutorial-context.ts, TutorialAnchorDirective and the anchor keys, TutorialHintComponent, context publishing from StarMap)
- `docs/review-backlog.md` — prioritized backlog from the 2026-10-31 gameplay review: bugs, balance and design changes (P0–P3), each written as a standalone task with evidence, files and a suggested direction; remove items as they are done
- `docs/qa-fix-prompts.md` — standalone fix prompts from the 2026-11-01 headless QA session (one bug or balance question per prompt: evidence, files, task, acceptance criteria); remove prompts as they are done
- `docs/ship-equipment.md` — modular ship equipment (Phases 1–8b implemented: catalog `equipment-data.json`, `equipment.ts`, stat resolver `ship-stats.ts`, `FleetShip` / `ShipStockEntry.equipment` and `StarMapData.equipmentInventory` with validation and carry-through via `copyEquipment` / `shipsFromOutcome`, battle integration (`withEquipment`, stack grouping by loadout, `hullFireRate` / `damagePerSecondFactor`, engine turn rate), map speed (`effectiveFleetSpeed` in `galaxyCellsPerSecond` and in-system movement, fleet panel Speed row), equipment factory orders (`queueEquipmentOrder`, `resolveOrderItem`), inventory helpers (`equipment-inventory.ts`), `ShipEquipmentService` install / uninstall, the 2-cell Spaceport rule (`spaceportPlanetNear`), `Technology.unlocksEquipment`, the UI (EQUIPMENT tab in the production dialog, SHIP CUSTOMIZATION button, `ShipCustomizationComponent` + `ship-customization-view.ts`), battle ship info window and paused start (`BattleShipInfoComponent`, `BattleSettingsService.pausedStart`), equipment-aware fleet ATK/DEF and Fleet Command marker, the AI (`EnemyEquipmentService`, on for every personality; equipment-aware `calculateFleetStrength`), the 8b module balance pass (one technology per module, Laser toned down, `module-balance.spec.ts`, AI economy fixes); the optional Phase 9 extensions remain): audit of the ship / battle / stock / save code it touches, the 2026-11-08 decisions (engines change map speed, modules built in Spaceship Factories, own price per module and free installation, install within 2 system cells of an own Spaceport planet, fixed module values on every hull, AI forecasts see equipment, battles start paused with a ship info window on left click, Point-Defense Array as the missile-profile module, weapon fire-rate factor that changes DPS, reserve ships customizable, civil hulls engine-only, existing technologies as unlocks, no resale, no upkeep for now, paused-start toggle), the proposed Engine / Weapon / Defense slot model (catalog vs per-ship loadout vs empire inventory counts, standard factory modules as the identity), the central stat resolver (research multiplier first, fixed module values second), battle integration (stack grouping by loadout) and effective fleet speed (slowest engine), equipment orders in the production queue, inventory conservation rules, the location rule, save compatibility without a version bump, the initial catalog and counters via the existing damage-type table, the Ship Customization screen (overlay hosting, entry from the fleet panel), the phased roadmap, risks, audit discrepancies and open questions
- `docs/campaign-design.md` — story campaign "Orion Imperium: The Silent Frontier" (Phases 1a–8 implemented — the campaign engine in `src/app/campaign/`, its UI (campaign screen, objective tracker, story message dialog, mission end with LOAD SAVE / RESTART MISSION) Mission 1 "The Discovery" (exit wormhole, Remnant sentinel, campaign anomalies, tutorial exclusions) Mission 2 "Beyond the Gate" (hidden system, civilization contact, trade income, rich belt) Mission 3 "First Contact" (envoys, the scripted Varkon pressure, tribute pact, AI restraint, diplomacy effects) Mission 4 "The Meridian Exchange" (League standing value sources, AI assault protection, an authored outlaw base) Mission 5 "The Border Conflict" (the campaign-only `mercantile` personality, a scripted AI–AI war, player roles and mediation, Reach control) Mission 6 "The Silent Remnant" (campaign sites, EnemyCampaignService, ancient technologies) Mission 7 "The New Frontier" (the Lacuna Heart ring, Dampeners, the coalition warm-up, instability, per-faction AI Dyson plans, the `guardian` personality, three endings) and wormhole transit for fleets and traders (`wormholes.ts`, `Fleet.transit`); see its Implementation status; the rest is design): codebase audit for the campaign (what exists, partial, missing), the seven missions (story, objectives, endings, maps and faction placement), AI faction mapping onto existing personalities plus the proposed `mercantile` / `guardian` profiles, neutral civilizations and merchants, environmental gameplay, the proposed campaign framework (mission builder, objective engine, story events, campaign sites, `StarMapData.campaign`, progress store, mission outcome override), wormholes with fleet and trader transit (`StarMapData.wormholes`, routing, `Fleet.transit`), the finale on the Lacuna Heart Dyson ring (three endings, coalition warm-up, Dampener anchors, instability, per-faction Dyson plans), carry-over rules (flags and researched technologies, the per-mission research horizon), a summary of first contact (full design in first-contact.md) and the campaign tribute pact, the `campaignOnly` technology flag, implementation phases, file estimates, testing strategy, risks, MVP scope and open questions
- `docs/campaign-remaining-work.md` — what is left of the story campaign after Phases 1a–8 (Phase 9 and later), step by step with a relative cost per step and how to resume; remove steps as they are done
- `docs/ai-pipeline.md` — strategic AI pipeline: execution order, per-faction scheduling, fleet-order ownership, AI economy manager (construction, spending policy, military production), AI research, AI asteroid mining (outpost ships, surveying, mining stations), AI ship equipment (EnemyEquipmentService: on for every personality, the 2026-11-08 balance pass (measurements, hull-only military need and threat, deficit runways in the spending reserve and research, colony starter upkeep), threat profile, module choice, surplus and idle-factory gates, installs), fleet roles and combat decisions, strategic posture and personalities, AI Dyson Swarm behavior (EnemyDysonService, see dyson-swarm.md), multiple objectives, deadlock detection, adaptive reach, AI fog of war and exploration, AI debug panel, the AI action ledger (measurement-only actions-per-minute counting, commit points, the opt-in `ORION_APM_REPORT` simulation report), save/load and bounded state, colonization and failure recovery, simulation, evaluation and acceptance tests

These files are the current documentation sources of truth for their respective topics.

### Creating new documentation files

If a system, subsystem, feature, rule set, workflow, or other area becomes sufficiently complex that it deserves dedicated documentation, create a new Markdown file under `docs/`.

Do not force unrelated information into an existing documentation file just to avoid creating a new file.

Create a new documentation file when, for example:

- a system has substantial design rules that cannot be explained clearly in `game-systems.md`
- a subsystem has its own lifecycle, state machine, or interactions
- a feature has complex rules or edge cases
- a data subsystem requires detailed explanation beyond `data-models.md`
- an architectural decision requires substantial context
- a technical integration or external constraint needs dedicated documentation
- documenting the system in source comments would create excessive or duplicated comments

Use a clear, descriptive, kebab-case filename:

```text
docs/<topic-name>.md
```

The new documentation file must:

1. Be written in English.
2. Describe the relevant system, rules, constraints, or design decisions.
3. Avoid mechanically duplicating source code.
4. Reference related documentation where useful.
5. Be kept up to date when the implementation changes.
6. Be added to the documentation list in this `AGENTS.md`.

For example, if a new `docs/fleet-management.md` file is created, update this section to include:

```md
- `docs/fleet-management.md` — fleet management rules and system behavior
```

### Choosing the appropriate documentation file

Before creating a new documentation file, check whether the information belongs in one of the existing documents.

Prefer updating an existing document when the new information is naturally part of its scope.

Create a new document only when the topic has enough independent complexity or importance to justify its own source of truth.

Do not create documentation files for trivial features, simple classes, straightforward implementations, or information that is already obvious from the code.

### Documentation links

Documentation files should link to related documentation when there are meaningful dependencies between them.

Use relative Markdown links, for example:

```md
See [Battle Rules](./battle-rules.md) for combat resolution rules.
```

When a new documentation file is created, update this `AGENTS.md` so that the file is discoverable by future AI coding agents.

## Documentation hierarchy

Use the following general responsibility boundaries:

- `architecture.md`

  - overall architecture
  - major modules and system relationships
  - high-level dependency direction
  - architectural decisions

- `game-systems.md`

  - major gameplay systems
  - system responsibilities
  - interactions between gameplay systems
  - important state transitions

- `battle-rules.md`

  - combat rules
  - battle resolution
  - combat-specific calculations
  - combat-related gameplay constraints

- `data-models.md`

  - domain entities
  - important data structures
  - relationships between models
  - authoritative data representation

- `invariants.md`

  - conditions that must always remain true
  - cross-system consistency requirements
  - assumptions that must not be violated

If a topic does not fit cleanly into these responsibilities and is sufficiently complex, create a dedicated documentation file instead of overloading an existing document.

## Documentation maintenance

When implementing a change:

1. Determine whether the change affects documented architecture, systems, rules, data models, or invariants.
2. Update the relevant documentation if necessary.
3. If the change introduces a sufficiently complex new topic, create a dedicated `docs/<topic-name>.md`.
4. Add every newly created documentation file to the documentation list in this `AGENTS.md`.
5. Keep cross-references between documentation files accurate.
6. Do not leave documentation describing behavior that no longer exists.

Documentation changes should be treated as part of the implementation, not as an optional follow-up task.

## Language

All:

- source-code comments
- XML documentation
- Markdown documentation
- architecture documentation
- AI-facing project documentation

must be written in English.

## Minimal noise

Do not add comments merely to increase documentation coverage.

A smaller number of high-value comments is preferable to a large number of low-value comments.

The code should remain readable without excessive commentary.

# Tutorial Hints

Status: **implemented** (2026-11-09).

A lightweight, context-driven tutorial: one tiny hint bubble at a time, pointing at the UI element the
player should use next, with a highlight ring around it. It never blocks input; apart from the paused
start of a tutorial game it never pauses the game; it can be turned off from every bubble.

Related: [New Game Generation](./new-game-generation.md) (start view, starting assets, the TUTORIAL
checkbox), [Planet Construction](./planet-construction.md), [Ship Production](./ship-production.md),
[Game Systems](./game-systems.md) (control rule: left click selects, right click orders),
[Planet Capture](./planet-capture.md) (4-minute opening grace), [Game Time](./game-time.md),
[UI Styling](./ui-styling.md).

## What the player sees at the start of a new game

Facts the step order is built on (see the linked docs for details):

- The game opens in the **planet view of the homeworld** (`defaultView`), BUILD tab available.
- The homeworld already has a Capital, a Large Residential Block, a Fusion Power Plant, a Laser
  Turret and a Research Laboratory, plus a free **raw-material deposit**. No Mining Complex, no
  Spaceship Factory, no Spaceport — so the PRODUCTION and ASSEMBLY tabs are hidden.
- Starting stock: 1000 credits, 2500 raw materials, 1000 research. Raw materials cover the first
  Mining Complex (375) and Spaceship Factory (750); credits do not (Mining Complex 1500), so the
  BUILD button of the first mine is disabled for the first few seconds of income. The `build-mine`
  hint then points at the row, which shows the price and the reason.
- One small fleet (2 scouts + 1 fighter) sits next to the homeworld. All star systems are visible;
  grid cells, enemy fleets and foreign planet details are fogged.
- Time runs in real time. AIs do not attack the player for the first 4 minutes (opening grace), so
  the core steps should fit roughly into that window.
- Orders: **left click selects, right click orders** (long press on touch). There is no MOVE button.
- Every other empire is unknown until first met; a contact dialogue then decides war or peace ([First Contact](./first-contact.md)). Diplomacy matters from that first meeting.

## Hint bubble

```
            ▲  (arrow toward the anchor)
 ┌──────────────────────────────────┐
 │ A Mining Complex extracts the  ✕ │
 │ raw materials ships are made of. │
 │                    TUTORIAL OFF  │
 └──────────────────────────────────┘
```

- **Text:** one short sentence, English like the rest of the game UI. On touch screens
  (`pointer: coarse`) the steps that mention right-click use their `touchText` (long-press).
- **✕ (close):** dismisses this hint only; it is marked done and the next eligible hint may appear.
- **TUTORIAL OFF:** turns every hint off at once. A short notice ("Tutorial off — turn it back on in
  Options.") confirms it. No confirmation dialog — it is cheap to undo.
- **Arrow:** a small rotated square on the bubble edge facing the anchor, slid along that edge so it
  keeps pointing at the anchor's center even when the bubble is clamped to the screen.
- **Placement:** the bubble sits next to its anchor on the step's preferred side, then tries the
  opposite side, then the others, and is clamped inside the viewport (8 px margin). It is never
  shown detached from its anchor: if no anchor of the step is on screen, the hint waits and the next
  candidate with a visible anchor may show instead.
- **Highlight:** a ring around the anchor's bounding box (4 px padding) with a slow pulse in the
  console accent color; static under reduced motion. The overlay and ring take no pointer events,
  so the highlighted control stays clickable; only the bubble does. No dimmed backdrop.
- Style: console panel (`ui.glass`), the game font, `ui-enter` motion. Layer: `z-index` 9000, above
  game dialogs, under the CRT overlay.

## Step order

The table lives in `src/app/components/tutorial/tutorial-steps.ts` (the source of truth for texts and
conditions). Each step has a `when` (live check: screen + game state), an optional `trigger`,
`anchors` (alternatives, most specific first), and a `done` predicate and/or `doneOn` events.

**Latched triggers.** A `trigger` is a start condition that stays true once it has held, until the
step is done (`TutorialService` keeps an unlocked set, saved with the game). It is for conditions
that can flip back: with a live "a fleet is moving" check, the research hint flashed and vanished
when the scout stopped at an anomaly. Time and screen checks that should hide a hint again stay in
`when`.

**Skip rule.** A step is marked done as soon as its `done` predicate holds or a `doneOn` event
arrives — even if it was never shown. A player who acts ahead of the tutorial, or loads a mid-game
save, never sees a hint for something already done. The rule runs only on a real context snapshot
(scene not `none`): the empty pre-load context reads as "not paused" and would otherwise finish the
time step before the first frame.

**Steps excluded by a campaign mission.** A mission can switch steps off (`MissionDefinition.tutorialExcludedSteps`, e.g. `diplomacy` in Mission 1, which has no empires). StarMap passes them to `TutorialService.setExcludedSteps` on every load; they count as done for selection and for `after` (so `finished` still comes), but are never saved as done, so a later normal game is unaffected. A mission with `rules.tutorial` starts with the hints on ([Campaign Design](./campaign-design.md#implementation-status)).

**Repeatable steps.** A step with `repeatable` is done (closed or finished) only until its `when`
turns false; then it may show again. Used by `back-to-planet`.

**Closing hint.** `finished` (anchored on the resource bar) has `after: [colonize, research,
diplomacy]`: it says the tutorial is over, so the silence afterwards is not read as a stuck hint.

**Priority.** Contextual steps come first (time-sensitive), then core steps in table order. The
overlay shows the first candidate whose anchor is registered and on screen.

### Contextual, once each

| id | When | Anchor | Done when |
|----|------|--------|-----------|
| `battle-start` | battle screen, paused | battle time controls | battle unpaused, or closed |
| `enemy-fleet` | galaxy map, a hostile fleet visible | that fleet's map marker | closed |
| `energy` | placing a building that would cause a shortage | the "Energy after building" line | closed |
| `anomaly` | galaxy map | the first anomaly marker's glyph | closed |
| `asteroid` | galaxy map | the first drifting asteroid | closed |
| `raw-low` | own Trading Post and raw materials < 300 | raw materials in the header | closed |

### A. Homeworld

| id | Anchor | Done when |
|----|--------|-----------|
| `resources` | header resource bar | game unpaused, or closed |
| `time` | play / speed buttons | game unpaused (not on the battle screen), or closed |
| `build-tab` | BUILD tab | BUILD tab opened, or a Mining Complex exists |
| `build-mine` | Mining Complex BUILD button (row expanded and affordable), else its row | picked for placement, or exists |
| `place-mine` | placement BUILD button, else the marked cell where the mine fits | a Mining Complex exists |
| `construction` | the "Under construction" list (while sites exist) | a Mining Complex or Spaceship Factory is complete |
| `build-factory` | Spaceship Factory BUILD button / row (once a Mining Complex exists) | picked, or exists |
| `build-spaceport` | Spaceport BUILD button / row (once a factory exists) | picked, or exists |

"Exists" counts construction sites too. Every build step falls back to the BUILD tab as its last
anchor: the rows exist only on that tab, and a player on DETAILS otherwise got no hint at all. The marked cell (`surface.mine-spot`) is the first top-left
cell where `checkBuildingPlacement` accepts a Mining Complex next to a deposit, so clicking it gives a
valid preview.

### B. Ships (complete buildings)

| id | Anchor | Done when |
|----|--------|-----------|
| `production` | QUEUE (Colonizer picked), else the Colonizer type, else + QUEUE NEW ORDER, else the PRODUCTION tab | an order queued, ships in stock, or a Colonizer fleet exists |
| `stock` | ship stock in the header (while ships are in stock) | the stock opened, a fleet assembled, or closed |
| `assembly` | CREATE FLEET (enabled), else the first + button, else the ASSEMBLY tab; on the galaxy map the planet roster | a fleet assembled |

| `spaceport-wait` | planet view, ships in stock, the Spaceport still a construction site | the "Under construction" list | the Spaceport is complete |

`stock` comes before `assembly` in priority, so it must finish when the stock is opened: finishing
it only on an assembled fleet kept the assembly hint hidden behind it.

### C. Star map

| id | When | Anchor | Done when |
|----|------|--------|-----------|
| `to-map` | planet or system view, no fleet selected; trigger: a Spaceport exists or 90 s played | header back button | galaxy view open |
| `select-fleet` | galaxy view | first own fleet in the roster | a player fleet selected or moving |
| `move` | galaxy or system view, a player fleet selected | the fleet panel's right-click line | a player fleet is moving |
| `enter-system` | galaxy view | ENTER SYSTEM (system panel open) | entered a system from the panel |
| `colonizer-leave-planet` | planet view, an idle Colonizer fleet, one planet; repeatable | header back button | leaving the planet view |
| `colonizer-move` | a Colonizer fleet, idle, not at a colonizable planet | its panel line when selected, else its roster button (map) or its marker (system view) | a second player planet |
| `colonize` | the Colonizer is at a colonizable planet | COLONIZE, else as above | a second player planet |
| `research` | not in battle; trigger: 3 min played or a fleet has moved | research icon in the header | research tree opened |
| `back-to-planet` | galaxy view and planet work pending: no Spaceport yet, a finished factory with nothing ordered (before the first Colonizer), or ships in stock at a finished Spaceport; repeatable | first planet in the roster | a planet view opened (roster or planet panel) |
| `diplomacy` | not in battle; trigger: the player has met an AI empire (`metEmpires`) | DIPLOMACY button | Diplomacy opened |
| `finished` | not in battle; after colonize, research and diplomacy | resource bar | closed |

`to-map` waits while a fleet is selected because a new fleet is assembled into the system view with
itself selected, and the move hint should come first there. `back-to-planet` exists because the
build steps only show on the planet: a player who went out to the map early (the 90 s `to-map`
trigger) otherwise had no hint left on the map and no way to know what came next. `enter-system` only shows once the
player has opened a system panel; it never blocks later steps.

## Persistence

- **New Game:** a TUTORIAL checkbox directly above START GAME, checked by default on every New Game
  (decided 2026-11-09). `NewGameService.startNewGame` writes `StarMapData.tutorial = { enabled,
  done: [] }`.
- **During the game:** TUTORIAL OFF on a bubble and the TUTORIAL toggle in Options (shown only in a
  game) change the same flag; Options also offers RESET TUTORIAL (clears the done steps and turns
  the tutorial on; the skip rule then skips what is already done again).
- **Progress** (done steps and unlocked triggers) is saved with the game in the same field, so a loaded game continues where it was. A
  missing field (older save) means the tutorial is off. Optional field, no save-version bump
  ([Versioning](./versioning.md)).
- **Battle return.** The star map reloads the pre-battle autosave after a battle, so
  `TutorialService.restore(state, keepSession = true)` merges the steps finished on the battle
  screen into the loaded set.

## Paused start

A new game with the tutorial on starts **paused** (decided 2026-11-09), so the first hints can be
read without the clock running: `StarMap.loadGame` pauses right after `GameTimeService.reset()` when
`TutorialService.shouldStartPaused(gameSeconds)` (tutorial on, game clock 0, `time` not done). The
`time` hint points at the play / speed controls and is done when the player unpauses. This mirrors
the battle screen's paused start. With the tutorial off, and on every later load, the game starts as
before. The opening grace counts game time, so the paused seconds do not
use them up.

## Implementation

- `tutorial-steps.ts` — `TutorialContext`, the step table, pure selection (`tutorialCandidates`,
  `satisfiedSteps`, `stepsDoneByEvent`). Unit tested in `tutorial-steps.spec.ts`.
- `tutorial-context.ts` — `buildTutorialContext`, a pure snapshot from star-map state (buildings
  by id via the planet-data name map, stock, queued orders, fleets, Colonizer, trading post, raw
  materials). StarMap supplies what needs its services (hostile fleet via `areFleetsHostile`, the
  colonization check).
- `TutorialService` (`services/tutorial.service.ts`, root) — enabled flag, done set, current
  context, `candidates` signal, the anchor registry; `restore` / `serialize`, `leaveGame` (main
  menu), `setContext`, `setBattleScene`, `setScene`, `notify`, `dismiss`, `setEnabled`, `reset`. It
  only reads game state.
- `TutorialAnchorDirective` (`[appTutorialAnchor]`) — registers its element under a key while it
  exists; a null key registers nothing, so templates mark elements only in a given state.
- `TutorialHintComponent` — rendered once in `app.html`. Each animation frame it picks the first
  candidate with a visible anchor and writes ring / bubble / arrow positions straight to the DOM;
  only a change of the shown step goes through a signal (a signal write per frame would run change
  detection over the whole default-strategy game). An anchor counts as visible when it has a size,
  its center is in the window and the element at its center is not inside a covering dialog
  (`[role="dialog"]`, `[aria-modal]`, the header resource overlay, the production order dialog).
- Context publishing — `StarMap.publishTutorialContext` from the game loop (which also runs while
  paused), at most every 250 ms, only while the tutorial is on, plus once after every load. Dialogs
  StarMap knows (pause menu, Options, research, diplomacy, negotiation, Fleet Command, ship
  customization, anomaly event, campaign story message, AI debug, game end) set `modalOpen`, which hides every hint.
- Events (`notify`) — planet tab opened, Mining Complex / factory / Spaceport picked (planet
  screen), ship stock opened (header), fleet assembled, system entered from the panel, a planet view opened, research tree and
  Diplomacy opened (StarMap).
- Anchor keys — `hud.resources`, `hud.raw`, `hud.research`, `hud.time`, `hud.back`, `hud.stock`,
  `hud.diplomacy`; `planet.tab.<tab>`, `planet.construction`, `build.row.<id>`, `build.start.<id>`,
  `build.confirm.<id>`, `build.energy-short`, `surface.mine-spot`; `production.add`,
  `production.type.<ship>`, `production.queue`; `assembly.add`, `assembly.create`;
  `roster.fleet.<id>`, `roster.planet`, `system.fleet.<id>`, `fleet.panel`, `fleet.colonize`, `system.enter`; `map.fleet.<id>`,
  `map.anomaly`, `map.asteroid`. A key used by a step must exist in a template, or the step never
  shows.

## Open points

- The anomaly and asteroid hints anchor on the galaxy map only; anomalies inside the system view
  have no hint.
- `enter-system` waits for the player to open a system panel by themselves; there is no hint that
  says "click a star".

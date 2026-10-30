# Fleet Organization (merge, split, redistribute)

The player can freely reorganize the fleets they have on one location:
merge fleets, split one into several, move individual ships or whole ship
classes between fleets, and rename fleets. At one of their own Spaceports
they can also draw ships from the global stock (the **reserve**) or return
ships to it; this replaced the former REINFORCE button. Reorganizing is free
and instant: it costs no resources, issues no movement orders and never
advances or triggers anything in the simulation.

Related: [Ship Production & Fleet Assembly](./ship-production.md) (how
fleets are created from the stock), [Data Models](./data-models.md#fleet),
[Invariants](./invariants.md#fleet-organization-invariants),
[UI Styling](./ui-styling.md).

## Files

| File | Role |
|---|---|
| `src/app/services/fleet-organization.service.ts` | Domain rules: co-location, plan validation, atomic apply |
| `src/app/components/star-map/star-map-fleet-manager/fleet-organization-draft.ts` | Editable in-memory draft the dialog works on; turns into a plan |
| `src/app/components/star-map/star-map-fleet-manager/star-map-fleet-manager.component.*` | The "Fleet Command" dialog |
| `StarMap` (`openFleetManager`, `onFleetManagerApply`, `closeFleetManager`) | Opens the dialog, pauses the game, applies the plan, saves |
| `star-map-fleet-info` | The ORGANIZE FLEETS entry point in the fleet panel |

## Rules

**Who can be organized together.** All active fleets of one faction on the
same **galaxy grid cell** (`floor(x)`, `floor(y)`). This is the cell rule
battle detection and AI invasion merging already use; fleets inside one star
system always share it, wherever they sit on the system grid. A fleet is
active when it is not `destroyed` and has at least one living ship.

**No parallel model.** Ships are the existing per-instance `FleetShip`
records. Moving a ship moves the record object itself, so hull damage and
every other field travel with it. Battle stacks (`MAX_STACK_SIZE`) are
derived when a battle starts, so there are no stored stacks or stack limits
to maintain, and fleets have no ship cap.

**Plans are applied atomically.** The UI never mutates live fleets. It
hands `FleetOrganizationService.applyPlan` the complete target layout:
for each resulting fleet, its existing id (or `null` for a new fleet), its
name and the ids of its living ships. The service checks the whole plan
first and changes nothing if any check fails:

- every source fleet exists, is not destroyed, belongs to the plan's faction
  and is on the same cell as the others;
- every living ship of the source fleets appears in **exactly one** planned
  fleet, and no other ship appears;
- no planned fleet is empty, and an existing fleet appears at most once;
- a new fleet's `originFleetId` is one of the source fleets.

**Emptied fleets are retired, not deleted.** A source fleet missing from the
plan (all its ships moved out) is retired the way disband and AI merging
retire fleets: `destroyed = true`, `targetX/Y`, `system.targetX/Y`,
`attackFleetId` and `interceptAsteroidId` cleared. It stays in `fleets`, so
every id stored elsewhere (AI attack goals and intercept assignments, the
persisted selection) resolves to a destroyed fleet that all systems already
ignore, rather than to nothing.

**Wrecks stay put.** Ship records with `destroyed: true` are never planned or
moved; they remain in their original fleet (also when it is retired).

**New fleets** get an id one above the highest existing fleet id (destroyed
fleets included, so ids are never reused). They copy position (`x`, `y`,
`gridCol`, `gridRow`), the system location (`system`, without its target),
`speed` and the `sensorRange` floor from their origin fleet, using a snapshot
taken before anything changes, so the origin may itself be retired by the
same plan. New fleets start **idle**, even when split from a moving fleet.
Surviving fleets keep their own position and orders.

**Names** are trimmed, whitespace-collapsed and clamped to
`FLEET_NAME_MAX_LENGTH` (28). A blank name falls back to the previous name
(existing fleet) or "New Fleet". The dialog suggests unique names in the
Spaceport's scheme ("2nd Fleet", ...) and blocks Apply while a name is blank.

**Several fleets on one planet.** A split leaves the new fleet on its
origin's system cell, so two player fleets can sit on the same planet, the
same as after Spaceport assembly. The system-view rule that rejects *moving*
a fleet onto a player planet that already hosts one is a move-order rule
only. If such a planet is attacked, only one stationed fleet joins the
garrison (`StarMapPlanetArrivalService.getFleetOnPlanet`), so merging them
first is the stronger defense.

## Reserve

Stock ships are handed over **only at a Spaceport**: a fleet must stand in a
star system (galaxy cell) that contains one of its faction's own Spaceport
planets (`SpaceportService.spaceportAt`). There is no other way for stock
ships to reach an existing fleet, so ships never teleport across the map.

- `FleetAssemblyService.reinforceFleet` enforces the rule itself and fails
  with `not_at_spaceport` elsewhere. It is now used only by the AI, whose
  three callers (`reinforce_fleet`, `assemble_fleet`, combat-ship
  deployment) already chose fleets parked at a Spaceport, so the AI plays by
  the same rule and its behavior did not change.
- For the player, StarMap passes the stock to the dialog only when the
  opening fleet is at an own Spaceport (`isFleetAtOwnSpaceport`); the plan
  then carries `reserveShipIds`, the complete set of ships in the stock after
  the plan. `applyPlan` re-checks the Spaceport and treats stock entries and
  living fleet ships as one pool in which every ship must appear exactly once.
- Stock → fleet: the entry becomes a `FleetShip` at full hull (as in fleet
  assembly). Fleet → stock: the ship becomes a plain `ShipStockEntry`, which
  stores no damage, so docking a damaged ship repairs it (the same as disband).
  The remaining stock keeps its FIFO order; returned ships are appended.
- A plan with a reserve may leave no fleet at all (everything returned to
  the stock); StarMap then clears the fleet selection.
- Creating a fleet from scratch stays in the planet's Spaceport panel
  (CREATE FLEET). The fleet panel's DISBAND button (return a whole fleet to
  the stock) is unchanged and still works from anywhere while the faction owns
  a Spaceport.

**AI.** The service is faction-agnostic, but only the player's UI calls it.
AI fleets are organized by the AI pipeline (`EnemyInvasionService.mergeInto`,
`EnemyFleetService`); see [AI Pipeline](./ai-pipeline.md).

## Game time and other systems

- The game is **paused while the dialog is open** (`GameTimeService.pause`)
  and resumed on close only if it was running when the dialog opened. So
  fleets cannot drift apart, fight or be captured mid-edit, and every
  simulation system (movement, battle detection, AI, economy) sees only the
  finished result on the next frame.
- While the dialog is open, `StarMap.handleKeyboard` ignores map shortcuts
  (Space would otherwise unpause behind the dialog). The dialog handles
  Escape itself and stops it from reaching the pause menu.
- After a successful apply, StarMap keeps the selected fleet if it survived,
  otherwise it selects the first fleet of the new layout (the dialog lists
  the fleet it was opened from first). It then forces a sensor refresh,
  since ship ranges feed fleet sensor ranges, and writes the autosave.
- A rejected plan (the roster changed under the dialog) keeps the dialog
  open and shows `FleetOrganizationService.describeFailure`.
- Battle screen: fleets cannot be reorganized during a battle. The battle
  works on deep-cloned fleets and the dialog only exists on the star map.

## Save compatibility

No data model or save version change. Merged, split and retired fleets are
ordinary `Fleet` records that older code already reads. New fleets carry
exactly the fields Spaceport-created fleets carry. Saves from before this
feature load unchanged.

## UI

The fleet panel (galaxy map and system view) shows **ORGANIZE FLEETS** for
any player fleet with a living ship. Its second line says
"N fleets here · merge or split" when there is something to merge, or
"Split or rename" otherwise, plus "· reserve" at an own Spaceport, so the
action is discoverable without cluttering the map.

The **Fleet Command** dialog (`StarMapFleetManagerComponent`) is a modal
glass sheet titled with the location (star system name, or
`Deep space col:row`). It is loaded with `@defer` so it stays out of the
initial bundle.

- **Reserve column** (only at an own Spaceport, shown first, on a sunken
  surface): the stock grouped by class. It works like a fleet column (select,
  drag, "Return N ships to reserve" strip) but has no name, no fleet tools,
  stays visible when empty, and may be emptied into a new fleet. The header
  adds a Reserve figure, the footer "N from reserve" / "N to reserve" chips.
- **Fleet columns.** One column per fleet: editable name (reads as a title
  until focused), status chip (NEW / UNDER WAY), ship count, total ATK/DEF.
  Rows are ship classes, heaviest first, each with the class SVG icon
  (`ship-icons.ts`, the battle artwork, width growing with hull size, in the
  faction color), name, role, an average hull meter and the count.
- **Select, then send.** Clicking a row selects that class (default: all of
  its ships). A stepper, slider and 1 / All buttons pick how many. A
  selection belongs to one fleet and may span several classes. Every other
  fleet then shows a pulsing "Transfer N ships here" strip, and the
  **New fleet** slot forms a fleet from the selection. Moving a whole fleet
  into a new one would change nothing, so the slot is disabled for that.
- **Drag and drop** is a pointer shortcut for the same transfer: drag a row
  (or the current selection) onto a fleet column or the new-fleet slot.
  Every drag action also has a click path, for touch and keyboard use.
- **Shortcuts per fleet:** Select all, Gather here (shown with 2+ fleets:
  every other fleet's ships join this one), Split by class (one fleet per
  class, the heaviest class stays), Halve (half of every class, rounded
  down, into a new fleet; a fleet of single ships per class gives up its
  lighter half of classes).
- **Feedback.** The receiving column flashes. A fleet that loses its last
  ship disappears at once and shows up in the footer as "<name> dissolved",
  next to the reassigned-ships, new-fleet and renamed counts.
- **Apply / Reset / Cancel.** Apply is enabled only when something changed.
  Cancel (or Escape, or a backdrop click) asks "Discard these changes?"
  when the draft is dirty. Escape first clears an active selection.
- **Layout.** Columns flow in an auto-fill grid (min 290px) and stack on
  narrow screens. Only the board scrolls; header and footer stay in place.
  On a typical desktop a handful of fleets fit without scrolling.

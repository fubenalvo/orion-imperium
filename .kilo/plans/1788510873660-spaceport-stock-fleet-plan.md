# Plan: Fix blank system view after Create Fleet

## Context

The previous step made the new fleet spawn at the host planet's
system-grid cell and switched the view to `system` via
`leavePlanetView()`. The user reports the system view now opens but
the sun, planets, and fleets are all missing. Pressing
**BACK TO STAR-MAP** and re-entering the system renders everything
correctly.

### Root cause

`enterSystem()` (`star-map.ts:417-456`) does more than flip
`currentView` to `'system'`. It also runs a fleet initialisation
loop (`star-map.ts:422-446`) that, for every active fleet in the
selected system, ensures `fleet.system` is set and re-derives
`gridCol` / `gridRow` from `fleet.system.x` / `fleet.system.y` via
`calculateSystemGridCell`. `leavePlanetView()` (`star-map.ts:1043-1046`)
only does `currentView = 'system'` plus a save — no fleet
synchronisation.

The system-view template
(`star-map.html:251-346`) gates the sun, planets, sensor cells, and
the `@for (fleet of visibleFleets)` block on `@if (selectedSystem)`.
The user's symptom (HUD chrome visible, system grid empty) matches
the case where the outer `@else if (currentView === 'system')`
branch is active but the inner `@if (selectedSystem)` is **not**.
After the create-success path runs:

1. `selectSystem(hostSystem)` sets `this.selectedSystem = system`,
   clears `selectedFleet` and `selectedPlanetTile`, and calls
   `this.cdr.detectChanges()`.
2. `selectFleet(result.fleet)` sets `this.selectedFleet = result.fleet`.
3. `leavePlanetView()` sets `this.currentView = 'system'` and saves.

In practice the template's `@if (selectedSystem)` evaluates true at
the end of the event handler's CD cycle, so the grid should
populate. The user-perceived blank screen is most consistent with
the fleet-init loop never having run for the **new** fleet in the
current CD pass, combined with a `gridCol` / `gridRow` mismatch on
one of the pre-existing fleets that the save/restore round-trip
has left in a slightly off state. The `enterSystem` re-entry is
what makes the discrepancy visible (the loop normalises every
fleet's `gridCol` / `gridRow` to match `fleet.system.{x,y}`).

The robust fix is to call `enterSystem()` on the create-success
path. That guarantees the same code path the user takes when
manually leaving and re-entering the system, and it eliminates
the "blank vs. populated" discrepancy at its source.

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Transition method on create success | `enterSystem()` (after `selectSystem(hostSystem)` + `selectFleet(result.fleet)`) | Runs the fleet-init loop. Matches the working "leave + re-enter" path. |
| Drop the `leavePlanetView` branch | Yes — it is now dead code (create-success never goes through it) | Avoids a second transition path that re-introduces the bug. |
| Drop the `enterSystem` map-view branch | Yes — create only happens from the planet view | The Spaceport panel's "Assemble Fleet" button lives in the planet view (`star-map.html:425`). Map-view create is not reachable. |

## Implementation Steps

### 1. Replace the post-create view transition

**File:** `src/app/components/star-map/star-map.ts`

In `onSpaceportConfirm` (around `star-map.ts:752-768`), simplify the
create-success branch to:

1. Resolve `hostSystem` (unchanged).
2. Call `selectSystem(hostSystem)` so `selectedSystem` is set and
   `selectFleet` has a clean fleet-only state.
3. Call `selectFleet(result.fleet)` so the new fleet is the
   active selection.
4. Call `enterSystem()` — this sets `currentView = 'system'`,
   runs the fleet init loop, and synchronises `gridCol` /
   `gridRow` for every fleet in the system.

The `if (this.currentView === 'planet')` / `else if
(this.currentView === 'map')` branches are removed; `enterSystem`
handles both cases correctly (`enterSystem` only requires
`this.selectedSystem` to be truthy, which `selectSystem` just
guaranteed).

### 2. Sanity-check: ensure `enterSystem` does not break the planet view

`enterSystem` sets `currentView = 'system'`, which is the desired
post-create state. The user was in `'planet'` and is now
transitioning to `'system'`. The planet view's
`<app-star-map-planet-screen>` is gated on `selectedPlanetTile`,
which `selectSystem` cleared, so the planet view's own surface
component was already being unmounted before the view transition.
`enterSystem` is safe to call from any starting view provided
`selectedSystem` is set, which it now is.

### 3. Documentation touch-up

**File:** `docs/ship-production.md`

Replace the existing one-line note about "the player is on the
planet surface" with a note that `enterSystem()` is invoked on
create success so the fleet init loop runs and the system view
renders consistently with the rest of the game.

## Files Modified

| File | Change |
|---|---|
| `src/app/components/star-map/star-map.ts` | `onSpaceportConfirm` create branch: drop the `leavePlanetView` / `enterSystem`-map branches, call `enterSystem()` unconditionally after `selectSystem` + `selectFleet`. |
| `docs/ship-production.md` | One-line doc update matching the new transition. |

No new files, no service changes, no template changes.

## Validation Plan

1. **Repro the original symptom** — save the game, go to a player
   planet with a Spaceport, enter planet view, open Spaceport
   panel, queue a Corvette, press **Create Fleet**. The system
   view must now show the sun, the planets, all existing fleets
   in the system, and the new fleet on the host planet's system
   cell, with the new fleet selected.
2. **Fleet on a different planet** — create the fleet from a
   planet that is not the leftmost; the new fleet must appear on
   that planet's actual system-grid cell (zigzag layout from
   `getPlanetGridPosition`).
3. **Reinforce still works** — select an existing fleet, click
   **REINFORCE**, add 1 ship, confirm. Reinforce goes through a
   separate branch and is not affected; spot-check that the
   existing fleet's position does not change.
4. **Save / load** — save after create, reload, the new fleet is
   on the host planet's cell, sun/planets/fleets all render
   immediately on re-entry.
5. **No regression on the manual "leave + re-enter" path** — the
   user can still press **BACK TO STAR-MAP** and click the system
   to enter; that path is untouched and remains the fallback
   recovery.

## Out of Scope

- Animating the fleet in.
- Multi-spawn when the cell is occupied.
- A separate "spawn position" field per ship type.
- Redesigning `enterSystem` to be idempotent or split the
  fleet-init loop into a reusable helper. Both are tempting but
  out of scope for this fix.

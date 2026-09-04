# Plan: Fix blank screen after Create Fleet — real root cause

## Context

Two previous attempts to fix the blank-screen-after-Create-Fleet symptom
did not work. The actual root cause is a state-ordering bug in
`StarMap.onSpaceportConfirm`:

`selectFleet(fleet)` (`star-map.ts:968-…`) contains this guard:

```ts
if (this.currentView !== 'system') {
  this.selectedSystem = null;
}
```

It clears the selected system whenever a fleet is selected from a view
that is not the system view. The create-success path in
`onSpaceportConfirm` does:

1. `selectSystem(hostSystem)` — sets `selectedSystem`.
2. `selectFleet(result.fleet)` — at this point `currentView` is still
   `'planet'`, so the guard fires and `selectedSystem` is reset to
   `null`.
3. `enterSystem()` — its body is guarded by
   `if (this.selectedSystem)`, so it does nothing.

The net result: `currentView` stays `'planet'`, `selectedSystem` is
`null`, `selectedPlanetTile` is `null` (cleared by `selectSystem`).
The planet-view template branch renders, but its inner
`@if (selectedPlanetTile)` block (the actual planet surface) is
hidden, and `<app-star-map-planet-info>` (the planet details window)
is also hidden. The user is left looking at the empty planet-view
HUD chrome and concludes "the system view is blank".

When the user manually presses **BACK TO STAR-MAP**
(`leavePlanetView()` sets `currentView = 'system'`) and re-enters
(`enterSystem()` — now `selectedSystem` is set because the manual
`leaveSystem` → `selectSystem` on the galaxy map restored it), the
template renders correctly.

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Fix ordering in `onSpaceportConfirm` | Set `currentView = 'system'` before `selectFleet` | Avoids the `selectFleet` guard clearing `selectedSystem`. `enterSystem()` then becomes a no-op (its guard fails) but the view is already `'system'`, so we do not need its body. |
| Drop the `enterSystem()` call | Yes | With `currentView` already set and `selectSystem` already having set `selectedSystem`, the fleet-init loop is the only useful side-effect of `enterSystem`. We can run it explicitly to keep the symmetry with the manual re-entry path. |
| Run the fleet-init loop explicitly | Yes | Keeps `gridCol` / `gridRow` for every active fleet in the system synchronised with `fleet.system.{x,y}`. This is what `enterSystem` does and is what makes the manual re-entry path "fix" the view. |

## Implementation Steps

### 1. Reorder `onSpaceportConfirm` create-success branch

**File:** `src/app/components/star-map/star-map.ts`

In the `if (result.fleet) { ... }` block of `onSpaceportConfirm`
(`star-map.ts:752-766`), change the order so that `currentView` is
flipped to `'system'` **before** `selectFleet` is called. This avoids
the `selectFleet` guard clearing `selectedSystem`. The new order:

1. Resolve `hostSystem` from `event.systemId`.
2. `selectSystem(hostSystem)` — sets `selectedSystem`, clears
   `selectedPlanetTile` and any pre-existing `selectedFleet`.
3. `this.currentView = 'system'` — explicit view flip, runs first so
   the `selectFleet` guard sees `'system'`.
4. Run the fleet-init loop manually (the same loop from
   `enterSystem`, `star-map.ts:422-446`) for every active fleet whose
   galaxy cell matches `hostSystem`. This normalises
   `gridCol` / `gridRow` from `fleet.system.{x,y}`.
5. `selectFleet(result.fleet)` — now safe: `currentView === 'system'`
   so the guard does not clear `selectedSystem`.

Drop the standalone `enterSystem()` call: with the view already
flipped and the init loop run inline, `enterSystem` would be a
no-op (its `if (this.selectedSystem)` body would re-run the same
loop).

### 2. Extract the fleet-init loop into a private helper

**File:** `src/app/components/star-map/star-map.ts`

`enterSystem` and the new create-success path both need the
fleet-init loop. Extract it into `private initFleetsInSystem(system)`
to avoid duplication. `enterSystem` then calls
`this.initFleetsInSystem(this.selectedSystem)` instead of inlining
the loop.

This is a small refactor: move lines `422-446` of `enterSystem` into
the helper, then call the helper from both `enterSystem` and
`onSpaceportConfirm`.

### 3. Documentation touch-up

**File:** `docs/ship-production.md`

Update the existing "Fleet spawn position and view transition"
section to note that the create-success path sets
`currentView = 'system'` before selecting the new fleet, because
`selectFleet` clears `selectedSystem` when called from a non-system
view.

## Files Modified

| File | Change |
|---|---|
| `src/app/components/star-map/star-map.ts` | Reorder `onSpaceportConfirm` create-success branch; extract fleet-init loop into a private helper; have both `enterSystem` and the create-success path call it. |
| `docs/ship-production.md` | Document the ordering constraint. |

No new files, no service changes, no template changes.

## Validation Plan

1. **Repro the original symptom** — open planet view on a player
   planet with a Spaceport, open the Spaceport panel, queue a ship,
   press **Create Fleet**. The system view must render with the sun,
   the planets, the existing fleets, and the new fleet on the host
   planet's system cell.
2. **`selectSystem` / `selectFleet` ordering** — add a temporary
   `console.log` (or rely on the visual) to confirm `selectedSystem`
   is non-null immediately after `selectFleet` returns inside
   `onSpaceportConfirm`.
3. **Create from a non-first planet** — the new fleet must appear on
   that planet's actual system-grid cell.
4. **Save / load** — save after create, reload, the new fleet is on
   the host planet's cell, system view renders.
5. **No regression on the manual re-entry path** — leave + re-enter
   the system still works (now via the extracted helper).

## Out of Scope

- Fixing `selectFleet` to not clear `selectedSystem` (it is the
  correct behaviour when the user picks a fleet from the map view —
  the system selection is no longer relevant). The fix lives in
  the caller, not in `selectFleet`.
- Changing the visual transition (animation, fade).
- Multi-spawn when the cell is occupied.

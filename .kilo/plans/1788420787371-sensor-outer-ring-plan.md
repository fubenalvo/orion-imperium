# Plan: Make enemy fleets in the preview ring visible (faded)

## Goal

Enemy fleets in the outer-ring preview band of the player's sensor range (cells at Euclidean distance `(R, R+2]` from any player fleet or player-owned system) must become **visible** on the galaxy map, rendered with a **faded style** to signal reduced intel confidence. Today they are hidden by fog even though the cell they occupy is shown as a preview halo.

This applies to the **galaxy view only**. In the system view the existing rule already reveals every fleet in the player's current system.

Player fleets are not affected — they remain always visible at full opacity.

## Decisions resolved with the user

- **Visual treatment:** faded. A new `.fleet--preview` modifier class reduces the fleet icon's opacity to make the "faintly detected" intent obvious.
- **Scope:** galaxy view only. The system view already reveals all fleets in the selected system, so the preview band is irrelevant there.
- **Affects only enemy fleets.** A player fleet whose cell happens to be in another player fleet's preview band is not faded — that would be confusing for the owner.

## What is NOT changed

- `exploredGridCells` — preview cells still do not mark the cell as explored. The fleet appearing in a preview cell does not un-fog the cell.
- `getFleetSensorRange`, `getOuterRingCells`, `computeGalaxySensorCells` return shape — unchanged.
- `sensorRangeCells` / `sensorPreviewCells` content — unchanged.
- `isFleetVisible` semantics for the **full** range (full range still reveals enemy fleets at full opacity).
- The system-view enemy-fleet rule (already shows all fleets in the current system) — unchanged.
- Save schema: no new persisted fields.

## Files to modify

### 1. `src/app/components/star-map/star-map.ts`

#### a. `isFleetVisible` — accept both layers

Current signature returns based on `sensorRangeCells` only. Add an optional `previewCells` map parameter. If the fleet's cell is in either map, return `true`. Player fleets still short-circuit true.

```ts
/** Returns true if a fleet is visible to the player under fog-of-war rules. */
isFleetVisible(fleet: Fleet): boolean {
  if (fleet.factionId === 'player') {
    return true;
  }
  if (this.currentView === 'system' && this.selectedSystem && fleet.system?.id === this.selectedSystem.id) {
    return true;
  }
  const col = Math.floor(fleet.x);
  const row = Math.floor(fleet.y);
  const key = `${col}-${row}`;
  return this.sensorRangeCells.has(key) || this.sensorPreviewCells.has(key);
}
```

The method is called per fleet inside `visibleFleets` (line 241). `sensorPreviewCells` is already a class field kept in sync by `updateSensorVisibility`, so the closure has direct access.

#### b. New helper `isEnemyInPreview`

A fleet is in the preview band **only** if its cell is in `sensorPreviewCells` but NOT in `sensorRangeCells`. Used by the template to apply the faded modifier.

```ts
/** True if a fleet is detected in the preview ring (R+1..R+2) — not in the full sensor range. */
isEnemyInPreview(fleet: Fleet): boolean {
  if (fleet.factionId === 'player') return false;
  const col = Math.floor(fleet.x);
  const row = Math.floor(fleet.y);
  const key = `${col}-${row}`;
  return this.sensorPreviewCells.has(key) && !this.sensorRangeCells.has(key);
}
```

The `isFleetVisible` change above is enough on its own to make the fleet appear, but `isEnemyInPreview` is needed to attach the correct CSS class in the template.

### 2. `src/app/components/star-map/star-map.html`

In the galaxy-view fleet loop (currently around line 98-122), add a `[class.fleet--preview]` binding to the inner `<button class="fleet">` element:

```html
@for (fleet of visibleFleets; track fleet.id) {
  <div
    class="fleet-cell"
    [class.fleet-cell--preview]="isEnemyInPreview(fleet)"
    [style.left]="(fleet.x - 0.5) * cellSizeVw + 'vw'"
    [style.top]="(fleet.y - 0.5) * cellSizeVh + 'vw'"
    [attr.data-grid-position]="fleet.gridCol + '-' + fleet.gridRow"
  >
    <button
      class="fleet"
      [class.fleet--preview]="isEnemyInPreview(fleet)"
      ...
    >
```

Adding the modifier to both `.fleet-cell` and `.fleet` ensures the whole row (icon, name, border) fades uniformly, including any future child element.

The system-view fleet loop (line 274+) is unchanged — preview doesn't apply there.

### 3. `src/app/components/star-map/_star-map-ships.scss`

Append a single rule next to the existing `.fleet.arriced` block (currently line ~128):

```scss
.fleet--preview,
.fleet-cell--preview {
  opacity: 0.45;
  filter: grayscale(40%);
}
```

Opacity 0.45 + a light grayscale reads as "faintly detected" without making the icon unidentifiable. No animation; static fade is consistent with the static preview-cell fill (no pulse).

## Edge cases

- **Fleet moves from full range into preview range**: `sensorRangeCells.has(key)` becomes false, `sensorPreviewCells.has(key)` becomes true, `isFleetVisible` still true, `isEnemyInPreview` flips true → fleet becomes faded. Correct.
- **Fleet moves from preview range into unexplored**: both `has` checks return false → `isFleetVisible` returns false → fleet disappears. Correct.
- **Player fleet in another's preview band**: `isEnemyInPreview` short-circuits false on `fleet.factionId === 'player'`, so the modifier never applies. The fleet still appears (player fleets always visible). Correct.
- **Enemy fleet on the edge of one player source's full range and another's preview range**: `sensorRangeCells.has(key)` is true → `isEnemyInPreview` returns false → fleet at full opacity. Correct (the full range wins).
- **Sensor toggle off**: `visibleFleets` is still computed from the maps, but the preview cells are still rendered; the `isFleetVisible` change does not depend on `sensorRangeEnabled`. The toggle hides the cell highlights but does not hide enemy fleets. This matches the existing behavior — `visibleFleets` does not depend on `sensorRangeEnabled` either. **Note:** the user has not asked to gate this behind the toggle; behavior is identical to today's full-range fleet visibility, which also ignores the toggle. If desired, gating could be added later, but it would also need to apply to full-range fleets for consistency. Out of scope here.
- **Enemy fleet in a system-view (selected system)**: still always visible. Unchanged.
- **Save/load**: no new fields, no schema change.

## Validation

- Manual: place a player fleet, move an enemy fleet to a cell at distance R+1 or R+2 from the player fleet. Verify the enemy fleet icon is visible but faded. Move the enemy fleet into the full range — it should turn fully opaque. Move it back outside preview range — it should disappear.
- Manual: confirm player fleets in the preview band are not faded.
- Build: `npx ng build --configuration development` must complete without TS errors.
- No automated tests in the project.

## Open questions

None — both decisions are resolved.

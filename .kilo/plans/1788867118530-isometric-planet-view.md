# Isometric (45° rotated) planet surface view

## Goal
Give the explored planet surface a 45°-rotated (diamond / "isometric") visual
look while keeping **all interaction identical** (cell clicks, build-mode
preview, placement validation, resource-tile detection, building positioning).

This is a **visual-only** change. No grid logic, no coordinate math, and no
building/resource data model changes. Everything stays data-driven the same way.

## Context (verified in code)
- `star-map-planet-screen.component.html:16-53` — `.planet-surface` is one CSS
  grid: `grid-template-columns/rows = repeat(gridSize, 3vw)`. Cells use inline
  `[style.grid-column]="col+1"` / `[style.grid-row]="row+1"`. Buildings use
  `--building-x`, `--building-y`, `--building-size` (SCSS `:114-115`).
- `.planet-surface` also carries the background (planet color + noise + clouds
  `::before`/`::after` overlays) — SCSS `:15-76`.
- Clicks are bound directly on each cell with explicit `row`/`col`
  (`onCellClick(row,col)`), so a transform on the container does **not** change
  which logical cell is hit.
- TS logic (`updatePreview`, `overlaps`, `isResourceTile`, `confirmBuild`) works
  on `row/col`/`x/y` numbers — independent of rendering. Existing spec
  (`star-map-planet-screen.component.spec.ts`) covers this and needs no changes.
- Parent `.planet-view` is a flex column (`_star-map-planet-screen.scss:5`);
  `.planet-screen` already has `overflow: hidden` (`:10`).
- Codebase already uses `transform` + `will-change: transform` for rotations
  (`_star-map-system-view.scss`, `_star-map-base.scss:36`).

## Design choice (recommended)
Apply a **pure CSS `transform: rotate(45deg)` + `scale()`** to the grid content
only, keeping the background static. This is the literal "45 fokkal elforgatott"
look the user described.

### Why a CSS transform (not a re-projected grid)
- Zero risk to placement/validation/resource logic (data model untouched).
- Click hit-testing on a rotated grid container follows the rotated diamond
  geometry; since rotated square cells still tile edge-to-edge (rigid rotation
  preserves the tiling), every visible point maps to exactly one cell.
- Buildings stay aligned to their cell footprint automatically because they
  remain CSS-grid items of the same rotated grid.

### What to rotate
- **Cells**: rotate with the grid (diamond shapes, colored overlays, preview
  valid/invalid). No change to per-cell code.
- **Buildings**: rotate **with** the grid (sprites become isometric diamond
  tiles; this is the expected iso-tile aesthetic). Do **not** counter-rotate the
  building *box* — that would misalign multi-cell footprints.
- **Building labels**: counter-rotate **only the label text** (`rotate(-45deg)`)
  so names stay readable. Keep this behind a class so it can be tuned off.
- **Background** (planet color / noise / clouds): stay on the outer container,
  **unrotated**, so the "ground" tilts above a static starfield/sky.

### Out of scope (not done now)
- True dimetric/isometric skew (30°/150° rhombus) — different aesthetic, would
  require re-projecting cell + building positions. Leave for a future revisit.
- Swappable upright iso sprite assets — cosmetic follow-up, not needed for the
  45° rotation to function.

## Implementation steps

### 1. Template — add an inner grid wrapper
File: `star-map-planet-screen.component.html`

- Wrap the two `@for` blocks (cells `:22-41`, buildings `:43-53`) in a new
  element:
  ```html
  <div
    class="planet-surface__grid"
    [style.grid-template-columns]="gridTemplateColumns"
    [style.grid-template-rows]="gridTemplateColumns"
  >
    ...cells...
    ...buildings...
  </div>
  ```
- Remove `[style.grid-template-columns]` / `[style.grid-template-rows]` from
  `.planet-surface` (move to `.planet-surface__grid`). All `[style.grid-column]`
  on cells and `--building-*` vars on buildings are unchanged — they still
  position against the inner grid.
- No TS changes required: `gridTemplateColumns`, `gridCells`, `onCellClick`,
  `getBuildingTypeClass`, etc. all keep working unchanged.

### 2. SCSS — background stays outer, grid content rotates
File: `star-map-planet-screen.component.scss`

- `.planet-surface`: keep all background/noise/clouds/overlays. Change it from
  `display:grid` to a positioning/sizing container:
  - add `overflow: hidden;` (clips the rotated diamond corners — desired crop)
  - remove `display: grid` / `gap` / `justify-content` / `align-content` /
    `grid-template-*` (moved to inner)
  - keep `position: relative; flex:1; min-width:0;`
- New `.planet-surface__grid`:
  - `display: grid;` (same as old `.planet-surface` grid rules)
  - copy `gap`, `justify-content`, `align-content` from old `.planet-surface`
  - full size: `width:100%; height:100%;`
  - the rotation:
    ```scss
    transform: rotate(45deg) scale(var(--planet-grid-scale, 0.7071));
    transform-origin: center;
    will-change: transform;
    ```
- `.planet-surface__building-name` (the label, `:203-219`): wrap with a
  toggleable class so it can be counter-rotated for readability:
  ```scss
  .planet-surface__building--iso .planet-surface__building-name {
    transform: rotate(-45deg);
    transform-origin: center;
  }
  ```
  (The `--iso` class toggles label readability independently of the grid tilt.)

### 3. Scale tuning (no code — empirical)
- `scale(0.7071)` = `1/sqrt(2)` = cos(45°): makes the rotated diamond's bounding
  box match the pre-rotation square, so it fits without clipping mid-cell.
- Because the grid uses a `0.5vw` gap and is content-centered, the real fit value
  is slightly less; tune `--planet-grid-scale` (try `0.69`) until the diamond
  cleanly fills the panel with no cell cut in half.
- `overflow: hidden` on `.planet-surface` crops the four corner triangles that
  inevitably appear when rotating a square grid — this is the desired "diamond
  window" crop.

### 4. Optional toggle (recommended, keeps it safe/rollable)
- Add `@Input() isometric = true;` to the component (default `true` → visible
  immediately; trivial to flip to `false` to revert).
- In the template, bind the grid wrapper class:
  `[class.planet-surface__grid--isometric]="isometric"` and wire the building
  label counter-rotation class similarly.
- No parent (`star-map.html`) change is required because the input defaults on.
  A runtime hotkey in `star-map.ts` can be added later if desired (out of scope).

## Risks & edge cases
- **Hit testing on rotated grid**: confirmed modern browsers test against the
  rotated geometry; rotated square cells tile as diamonds with no gaps, so every
  click lands on exactly one cell. (If a browser ever uses the un-rotated box,
  the worst case is a slightly larger click target — still correct cell.)
- **Odd grid sizes (5/7/9/11)**: grids are square and content-centered, so the
  diamond fits symmetrically. No per-size handling needed.
- **Building sprites rotated 45°**: pixel-art sprites will be transformed (may
  blur under default `image-rendering`). Acceptable for the first pass; can be
  mitigated with `image-rendering: -webkit-optimize-contrast` or iso sprites
  later.
- **Cloud animation** (`@keyframes cloud-scroll`, `:78-86`): stays on the outer,
  unrotated container — cloud motion remains horizontal. No change needed.
- **`min-width:0`/`overflow`** on `.planet-screen` parent already prevent flex
  spill; keep them.

## Validation
- Manual: open planet view, confirm grid renders as a centered diamond; click
  cells in build mode, place a mining complex, verify preview validity + resource
  proximity + overlap checks behave exactly as before.
- No behavioral tests break: `isResourceTile`, `updatePreview`, `confirmBuild`
  specs are coordinate/logic only and are untouched.
- Optionally add a light structural assertion: the `.planet-surface__grid`
  wrapper exists and buildings still render with their `--building-*` vars
  intact (no layout regression).

## Summary of files touched
- `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html`
- `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss`
- (optional) `...component.ts` — add `@Input() isometric = true;` + class binding

No model/service/logic files change. Functionality preserved.

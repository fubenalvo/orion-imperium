# Grid Size Responsive Parameterization Plan

## Goal

Make the galaxy map grid size responsive:
- Viewport width ≥ 1300px → `cellSizeVw = 2`, `cellSizeVh = 2`
- Viewport width < 1300px → `cellSizeVw = 5`, `cellSizeVh = 5`

All existing parameterizations (TS → CSS custom property → SCSS) remain in place; the only new piece is a runtime resize listener that updates the two TS values, which then flows through the existing binding chain.

## Current State

Parameterization is already partially done from the previous step:

| Layer | Status |
|-------|--------|
| `star-map-data.json` | Default value set to `2` |
| `star-map.ts` `clampCamera()` | Uses `this.cellSizeVw` / `this.cellSizeVh` |
| `star-map.html` | CSS custom property `--cell-size-vw` bound to `cellSizeVw`; grid templates bound to `cellSizeVw`/`cellSizeVh` |
| `_star-map-grid.scss` | `.system-cell` uses `var(--cell-size-vw, 5vw)` |
| `_star-map-base.scss` | `.map-world` background-size uses the variable |
| `_star-map-ships.scss` | `.ship-target` uses the variable |

**What is still missing for responsiveness:**
- `cellSizeVw` / `cellSizeVh` are declared `readonly`, so they cannot change after init.
- No resize listener or media-query detection exists.

## Changes Required

### 1. `star-map.ts`

**1a.** Remove `readonly` from `cellSizeVw` / `cellSizeVh` (line ~96):

```typescript
// Before
readonly cellSizeVw = initialStarMapData.map.cellSizeVw;
readonly cellSizeVh = initialStarMapData.map.cellSizeVh;

// After
cellSizeVw = initialStarMapData.map.cellSizeVw;
cellSizeVh = initialStarMapData.map.cellSizeVh;
```

**1b.** Add a breakpoint constant and a resize listener:

```typescript
private readonly gridBreakpointPx = 1300;

@HostListener('window:resize')
private onResize(): void {
  const isWide = window.innerWidth >= this.gridBreakpointPx;
  this.cellSizeVw = isWide ? 2 : 5;
  this.cellSizeVh = isWide ? 2 : 5;
}
```

**1c.** Call `onResize()` once in `ngOnInit()` (or the constructor) so the correct value is set on first load, not just after the first resize event.

### 2. No other files need changes

The existing template bindings and SCSS custom-property references automatically pick up the new values. The CSS fallback `5vw` continues to work if the variable is unset.

## Out of Scope

### `_star-map-system-view.scss`

The system view has its own hardcoded `5vw` grid (lines 64–65, 69). This is a separate 20×12 grid for the star-system zoom. Changing it is a separate visual-design decision and is **not** part of this responsive galaxy-map task.

## Validation Steps

1. Resize the browser window across the 1300px breakpoint and verify that grid cells, background pattern, and ship-target indicators visibly change size.
2. Verify `clampCamera()` still prevents scrolling past map edges at both sizes.
3. Verify fleets and systems stay aligned to grid cells after resize.
4. Verify old saves (with `cellSizeVw: 5`) load correctly; the resize listener immediately overwrites the loaded value to match the current viewport, so visual state stays consistent.
5. Test that rapid resizing does not cause errors or stale bindings.

## Future Configurability

- To change the breakpoint: edit `gridBreakpointPx` in `star-map.ts`.
- To change the cell sizes at each breakpoint: edit the `2` / `5` values in `onResize()`.
- The JSON default (`cellSizeVw: 2`) is only the initial value before the first resize fires; the runtime listener takes over immediately.

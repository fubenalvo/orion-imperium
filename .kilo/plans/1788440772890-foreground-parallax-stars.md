# Foreground Parallax Stars Layer

## Goal

Add a `stars.png` foreground layer to the Star Map component that moves with parallax (faster than the map), tiles/repeats, and uses `pointer-events: none` via CSS. Uses `background-position` for movement (not inline `left`/`top`/`width`/`height` bindings) to avoid layout thrashing during drag.

## Context

- `public/stars.png` (34 KB, added 2026-09-03) — available at `/stars.png`.
- The existing **background** layer (`.star-map-background`, `_star-map-base.scss:19-37`) uses Angular inline styles for `width`/`height`/`left`/`top` (all in `vw`, sized to 200% of the map grid) plus `[style.transform]` with parallax multiplier `0.3`.
- `.map-viewport` (`z-index: 1`) sits above both background and foreground; game content (fog cells, systems, fleets) is inside it.
- **Root cause of lag**: `onPointerMove` (`star-map.ts:1175-1192`) calls `cdr.detectChanges()` on every `pointermove`. Angular evaluates all inline style bindings (`[style.width.vw]`, `[style.height.vw]`, `[style.left.vw]`, `[style.top.vw]`, `[style.transform]`) each frame, and `left`/`top` changes trigger layout reflow. The fix is to eliminate position/size bindings entirely — use CSS `inset: 0` for full-viewport coverage and drive parallax via a single `backgroundPosition` binding.
- The planet-screen component (`star-map-planet-screen.component.scss:65`) uses `background-repeat: repeat` with `vw`-based `background-size` for tiled textures — this is the established pattern to follow.
- Partial SCSS files are `@Use`d from `star-map.scss`.

## Design Decisions

1. **Parallax multiplier**: `1.2` for the foreground (vs `0.3` for the background, `1.0` for game content). The user explicitly wants the foreground stars to move **faster than the map** ("még többet mozogjanak, többet mint a térkép"). Multiplier `> 1.0` gives a "speeding past" foreground layer. Hardcoded in the template, matching the background's approach with `0.3`.

2. **Movement via `background-position`**: Instead of `transform: translate(-cameraX * factor, -cameraY * factor)`, use `[style.backgroundPosition]` to shift the repeating star tile origin. `background-position: (-cameraX * 1.2)vw (-cameraY * 1.2)vw` produces the same visual parallax (stars shift opposite to camera direction) but with a single Angular binding instead of 5, eliminating layout thrashing from `left`/`top` property changes.

3. **No inline dimension bindings**: Use CSS `position: absolute; inset: 0` to make the foreground div cover the full `.star-map` container. Since `stars.png` repeats (`background-repeat: repeat`), the tile fills the viewport at any `background-position` — no need for the 200%-of-map-grid sizing that the non-repeating background JPG requires.

4. **No CSS transition**: A `transition: transform 20ms linear` was tested but removed — it caused perceived lag because on continuously-updated properties (every `pointermove` frame) the transition constantly restarts, creating a "stretchy" feel. Instead use `will-change: transform` purely as a GPU-layer-promotion hint (common pattern for animating paint properties efficiently on a composite layer).

5. **Parallax direction**: `background-position: (-cameraX * 1.2)vw (-cameraY * 1.2)vw` — when cameraX increases (camera moves right), the negative background-position shifts the star tile grid left, matching the background's `translate(-cameraX * 0.3)` behavior. Both layers move opposite to camera, with the foreground at 1.2× and background at 0.3×.

6. **z-index**: `z-index: 0` — same stacking context as the background, placed after it in DOM order so it renders on top of the background. `.map-viewport` (z-index: 1) stays above it. Foreground stars are a visible parallax layer between the background and game content.

7. **Tiling / background-size**: `background-repeat: repeat` with `background-size: 100vw` (each tile = viewport width), following the `vw`-based sizing pattern from the planet-screen component. **Adjustable** based on desired star density.

8. **pointer-events**: `none` in the CSS rule (not inline), as requested.

## Changes

### 1. `src/app/components/star-map/star-map.html`

Replace the existing `.star-map-foreground` div (lines 34-41) with a simplified version that removes all inline `width`/`height`/`left`/`top`/`transform` bindings and uses a single `backgroundPosition` binding:

```html
<div
  class="star-map-foreground"
  [style.backgroundPosition]="(-cameraX * 1.2) + 'vw ' + (-cameraY * 1.2) + 'vw'"
></div>
```

### 2. `src/app/components/star-map/_star-map-base.scss`

Update the `.star-map-foreground` rule (currently lines 39-59) — replace inline-dimension comment with `inset: 0`, change `background-position: center` to `background-position: 0 0` (dynamic override), and keep `will-change: transform` as a layer-promotion hint:

```scss
.star-map-foreground {
  position: absolute;

  /* No inline width/height/left/top bindings — the div covers the full
     container via inset: 0. Since stars.png repeats, the tile fills
     the viewport at any background-position, so no 200%-sizing hack
     is needed (unlike the non-repeating background JPG). */

  inset: 0;

  background-image: url('/stars.png');

  background-repeat: repeat;

  background-size: 100vw;

  background-position: 0 0;

  pointer-events: none;

  z-index: 0;

  will-change: transform;
}
```

### 3. `src/app/components/star-map/star-map.ts`

No changes required. The existing `cameraX` / `cameraY` properties are reused. The `bgWidthVw` / `bgHeightVw` / `bgLeftVw` / `bgTopVw` getters are no longer used by the foreground div but are still needed by `.star-map-background`. The foreground parallax multiplier (`1.2`) is hardcoded in the template, matching the background's approach with `0.3`.

## Validation

1. **Build**: Run `npm run build` to verify no compilation errors.
2. **Visual**: `stars.png` foreground appears as a tiled layer above the background, moving at 1.2× camera speed (faster than the map's 1.0× and the background's 0.3×) when the camera pans.
3. **Drag fluidity**: Click and drag to pan — no perceived lag or stutter. The `background-position` binding updates smoothly with `will-change: transform` GPU-layer promotion.
4. **Pointer events**: Panning, system/fleet clicks work normally — the foreground doesn't block interactions (`pointer-events: none`).
5. **Edge coverage**: Pan to map edges — foreground stars remain visually continuous (no empty space) because the image repeats.

## Risks / Notes

- `background-size: 100vw` is a starting point; adjust if `stars.png` resolution produces too dense/sparse a tile.
- Angular emulated view encapsulation scopes `_star-map-base.scss` via `@Use` in `star-map.scss`, so `.star-map-foreground` is correctly scoped.
- The foreground div is always present in the DOM, matching the background.
- `will-change: transform` is used as a GPU-layer-promotion hint even though `transform` is not the animated property — this is a well-known optimization for paint-heavy animations on composite layers.
- The background layer (`.star-map-background`) still uses inline `width`/`height`/`left`/`top` bindings. It could benefit from the same `inset: 0` + `background-position` refactor if further performance improvement is needed, but is out of scope for this change.

## Iteration History

- **v1**: Multiplier `0.7`, `transform` + inline dimension bindings, no transition. User: "darabos" (choppy).
- **v2**: Added `transition: transform 20ms linear`, multiplier `0.85`. User: "még többet mozogjanak, többet mint a térkép" + "még mindig laggos érzésű" + "transition milyen rajta?"
- **v3**: Multiplier `1.2`, removed transition. User: "style.left, top, stb-t tologatsz. ez laggolni fog. helyette a background position legyen tologatva" (root cause: layout thrashing from inline left/top bindings).
- **v4 (current)**: Multiplier `1.2`, single `backgroundPosition` binding, CSS `inset: 0`, no transition, `will-change: transform` as GPU-layer hint.

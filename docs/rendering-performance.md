# Rendering performance (phones)

The game runs in mobile browsers on landscape phones (≈844×390 CSS px at a
device pixel ratio of 3). There, the GPU raster and compositing budget is
what limits the frame rate, not JavaScript. When it is exceeded, Chrome shows
missing tiles for a frame, which players see as flicker. This happened while
dragging the star map with a finger and when the research dialog was open
over the planet view. This file lists the rules that fixed it and that new
rendering code must keep. See [UI Styling](./ui-styling.md) for the visual
design and [Star Map Terrain](./star-map-terrain.md) for the terrain layers.

## How it was measured (2026-11-10)

Chrome traces taken with Playwright in a phone-sized viewport (844×390,
deviceScaleFactor 3, touch) against the dev server:

- `devtools.timeline` totals (raster, style recalculation, layerize) while
  idle and during a scripted touch drag (`Input.dispatchTouchEvent`);
- `disabled-by-default-devtools.timeline.invalidationTracking` to see which
  element invalidates style or paint every frame;
- `LayerTree` compositing reasons to see which elements become their own GPU
  layer and why;
- disabling one group of animations at a time to find the per-frame painter.

Desktop timings (relative, 2 s drag) before → after: raster 1213 → ~430 ms,
style recalc 1334 → ~150 ms, layerize 534 → ~90 ms. In the idle planet view,
raster went from 766 ms to ~0. With research open over the planet view,
raster went from 1721 ms to ~390 ms, and what is left is the one-time raster
of the dialog. World-sized GPU layers on the map went from 6 to 3.

## Rules

1. **Animate only `transform` and `opacity`, on few elements.**
   `background-position`, `box-shadow`, `left` / `top`, `width` / `height`
   and SVG-internal animations repaint every frame. Moving or scrolling
   layers use a wrapped `translate3d` on an element oversized by one tile:
   - the star texture, dust and nebula field (`StarMap.starTextureTransform`,
     `dustTransform`, `SpaceNebulaFieldComponent`);
   - the planet weather and atmosphere clouds;
   - map fleets, drifting asteroids and traders, whose position is an inline
     `translate3d`;
   - trails, whose start point is in `getTrailTransform` and whose dashes
     move on `::after`.
2. **One animated layer instead of many animated elements.** The sensor range
   cells pulse as one `.sensor-field` layer, and the ore glows as one SVG
   (`.planet-surface__ore-layer`). Hundreds of individually animated cells
   each became a GPU layer.
3. **Nothing animated or composited under a world-sized static layer.**
   Chrome promotes every later element that overlaps a composited one
   ("Overlap"). On the galaxy map:
   - the static, world-sized layers (nebula, territory, belts) sit at z 2;
   - star systems sit at z 3, and every animated or moving object above
     that;
   - the fog is an `<img>` filled from a hidden canvas, because a visible
     canvas is always composited;
   - the nebula layer keeps one layer of its own on purpose (`will-change`),
     because its SVG is expensive to rasterize.
4. **No `mix-blend-mode` or `backdrop-filter` where it does nothing.**
   `.map-world` is an isolated group, so `screen` inside it only blended
   with transparency. Panels and modal backdrops use no blur (see
   `ui.glass` / `ui.backdrop` in `styles/_ui.scss`).
5. **Freeze what is hidden.** While a full-screen dialog is open
   (`StarMap.sceneCovered`: research, diplomacy, ship customization, fleet
   manager), `.star-map--covered` pauses the animations of the backdrop and
   the current view.
6. **Mouse-only decoration.** The primary button's breathing glow
   (`box-shadow`) runs only on `(hover: hover) and (pointer: fine)`.
7. **At most one camera update per frame.** A map drag stores the last
   pointer position and applies it in `requestAnimationFrame`
   (`StarMap.onPointerMove` / `applyPendingDrag`). Touch screens send more
   pointer events than frames, and each update runs change detection for
   the whole star map.

## Known remaining costs

- The star coronas and spikes (two `transform` + `opacity` animations per
  star system) and the black hole parts animate on the compositor. They are
  cheap per element, but every one is a layer.
- The planet weather layers carry CSS filters (`brightness`, `blur`) over
  oversized layers. They no longer repaint, but the filters still cost GPU
  time every frame on phones.
- The fog image and the territory layer are still promoted by overlap (3
  world-sized layers in total with the nebula).

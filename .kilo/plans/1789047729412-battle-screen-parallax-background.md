# Battle screen parallax starfield background

## Goal
Add a mouse- and motion-driven multi-layer starfield parallax background to the battle screen, visually matching the star map's deep-space background but simplified for the fixed tactical viewport.

## Constraints & decisions
- **Assets**: Reuse existing `public/stars-background-a.jpg` (deep layer) and `public/stars.png` (foreground). No new image assets.
- **Layers** (mirror star map pattern):
  - `.battle-bg-deep` — non-repeating JPG, `200vw × 200vh`, centered (`left: -50vw; top: -50vh`), slow parallax (`0.3×` via `transform`).
  - `.battle-bg-foreground` — repeating PNG tile, `inset: 0`, faster parallax (`0.15×` via `transform`), `opacity: 0.5`.
- **Centering / overflow**: Deep layer is oversized by exactly one screen in every direction so maximum parallax shift never exposes empty space.
- **Input — desktop**: `mousemove` over `.battle-screen`. Offset is normalized mouse position relative to viewport center (`(clientX / innerWidth - 0.5) * 2` → `-1..1`). Recenter on `mouseleave`.
- **Input — mobile**: `deviceorientation` event. Normalize `gamma` → X offset and `beta` → Y offset. iOS 13+ requires `DeviceOrientationEvent.requestPermission()` triggered by a user gesture; fall back gracefully if unavailable or denied.
- **No drag mechanic**: Unlike the star map, this is purely position-driven (mouse / tilt), not click-drag.
- **Z-index / stacking**:
  - Deep bg: `z-index: 0`
  - Foreground: `z-index: 3`
  - All existing UI content wrapped in `.battle-screen__ui` with `position: relative; z-index: 10` so it reliably paints above the absolute-positioned background layers.

## Files to modify
1. `src/app/components/battle-screen/battle-screen.component.html`
2. `src/app/components/battle-screen/battle-screen.component.scss`
3. `src/app/components/battle-screen/battle-screen.component.ts`

## Implementation steps

### 1. SCSS — background layers and UI wrapper
- Remove `background: #020609` from `.battle-screen` (deep layer becomes the effective background).
- Add `.battle-bg-deep`:
  - `position: absolute`
  - `width: 200vw; height: 200vh; left: -50vw; top: -50vh`
  - `background-image: url('stars-background-a.jpg')`
  - `background-size: 200vw`
  - `background-position: center`
  - `z-index: 0`
  - `will-change: transform`
  - `pointer-events: none`
- Add `.battle-bg-foreground`:
  - `position: absolute; inset: 0`
  - `background-image: url('stars.png')`
  - `background-repeat: repeat`
  - `background-size: 100vw`
  - `opacity: 0.5`
  - `z-index: 3`
  - `will-change: transform`
  - `pointer-events: none`
- Add `.battle-screen__ui`:
  - `position: relative; z-index: 10`
  - keep existing flex layout behavior (children remain flex items inside this wrapper)

### 2. Template — insert layers and wrap content
- Insert the two background `<div>`s as the first children of `.battle-screen`.
- Wrap the entire `@if (battleState) { ... } @else { ... }` block (all existing UI) in a single `<div class="battle-screen__ui">`.
- Bind layer transforms to component getters:
  ```html
  <div class="battle-bg-deep" [style.transform]="bgDeepTransform"></div>
  <div class="battle-bg-foreground" [style.transform]="bgForegroundTransform"></div>
  <div class="battle-screen__ui">
    <!-- existing content unchanged -->
  </div>
  ```

### 3. TS — mouse tracking, device orientation, and transform math
- Inject `ElementRef` and `Renderer2` (or use native `addEventListener`/`removeEventListener` directly on `window`/element).
- Add state:
  - `pointerX = 0.5` (normalized 0..1)
  - `pointerY = 0.5`
  - `motionEnabled = false`
  - `motionPermissionRequested = false`
- Add getters:
  - `bgDeepTransform`: `translate(${offsetX * 5}vw, ${offsetY * 5}vh)` where `offsetX = (pointerX - 0.5) * 2`, `offsetY = (pointerY - 0.5) * 2`, factor `5`.
  - `bgForegroundTransform`: same math with factor `2.5` (half of deep layer for subtle depth).
  - Tune factors if needed; start conservative.
- Add handlers:
  - `onMouseMove(event)`: `pointerX = event.clientX / window.innerWidth`, `pointerY = event.clientY / window.innerHeight`. Clamp to `[0, 1]`.
  - `onMouseLeave()`: `pointerX = 0.5; pointerY = 0.5`.
  - `onDeviceOrientation(event)`: if `motionEnabled`, map `event.gamma` (-90..90) to `pointerX` and `event.beta` (-180..180, clamped -45..45) to `pointerY`.
  - `onFirstInteraction()`: if `typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'` and not yet requested, call `requestPermission()`. On `'granted'`, add `deviceorientation` listener and set `motionEnabled = true`.
- Lifecycle:
  - `ngOnInit`: add `mousemove` and `mouseleave` listeners on the host element.
  - `ngOnDestroy`: remove all listeners.
- Performance: use `Renderer2` for listener management to stay framework-idiomatic, or direct DOM APIs if Renderer2 makes the code overly verbose.

## Validation
- Desktop: open battle screen, move mouse to corners — deep and foreground star layers shift in the same direction at different rates. Center = neutral. Leave window = recenter.
- Mobile (or DevTools device emulation with sensor simulation): tilt device — layers respond to tilt. If permission denied or sensor absent, background remains centered (no crash).
- Z-index: grid, stacks, headers, buttons, and effects remain fully visible and clickable above the background layers.
- Performance: no jank during mouse move or animation playback.

## Edge cases & risks
- iOS permission denial: background stays centered; battle remains fully playable.
- `deviceorientation` not available: feature-detected; no errors.
- Resize: mouse-driven offsets are fraction-based, so they remain correct on resize. Tilt values may need re-normalization on resize (minor).
- `stars-background-a.jpg` and `stars.png` are already listed in `angular.json` `externalDependencies` and served from `public/`, so no build-config changes are needed.

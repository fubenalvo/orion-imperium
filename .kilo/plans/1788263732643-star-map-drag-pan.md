# Star Map Drag/Pan Implementation Plan

## Goal

Enable dragging the star map with mouse and touch on empty map areas, using the same clamp rules as the existing camera system (`clampCamera()`).

## Scope

- Add pointer-based drag/pan to `.map-viewport` (empty areas only — not on fleets, star systems, or other interactive elements)
- Unified mouse + touch via Pointer Events API
- Reuse existing `cameraX`/`cameraY` state and `clampCamera()` method
- Distinguish click (fleet targeting via `onMapClick`) from drag (panning)

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/star-map/star-map.ts` | Add pointer event handlers, drag state tracking, CSS class toggling |
| `src/app/components/star-map/star-map.html` | Add event bindings to `.map-viewport` |
| `src/app/components/star-map/_star-map-base.scss` | Add `touch-action: none`, `.dragging` class, `user-select: none` |

## Implementation Steps

### 1. Add drag state properties to `StarMap` component (`star-map.ts`)

Add new class properties:

```ts
// Drag/pan state
private isDragging = false
private dragStartX = 0
private dragStartY = 0
private dragCameraStartX = 0
private dragCameraStartY = 0
private dragMoved = false
private readonly dragThreshold = 5 // px — movement below this counts as a click
```

### 2. Add pointer event handlers (`star-map.ts`)

Add three methods:

**`onPointerDown(event: PointerEvent)`** — Start drag tracking:
- Only initiate if `event.target` is the `.map-viewport` element itself (not a child). Check: `event.currentTarget === event.target` or verify `event.target` has class `map-viewport`.
- Capture the pointer (`event.currentTarget.setPointerCapture(event.pointerId)`) for reliable tracking even if pointer leaves the element.
- Record `dragStartX/Y = event.clientX/Y`, `dragCameraStartX/Y = cameraX/Y`, `dragMoved = false`, `isDragging = true`.
- Add `.dragging` class to `.map-viewport` (to disable CSS transition during drag).

**`onPointerMove(event: PointerEvent)`** — Update camera during drag:
- Only act if `isDragging === true`.
- Calculate pixel delta: `deltaX = event.clientX - dragStartX`, `deltaY = event.clientY - dragStartY`.
- If `Math.abs(deltaX) + Math.abs(deltaY) > dragThreshold`, set `dragMoved = true`.
- Convert pixel delta to vw: `vwDeltaX = deltaX / (window.innerWidth / 100)`.
- Set `cameraX = dragCameraStartX - vwDeltaX`, `cameraY = dragCameraStartY - vwDeltaY`.
- Call `clampCamera()`.

**`onPointerUp(event: PointerEvent)`** — End drag:
- If `isDragging` is false, return.
- Release pointer capture (`event.currentTarget.releasePointerCapture(event.pointerId)`).
- Remove `.dragging` class from `.map-viewport`.
- Reset `isDragging = false`.
- If `dragMoved` is false, treat as click: manually call `onMapClick(event)` so fleet targeting still works on tap without movement.

### 3. Register/unregister event listeners (`star-map.ts`)

Use `@ViewChild` to get a reference to the viewport element, then attach/detach listeners in lifecycle hooks:

```ts
@ViewChild('mapViewport') mapViewport!: ElementRef<HTMLDivElement>
```

In `ngAfterViewInit()` (after the existing game loop start):
```ts
const vp = this.mapViewport.nativeElement
vp.addEventListener('pointerdown', this.onPointerDown)
vp.addEventListener('pointermove', this.onPointerMove)
vp.addEventListener('pointerup', this.onPointerUp)
vp.addEventListener('pointercancel', this.onPointerUp)
```

Store bound handler references (or use arrow functions) so they can be removed in `ngOnDestroy()`.

### 4. Update template (`star-map.html`)

Add a template reference and convert methods to be bound for `addEventListener`:

Modify line 36:
```html
<div #mapViewport class="map-viewport" (click)="onMapClick($event)">
```

The pointer events are attached programmatically in `ngAfterViewInit`, so no template bindings needed for them.

### 5. Update styles (`_star-map-base.scss`)

Add to `.map-viewport`:
```scss
touch-action: none;       /* Prevent browser scroll/zoom on touch drag */
user-select: none;        /* Prevent text selection during drag */
cursor: grab;             /* Visual affordance */
```

Add a `.dragging` class:
```scss
.map-viewport.dragging {
  cursor: grabbing;

  .map-world {
    transition: none;     /* Disable 100ms transition for instant drag feedback */
  }
}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Pointer Events API** | Unified mouse + touch handling with a single code path. Supported in all modern browsers. |
| **Drag only on empty areas** | `event.target === event.currentTarget` check ensures clicks on fleets/systems still trigger their existing `(click)` handlers. |
| **5px threshold** | Prevents accidental drag classification from shaky clicks; preserves `onMapClick` fleet targeting. |
| **Pointer capture** | Ensures drag continues even if pointer briefly leaves the viewport (common on fast swipes). |
| **Disable transition during drag** | The existing `transition: transform 100ms linear` on `.map-world` would cause lag/jitter during direct manipulation. |
| **`touch-action: none`** | Prevents browser-default behaviors (scroll, pinch-zoom, overscroll) from interfering with map panning. |
| **Reuse `clampCamera()`** | Same bounds as arrow keys and navigation buttons — no duplicate logic. |

## Edge Cases

- **Resize during drag**: `onResize()` already calls `clampCamera()`, so bounds stay correct.
- **Pointer cancel** (e.g., system gesture on mobile): Treated same as pointer up — drag ends cleanly.
- **Navigation button overlap**: Navigation component is positioned `fixed` with `z-index: 30`, above the viewport (`z-index: 1`). Pointer events on nav buttons won't reach the viewport. No conflict.
- **Context menu open**: `onMapClick` already checks `this.contextMenu` first. Drag should probably also be disabled when context menu is open — add an early return in `onPointerDown` if `this.contextMenu` is truthy.
- **System view**: The `.map-viewport` only exists in map view (wrapped in `@if (currentView === 'map')`), so drag is naturally scoped to the galaxy map.

## Validation

1. **Desktop**: Click and drag on empty map area → camera follows cursor, clamped at edges.
2. **Desktop**: Click on fleet/star system → no drag, existing click behavior preserved.
3. **Touch**: Single-finger drag on empty area → camera follows, no page scroll.
4. **Touch**: Tap on fleet/star system → existing click behavior preserved.
5. **Edge**: Drag to map boundary → camera stops at edge (same as nav button held to edge).
6. **Edge**: Resize window during/after drag → camera re-clamped correctly.
7. **Edge**: Open context menu → drag disabled, right-click menu works.
8. **Navigation buttons**: Still work alongside drag (no interference).

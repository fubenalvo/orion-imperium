# Fix: Pointer Drag Stops Working After Returning from System View

## Root Cause

In `src/app/components/star-map/star-map.html:41`, the `#mapViewport` reference lives inside an `@if (currentView === 'map')` block. When the player enters the system view, Angular destroys that `<div class="map-viewport">` element along with its listeners. When the player returns to the map view, a **new** `.map-viewport` element is created, but `setupDragHandlers()` in `src/app/components/star-map/star-map.ts:1224` was only ever called once from `ngAfterViewInit()` (line 1220), where it attached `pointerdown`/`pointermove`/`pointerup`/`pointercancel` listeners to the now-removed element.

Result: the new `.map-viewport` has no pointer listeners → both touch drag and mouse drag silently stop working until the page is reloaded.

The same issue exists for `onMapClick` if it relied on the viewport click binding — but `(click)="onMapClick($event)"` is a template binding (line 41), so Angular re-binds it automatically. The drag handlers are the only manual `addEventListener` calls, and they are the only thing that breaks.

## Fix

Switch the manual `addEventListener` calls to Angular template event bindings on `<div #mapViewport>` so Angular reattaches them automatically whenever the `@if` recreates the element.

### Changes

**`src/app/components/star-map/star-map.html` (line 41)**

Replace:

```html
<div #mapViewport class="map-viewport" (click)="onMapClick($event)">
```

with:

```html
<div
  #mapViewport
  class="map-viewport"
  (click)="onMapClick($event)"
  (pointerdown)="onPointerDown($event)"
  (pointermove)="onPointerMove($event)"
  (pointerup)="onPointerUp($event)"
  (pointercancel)="onPointerUp($event)"
>
```

**`src/app/components/star-map/star-map.ts`**

1. Remove `setupDragHandlers()` and its call from `ngAfterViewInit()` (lines 1220 and 1224–1235).
2. Remove the three `boundOnPointerDown`/`boundOnPointerMove`/`boundOnPointerUp` field initializers (lines 141–143) — they are no longer needed since template bindings preserve `this`.
3. Change `private onPointerDown(event: PointerEvent)` to public so the template can call it (`onPointerDown(event: PointerEvent)` — same for `onPointerMove`, `onPointerUp`). The simplest is to drop the `private` modifier on all three.

The bodies of `onPointerDown`/`onPointerMove`/`onPointerUp` already use `event.currentTarget` for `setPointerCapture`/`releasePointerCapture`, which is the bound element when invoked from a template binding, so they work as-is.

## Why this approach over a ViewChild setter

- Fewer moving parts: no manual listener bookkeeping, no cleanup on destroy.
- Angular's event binding lifecycle (`@if` block) automatically adds and removes listeners with the element.
- The `click` handler is already a template binding, so this unifies the drag/click pattern.

## Validation

1. Run `npm start` (or `start.bat`) and open the star map.
2. Confirm drag-to-pan works on first load.
3. Click a star system → enter system view.
4. Click `BACK TO STAR-MAP`.
5. Confirm drag-to-pan (mouse and touch) works again without reloading.
6. Repeat entering/leaving the system view several times to make sure drag is restored on every re-entry.
7. Confirm `onMapClick` still fires when clicking an empty area (no drag movement) — the existing `dragMoved` logic inside `onPointerUp` already gates this.
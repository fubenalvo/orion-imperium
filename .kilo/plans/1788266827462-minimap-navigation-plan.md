# Fix: Minimap Mobile Click/Drag Coordinate Offset

## Problem

On mobile, the minimap is scaled via CSS to 120×72px, but click/drag coordinate calculations hardcode the original 240×144 dimensions. This causes a 2× error: clicks near the top-left are roughly correct, but the offset grows toward the bottom-right corner.

## Root Cause

In `star-map-minimap.component.ts`, the `emitCamera()` method:

```ts
private emitCamera(e: PointerEvent): void {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  const pxX = e.clientX - rect.left;
  const pxY = e.clientY - rect.top;
  // BUG: divides by hardcoded 240×144 instead of actual rendered size
  const cameraX = (pxX / this.MINIMAP_W) * this.totalMapVw - 50;
  const cameraY = (pxY / this.MINIMAP_H) * this.totalMapVh - this.viewportHeightVw / 2;
  ...
}
```

`rect.width` / `rect.height` reflect the true rendered dimensions (120×72 on mobile), but the code divides by the hardcoded `MINIMAP_W=240` / `MINIMAP_H=144`. The ratio `pxX / MINIMAP_W` is half what it should be, so the camera target is always closer to top-left than the actual click position.

## Fix

**File:** `src/app/components/star-map-minimap/star-map-minimap.component.ts`

Replace the `emitCamera` method to use the actual bounding rect dimensions:

```ts
private emitCamera(e: PointerEvent): void {
  const rect = (e.currentTarget as Element).getBoundingClientRect();
  const pxX = e.clientX - rect.left;
  const pxY = e.clientY - rect.top;
  const cameraX = (pxX / rect.width) * this.totalMapVw - 50;
  const cameraY = (pxY / rect.height) * this.totalMapVh - this.viewportHeightVw / 2;
  this.zone.run(() => {
    this.cameraChange.emit({ x: cameraX, y: cameraY });
  });
}
```

This works because:
- `pxX / rect.width` = normalized click position (0..1) regardless of CSS scaling
- Multiplying by `totalMapVw` converts to world coordinates
- The `- 50` centering offset is in world units (vw), independent of minimap pixel size

## Validation

- [ ] Desktop: click top-left → camera centers near top-left ✓
- [ ] Desktop: click bottom-right → camera centers near bottom-right ✓
- [ ] Mobile: click top-left → camera centers near top-left ✓
- [ ] Mobile: click bottom-right → camera centers near bottom-right ✓
- [ ] Mobile: drag pans smoothly without drift ✓

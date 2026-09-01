# Minimap + Navigation Redesign Plan

## Goal

Replace the `map-navigation__center` button with a **minimap** showing the full galaxy (star systems + fleets as colored dots) and a draggable viewport rectangle. Keep the D-pad buttons but reposition them: **D-pad on the left, minimap on the right**.

## Key Facts (from codebase)

| Item | Value | Source |
|---|---|---|
| Grid size | 100 cols × 60 rows (5:3 ratio) | `star-map-data.json:49-50` |
| Cell size (desktop) | 2 vw | `star-map-data.json:51` |
| Cell size (mobile, <1300px) | 7 vw | `star-map.ts:100,1122` |
| Total map size (desktop) | 200 vw × 120 vw | computed |
| Camera state | `cameraX`, `cameraY` (vw, top-left of viewport) | `star-map.ts:114-115` |
| Viewport size | 100 vw × `(innerHeight/innerWidth)*100` vw | `star-map.ts:871-882` |
| Star systems | `starSystems[]` with `x`,`y` (1-indexed grid), `color` | `star-map.html:47-61` |
| Fleets | `visibleFleets[]` with `x`,`y` (float grid), `factionId` | `star-map.html:64-88` |
| Fleet color | `getFactionColor(factionId)` | `star-map.ts` |
| Existing nav component | `src/app/components/star-map-navigation/` | separate component |
| Nav inputs (unused) | `cameraX`, `cameraY` already wired | `star-map.html:150-151` |

## Design Decisions (confirmed)

1. **Minimap size**: fixed ~240×144 px (preserves 5:3 ratio)
2. **Interaction**: click-to-jump + drag viewport rectangle to pan
3. **Layout**: D-pad on the left, minimap on the right (horizontal)

## Architecture

### New component: `star-map-minimap`

Create `src/app/components/star-map-minimap/` with:
- `star-map-minimap.component.ts`
- `star-map-minimap.component.html`
- `star-map-minimap.component.scss`

**Inputs:**
- `starSystems: StarSystem[]`
- `fleets: Fleet[]` (visible fleets)
- `cameraX: number` (vw)
- `cameraY: number` (vw)
- `cellSizeVw: number`
- `cellSizeVh: number`
- `gridColumns: number` (= 100)
- `gridRows: number` (= 60)
- `viewportHeightVw: number` (= `innerHeight/innerWidth * 100`)

**Outputs:**
- `cameraChange = new EventEmitter<{x: number, y: number}>()`

**Rendering approach: SVG** (clean scaling, simple shapes, easy event handling).

### Coordinate Math

```
// Grid coords → minimap pixels
const minimapW = 240, minimapH = 144;
const pxPerCol = minimapW / gridColumns;  // 2.4
const pxPerRow = minimapH / gridRows;     // 2.4

systemPxX = (system.x - 1) * pxPerCol
systemPxY = (system.y - 1) * pxPerRow
fleetPxX  = (fleet.x  - 1) * pxPerCol
fleetPxY  = (fleet.y  - 1) * pxPerRow

// Camera/viewport rectangle on minimap
totalMapVw = gridColumns * cellSizeVw;  // 200
totalMapVh = gridRows * cellSizeVh;     // 120

vpX = (cameraX / totalMapVw) * minimapW
vpY = (cameraY / totalMapVh) * minimapH
vpW = (100 / totalMapVw) * minimapW     // 120px on desktop
vpH = (viewportHeightVw / totalMapVh) * minimapH

// Click/drag → camera vw
cameraX = (pxX / minimapW) * totalMapVw - 50  // center on click
cameraY = (pxY / minimapH) * totalMapVh - viewportHeightVw/2
// Then clamp via existing clampCamera() logic
```

### Visual Elements (SVG)

1. **Background**: dark semi-transparent rect (`.minimap-bg`)
2. **Star systems**: `<circle>` r=3, fill=`system.color`
3. **Fleets**: `<rect>` 4×4, fill=`getFactionColor(fleet.factionId)`
4. **Viewport rectangle**: `<rect>` stroke white, fill rgba(255,255,255,0.1), draggable

### Interaction

- **Click on minimap**: emit centered camera position
- **Drag viewport rectangle**: emit camera position continuously during drag (throttled via `requestAnimationFrame`)
- Use pointer events (`pointerdown`, `pointermove`, `pointerup`) for unified mouse/touch

## Files to Create

### 1. `src/app/components/star-map-minimap/star-map-minimap.component.ts`

```ts
@Component({
  selector: 'app-star-map-minimap',
  standalone: true,
  imports: [],
  templateUrl: './star-map-minimap.component.html',
  styleUrls: ['./star-map-minimap.component.scss']
})
export class StarMapMinimapComponent {
  @Input() starSystems: StarSystem[] = [];
  @Input() fleets: Fleet[] = [];
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 100;
  @Input() gridRows = 60;
  @Input() viewportHeightVw = 56.25; // default 16:9

  @Output() cameraChange = new EventEmitter<{x: number, y: number}>();

  // constants
  readonly MINIMAP_W = 240;
  readonly MINIMAP_H = 144;

  // computed getters for template
  get totalMapVw() { return this.gridColumns * this.cellSizeVw; }
  get totalMapVh() { return this.gridRows * this.cellSizeVh; }
  get pxPerCol() { return this.MINIMAP_W / this.gridColumns; }
  get pxPerRow() { return this.MINIMAP_H / this.gridRows; }

  systemPos(s: StarSystem) { return { x: (s.x - 1) * this.pxPerCol, y: (s.y - 1) * this.pxPerRow }; }
  fleetPos(f: Fleet) { return { x: (f.x - 1) * this.pxPerCol, y: (f.y - 1) * this.pxPerRow }; }

  get viewportRect() {
    return {
      x: (this.cameraX / this.totalMapVw) * this.MINIMAP_W,
      y: (this.cameraY / this.totalMapVh) * this.MINIMAP_H,
      w: (100 / this.totalMapVw) * this.MINIMAP_W,
      h: (this.viewportHeightVw / this.totalMapVh) * this.MINIMAP_H
    };
  }

  // pointer handlers for click-to-jump and drag
  private dragging = false;
  private lastEmit = 0;

  onPointerDown(e: PointerEvent) {
    this.dragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    this.emitCamera(e);
  }

  onPointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const now = performance.now();
    if (now - this.lastEmit > 16) { // ~60fps throttle
      this.emitCamera(e);
      this.lastEmit = now;
    }
  }

  onPointerUp() { this.dragging = false; }

  private emitCamera(e: PointerEvent) {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const cameraX = (pxX / this.MINIMAP_W) * this.totalMapVw - 50;
    const cameraY = (pxY / this.MINIMAP_H) * this.totalMapVh - this.viewportHeightVw / 2;
    this.cameraChange.emit({ x: cameraX, y: cameraY });
  }
}
```

### 2. `src/app/components/star-map-minimap/star-map-minimap.component.html`

```html
<svg class="minimap" [attr.viewBox]="'0 0 ' + MINIMAP_W + ' ' + MINIMAP_H"
     (pointerdown)="onPointerDown($event)"
     (pointermove)="onPointerMove($event)"
     (pointerup)="onPointerUp()"
     (pointerleave)="onPointerUp()">

  <rect class="minimap-bg" [attr.width]="MINIMAP_W" [attr.height]="MINIMAP_H"/>

  <!-- Star systems -->
  @for (s of starSystems; track s.id) {
    <circle class="minimap-system"
            [attr.cx]="systemPos(s).x"
            [attr.cy]="systemPos(s).y"
            r="3"
            [attr.fill]="s.color"/>
  }

  <!-- Fleets -->
  @for (f of fleets; track f.id) {
    <rect class="minimap-fleet"
          [attr.x]="fleetPos(f).x - 2"
          [attr.y]="fleetPos(f).y - 2"
          width="4" height="4"
          [attr.fill]="getFactionColor(f.factionId)"/>
  }

  <!-- Viewport rectangle -->
  <rect class="minimap-viewport"
        [attr.x]="viewportRect.x"
        [attr.y]="viewportRect.y"
        [attr.width]="viewportRect.w"
        [attr.height]="viewportRect.h"/>
</svg>
```

### 3. `src/app/components/star-map-minimap/star-map-minimap.component.scss`

```scss
:host {
  display: block;
  width: 240px;
  height: 144px;
}

.minimap {
  width: 100%;
  height: 100%;
  cursor: crosshair;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}

.minimap-bg {
  fill: rgba(0, 0, 10, 0.85);
}

.minimap-system {
  filter: drop-shadow(0 0 2px currentColor);
}

.minimap-fleet {
  pointer-events: none;
}

.minimap-viewport {
  fill: rgba(255, 255, 255, 0.1);
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1.5;
}
```

## Files to Modify

### 4. `src/app/components/star-map-navigation/star-map-navigation.component.html`

Replace the 3×3 grid with a horizontal layout: D-pad (left) + minimap (right).

```html
<div class="map-navigation" (click)="$event.stopPropagation()">
  <!-- D-pad cluster (left) -->
  <div class="map-navigation__dpad">
    <button class="map-navigation__up" ...>▲</button>
    <button class="map-navigation__left" ...>◀</button>
    <button class="map-navigation__center" type="button" (click)="centerCamera.emit()">●</button>
    <button class="map-navigation__right" ...>▶</button>
    <button class="map-navigation__down" ...>▼</button>
  </div>

  <!-- Minimap (right) -->
  <app-star-map-minimap
    [starSystems]="starSystems"
    [fleets]="fleets"
    [cameraX]="cameraX"
    [cameraY]="cameraY"
    [cellSizeVw]="cellSizeVw"
    [cellSizeVh]="cellSizeVh"
    [gridColumns]="gridColumns"
    [gridRows]="gridRows"
    [viewportHeightVw]="viewportHeightVw"
    (cameraChange)="cameraMoveByMinimap($event)"
  />
</div>
```

### 5. `src/app/components/star-map-navigation/star-map-navigation.component.ts`

Add new inputs and handler:

```ts
@Input() starSystems: StarSystem[] = [];
@Input() fleets: Fleet[] = [];
@Input() cellSizeVw = 2;
@Input() cellSizeVh = 2;
@Input() gridColumns = 100;
@Input() gridRows = 60;
@Input() viewportHeightVw = 56.25;

@Output() cameraSet = new EventEmitter<{x: number, y: number}>();

cameraMoveByMinimap(pos: {x: number, y: number}) {
  this.cameraSet.emit(pos);
}
```

### 6. `src/app/components/star-map-navigation/star-map-navigation.component.scss`

Replace grid layout with horizontal flex:

```scss
.map-navigation {
  position: fixed;
  right: 2%;
  bottom: 3%;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 0.5em;
  z-index: 30;
}

.map-navigation__dpad {
  display: grid;
  grid-template-columns: repeat(3, 3em);
  grid-template-rows: repeat(3, 3em);
  gap: 0.3em;
}

// keep existing button styles and grid positioning
.map-navigation__up    { grid-column: 2; grid-row: 1; }
.map-navigation__left  { grid-column: 1; grid-row: 2; }
.map-navigation__center { grid-column: 2; grid-row: 2; }
.map-navigation__right { grid-column: 3; grid-row: 2; }
.map-navigation__down  { grid-column: 2; grid-row: 3; }

// mobile adjustments
@include mobile-view {
  .map-navigation__dpad {
    grid-template-columns: repeat(3, 2rem);
    grid-template-rows: repeat(3, 2rem);
    gap: 0.2em;
  }
  :host { /* scale minimap down on mobile if needed */ }
}
```

### 7. `src/app/components/star-map/star-map.html` (lines 149-156)

Update the navigation binding to pass new inputs and handle `cameraSet`:

```html
<app-star-map-navigation
  [cameraX]="cameraX"
  [cameraY]="cameraY"
  [starSystems]="starSystems"
  [fleets]="visibleFleets"
  [cellSizeVw]="cellSizeVw"
  [cellSizeVh]="cellSizeVh"
  [gridColumns]="movementService.gridColumns"
  [gridRows]="movementService.gridRows"
  [viewportHeightVw]="viewportHeightVw"
  (cameraMove)="moveCamera($event)"
  (cameraSet)="setCamera($event)"
  (centerCamera)="cameraX = 0; cameraY = 0"
>
</app-star-map-navigation>
```

### 8. `src/app/components/star-map/star-map.ts`

Add new method and computed property:

```ts
// Add computed viewport height (vw)
get viewportHeightVw() {
  return (window.innerHeight / window.innerWidth) * 100;
}

// Add setCamera method (replaces cameraX/Y with clamping)
setCamera(pos: {x: number, y: number}) {
  this.cameraX = pos.x;
  this.cameraY = pos.y;
  this.clampCamera();
}
```

### 9. Register `StarMapMinimapComponent`

Add to the `imports` array of `StarMapNavigationComponent` (or `StarMapComponent` if needed for standalone).

## Implementation Order

1. Create `star-map-minimap` component (`.ts`, `.html`, `.scss`)
2. Add `setCamera()` and `viewportHeightVw` getter to `star-map.ts`
3. Update `star-map-navigation.component.ts` (new inputs, `cameraSet` output, handler)
4. Update `star-map-navigation.component.html` (horizontal layout + minimap)
5. Update `star-map-navigation.component.scss` (flex layout, keep D-pad grid)
6. Update `star-map.html` (pass new inputs, bind `cameraSet`)
7. Test: verify minimap renders, click jumps camera, drag pans camera

## Validation

- [ ] Minimap shows all star systems at correct positions with correct colors
- [ ] Minimap shows all visible fleets with faction colors
- [ ] Viewport rectangle position matches current camera
- [ ] Viewport rectangle size matches aspect ratio
- [ ] Clicking minimap centers camera on clicked point
- [ ] Dragging minimap pans camera smoothly
- [ ] D-pad buttons still work (up/down/left/right/center)
- [ ] Existing keyboard pan and drag-to-pan still work
- [ ] Mobile layout doesn't break (minimap scales down)

## Risks / Notes

- **Mobile width**: 240px minimap + D-pad may overflow on small screens. Mitigation: scale minimap to ~120px on mobile via media query.
- **Performance**: pointermove emits are throttled to ~60fps; Angular change detection on `cameraX/Y` triggers full map re-render (existing behavior, not worsened).
- **`getFactionColor` access**: the minimap component needs access to faction colors. Options: (a) pass `factions` input and replicate lookup, or (b) expose a `getFactionColor` utility. Recommended: add a static utility or pass pre-computed fleet color as `@Input`.
- **Existing `centerCamera`**: the D-pad center button still resets to (0,0) — this is existing behavior, not changed. Consider later enhancement to center on actual map center.

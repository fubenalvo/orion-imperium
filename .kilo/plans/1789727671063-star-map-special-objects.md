# Star Map Special Objects — Implementation Plan

## Context
Add a pluggable "special objects" system to the star map grid. This allows placing cosmic-scale objects (e.g. black holes) on the galaxy map grid via data-driven configuration. Each special object defines its grid position (x, y), CSS class type, multi-cell dimensions (width × height), and an optional component name for rendering a dedicated Angular component.

## Files to Modify / Create

1. **`src/app/components/star-map/star-map-data.json`** — Add `specialObjects` array
2. **`src/app/components/star-map/star-map.models.ts`** — Add `SpecialObject` interface
3. **`src/app/components/star-map/star-map.ts`** — Load special objects, pass to galaxy view
4. **`src/app/components/star-map/star-map-galaxy-view/star-map-galaxy-view.component.ts`** — Add `specialObjects` input, render logic
5. **`src/app/components/star-map/star-map-galaxy-view/star-map-galaxy-view.component.html`** — Template for special objects
6. **`src/app/components/star-map/star-map-galaxy-view/star-map-galaxy-view.component.scss`** — Styles for special object cells
7. **`src/app/components/star-map/blackhole/blackhole.component.ts`** — NEW: Black hole standalone component
8. **`src/app/components/star-map/blackhole/blackhole.component.html`** — NEW: Template
9. **`src/app/components/star-map/blackhole/blackhole.component.scss`** — NEW: Styles (CSS from user)
10. **`src/app/components/star-map/star-map.html`** — Register blackhole component in imports

---

## Step 1: Extend `star-map-data.json`

Add a `specialObjects` array at the top level (sibling to `factions`, `map`, `starSystems`, `fleets`):

```json
"specialObjects": [
  {
    "x": 100,
    "y": 90,
    "type": "blackhole",
    "width": 4,
    "height": 5,
    "component": "blackhole"
  }
]
```

- `x`, `y`: 1-indexed grid coordinates (galaxy map)
- `type`: CSS class name applied to the container div (e.g., `special-blackhole`)
- `width`, `height`: Span in grid cells
- `component`: Optional — when `"blackhole"`, renders the BlackholeComponent

## Step 2: Add `SpecialObject` interface to `star-map.models.ts`

```typescript
export interface SpecialObject {
  x: number;
  y: number;
  type: string;
  width: number;
  height: number;
  component?: string;
}
```

Also add `specialObjects?: SpecialObject[]` to `StarMapData` interface.

## Step 3: Create BlackholeComponent

**Path**: `src/app/components/star-map/blackhole/`

- **`blackhole.component.ts`**: Standalone component, no inputs needed, pure visual.
- **`blackhole.component.html`**: The HTML structure from the user's snippet (black-hole-container with gravitational-lens, accretion-disk-outer, accretion-disk-inner, particle-ring, photon-ring, event-horizon, plus title-badge).
- **`blackhole.component.scss`**: All CSS from the user's `<style>` block (the golden/amber palette, animations, etc.).

The component is self-contained — it renders the CSS-only black hole visual.

## Step 4: Update `star-map.ts`

- Add `specialObjects: SpecialObject[] = initialStarMapData.specialObjects ?? [];`
- Pass `specialObjects` to `StarMapGalaxyViewComponent` via `[specialObjects]="specialObjects"` in `star-map.html`
- Add `StarMapBlackholeComponent` to the component's `imports` array

## Step 5: Update `star-map-galaxy-view` component

**TypeScript** (`star-map-galaxy-view.component.ts`):
- Add `@Input() specialObjects: SpecialObject[] = [];`
- Add helper method `getSpecialObjectClass(obj: SpecialObject): string` returning the type-based class
- Add helper `getSpecialObjectComponent(obj: SpecialObject): string` returning the component name

**Template** (`star-map-galaxy-view.component.html`):
- After the fleets section and before movement trails, add a loop:

```html
<!-- SPECIAL OBJECTS -->
@for (obj of specialObjects; track obj.x + '-' + obj.y + '-' + obj.type) {
  @if (obj.component === 'blackhole') {
    <div
      class="special-object-cell {{ obj.type }}"
      [style.gridColumn]="obj.x"
      [style.gridRow]="obj.y"
      [style.gridColumnEnd]="obj.x + obj.width"
      [style.gridRowEnd]="obj.y + obj.height"
    >
      <app-star-map-blackhole></app-star-map-blackhole>
    </div>
  } @else {
    <div
      class="special-object-cell {{ obj.type }}"
      [style.gridColumn]="obj.x"
      [style.gridRow]="obj.y"
      [style.gridColumnEnd]="obj.x + obj.width"
      [style.gridRowEnd]="obj.y + obj.height"
    ></div>
  }
}
```

**SCSS** (`star-map-galaxy-view.component.scss`):
- Import base/grid styles
- Add `.special-object-cell` styles (position: relative, z-index, pointer-events: none)

## Step 6: Update `star-map.html`

In `app-star-map-galaxy-view` element, add:
```html
[specialObjects]="specialObjects"
```

In `StarMap` component `imports` array, add `StarMapBlackholeComponent`.

## Step 7: Register in `star-map.ts` imports

Add `StarMapBlackholeComponent` to the `imports` array of the `@Component` decorator.

---

## Data Flow

```
star-map-data.json
  └─ specialObjects[]
       └─ StarMap.ts: specialObjects field (loaded from JSON)
            └─ star-map.html: [specialObjects]="specialObjects"
                 └─ star-map-galaxy-view.component.ts: @Input() specialObjects
                      └─ Template: renders BlackholeComponent or empty div
```

## Validation

1. Verify `ng build` succeeds without errors
2. Verify the black hole visual renders at the specified grid coordinates (x=100, y=90) on the galaxy map
3. Verify the special object cell spans 4×5 grid cells
4. Verify existing functionality (systems, fleets, sensor) is unaffected
5. Verify the black hole component renders independently (CSS-only, no external dependencies)

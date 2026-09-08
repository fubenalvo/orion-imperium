# Fix: dead click handlers on the star map after refactor

## Diagnosis (verified against code)

**Root cause:** `StarMapGalaxyViewComponent` and `StarMapSystemGridViewComponent` receive event handlers as `@Input()` function properties, but `star-map.html` passes **unbound class prototype methods** (`[onFleetClick]="onFleetClick"`, `[onMapClick]="onMapClick"`, etc.).

Angular evaluates the child's template expressions with the **child component instance** as the execution context: `(click)="onFleetClick(fleet, $event)"` compiles to `ctx.onFleetClick(fleet, $event)` where `ctx` = child. So inside `StarMap.onFleetClick(...)` `this` = the child component, and the first access to a parent member (`this.contextMenu`, `this.closeContextMenu()`, `this.movementService`, ...) throws `TypeError` inside the event listener. Angular swallows the listener exception → nothing happens. CSS `:hover` is unaffected → hover works but clicks are dead.

**Symptom mapping (all consistent):**
- Fleet click dead → `onFleetClick` raw (star-map.html:66, 172)
- Star system click dead → `onSystemClick` raw (star-map.html:65)
- Planet click dead (in system view) → `onPlanetClick` raw (star-map.html:171); entering the system was already impossible because system click is broken
- Map deselect click + camera drag/pan dead → `onMapClick`, `onPointerDown/Move/Up` raw (star-map.html:61-64)
- Right-click deselect dead → `onSystemContextMenu`/`onFleetContextMenu`/`onPlanetContextMenu` raw (star-map.html:67-68, 173-174)
- Hover CSS works → pure CSS, no JS involved

**Codebase convention violated:** every function input in this project is passed pre-bound (`boundGetFactionColor`, `boundGetEnergyForPlanet`, `boundOnConfirmBuild`, ...) — exactly to avoid this receiver problem. The refactor correctly used `boundIsEnemyInPreview` / `boundGetFactionColor` but passed the event handlers unbound.

**Not the cause / deliberately left alone:**
- `[getPlanetClassNames]="getPlanetClassNames"` (star-map.html:169) is unbound but its body contains no `this` reference (pure util delegation), so it works. Will still bind it for uniformity (zero behavior change, prevents future footguns).
- `planet-screen` `[getEnergyForPlanet]="getEnergyForPlanet"` / `[getTaxForPlanet]="getTaxForPlanet"` (star-map.html:238-239) are unbound AND their bodies use `this`, but the planet-screen template **never invokes these inputs** (grep: no usages in `star-map-planet-screen.component.html`; energy/tax come from the `planetEconomy` input). Latent dead bindings, pre-existing, no visible effect → out of scope for this fix.
- `:host { display: contents }` layering, `currentTarget` semantics, z-index: fine — hover reaching the buttons proves events propagate to the elements.

## Changes

### 1. `src/app/components/star-map/star-map.ts`

Add bound handler fields next to the existing `bound*` fields (~line 988), following the established convention:

```ts
readonly boundOnMapClick = this.onMapClick.bind(this);
readonly boundOnPointerDown = this.onPointerDown.bind(this);
readonly boundOnPointerMove = this.onPointerMove.bind(this);
readonly boundOnPointerUp = this.onPointerUp.bind(this);
readonly boundOnSystemClick = this.onSystemClick.bind(this);
readonly boundOnFleetClick = this.onFleetClick.bind(this);
readonly boundOnSystemGridClick = this.onSystemGridClick.bind(this);
readonly boundOnPlanetClick = this.onPlanetClick.bind(this);
readonly boundOnSystemContextMenu = this.onSystemContextMenu.bind(this);
readonly boundOnFleetContextMenu = this.onFleetContextMenu.bind(this);
readonly boundOnPlanetContextMenu = this.onPlanetContextMenu.bind(this);
readonly boundGetPlanetClassNames = this.getPlanetClassNames.bind(this);
```

Note: class field initializers run in declaration order; the `bound*` block sits after the constructor in this class, and `.bind(this)` on prototype methods is order-safe (methods are on the prototype at construction time — this is how the existing `boundGetFactionColor` etc. already work).

### 2. `src/app/components/star-map/star-map.html`

- Galaxy-view wiring (lines 61-68): replace the 8 raw bindings with `boundOnMapClick`, `boundOnPointerDown`, `boundOnPointerMove`, `boundOnPointerUp`, `boundOnSystemClick`, `boundOnFleetClick`, `boundOnSystemContextMenu`, `boundOnFleetContextMenu`.
- System-grid wiring (lines 169-174): replace `getPlanetClassNames` → `boundGetPlanetClassNames`, `onSystemGridClick` → `boundOnSystemGridClick`, `onPlanetClick` → `boundOnPlanetClick`, `onFleetClick` → `boundOnFleetClick`, `onPlanetContextMenu` → `boundOnPlanetContextMenu`, `onFleetContextMenu` → `boundOnFleetContextMenu`.

No other file changes. The methods themselves, the child components, and the input shapes stay untouched.

## Why this is behavior-preserving

- Pre-binding makes the child-template call receiver-independent: `this` = `StarMap` exactly as with the original inline bindings pre-refactor.
- `event.currentTarget`, `stopPropagation`, `preventDefault` semantics are unchanged — the handlers are still invoked synchronously during the same native event dispatch with the same event object.
- Internal calls (`this.onMapClick(...)` inside `onPointerUp`) are untouched.

## Validation

1. `npm run build` — must pass.
2. `npm run test -- --watch=false` — must match baseline (345 passed, 1 pre-existing unrelated `app.spec.ts` failure).
3. Grep audit: after the fix, every `[on...]` and function-typed input binding in `star-map.html` references a `bound*` field or a method whose body provably has no `this` reference (`getPlanetClassNames` is the only one, and it will be bound too). Existing EventEmitter outputs (`(click)="..."` on header/panels) are unaffected (parent-context by definition).
4. Manual sanity (user): click fleet/system on the map, drag-pan the camera, right-click deselect, click planet in system view.

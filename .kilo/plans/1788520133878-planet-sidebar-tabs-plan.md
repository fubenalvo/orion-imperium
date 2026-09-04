# Planet Sidebar: Inline BUILD / ASSEMBLY / DETAILS / PRODUCTION Tabs

## Goal

Inside the planet view (`StarMapPlanetScreenComponent`) the user wants a real
sidebar with four persistent buttons (BUILD, ASSEMBLY, DETAILS, PRODUCTION)
instead of the current mix of:

- A floating `planet-view__panels` column (top-right) holding floating toggle
  buttons for PRODUCTION / ASSEMBLE FLEET (`star-map.html:411-424`,
  `_star-map-panels.scss:305-343`).
- Two absolutely-positioned modals (`<app-star-map-production-panel>`,
  `<app-star-map-spaceport-panel>`) that overlay the planet surface from the
  bottom-right.
- The existing in-sidebar BUILD button + build-building-type overlay
  (`star-map-planet-screen.component.html:55-99`).

After the change:

1. The four buttons live inside the planet sidebar header, beside (or below)
   the title — visually the same family as today's BUILD / DETAILS buttons.
2. Pressing any of them replaces the content of the sidebar (below the
   button row). No floating overlays, no toggling columns.
3. ASSEMBLY is only rendered if `spaceportService.isSpaceportPlanet(planet)` is
   true (same rule used today at `star-map.html:415`).
4. The old build-building-type modal is gone — selecting a building is just a
   list inside the BUILD tab.
5. The old `<app-star-map-production-panel>` and
   `<app-star-map-spaceport-panel>` floating mounts are removed from
   `star-map.html` (their state and outputs still exist on `StarMap`, but they
   stop rendering as absolute panels). Their templates are re-used inside
   the sidebar instead.

## Design decisions

| Decision | Choice |
|---|---|
| Active tab model | `activeTab: 'details' \| 'build' \| 'assembly' \| 'production'` on `StarMapPlanetScreenComponent`, default `'details'` |
| Where state lives | Active tab + build-mode sub-state stays in `StarMapPlanetScreenComponent`. Existing `StarMap` callbacks (`onSelectBuildingType`, `onConfirmBuild`, `boundGetProductionPanelVm`, `boundGetSpaceportPanelVm`, `openProductionPanel/openSpaceportPanel`, queue/cancel/disband/reinforce) are unchanged. |
| Tab visibility | DETAILS always visible. BUILD visible only if the player owns it). PRODUCTION visible only if planet has a `spaceship_factory` (use existing `productionService.getBuildableShipTypes` / `productionService.getPlanetCapacity` to gate). ASSEMBLY visible only if `spaceportService.isSpaceportPlanet(planet)`. |
| Backwards-compat | The existing floating `planet-view__panels` toggles + absolute production/spaceport panels stop being rendered, but `openProductionPanel` / `openSpaceportPanel` / `showBuildMenu` / `showProductionPanel` / `showSpaceportPanel` stay on `StarMap` so saving/loading, fleet assembly, and production ticking are untouched. |
| Visual style | Reuse `.planet-sidebar__buttons` and `.planet-sidebar__btn` (`star-map-planet-screen.component.scss:232-255`). Add a `--active` modifier and a tab strip layout — no new design language. |

## Affected files

| File | Change |
|---|---|
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts` | Add `activeTab` + tab visibility getters; remove `showBuildMenu`/`openBuildMenu`/`closeBuildMenu`/`selectBuildingType` overlay methods. Wire inputs needed by production/spaceport tabs (`getProductionPanelVm`, `getSpaceportPanelVm`, callbacks). |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html` | Replace the `@if (showBuildMenu)` overlay with the new tab button row and `@switch` content for the four tabs. Reuse `StarMapProductionPanelComponent` and `StarMapSpaceportPanelComponent` inline inside the sidebar. |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.scss` | Add `.planet-sidebar__btn--active`, tab strip layout, remove `.build-overlay*` styles. |
| `src/app/components/star-map/star-map.html` (lines 411-449) | Remove `planet-view__panels`, the production panel mount, and the spaceport panel mount inside the planet view. The `StarMapPlanetScreenComponent` now owns all of that. Keep the `<app-star-map-planet-info>` block (system view) unchanged. |
| `src/app/components/star-map/_star-map-panels.scss` (lines 301-343) | Remove the now-unused `.planet-view__panels`, `.planet-view__panel-toggle`, and `app-star-map-production-panel/spaceport-panel` absolute positioning rules (keep the rest). |
| `src/app/components/star-map/star-map-production-panel/star-map-production-panel.component.ts` + `.html` + `.scss` | No behaviour changes needed. The component is now mounted inside the sidebar instead of as a floating modal. Its own internal "NEW PRODUCTION ORDER" modal continues to be an overlay inside the panel — that is fine, it stays scoped to the sidebar content area. |
| `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.ts` + `.html` + `.scss` | Same as above — re-use inside sidebar. |
| `src/app/components/star-map/star-map.ts` | Pass new inputs to `<app-star-map-planet-screen>`: `[getProductionPanelVm]`, `[getSpaceportPanelVm]`, `[onQueueOrder]`, `[onCancelOrder]`, `[onSpaceportConfirm]`, `[onSpaceportDisband]`, `[onCloseSpaceportPanel]`, `[spaceportFleetNameChange]`, `[hasSpaceport]`. Internal flag setters (`openProductionPanel`/`openSpaceportPanel`/`closeProductionPanel`/`closeSpaceportPanel`/`onOpenBuildMenu`/`onCloseBuildMenu`) become unused by templates but remain (called by production/spaceport child outputs) so the `StarMap` API stays consistent. No removal required. |
| `docs/game-systems.md` | Update the planet view description to reflect inline sidebar tabs (one-line change). |

## Component contract changes

`StarMapPlanetScreenComponent` gains these inputs (all bound from `StarMap`
via the existing `bound*` pattern or new `bound*` wrappers):

```ts
@Input() hasFactory: () => boolean = () => false;          // planet has spaceship_factory
@Input() hasSpaceport: () => boolean = () => false;        // wraps spaceportService.isSpaceportPlanet
@Input() getProductionPanelVm: () => ProductionPanelViewModel | null = () => null;
@Input() getSpaceportPanelVm: () => SpaceportPanelViewModel | null = () => null;
@Input() spaceportFleetName = 'New Fleet';
@Input() spaceportMode: 'create' | 'reinforce' = 'create';
@Input() spaceportTargetFleetId: number | null = null;

@Output() queueOrder = new EventEmitter<QueueOrderRequest>();
@Output() cancelOrder = new EventEmitter<number>();
@Output() spaceportConfirm = new EventEmitter<{ ... }>();
@Output() spaceportDisband = new EventEmitter<void>();
@Output() spaceportClose = new EventEmitter<void>();
@Output() spaceportFleetNameChange = new EventEmitter<string>();
@Output() openProductionTab = new EventEmitter<void>();
@Output() openAssemblyTab = new EventEmitter<void>();
```

The existing `onSelectBuildingType`/`onConfirmBuild`/`buildConfirmed` inputs
stay — only the floating overlay disappears.

## Template shape (new planet sidebar content)

```
+-------------------------------------------+
| <PLANET NAME> SURFACE                    |  <- existing title
| [BUILD] [ASSEMBLY] [DETAILS] [PRODUCTION]|  <- tab strip (only visible tabs rendered)
+-------------------------------------------+
| @switch (activeTab)                      |
|   case 'details':  (current info rows)   |
|   case 'build':                               |
|     - list of building types (was overlay)|
|     - if selectedBuildingType: cell pick  |
|       + confirm button + error/hint       |
|   case 'production':                        |
|     <app-star-map-production-panel/>       |
|   case 'assembly':                          |
|     <app-star-map-spaceport-panel/>        |
+-------------------------------------------+
| BACK TO STAR MAP                          |
+-------------------------------------------+
```

## Implementation steps (ordered)

1. **`StarMapPlanetScreenComponent` TS**: add `activeTab`, `availableTabs`
   getter (`(planet?.factionId === 'player' ? ['details','build'] : ['details'])`
   plus `production` if `hasFactory()`, plus `assembly` if `hasSpaceport()`).
   Keep existing `isBuildMode`/`selectedBuildingType`/`selectedCell` flow but
   move building-type selection into the BUILD tab (no overlay). Add the new
   inputs/outputs listed above.

2. **`StarMapPlanetScreenComponent` HTML**: rewrite lines 55-99 and 100-215
   into a tab strip + `@switch` content. Mount
   `<app-star-map-production-panel>` and `<app-star-map-spaceport-panel>`
   inline (they already exist as standalone components). Re-bind their
   existing inputs/outputs to the new planet-screen outputs.

3. **`StarMapPlanetScreenComponent` SCSS**: add `.planet-sidebar__btn--active`
   modifier. Remove the `.build-overlay*` block. The production/spaceport
   children's own `.scss` keeps their internal modal overlays (they were
   always scoped to the component).

4. **`star-map.html`**: delete lines 411-449 (the `planet-view__panels`
   column, the production panel mount, the spaceport panel mount). Pass the
   new inputs into `<app-star-map-planet-screen>`.

5. **`star-map.ts`**: add `bound*` wrappers for the new production/spaceport
   inputs (`boundGetProductionPanelVm`, `boundGetSpaceportPanelVm`, etc.) —
   same pattern already used for `boundGetPlayerCredits`. The internal
   `openProductionPanel`/`closeProductionPanel`/`openSpaceportPanel`/
   `closeSpaceportPanel` methods remain (now invoked only from
   `onSpaceportConfirm` etc.) so behaviour is preserved.

6. **`_star-map-panels.scss`**: drop the three rules at lines 305-343
   (now-dead). Keep everything else.

7. **`docs/game-systems.md`**: one-line note under the planet view section
   that the sidebar has BUILD/ASSEMBLY/DETAILS/PRODUCTION tabs and no
   floating overlays.

8. **Delete `star-map.scss.new`** (empty placeholder file in the working
   tree; unrelated cleanup but the repo has it as a stale artifact).

## Risks / open questions

- **Spaceport `mode: 'reinforce'`**: the reinforce flow is only triggered
  from the system view's fleet-info panel, not from the planet view. In the
  planet view the spaceport tab is always `'create'` mode. We pass
  `spaceportMode="create"` and `spaceportTargetFleetId=null` from the planet
  view; the reinforce path stays in the system view (untouched).
- **Production/spaceport internal modals**: their own overlays
  (e.g. `production-panel__overlay`) currently cover the screen. Once
  re-mounted inside the sidebar, those overlays will only cover the sidebar
  region if `.production-panel` is positioned relative. We will set
  `position: relative` on the sidebar content area hosting them so the
  internal overlay is clipped to the sidebar. This is a CSS-only tweak in
  `star-map-planet-screen.component.scss`.
- **Save format**: nothing changes. `showBuildMenu`, `showProductionPanel`,
  `showSpaceportPanel` keep their old initial state so loaded saves still
  behave correctly.

## Validation plan

1. `npm run lint` and `npx tsc --noEmit` clean.
2. Manual: open an owned planet → sidebar shows BUILD / DETAILS / PRODUCTION
   (and ASSEMBLY if a Spaceport exists). Click each tab → sidebar content
   swaps. No floating modals anywhere.
3. Build flow: BUILD tab → click a building → cell pick still works on the
   surface → BUILD button still confirms.
4. Production flow: PRODUCTION tab → "QUEUE NEW ORDER" still opens its modal
   inside the sidebar → queueing a ship still deducts credits and ticks.
5. Assembly flow: ASSEMBLY tab → pick a target planet with a Spaceport →
   confirm still creates the fleet and returns to system view per existing
   flow.
6. Enemy/uninhabited planet: only DETAILS visible (existing behavior for
   `!planet?.explored` already short-circuits to its own template).
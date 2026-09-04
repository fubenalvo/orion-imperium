# Plan: Unified Star-Map Header + Consistent Currency/Ship-Stock Overlays

## Goal

Replace the three duplicated, slightly inconsistent top HUDs in `star-map.html`
(map / system / planet views) with a single shared `<app-star-map-header>`
component. Use the planet-view header layout as the canonical baseline
because it is already the cleanest: a `.hud` bar with the title on the left
and a right-aligned flex group containing the currencies and the global
empire ship stock.

While doing that, promote the "Global Empire Ship Stock" indicator into a
proper header resource — it is already a first-class item, but its detail
overlay should use the same visual language as the currency breakdown
overlay (one shared panel/overlay style).

## Baseline (planet view — the one to keep)

```html
<div class="planet-view-hud">
  <div class="game-title">{{ selectedPlanetTile?.name }}</div>
  <div class="planet-view-hud__right">
    <app-faction-currencies ... />
    <app-star-map-ship-stock ... />
  </div>
</div>
```

```scss
.planet-view-hud {
  position: absolute; top: 0; left: 0; right: 0;
  height: 8%;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 2%;
  border-bottom: 2px solid var(--color-blue);
  background: rgba(0,0,0,0.82);
  z-index: 20;
}
.planet-view-hud__right {
  display: flex; align-items: center; gap: 1em;
}
```

The map and system views currently skip `__right` and rely on
`space-between`; their currencies/ship-stock sit as direct children and
inherit each component's own `margin-right` (4rem + 1.5rem), which is the
"out of order" layout the user is seeing.

## Decisions

1. **New shared component**: `star-map-header/star-map-header.component.{ts,html,scss}`
   - Selector: `app-star-map-header`
   - Standalone, imports `FactionCurrenciesComponent` and `StarMapShipStockComponent`
   - Inputs:
     - `title: string` — the left-side title text
     - `currencies: CurrencyDisplay[]`
     - `economyBreakdown: EconomyBreakdown | null`
     - `shipStockEntries: ShipStockEntryDisplay[]`
     - `shipStockTotal: number`
   - Template: exactly the planet-view markup pattern, with neutral class
     names (`hud`, `hud__title`, `hud__right`).
   - SCSS: the `.hud` rules above, with the `height: 8%` factored out so
     any future view can use the same bar.

2. **Refactor `star-map.html`**: replace the three inline HUD blocks with
   `<app-star-map-header>` instances. Map view passes `title="STAR MAP"`,
   system view passes `title="{{ selectedSystem?.name }}"`, planet view
   passes `title="{{ selectedPlanetTile?.name }}"`. All three bind the
   same currency and ship-stock inputs.

3. **Delete duplicated HUD SCSS**:
   - `_star-map-hud.scss` — drop `.top-hud` and `.game-title` rules
     (keep anything else if it is reused; the file is dedicated to the
     HUD today, so removing the file is acceptable).
   - `_star-map-system-view.scss` — drop `.system-view-hud` and
     `.game-title` rules.
   - `_star-map-planet-screen.scss` — drop `.planet-view-hud` and
     `.planet-view-hud__right` rules. Keep the planet surface / sidebar
     rules intact.

4. **Unify overlay styling**: extract one SCSS partial
   `src/app/components/star-map/_hud-overlay.scss` containing the shared
   `.hud-overlay` / `.hud-overlay__panel` / `.hud-overlay__title` rules.
   Have both `faction-currencies.component.scss` and
   `star-map-ship-stock.component.scss` `@use` it, and rewrite their
   overlay markup to use the shared classes (replacing
   `faction-currencies__overlay*` and `ship-stock__overlay*`).
   - Single z-index (pick `1100`; ship-stock currently uses it, raise
     currency overlay to match).
   - Same backdrop (`rgba(0,0,0,0.5)` + `backdrop-filter: blur(2px)`),
     same padding, same border, same panel background, same title style.
   - This is the only "cosmetic" piece, but it directly serves the
     user's complaint that the header reads as inconsistent.

5. **Keep "Global Empire Ship Stock" as a header resource**: the
   `<app-star-map-ship-stock>` component already exposes a detail view
   (entries, total, empty state, "Build a Spaceship Factory" hint). After
   restyling, it will be visually identical to a currency breakdown
   panel, which makes it read as a peer of the currency tiles rather
   than a separate accessory.

## Files to change

Create:
- `src/app/components/star-map/star-map-header/star-map-header.component.ts`
- `src/app/components/star-map/star-map-header/star-map-header.component.html`
- `src/app/components/star-map/star-map-header/star-map-header.component.scss`
- `src/app/components/star-map/_hud-overlay.scss`

Edit:
- `src/app/components/star-map/star-map.html` — replace the three HUD
  blocks (lines ~155-167, ~227-238, ~377-389) with one
  `<app-star-map-header>` per view. Update the import list in
  `star-map.ts` to add `StarMapHeaderComponent`.
- `src/app/components/star-map/faction-currencies/faction-currencies.component.scss`
  and `.html` — refactor overlay markup to use `.hud-overlay*` classes,
  `@use '../_hud-overlay'`.
- `src/app/components/star-map/star-map-ship-stock/star-map-ship-stock.component.scss`
  and `.html` — same refactor.
- `src/app/components/star-map/_star-map-hud.scss` — drop HUD rules (or
  delete the file if nothing else uses it).
- `src/app/components/star-map/_star-map-system-view.scss` — drop HUD
  rules.
- `src/app/components/star-map/_star-map-planet-screen.scss` — drop
  `.planet-view-hud` and `.planet-view-hud__right` rules.

## Implementation order

1. Add `_hud-overlay.scss` and rewrite the two component overlays to use
   it. Verify both panels still work (currency breakdown, ship-stock
   detail).
2. Add `StarMapHeaderComponent` (ts + html + scss) with the planet-view
   layout. Drop the local margin-right on `faction-currencies` and
   `ship-stock` (it now belongs to the parent gap).
3. Wire `<app-star-map-header>` into `star-map.html` for all three views.
4. Remove the now-duplicated SCSS rules and the unused `.game-title` /
   `.top-hud` / `.system-view-hud` / `.planet-view-hud*` selectors.
5. Visual smoke check: each view's bar should look identical in height,
   background, border, padding, title alignment, right-side spacing.

## Validation

- Build: `npm run build` (or whatever the project uses — see
  `package.json`) to catch broken imports / unused selectors.
- Manual: open the app, navigate STAR MAP → SYSTEM → PLANET, confirm the
  bar is visually identical (modulo title text) and the right-side group
  is a single flex container with `gap`.
- Click each currency icon → overlay opens with the new shared styling.
- Click the ship-stock toggle → overlay opens with identical styling.
- Resize the window: confirm the 8% bar height and `clamp()` font sizes
  scale identically across views.

## Out of scope

- Visual redesign beyond unifying the inconsistencies (no color changes,
  no font changes, no restyling of the currency icons themselves).
- Refactoring the `CurrencyDisplay` / `ShipStockEntryDisplay` interfaces.
- Changing the empire-wide "ship stock" data model or where the totals
  come from (just re-uses the existing
  `boundGetPlayerShipStockEntries()` / `boundGetPlayerShipStockTotal()`
  bindings).
- Any planet-sidebar work beyond removing the now-redundant HUD styles
  from `_star-map-planet-screen.scss`.

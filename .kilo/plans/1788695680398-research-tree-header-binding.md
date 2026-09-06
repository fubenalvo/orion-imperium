# Fix: Research tree openResearchTree binding missing in system/planet views

## Problem

The research tree window only opens when clicking the research currency in the **map view** header. In system and planet views, the click does nothing.

## Root Cause

In `star-map.html`, the `(openResearchTree)="openResearchTree()"` event binding is only present on the map view `<app-star-map-header>` (line 165). The system view header (lines 227–237) and planet view header (lines 376–386) are missing this binding, so the `openResearchTree` event emitted by `FactionCurrenciesComponent` is unhandled in those views.

## Fix

Add `(openResearchTree)="openResearchTree()"` to both the system view and planet view headers in `src/app/components/star-map/star-map.html`.

### System view header (around line 236)

```html
      (setSpeed)="onSetSpeed($event)"
      (togglePause)="onTogglePause()"
      (openResearchTree)="openResearchTree()"
    ></app-star-map-header>
```

### Planet view header (around line 385)

```html
      (setSpeed)="onSetSpeed($event)"
      (togglePause)="onTogglePause()"
      (openResearchTree)="openResearchTree()"
    ></app-star-map-header>
```

## Validation

1. Open the game and switch to system view.
2. Click the research currency (Research Points) in the top HUD.
3. Verify the research tree overlay opens.
4. Repeat in planet view.
5. Verify the tree can be closed via the CLOSE button or overlay click.

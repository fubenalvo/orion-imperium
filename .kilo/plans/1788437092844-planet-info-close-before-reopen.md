# Plan: Fix planet-info window close/reopen + unbound method crash

## Problem

Two issues prevent the planet-info window from working correctly:

1. **Close/reopen logic missing**: `selectPlanetTile` in `star-map.ts:750` does not close the window before opening a different planet. *(Partially implemented — close/reopen added.)*
2. **Runtime crash (root cause of console errors)**: The template passes `getEnergyForPlanet` and `getTaxForPlanet` as **raw unbound method references** to the child component, unlike all other callbacks which use `.bind(this)` versions. When the child template calls `{{ getEnergyForPlanet(planet!) }}`, `this` is `undefined`, so `this.economyService` throws `TypeError: Cannot read properties of undefined (reading 'getPlanetEnergy')`.

## Root Cause

`star-map.html:343-344`:
```html
[getEnergyForPlanet]="getEnergyForPlanet"
[getTaxForPlanet]="getTaxForPlanet"
```

`star-map.ts:554-564` defines bound versions for `getFactionName`, `getPlanetEconomy`, etc. but **never** for `getEnergyForPlanet` or `getTaxForPlanet`.

## Tasks

### Task 1 — Add bound method wrappers (already done)

**File:** `src/app/components/star-map/star-map.ts:554-564`

Add two new bound versions alongside the existing ones:
```ts
readonly boundGetEnergyForPlanet = this.getEnergyForPlanet.bind(this);
readonly boundGetTaxForPlanet = this.getTaxForPlanet.bind(this);
```

**Status:** NOT YET DONE — this is the missing piece causing the crash.

### Task 2 — Use bound versions in template

**File:** `src/app/components/star-map/star-map.html:343-344`

Change to:
```html
[getEnergyForPlanet]="boundGetEnergyForPlanet"
[getTaxForPlanet]="boundGetTaxForPlanet"
```

### Task 3 — selectPlanetTile close/reopen (already applied)

**File:** `src/app/components/star-map/star-map.ts:750`

The `selectPlanetTile` method already has the close-then-reopen logic with console.logs. No further changes needed here — it was the method-binding bug (Task 1-2) that made it appear broken.

## Why one detectChanges is sufficient

The close/reopen uses two `detectChanges()` calls:
1. After `selectedPlanetTile = null` — triggers destruction of the `@if` block.
2. After `selectedPlanetTile = tile` — triggers creation with new data.

Both are needed to force the component to be destroyed and recreated. The final `detectChanges()` also evaluates `getPlanetEconomy(selectedPlanetTile!)` in the template, which requires the bound `getEnergyForPlanet`/`getTaxForPlanet` to work (Task 1-2).

## Validation

1. Run `npm run build` — must succeed with no TS errors.
2. Run `npm start`, open browser DevTools.
3. In system view, click a planet → planet-info window opens **without** the `getPlanetEnergy` TypeError.
4. Click a different planet → console shows `[StarMap] selectPlanetTile: closing window from <old> -> switching to <new>`, window closes and re-opens with new data.
5. Click same planet → window stays open, no re-creation.

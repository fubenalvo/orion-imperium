# Plan: Make planet x/y drive system-view grid position

## Context
- `PlanetTile.x`/`y` in JSON now store concrete grid cell coordinates, but `getPlanetGridPosition()` in `star-map-movement.service.ts` ignores them and computes position from `planet.index` via a hardcoded formula.
- The template (`star-map.html:265-266`) and 5 call sites in `star-map.ts` use `getPlanetGridPosition()` for positioning and collision/sensor logic.

## Goal
Make `planet.x` and `planet.y` the authoritative source for a planet's position in the system view grid.

## Changes

### 1. `star-map-movement.service.ts`
Update `getPlanetGridPosition()` to return the planet's own `x`/`y` values instead of the formula:

```ts
getPlanetGridPosition(planet: PlanetTile): { col: number; row: number } {
  const col = planet.x;
  const row = planet.y;
  if (col < 1 || col > 18 || row < 1 || row > 10) {
    return {
      col: Math.max(1, 14 - planet.index * 2),
      row: 1 + ((planet.index * 3 + (planet.index % 2)) % 7),
    };
  }
  return { col, row };
}
```

The bounds check (1–18, 1–10) matches the system grid size and provides automatic fallback for old localStorage saves that still contain the previous meaningless `x`/`y` values.

Update the method's comment block to reflect the new behavior.

### 2. `star-map.models.ts`
Update the `PlanetTile` NOTE comment (around line 45) to state that `x`/`y` are now actively used as 1-indexed system grid cell coordinates.

### 3. `star-map-sensor.service.ts`
Update comments referencing `getPlanetGridPosition()` (lines 378, 402) to note that the returned coordinates come from `planet.x`/`planet.y`.

### 4. `star-map-data.json`
Already updated in prior steps: `xOffset`/`yOffset` removed, `x`/`y` set to concrete grid cells in the centered y range (2–6).

## Validation
- `npm run build` succeeds.
- In the running app, open SOL system: Veloria should render at grid position `x=10, y=5` (column 10, row 5), matching its JSON data.

## Risks
- Old save files with out-of-bounds `x`/`y` values will silently fall back to the index-based formula, so legacy saves remain playable.

# Fix Pre-existing TypeScript Build Errors

## Context

The project has pre-existing TypeScript build failures on `main` that prevent `npm run build` from succeeding. These errors exist before any currency-related changes and must be resolved to validate the implemented faction currency feature.

Errors observed on clean `main` (post-stash build):
1. `TS2352` — JSON-imported `starMapData` cannot be cast to `StarMapData` because `StarSystem` requires `gridCol`/`gridRow` that are absent in JSON.
2. `TS2339` — Template in `star-map-planet-screen.component.html` reports `PlanetBuilding` missing `x`, `y`, `size`.
3. `TS2305` — Import of `PLANET_SURFACE_CELL_VW` from `star-map.models` fails.

## Goal

Make `npm run build` succeed without errors (warnings are acceptable) so the application can be compiled and the currency display can be validated in the browser.

## Tasks

1. **Diagnose root cause**
   - Inspect `tsconfig.json` strictness settings and Angular compiler options.
   - Verify whether `star-map-planet-screen` imports resolve to the correct module path.
   - Check if there are duplicate or shadowed `PlanetBuilding` interfaces in the codebase.

2. **Fix `StarSystem` JSON cast**
   - Make `gridCol` and `gridRow` optional in the `StarSystem` interface, OR
   - Provide an initialization path that assigns these fields before any cast occurs, OR
   - Change `structuredClone(starMapData) as StarMapData` to a safe two-step construction that satisfies the type checker.

3. **Fix `PlanetBuilding` template errors**
   - Confirm the interface shape in `star-map.models.ts` matches template usage (`x`, `y`, `size`, `name`).
   - If the interface is correct but the compiler disagrees, check for stale build artifacts or path-resolution issues.

4. **Fix `PLANET_SURFACE_CELL_VW` import**
   - Confirm the export exists in `star-map.models.ts`.
   - If it exists but import fails, check for circular dependency or build-cache issues.

5. **Verify build**
   - Run `npm run build` and confirm zero TypeScript errors.
   - Run `git status` to ensure only intended files changed.

## Validation

- `npm run build` completes with exit code 0 and no `X [ERROR]` lines.
- Currency display renders left of the pause button in the top HUD.
- Save/load preserves faction currencies.

## Open Questions

- Are the `TS2339` / `TS2305` errors caused by a stale Angular build cache, or by actual source-code mismatches? Needs investigation in step 1.

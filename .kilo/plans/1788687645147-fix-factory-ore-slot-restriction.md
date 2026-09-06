# Fix: Spaceship Factory Should Not Require Ore-Slot Proximity

## Problem

The `spaceship_factory` building definition in `planet-data.json` has `"production": { "rawmaterials": 10 }`. The planet-screen placement logic (`star-map-planet-screen.component.ts:280`) infers ore-slot proximity requirements from this field:

```ts
const producesRawMaterials = (this.selectedBuildingType.production?.rawmaterials ?? 0) > 0;
```

This incorrectly forces **both** the `mining_complex` and the `spaceship_factory` to be placed near resource deposits. The economy system also reads `production.rawmaterials` from buildings, so simply removing the field from the factory would break raw-materials income.

## Goal

Only the mine building (`mining_complex`) should require ore-slot proximity. The factory should be placeable anywhere on the planet surface.

## Plan

### 1. Add an explicit placement-constraint flag to building definitions

In `src/app/components/star-map/planet-data.json`, add a new boolean field `requiresOreProximity` to each building definition:

- `mining_complex`: `"requiresOreProximity": true`
- All other buildings: `"requiresOreProximity": false` (or omit, defaulting to `false`)

### 2. Update placement validation logic

In `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts`, replace the implicit check at line 280:

```ts
// Before:
const producesRawMaterials = (this.selectedBuildingType.production?.rawmaterials ?? 0) > 0;

// After:
const requiresOreProximity = this.selectedBuildingType.requiresOreProximity === true;
```

### 3. Update unit tests

In `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.spec.ts`:

- Add a `spaceship_factory` entry to the mock `buildingTypes` array with `requiresOreProximity: false` and `production: { rawmaterials: 10 }`
- Add a test case: placing the factory **away** from resource tiles should be valid
- Add a test case: placing the factory **on top of** a resource tile should still be invalid (overlap rule)
- Ensure existing mine tests still pass

### 4. Verify economy tests remain green

Run the existing `economy.service.spec.ts` tests to confirm that removing the implicit coupling does not break raw-materials income calculations for the factory. No changes should be needed there because `production.rawmaterials` stays untouched.

## Validation

```bash
npm test -- --run
```

Focus on:
- `star-map-planet-screen.component.spec.ts`
- `economy.service.spec.ts`

## Files changed

| File | Change |
|------|--------|
| `src/app/components/star-map/planet-data.json` | Add `requiresOreProximity` field to relevant buildings |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts` | Use explicit flag instead of `production.rawmaterials` |
| `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.spec.ts` | Add factory placement tests |

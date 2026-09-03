# Fleet Sensor Range — Ship-Based Range

## Goal

Change fleet sensor range so that `Fleet.sensorRange` becomes a **minimum floor** (fixed at 3) rather than the actual range. The effective range is `max(fleet.sensorRange, maxShipRange)` where `maxShipRange` is the highest `range` value among all non-destroyed ships in the fleet (looked up from `ShipType`).

This means:
- A fleet with only scouts/frigates (range 3) keeps range 3.
- A fleet with a carrier (range 4) or battlecruiser/dreadnought (range 5) gets range 4/5.
- A fleet with no ships or all destroyed ships falls back to the minimum (3).

The `ShipType.range` field (already in `ship-data.json`, previously unused in gameplay logic per `docs/data-models.md:107`) is repurposed as the ship's sensor contribution. Ships with longer weapon range also have better sensors — a deliberate game design correlation.

See [Data Models](./data-models.md) and [Game Systems](./game-systems.md) for related context.

## Affected Files

| File | Change |
|------|--------|
| `src/app/components/star-map/star-map-sensor.service.ts` | Inject `ShipService`; add `getFleetSensorRange(fleet)`; replace hardcoded `fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE` |
| `src/app/components/star-map/star-map.ts` | Replace `fleet.sensorRange ?? 3` in `updateExploredPlanets` (line 1344) with `this.sensorService.getFleetSensorRange(fleet)` |
| `docs/invariants.md` | Update sensor range invariants to describe the minimum-floor + max-ship-range formula |
| `docs/data-models.md` | Update `Fleet.sensorRange` and `FleetShip`/`ShipType` docs |
| `docs/game-systems.md` | Update Fog of War player-fleet range description |
| `src/app/components/star-map/star-map-sensor.service.spec.ts` | **New file** — unit tests for `getFleetSensorRange` |

## Design Decisions

1. **Inject `ShipService` into `StarMapSensorService`** (not pass ship types as parameters). `ShipService` is a root singleton that only reads `ship-data.json` — no circular dependency (`ship.service.ts` does not import from the star-map component or sensor service). This keeps the sensor service self-contained and avoids threading ship types through every call site.

2. **Formula**: `effectiveRange = max(fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE, maxShipRange)`. `fleet.sensorRange` is treated as the minimum floor (always 3 per the data file and backward-compat default). `maxShipRange` is `Math.max(...nonDestroyedShips.map(s => shipType(s).range))` or `0` if no non-destroyed ships exist.

3. **Destroyed ships are excluded**. A destroyed ship cannot contribute sensor data. If all ships are destroyed, the range falls back to the floor.

4. **No changes to `star-map-data.json`**. Each fleet already has `"sensorRange": 3`, which now represents the minimum floor. Ship ranges are already defined in `ship-data.json`.

5. **No changes to `Fleet` model or save format**. The `sensorRange` field stays on `Fleet` but its semantic changes from "actual range" to "minimum floor". The existing backward-compat code in `loadGame()` (lines 1649–1652) that defaults missing `sensorRange` to 3 still applies and is now the floor default.

6. **No caching of computed ranges**. The game has only 4 fleets with ~3 ships each. Ship-type lookups are O(1) Map operations. Computing per-frame is negligible.

## Implementation Steps

### Step 1: Add `getFleetSensorRange` to `StarMapSensorService`

In `star-map-sensor.service.ts`:
- Add `import { ShipService } from '../../../services/ship.service';`
- Inject `private shipService: ShipService` in the constructor
- Add method:
```ts
getFleetSensorRange(fleet: Fleet): number {
  const floor = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;
  let maxShipRange = 0;
  for (const ship of fleet.ships) {
    if (ship.destroyed) continue;
    const type = this.shipService.getShipType(ship.type);
    if (type && type.range > maxShipRange) {
      maxShipRange = type.range;
    }
  }
  return Math.max(floor, maxShipRange);
}
```

### Step 2: Replace fleet range lookups in `StarMapSensorService`

- Line 125 (`computeGalaxySensorCells`): replace `const range = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;` with `const range = this.getFleetSensorRange(fleet);`
- Line 154 (`computeSystemSensorCells`): replace `const range = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;` with `const range = this.getFleetSensorRange(fleet);`
- Update the JSDoc comment at line 83 from `range = fleet.sensorRange (default 3)` to describe the new formula.

### Step 3: Replace fleet range lookup in `StarMap` component

In `star-map.ts` line 1344 (`updateExploredPlanets`):
- Replace `const range = fleet.sensorRange ?? 3;` with `const range = this.sensorService.getFleetSensorRange(fleet);`

### Step 4: Update documentation

- **`docs/invariants.md`** (line 103): Update to say `Fleet.sensorRange` is the minimum floor (default 3). Add invariant: "A fleet's effective sensor range is `max(fleet.sensorRange, max ship range)` where max ship range is the highest `ShipType.range` among the fleet's non-destroyed ships."
- **`docs/data-models.md`** (line 45, 84, 107): Update `Fleet.sensorRange` description to "minimum floor (default 3)". Update `ShipType.range` to note it is now used for sensor range. Update `FleetShip` note if needed.
- **`docs/game-systems.md`** (line 21): Update player-fleet range description to describe the minimum-floor + max-ship-range formula.

### Step 5: Add unit tests

Create `star-map-sensor.service.spec.ts` testing `getFleetSensorRange`:
- Fleet with only range-3 ships → returns 3 (floor)
- Fleet with a range-5 ship → returns 5
- Fleet with mixed ships (range 2, 3, 5) → returns 5
- Fleet with all destroyed ships → returns floor (3)
- Fleet with no ships → returns floor (3)
- Fleet with `sensorRange` explicitly set above all ship ranges → returns the floor

## Edge Cases

- **Empty fleet (no ships)**: `maxShipRange = 0`, `effectiveRange = max(3, 0) = 3`. ✓
- **All ships destroyed**: ships skipped, `maxShipRange = 0`, `effectiveRange = 3`. ✓
- **Ship type not found** (defensive): skipped, doesn't affect result. ✓
- **Old save without `sensorRange`**: backward-compat code sets `fleet.sensorRange = 3`, used as floor. ✓
- **Enemy fleets**: they do not go through sensor range computation (only player fleets are processed in `computeGalaxySensorCells` and `updateExploredPlanets`), so the change only affects player fleet sensor/visibility. ✓

## Validation

1. Run lint and typecheck: `npm run lint` and `npm run typecheck` (or tsc).
2. Run unit tests: `npm test`.
3. Manual check: verify that a fleet with a scout (range 3) has sensor range 3, and a fleet with a battlecruiser (range 5) has sensor range 5 on the galaxy map.

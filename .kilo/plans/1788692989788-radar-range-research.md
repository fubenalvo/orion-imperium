# Plan: Radar Range Research Tree (3 Levels)

## Goal
Add three research levels that increase the galaxy-map sensor range (grid visibility) for player fleets and owned star systems. Each level adds +1 to both fleet and system sensor range.

## Decision Summary

- Use a generic `bonuses` array on `Technology` so the system can be reused for future bonuses.
- Each radar research tech grants `{ type: 'sensorRange', value: 1 }`.
- `ResearchService.getSensorRangeBonus(faction)` sums all `sensorRange` bonuses from researched technologies.
- `StarMapSensorService` receives the player faction and adds the bonus to fleet range and `PLAYER_SYSTEM_SENSOR_RANGE`.
- The bonus is additive on top of existing ship-type ranges and the 5-cell system base.

## Files to Modify

1. **`src/app/components/star-map/star-map.models.ts`**
   - Add `bonuses?: { type: 'sensorRange'; value: number }[]` to `Technology`.

2. **`src/app/services/research.service.ts`**
   - Add `getSensorRangeBonus(faction: Faction): number` that sums `bonus.value` for all researched techs with `bonus.type === 'sensorRange'`.

3. **`src/app/components/star-map/star-map-sensor.service.ts`**
   - Inject `ResearchService`.
   - Change `getFleetSensorRange(fleet, faction?)` to accept an optional faction and add `researchService.getSensorRangeBonus(faction)` to the effective range when provided.
   - Change `computeGalaxySensorCells` to find the player faction internally and pass it to `getFleetSensorRange` and to a new `getPlayerSystemSensorRange(factions)` helper.
   - `getPlayerSystemSensorRange` returns `PLAYER_SYSTEM_SENSOR_RANGE + researchService.getSensorRangeBonus(playerFaction)`.

4. **`src/app/components/star-map/research-tree.json`**
   - Add three new technologies after `basic_power` (or after the last existing level-1 tech), forming a chain:
     - `basic_radar` — prereq: `basic_science`, cost: 100, +1 sensor range
     - `advanced_radar` — prereq: `basic_radar`, cost: 250, +1 sensor range
     - `long_range_radar` — prereq: `advanced_radar`, cost: 500, +1 sensor range
   - No `unlocksShips` or `unlocksBuildings` needed.

5. **`src/app/services/research.service.spec.ts`**
   - Add tests for `getSensorRangeBonus`:
     - returns 0 when no bonus techs researched
     - returns correct sum when one/multiple bonus techs researched

6. **`src/app/components/star-map/star-map-sensor.service.spec.ts`**
   - Add tests for `getFleetSensorRange` with faction bonus applied.

## Data Flow

```
StarMap.updateSensorVisibility()
  → sensorService.computeGalaxySensorCells(fleets, systems, factions, ...)
      → finds player faction from factions[]
      → for each player fleet: range = getFleetSensorRange(fleet, playerFaction)
          = max(floor, maxShipRange) + researchBonus
      → player systems: range = PLAYER_SYSTEM_SENSOR_RANGE + researchBonus
```

## Edge Cases

- Player faction not found in factions array → bonus = 0 (safe fallback).
- `faction.researchedTechnologies` undefined → handled by existing `getResearchedTechnologies`.
- Bonuses stack additively (Level 1 = +1, Level 2 = +2, Level 3 = +3).
- Existing ship-type range still acts as a floor above the research bonus.

## Validation

- Run unit tests: `npm run test` (or equivalent).
- Run lint/typecheck: `npm run lint` and `npm run typecheck`.
- Verify in-game that researching each tier visibly expands the sensor grid and preview halo.

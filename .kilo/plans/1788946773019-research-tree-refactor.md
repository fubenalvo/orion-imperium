# Research Tree Refactor Plan

## Current State
- `research-tree.json`: 18 technologies, mostly flat, weak prerequisites
- Starting techs: `basic_engineering`, `basic_science`, `basic_industry`, `basic_power`
- `ResearchService`: generic, data-driven, supports multiple prerequisites already
- AI colonization checks: `isResearched(basic_engineering)` + `isShipUnlocked(colonizer)`
- Save/load: preserves `researchedTechnologies` array
- ProductionService: no research checks, only factory availability
- UI: flat grid showing all techs with prerequisite text

## Target Tree Structure

### Roots (unchanged)
- `basic_engineering` (cost 0)
- `basic_science` (cost 0)
- `basic_industry` (cost 0)
- `basic_power` (cost 0)

### Branch: Engineering / Construction
- `basic_engineering`
  - `advanced_engineering` (cost 150)
    - `advanced_construction` (cost 250)
      - `medium_residential` (unlocks building)
      - `large_residential` (unlocks building)
  - `military_engineering` (cost 200)
    - `advanced_weapons` (cost 350)
      - `capital_ship_technology` (cost 500)
  - `orbital_engineering` (cost 300)
    - `advanced_shipyards` (cost 400)

### Branch: Industry
- `basic_industry`
  - `advanced_industry` (cost 150)
    - `advanced_manufacturing` (cost 300)
      - `orbital_engineering` (shared with engineering branch)

### Branch: Power
- `basic_power`
  - `improved_power` (cost 100)
    - `fusion_power` (cost 200)
      - `advanced_power` (cost 300)

### Branch: Science
- `basic_science`
  - `advanced_science` (cost 150)
    - `advanced_research` (cost 250)
      - `applied_science` (cost 400)

### Branch: Sensors
- `basic_science`
  - `basic_radar` (cost 100)
    - `advanced_radar` (cost 250)
      - `long_range_radar` (cost 500)

### Branch: Military Defense
- `military_engineering`
  - `planetary_shield` (unlocks building via shared tech or new tech)
- `basic_engineering`
  - `laser_turret` / `missile_turret` (unlocked via military_engineering or new tech)

### Ship Technology Tree
- `basic_engineering`
  - `scout_technology` (cost 50) → unlocks scout
  - `fighter_technology` (cost 75) → unlocks fighter
- `advanced_engineering`
  - `corvette_technology` (cost 150) → unlocks corvette
  - `frigate_technology` (cost 200) → unlocks frigate
- `military_engineering`
  - `destroyer_technology` (cost 250) → unlocks destroyer
- `advanced_shipyards`
  - `cruiser_technology` (cost 400) → unlocks cruiser
  - `carrier_technology` (cost 450) → unlocks carrier
- `capital_ship_technology`
  - `battleship_technology` (cost 600) → unlocks battleship
  - `battlecruiser_technology` (cost 650) → unlocks battlecruiser
  - `dreadnought_technology` (cost 800) → unlocks dreadnought
- `advanced_construction` + `advanced_science`
  - `colonization_technology` (cost 300) → unlocks colonizer

### Building Unlocks (mapped to techs)
- `basic_engineering`: spaceship_factory, spaceport, laser_turret, missile_turret
- `basic_industry`: small_residential, mining_complex
- `basic_power`: solar_array
- `basic_science`: small_research_lab
- `advanced_construction`: medium_residential
- `advanced_construction` + `advanced_industry`: large_residential
- `military_engineering`: planetary_shield
- `advanced_research`: research_lab
- `advanced_industry`: entertainment_center
- `fusion_power`: fusion_plant
- `advanced_science`: hospital, school (social tier)

## Critical Constraints
1. `basic_engineering` must remain a starting tech (AI checks it)
2. Some researched tech must unlock `colonizer` ship (AI checks `isShipUnlocked(colonizer)`)
3. All existing `unlocksShips` and `unlocksBuildings` IDs must remain valid
4. `researchedTechnologies` array format unchanged for save compatibility
5. No hardcoded tech IDs added to ResearchService

## Validation Rules (add to ResearchService)
- Duplicate technology IDs
- Missing prerequisite IDs
- Self-referencing prerequisites
- Circular dependencies
- Technologies referencing nonexistent ships
- Technologies referencing nonexistent buildings

Run validation once at construction/load, not per-frame.

## Implementation Tasks

### 1. Update `research-tree.json`
- Replace with new tree structure above
- Keep all ship type IDs and building IDs in `unlocksShips`/`unlocksBuildings`
- Ensure every non-basic tech has at least one prerequisite
- Ensure graph is acyclic

### 2. Update `ResearchService`
- Add `validateTechnologies()` method
- Call validation in constructor after loading JSON
- Add public `getValidationErrors()` for testing
- Keep all existing public methods unchanged

### 3. Update Tests (`research.service.spec.ts`)
- Add tests for validation (missing prereq, circular, self-ref, duplicate IDs)
- Add tests for multiple prerequisites
- Add test for each ship type unlock
- Add test for residential progression
- Add test for colonizer unlock path
- Update existing tests to match new tree costs/names
- Add save/load compatibility test

### 4. Verify AI Compatibility
- AI colonization uses `basic_engineering` + `isShipUnlocked(colonizer)` - both must work
- AI develop uses `isBuildingUnlocked` - all building IDs must remain valid
- No changes needed to AI services if research-tree.json is correct

### 5. Verify UI
- Current UI already renders prerequisites as text
- No structural UI changes required for dependency display
- Flat grid still works for the new tree

## Out of Scope
- UI redesign/visualization of tree branches
- AI research behavior (AI doesn't research currently)
- Production research checks (not requested)
- Fleet assembly research checks

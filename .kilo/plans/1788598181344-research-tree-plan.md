# Research Tree Implementation Plan

## 1. New Files to Create

| File | Purpose |
|------|---------|
| `src/app/components/star-map/research-tree.json` | Data-driven tech tree definition (~15 technologies) |
| `src/app/services/research.service.ts` | Research logic: load JSON, check unlocks, spend points, track state |
| `src/app/components/star-map/star-map-research-tree/star-map-research-tree.component.ts` | Research Tree modal component |
| `src/app/components/star-map/star-map-research-tree/star-map-research-tree.component.html` | Tree template (CSS grid layout) |
| `src/app/components/star-map/star-map-research-tree/star-map-research-tree.component.scss` | Styles using existing `panel-style` language |
| `src/app/services/research.service.spec.ts` | Unit tests for research logic |

## 2. Existing Files to Modify

### `src/app/components/star-map/star-map.models.ts`
- Add `Technology` interface:
  ```ts
  export interface Technology {
    id: string;
    name: string;
    description: string;
    researchCost: number;
    prerequisites: string[];
    unlocksShips: string[];
    unlocksBuildings: string[];
  }
  ```
- Add `researchedTechnologies: string[]` to the `Faction` interface.

### `src/app/components/star-map/faction-currencies/faction-currencies.component.ts`
- Add `@Output() openResearchTree = new EventEmitter<void>()`.
- Replace the research icon click handler: emit `openResearchTree` instead of calling `toggleBreakdown('research')`.
- Keep `toggleBreakdown` for credits/rawmaterials.

### `src/app/components/star-map/faction-currencies/faction-currencies.component.html`
- Change research icon click binding to `(click)="openResearchTree.emit()"`.

### `src/app/components/star-map/star-map-header/star-map-header.component.ts`
- Add `@Output() openResearchTree = new EventEmitter<void>()`.
- Bind it in the template from `FactionCurrenciesComponent`.

### `src/app/components/star-map/star-map-header/star-map-header.component.html`
- Add `(openResearchTree)="openResearchTree.emit()"` to the `app-faction-currencies` element.

### `src/app/components/star-map/star-map.ts`
- Import `ResearchService` and `StarMapResearchTreeComponent`.
- Add UI state: `showResearchTree = false`.
- Add handlers: `openResearchTree()`, `onResearchTreeClosed()`.
- Add getters:
  - `getPlayerResearchedTechnologies(): string[]`
  - `isBuildingUnlocked(buildingId: string): boolean`
- Update `getProductionPanelVm()`: filter `buildable` ships to only those where `researchService.isShipUnlocked(type.id)` is true.
- Update `getSpaceportPanelVm()`: filter `available` ships to only those where `researchService.isShipUnlocked(entry.typeId)` is true.
- Pass `isBuildingUnlocked` into `StarMapPlanetScreenComponent` via `@Input`.
- Add `StarMapResearchTreeComponent` to `@Component.imports`.
- Add the modal to `star-map.html`:
  ```html
  @if (showResearchTree) {
    <app-star-map-research-tree
      [faction]="playerFaction"
      (close)="onResearchTreeClosed()"
      (researched)="onTechnologyResearched($event)"
    ></app-star-map-research-tree>
  }
  ```

### `src/app/components/star-map/star-map.html`
- Render the `StarMapResearchTreeComponent` modal as shown above.

### `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.ts`
- Add `@Input() isBuildingUnlocked: (id: string) => boolean = () => false`.

### `src/app/components/star-map/star-map-planet-screen/star-map-planet-screen.component.html`
- In the build list, add a disabled state and lock indicator for buildings where `!isBuildingUnlocked(building.id)`.

### `src/app/services/save-game.service.ts`
- In `migrateSave()`, backfill `researchedTechnologies` on every faction that lacks it:
  ```ts
  for (const faction of data.factions ?? []) {
    if (!faction.researchedTechnologies) {
      faction.researchedTechnologies = [
        'basic_engineering',
        'basic_science',
        'basic_industry',
        'basic_power',
      ];
    }
  }
  ```

## 3. JSON Location and Structure

**File:** `src/app/components/star-map/research-tree.json`

```json
{
  "technologies": [
    {
      "id": "basic_engineering",
      "name": "Basic Engineering",
      "description": "Fundamentals of spacecraft construction.",
      "researchCost": 0,
      "prerequisites": [],
      "unlocksShips": ["scout", "fighter", "colonizer"],
      "unlocksBuildings": ["spaceship_factory", "spaceport", "laser_turret", "missile_turret"]
    },
    {
      "id": "basic_science",
      "name": "Basic Science",
      "description": "Establish research infrastructure.",
      "researchCost": 0,
      "prerequisites": [],
      "unlocksShips": [],
      "unlocksBuildings": ["small_research_lab"]
    },
    {
      "id": "basic_industry",
      "name": "Basic Industry",
      "description": " rudimentary production and mining.",
      "researchCost": 0,
      "prerequisites": [],
      "unlocksShips": [],
      "unlocksBuildings": ["small_residential", "mining_complex"]
    },
    {
      "id": "basic_power",
      "name": "Basic Power",
      "description": "Solar energy collection.",
      "researchCost": 0,
      "prerequisites": [],
      "unlocksShips": [],
      "unlocksBuildings": ["solar_array"]
    },
    {
      "id": "advanced_engineering",
      "name": "Advanced Engineering",
      "description": "Improved hull design and construction.",
      "researchCost": 150,
      "prerequisites": ["basic_engineering"],
      "unlocksShips": ["corvette", "frigate"],
      "unlocksBuildings": ["medium_residential"]
    },
    {
      "id": "military_engineering",
      "name": "Military Engineering",
      "description": "Defensive and military infrastructure.",
      "researchCost": 200,
      "prerequisites": ["basic_engineering"],
      "unlocksShips": ["destroyer"],
      "unlocksBuildings": ["planetary_shield", "hospital", "school"]
    },
    {
      "id": "industrial_engineering",
      "name": "Industrial Engineering",
      "description": "Optimized production chains.",
      "researchCost": 150,
      "prerequisites": ["basic_industry"],
      "unlocksShips": [],
      "unlocksBuildings": ["large_residential", "park"]
    },
    {
      "id": "fusion_power",
      "name": "Fusion Power",
      "description": "Harnessing fusion energy.",
      "researchCost": 200,
      "prerequisites": ["basic_power"],
      "unlocksShips": [],
      "unlocksBuildings": ["fusion_plant"]
    },
    {
      "id": "advanced_research",
      "name": "Advanced Research",
      "description": "High-capacity research facilities.",
      "researchCost": 200,
      "prerequisites": ["basic_science"],
      "unlocksShips": [],
      "unlocksBuildings": ["research_lab"]
    },
    {
      "id": "orbital_engineering",
      "name": "Orbital Engineering",
      "description": "Large-scale orbital construction.",
      "researchCost": 300,
      "prerequisites": ["advanced_engineering"],
      "unlocksShips": [],
      "unlocksBuildings": []
    },
    {
      "id": "advanced_industry",
      "name": "Advanced Industry",
      "description": "Fully automated production.",
      "researchCost": 300,
      "prerequisites": ["industrial_engineering"],
      "unlocksShips": [],
      "unlocksBuildings": ["entertainment_center"]
    },
    {
      "id": "advanced_power_systems",
      "name": "Advanced Power Systems",
      "description": "Next-generation energy management.",
      "researchCost": 300,
      "prerequisites": ["fusion_power"],
      "unlocksShips": [],
      "unlocksBuildings": []
    },
    {
      "id": "applied_science",
      "name": "Applied Science",
      "description": "Converting theory into technology.",
      "researchCost": 300,
      "prerequisites": ["advanced_research"],
      "unlocksShips": [],
      "unlocksBuildings": []
    },
    {
      "id": "advanced_shipyards",
      "name": "Advanced Shipyards",
      "description": "Constructing capital ships.",
      "researchCost": 400,
      "prerequisites": ["orbital_engineering"],
      "unlocksShips": ["cruiser", "carrier"],
      "unlocksBuildings": []
    },
    {
      "id": "advanced_weapons",
      "name": "Advanced Weapons",
      "description": "Heavy armament systems.",
      "researchCost": 400,
      "prerequisites": ["military_engineering"],
      "unlocksShips": ["battleship", "battlecruiser", "dreadnought"],
      "unlocksBuildings": []
    }
  ]
}
```

All `unlocksShips` and `unlocksBuildings` values reference existing IDs from `ship-data.json` and `planet-data.json`.

## 4. ResearchState Location

Research state lives on the `Faction` model as:
```ts
researchedTechnologies: string[];
```

This is the smallest appropriate scope because:
- Research is empire-wide, not per-planet.
- `Faction` is already the owner of `currencies`.
- `StarMapData` already contains `factions`, so persistence is automatic once `Faction` is updated.

## 5. Save/Load Migration

`SaveGameService.migrateSave()` iterates over `data.factions` and backfills `researchedTechnologies` with the four starting technologies when the field is missing. This keeps old saves backward-compatible and gives new players the intended starting techs.

## 6. Building Unlock Integration

- `StarMap.getProductionPanelVm()` filters ship types.
- `StarMapPlanetScreenComponent` receives `isBuildingUnlocked(buildingId)` as an `@Input`.
- The BUILD tab renders all buildings, but locked buildings get a disabled button with a lock visual and a tooltip explaining the required technology.

## 7. Ship Unlock Integration

- `StarMap.getProductionPanelVm()` calls `researchService.isShipUnlocked(type.id)` before adding a ship type to the `buildable` array.
- `StarMap.getSpaceportPanelVm()` filters the `available` stock entries the same way.
- No changes to `ProductionService` or `FleetAssemblyService` are required because they already operate on whatever list they are given.

## 8. Header → Research Tree Flow

1. Player clicks the research icon in `FactionCurrenciesComponent`.
2. `FactionCurrenciesComponent` emits `openResearchTree`.
3. `StarMapHeaderComponent` re-emits `openResearchTree`.
4. `StarMap` sets `showResearchTree = true`.
5. `star-map.html` renders `app-star-map-research-tree`.
6. Closing the modal emits `close`, resetting `showResearchTree`.

## 9. Research Tree UI Implementation

- Standalone component `StarMapResearchTreeComponent` rendered as a full-screen overlay in `star-map.html`.
- Visual style: reuse `panel-style` class, dark semi-transparent backdrop.
- Layout: CSS Grid (3–4 columns) of technology nodes.
- Nodes show: name, cost, description, status badge (Researched / Available / Locked).
- Prerequisites are shown as connecting lines (CSS pseudo-elements or simple borders).
- Available nodes have a "RESEARCH" button; disabled when `faction.currencies['research'] < tech.researchCost`.
- Researched nodes show a checkmark.
- Locked nodes are dimmed and show missing prerequisites.

## 10. Tests to Add

**`src/app/services/research.service.spec.ts`** (unit tests):
1. Starting technologies are marked researched by default after migration.
2. A tech with an unmet prerequisite is `locked`.
3. A tech becomes `available` once its last prerequisite is researched.
4. Researching deducts the correct amount from `faction.currencies['research']`.
5. A technology cannot be researched twice.
6. `isShipUnlocked(scout)` returns true when its unlock tech is researched.
7. `isBuildingUnlocked(spaceship_factory)` returns true when its unlock tech is researched.
8. Save/load preserves `researchedTechnologies` (integration via `SaveGameService` test).
9. Loading a legacy save without `researchedTechnologies` backfills the four starting techs.
10. Locked building is not constructible in `StarMap.onBuildingConfirmed()` (integration test).
11. Locked ship is not present in `getProductionPanelVm().buildable` and `getSpaceportPanelVm().available`.

## 11. Execution Order

1. Add `Technology` interface and `researchedTechnologies` to `Faction`.
2. Create `research-tree.json`.
3. Create `ResearchService` with unit tests.
4. Add save migration to `SaveGameService`.
5. Modify `FactionCurrenciesComponent` and header to emit `openResearchTree`.
6. Create `StarMapResearchTreeComponent` (UI).
7. Wire modal into `StarMap` and `star-map.html`.
8. Update Build, Production, and Spaceport view models to respect unlocks.
9. Run lint and tests, verify.

# Default Start View Configuration

## Goal
Allow `star-map-data.json` to declare the initial view when starting a new game. The game should launch directly into the configured view (planet, system, or map) with the correct selection and camera state.

## Current Behavior
- `star-map.ts:128` hardcodes `currentView = 'map'` for every new session.
- `StarMapData` already has `currentView`, `selectedSystemId`, `selectedPlanetTileId`, `cameraX`, `cameraY` fields, but they are only populated by `saveGame()` and restored by `loadGame()`.
- For a brand-new game, `loadGame()` reads the freshly-cloned JSON; since the JSON lacks `currentView`, it always falls back to `'map'`.

## Planned Changes

### 1. `src/app/components/star-map/star-map-data.json`
Add a `defaultView` object as the **first** property in the root object:

```json
{
  "defaultView": {
    "type": "planet",
    "systemId": "sol",
    "planetId": 1
  },
  "factions": [ ... ]
}
```

Schema for `defaultView`:
- `type`: `"map" | "system" | "planet"` (required)
- `systemId`: string (required for `"system"` and `"planet"`)
- `planetId`: number (required for `"planet"`)
- `cameraX`: number (optional, for `"map"`)
- `cameraY`: number (optional, for `"map"`)

### 2. `src/app/components/star-map/star-map.models.ts`
Extend `StarMapData`:

```typescript
defaultView?: {
  type: 'map' | 'system' | 'planet';
  systemId?: string;
  planetId?: number;
  cameraX?: number;
  cameraY?: number;
};
```

### 3. `src/app/components/star-map/star-map.ts`

**a. Add `applyDefaultView()` method** (private):

```typescript
private applyDefaultView(defaultView: StarMapData['defaultView']): void {
  if (!defaultView) return;

  switch (defaultView.type) {
    case 'map':
      this.currentView = 'map';
      this.cameraX = defaultView.cameraX ?? 0;
      this.cameraY = defaultView.cameraY ?? 0;
      this.selectedSystem = null;
      this.selectedPlanetTile = null;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
      break;

    case 'system': {
      const system = this.starSystems.find(s => s.id === defaultView.systemId);
      if (!system) {
        this.currentView = 'map';
        this.selectedSystem = null;
        this.selectedPlanetTile = null;
        break;
      }
      this.currentView = 'system';
      this.selectedSystem = system;
      this.selectedPlanetTile = null;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
      this.initFleetsInSystem(system);
      this.syncTargetFromSelectedFleet();
      break;
    }

    case 'planet': {
      const system = this.starSystems.find(s => s.id === defaultView.systemId);
      const planet = system?.planetsTiles?.find(p => p.id === defaultView.planetId);
      if (!system || !planet) {
        this.currentView = 'map';
        this.selectedSystem = null;
        this.selectedPlanetTile = null;
        break;
      }
      this.currentView = 'planet';
      this.selectedSystem = system;
      this.selectedPlanetTile = planet;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
      this.initFleetsInSystem(system);
      this.syncTargetFromSelectedFleet();
      break;
    }

    default:
      this.currentView = 'map';
      this.selectedSystem = null;
      this.selectedPlanetTile = null;
      this.cameraX = 0;
      this.cameraY = 0;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
  }
}
```

**b. Modify `loadGame()`** — replace the view-state restoration block:

Current (lines 2299–2309):
```typescript
this.currentView = data.currentView ?? 'map';
this.cameraX = data.cameraX ?? 0;
this.cameraY = data.cameraY ?? 0;
this.targetX = data.targetX ?? null;
this.targetY = data.targetY ?? null;
this.selectedFleetAction = data.selectedFleetAction ?? null;

this.selectedSystem = this.starSystems.find((s) => s.id === data.selectedSystemId) ?? null;
this.selectedFleet = this.fleets.find((f) => f.id === data.selectedFleetId) ?? null;
this.selectedPlanetTile =
  this.selectedSystem?.planetsTiles?.find((p) => p.id === data.selectedPlanetTileId) ?? null;
```

New:
```typescript
// View state: saved runtime state takes precedence over defaultView config.
// defaultView is only applied when there is no saved view state (i.e., new game).
if (data.currentView) {
  this.currentView = data.currentView;
  this.cameraX = data.cameraX ?? 0;
  this.cameraY = data.cameraY ?? 0;
  this.targetX = data.targetX ?? null;
  this.targetY = data.targetY ?? null;
  this.selectedFleetAction = data.selectedFleetAction ?? null;
} else if (data.defaultView) {
  this.applyDefaultView(data.defaultView);
} else {
  this.currentView = 'map';
  this.cameraX = 0;
  this.cameraY = 0;
  this.targetX = null;
  this.targetY = null;
  this.selectedFleetAction = null;
}

// Selection state: saved IDs take precedence; fall back to whatever applyDefaultView set.
this.selectedSystem = this.starSystems.find((s) => s.id === data.selectedSystemId) ?? this.selectedSystem;
this.selectedFleet = this.fleets.find((f) => f.id === data.selectedFleetId) ?? null;
this.selectedPlanetTile =
  this.selectedSystem?.planetsTiles?.find((p) => p.id === data.selectedPlanetTileId) ?? this.selectedPlanetTile;
```

**c. Keep `saveGame()` unchanged.**  
`defaultView` is static config, not runtime state. It should not be written back into save files.

## Validation
1. Start a new game → should open directly on Earth (SOL, planet id 1) in planet view.
2. Save, exit, reload → should restore to the saved view (not re-apply `defaultView`), because `saveGame()` writes `currentView`.
3. Start a new game with `"type": "system", "systemId": "sol"` → should open in SOL system view.
4. Start a new game with `"type": "map", "cameraX": 150, "cameraY": 25` → should open in map view centered at those coordinates.
5. Invalid `systemId` / `planetId` → gracefully falls back to `'map'` view instead of crashing.

## Backward Compatibility
- Old save files without `currentView` or `defaultView` continue to default to `'map'`.
- Old save files with `currentView` but no `defaultView` continue to restore the saved view.
- `defaultView` is never persisted into saves, so changing the JSON config does not corrupt existing save slots.

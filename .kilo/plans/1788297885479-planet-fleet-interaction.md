# Planet-Fleet Interaction Implementation Plan

## Overview

Implements the interaction between fleets and planets in the star system view, including fleet movement restrictions, planet colonization, and planet defense battles.

## Design Decisions

| Decision | Choice |
|---|---|
| Colonizer ship | New `colonizer` type in ship-data.json (attack: 2, defense: 2, HP: 30, cost: 100) |
| No colonizer on uninhabited | Fleet orbits only, no colonization |
| Defense buildings | Each building = 1 virtual ship instance |
| Planetary shield | Static HP buffer (no regen during battle) |
| Battle winner | Attacker controls planet, fleet becomes garrison |
| Garrison + defenses | Combined virtual fleet on defender side |
| Uninhabited auto-resolve | No battle screen, instant resolve |

## Implementation Steps

### 1. Add Colonizer Ship Type

**File**: `src/app/components/star-map/ship-data.json`

Add new entry to `shipTypes` array:

```json
{
  "id": "colonizer",
  "name": "Colonizer",
  "role": "Colonizer",
  "hitPoints": 30,
  "shield": 10,
  "shieldRegen": 1,
  "attack": 2,
  "attackType": "kinetic",
  "weakness": "energy",
  "defense": 2,
  "speed": 3,
  "range": 1,
  "cost": 100,
  "maintenanceCost": 5
}
```

### 2. Create Planet Battle Service

**New file**: `src/app/services/planet-battle.service.ts`

Responsibilities:
- `createVirtualDefenseFleet(planet, garrisonFleet)` → `Fleet`
  - Iterates `planet.buildings` filtered by `role === 'defense'`
  - For each building, looks up stats from `planet-data.json`
  - Creates a virtual `FleetShip` per building instance:
    - Turrets: `type: building.id`, `name: building.name`, HP from building stats
    - Shield buildings: contribute to a shared shield pool on the virtual fleet
  - If `garrisonFleet` provided, appends its ships to the virtual fleet
  - Returns a synthetic `Fleet` object for use in `BattleService`

- `resolvePlanetBattle(attackerFleet, planet, garrisonFleet)` → `BattleResult`
  - If planet is uninhabited AND has no defense buildings:
    - If attacker has colonizer → colonize (consume colonizer, set `planet.factionId = attacker.factionId`)
    - If no colonizer → occupy only (no ownership change)
    - Return result without showing battle screen
  - If planet has defenses OR is owned by another faction:
    - Create virtual defense fleet
    - Set up battle via `BattleService.setBattle()`
    - Navigate to `/battle`

### 3. Extend Battle Service for Planet Context

**File**: `src/app/services/battle.service.ts`

Add new fields to `Battle` interface:
```ts
export interface Battle {
  // ... existing fields ...
  type?: 'fleet' | 'planet';
  planetId?: number;       // for planet battles
  capturedPlanetId?: number; // set after attacker wins
}
```

Modify `BattleService`:
- `setPlanetBattle(battle: Battle)` — sets battle with `type: 'planet'`
- After battle ends, if winner is attacker and battle type is planet:
  - Set `capturedPlanetId` on battle
  - StarMap reads this to apply planet ownership change

### 4. Add Fleet Movement Validation

**File**: `src/app/components/star-map/star-map.ts`

Modify `moveSelectedFleet(x, y)` to validate target:

```ts
private canMoveFleetTo(planet: PlanetFleetCell): 'allowed' | 'blocked-ours' | 'blocked-enemy' | 'blocked-team' {
  const targetPlanet = this.getPlanetAtCell(x, y);
  if (!targetPlanet) return 'allowed'; // empty space, always allowed
  
  const faction = this.factions.find(f => f.id === targetPlanet.factionId);
  const playerFaction = this.factions.find(f => f.id === 'player');
  
  if (!faction || !playerFaction) return 'allowed';
  
  // Check if any fleet already on this planet
  const fleetOnPlanet = this.getFleetOnPlanet(targetPlanet);
  
  if (targetPlanet.factionId === 'unhabited') {
    return 'allowed'; // can always move to uninhabited
  }
  
  if (faction.team === playerFaction.team && targetPlanet.factionId !== 'player') {
    return 'blocked-team'; // teammate's planet, cannot attack
  }
  
  if (targetPlanet.factionId === 'player') {
    if (fleetOnPlanet) return 'blocked-ours'; // our planet with fleet on it
    return 'allowed'; // our planet, no fleet
  }
  
  return 'allowed'; // enemy planet
}
```

### 5. Handle Fleet Arrival at Planets

**File**: `src/app/components/star-map/star-map.ts`

Replace/augment `checkFleetPlanetArrivals()`:

```ts
private checkFleetPlanetArrivals(): void {
  if (this.currentView !== 'system' || !this.selectedSystem) return;

  for (const fleet of this.fleets) {
    if (fleet.destroyed || fleet.system?.id !== this.selectedSystem.id) continue;
    if (fleet.system.targetX != null || fleet.system.targetY != null) continue; // still moving

    const fleetCell = this.movementService.calculateSystemGridCell(fleet.system.x, fleet.system.y);
    
    for (const planet of this.selectedSystem.planetsTiles) {
      const planetCell = this.movementService.getPlanetGridPosition(planet);
      if (fleetCell.col !== planetCell.col || fleetCell.row !== planetCell.row) continue;
      
      const lastPlanetId = this.fleetPlanetMap.get(fleet.id);
      if (lastPlanetId === planet.id) continue; // already processed
      
      this.fleetPlanetMap.set(fleet.id, planet.id);
      this.handleFleetPlanetArrival(fleet, planet);
      break;
    }
  }
}

private handleFleetPlanetArrival(fleet: Fleet, planet: PlanetTile): void {
  // Determine if this triggers colonization, battle, or just orbit
  if (planet.factionId === 'unhabited') {
    const hasColonizer = fleet.ships.some(s => s.type === 'colonizer' && !s.destroyed);
    if (hasColonizer) {
      // Consume colonizer and claim planet
      const colonizerIdx = fleet.ships.findIndex(s => s.type === 'colonizer' && !s.destroyed);
      if (colonizerIdx >= 0) fleet.ships.splice(colonizerIdx, 1);
      planet.factionId = fleet.factionId;
      this.saveGame();
    }
    // else: fleet just orbits
    return;
  }
  
  if (planet.factionId === fleet.factionId) {
    // Our own planet - fleet becomes garrison (no action needed)
    return;
  }
  
  // Enemy or teammate planet - check teams
  const planetFaction = this.factions.find(f => f.id === planet.factionId);
  const fleetFaction = this.factions.find(f => f.id === fleet.factionId);
  
  if (!planetFaction || !fleetFaction) return;
  
  if (planetFaction.team === fleetFaction.team) {
    // Same team - cannot attack (already validated, but double-check)
    return;
  }
  
  // Enemy planet - trigger battle
  this.triggerPlanetBattle(fleet, planet);
}
```

### 6. Implement Planet Battle Trigger

**File**: `src/app/components/star-map/star-map.ts`

```ts
private triggerPlanetBattle(attackerFleet: Fleet, targetPlanet: PlanetTile): void {
  // Find garrison fleet - ONLY fleets belonging to the planet's owner faction
  const garrisonFleet = this.getFleetOnPlanet(targetPlanet);
  
  // Create virtual defense fleet from planet buildings + garrison
  const defenseFleet = this.planetBattleService.createVirtualDefenseFleet(targetPlanet, garrisonFleet);
  
  const attackerFaction = this.factions.find(f => f.id === attackerFleet.factionId)!;
  const defenderFaction = this.factions.find(f => f.id === targetPlanet.factionId)!;
  
  this.battleService.setPlanetBattle({
    fleet1: attackerFleet,
    fleet2: defenseFleet,
    faction1Name: attackerFaction.name,
    faction1Color: attackerFaction.color,
    faction2Name: defenderFaction.name,
    faction2Color: defenderFaction.color,
    attackerId: attackerFleet.id,
    defenderId: defenseFleet.id,
    planetId: targetPlanet.id,
  });
  
  this.saveGame();
  this.ngZone.run(() => this.router.navigate(['/battle']));
}
```

### 6a. Fix `getFleetOnPlanet` — Filter by Faction

**File**: `src/app/components/star-map/star-map.ts`

The `getFleetOnPlanet` function MUST filter by faction to only return fleets belonging to the planet's owner. Without this filter, the attacking fleet itself could be returned as the "garrison", causing it to fight on both sides.

```ts
/** Returns a garrisoned fleet on the given planet that belongs to the planet's owner faction. */
private getFleetOnPlanet(planet: PlanetTile): Fleet | null {
  if (!this.selectedSystem) return null;

  for (const fleet of this.fleets) {
    if (fleet.destroyed || fleet.system?.id !== this.selectedSystem.id) continue;
    if (fleet.factionId !== planet.factionId) continue; // <-- CRITICAL: only same-faction fleets
    if (fleet.system.targetX != null || fleet.system.targetY != null) continue;

    const fleetCell = this.movementService.calculateSystemGridCell(
      fleet.system.x,
      fleet.system.y,
    );
    const planetCell = this.movementService.getPlanetGridPosition(planet);
    if (fleetCell.col === planetCell.col && fleetCell.row === planetCell.row) {
      return fleet;
    }
  }
  return null;
}
```

### 7. Update StarMap Init for Post-Battle Processing

**File**: `src/app/components/star-map/star-map.ts`

**CRITICAL FIX — Battle Restart Bug**: Angular's default `RouteReuseStrategy` may keep `StarMap` alive when navigating to `/battle` and back. When returning:
- If `StarMap` is reused: `ngOnInit()` does NOT fire, so `loadGame()` is never called and in-memory state (planet `factionId`, fleet `destroyed`) remains stale
- If `StarMap` is recreated: `fleetPlanetMap` resets to empty, causing `checkFleetPlanetArrivals` to re-process the arrival with stale in-memory faction data

**Fix**: Subscribe to `Router` navigation events and reload game state when navigating to `/star-map`.

```ts
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

// In constructor, add Router subscription:
constructor(...) {
  this.router.events
    .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
    .subscribe((event: NavigationEnd) => {
      if (event.url === '/star-map' || event.urlAfterRedirects === '/star-map') {
        this.reloadAfterBattle();
      }
    });
}

private reloadAfterBattle(): void {
  if (this.saveGameService.currentSlot === null) return;
  this.loadGame();
  this.removeDestroyedFleetFromService();
  this.fleetPlanetMap.clear();
  this.cdr.detectChanges();
}
```

This ensures that whenever the user returns to the star map (from battle or anywhere else), the game state is reloaded from the save file, which contains the updated planet faction and fleet destroyed flags.

### 8. Update Battle Screen — Apply Result Before Navigation

**File**: `src/app/components/battle-screen/battle-screen.component.ts`

**CRITICAL FIX**: The battle result (planet capture or fleet destruction) MUST be applied BEFORE navigating back to the star map. Otherwise, `StarMap.ngOnInit()` loads the old state, the game loop starts, `checkFleetPlanetArrivals()` detects the fleet on the planet with a fresh `fleetPlanetMap`, and immediately re-triggers the battle.

Modify `backToStarMap()`:

```ts
backToStarMap(): void {
  this.stopStepTimer();
  const battle = this.battleService.getBattle();
  const loser = this.battleService.getLoser();
  const winner = this.battleService.getWinner();

  // Apply planet battle result BEFORE navigating away
  if (battle?.type === 'planet' && battle.planetId && winner) {
    this.applyPlanetBattleResult(battle, winner, loser);
  } else if (loser) {
    loser.destroyed = true;
    this.battleService.setDestroyedFleetId(loser.id);
  }

  this.battleService.clearBattle();
  this.router.navigate(['/star-map']);
}

private applyPlanetBattleResult(battle: Battle, winner: Fleet, loser: Fleet): void {
  // Load current save data to modify it directly
  const saveService = this.saveGameService;
  if (saveService.currentSlot === null) return;

  const data = saveService.loadFromSlot(saveService.currentSlot);
  if (!data || !data.starSystems) return;

  for (const system of data.starSystems) {
    const planet = system.planetsTiles?.find(p => p.id === battle.planetId);
    if (!planet) continue;

    if (winner.id === battle.attackerId) {
      // Attacker won - capture planet immediately
      planet.factionId = winner.factionId;
    } else {
      // Attacker lost - destroy the attacking fleet in save data
      const fleet = data.fleets?.find(f => f.id === battle.attackerId);
      if (fleet) {
        fleet.destroyed = true;
      }
    }
    break;
  }

  saveService.saveToSlot(saveService.currentSlot, data);
}
```

This requires injecting `SaveGameService` into `BattleScreenComponent`.

### 8a. Remove `applyPlanetBattleResult` from StarMap

**File**: `src/app/components/star-map/star-map.ts`

Since the result is now applied in the battle screen before navigation, the `applyPlanetBattleResult()` method in `StarMap` and its call in `ngOnInit()` can be removed. The `removeDestroyedFleetFromService()` still handles normal fleet battles.

### 9. Update Fleet Info UI for Movement Feedback

**File**: `src/app/components/star-map/star-map.ts` or movement validation

Add visual feedback when player tries to move fleet to invalid target:
- Show console warning or UI tooltip for blocked moves
- Clear the movement target if blocked

## Data Flow

```
Player clicks planet → onSystemGridClick → moveSelectedFleet
  → validate target (canMoveFleetTo)
  → if valid: set fleet target
  → fleet moves to planet cell
  → checkFleetPlanetArrivals detects arrival
  → handleFleetPlanetArrival:
     ├─ uninhabited + colonizer → colonize instantly
     ├─ uninhabited - colonizer → orbit only
     ├─ own planet → garrison
     └─ enemy planet → triggerPlanetBattle
        → createVirtualDefenseFleet (buildings + garrison)
        → BattleService.setBattle
        → navigate to /battle
        → Battle resolves
        → backToStarMap → applyPlanetBattleResult
           └─ winner captures planet (change factionId)
```

## Files Modified

| File | Change |
|---|---|
| `src/app/components/star-map/ship-data.json` | Add `colonizer` ship type |
| `src/app/services/planet-battle.service.ts` | **NEW** - Virtual fleet creation, battle resolution |
| `src/app/services/battle.service.ts` | Add `type` and `planetId` fields to `Battle` |
| `src/app/components/star-map/star-map.ts` | Movement validation, arrival handling, battle trigger, result application |
| `src/app/components/battle-screen/battle-screen.component.ts` | Handle planet battle back-navigation |

## Validation Plan

1. **Colonizer ship**: Verify it appears in ship data, has correct stats
2. **Movement restriction**: Test that fleet cannot move to teammate planet, cannot move to own planet with fleet
3. **Uninhabited colonization**: Fleet with colonizer claims planet, colonizer consumed
4. **Uninhabited orbit**: Fleet without colonizer orbits but doesn't claim
5. **Enemy planet attack**: Fleet attacks planet, battle screen shows with turrets as ships
6. **Planet defense battle**: Turrets appear as defender ships, garrison combines with them
7. **Battle victory**: Attacker captures planet (factionId changes)
8. **Battle defeat**: Attacker fleet destroyed on back-navigation
9. **Save/Load**: Planet ownership and garrison state persists correctly

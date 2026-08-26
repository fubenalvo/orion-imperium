# Game Systems

## Star Map

The StarMap component (`src/app/components/star-map/star-map.ts`) is the central gameplay view. It manages two sub-views:

### Map View
- The world is a 2D grid rendered in `vw` units.
- Star systems and fleets are positioned on this grid.
- Camera panning moves the viewport over the world.
- Clicking selects objects; overlapping objects show a context menu.

### System View
- When entering a star system, fleets inside that system transition to a separate coordinate space.
- Planets are displayed on a fixed grid within the system view.
- Fleets can move within the system view independently of map movement.

### Game Loop
- Uses `requestAnimationFrame` running outside Angular zone.
- Only triggers change detection when fleets actually move.
- Pauses on window blur or visibility change.
- Delta time is capped at 0.1s to prevent large jumps after tab switches.

### Selection System
- Only one fleet, system, or planet tile can be selected at a time.
- Selecting a fleet shows its info panel and movement/attack actions.
- Selecting a system allows entering it.
- Selecting a planet tile shows its details.

### Movement
- Fleet movement is target-based: set `targetX`/`targetY`, and the fleet moves each frame.
- Movement speed is in `vw` per second.
- When a fleet reaches its target, the target is cleared.
- Map movement and system movement are tracked separately.

### Battle Detection
- Every frame, active fleets are checked for grid collisions.
- Only fleets from different factions on different teams trigger battles.
- Neutral faction (team 0) never participates in battles.
- Same-team fleets do not battle each other.
- A `Set<string>` prevents duplicate battle triggers for the same pair.

## Battle System

Battles are resolved instantaneously with a simple formula:

```
fleetScore = max(0, totalAttack - enemyTotalShield)
```

- Winner is the fleet with the higher score.
- Ties go to `fleet1` (first fleet in the pair).
- No ship-specific targeting, no shield regeneration during battle, no armor mitigation.

## Save System

- 4 save slots stored in localStorage under key `orion_save_slots`.
- Each slot contains a full `StarMapData` snapshot and an ISO date string.
- Auto-save occurs on: entering/leaving system, pausing, exiting to menu, battle trigger, and on component destroy.
- Loading restores all state including selection, camera position, and destroyed fleet tracking.

## Camera

- Camera position is in `vw` units.
- Movement speed is 2 vw per frame (not time-based).
- Camera is clamped to the grid bounds, taking viewport aspect ratio into account.
- Background parallax uses a 0.3 multiplier on camera offset.

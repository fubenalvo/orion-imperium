# Battle Rules

The battle system is **turn-based** and step-driven. There are two battle types: fleet-vs-fleet and fleet-vs-planet. Both share the same turn loop and damage formula; only the setup and result application differ.

## Trigger Conditions

### Fleet Battle

Triggered by `StarMapBattleDetectionService.checkForBattles()`, called every frame in `StarMap.updateFleets()`. A pair triggers a battle when:

1. Both fleets are active (not `destroyed`).
2. Both fleets have valid faction references.
3. Neither faction is neutral (`team !== 0`).
4. Factions are on different teams.
5. Both fleets are on the same grid cell (`gridCol`/`gridRow`).
6. The pair has not already triggered a battle in this game (tracked by a `Set<string>` of `"minId-maxId"` keys).

The fleet whose `targetX`/`targetY` is set is the **attacker**; the other is the **defender**.

### Planet Battle

Triggered by `StarMap.triggerPlanetBattle()` from `handleFleetPlanetArrival()` when a non-teammate fleet stops on the cell of an enemy planet that has at least one defensive building. The defender is built on the fly by `PlanetBattleService.createVirtualDefenseFleet()`:

- Every defensive building (`def.role === 'defense'`) becomes one virtual `FleetShip`:
  - `type` is the building's `id`, `id` is a unique negative number, `currentHp` is `attack * 3` for non-shield buildings (or `shield` for shield buildings), `name` is `"<buildingName> #<n>"`.
- Shield buildings (`def.type === 'shield'`) skip the per-ship entry and instead contribute their `shield` value to a shared `shieldPool` on the virtual fleet.
- Any garrisoned fleet of the planet's owning faction (a fleet parked on the planet's cell, in the same system, with no active target) is appended after the buildings.
- The virtual fleet's `id` is `-planet.id` to avoid clashing with real fleet ids.

## Battle Lifecycle

1. `StarMap` calls `BattleService.setBattle()` (or `setPlanetBattle()`, which sets `type = 'planet'`).
2. `BattleScreenComponent.ngOnInit()` calls `BattleService.startBattle()`:
   - Each ship gets `currentHp` reset from its `ShipType.hitPoints` (or its existing value as a fallback for virtual ships) and `destroyed = false`.
   - A fresh `BattleState` is created with `currentFleetId = attackerId`, `currentShipIndex = 0`, `round = 1`.
3. A `setInterval(tickRateMs)` calls `BattleService.processStep()` once per tick. Default `tickRateMs = 1000` (1 second). `BattleScreenComponent` reads the battle back into its view and re-runs change detection on every tick.
4. When the battle ends, the timer is stopped and a "Back to Star Map" button becomes visible.
5. On "Back to Star Map" (`BattleScreenComponent.backToStarMap()`):
   - The fleet battle calls `loser.destroyed = true` and stores `loser.id` via `setDestroyedFleetId()`.
   - The planet battle calls `applyPlanetBattleResult()`: if the attacker won, the planet's `factionId` is set to the attacker's faction; otherwise the attacking fleet is marked destroyed. The change is written back to the save slot.
6. `StarMap` reloads the save and applies the destruction/ownership change. The `triggeredBattles` pair key is not cleared on defeat; a defeated fleet cannot be revisited because the fleet is filtered out of the active set.

## Step Resolution

`BattleService.processStep()` executes exactly one ship attack per call:

```
attacker = getFleet(currentFleetId)
defender = getFleet(otherSide)
attackerShips = attacker.ships.filter(s => !s.destroyed)
defenderShips = defender.ships.filter(s => !s.destroyed)

if attackerShips.length === 0 || defenderShips.length === 0:
    endBattle()
    return false

attackingShip = attackerShips[currentShipIndex % attackerShips.length]
targetShip   = getWeakestShip(defender.ships)

attackerType = shipService.getShipType(attackingShip.type)
targetType   = shipService.getShipType(targetShip.type)

baseDamage = attackerType?.attack ?? planetBattleService.getBuildingAttack(attackingShip.type)
defense    = targetType?.defense  ?? planetBattleService.getBuildingDefense(targetShip.type)
damage     = max(1, baseDamage - defense)

targetShip.currentHp -= damage
if targetShip.currentHp <= 0:
    targetShip.destroyed = true
    targetShip.currentHp = 0
```

After the attack:

- A `BattleLogEntry` is pushed onto the battle log.
- `currentShipIndex` is incremented. If it reaches the end of the current fleet's alive ships, the index wraps and the active fleet flips. When the active fleet flips back to the attacker, `round` is incremented.
- The function ends the battle immediately if either side has no alive ships.

### Target Selection

`getWeakestShip(ships)` picks the alive ship with the lowest `currentHp`. On ties, it picks the ship with the lower `ShipType.hitPoints`. This is the same rule used for both regular ships and virtual building ships.

### Building Stats Resolution

If a ship type is not in `ship-data.json` (always the case for virtual defense ships), `BattleService` falls back to `PlanetBattleService`:

- `getBuildingAttack(typeId)`: returns the building's `attack` (0 if missing).
- `getBuildingDefense(name)`:
  - Shield buildings return a flat `5`.
  - Other defense buildings return `Math.floor(attack / 5)`.

So a Laser Turret with `attack = 20` and `defense = 4` deals 20 damage and reduces incoming damage by 4. A Shield Building adds 5 to a ship's effective defense.

## Outcome

- **Both sides have ships destroyed simultaneously** (impossible under the current implementation, but the code path exists): the attacker is treated as winner and the defender as loser.
- **One side empty**: the surviving side wins. The loser's ships are all `destroyed = true`.
- **Neither side empty when the loop ends** (defensive branch — not reached today): the attacker is the winner and the defender the loser.

The losing fleet is filtered from `visibleFleets` and excluded from movement, collision, and rendering. A destroyed fleet's `id` is preserved so the destruction can survive save/load.

## Edge Cases

- A `FleetShip` whose type is unknown to `ShipService` and not a building type contributes `0` attack and `0` defense; it can still be hit and destroyed.
- The `triggeredBattles` set is never cleared. Once a pair has fought, the survivor is filtered out as `destroyed` so the pair cannot recur. If both survive (impossible today), the survivor cannot re-fight the same id; clearing the set on reload happens implicitly because the set is re-created in `StarMap`'s field initializer.
- A planet battle runs through `applyPlanetBattleResult()` which loads the save slot, mutates the planet, and saves back. If `currentSlot` is null or the save is missing, the result is silently dropped.
- The "Back to Star Map" button is always available; the user can leave a battle in progress, but only the post-resolution branch updates fleet/planet state.

## Limitations

- No weapon-type effectiveness: `attackType` and `weakness` are loaded but not applied in damage calculation.
- No critical hits, evasion, or random factors.
- No per-ship targeting strategy beyond "weakest HP" (`getWeakestShip`); fleet composition ordering does not matter.
- `shieldRegen` is loaded but not used during battle. Building shield pools (`shieldPool`) are not currently applied in damage reduction.
- The whole fleet is either fully destroyed or fully surviving on the loser side; the winner's surviving ship roster does not persist back to the overworld (the overworld still uses the original fleet composition, only the loser's `destroyed` flag is set).

# Ship Production & Fleet Assembly

> Imperium Galactica 1 inspired pipeline. Factories produce ships, ships enter a
> global per-empire stock, spaceports enable fleet assembly. The
> existing `Fleet` system is reused end-to-end — no parallel fleet manager is
> introduced.

## High-level flow

```
Spaceship Factory ──▶ Production Order ──▶ Production tick ──▶ Global Ship Stock
                                                                     │
                                                                     ▼
                                           Spaceport ──▶ Fleet Assembly
                                                                     │
                                                                     ▼
                                                            Existing Fleet system
```

The factory never touches a fleet. The fleet never touches the factory. They
meet only at the stock, mediated by services.

## Owner

- `ShipStockService` — pure helpers over `StarMapData.shipStock`.
- `ProductionService` — per-planet production queue and per-tick progress.
- `SpaceportService` — presence checks for the `Spaceport` building.
- `FleetAssemblyService` — pops stock entries and pushes them into a
  `Fleet.ships` array. **No new fleet type, no new movement, no new combat
  path.**

## Per-instance vs per-type

`Fleet.ships` already stores per-instance `FleetShip` records (with `currentHp`
and `destroyed`) because battle and sensor code iterate over individual ships.
The stock therefore also stores per-instance `ShipStockEntry` records. Stock
count = number of `ShipStockEntry` records for a faction (optionally filtered
by `typeId`).

## Capacity model

- A `Spaceship Factory` building contributes `productionSlots: 1` and
  `productionPower: 0.5` progress/s.
- A planet's `productionCapacity` = sum of slots of every `Spaceship Factory`
  on the planet (and, in the future, every `Orbital Factory` for the right
  ship types).
- A planet's `productionPower` = sum of `productionPower` over the same set.

## Ship build time

Each `ShipType` carries a `buildTime` (seconds at one factory, `productionPower
= 1`). The default is `cost / 10` (so a Corvette costing 120 takes 12 s). Each
ship type also carries a `productionBuilding` discriminator
(`'spaceship_factory' | 'orbital_factory'`) so the same production service
works for both factory classes without code changes.

### One ship per order

A request for N ships (the player's quantity picker) is stored as **N
single-ship orders** in the planet queue. Consequences:

- The queue's total time is unit time × N; the factory works on the head
  order only, so ships reach the stock one at a time.
- `queueOrder` still charges the full price for all N at once
  (all-or-nothing) and splits it into per-order `paid` shares that sum
  exactly to the charge (rounding remainder on the first share).
- Cancelling a queue item refunds that one ship's un-built fraction; the
  other items and ships already in the stock are untouched.
- `getOrderEta` reports the time for one queue item; the panel shows a
  `×N` label only for orders with `quantity > 1`.

Saves written before this rule can hold orders with `quantity > 1`.
`ProductionService.rebaseFromSave` (run on every load) splits them into
single-ship orders: the first keeps the batch's progress and id, the rest
get fresh ids and progress 0, and `paid` is shared exactly, so no ship or
refundable resource is lost or duplicated. Orders for an unknown ship type
are left whole (the tick refunds them). As a defensive fallback, the tick
and `getOrderEta` multiply the unit time by `quantity`, so a multi-ship
order can never finish faster than its ships.

## Fleet spawn position and view transition

`FleetAssemblyService.createFleet` places the new fleet on the host
planet's system-grid cell by converting `getPlanetGridPosition(planet)`
to vw coordinates (`(col - 0.5) * SYSTEM_CELL_SIZE_VW`). The same cell
is written to `gridCol` / `gridRow` so battle detection, sensor range,
and the `@if (selectedSystem)` system view template see the fleet
immediately on frame 1.

`StarMap.onSpaceportConfirm` flips `currentView` to `'system'` and
runs `initFleetsInSystem` (the loop that re-derives every active
fleet's `gridCol` / `gridRow` from `fleet.system.{x,y}`) **before**
calling `selectFleet`. The ordering matters: `selectFleet` clears
`selectedSystem` whenever it runs from a non-system view, so calling
it first would leave the system-view template's
`@if (selectedSystem)` guard false and the grid would render blank.
With the correct ordering the system view renders the sun, planets,
and all fleets (including the freshly created one on the host
planet's cell) immediately.

## Production completion → Global Ship Stock

When `ProductionService.tick` advances an order past `progress >= 1` it
mints one `ShipStockEntry` per produced unit (normally one, see
[One ship per order](#one-ship-per-order)) and pushes them into the producing
faction's stock via `ShipStockService.addToStock`. The factory never
touches a fleet and the fleet never touches the factory. Entries are
captured with `producedAtTick` and `originPlanetId` for debug, but those
fields are not consulted by any current gameplay logic.

The galaxy generator writes `shipStock: []` and `production: []`, so the
round-trip survives reload.

## Resource handling

Resource costs are deducted from `faction.currencies` **at queue time** (one
transaction per `queueOrder` call). Production tick does not re-deduct. This
keeps accounting simple and avoids partial deductions if production is
cancelled.

## Save / load

`StarMapData.shipStock` and `StarMapData.production` are optional in the
type; new games start with `[]` for both. Production progress and per-fleet composition persist via the
existing root-state persistence. Orders record what they were charged in
`paid`; orders from saves without it are refunded as credits-only.

## Costs

Ordering charges `cost` credits and `rawMaterialCost` raw materials per ship
at queue time (all-or-nothing, `resource-cost.ts`). Completion and fleet
assembly never charge again. Ships cost upkeep while they exist: full rate in
a fleet, half rate in the stock. See [Economy](./economy.md).

## Hull classes in the production dialog

Every combat hull belongs to a [hull class](./battle-rules.md#hull-classes) (light / medium /
heavy). The "New production order" dialog shows the counter cycle in one line, a class badge and
"beats X · weak to Y" on every combat ship card, and for the selected hull its role, the exact
bonuses (+35% vs the class it beats, +35% taken from the class it is weak to, +50% siege for heavy
hulls) and its key stats (attack and weapon type, hull / shield, armour as a damage reduction,
range / speed), plus the shield-aura line for the carrier. All texts come from `hull-class.ts` (`describeHullRole`) through the shared
`HullRoleComponent`, so they always match combat. The modal scrolls in its body only, so the
corner brackets stay in place. The AI picks hulls by class too
([AI Pipeline](./ai-pipeline.md#military-production-and-deployment)).

## Edge case handling

See `docs/invariants.md` for the production-specific invariants. Notable
behaviours:

- **Factory destroyed mid-build**: the order's `progress` simply stops
  advancing. An order that has not progressed in over `STALLED_ORDER_TIMEOUT`
  seconds is auto-cancelled and the un-built portion's resource cost is
  refunded.
- **Disbanded fleet**: surviving `FleetShip` records are returned to the
  faction's stock; the fleet is marked `destroyed` so existing movement /
  sensor / economy code excludes it.
- **Faction removed**: orphaned stock is dropped (no UI presents it). A
  future "captured stock" mechanic can hook `ShipStockService.onFactionRemoved`.
- **Orbital Factory**: the `productionBuilding` discriminator on `ShipType`
  keeps the service class-agnostic.

## Reorganizing assembled fleets

Once ships are in fleets, the player can merge, split and redistribute them
freely anywhere. Moving ships between the stock and an existing fleet
(reinforcing, or docking ships back) happens in the same dialog's reserve
column and only at an own Spaceport; `reinforceFleet` enforces the same rule
for the AI. See [Fleet Organization](./fleet-organization.md#reserve).

## Ownership changes

Orders always belong to the planet's owner. `PlanetOwnershipService.transferPlanet` cancels and refunds the previous owner's orders when a planet changes hands, and `ProductionService.tick` refunds and drops any order whose planet is gone **or no longer owned by the ordering faction** (this repairs orders left over in saves written before the ownership service existed). See [Planet Capture](./planet-capture.md).

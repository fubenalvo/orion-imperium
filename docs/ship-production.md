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

## Fleet spawn position and view transition

`FleetAssemblyService.createFleet` places the new fleet on the host
planet's system-grid cell by converting `getPlanetGridPosition(planet)`
to vw coordinates (`(col - 0.5) * SYSTEM_CELL_SIZE_VW`). The same cell
is written to `gridCol` / `gridRow` so battle detection, sensor range,
and the `@if (selectedSystem)` system view template see the fleet
immediately on frame 1.

`StarMap.onSpaceportConfirm` calls `enterSystem()` on create success.
`enterSystem` not only sets `currentView = 'system'` but also runs the
fleet-init loop that re-derives every active fleet's `gridCol` /
`gridRow` from `fleet.system.{x,y}`. Skipping that loop is what left
the sun, planets, and fleets invisible until the player manually
re-entered the system.

## Production completion → Global Ship Stock

When `ProductionService.tick` advances an order past `progress >= 1` it
mints one `ShipStockEntry` per produced unit (see
`production.service.ts:230-244`) and pushes them into the producing
faction's stock via `ShipStockService.addToStock`. The factory never
touches a fleet and the fleet never touches the factory. Entries are
captured with `producedAtTick` and `originPlanetId` for debug, but those
fields are not consulted by any current gameplay logic.

`SaveGameService.migrateSave` backfills `shipStock: []` and
`production: []` for older saves so the round-trip survives reload.

## Resource handling

Resource costs are deducted from `faction.currencies` **at queue time** (one
transaction per `queueOrder` call). Production tick does not re-deduct. This
keeps accounting simple and avoids partial deductions if production is
cancelled.

## Save / load

`StarMapData.shipStock` and `StarMapData.production` are optional fields.
`SaveGameService.migrateSave` backfills `[]` for both on load so older saves
keep working. Production progress and per-fleet composition persist via the
existing root-state persistence.

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

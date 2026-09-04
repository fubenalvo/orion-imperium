# Ship Production & Fleet Assembly — Technical Design

> Imperium Galactica 1 inspired shipbuilding pipeline. Reuses the existing Fleet system end-to-end. **Does not rebuild Fleet.**

---

## 1. Current Architecture Audit

### 1.1 Relevant existing entities (`star-map.models.ts`)

- `Fleet` (`src/app/components/star-map/star-map.models.ts:236`)
  - Fields: `id`, `name`, `factionId`, `x`, `y`, `targetX/Y`, `speed`, `system: SystemLocation | null`, `gridCol/Row`, **`ships: FleetShip[]`**, `destroyed`, `sensorRange`.
  - Movement is delegated to `StarMapMovementService.updateFleets` (`star-map-movement.service.ts:133`).
  - Combat integration via `BattleService` / `PlanetBattleService` reads `fleet.ships` directly.
- `FleetShip` (`star-map.models.ts:84`)
  - **Per-instance ship**: `{ id, name, type, currentHp?, destroyed? }`. Each ship in a fleet is a discrete object — HP is tracked individually and ships are individually markable as `destroyed` after battle.
- `ShipType` (`ship.service.ts:4` / `ship-data.json`)
  - 11 ship types defined (scout → dreadnought + colonizer). Fields: id, name, role, hitPoints, shield, shieldRegen, attack, attackType, weakness, defense, speed, range, **cost**, **maintenanceCost**.
  - **Already provides `cost` (one-time build cost) and `maintenanceCost` (per-second upkeep).** Both can be reused for production and stock accounting.
- `Faction` (`star-map.models.ts:34`): `id`, `name`, `color`, `team`, `currencies: Record<string, number>`.
- `PlanetTile` (`star-map.models.ts:48`): `factionId`, `buildings: PlanetBuilding[]`.
- `PlanetBuilding` (`star-map.models.ts:1`): `{ name, size, x, y }` (no `id`, no `type` — name is the join key against `planet-data.json`).

### 1.2 Resource & economy (`economy.service.ts`)

- `ResourceType = 'credits' | 'rawmaterials' | 'research' | 'energy'` (energy is a flow resource, not accumulated).
- `STOCK_RESOURCES = ['credits','rawmaterials','research']` are accumulated on `faction.currencies`.
- `applyEconomyDelta` (`economy.service.ts:238`) is called every ~1 s from the star-map game loop, mutates `faction.currencies` based on planet buildings, fleet maintenance, and planet satisfaction.
- `calculatePlanetEconomy` aggregates `production` / `consumption` per resource from building defs.
- Building economy is data-driven from `planet-data.json`; no code change is needed to add a new building id.

### 1.3 Buildings (`planet-data.json`)

- `Spaceship Factory` exists (`planet-data.json:231`), `id: spaceship_factory`, `role: industry`, `size: 3`, `price: 100`, `energyConsumption: 30`, `maintenanceCost: 30`, `production: { rawmaterials: 10 }`, `consumption: { energy: 30 }`.
- **No production field for ships exists yet** — only raw-materials output (a balance/flavor thing, not a production capacity).
- **`Military Spaceport` does NOT exist** and must be added to `planet-data.json`.
- Buildings are referenced in `PlanetBuilding[]` by `name` (no `type` field on the placed building).

### 1.4 Fleet lifecycle today

- **Creation**: hard-coded in `star-map-data.json` only. There is **no code path that constructs a `Fleet` at runtime**. Fleet IDs come from the JSON.
- **Composition**: `fleet.ships: FleetShip[]` — each ship is its own instance, even if all ships of a type are identical until battle marks them `destroyed`.
- **Movement**: `fleet.x/y`, `fleet.targetX/Y`, `fleet.system.{x,y,targetX,targetY}` (`star-map-movement.service.ts:144–223`).
- **Combat**: `BattleService` and `PlanetBattleService` operate directly on `fleet.ships`. Loser fleet is marked `fleet.destroyed = true` (`battle-screen.component.ts:110, 132`).
- **Visibility / sensor**: `star-map-sensor.service.ts` uses `fleet.ships` to compute sensor range.
- **Disband**: not implemented. Destroyed fleets stay in `data.fleets` with `destroyed: true`. There is no current path that returns ships from a fleet to anything.

### 1.5 Ship-instance vs ship-type decision

The Fleet uses **per-instance `FleetShip` records with `currentHp` and `destroyed`**. The fleet combat loop, sensor service and victory detection all iterate over `fleet.ships`.

**Therefore the Global Ship Stock should also store per-instance ship records**, not `type + quantity` aggregates. This decision is forced by the existing battle and sensor code. We will keep the `FleetShip` shape verbatim in the stock.

Consequences:
- "Stock count" is `stock.ships.length` filtered by `!destroyed`.
- Production completion pushes N new `FleetShip` records into the stock.
- Reinforcement pushes N records into a fleet's `ships` array.
- Disband pulls records back into the stock.
- Loss in combat mutates the records already in the fleet (unchanged behavior).

### 1.6 Game loop / tick

- `StarMapGameLoopService` (`star-map-game-loop.service.ts`) runs `requestAnimationFrame` outside Angular zone.
- The `StarMap` component's tick callback (`star-map.ts:1218`) calls `updateFleets(deltaTime)` and then `economyService.applyEconomyDelta(...)` once per `economyTickInterval` (1 s).
- All simulation currently mutates plain JS objects on `StarMapData`; Angular `ChangeDetectorRef` is then triggered manually.

### 1.7 Save / load

- `SaveGameService.saveToSlot(slotIndex, data)` serializes the whole `StarMapData` to `localStorage` under `orion_save_slots`.
- `StarMapData` (`star-map.models.ts:117`) is the single root for persistence. Auto-save happens on system enter/leave, battle trigger, pause, etc.
- **Adding new top-level fields to `StarMapData` is automatically persisted** — no service changes needed.

---

## 2. New Data Structures

All added to `star-map.models.ts` (kept in the same file so persistence and types stay co-located).

```ts
// Per-instance ship record (unchanged from FleetShip, but re-used for stock)
export interface ShipStockEntry {
  id: number;          // global unique ship id, same shape as FleetShip.id
  type: string;        // ShipType.id
  name: string;        // ShipType.name (display)
  producedAt: number;  // game-time tick when finished (debug / AI hints)
  originPlanetId?: number | null;
}

export interface FactionShipStock {
  factionId: string;
  ships: ShipStockEntry[];  // all ships not yet assigned to a Fleet
}

// Production order sitting in a planet's Spaceship Factory queue
export interface ProductionOrder {
  id: number;          // order id (unique within queue)
  shipTypeId: string;
  quantity: number;    // how many to build
  progress: number;    // 0..1 normalized progress
  startedAtTick: number;
  // cost was already deducted when the order was queued (UI feedback)
}

// Tracks every active production order across all planets for an empire
export interface FactionProduction {
  factionId: string;
  // key = planetId so we can scope capacity / power to the right building set
  ordersByPlanet: Record<number, ProductionOrder[]>;
}

// Catalog of buildings that already exist in planet-data.json
// + new Military Spaceport (added to planet-data.json too)
```

No change to the `Fleet` or `FleetShip` interface. We **reuse `FleetShip`** as the in-fleet record by structural compatibility (`{id, name, type, currentHp?, destroyed?}`), so existing combat/sensor/movement code reads `fleet.ships` exactly as today.

Two new top-level fields on `StarMapData`:

```ts
shipStock: FactionShipStock[];   // one per faction
production: FactionProduction[]; // one per faction
```

Both default to `[]` for backward-compatible saves (saves without them are migrated on load — see §11).

---

## 3. Global Empire Ship Stock — Placement

- Stored on `StarMapData.shipStock: FactionShipStock[]` — **empire-scoped**, never planet-scoped.
- Accessor service: `ShipStockService` with pure functions:
  - `getStock(factionId): ShipStockEntry[]`
  - `getStockCount(factionId, typeId?): number`
  - `addToStock(factionId, entries)`
  - `removeFromStock(factionId, count, typeId): ShipStockEntry[]` — pops oldest first (FIFO is fine; no gameplay impact).
  - `disbandFleetIntoStock(fleet): void` (edge case §13).
  - `onFactionRemoved(factionId): ShipStockEntry[]` — returns the floating stock so callers can redistribute or drop.
- The stock is the **only** source of ships for fleet assembly. Factories never touch a fleet directly.

---

## 4. Ship Production Architecture

### 4.1 Production capacity model

- Each `Spaceship Factory` building contributes `productionSlots: 1` to its planet (data field added to `planet-data.json`).
- A planet's `productionCapacity` = `count(Spaceship Factory on planet) * 1`.
- A planet's `productionPower` = `count(Spaceship Factory) * factoryThroughput` (default 0.5 progress/s).
- The ship type's `buildTime` (new field on `ShipType`, see §4.3) divided by `productionPower` gives wall-clock seconds per ship at 1 factory.
- Resource cost is deducted from `faction.currencies` at queue-time (simpler than per-tick drain) using `shipData.cost * quantity` and `shipData.maintenanceCost` is irrelevant for production.

### 4.2 Production tick

A new `ProductionService` runs as part of the same game loop (no second rAF):

```text
StarMap tick (every frame)
  ├── updateFleets(deltaTime)            // existing
  ├── applyEconomyDelta(...)             // existing (1 s)
  └── productionService.tick(deltaTime, stock, data)  // NEW
        for each faction:
          for each planet with active orders:
            consume 1 active order (the head of the queue)
            progress += deltaTime / order.buildTime * planetProductionPower
            when progress >= 1:
              emit `quantity` ShipStockEntry records
              add to faction ship stock
              remove order
              start next order on that planet (if any)
```

The simulation — not the UI — owns progress. The UI subscribes to a signal/getter for "stock changed" to re-render.

### 4.3 Ship build-time field

`ship-data.json` needs a new field per ship type. Default rule: `buildTime = cost / 10` (i.e. a Corvette costing 120 takes 12 s at 1 factory). This keeps the existing `cost` field as the primary balancing knob.

For Orbital Factory preparation, each `ShipType` can additionally carry:

```json
"productionBuilding": "spaceship_factory" | "orbital_factory"
```

so production code picks the right building class without hard-coding ship type lists.

### 4.4 Production queue UI contract

The `ProductionService` exposes a pure, side-effect-free API:

```ts
queueOrder(planetId, shipTypeId, quantity): Result<ProductionOrder, 'no_factory' | 'insufficient_resources' | 'invalid_type'>
cancelOrder(planetId, orderId): Result<{ refund }, 'not_found'>
getQueue(planetId): ProductionOrder[]
getCapacity(planetId): number
```

UI calls these; the UI never mutates progress or stock directly.

---

## 5. Spaceship Factory Integration

- **No code change to the existing `Spaceship Factory` building**, except adding two data fields to its entry in `planet-data.json`:
  - `productionSlots: 1`
  - `productionPower: 0.5`
- Buildings are still referenced by name; existing `onBuildingConfirmed` (`star-map.ts:499`) keeps working.
- A planet's `getProductionOrders()` and `getProductionCapacity()` are computed by counting buildings named `Spaceship Factory` (or `Orbital Factory` later) — same `name`-based join the economy service already uses.

---

## 6. Military Spaceport

### 6.1 New building

Added to `planet-data.json`:

```json
{
  "id": "military_spaceport",
  "name": "Military Spaceport",
  "role": "military",
  "size": 4,
  "price": 500,
  "maintenanceCost": 40,
  "energyConsumption": 20,
  "production": {},
  "consumption": { "energy": 20 }
}
```

### 6.2 What it enables (rules only — no UI here)

- The faction must have at least one `Military Spaceport` on any owned planet to perform:
  - Create a new fleet
  - Reinforce an existing fleet
  - (Later) Refit / repair at a spaceport
- The spaceport **does not store ships**. It is a permission flag, like `Spaceship Factory` is for production.
- A planet counts as an "assembly point" if it has a `Military Spaceport`. The new fleet is initially placed at that planet's galaxy coordinates (taken from the host `StarSystem.x/y` + a small offset; reused as `fleet.x/y` so the existing movement service works).

### 6.3 Helper

`MilitarySpaceportService.hasSpaceport(factionId, starSystems): boolean` — counts buildings named `Military Spaceport` on any planet owned by `factionId`.

---

## 7. Fleet Assembly (Stock → Existing Fleet)

### 7.1 Reuse, don't rebuild

The Fleet is **already a gameplay entity** in `star-map.models.ts:236`. The new system does **not** introduce a new `Fleet` type or a parallel fleet manager. Assembly only:

1. Allocates a new `Fleet.id` (monotonic counter, see §7.3).
2. Pops `ShipStockEntry` records from the stock.
3. Pushes them as `FleetShip` records into `fleet.ships` (they share the same shape).
4. Sets `fleet.x/y` to the host planet's grid cell.
5. Sets `fleet.factionId` to the assembling faction.

### 7.2 Service surface

`FleetAssemblyService`:

```ts
createFleet(
  factionId: string,
  starSystemId: string,
  planetId: number,
  composition: { typeId: string; count: number }[],
  starSystems: StarSystem[],
  stock: FactionShipStock[],
  fleets: Fleet[],
): Result<Fleet, 'no_spaceport' | 'insufficient_stock' | 'invalid_composition' | 'no_free_id'>

reinforceFleet(
  fleetId: number,
  composition: { typeId: string; count: number }[],
  starSystems: StarSystem[],
  stock: FactionShipStock[],
  fleets: Fleet[],
): Result<Fleet, 'no_spaceport' | 'fleet_not_found' | 'insufficient_stock' | 'enemy_fleet'>
```

The composition is a *type+count* request from the UI; the service pops the actual stock entries (preserving per-instance identity for future repair / veterancy).

### 7.3 Fleet ID allocator

`FleetAssemblyService.nextFleetId(fleets): number` — finds `max(fleet.id) + 1`. This keeps the existing `number` id scheme and avoids colliding with seeded fleets in `star-map-data.json`. Persisted indirectly because the new fleet is in the same `data.fleets` array.

### 7.4 Where assembly is invoked

- Triggered from the `Military Spaceport` building panel inside the planet screen (new action), and/or from a global "Fleets" view.
- The trigger calls `FleetAssemblyService.createFleet(...)` then triggers a `saveGame()`.

---

## 8. Fleet Reinforcement

Reuses the same `composeFromStock` core helper as creation:

1. Validate spaceport exists for the fleet's faction.
2. For each `(typeId, count)` requested, pop that many `ShipStockEntry` from the stock.
3. Push them into `fleet.ships`.
4. Return the updated fleet.

No movement or position change; the fleet stays where it is.

The only difference vs creation: the fleet already exists and has a position. No new permissions beyond spaceport + sufficient stock.

---

## 9. Minimal Modifications to the Existing Fleet System

Goal: keep the existing Fleet runtime untouched where possible. The required changes are:

1. **`star-map.models.ts`** — add `ShipStockEntry`, `FactionShipStock`, `ProductionOrder`, `FactionProduction`. Extend `StarMapData` with `shipStock` and `production` (optional fields, defaulted).
2. **`star-map-data.json`** — seed `shipStock: []`, `production: []` for backward compatibility.
3. **`economy.service.ts`** — **no functional change**. Its `applyEconomyDelta` already iterates `fleets.filter(f => !f.destroyed)` and counts active ships, so newly assembled fleets immediately incur maintenance. Good — that's IG1 behavior.
4. **`ship.service.ts`** — accept an optional `buildTime` / `productionBuilding` field on `ShipType` and expose it through `getAllShipTypes()`. Pure addition.
5. **`star-map.ts`** — call `productionService.tick(deltaTime, ...)` from the game loop, alongside the existing `updateFleets` and `applyEconomyDelta`. No change to fleet movement / combat / sensor code.
6. **`save-game.service.ts`** — no change. New fields ride on `StarMapData`. Add a one-time `migrateSave(data)` helper called on `loadFromSlot` to backfill `shipStock: []` and `production: []` if missing.
7. **New fleet creation** must respect the existing initial-state pattern (`star-map.ts:113` `fleets: Fleet[] = initialStarMapData.fleets`). The factory service mutates the same `fleets` array, so no component-level wiring is required.

**No new movement, no new selection, no new combat path, no new sensor code is introduced.**

---

## 10. AI Compatibility

All gameplay logic is exposed via Angular services, not UI. The AI agent will call the same methods as the UI:

| AI need                | Service method                                          |
| ---------------------- | ------------------------------------------------------- |
| Read own empire stock  | `ShipStockService.getStock(factionId)`                  |
| List production sites  | `ProductionService.getCapacity(planetId)`              |
| Queue production       | `ProductionService.queueOrder(...)`                     |
| List assembly sites    | `MilitarySpaceportService.listSpaceports(factionId)`    |
| Assemble new fleet     | `FleetAssemblyService.createFleet(...)`                 |
| Reinforce existing     | `FleetAssemblyService.reinforceFleet(...)`              |
| Disband fleet          | `FleetAssemblyService.disbandFleet(fleetId, ...)`       |

There is no UI-only path. The UI components are thin wrappers around the same services, so AI and human play the same game.

---

## 11. Save / Load

`StarMapData` is the single persistence root. Adding `shipStock` and `production` to it covers:

- Production queue ✅
- Production progress (in `ProductionOrder.progress`) ✅
- Global ship stock ✅
- Fleet composition (unchanged) ✅
- Fleet state (unchanged) ✅

Migration on load (`migrateSave`):

```ts
if (!data.shipStock) data.shipStock = [];
if (!data.production) data.production = [];
```

Both default-construct empty. Saves that pre-date this feature load as if the empire had nothing built and no production queued.

Auto-save triggers already cover every state change that matters:
- After `ProductionService.tick` completes an order → emit a "production changed" event, which the `StarMap` component uses to call `saveGame()` (next animation frame, throttled).
- After `FleetAssemblyService.createFleet/reinforceFleet` → emit, then `saveGame()`.

Game restart: save is loaded from `localStorage`; production ticks resume from stored `ProductionOrder.progress`; fleets and stock hydrate from JSON.

---

## 12. Orbital Factory Preparation

The `ShipType.productionBuilding` field lets `ProductionService` filter candidate buildings by class:

```ts
const eligibleBuildings = buildingType === 'orbital_factory' ? ['Orbital Factory'] : ['Spaceship Factory'];
const factoryCount = planet.buildings.filter(b => eligibleBuildings.includes(b.name)).length;
```

This is the **only** place we need to change when Orbital Factory ships are added:

1. Add `Orbital Factory` to `planet-data.json` with `productionSlots`, `productionPower`, etc. Different defaults are fine (e.g., larger size, higher cost, longer build times).
2. Mark the relevant ship types with `"productionBuilding": "orbital_factory"`.
3. The same `ProductionService.tick` and `queueOrder` API works unchanged.

No rewriting of the production system is required.

---

## 13. Edge Cases

| Case | Behavior |
| --- | --- |
| Insufficient resources at queue | `queueOrder` returns `insufficient_resources`. No partial deduction. |
| No factory on planet | `queueOrder` returns `no_factory`. |
| No Military Spaceport anywhere | `createFleet` / `reinforceFleet` returns `no_spaceport`. Stock untouched. |
| Insufficient stock for assembly | `removeFromStock` checks first; returns `insufficient_stock` and mutates nothing. |
| Concurrent reinforcement | Services are synchronous and operate on the live arrays; one call's mutation is visible to the next. UI should batch a single composition per click. |
| Fleet reinforcement by enemy | Rejected — `reinforceFleet` checks `fleet.factionId` matches the calling faction (passed explicitly). |
| Fleet disbanded | New `disbandFleet(fleetId)` returns the fleet's surviving `FleetShip`s to the stock and sets `fleet.destroyed = true` so it's filtered out by the existing movement / sensor / economy code. UI button only available for player at friendly spaceport. |
| Fleet destroyed in battle | Ships vanish with the fleet (current behavior, no change). No return to stock — IG1 behavior. |
| Faction destroyed | `ShipStockService.onFactionRemoved(factionId)` returns the orphaned stock entries. For now they are dropped (no UI shows them); a future `capturedStock` mechanic can hook here. |
| Spaceship Factory destroyed mid-build | `ProductionService.tick` recomputes `productionPower` from current buildings each tick; the active order's `progress` simply stops advancing. To avoid stuck queues, an order that cannot make progress for N seconds is auto-cancelled and its **un-built portion's resource cost is refunded proportionally**. |
| Military Spaceport destroyed | Active fleets are unaffected. New assembly fails until another spaceport exists. |
| Planet lost (captured / destroyed) | All `ProductionOrder`s for that planet are cancelled with refund. Stock is faction-scoped, so it stays with the original faction. |
| Production queue interrupted by save/load | Each order's `progress` is persisted, so it resumes exactly where it stopped. |
| Fleet `targetX/Y` mid-move when reinforced | The movement service is unaffected; `fleet.ships` just grows. Combat draws from the same array, so new ships fight on the next engagement. |
| Game restart | All state hydrated from `localStorage`. New fleets from a previous session are visible; no re-seeding. |
| Save file from before this feature | `migrateSave` backfills `shipStock: []`, `production: []`. No data loss. |

---

## 14. UI Plan (no implementation yet)

### 14.1 Production panel — attached to `Spaceship Factory` building on the planet screen

```
SPACESHIP FACTORY (× 3)
  Capacity: 3/3   Power: 1.5/s

  [ + Corvette ]  [ + Frigate ]  [ + Destroyer ]  [ + Cruiser ]
  [ + Battleship ] [ + Carrier ]  [ + Dreadnought ]

  QUEUE
    [=====>    ] Corvette × 4   22 s left
    [=>        ] Frigate  × 2   38 s left
```

The new `StarMapProductionPanelComponent` is rendered as a tab inside `StarMapPlanetScreenComponent`. It is a pure presentational component fed by `@Input()` callbacks bound to `ProductionService`.

### 14.2 Global Ship Stock panel

A new top-level `StarMapShipStockComponent` mounted in `star-map.html` next to `FactionCurrenciesComponent`:

```
SHIP STOCK
  Corvette      12
  Frigate        7
  Destroyer      3
  Cruiser        1
```

The component reads from `ShipStockService.getStock(playerId)` reactively (manual `cdr.detectChanges()` after each tick, same pattern as the currency widget).

### 14.3 Military Spaceport panel

A new `StarMapSpaceportPanelComponent` reachable from the `Military Spaceport` building on the planet screen. It exposes:

```
CREATE FLEET

  Available Ships
    Corvette      12  [ - 3 + ]
    Frigate        7  [ - 2 + ]
    Destroyer      3  [ - 1 + ]

  Fleet name: [ 1st Fleet    ]
  [ CREATE FLEET ]   [ CANCEL ]
```

The "Existing Fleet" UI (`StarMapFleetInfoComponent`) gains a `REINFORCE` button that opens the same composition widget, pre-filtered to that fleet's faction.

### 14.4 Reused components

- `StarMapFleetInfoComponent` — only an additional `(reinforce)` event and a new button row.
- `StarMapFleetButtonsComponent` — unchanged (lists the new fleet automatically because it iterates `fleets`).
- `StarMapContextMenuComponent` — unchanged.

---

## 15. Files To Modify vs Create

### Modify

- `src/app/components/star-map/star-map.models.ts` — add new interfaces + extend `StarMapData`.
- `src/app/components/star-map/star-map-data.json` — seed `shipStock: []`, `production: []`.
- `src/app/components/star-map/planet-data.json` — add `Military Spaceport`; add `productionSlots` and `productionPower` to `Spaceship Factory`.
- `src/app/components/star-map/ship-data.json` — add `buildTime` and `productionBuilding` to each `ShipType`.
- `src/app/services/ship.service.ts` — surface the new `ShipType` fields.
- `src/app/components/star-map/star-map.ts` — call `ProductionService.tick` from the game loop; pass new services in via DI.
- `src/app/services/save-game.service.ts` — add `migrateSave` for `shipStock` / `production` defaults.
- `src/app/components/star-map/star-map-fleet-info/star-map-fleet-info.component.ts` + `.html` — add `REINFORCE` button + event.

### Create

- `src/app/services/ship-stock.service.ts`
- `src/app/services/production.service.ts`
- `src/app/services/military-spaceport.service.ts`
- `src/app/services/fleet-assembly.service.ts`
- `src/app/components/star-map/star-map-production-panel/star-map-production-panel.component.{ts,html,scss}`
- `src/app/components/star-map/star-map-ship-stock/star-map-ship-stock.component.{ts,html,scss}`
- `src/app/components/star-map/star-map-spaceport-panel/star-map-spaceport-panel.component.{ts,html,scss}`
- `docs/ship-production.md` — dedicated doc for the production pipeline.

### Update docs

- `docs/data-models.md` — document `ShipStockEntry`, `FactionShipStock`, `ProductionOrder`, `FactionProduction`.
- `docs/game-systems.md` — add a "Ship Production & Fleet Assembly" section.
- `docs/architecture.md` — note the new services and their dependency direction.
- `docs/invariants.md` — codify the rules in §13.
- `AGENTS.md` — register `docs/ship-production.md` in the doc index.

---

## 16. Implementation Plan (phased, small steps)

### Phase 1 — Architecture audit & doc scaffolding
- Add `docs/ship-production.md` stub.
- Add new interfaces to `star-map.models.ts`; extend `StarMapData` with `shipStock` and `production` (optional).
- Add `migrateSave` to `SaveGameService`.

### Phase 2 — Global Ship Stock (data-only, no production yet)
- Implement `ShipStockService` with pure helpers.
- Add `shipStock: []` to `star-map-data.json` seed.
- Add a read-only `StarMapShipStockComponent` to render the empty stock.
- Add unit-ish smoke: push a fake `ShipStockEntry`, verify UI counts.

### Phase 3 — Ship Production
- Extend `Spaceship Factory` and `ShipType` data (`productionSlots`, `productionPower`, `buildTime`, `productionBuilding`).
- Implement `ProductionService` with `queueOrder`, `cancelOrder`, `tick(deltaTime, ...)`.
- Wire `ProductionService.tick` into the `StarMap` game loop.
- Implement `StarMapProductionPanelComponent` attached to a `Spaceship Factory` on the planet screen.
- Validate: queue 4 Corvettes on a planet with 1 factory, watch them appear in the stock.

### Phase 4 — Military Spaceport
- Add `Military Spaceport` to `planet-data.json`.
- Implement `MilitarySpaceportService` (read-only `listSpaceports`).
- Add a placeholder `StarMapSpaceportPanelComponent` that lists available ships from the stock and (still) does nothing on submit.

### Phase 5 — Stock → Existing Fleet integration
- Implement `FleetAssemblyService.createFleet` and `reinforceFleet`.
- Add `nextFleetId` allocator.
- Wire the "Create Fleet" button in `StarMapSpaceportPanelComponent` to `createFleet`.
- Add a `REINFORCE` action to `StarMapFleetInfoComponent` (UI binding only).
- Validate: build 4 corvettes, create a fleet with 2, verify the new fleet is on the galaxy map, the stock drops by 2, and the fleet is movable.

### Phase 6 — Fleet reinforcement
- `StarMapFleetInfoComponent` opens the same composition widget filtered to the fleet's faction.
- Validate: reinforce the fleet created in Phase 5, confirm `fleet.ships` grew and stock shrank.

### Phase 7 — Save / Load hardening
- Auto-save after every `ProductionService` order completion and every `FleetAssemblyService` call.
- Test: save, reload, confirm progress and stock both restored.
- Test: load a pre-feature save, confirm `migrateSave` fills defaults.

### Phase 8 — AI integration
- No new code: confirm the same services are callable headlessly (e.g., from a future `AIService`).
- Add a tiny dev-only `__debugCommands.ts` that exercises `queueOrder` / `createFleet` / `reinforceFleet` for manual testing.

### Phase 9 — Orbital Factory preparation
- Add `Orbital Factory` to `planet-data.json`.
- Mark a few ship types (e.g., `dreadnought`, `carrier`) with `"productionBuilding": "orbital_factory"`.
- Verify `ProductionService` rejects those ship types on planets lacking an `Orbital Factory` and accepts them on planets that have one.
- No further code changes should be needed when real Orbital-only ships are added later.

### Phase 10 — Edge cases & docs
- Implement `disbandFleet` and refund-on-factory-loss.
- Implement `onFactionRemoved` stock cleanup.
- Finalize `docs/ship-production.md`, update `data-models.md`, `game-systems.md`, `architecture.md`, `invariants.md`, and the `AGENTS.md` doc list.

---

## 17. Open Questions / Out of Scope (for later)

- **Repair / refit at a spaceport** — design interface only; no mechanics yet.
- **Captured stock** — orphaned stock from destroyed factions is currently dropped (§13).
- **AI production strategy** — the API exists; the actual AI brain is out of scope.
- **Production UI animation / SFX** — out of scope for the design.

---

## 18. Acceptance Criteria

- A new `StarMap` session can: build a `Spaceship Factory`, queue a Corvette, watch it finish, see it in the Global Ship Stock, build a `Military Spaceport`, assemble a fleet of 2 Corvettes, and the new fleet appears on the map and is movable.
- Save, reload, and the production progress, stock, and fleet composition all persist.
- Loading a pre-feature save does not throw and the new fields default to `[]`.
- A unit test for `ShipStockService.removeFromStock` returns the correct entries FIFO and leaves the rest intact.
- `ProductionService.tick` is unit-testable with a fake `deltaTime` and produces the correct `ShipStockEntry` records when an order completes.
- `FleetAssemblyService.createFleet` rejects with `no_spaceport` when the faction has no `Military Spaceport`.

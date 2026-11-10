# Exploration Anomalies

Hidden anomalies in star systems, on in-system asteroids and in open space give scouting a reward: a newly explored area may hold an event the player resolves with a choice.

Code:

- `src/app/components/star-map/anomalies.ts` — pure rules and data: event definitions (`ANOMALY_DEFINITIONS`), tuning (`ANOMALY_CONFIG`), generation, save sanitizing, discovery, activation, cost checks.
- `src/app/components/star-map/anomaly.service.ts` — `AnomalyService`, the live state of the session: restore / serialize, per-frame `update`, the dialog view model, `resolve`, the pirate battle and its loot.
- `src/app/components/star-map/star-map-anomaly-event/` — the event dialog (presentational).
- `StarMap` (`star-map.ts`) wires the service into the game loop, the dialog, the map markers, save/load and the battle return.
- Persisted types: `Anomaly`, `AnomalySite`, `AnomalyState` in `star-map.models.ts`; `StarMapData.anomalies`.

## Sites

An `AnomalySite` always has a galaxy cell `x`/`y` (for system and asteroid sites, the star's cell). Arrival rules (`isFleetAtAnomaly`):

| Kind | Arrival |
| --- | --- |
| `system` | A player fleet on the system cell with no galaxy order left, or inside that system view. Flying through does not count. |
| `asteroid` | A player fleet inside the system on that belt cell (`col`/`row`) — the same rule as surveying ([Star system view](./game-systems.md)). |
| `space` | Any player fleet presence on the cell, moving or not. |

## Lifecycle

`hidden` → `discovered` → `active` → `resolved` (`AnomalyStatus`).

- **Discovered**: the site's galaxy cell is in the player's explored cells (`StarMap.exploredGridCells`, which grows from sensor coverage). Star systems themselves are always `explored` in generated galaxies, so the cell set — not `StarSystem.explored` — is the test.
- **Active**: a living player fleet arrived. A hidden anomaly can become active directly. The triggering fleet id and an activation sequence number are stored; the dialog shows the oldest active event first. If that fleet is gone (destroyed, disbanded, merged), the event returns to `discovered` and can be triggered again.
- **Resolved**: a choice was applied. A resolved anomaly never shows or triggers again.

Invariants:

- Only the human player (`'player'`) discovers and triggers anomalies. AI fleets never change anomaly state, so they cannot open a player popup.
- An anomaly is activated once (only `hidden`/`discovered` can activate) and resolved once (`resolve` requires `active` and sets `resolved` in the same call). A refused choice changes nothing.
- Every state change is persisted immediately (`StarMap.updateAnomalies` saves), so a battle-return reload cannot replay or lose an event; `active` is saved too, so a reload re-opens the pending dialog.

## Event types

Content lives in `ANOMALY_DEFINITIONS`; each choice is a list of effects:

| Effect | Meaning |
| --- | --- |
| `resource` | Positive = reward, negative = cost. Credits / raw materials go through `payCost` / `refundCost` (resource-cost.ts); RP are added to `currencies.research` like other RP rewards. |
| `opinion` | `adjustOpinion(sender, player, amount)`: the anomaly's AI empire's opinion **of the player**. |
| `grant_ship` | One ship of an existing type as a new player fleet at the finder's position (galaxy and in-system), with ids from `FleetAssemblyService.nextFleetId` / `ShipStockService.nextShipId`. |
| `pirate_battle` | The finder fights `ANOMALY_CONFIG.pirateFleet` on the battle screen. |
| `fleet_damage` | Every living ship of the finder loses `fraction` of its type's hull points (`Ship.currentHp`), never below 1 HP, so it never destroys a ship and needs no affordability check. The damage carries into later battles until the ship is repaired at a Spaceport or a space base with Orbital Repair Docks ([Fleet Organization](./fleet-organization.md#repair)). |

| Type | Choices |
| --- | --- |
| Ancient Wreck | Salvage: +800 raw materials · Study: +400 RP |
| Distress Signal | Assist: −200 credits, +15 opinion of the sender AI · Ignore: nothing |
| Pirate Ambush | Battle stations!: fight; victory pays +2,500 credits, +500 raw materials · Break off and flee: no battle, no loot, every ship loses 40% hull (`pirateFleeDamage`) |
| Abandoned Outpost Ship | Claim: +1 Outpost Ship (free) · Leave it: nothing |

Adding an event type: add it to `AnomalyType`, `ANOMALY_DEFINITIONS`, `ANOMALY_TYPES` and the weights. A new effect kind also needs handling in `AnomalyService.resolve` and `describeChoice`.

### Campaign story anomalies

Story-campaign missions author their own anomalies ([Campaign Design](./campaign-design.md#implementation-status)): the mission builder writes them into `StarMapData.anomalies` with a `key` the mission's conditions refer to (`anomaly_resolved`), so `normalizeSave` never generates random ones for a mission. Their types (`probe_wreck`, `echo_beacon`, `relay_signal`, `lacuna_station`) are in `AnomalyType` and `ANOMALY_DEFINITIONS` but **not** in `ANOMALY_TYPES` or the weights (weights are partial; a missing weight is 0), so random games never get them. Their choices may carry the effect `campaign` (`{ effects, summary }`): `resolve` returns those campaign effects in `AnomalyResolution.campaignEffects` instead of applying them, `describeChoice` shows the `summary`, and StarMap hands them to `CampaignService.applyExternalEffects`. The anomaly module therefore does not depend on the campaign session.

### Distress signal sender

The sender is an AI empire picked at generation (`Anomaly.factionId`). The opinion change applies only if that empire still exists and holds a planet or a living fleet (`anomalySender`); otherwise the dialog says "No diplomatic effect" and assisting only costs credits. There is never a global relations change. Without any AI empire, no distress signals are generated.

### Pirate ambush

The ambush reuses the fleet-battle pipeline; there is no separate combat code.

1. `resolve` marks the anomaly resolved and returns a `Battle` (type `fleet`): a virtual pirate fleet (id `-(30 000 000 + anomaly id)`, faction id `'pirates'`, not a real faction) attacks the finder. Only the player's own research bonuses apply.
2. `StarMap` passes it to `BattleService.setBattle` and `enterBattleScreen()` (which saves first).
3. The battle screen persists the result through `BattleOutcomeService.applyFleetBattleOutcome`. The pirate fleet is not in `fleets`, so only the player fleet's losses are written; war bookkeeping is skipped because `'pirates'` is not a faction. Defeat follows the normal rules (a wiped-out fleet is destroyed).
4. On return, `StarMap.removeDestroyedFleetFromService` calls `AnomalyService.applyBattleOutcome`: if the player won, `ANOMALY_CONFIG.pirateLoot` is paid once (`lootClaimed`; the battle result is also cleared right after).

Fleeing (`flee`) resolves the anomaly without a battle and applies `fleet_damage`; the event is gone afterwards, like every resolved anomaly. The loot (2,500 credits / 500 raw materials, raised from 300 / 300 on 2026-11-03) is worth several pirate fleets, so fighting pays off for a fleet that can win; a lone scout can flee instead of being lost.

## Generation and tuning

`generateAnomalies` is deterministic from the galaxy seed (own Mulberry32 stream). All tuning is in `ANOMALY_CONFIG`:

- `systemChance` per unclaimed system, `asteroidChance` per unclaimed system's belt (one random asteroid);
- open space: one per `cellsPerSpaceAnomaly` map cells, clamped to `spaceCount`, kept away from systems, black holes / asteroid belts and each other;
- `weights` per site kind choose the type;
- `pirateFleet`, `pirateLoot`, `pirateFleeDamage`.

Current densities (raised on 2026-11-03 against the empty early game): `systemChance` 0.4, `asteroidChance` 0.25, one open-space anomaly per 2,000 cells clamped to 4–24 (small map ≈ 10, medium ≈ 17, large 24).

Systems with a planet of a major (non-neutral) faction and cells where a fleet stands are skipped, so no event fires at game start or on loading an old save. Changing the tuning affects only games that do not have anomalies yet.

## UI

- **Galaxy map**: a pulsing violet "?" beacon (`--ui-anomaly`) on each discovered, unvisited anomaly; system and asteroid sites sit at the corner of the star's cell. The type is not revealed before the visit. Clicks pass through to the map, so a move order onto the beacon works.
- **System view**: the same beacon on the asteroid of an asteroid site.
- **Event dialog**: name, category, location and finder, flavour text, one card per choice with its consequences (gains, costs, battle). An unaffordable choice is disabled and shows why. After a click all buttons stay disabled until the next event, so a choice cannot be sent twice. The dialog is modal like Fleet Command: the game is paused while it is open, keyboard shortcuts are ignored, and the game resumes on close only if it was running before. There is no close button; every event has an option without a resource cost (the pirate ambush: flee, which costs hull instead).

See [UI Styling](./ui-styling.md) for the design system.

## Save compatibility

`StarMapData.anomalies` is saved. `SaveGameService.normalizeSave` generates the galaxy's set when the field is missing or malformed (a new game's first load), after the in-system asteroid belts exist. A saved state is kept as is; `sanitizeAnomalyState` drops malformed entries and turns an `active` entry without a fleet id back into `discovered`.

Related: [Star Map Terrain](./star-map-terrain.md) (drifting asteroids, the other map event), [Battle Rules](./battle-rules.md), [Diplomacy](./diplomacy.md), [Economy](./economy.md).

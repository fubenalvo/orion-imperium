# Audit: Autosave Before Every `/battle` Navigation

## Goal

Confirm with 100% certainty that the autosave is written before the player ever leaves the star map for the battle screen, and identify any path where this invariant is violated.

## Scope

Every code site that calls `router.navigate(['/battle'])` or any equivalent that reaches the `/battle` route. There are exactly three call sites in the codebase (confirmed via grep on `navigate.*battle`, `navigateToBattle`, `/battle`):

1. `src/app/components/star-map/star-map.ts:1976` — fleet-vs-fleet battle (via `StarMapBattleDetectionService.checkForBattles`)
2. `src/app/components/star-map/star-map.ts:2260` — planet battle (via `StarMap.triggerPlanetBattle`)
3. `src/app/app.routes.ts:5` — only declares the route; not a navigation site.

## Audit of Path 1 — Fleet-vs-fleet (collision detection)

Site: `star-map.ts:1969-1978` invokes
`StarMapBattleDetectionService.checkForBattles(...)` with two callbacks:

- `() => this.saveGame()` (autosave)
- `() => this.ngZone.run(() => this.router.navigate(['/battle']))` (navigate)

Inside `checkForBattles` (`star-map-battle-detection.service.ts:87-101`):

```ts
this.battleService.setBattle({ fleet1, fleet2, ... });   // line 87 — stores refs
saveGame();                                              // line 98
navigateToBattle();                                      // line 99
```

**Order is correct: save BEFORE navigate.** ✓

`setBattle` (`battle.service.ts:40-44`) stores fleet **references** (not copies), so the fleet objects in `BattleService.currentBattle` are the same objects that live in `StarMap.fleets`. This is intentional: it allows `BattleScreenComponent.backToStarMap` to mutate `loser.destroyed = true` and have it propagate back to the map.

**Snapshot safety:** `serializeGameState` (`star-map.ts:2327-2343`) puts the live `fleets` array into the snapshot. `saveToSlot` (`save-game.service.ts:85-93`) calls `JSON.stringify` which produces a deep-cloned snapshot — later mutations of `this.fleets` cannot corrupt the saved data. ✓

**`startBattle` does not mutate original fleet objects:** `battle.service.ts:90-97` builds new fleet objects via spread and a new ships array, so any HP/destroyed init done in `BattleScreenComponent.ngOnInit → startBattle()` does not affect what was saved. ✓

**Verdict: 100% — autosave happens before the view change for fleet-vs-fleet battles, and the snapshot is a true point-in-time copy.**

## Audit of Path 2 — Planet battle

Site: `star-map.ts:2247-2260` inside `triggerPlanetBattle`:

```ts
this.battleService.setPlanetBattle({...});  // line 2247
this.saveGame();                              // line 2259
this.ngZone.run(() => this.router.navigate(['/battle']));  // line 2260
```

**Order is correct: save BEFORE navigate.** ✓

`setPlanetBattle` (`battle.service.ts:46-50`) likewise stores fleet references. The virtual defense fleet is built from the planet's buildings and garrison, all of which are part of the serialized snapshot. ✓

**Verdict: 100% — autosave happens before the view change for planet battles.**

## Audit of Path 3 — Undefended planet capture (no battle)

`star-map.ts:2185-2190` (`handleFleetOnPlanet` branch for undefended planets):

```ts
planet.factionId = fleet.factionId;
this.saveGame();
return;
```

No navigation to `/battle` here. The save happens, the planet is captured in-place, and the player stays on the map. Not a concern for this audit.

## Cross-cutting risks investigated and dismissed

- **`BattleService.setBattle` references** — confirmed safe because of `JSON.stringify` deep-clone in `saveToSlot`.
- **`startBattle` mutating saved fleet data** — confirmed it builds new fleet objects, leaving the saved snapshot intact.
- **Asynchrony between save and navigate** — both run synchronously inside the same Angular event tick, so there is no race where the router navigation could complete before the localStorage write. `localStorage.setItem` is synchronous.
- **`saveGame()` reading stale data** — `serializeGameState` is called inline, reads current `this.fleets`/`this.starSystems`/`this.currentView`, and `JSON.stringify`s the result before `localStorage.setItem`. No async hop.

## Conclusion

**The autosave invariant holds: every code path that navigates to `/battle` writes the autosave in the same synchronous tick, before the router navigation runs.** No fix is required for this aspect.

## Optional hardening (not required, but worth considering)

For defense in depth, you could centralize the "navigate to battle" operation in a single helper that always saves first, e.g.:

- In `StarMap`, add a private method `enterBattleScreen()` that does `this.saveGame(); this.router.navigate(['/battle']);`.
- Have `checkForBattles` and `triggerPlanetBattle` call this helper instead of taking save/navigate callbacks separately.
- This eliminates the risk of a future contributor adding a new battle path that forgets the save.

This is purely a refactor for safety; the current code is correct.

## Validation

Manual test for each path:

1. **Fleet-vs-fleet**: open localStorage devtools, navigate to `/`, start a new game, move two opposing fleets into the same grid cell, observe autosave slot 0 updated immediately before the route changes to `/battle`. Repeat the same inspection on the in-game `SaveGameService` logs.
2. **Planet battle**: same setup but order a fleet to attack a defended enemy planet. Confirm autosave is written just before navigation.
3. **Undefended planet capture**: confirm no navigation occurs and only a save+state change is applied (already documented in `docs/battle-rules.md`).

## Out of scope

- Whether the in-memory state is reloaded correctly on return (already covered in the previous fix).
- Whether `destroyedFleetId` propagation works (already covered).
- Refactoring `checkForBattles` callback signature to remove the two-callback pattern.
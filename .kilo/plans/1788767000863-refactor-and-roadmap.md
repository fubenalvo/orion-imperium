# Orion Imperium — Refaktorálási és fejlesztési terv

## 0. Projekt snapshot (audit alapján)

- **Stack**: Angular 22 standalone, TS ~6.0, RxJS 7.8, Vitest 4, jsdom 28, localStorage-only persistence, nincs backend.
- **Méret**: ~2621 soros `src/app/components/star-map/star-map.ts` (god component), 40+ metódus, 23+ publikus eseménykezelő, ~13 injektált service, manuális `cdr.detectChanges()` + `ngZone.run()` hívások, **nulla signal/input/output használat**.
- **AI pipeline**: V3 (célvált.) → V4.1 strategy → V4.2 goal → V4.3 capability → V5 action (elavult) → V5.1/V5.2 executor. Az executor csak `produce_colonizer` és `assemble_fleet` action-öket hajtja végre, a többit (`move_to_target`, `colonize`, `attack`, `defend`, `develop`) ignorálja.
- **Battle**: legkisebb HP-s target, nincs weapon effectiveness, nincs shield regen, nincs shield pool alkalmazás, nincs kritikus találat/evasion, nincs winner-survivor visszaírás.
- **Tech debt**: ~30+ `console.log` debug a runtime kódban (StarMap, AI service-ek, movement, battle detection), `any` típusok 3 spec fájlban, ismétlődő `tick(deltaTime, ...)` minták az AI service-ekben.
- **Dokumentáció**: 7 db `docs/*.md`, jól karbantartott, az `AGENTS.md` részletes (kód-stílus + dok irányelvek).
- **Teszt**: ~289 teszt, főleg service-szintű; a god component saját spec-jében csak 15 teszt van (túlnyomórészt AI integráció).

## 1. Áttekintés

Négy, egymásra épülő fázis. Minden fázis végén a meglévő ~289 tesztnek zöldnek kell maradnia, plusz az új tesztek is.

| # | Fázis | Fókusz | Kockázat |
|---|---|---|---|
| 1 | God component szétbontása | `star-map.ts` → 5–7 kisebb komponens/service, signals a leveleknél | magas (UI regresszió) |
| 2 | AI action-ök befejezése | V5.3: move/colonize/attack/defend végrehajtás, enemy fleet reinforcement | közepes |
| 3 | Hiányzó gameplay | weapon effectiveness, shield pool/regen, re-conquest, hospital/food | közepes |
| 4 | Új feature + tech debt | diplomacy, ship design, audio, debug-log cleanup, `any` → típusok | alacsony |

---

## 2. Fázis 1 — God component szétbontása + signals migráció

### 2.1 Probléma

- Egyetlen `StarMap` komponens 2621 sor, ~13 service-t kezel, 23 publikus `on*` handler.
- A state többsége publikus mutable mező (`factions`, `starSystems`, `fleets`, `selectedFleet`, `currentView`, …), kézzel hívogatott `cdr.detectChanges()` és `ngZone.run()`.
- Ez blokkolja a további feature-öket (pl. ship design, diplomacy) és lassítja a review-t.

### 2.2 Cél architektúra

A `StarMap` legyen egy **tiszta orchestrator shell** (template + game-loop binding), amihez a következő, jól határolt egységek csatlakoznak:

| Új egység | Felelősség | Becsült fájl |
|---|---|---|
| `StarMapStore` (signal-alapú szolgáltatás) | Minden írható/olvasható runtime state: `factions`, `starSystems`, `fleets`, `selected*`, `currentView`, `cameraX/Y`, `targetX/Y`, `exploredGridCells`, `production`, `shipStock`, `economyAccumulator`. `signal()`/`computed()` mezők, `update()`-en keresztül írás. | `star-map.store.ts` |
| `StarMapSelectionController` | Selection mutual exclusion, `selectedFleetAction`, context-menu hívások. Signal-okra épül. | `star-map-selection.controller.ts` |
| `StarMapCameraController` | Drag-to-pan, billentyű, viewport resize, `clampCamera`, `bgWidthVw/Hw/Left/Top` getterek. | `star-map-camera.controller.ts` |
| `StarMapGameStateService` (meglévő `StarMapGameLoopService` bővítése) | Game-loop indítás, `reloadAfterBattle`, `saveGame`, `loadGame`, `serializeGameState`. | `star-map-game-state.service.ts` |
| `StarMapViewService` | `enterSystem`, `leaveSystem`, `openPlanetView`, `leavePlanetView`, `applyDefaultView`, `syncTargetFromSelectedFleet`. | `star-map-view.service.ts` |
| `StarMapPlanetArrivalService` | `checkFleetPlanetArrivals`, `handleFleetPlanetArrival`, `triggerPlanetBattle`, kolonizáció, capture. | `star-map-planet-arrival.service.ts` |
| `StarMapFleetActionService` | `moveSelectedFleet`, `reinforceSelected`, `disbandSelected`, `onFleetClick`, `onMapClick`→`getTileCenter`, dragThreshold. | `star-map-fleet-action.service.ts` |
| `StarMapBuildingService` | `onSelectBuildingType`, `onBuildingConfirmed`, `onOpenBuildMenu`, `onCloseBuildMenu`. | `star-map-building.service.ts` |
| `StarMapProductionService` (komponens oldali wrapper) | `onQueueOrder`, `onCancelOrder`, `onTechnologyResearched`. | `star-map-production.controller.ts` |
| `StarMapSpaceportService` (komponens oldali wrapper) | `onSpaceportConfirm`, `onSpaceportDisband`. | `star-map-spaceport.controller.ts` |

A `StarMap` template a fenti service-ek jeleit köti össze `computed()`-eken keresztül.

### 2.3 Signals migráció sorrendje

1. **Levél komponensek előbb** — `StarMapFleetInfoComponent`, `StarMapSystemInfoComponent`, `StarMapPlanetInfoComponent`, `StarMapFactionCurrenciesComponent`, `StarMapShipStockComponent` kapjanak `input()`/`output()`-ot `@Input`/`@Output` helyett. Kb. 7 db kis komponens.
2. **`StarMapStore` signal-alapú** — `signal()`/`computed()` az állapotra, a service-ek ezen keresztül olvasnak/írnak.
3. **`StarMap` maga** — `effect()`-ek a side-effect-ekre (pl. game-loop indítása ngAfterViewInit helyett, save triggerelek), `ChangeDetectionStrategy.OnPush` bekapcsolása. A `cdr.detectChanges()` és `ngZone.run()` hívások törölhetők, ha signal-alapú CD-t használunk.
4. **`BattleScreenComponent`, `StarMapNavigationComponent`, `StarMapPauseComponent`** — ugyanaz a minta, konzisztensen.

### 2.4 Lépések (végrehajtható sorrend)

1. Új `StarMapStore` (signal-alapú) bevezetése, kompatibilitási getterekkel a meglévő mezőkre.
2. `StarMap` csonkítása: kiemeljük a `serializeGameState` / `saveGame` / `loadGame` / `reloadAfterBattle` blokkot → `StarMapGameStateService`.
3. Kiemeljük a camera/drag blokkot → `StarMapCameraController` (signalokra építve).
4. Kiemeljük a selection blokkot → `StarMapSelectionController`.
5. Kiemeljük a planet-arrival blokkot → `StarMapPlanetArrivalService`.
6. Kiemeljük a view-transitions blokkot → `StarMapViewService`.
7. Kiemeljük a building/production/spaceport handlereket → önálló controllerek.
8. A maradék `StarMap` kap `OnPush`-t, signal-okat olvas, `effect()`-ekkel triggereli a save-t és a `changeDetection`-t.
9. Levél komponensek migrálása `input()`/`output()`-ra.
10. `ngZone.run()` és manuális `cdr.detectChanges()` hívások eltávolítása.

### 2.5 Invariánsok és kockázatok

- A jelenlegi `GameTimeService`-alapú game-loop és a RAF-outside-zone működés megmarad; a signal-alapú CD csak a view-t érinti, a game-loop tick-et nem.
- A `triggeredBattles` Set, `fleetPlanetMap` Map, `enemyFactionIds` tömb a `StarMap`-ban marad (privát, run-time-only, nem kell signal).
- A `saveGame` triggerelésekor fontos: a `StarMapStore`-ban lévő adatok a szerializáció forrásai; a `defaultView`, `currentView`, selection-ök, kamera itt élnek.
- A `cdr.detectChanges`/`ngZone.run` eltávolítása után **kötelező** manuális smoke-teszt: pause, speed 2x, drag, kattintás rendszerre és bolygóra, save/load ciklus.
- A spec-ek (`star-map.spec.ts`) `component['gameLoopCallback']` típusú privát elérést használnak — ezeket a refaktor után `effect`-alapú hook-okon keresztül kell triggerelni, vagy egy explicit `tickForTest(deltaTime)` metódust kell hagyni `@internal` jelöléssel.

### 2.6 Érintett fájlok

- `src/app/components/star-map/star-map.ts` → ~300 sorra csökken
- `src/app/components/star-map/star-map.store.ts` (új)
- `src/app/components/star-map/star-map-camera.controller.ts` (új)
- `src/app/components/star-map/star-map-selection.controller.ts` (új)
- `src/app/components/star-map/star-map-view.service.ts` (új)
- `src/app/components/star-map/star-map-planet-arrival.service.ts` (új)
- `src/app/components/star-map/star-map-game-state.service.ts` (új)
- `src/app/components/star-map/star-map-building.service.ts` (új)
- `src/app/components/star-map/star-map-fleet-action.service.ts` (új)
- `src/app/components/star-map/star-map-production.controller.ts` (új)
- `src/app/components/star-map/star-map-spaceport.controller.ts` (új)
- Levél komponensek: `star-map-fleet-info`, `star-map-system-info`, `star-map-planet-info`, `faction-currencies`, `star-map-ship-stock`, `star-map-header`, `star-map-fleet-buttons`, `star-map-context-menu`
- `src/app/components/star-map/star-map.spec.ts` (privát hook-ok átalakítása)
- `docs/architecture.md` frissítése az új struktúrára
- Új `docs/star-map-component.md` (opcionális, csak ha a szétbontás után érdemes külön doksi)

### 2.7 Validáció

- `npm test` — minden meglévő teszt zöld, plusz új service-szintű unit tesztek.
- `npm run build` — production build sikeres.
- Smoke-teszt checklist:
  - [ ] Új játék indítása → SOL/Earth planet view
  - [ ] Pause/resume, 1x/2x
  - [ ] Drag-to-pan + arrow keys + minimap click
  - [ ] Fleet kijelölés → move → system view → planet view
  - [ ] Kolonizáció (colonizer unhabited bolygóra)
  - [ ] Planet battle trigger → battle screen → visszatérés
  - [ ] Save/load (5 slot)
  - [ ] Enemy AI: observer, ahogy colonizert gyárt és flottát szerel

---

## 3. Fázis 2 — AI action-ök befejezése (V5.3+)

### 3.1 Probléma

Az `EnemyActionExecutor` csak `produce_colonizer` (V5.1) és `assemble_fleet` (V5.2) action-öket hajt végre. A `move_to_target`, `colonize`, `attack`, `defend`, `develop` action-ök kiértékelődnek, de a state-et nem módosítják. Ezért az AI jelenleg nem tud önállóan támadni vagy gyarmatosítani, csak akkor, ha a játékos pont a bolygóra küldi.

### 3.2 Lépések

1. **`move_to_target` végrehajtása (V5.3)** — Az executor lekéri az `EnemyActionService`-ből a `targetSystemId`/`targetPlanetId`-t és beállítja a megfelelő flották `targetX/targetY` (galaxy) vagy `system.targetX/Y` (system) koordinátáit a `StarMapMovementService`-en keresztül. Duplikátum-védelem: ha a flotta már a cél közelében van, a service nem állít be új targetet.
2. **`colonize` végrehajtása (V5.3)** — A `PlanetBattleService.resolveUninhabitedArrival()`-t újrahasználjuk: ha egy colonizer-flottás ellenséges flotta a bolygó celláján áll, a colonizáció lefut, a flotta colonizerét elveszítjük, a bolygó factionId megváltozik.
3. **`attack` végrehajtása (V5.3)** — A játékos-flotta detection ugyanaz, mint ami a `StarMapBattleDetectionService`-ben van: ha az enemy flotta ugyanarra a cellára ér, mint egy player flotta, a battle-et triggereljük. Az executor nem duplikálja a battle trigger-t, csak a célpont felé mozgatja a flottát (move_to_target), a többit a meglévő rendszer intézi.
4. **`defend` végrehajtása (V5.3)** — Ha a `defend` action él, az executor a legközelebbi enemy flottát a fenyegető player flotta felé mozgatja (vagy a cél rendszer felé, ha a fenyegetés a rendszerre irányul).
5. **`develop` végrehajtása (V5.3)** — Ha nincs jobb teendő, az AI colonizer gyártást kérhet (`produce_colonizer`) vagy flottát szerelhet, akár újakat a Stock-ból.
6. **Enemy fleet reinforcement conquered planetekről (V5.4)** — Ha egy ellenséges frakciónak van legalább 1 saját bolygója `Spaceship Factory`-val, a factory 0.1x lassabban termel mint a játékos (kicsit kiegyensúlyozottabb multiplayer feeling). Új `EnemyFactoryService.tick(delta, factions, starSystems, production, shipStock)` hívás beépítése a game-loopba.
7. **Duplicate-execution protection** megerősítése: minden action típushoz explicit guard (pl. `attack` action-hoz: `targetFleet !== null && !targetFleet.destroyed && sameCell → már triggereltünk`).

### 3.3 Érintett fájlok

- `src/app/components/star-map/enemy-action-executor.service.ts` (bővítés)
- `src/app/components/star-map/enemy-action-executor.service.spec.ts` (új tesztek: V5.3 move/colonize/attack/defend, V5.4 reinforcement)
- `src/app/components/star-map/enemy-factory.service.ts` (új, V5.4)
- `src/app/components/star-map/enemy-factory.service.spec.ts` (új)
- `docs/invariants.md` § AI Pipeline kiegészítése a V5.3/V5.4 szabályokkal
- `docs/game-state.md` § 4.18 frissítése a V5.3/V5.4 képességekkel

### 3.4 Invariánsok

- Csak AI frakciók (`enemy1`, `enemy2`) módosulnak, a player soha.
- A executor sosem ír közvetlenül fleet/system/planet mezőket, hanem a meglévő service-eken (`FleetAssemblyService`, `ProductionService`, `PlanetBattleService`, `StarMapMovementService`) keresztül.
- Duplicate guard minden action típusnál kötelező.
- Pause: minden új action típus korán returnöl, ha `gameDeltaTime <= 0`.
- Reset: az új `EnemyFactoryService` is `reset()`-elhető a `loadGame()`-ben.

### 3.5 Validáció

- 32 → ~70 executor teszt (új action típusonként 8-10 teszt).
- Új `EnemyFactoryService` ~20 teszt.
- Smoke-teszt: új játék, várj 60 mp-et → observer, ahogy az AI kolonizál egy unhabited bolygót, majd támadja a játékos flottát.

---

## 4. Fázis 3 — Hiányzó gameplay

A `docs/game-state.md` § 8 (Ismert korlátok) és a feature-mátrix hiányosságai alapján priorizálva.

### 4.1 Battle mélység

| Funkció | Hatás | Érintett fájl | Becsült teszt |
|---|---|---|---|
| Weapon effectiveness | Damage formula: `max(1, attack * effectivenessMatrix[attackType][weakness])` — effectiveness JSON táblázatban | `battle.service.ts`, `battle.service.spec.ts`, `battle-rules.md` | 15-20 |
| Shield regen | A csata elején minden ship `shield` mezővel rendelkezik, körönként +`shieldRegen` HP visszatöltődés | `battle.service.ts`, `data-models.md` | 10-12 |
| Shield pool (Planetary Shield) | A planet defense virtual fleet `shieldPool`-ját a damage számoláskor levonjuk a bejövő találatból | `planet-battle.service.ts`, `battle.service.ts` | 8-10 |
| Kritikus találat / evasion | `damage *= (random < critChance ? 2 : 1)`, `evasion = defense / 1000`, determinisztikus RNG-vel (seed-elt) | `battle.service.ts`, `rng.util.ts` (új) | 12-15 |
| Winner survivor roster | A battle végén a surviving fleet-ek a `BattleService.winnerSurvivors[]`-ba kerülnek, és visszatéréskor a `StarMap.reloadAfterBattle()` alkalmazza | `battle.service.ts`, `star-map.ts` → később `star-map-game-state.service.ts` | 6-8 |

### 4.2 Planet / gazdaság

| Funkció | Hatás | Érintett fájl | Becsült teszt |
|---|---|---|---|
| Re-conquest of independent planets | A játékos (vagy bármely frakció) flottája `attack` action-t indíthat independent bolygóra, és visszahódíthatja | `enemy-action-executor.service.ts`, `planet-battle.service.ts`, `invariants.md` | 10-12 |
| Hospital/School hatása a population growth-ra | A `Hospital` +5% sebesség a population growth-ra (cap 100%-os boost), `School` +2.5% | `economy.service.ts`, `data-models.md` | 6-8 |
| School/Research Lab moraleRate javítás | A `planet-data.json`-ban `School: 1.0` → `0.01`, `Research Laboratory: 1.0` → `0.005` (jelenleg 1.0 overpowered) | `planet-data.json`, `economy.service.spec.ts` frissítés | 5-8 |
| Élelmiszer (food) nyersanyag | Új `ResourceType: 'food'`, lakosság fogyaszt `pop * 0.02 food/s`, ha nincs elég → satisfaction drift gyorsul | `economy.service.ts`, `star-map.models.ts`, `faction-currencies` UI | 15-20 |

### 4.3 Invariánsok és kockázatok

- A weapon effectiveness tábla legyen JSON, ne kódba égetett, így új hajóosztály / weapon típus hozzáadása nem igényel refactor-t.
- A battle determinisztikus maradjon a tesztekhez: RNG seed-et a battle indításakor generáljuk, és a UI újra-lejátszáshoz elmentjük a save-be.
- A `Hospital`/`School` boost alkalmazása a population growth szorzóba, nem a base rate-be.
- A re-conquest action csak akkor, ha a bolygó `factionId === 'independent'`.

### 4.4 Validáció

- `npm test` zöld, ~+100 új teszt.
- Smoke: egy közepes csata 2 azonos flottával ~30%-os casualty aránnyal végződjön, ne 0%-kal.

---

## 5. Fázis 4 — Új feature-ök + tech debt

### 5.1 Diplomacy (opcionális, alacsony prioritás)

- `DiplomacyService`: frakciók közötti kapcsolat (`FactionRelation: 'neutral' | 'ally' | 'war' | 'peace'`), trade deal, non-aggression pact.
- UI: `StarMapDiplomacyComponent` (új) a pause menüből elérhető.
- Érintett fájlok: `services/diplomacy.service.ts` (új), `components/star-map/star-map-diplomacy/` (új).
- Becsült teszt: ~30 (kapcsolat-mátrix szimmetria, trade deal resource flow, pact breaking).

### 5.2 Ship design (opcionális)

- JSON-alapú ship-definíció: a játékos saját hajóosztályokat tervezhet (modulok drag-and-drop-pel).
- `ShipDesignService`: validáció (cost ≤ credits, hull size, engedélyezett modulok).
- UI: `StarMapShipDesignComponent` (új).
- Becsült teszt: ~25.

### 5.3 Audio

- Web Audio API alapú BGM (procedurálisan generált ambient sci-fi), SFX (battle, build complete, colonize).
- `AudioService` singleton, lazy init a user gesture után (autoplay policy).
- Volume + mute beállítás a pause menüben.
- Érintett fájlok: `services/audio.service.ts` (új), `docs/game-state.md` § 44 kiegészítve.
- Teszt: 5-8 (audio context init, mute állapot).

### 5.4 Save metadata UI befejezése

- A `MainMenu` és a `StarMapPauseComponent` jelenítse meg: save slotok neve (`Auto`, `Manual 1..4`), dátum (formatozott), kör (gameElapsedTime-ból), galaxis-térkép thumbnail (mini snapshot).
- A `SaveGameService` új metódusai: `getSlotMetadata(i)`, `formatElapsedTime(seconds)`.
- Becsült teszt: 8-10.

### 5.5 Tech debt cleanup

| Feladat | Érintett fájl | Megjegyzés |
|---|---|---|
| `console.log` eltávolítása | `star-map.ts`, `enemy-*.service.ts`, `star-map-movement.service.ts`, `star-map-battle-detection.service.ts` | Cseréljük le egy `DebugService`-re, ami `localStorage.getItem('debug') === '1'` alapján logol, vagy használjunk Angular `NG_LOGGING`-et |
| `any` eltávolítása a spec-ekből | `enemy-action-executor.service.spec.ts`, `enemy-action.service.spec.ts`, `star-map-planet-screen.component.spec.ts` | Helyes típusok a `TestBed.inject<T>()`-szel |
| AI service-ek deduplikációja | `enemy-strategy.service.ts`, `enemy-goal.service.ts`, `enemy-capability.service.ts`, `enemy-action.service.ts` | Közös `BaseAiLayerService` abstract class: `accumulator`, `tick()`, `reset()`, `getActionableResult()`, kód-duplikáció ~40% csökkentése |
| Üres legacy mappák | `src/app/components/{ship,ships,star-map-grid}` | `architecture.md` § "The empty legacy directories" frissítése, ha maradnak — vagy törölhetők, ha nincs referencia |
| `test` script frissítése | `package.json` | A README `npm test` → Vitest 4-gyel `vitest run`/`vitest watch` — megnézni, hogy az `ng test` indítja-e a Vitest-et, vagy kell-e `vitest run` |
| Lint script | `package.json` + `.kilo/command/` | A README nem említ lint parancsot; érdemes `npm run lint` (eslint + prettier) hozzáadása |

### 5.6 Érintett fájlok

- `src/app/services/audio.service.ts` (új)
- `src/app/services/diplomacy.service.ts` (új)
- `src/app/components/star-map/star-map-ship-design/` (új, opcionális)
- `src/app/components/star-map/star-map-diplomacy/` (új, opcionális)
- `src/app/services/debug.service.ts` (új)
- `src/app/services/base-ai-layer.service.ts` (új, abstract)
- AI service-ek refaktorja
- `package.json` — lint script
- `docs/game-state.md` § 1 (feature-mátrix) és § 8 (korlátok) frissítése

### 5.7 Validáció

- Új feature-öknek saját dedikált spec fájljuk van, min. 30 teszt / feature.
- A meglévő ~289 teszt + ~+200 új teszt zöld marad.
- A fenti smoke-tesztek kiegészülnek: diplomacy ablak megnyitható és menthető, ship design valid, audio gesture-ig némítva.

---

## 6. Érintett dokumentáció

| Fájl | Frissítés |
|---|---|
| `docs/architecture.md` | Fázis 1: új StarMap struktúra + signals említés; Fázis 4: üres legacy mappák sorsa |
| `docs/game-systems.md` | Fázis 2: enemy factory + V5.3 action-ök; Fázis 3: weapon effectiveness, shield pool/regen, food, re-conquest |
| `docs/battle-rules.md` | Fázis 3: weapon effectiveness mátrix, shield pool alkalmazás, RNG seed, crit/evasion formula |
| `docs/data-models.md` | Fázis 3: `FleetShip.shield`, `shieldRegen`, `critChance`, `evasion`; `FactionRelation`, `ShipDesign` |
| `docs/invariants.md` | Fázis 2: V5.3/V5.4 invariánsok; Fázis 3: hospital/school szorzók, food hiány hatása |
| `docs/game-state.md` | Feature-mátrix (§ 1) és korlátok (§ 8) frissítése minden fázis után |
| `docs/game-time.md` | Változatlan marad |
| `docs/ship-production.md` | Fázis 3: hospital/school hatása a population growth-ra (érintőlegesen); Fázis 4: ship design (opcionális) |
| `README.md` | Fázis 4: `npm run lint` parancs említése, "signal-free" tény eltávolítása |
| `AGENTS.md` | Nincs változás |

---

## 7. Nyitott kérdések (implementáció előtt tisztázandó)

1. **Refaktor mértéke (Fázis 1)**: a `StarMap` végállapotban hány soros legyen? Javaslat: ≤ 400 sor (orchestrator shell + template). Elfogadható?
2. **Audio**: BGM procedurális (Web Audio) vagy sample-alapú (egy `.mp3`/`ogg` fájl)? A procedurális nem igényel asset-eket, de a sample jobban hangozhat.
3. **Re-conquest**: az `independent` bolygókat bármely frakció (player + AI) visszahódíthatja, vagy csak a player? Ha AI is, akkor az AI elveszítheti a saját bolygóit rebellió után.
4. **Food**: új `ResourceType` hozzáadása egy meglévő UI-t változtat (currency HUD). Jóváhagyod a plusz nyersanyagot, vagy későbbre halasztjuk?
5. **Weapon effectiveness mátrix**: 6 attackType × 6 weakness (3×3 hatékony, 1× ineffektív, 0.5× rezisztens)? Vagy egyszerűsített 3×3?
6. **Save metadata UI**: thumbnail-rajz a galaxisról (canvas snapshot a `StarMapCanvasSnapshotService`-en keresztül), vagy csak szöveges metaadatok?

---

## 8. Rollout / migráció

- A meglévő save-ek visszafelé kompatibilisek maradnak, mert az új mezők (`shield`, `shieldRegen`, `critChance`, `evasion`, `FactionRelation`, `food`) a `SaveGameService.migrateSave`-ben defaultolódnak.
- A `defaultView` opcionális marad, ahogy eddig is.
- A `researchedTechnologies` migration (`['basic_engineering', 'basic_science', 'basic_industry', 'basic_power']`) megmarad.
- A V5.3/V5.4 AI képességek NEM aktívak automatikusan: az `enemy-action-executor.service.ts` constructor-ában egy `aiAggressiveness: 'passive' | 'normal' | 'aggressive'` flag (alap: `normal`).

---

## 9. Kockázatok és mitigáció

| Kockázal | Valószínűség | Hatás | Mitigáció |
|---|---|---|---|
| Signals migráció regressziót okoz | közepes | magas | Lépésenkénti commit, feature-flag a signal vs. class-field mód között, snapshot tesztek |
| AI túlságosan agresszív lesz V5.3 után | alacsony | közepes | `aiAggressiveness` flag, save-game-ben per-mentés állítható |
| Weapon effectiveness mátrix egyensúly felborul | közepes | közepes | Kezdő JSON konzervatív értékekkel (1.0/1.0/0.5), később balance patch |
| Új ResourceType (food) UI regresszió | alacsony | közepes | A `faction-currencies` komponens bővíthető legyen új nyersanyagokkal pattern nélkül |
| God component szétbontás túl nagy PR | magas | alacsony | 4-5 almicro-PR-re bontva (Store, Camera, Selection, View, Arrival) |
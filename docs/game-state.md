# Orion Imperium — Játékállapot, Feature lista és Készültségi fok

> **Verzió:** 0.1  
> **Utoljára frissítve:** 2026-09-04  
> **Scope:** Angular 22 standalone, kliens-oldali, localStorage persistence.

---

## 1. Feature készültségi mátrix

| # | Feature | Állapot |
|---|---------|---------|
| 1 | Galaxy map (100×60) | ✅ |
| 2 | System view (18×10) | ✅ |
| 3 | Planet surface | ✅ |
| 4 | Fleet movement | ✅ |
| 5 | Fog of war / sensor | ✅ |
| 6 | Fleet vs fleet battle | ✅ |
| 7 | Planet vs fleet battle | ✅ |
| 8 | Economy | ✅ |
| 9 | Ship production | ✅ |
| 10 | Global ship stock | ✅ |
| 11 | Fleet assembly (spaceport) | ✅ |
| 12 | Save / load (4 slots) | ✅ |
| 13 | Main menu | ✅ |
| 14 | Pause menu | ✅ |
| 15 | Time controls (1x/2x/pause) | ✅ |
| 16 | Camera / navigation | ✅ |
| 17 | Context menu | ✅ |
| 18 | Fleet info panel | ✅ |
| 19 | System info panel | ✅ |
| 20 | Planet info panel | ✅ |
| 21 | Currency HUD | ✅ |
| 22 | Ship stock HUD | ✅ |
| 23 | Header time controls | ✅ |
| 24 | Production panel | ✅ |
| 25 | Spaceport panel | ✅ |
| 26 | Building placement | ✅ |
| 27 | Planet colonization | ✅ |
| 28 | Planet capture | ✅ |
| 29 | Satisfaction / rebellion | ✅ |
| 30 | CRT style / parallax | ✅ |
| 31 | Responsive layout | ✅ |
| 32 | Options / Credits | ❌ stub |
| 33 | Diplomacy | ❌ |
| 34 | Research tree | ❌ |
| 35 | Ship design | ❌ |
| 36 | AI opponents | ❌ |
| 37 | Missions | ❌ |
| 38 | Multiplayer | ❌ |
| 39 | Audio | ❌ |
| 40 | Save metadata UI | ⚠️ partial |

---

## 2. Tech stack

- Angular 22 standalone
- TypeScript ~6.0.2
- Angular CLI 22.1.5
- Vitest 4.0.8
- localStorage (`orion_save_slots`)

---

## 3. Architektúra

### Route-ok
- `/` → MainMenu
- `/star-map` → StarMap (galaxy/system/planet)
- `/battle` → BattleScreenComponent

### Könyvtár
```
src/app/
  main-menu/
  components/
    star-map/           # central orchestrator + child components
    battle-screen/
    background-stars/
  services/
    game-time.service.ts
    ship.service.ts
    battle.service.ts
    planet-battle.service.ts
    economy.service.ts
    production.service.ts
    ship-stock.service.ts
    spaceport.service.ts
    fleet-assembly.service.ts
    save-game.service.ts
```

---

## 4. Rendszer dokumentáció

### 4.1 Star Map (galaxy)
- 100×60 grid, 2vw desktop / 3.5vw mobile
- 1-indexed grid coordinates
- Parallax background (200% size, 0.3× camera)
- Camera: arrow keys, drag-to-pan, minimap, d-pad
- Selection mutual exclusion: fleet / system / planet
- Auto-save on state changes

### 4.2 Star System view
- 18×10 grid, 5vw cells
- Planet arc layout: `col = 13 - index`, `row = 6 ± (index % 3)`
- Fleets in vw units, no fog inside systems
- Planet arrivals: colonize / capture / ignore / trigger battle

### 4.3 Planet Surface
- Grid: `numericSize * 2 + 3` (5/7/9/11)
- 3vw cells
- Tabs: Details, Build (player only), Production (if factory), Assembly (if spaceport)

### 4.4 Movement
- Map: target grid cells, speed/cellSizeVw → cells/s
- System: target vw units, speed direct
- Snap at < 0.01 distance

### 4.5 Fog of War
- Player fleet range = max(floor, best ship range), default 3
- Player system range = 5
- Euclidean circles
- Black/grey/visible layers
- `exploredGridCells` monotonic

### 4.6 Battle
- Fleet vs Fleet: same cell, different teams, not already triggered
- Planet vs Fleet: arrival at defended enemy planet
- Virtual defense fleet from buildings
- Turn-based: attacker → defender, weakest HP target
- Damage = max(1, attack - defense)
- No weapon effectiveness, no crit/evasion

### 4.7 Economy
- Stock: credits (floored), rawmaterials, research
- Flow: energy (efficiency only)
- Efficiency = 1.0 if energy ok, else production/consumption
- Satisfaction 0-100, drift ±1/s
- 0 satisfaction → rebellion → independent faction

### 4.8 Production
- One order per planet
- Spaceship Factory = 1 slot, 0.5 power/s
- Cost deducted up-front
- Progress = delta / buildTime * power
- Auto-cancel after 30s stall, refund unbuilt

### 4.9 Game Time
- GameTimeService: speed (1|2), isPaused, elapsed
- RAF always runs, scaled delta = 0 when paused
- Economy ticks every 1s game time
- Production tick every frame
- Keyboard: Space, 1, 2, arrows, Escape

### 4.10 Save / Load
- 4 slots, localStorage key `orion_save_slots`
- Full StarMapData snapshot
- Migration: shipStock/production backfill, vw→grid, destroyedFleetId

---

## 5. Data Models

### StarMapData
- factions, map, starSystems, fleets
- currentView, camera, selection
- exploredGridCells, shipStock, production

### Faction
- id, name, color, team
- currencies: credits, rawmaterials, research

### StarSystem
- id, name, x/y (1-indexed grid)
- planetsTiles, explored, gridCol/Row

### PlanetTile
- id, index, name, factionId
- type, size, population
- buildings[], explored, satisfaction

### Fleet
- id, name, factionId, x/y
- targetX/Y, speed, system
- ships[], destroyed, sensorRange

### ShipType (11 types)
- Scout, Fighter, Corvette, Frigate, Destroyer, Cruiser
- Carrier, Battleship, Battlecruiser, Dreadnought, Colonizer

### BuildingType (15 types)
- Defense: Laser Turret, Missile Turret, Planetary Shield
- Housing: Small/Medium/Large Residential
- Industry: Small/Medium/Large Factory
- Energy: Solar Panel, Fusion Power Plant
- Research: Small/Large Research Lab
- Infrastructure: Spaceport, Spaceship Factory, Orbital Factory, Mining Complex
- Social: Park, Hospital, School, Entertainment Center

---

## 6. UI Komponensek

### Screens
- MainMenu: new/load game
- StarMap: galaxy/system/planet views
- BattleScreen: turn-based battle UI

### HUD
- Header: title, time controls, currencies, stock
- Pause: overlay, save/load, exit
- Currencies: expandable breakdown
- ShipStock: expandable list

### Info Panels
- Fleet: composition, attack/defense, actions
- System: info, enter system
- Planet: info, open planet

### Planet Sidebar
- PlanetScreen: grid, build mode
- ProductionPanel: queue, ETA, cancel
- SpaceportPanel: create/reinforce/disband

### Navigation
- NavigationComponent: d-pad + minimap
- Minimap: 240×144, drag, click-to-move
- ContextMenu: overlap disambiguation

---

## 7. Kezdeti adatok

### Factions
- Player (team 1, blue, 1000 resources)
- Enemy1 (team 2, red)
- Enemy2 (team 2, teal)
- Independent (team 0, yellow)
- Unhabited (team 0, grey)

### Galaxy
- 10 star systems, 1-6 planets each
- Player starts at SOL (4 planets, partial development)
- Starting fleets: ORION (2 frigates), PEGASUS (3 cruisers)
- Enemy fleets: RAIDER (4 destroyers), HUNTER (6 scouts + 2 destroyers)

### Resources
- Starting: 1000 credits, rawmaterials, research
- Energy is flow resource (not stored)

---

## 8. Ismert korlátok

- No weapon effectiveness (attackType/weakness not applied)
- No shield regen in battle
- No shield pool application
- No crit/evasion/randomness
- Weakest-HP targeting only
- Winner survivor roster doesn't persist
- Population/workforce/morale fields unused
- No re-conquest for independent planets
- Debug console.log statements present

---

## 9. Tesztek

- Vitest 4.0.8 + jsdom
- Existing: app.spec.ts, main-menu.spec.ts, star-map.spec.ts, game-time.service.spec.ts, star-map-sensor.service.spec.ts
- Coverage limited to game loop and sensor service

---

## 10. Összefoglalás

A játék jelenlegi állapota:
- Core gameplay loop működik (map → system → planet → battle)
- Gazdasági és gyártási rendszer teljesen működik
- Fleet assembly és ship stock működik
- Save/load és fog-of-war működik
- Hiányzik: AI, diplomacia, research tree, hang, multiplayer

Ez a dokumentum a játék teljes jelenlegi állapotát írja le feature-felel és készültségi fokok szerint. A kódhoz nem nyúltam, csak ezt a dokumentációs fájlt hoztam létre.

# Orion Imperium – 4X Feature Roadmap Plan

## Current State Summary

The game is a functional Angular 22 standalone 4X prototype with the following working systems:

| System | Status | Notes |
|--------|--------|-------|
| **Galaxy Map** | Working | 200x120 vw grid, 10 star systems, 4 fleets, camera panning |
| **System View** | Working | Enter/leave systems, fleet movement inside systems |
| **Planet View** | Working | Planet surface grid, building placement with validation |
| **Fleet Movement** | Working | Click-to-move on map and in systems, speed-based |
| **Battle System** | Basic | Turn-based collision battles, simple damage = attack - defense |
| **Economy** | Partial | Credits income from population, building/ship maintenance |
| **Save/Load** | Working | 4 localStorage slots, auto-save on key events |
| **Factions** | Partial | Player, 2 enemies, unhabited. Team-based battle eligibility |

## Gaps vs. 4X Pillars

### Explore
- No fog-of-war or line-of-sight
- Planets are either `explored: true/false` with no exploration mechanic
- No sensor ranges, no scouting gameplay

### Expand
- No colonization mechanic (no colony ships, no claiming unhabited planets)
- Planet ownership is static in JSON data
- No population growth mechanics

### Exploit
- Only `credits` currency is actively used (income = pop × 0.1/s, maintenance costs)
- `rawmaterials` and `research` currencies exist in data but are never modified
- No resource production from buildings (mines, labs, etc.)
- No research tree or technology progression
- No energy system enforcement (energy consumption > production has no penalty)
- Population is static (no growth, no cap enforcement)

### Exterminate
- Battles use `damage = attack - defense` only
- Ship `shield`, `shieldRegen`, `attackType`, `weakness` are defined but unused in combat
- No target selection logic (always attacks weakest ship)
- No retreat, no fleet composition strategy, no battle abilities
- Planetary defenses (turrets, shields) are cosmetic only — not used in battle

## Proposed Feature Plan

### Phase 1: Economy & Resource Loop (Exploit foundation)

**Goal:** Make the three currencies functional and create meaningful economic decisions.

1. **Resource Production from Buildings**
   - Mining Complex → produces `rawmaterials` per second
   - Research Laboratory → produces `research` per second
   - Industrial Factory → converts rawmaterials to credits (or produces bonus credits)
   - Solar Array / Fusion Power Plant → already tracked for energy, add to economy service
   - Extend `EconomyService` to track all three currencies with per-building production rates

2. **Population Growth**
   - Population grows over time based on available housing, food (new building type or planet trait), and morale
   - Morale influenced by social buildings (parks, hospitals, schools, entertainment)
   - Growth rate: `baseRate × housingCapacityFactor × moraleFactor`

3. **Energy Balance**
   - Enforce energy consumption vs production: if `consumption > production`, apply penalties
   - Penalty options: reduced building efficiency, population unhappiness, or blackout (no income)
   - Display energy balance on planet info panel

4. **Building Upgrade / Demolish**
   - Allow demolishing buildings (refund partial cost)
   - Allow upgrading (e.g., Small → Medium → Large Residential Block)

### Phase 2: Exploration & Colonization (Explore + Expand)

**Goal:** Make the galaxy feel alive and expandable.

1. **Fog of War / Sensor Range**
   - Fleets have a `sensorRange` based on ship types (scouts have higher range)
   - Star systems outside sensor range are hidden or dimmed
   - Planets within sensor range become visible on the map
   - Fleet vision propagates to allied factions

2. **Colonization Mechanic**
   - New ship type: `ColonyShip` (civilian, no combat ability)
   - Action: "Colonize" when selected fleet is adjacent to an unhabited planet
   - Colonization requirements: enough population on source planet, enough credits
   - Colonized planets join player faction, initial population transferred
   - Planet type determines habitability modifier (earthlike > marslike > desert > ice > gas giant)

3. **Scout & Explore Gameplay**
   - Scout fleets can "survey" unhabited planets to reveal resources
   - Exploration events: find anomalies, ancient ruins, resource bonuses
   - Unexplored systems show as "?" on the map

### Phase 3: Combat Depth (Exterminate)

**Goal:** Make battles strategic rather than automatic.

1. **Shield & Armor System**
   - Damage order: shields absorb first, then armor (defense), then hull (hitPoints)
   - Shield regeneration at start of each round
   - Attack types: kinetic > missile > energy > kinetic (rock-paper-scissors)
   - Weakness bonus: +50% damage when attacking with effective type

2. **Target Selection**
   - AI targeting options: weakest ship, strongest ship, support ships first, random
   - Player can manually target ships in battle screen
   - Defensive formations (fleet abilities)

3. **Fleet Abilities**
   - Abilities per ship type: flank, shield boost, missile barrage, boarding
   - Cooldown-based, cost energy/mana
   - Adds decision-making to battle flow

4. **Planetary Invasion**
   - When fleet attacks a system with enemy planets, option to invade
   - Planetary shields and turrets actually fire at invading fleets
   - Ground combat: simplified troop-based resolution
   - Planet loyalty/conquest mechanics

### Phase 4: AI Opponents & Diplomacy

1. **AI Faction Behavior**
   - AI expands, builds fleets, colonizes planets
   - AI has personality: aggressive, defensive, expansionist
   - AI declares war/peace based on relative strength and proximity

2. **Diplomacy**
   - Trade agreements (resource exchange)
   - Non-aggression pacts
   - Alliances against common enemies
   - War declarations and peace treaties

3. **Technology Tree**
   - Research points unlock new ship types, building types, abilities
   - Tech branches: Military, Economic, Exploration, Engineering
   - Prerequisites and branching paths

### Phase 5: Polish & Content

1. **UI/UX Improvements**
   - Minimap for galaxy view
   - Fleet waypoints (multi-stop movement)
   - Notification system (battle alerts, low resources, events)
   - Tooltips everywhere

2. **Random Events**
   - Solar flares (damage fleets in system)
   - Pirate raids
   - Trade convoys
   - Scientific discoveries

3. **Victory Conditions**
   - Domination (destroy all enemy fleets and colonize all planets)
   - Economic (reach X credits and research points)
   - Scientific (research all technologies)

## Implementation Priority Rationale

**Phase 1 first** because:
- The economy is currently a placeholder. Making it real creates the core gameplay loop.
- Building production rates, population growth, and energy balance are data-driven changes that fit existing architecture.
- No new UI views needed — just extend existing planet info panels.

**Phase 2 second** because:
- Exploration and colonization are the "what do I do next" loop after economy is stable.
- Fog of war fundamentally changes the map experience.
- Colonization gives the player agency to expand beyond the starting position.

**Phase 3 third** because:
- Combat depth requires the most design work (targeting, abilities, shield/armor).
- Can reuse the existing BattleService architecture.
- Makes late-game conflicts meaningful.

**Phase 4 fourth** because:
- AI and diplomacy are content-heavy.
- Depends on having enough game systems to make AI decisions interesting.

**Phase 5 last** because:
- Pure polish and content additions.
- Can be done incrementally.

## Key Technical Decisions Needed

| Decision | Recommendation | Why |
|----------|---------------|-----|
| Turn-based vs real-time combat | Keep turn-based (current) | Fits existing BattleService architecture |
| Data-driven vs hardcoded resources | Data-driven (JSON configs) | Matches existing pattern (ship-data.json, planet-data.json) |
| AI architecture | Service-based with faction state | Fits existing service pattern |
| Tech tree storage | In Faction object or separate TechState | Factions already have currencies; extend pattern |

## Files That Will Need Significant Changes

- `src/app/services/economy.service.ts` — Major expansion for multi-currency, production, population, energy
- `src/app/components/star-map/star-map.models.ts` — New types for colonization, exploration, tech
- `src/app/components/star-map/star-map.ts` — Fog of war logic, colonization actions, event handling
- `src/app/components/star-map/star-map-movement.service.ts` — Sensor range calculations
- `src/app/services/battle.service.ts` — Shield/armor system, target selection, abilities
- `src/app/components/star-map/star-map-planet-screen/` — Energy display, production rates, population growth
- `src/app/components/star-map/star-map-planet-info/` — Resource production breakdown
- `planet-data.json` — Add production rates to buildings
- `ship-data.json` — Add sensorRange, ability definitions

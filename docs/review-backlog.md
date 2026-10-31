# Review Backlog (2026-10-31)

A prioritized list of fixes, design changes and balance work from the gameplay review of 2026-10-31. Each item is written to be usable on its own as a task prompt: problem, evidence, files involved and a suggested direction.

Evidence labels: **[Played]** was observed in a play session; **[Code]** comes from reading code, docs or the AI simulation (`ai-simulation.spec.ts`). "Suggestion" lines are design proposals, not decisions.

When an item is done, remove it (or mark it done) and update the documentation it touches, as `AGENTS.md` requires.

Related: [Economy](./economy.md), [Planet Capture](./planet-capture.md), [Ship Production](./ship-production.md), [Exploration Anomalies](./exploration-anomalies.md), [Diplomacy](./diplomacy.md), [Game Systems](./game-systems.md).

---

## P0 – Critical: breaks the game, do first

### 2. [Bug] A recaptured planet rebels again immediately [Played, confirmed in code]

- **Problem:** a captured planet keeps 0% satisfaction. If it is energy-short, it rebels again on the next economy tick, while the battle screen showed "CAPTURED". Independent planets cannot be built on, so the loop cannot be broken.
- **Files:** `src/app/services/planet-ownership.service.ts` (`transferPlanet`), `src/app/services/economy.service.ts`
- **Suggestion:** on capture or colonization, set a minimum satisfaction (e.g. 30–50) and give a few minutes of protection from rebellion. Update `docs/planet-capture.md`.

### 3. [Bug] Soft-lock: no planet and no colonizer, but no defeat [Played]

- **Problem:** with no planet, no income and no colonizer, but living fleets, the game stays "in progress" with no way out.
- **File:** `src/app/services/game-outcome.service.ts`
- **Suggestion:** defeat when there is no planet and no fleet that can gain one (a colonizer, or a reachable capturable independent/enemy planet). Alternative: an emergency colonizer. Update the docs.

---

## P1 – Important bugs

### 5. [Bug] Every ship in a multi-ship production order gets the same id [Played + Code]

- **File:** `src/app/services/production.service.ts` (~line 285): the completion loop calls `nextShipId` before adding anything to the stock.
- **Fix:** increasing ids inside the loop (first id + i). Add a regression test, and check whether existing saves with duplicate ids cause problems (migration?).

### 6. [Bug/Balance] Build time does not scale with order quantity [Code]

- **Problem:** 10 ships take as long as 1.
- **File:** `src/app/services/production.service.ts` (`buildTime` × `quantity`)
- **Suggestion:** multiply build time by quantity, or deliver ships to the stock one at a time. Update `docs/ship-production.md`.

### 7. [Bug] The player's own home system shows status "UNEXPLORED" [Played]

On the galaxy map system panel.

### 8. [Bug] Game speed resets from 2× to 1× after every battle [Played]

- **Files:** `src/app/services/game-time.service.ts`, return from the battle screen.
- **Suggestion:** keep the speed for the session.

### 9. [Bug] `StarMap.onBuildingConfirmed` does not validate placement [Code]

Overlap and terrain are checked only in the planet screen UI. Move the placement rule into a shared function and call it from both places.

---

## P2 – Balance

### 10. [Balance] Credit glut [Played + Code]

- **Evidence:** 15k credits at minute 4, 38k at minute 8; in the AI simulation, AIs hold 80–177k unspent credits at minute 30.
- **Consequences:**
  - peace is trivially cheap (250 credits ≈ 2 s of income);
  - the credit part of research prices does not matter;
  - building prices do not matter either.
- **Files:** `src/app/services/economy.service.ts`, `planet-data.json`, `ship-data.json`, `docs/economy.md`
- **Suggestion** (pick one or more): lower population income (0.1 per inhabitant), higher upkeep, meaningful credit sinks (building upgrades, rush construction, scaled ship upkeep). Run `ai-simulation.spec.ts` first to get a baseline.

### 11. [Balance] Peace is too cheap [Played]

- **Problem:** the AI's "peace value" `scale` (~1 minute of income) is small next to the accumulated treasury.
- **File:** `src/app/components/star-map/enemy-diplomacy.service.ts` (`assessWar`)
- **Suggestion:** scale the AI's demand with the other side's treasury too. Revisit after item 10.

### 12. [Balance] The pirate anomaly always loses value and does not scale [Played]

- **Problem:** a fixed 2 fighters + 1 corvette for 300/300 loot. In play I lost a frigate (180 credits / 540 raw materials). It cannot be declined.
- **File:** `src/app/components/star-map/anomalies.ts` (`ANOMALY_CONFIG`)
- **Suggestion:**
  - scale the pirate fleet and loot with game time or with the finder's fleet strength;
  - add a "retreat" option with a small cost;
  - make the loot worth the risk.

### 13. [Balance] Anomaly rewards are tiny compared to the economy [Played]

800 raw materials / 400 RP / 200 credits. Suggestion: scale rewards with game time or income.

### 14. [Balance] Slow, empty galaxy [Played]

- **Evidence:** 8–14 systems on 180×108 … 300×180 cells; reaching a neighbour takes ~5 minutes at 1× (speed 4 = 0.2 cells/s).
- **Files:** `src/app/services/galaxy-generator.service.ts`, `src/app/components/star-map/star-map-movement.service.ts`
- **Suggestion:** smaller maps or more systems, and/or faster galaxy movement.

### 15. [Balance] The AI pulls far ahead early [Played]

At minute 8: AI 4–5 planets, player 1–2. Items 1–4 cause part of this; measure again after fixing them before weakening the AI.

---

## P2 – Design changes

### 16. [Design] Fleet galaxy speed should depend on ship types [Played + Code]

- **Problem:** every assembled fleet moves at 4 (`DEFAULT_FLEET_SPEED`, `src/app/services/fleet-assembly.service.ts:118`); the starting fleets get 6–8. A scout is slower than a cruiser.
- **Suggestion:** derive fleet speed from the slowest ship. Needs save compatibility and updates to the fleet-organization merge/split logic.

### 17. [Design] Too many steps before the first colony [Played]

- **Problem:** factory (3000) + Spaceport (4000) + colonizer (1200), and the finished ship stays in the stock until a Spaceport exists.
- **Suggestion:** a starting Spaceport on the homeworld, or have colonizers and outpost ships appear directly as a fleet next to the factory.

### 18. [Design] Asteroid surveying is busywork [Played]

- **Problem:** 15–30 rocks must be visited one by one; about 1 in 10 holds a deposit.
- **Suggestion:** a fleet in the system surveys the belt automatically (or within sensor range), possibly over time.

### 19. [Design] Anomaly variety [Played + Code]

Only 4 event types, half of them pirate traps. Suggestion: more event types and multi-step events; lower the pirate share (`weights`).

### 20. [Design] Research is passive and hard to find [Played]

- **Problem:** it opens only from the flask icon; most technologies are +% bonuses; research is an instant purchase.
- **Suggestion:** a dedicated RESEARCH button in the header. Later: a visual tree, a research queue or progress over time.

---

## P3 – UI/UX polish

21. **Build list:** show each building's workforce and output (energy use and the energy-after-building preview are done; see [Economy](./economy.md#energy-and-satisfaction)).
22. **Production dialog:** show ship stats (ATK/DEF/HP/speed/range) and remove the stray scrollbars.
23. **Building placement:** the footprint extends down/right from the clicked cell, which is confusing. Center it or anchor it under the cursor.
24. **Planet info panel:** remove or rename the legacy "DAILY TAX" field (`getTaxForPlanet`).
25. **Peace offer:** the AI judgment should update while typing (`input`), not only on blur.
26. **Battle result screen:** the "ROUNDS" label is misleading in a real-time battle.
27. **Battle screen:** the planet's color should match the system view (green vs. blue).
28. **Onboarding:** a short tutorial or tips (first steps, the energy rule, where research is); the game should not start on the planet surface without explanation.
29. **Mining station:** a larger or more visible marker.

## Documentation

30. `docs/feature-list.md` is out of date: it says 18 technologies (there are 34), "the AI only builds colonizers", and lists old grid sizes. Update or archive it.

---

**Suggested order:** 2 → 3 → 5–6 → 10–11 (economy) → 16–18 → the rest.

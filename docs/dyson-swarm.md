# Dyson Swarm (Design — not implemented)

Status: **design agreed on 2026-11-02. Phase 0 (station construction time) is implemented ([Territory](./territory.md#construction)); the swarm itself is not.** This document is the plan and the source of truth for the feature until the implementation lands; each phase must update it (and the documents it names) to describe the implemented behavior.

The Dyson Swarm is a late-game **alternative victory** and **credit / raw-material sink**. Eight fixed anchor slots ring the central black hole. A faction that holds a completed Dyson Anchor on **every** slot and keeps all of them for a 5-minute warm-up wins. Anchors are expensive to bring there, expensive to keep, cannot be captured and are visible to everyone, so an empire heading for this victory becomes the obvious target of the others.

Related: [Territory](./territory.md) (claims, space bases, station defense), [Star Map Terrain](./star-map-terrain.md#black-holes-navigation-obstacles) (the black hole), [New Game Generation](./new-game-generation.md) (black hole placement and clearance), [Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice) (victory / defeat), [Diplomacy](./diplomacy.md), [Economy](./economy.md#upkeep), [Research](./research.md), [Ship Production](./ship-production.md), [AI Pipeline](./ai-pipeline.md).

## Design goals

- Give rich late-game empires something worth spending credits and raw materials on (AI factions currently pile up 50–350k credits after 30 minutes, see [Economy](./economy.md)).
- A second path to victory besides conquest and the diplomatic victory, which still forces fighting: the ring must be completed **and** held.
- Reuse existing systems: anchors are space bases (station defense model, destroy-only, deployed from a ship), the victory goes through `GameOutcomeService`.
- No capture mechanic: stations stay destroy-only. Losing the ring means rebuilding it.

## Ring geometry

The galaxy always has exactly one black hole, centered on the map, with a no-fly radius of 4 cells; every star system is at least `blackHoleClearance` (14 / 16 / 18 by map size) from its center ([New Game Generation](./new-game-generation.md)). The ring lives in the empty band between the two.

**Slots.** There are always **8 slots**, on every map size and with any number of factions. The positions come from the black hole center (`cx`, `cy`), not from the save:

```text
(cx ± 6.5, cy ± 2.5) and (cx ± 2.5, cy ± 6.5)
```

Why 8: the black hole center lies on a half cell (the 4×4 span is centered on `x + 1.5`), so these offsets land exactly on integer cells, where bases sit. All eight slots are at the same distance (√48.5 ≈ 6.96 cells, about 3 cells outside the no-fly edge), within 1.5° of an exact 45° spacing, and at least 5 cells apart. The layout is mirror-symmetric on both axes, like the home-system ellipse, so no faction is closer to the ring than another. A layout check for 9 and 10 slots found no even grid fit: radii varied by up to 0.5 cells, angles by about 4°, and 10 slots came down to 3 cells apart.

Because the slots are derived from the black hole, they need no saved state and older saves get them automatically.

**Wedges.** Each slot owns one **45° annular sector** of the ring. The sector runs from the no-fly edge (radius 4) to radius 10 (the slot plus 3 cells) and spans the angle between two boundaries at multiples of 45° from the +x axis. Each slot sits within 1.5° of the middle of its wedge. The eight wedges tile the ring without gaps, so a faction holding every slot shows a closed ring in its color. A grid cell belongs to a wedge by the same cell coordinates the territory map already uses.

**Ring zone precedence (territory).** The ring zone is the area of all wedges (distance from the center between 4 and 10):

1. A cell in the ring zone belongs to the owner of its wedge's **completed** anchor, or to nobody. An empty wedge or one under construction claims nothing.
2. No other claim source ever claims a ring cell. This overrides the "a system claim beats a base claim" rule ([Territory](./territory.md#territory)). On the small map a system 14 cells from the center has a 7-cell claim disc that reaches into the ring, and the ring cuts it off.
3. An ordinary space base may be deployed outside the ring zone. Its claim disc is cut by the ring, as above.

Consequences:

- A slot is never inside another faction's territory, so the "no deployment in foreign territory" rule can never lock a faction out of an empty slot.
- Wedges are ordinary territory everywhere else: border violations at peace and sensor rules work as they do for bases.

**Generation.** New galaxies must keep nebulae and asteroid belts off the ring zone. Today nebulae only keep 4 cells from the no-fly edge, so a nebula can still reach radius 8–10. The current exclusion rule for belts is verified in phase 1. Older saves are not supported (see phase 2 and [Versioning](./versioning.md)), so no ring cleanup is needed for them.

## Station construction time (applies to every station)

This is a general rule for every station, introduced together with the swarm (phase 0). Stations are no longer finished on deployment:

| Station | Construction time (game time) |
|---|---|
| Space base (radar) | 60 s |
| Mining station | 180 s |
| Dyson Anchor | 300 s |

- The ship is consumed when construction starts. A site that is destroyed loses the ship.
- **A construction site** is a station object on the station's position:
  - it does not fire back (no turrets) and has no shield pool, only a small hull;
  - it is attacked by the usual rules: war, the same triggers as the finished station;
  - it is destroyed if the attacker wins.
- While under construction the station claims no territory, senses nothing, extracts nothing, gives no bonus and pays no upkeep. It still **reserves its spot**: one station per asteroid, one anchor per slot, base spacing.
- The timer runs on scaled game time and freezes while paused.
- The AI must count its own construction sites as planned. This matters for mining stations, so it does not deploy a second outpost ship on the same asteroid.
- Save: the remaining construction time is an optional field on the station; missing means complete. An additive optional field needs no `SAVE_VERSION` bump ([Versioning](./versioning.md)).

## Research and the anchor ship

- **Technology:** a new technology at the end of the tree (working name *Stellar Engineering*) unlocks the anchor ship. Its research cost is above every current technology (the most expensive today is 4,500 points). The prerequisites should come from the late economy and research branches, so the technologist reaches it first. Exact prerequisites and price are set during phase 2.
- **Ship:** a new ship type (working name *Swarm Constructor*, role `DysonAnchor`).
  - **Very expensive** in credits and raw materials, **very slow** (below the outpost ship's speed of 2) and **fragile** (low hit points, no shield, negligible attack).
  - It is not a combat ship (`isCombatShipType` excludes it, like the outpost ship).
  - It is built and moved like any ship: in a fleet, with escorts. A fleet moves at its slowest ship's speed, so escorts slow down with it.
- **No cap** on how many anchor ships a faction may build or have in flight.

## Anchor lifecycle

1. **Deploy.** A fleet with an anchor ship that is stopped on an empty slot cell shows DEPLOY ANCHOR. The only requirements are:
   - the slot is empty (no anchor, no site);
   - the faction has the technology.

   Territory, base spacing and star distance do not apply to slots, and anchors cannot be deployed anywhere else. The ship is consumed and a construction site appears. The deployment triggers a global news item and the diplomatic effects below.
2. **Construction** (300 s). The site is vulnerable and undefended.
3. **Completed anchor.**
   - Defense: the shared [station defense](./territory.md#station-defense), exactly like an ordinary space base: core hull, 0–3 turrets from Turret Research, shield pool. Stronger defenses may come later.
   - Territory: its wedge.
   - Upkeep: higher than a base's (base 25 points/s, anchor about 60 points/s, tuned in phase 7), scaled by the empire upkeep scale like all station upkeep.
   - Sensor: a completed anchor is a sensor source exactly like a space base (radar), with the same range and research bonus. A construction site senses nothing.
4. **End.** An anchor ends in one of two ways:
   - **Destroyed** in battle. It is never captured.
   - **Demolished** by its owner (DEMOLISH on the anchor panel). This refunds nothing and frees the slot.

   A freed slot can be built on again by anyone, with any bonus.

**Always visible.** Anchors and construction sites (slot, owner, state, construction time left) are visible to every faction regardless of fog of war, including the AI fog of war (`EnemyIntelService`). This differs from ordinary bases, which are only shown once explored.

## Anchor bonuses

Each anchor provides **one small empire-wide bonus**. The owner picks it **once** on the anchor's info panel: during construction or after completion, whichever comes first. The pick cannot be changed. To change it, the owner has to demolish the anchor (no refund) and build a new one. The bonus only applies while the anchor is **completed** and owned. Bonuses of the same type from several anchors add up.

Rule: bonuses must stay **well below the anchor's upkeep in value**, so the swarm remains a net sink and a holder pays for its victory attempt. The starting set is deliberately tiny; more may be designed later:

| Bonus | Effect per anchor (starting value) |
|---|---|
| Stellar power | +1% energy output of power-producing buildings |
| Orbital foundries | −1% raw-material cost of ship production |
| Swarm observatory | + X research points every Y seconds (research costs 4 credits per point, so keep X/Y at a small fraction of the anchor's credit upkeep) |

No credit-income or upkeep-reduction bonus: that would undo the sink.

## Victory: the warm-up

- When one faction holds a **completed** anchor on **all 8 slots**, a **warm-up of 300 s** of game time starts.
- If that faction loses any anchor in the meantime (destroyed or demolished), the warm-up is cancelled and resets to zero. It starts again from zero as soon as the ring is complete again.
- When the warm-up ends, that faction wins:
  - the human player → victory;
  - an AI faction → defeat for the player, with its own wording on the game-end dialog.
- Only anchors of one faction count; allies' or peace partners' anchors are not combined.
- The warm-up only runs while the holder owns at least one planet. A holder that loses its last planet has the warm-up cancelled as if it had lost an anchor. Reaching the technology already takes a working economy, but an empire can still lose its planets while its anchors stand.
- `GameOutcomeService` adds the rule next to the conquest and diplomatic victories. The outcome stays sticky ([Planet Capture](./planet-capture.md#game-outcome-gameoutcomeservice)).
- Save: the active warm-up (faction and time left) is stored, so a reload continues it.
- UI: while a warm-up runs, every player sees a countdown on the map (holder's color, time left).

## Global news

Dyson events are announced to **everyone**, regardless of fog of war:

- anchor construction started (faction, slot);
- anchor completed;
- anchor destroyed (by whom);
- anchor demolished;
- warm-up started;
- warm-up cancelled.

The human player gets them as ordinary map notices, which are transient; no persistent news log is planned. Persistent information is on the map instead: the always-visible anchors and sites, and the warm-up countdown. The AI reads the same facts from the always-visible anchor state, not from the notices.

## Diplomacy

- **Opinion:** starting each anchor (deployment) lowers every other faction's opinion of the builder. One-off per anchor; the amount is tuned in phase 5.
- **Casus belli:** a faction holding **3 or more anchors** (construction sites count) is a legitimate target. Against it:
  - declaring war costs **no reputation** (normally −5);
  - **breaking a truce** is allowed and costs no reputation (normally −40);
  - the **surprise-attack** penalty (normally −15 for attacking within 1 minute of one's own declaration) does not apply.

  The target's own opinion of the declarer still drops as usual; that relation is already hostile.

  Why the truce is included: the truce lasts `TRUCE_SECONDS` = 600 s, the warm-up only 300 s. Without the waiver, a builder could sign peace with everyone and finish the warm-up behind the truces.

  The waiver only applies to actions against the casus belli target, and only while it holds 3+ anchors. It is checked at the moment of the declaration or the breach.
- Anchors are stations: they can only be attacked at war. A border violation in a wedge at peace costs opinion like any trespass ([Territory](./territory.md#border-violations)).

## AI

Personalities decide who builds. Everyone reacts to a threat. There is no coalition logic: each AI reacts on its own.

| Personality | Builds anchors | Against other factions' anchors |
|---|---|---|
| technologist | **always pursues the swarm** once it has the technology: builds and escorts anchor ships, defends its anchors, picks bonuses | defends, destroys |
| militarist | **never** | **aggressive hunter:** uses the casus belli and destroys anchors |
| balanced | opportunistic, when it has a large credit surplus (mainly for the bonuses) | reacts |
| expansionist | rarely or never | reacts |

Threat response, the same for every personality, scaled by its aggression:

- Another faction holds 3+ anchors → candidate war declaration (casus belli) and an **anchor assault** objective.
- Another faction's warm-up is running → anchor assault becomes the top military priority.
  - **Any** personality may break a truce with the holder. Today only treacherous personalities break truces.
  - No AI accepts or proposes peace with a faction whose warm-up is running.

New AI capabilities needed. None of them exist today; the AI neither attacks nor defends stations ([Territory](./territory.md#limitations)):

1. **Station assault objective:** pick a reachable hostile anchor or site, run a battle forecast against the station defense, gather, strike. Later reusable for bases and mining stations.
2. **Anchor defense:** a garrison near its own anchors, sized by the threat.
3. **Build decision:**
   - the anchor's upkeep fits the projected net (like every AI purchase);
   - a free slot exists;
   - the route is safe enough, otherwise send an escort.
4. **Bonus choice** from the faction's needs.
5. The AI never demolishes (first version).

## Implementation phases

Each phase updates this document and the documents it touches.

0. **Station construction time:**
   - sites for bases and mining stations;
   - AI accounting for its own sites;
   - save field;
   - [Territory](./territory.md) update.
1. **Ring geometry:**
   - a pure module for slot positions, wedge membership and ring zone precedence in `territory.ts`;
   - generation exclusion for nebulae and belts;
   - rendering of empty slots and wedges.
2. **Technology, ship, deployment:**
   - DEPLOY ANCHOR;
   - the anchor info panel (state, bonus pick, DEMOLISH);
   - always visible regardless of fog;
   - anchors stored as space bases with a kind and slot index;
   - a `SAVE_VERSION` bump.

   **Save compatibility** follows [Versioning](./versioning.md). The swarm is meant for a MINOR release (0.4.0), which may raise `MIN_SUPPORTED_SAVE_VERSION` to the new format, so no migration is written for the swarm, the ring zone, or nebulae and belts lying on the ring. Older saves are then rejected and listed as incompatible.
3. **Upkeep and bonuses:** upkeep in `EconomyService`, bonus aggregation where each bonus applies.
4. **Victory and news:** warm-up state and saving, `GameOutcomeService`, countdown UI, global news.
5. **Diplomacy:** opinion hit per anchor, casus belli.
6. **AI:** the build / defend / assault behavior above, by personality.
7. **Tuning and acceptance tests** in `ai-simulation.spec.ts`. Targets:
   - a technologist completes the ring in some long games against passive opponents;
   - militarists destroy anchors when someone reaches 3+;
   - holding all 8 anchors costs a noticeable share of a late-game empire's credit income (the target share is set here);
   - the swarm absorbs most of the late-game AI surplus.

## Open questions

- Exact technology prerequisites and costs of the technology, ship and upkeep (phases 2 and 7).
- Opinion hit per anchor, and the target share of credit income for holding the full ring (phases 5 and 7).
- The construction site's hull value (phase 0).

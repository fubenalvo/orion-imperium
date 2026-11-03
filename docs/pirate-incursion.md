# Pirate Incursion

A dynamic event against a quiet galaxy: when nothing has happened for a while, pirates arrive, build a haven in open space and send raiders that take turns harassing every empire. It should be annoying enough to deal with, never strong enough to decide a war.

Code: `src/app/components/star-map/pirate-incursion.ts` (`PirateIncursionService`, `PIRATE_CONFIG`), wired in `StarMap` (tick in the game loop, activity notes, save/load). Tests: `pirate-incursion.spec.ts`.

## Trigger

- Activity = a battle of the player (`StarMap.enterBattleScreen`) or a change in the number of the player's planets; `noteActivity` stores the game second. AI-vs-AI battles and captures do not count: measured on 2026-11-03 (60-minute small and medium AI games), the longest stretch without any battle or capture anywhere was ~440 s, so with galaxy-wide activity the event never fired.
- An incursion starts when the game clock is past `firstAfter` (1200 s = minute 20), there was no activity for `quietSeconds` (480 s) and the cooldown (`cooldownSeconds` 900 s after the previous one) is over. At most one incursion runs at a time.

## Lifecycle

`idle` → `arriving` → `active` → `idle` (`PirateIncursionState.phase`).

1. **Arriving:** a warband enters from a random map edge (the map notice names the compass direction) and flies to a haven site: a cell in the central 60% of the map, at least 8 cells from every star system, reachable by the galaxy router. If it is destroyed on the way, the event ends.
2. **Active:** on arrival it adds a **Pirate Haven** (`SpaceBaseService.addBase`, an ordinary space base of the pirate faction with the usual construction time and station defense; the pirates research nothing, so it has no turrets). The warband stays as its guard. Once built, the haven spawns a raider every 180–300 s, at most 2 raiders at a time.
3. **Raiders** take turns over the living empires (round robin over the sorted ids of empires that own planets: the player and every AI alike). Each flies to the target's colony nearest to it (a homeworld with a Capital only when the empire has nothing else), stays 60 s and drains that empire's credits at 15 credits/s, at most 1500 per raid, then moves on to the next empire. Fights happen through normal battle detection.
4. **End:** the haven is destroyed (by anyone), or it leaves after `havenLifetime` (1200 s). Remaining pirate fleets vanish, the cooldown starts. There is no bounty yet.

## The outlaw faction

The pirates are a real `Faction` (`id: 'pirates'`, `team: 0`, `ai: false`, `outlaw: true`), added to `factions` when the first incursion starts:

- always at war with everyone (`getRelationKind` returns `war` for an outlaw), but outside diplomacy: no relations, no treaties, not on the Diplomacy screen, and fights with them leave no war record (`recordShipLosses` / `recordHostileAct` skip outlaws, so no war exhaustion);
- as a team-0 faction it can never capture planets (`canAttackPlanetOf`), claims no territory and does not count for victory or defeat;
- no economy (StarMap skips outlaws in the economy tick);
- battles: outlaw vs AI is auto-resolved like AI vs AI; the player fights pirates on the battle screen.

## Strength

Every pirate fleet (warband and raiders) is built from destroyers and frigates until it reaches `strengthShare` (40%) of the **median** empire's total fleet strength, between 2 and 12 ships. Pirates therefore grow with the galaxy but stay below an average empire's navy.

## Save compatibility

`StarMapData.pirates` is optional (missing = quiet, nothing happened), the faction lives in `factions`, the haven in the base registry and the fleets in `fleets`, so no save version bump.

## Measured pacing (2026-11-03, `ai-simulation.spec.ts`, passive player, 60 minutes)

- Small map, 2 AIs: incursions at minute 20 (warband destroyed on the way at minute 26) and minute 41 (haven at 43, raids from 49 on).
- Medium map, 3 AIs: incursion at minute 26, haven at 35, raids at 40 and 44, haven destroyed by an AI at 47.
- No pirate planet, no empire broken by the raids. The medium game has two AIs in arrears with or without pirates (an open AI economy issue, not caused by the event).
- In these runs the passive player loses the game early, so raids hit the AIs; with an active player the round robin includes the player.

## Known limits and open points

- The AI has no dedicated haven assault; AI fleets fight pirates they meet and the haven times out. Consider adding the haven to AI assault targets when an empire is raided.
- Raiders do not attack stations or traders on purpose and never plunder planets beyond the credit drain.
- All values in `PIRATE_CONFIG` are first guesses; watch in play whether the event comes too often, too rarely, or is too weak / too strong.

Related: [Planet Capture](./planet-capture.md) (game outcome), [Diplomacy](./diplomacy.md), [Territory](./territory.md) (space bases and station defense), [Battle Rules](./battle-rules.md).

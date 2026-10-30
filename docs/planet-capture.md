# Planet Capture, Battle Resolution and Game Outcomes

How planets change owner, how planet battles are fought and applied, and how the game ends. Related: [AI Pipeline](./ai-pipeline.md) (who decides to attack), [Battle Rules](./battle-rules.md) (combat rules), [Battle Screen](./battle-screen.md) (the interactive minigame), [Game Systems](./game-systems.md) (planet arrivals).

## Single ownership pathway

`PlanetOwnershipService.transferPlanet(data, planet, newOwner, reason)` is the only gameplay code that writes `PlanetTile.factionId` (the galaxy generator sets initial owners). Callers decide whether their rule allows the change; the service applies it consistently:

- writes the new owner (a transfer to the current owner is a no-op, so a rule that fires twice cannot apply twice);
- cancels the previous owner's production orders on that planet and refunds their unbuilt part — a captured factory never keeps building for the faction that lost it (`ProductionService.tick` only refunds orders whose planet vanished entirely);
- increments `revision`; `StarMap.gameLoopCallback` re-evaluates the game outcome whenever the revision changed during the frame.

Population, buildings, satisfaction and the persisted planetary shield pool stay with the planet.

| Reason | Caller |
|---|---|
| `colonized` | `StarMapPlanetArrivalService.colonize` (player COLONIZE button), `EnemyActionExecutor.executeColonize` (AI) |
| `captured` | arrival on an undefended / shield-only planet (player arrival service, AI `EnemyInvasionService`) |
| `battle_won` | `BattleOutcomeService.applyPlanetBattleOutcome` (battle screen and AI auto-resolve) |
| `rebellion` | `EconomyService.applyEconomyDelta` (satisfaction reached 0 → `independent`) |

## Capture rules

Identical for the player and the AI:

1. Only a planet owned by a faction on **another team** can be attacked; neutral team 0 (e.g. `independent` rebels) counts as another team. Own and allied planets never; `unhabited` planets are colonized, not captured.
2. A planet without combat defenses (no turret; a planetary shield alone does not fight) is captured on arrival.
3. A defended planet changes owner only through a won planet battle. A real garrison fleet involved in the battle is destroyed with the planet on attacker victory.

Where the rules run:

- **Player:** `StarMapPlanetArrivalService`, only for the system the player is viewing (it needs system-view positions).
- **AI:** `EnemyFleetService` (assault role) + `EnemyInvasionService` on galaxy-map cells — never dependent on the player's view or on explored state.

## Planet battle paths

| Defender | Path |
|---|---|
| Human player | Interactive battle screen. `EnemyInvasionService` queues the `Battle`; `StarMap` takes it after the AI tick (`StarMapAiTickService.takePendingPlayerBattle`), calls `BattleService.setPlanetBattle` and navigates — the same transport as a player-initiated planet battle. The player defends (AUTO available). |
| Anyone else (independent rebels, …) | `autoResolveBattle` (non-interactive, immediate). |

Both paths end in `BattleOutcomeService.applyPlanetBattleOutcome`: ownership on attacker victory via `PlanetOwnershipService`, attacker roster written back (damage and destroyed ships; a wiped-out attacker is destroyed), garrison damage or destruction, persisted shield pool. The battle screen applies it to the autosave snapshot; the AI path to the live game state. Fleet-vs-fleet outcomes use `applyFleetBattleOutcome`.

### Auto-resolver (`battle-auto-resolve.ts`)

Same setup and rules as the minigame where they do not depend on the grid: `createBattleState` (stacks, ship and turret stats, shared planetary shield pool), per-stack fire cadence (`1 / fireRate × FIRE_RATE_MULTIPLIER`), target choice by the stack's targeting mode (`compareTargets`, sticky target), shield regeneration every `SHIELD_REGEN_INTERVAL_MS`, `checkVictory`, `buildBattleOutcome`. Volley damage is `applyVolleyDamage`, the exact function the interactive battle applies when a laser bolt hits.

Simplifications (results can differ from a battle the player would fight):

- no grid movement or range — every stack is engaged with every enemy from the start;
- no laser bolts: every volley hits instantly, while in the interactive battle a bolt is aimed once and misses a target that moves out of its path (see [Battle Rules](./battle-rules.md#combat));
- the Carrier Shield Pulse is not used;
- a battle undecided after 300 s of battle time is a **draw**: the defender holds the planet and neither side is wiped out (the minigame has no time limit).

The AI also uses the resolver as a **forecast** before committing an assault (no game state is touched).

### Garrisons

A defender fleet parked in the target system would meet the attackers in a fleet battle first (collision detection), so AI invasions model the planet's own defenses only (`garrison = null`). The interactive player path keeps the battle screen's garrison handling.

## AI assaults

Planned by `EnemyFleetService` (role `assault`, see [AI Pipeline](./ai-pipeline.md#fleet-roles-enemyfleetservice)):

- every 10 s when no assault is active, among hostile planets within `AI_COLONIZATION_REACH` of the faction's territory (or of its fleets, if it owns no planet), scored by population/buildings over distance; a target that repelled an assault is skipped for 300 s;
- the group is the smallest set of free fleets (strongest first, at most 4) whose forecast wins with ≥ 50% strength left; the strongest fleet at home stays as home guard and at most 70% of the faction's managed strength is committed;
- the group gathers in the target system (or launches 30 s after the first arrival); co-located group fleets merge into one attacker fleet (a real merge — same cell, no teleport);
- result: captured → fleets garrison the new system; repelled → survivors are released (regroup rule applies) and the target is remembered as failed; player battle → the group holds until the battle screen result is observed;
- an assault is abandoned if the target stops being hostile, if the group does not arrive within 400 s, or if a stronger hostile fleet appears nearby (retreat).

Assault state is in-memory; a genuine load resets it and assaults are re-planned from the saved situation. A return from the battle screen keeps it: the assault whose player battle was just fought reads the planet's owner (captured, or repelled and remembered as failed for 300 s), and an assault whose battle was queued but not yet fought is launched again. A capture is persisted with the planet, so a reload can neither undo nor repeat it.

## Game outcome (`GameOutcomeService`)

From the human player's perspective; "allied" = the player plus non-AI factions on the player's non-neutral team.

1. **Terminal outcomes are sticky.** A save carrying `victory` or `defeat` is returned unchanged; `StarMap.gameLoopCallback` stops simulating once the outcome is terminal, so no later AI tick can overwrite it.
2. **Defeat (= AI victory):** the allied side owns no planet at all **and** has no fleet with a living ship. A fleet is a recovery route (it can colonize with a colonizer or capture undefended/independent planets), as is any owned planet, even an empty one. Stock ships do not count — without an owned Spaceport they cannot leave the stock. Elimination is evaluated first, so defeat is reachable while hostile planets exist (previously it was not).
3. **Victory:** every inhabited planet (population > 0 or any building) is allied — independent rebel planets still block victory — and no hostile AI faction has a living fleet.
4. Otherwise **in progress**.

Rules 2 and 3 are mutually exclusive. An AI faction without planets but with a fleet is not eliminated (it blocks victory and can recover through assaults).

Outcome checks run on battle return, on load, and in the frame loop whenever `PlanetOwnershipService.revision` changed.

A terminal outcome shows the victory / defeat dialog (`.game-end-overlay` in `star-map.html`) in every orientation. It is a top-level sibling of the portrait "rotate your device" overlay; it was once nested inside that overlay by mistake and so never appeared in landscape.

## Tests

- `planet-ownership.service.spec.ts`, `battle-outcome` behavior through `battle-screen.component.spec.ts`, `battle-auto-resolve.spec.ts` (win, loss, losses on both sides, draw, determinism), `enemy-invasion.service.spec.ts`, `game-outcome.service.spec.ts`, `star-map.spec.ts` (AI planet battle opens the battle screen; in-loop defeat).
- `ai-simulation.spec.ts` Phase 4 scenarios: undefended capture in an unexplored system, defended capture by battle, no assault on an impregnable planet, simultaneous captures by two factions, assault on a player colony through a player battle (harness auto-resolves it as a stand-in for the player choosing AUTO), genuine defeat, recovery after losing every planet, save/load during and after an invasion.

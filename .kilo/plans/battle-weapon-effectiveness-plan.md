# Weapon Effectiveness Plan

## 1. Proposed damage flow

Current: `damage = Math.max(1, totalAttack - front.defense)`

New: `raw = totalAttack - front.defense` then apply a per-volley multiplier based on the attacker's `attackType` vs the **front target ship's** `weakness`, then `damage = Math.max(1, Math.floor(raw * multiplier))`.

The multiplier is looked up once per volley from a small constant table keyed by `(attackerAttackType, frontShipWeakness)`. It is applied to the whole volley before shield/hull absorption, so the existing overkill loop and `kills` counting are unchanged.

## 2. How attackType and weakness are represented/reused

- `ShipType` (`ship.service.ts:14-15`) already carries `attackType` and `weakness` for all 11 real ships.
- `PlanetBattleService.getVirtualShipType` (`planet-battle.service.ts:147-168`) already exposes `attackType`/`weakness` for virtual turrets (laser = energy/kinetic, missile = missile/energy).
- These are NOT currently copied into `BattleShipStats` or `BattleShip`, so the battle sim has no access to them today.

Reuse: add `attackType` and `weakness` to `BattleShipStats` (`battle-ship-stats.ts`) and copy them into `BattleShip` in `toBattleShip()` (`battle-state.ts`), mirroring the existing shield copy path. No new data, no new values.

## 3. Where the modifier should be applied

Single point: `BattleCombatService.attackStack()` at `battle-combat.service.ts:71`, replacing the single `damage` line. A new pure helper `weaponMultiplier(attackerType, targetWeakness)` in `battle-grid.ts` (or a new tiny `battle-combat.ts` helper) keeps the lookup out of the service.

## 4. Recommended simple modifier values

A 3x3 table (kinetic / energy / missile). The row is the attacker's
`attackType`; the column is the front target ship's `weakness`:

| attacker \ target weakness | kinetic | energy | missile |
|---|---|---|---|
| kinetic | 0.5x | 1.5x | 1.0x |
| energy | 1.0x | 0.5x | 1.5x |
| missile | 1.5x | 1.0x | 0.5x |

Each attacker type has one strong matchup (1.5x), one neutral matchup
(1.0x), and one resisted matchup (0.5x). The target's own `weakness` type
is the resisted matchup. Pure and deterministic; no randomness, no per-ship
abilities.

## 5. Required tests

`battle-combat.service.spec.ts`:
- kinetic attacker vs energy-weak defender deals 1.5x raw damage
- energy attacker vs missile-weak defender deals 1.5x raw damage
- kinetic attacker vs missile-weak defender deals 1.0x (neutral)
- kinetic attacker vs kinetic-weak defender deals 0.5x (resistant)
- minimum-damage floor still applies after multiplier
- shield absorption still works with modified damage

`battle-ship-stats.spec.ts` / `battle-state.spec.ts`:
- `attackType`/`weakness` copied into `BattleShip` from ship data

## 6. Balance risks

- Existing combat tests assume specific damage values; they will need updating (same as the shield change).
- 1.5x/0.5x is a wide swing — frigates vs battleships could one-shot stacks that previously survived.
- Virtual turrets already declare weaknesses, so planet battles gain effectiveness for free.
- Mitigation: keep the floor at 1 and consider 1.25x/0.75x first if balance feels tight.
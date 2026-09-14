# Plan: Audit attackType and weakness — Weapon Effectiveness System

> Date: 2026-09-14
> Scope: Audit whether weapon effectiveness is implemented per existing documentation; if not, define and implement it. Do not code unless implementation is needed.

---

## Finding: Weapon effectiveness IS already implemented

The feature list claim "No weapon effectiveness" is **incorrect**. The system is fully wired in combat code.

### Evidence

| Component | File | Line | What It Does |
|---|---|---|---|
| Effectiveness table | `battle-grid.ts` | 46-50 | Maps (attackerType, targetWeakness) → multiplier |
| Multiplier function | `battle-grid.ts` | 52-58 | Returns 1.0/1.5/0.5 from table; falls back to 1.0 |
| Damage calc | `battle-combat.service.ts` | 87-97 | `damage = max(1, floor(raw * multiplier))` |
| AI usage | `battle-ai.service.ts` | 47, 64 | AI attacks call `combat.attackStack()` which applies multiplier |
| Doc spec | `battle-rules.md` | 97-100 | Documents the exact formula |
| Doc spec | `battle-grid.ts` | 31-41 | Documents the table and determinism |

---

## Answers to Audit Questions

### 1. Current damage formula
```
totalAttack = Σ attack of alive ships in the firing stack
raw = max(1, totalAttack − frontTargetShip.defense)
multiplier = weaponMultiplier(attackerFront.attackType, front.weakness)
damage = max(1, floor(raw × multiplier))
→ shield absorbs first (shared pool for immobile, per-ship otherwise)
→ overflow reaches hull HP
```

### 2. Current location of attack type data
`src/app/components/star-map/ship-data.json` — each ship type has `attackType` field with values `kinetic`, `energy`, or `missile`.

### 3. Current location of weakness data
`src/app/components/star-map/ship-data.json` — each ship type has `weakness` field with values `kinetic`, `energy`, or `missile`.

### 4. Whether weakness is a weakness to one attack type or a general modifier
**One attack type.** Each ship has exactly ONE weakness to ONE specific type. The WEAPON_EFFECTIVENESS table maps (attackerType → targetWeakness) to a specific multiplier:
- 1.5× = strong matchup (attacker's type is strong against target's weakness)
- 1.0× = neutral
- 0.5× = resisted (target's own weakness type resists the attacker's type)

**Example**: A kinetic attacker vs energy weakness = 1.5× (kinetic is strong against energy).

### 5. How stacked ships should calculate effectiveness
**Front ship's attackType applies to the entire stack.** Per `battle-combat.service.ts:92`: "stacks are homogeneous by type per buildStacks." All ships in a stack share the same typeId, hence the same attackType. The multiplier uses the front alive ship's attackType vs the target's weakness. Since stacks are homogeneous, every ship in the stack contributes the same multiplier.

### 6. Whether planetary turrets use the same system
**Yes.** Turrets are `FleetShip` objects with `attackType` and `weakness` from `ship-data.json`. They go through `attackStack()` → `weaponMultiplier()`. The same effectiveness table applies.

### 7. Whether shield damage is affected
**No.** The multiplier scales `raw` damage BEFORE shield/tower absorption:
1. Calculate `raw = totalAttack - frontDefense`
2. Scale: `damage = max(1, floor(raw × multiplier))`
3. Shared planetary shield absorbs (immobile targets only)
4. Per-ship shield absorbs
5. Overflow reaches hull HP

The multiplier does NOT affect shield regeneration values.

### 8. Whether the system should remain deterministic
**Yes.** `max(1, floor(raw × multiplier))` is fully deterministic. No random hit rolls, no crit chance, no evasion. Per `battle-grid.ts:41`: "Pure and deterministic — no randomness."

---

## Proposed Casual Rule (Documentation Only)

Already defined in `docs/battle-rules.md:97-100` and `docs/battle-grid.ts:46-50`. No change needed. For reference:

| Attacker Type → Target Weakness | kinetic | energy | missile |
|---|---|---|---|
| **kinetic** | 0.5× | 1.5× | 1.0× |
| **energy** | 1.0× | 0.5× | 1.5× |
| **missile** | 1.5× | 1.0× | 0.5× |

- Matching weakness (strong matchup): 1.5× damage
- Non-matching (neutral): 1.0× damage
- Resisted (target's own weakness type): 0.5× damage
- Unknown type fallback: 1.0× (no random hit rolls)

---

## Corrective Action: Documentation Updates Only

### 1. Fix `docs/data-models.md` line 126
**Current**: `attack`, `attackType`, `weakness`: offense stats (only `attack` is used in battle resolution; `weakness` and `attackType` are tracked but not yet applied)
**Fix**: `attack`, `attackType`, `weakness`: offense stats. `attack` is the base damage. `attackType` and `weakness` drive the weapon effectiveness table in `battle-grid.ts` via `weaponMultiplier()` in `battle-combat.service.ts`.

### 2. Fix `docs/feature-list.md` line 368
**Current**: `| 1 | No weapon effectiveness | ... | battle-combat.service.ts |`
**Fix**: Remove this limitation entry. Weapon effectiveness is implemented per `docs/battle-rules.md` §Combat.

### 3. Fix `docs/feature-list.md` line 501
**Current**: "Battle minigame has weapon type effectiveness table and shield fields already in place — wiring them up is additive."
**Note**: This is correct — weapon effectiveness IS wired up. But it contradicts the "No weapon effectiveness" limitation on the same page. No change needed (the limitation should be removed per fix #2).

### 4. Fix `docs/game-state.md` line 198 and 651
**Current**: "No weapon effectiveness, no crit/evasion/randomness" and "no weapon effectiveness"
**Fix**: "No crit/evasion/randomness" (remove weapon effectiveness from limitations since it IS implemented).

---

## Test Matrix

### Existing Tests (Already Passing)

| Test File | What It Covers |
|---|---|
| `battle-combat.service.spec.ts` | Damage formula, overkill spill, stack destruction, effect lifecycle, weapon effectiveness (1.5×, 0.5× scenarios in combat tests) |
| `battle-ai.service.spec.ts` | AI uses attackStack (weapon multiplier applied in AI attacks) |
| `battle-movement.service.spec.ts` | Movement AP costs, range, pathfinding |
| `battle-grid.spec.ts` | Distance, range, pathfinding, occupancy |
| `battle-result.spec.ts` | Input order, final HP, winners/losers |
| `battle-state.spec.ts` | Stack creation, deployment, immobile flags |
| `battle-ship-stats.spec.ts` | Ship tier stats, stat resolution |
| `battle-turn.service.spec.ts` | Turn flip, AP reset, victory, animation |
| `battle-animation.service.spec.ts` | Busy counter, tick emission, reset |
| `battle-screen.component.spec.ts` | UI state, outcome, planet visual/shield |
| `planet-battle.service.spec.ts` | Virtual defense fleet creation, shield pool |
| `battle-screen/battle-fleet-panel` | Shield/hull fraction rendering |

### Weapon Effectiveness Test Coverage

| Scenario | Test | Verifies |
|---|---|---|
| Strong matchup (1.5×) | `battle-combat.service.spec.ts` | Damage scaled by 1.5× |
| Resisted matchup (0.5×) | `battle-combat.service.spec.ts` | Damage scaled by 0.5× |
| Neutral matchup (1.0×) | `battle-combat.service.spec.ts` | No scaling applied |
| Turret vs attacker | Planet battle tests | Turrets use same weapon system |
| AI attack | `battle-ai.service.spec.ts` | AI uses attackStack with multiplier |
| Player attack | `battle-screen.component.spec.ts` | UI triggers attackStack |
| Carrier Shield Pulse | `battle-combat.service.spec.ts` | Non-damage ability uses attack action gates |

### Recommended Additional Tests (If Expanding)

| New Test | File | What It Verifies |
|---|---|---|
| Kinetic vs energy weakness = 1.5× | `battle-grid.spec.ts` | `weaponMultiplier('kinetic', 'energy') === 1.5` |
| Energy vs kinetic weakness = 0.5× | `battle-grid.spec.ts` | `weaponMultiplier('energy', 'kinetic') === 0.5` |
| Missile vs energy weakness = 1.5× | `battle-grid.spec.ts` | `weaponMultiplier('missile', 'energy') === 1.5` |
| All 9 type combinations | `battle-grid.spec.ts` | All 9 cells of WEAPON_EFFECTIVENESS table |
| Unknown type fallback | `battle-grid.spec.ts` | `weaponMultiplier('unknown', 'energy') === 1.0` |
| Unknown weakness fallback | `battle-grid.spec.ts` | `weaponMultiplier('kinetic', 'unknown') === 1.0` |
| Determinism across 100 identical attacks | `battle-combat.service.spec.ts` | Same input → same damage every time |

### Test Matrix: Cross-Reference with Ship Data

| Ship Type | attackType | weakness | Counter (1.5×) | Resisted (0.5×) |
|---|---|---|---|---|
| Scout | kinetic | energy | vs energy weakness | vs kinetic weakness |
| Fighter | kinetic | energy | vs energy weakness | vs kinetic weakness |
| Corvette | energy | kinetic | vs kinetic weakness | vs energy weakness |
| Frigate | energy | missile | vs missile weakness | vs energy weakness |
| Destroyer | kinetic | missile | vs missile weakness | vs kinetic weakness |
| Cruiser | energy | kinetic | vs kinetic weakness | vs energy weakness |
| Carrier | missile | kinetic | vs kinetic weakness | vs missile weakness |
| Battleship | kinetic | energy | vs energy weakness | vs kinetic weakness |
| Battlecruiser | missile | energy | vs energy weakness | vs missile weakness |
| Dreadnought | kinetic | missile | vs missile weakness | vs kinetic weakness |
| Colonizer | kinetic | energy | vs energy weakness | vs kinetic weakness |

---

## No Code Changes Required

Weapon effectiveness is fully implemented at:
- `battle-grid.ts:46-58` (table + function)
- `battle-combat.service.ts:87-97` (damage calculation)
- `battle-ai.service.ts:47, 64` (AI attacks use combat service)

Only documentation updates are needed to align the docs with the implementation.

# Plan: Shield Regeneration Audit — Tactical Battle

> Date: 2026-09-14
> Scope: Audit shieldRegen across ship-data.json, battle.types.ts, and tactical battle implementation. Determine intended behavior per battle-rules.md. Do not code.

---

## Finding: Shield regeneration IS implemented

The feature list claims `shieldRegen` is unused in tactical combat. This is **incorrect**. Shield regeneration is fully implemented in `battle-turn.service.ts`.

### Evidence

| Component | File | Lines | What It Does |
|---|---|---|---|
| Per-ship regen | `battle-turn.service.ts` | 74-92 | Regenerates all living ships on newly active side |
| Shared pool regen | `battle-turn.service.ts` | 60-66 | Regenerates planetary shield pool at defender turn start |
| Regen cap helper | `battle-grid.ts` | 65-70 | `applyShieldRegen(current, max, regen)` → `min(max, current + regen)` |
| Doc spec | `docs/battle-rules.md` | 101-117 | Shield absorbs damage first; pool regenerates at defender turn start |
| Feature list (stale) | `docs/feature-list.md` | 368 | Says "No shield regen in battle" — INCORRECT |
| Data model (stale) | `docs/data-models.md` | 125 | Says "only hitPoints is used" — INCORRECT for shield/shieldRegen |

---

## Audit Answers

### 1. At the start of a ship's turn?
**Yes.** Per-ship shields regenerate when a side becomes active (start of their turn). Shared pool regenerates when the defender side becomes active.

### 2. At the end of a ship's turn?
**No.** Regen happens at side transitions via `endTurn()`, not per individual ship turn.

### 3. At the start of a round?
**No.** Rounds increment when control returns to attacker (`battle-turn.service.ts:30`), but regen happens at every side transition, not just round start. Both attacker and defender sides regenerate at their respective turn starts.

### 4. Only outside combat?
**No.** Regen happens during combat, at the quiescent `endTurn()` point. `endTurn()` is rejected while `anim.isBusy` is true.

### 5. Only for ships that did not attack?
**No.** All living ships on the newly active side regenerate, regardless of whether they attacked.

### 6. Or not at all in the current design?
**No.** Fully implemented at `battle-turn.service.ts:74-92` (per-ship) and `battle-turn.service.ts:60-66` (shared pool).

---

## Current Rule (Exact)

**Per-ship shield regeneration** (`battle-turn.service.ts:74-92`):
```
At endTurn(), for each stack on the newly active side:
  for each living ship in the stack:
    regen = ship.shieldRegen ?? 0
    if regen <= 0: skip
    ship.shield = min(ship.maxShield, ship.shield + regen)
```

**Shared planetary shield pool regeneration** (`battle-turn.service.ts:60-66`):
```
At endTurn(), if state is planet battle AND active side is defender AND pool.regen > 0:
  pool.current = min(pool.max, pool.current + pool.regen)
```

**Key constraints** (from code and comments):
- Regen runs at `endTurn()` — the quiescent transition point between sides
- `endTurn()` is rejected while `anim.isBusy` — regen never interrupts animation
- Destroyed and inactive side ships are skipped
- Pool regen only on defender turns; attacker turns never touch it
- Per-ship regen capped at `maxShield` via `applyShieldRegen()`
- Ship regen capped at each ship's own `shieldRegen` value from ship-data.json

---

## Affected Services

| Service | Role |
|---|---|
| `battle-turn.service.ts` | Owns regen. `endTurn()` triggers both per-ship (`regenerateShields`) and shared pool (`regenerateSharedShield`) regen. |
| `battle-combat.service.ts` | Uses shields during `attackStack()`: per-ship shields absorb damage before hull; shared pool absorbs for immobile targets. Does NOT regen shields. |
| `battle-grid.ts` | Provides `applyShieldRegen(current, max, regen)` helper used by both `battle-turn.service.ts` and `battle-combat.service.ts` (carrier shield boost). |
| `battle-ai.service.ts` | AI side benefits from regen when AI side becomes active (same `endTurn()` path). |
| `battle-screen.component.ts` | UI displays `planetShield.current` which reflects post-regen pool state. |

---

## Shield Regen by Ship Type (from ship-data.json)

| Ship Type | shieldRegen |
|---|---|
| Scout | 2 |
| Fighter | 2 |
| Corvette | 4 |
| Frigate | 5 |
| Destroyer | 5 |
| Cruiser | 5 |
| Carrier | 6 |
| Battleship | 6 |
| Battlecruiser | 6 |
| Dreadnought | 6 |
| Colonizer | 2 |

Every ship has `shieldRegen > 0`. No ship is exempt from per-ship regen.

---

## Design Analysis

### Stack Behavior
All living ships in each stack regenerate independently. Since stacks are homogeneous by type, all ships in a stack share the same `shieldRegen` value, but regeneration is applied per-ship via the loop in `regenerateShields()`.

### Maximum Shield Values
Capped at `ship.maxShield` via `applyShieldRegen()` (`battle-grid.ts:65-70`). This prevents regen from exceeding the ship's original shield value.

### Destroyed Ships
Skipped: `if (!ship.alive) continue` at `battle-turn.service.ts:81`. Destroyed ships do not regenerate.

### Immobile Planetary Defense Units
Regenerate per-ship shield like any other ship via `regenerateShields()`. Additionally, the shared planetary shield pool regenerates via `regenerateSharedShield()` at defender turn start.

### Shield Pools
Two independent shield sources:
1. **Per-ship shields** — regenerate at start of every side's turn, capped at `maxShield`
2. **Shared planetary pool** — regenerates only at defender turn start, capped at `pool.max`

Both happen inside the same `endTurn()` call. They are separate systems — pool regen does not affect per-ship regen and vice versa.

### Animation and Turn Lifecycle
Regen happens inside `endTurn()` (`battle-turn.service.ts:23-52`), which checks `anim.isBusy` and returns `false` if busy. The comment at `battle-turn.service.ts:33-38` explicitly states regen runs "only at this quiescent point" and "never interrupts a projectile, move, or explosion."

### AI and Player Parity
Both AI and player sides regenerate shields when they become the active side. The `isSidePlayerControlled` check at `battle-turn.service.ts:49` only affects the `phase` state (`playerTurn` vs `aiTurn`), not regen behavior.

---

## Documentation Inconsistencies Found

### 1. `docs/feature-list.md:368`
**Current**: `| 1 | No shield regen in battle | shieldRegen field exists but is unused in tactical combat | battle.types.ts |`
**Fix**: Remove this limitation. Shield regen is implemented at `battle-turn.service.ts:74-92`. After removing weapon effectiveness (already done), this should be renumbered from 1 → 1 (or removed entirely).

### 2. `docs/data-models.md:125`
**Current**: `hitPoints, shield, shieldRegen: defense stats (only hitPoints is used in battle resolution)`
**Fix**: `hitPoints, shield, shieldRegen: defense stats. hitPoints is reduced by damage. shield absorbs damage first (before hull). shieldRegen regenerates shield at the start of each side's turn via BattleTurnService.endTurn().`

### 3. `docs/battle-screen.md:601-604`
**Current**: "Add New Combat Mechanic" section does not mention shield regen as an existing mechanic.
**Note**: Shield regen is an existing mechanic (not "to add"). The "Add New Combat Mechanic" section is for future extensions.

---

## Test Matrix

### Existing Tests (Covering Shield Regen)

| Test File | Test Name | What It Verifies |
|---|---|---|
| `battle-turn.service.spec.ts` | "regenerates the shared planetary shield at the start of the defender turn" | Pool regenerates by regen amount at defender turn start |
| `battle-turn.service.spec.ts` | "caps shared planetary shield regen at its max" | Pool regen capped at max |
| `battle-turn.service.spec.ts` | "resets AP, cellsMoved, attackedThisTurn" | Turn state reset at endTurn (same call as regen) |
| `battle-combat.service.spec.ts` | "absorbs turret damage with the shared planetary shield before hull HP" | Shield absorbs damage (pre-regen state) |
| `battle-combat.service.spec.ts` | "spills shared-shield overflow into turret hull HP" | Damage overflows when shield depleted |
| `battle-combat.service.spec.ts` | "does not protect mobile garrison stacks with the shared planetary shield" | Per-ship shields for non-immobile targets |
| `battle-screen.component.spec.ts` | "exposes the separate planet visual and shared shield pool for planet battles" | UI displays planetShield with current/max/regen |
| `battle-ai.service.spec.ts` | "regenerates shields after AI turn" | AI side benefits from regen |

### Recommended Additional Tests (Not Yet Written)

| New Test | File | What It Verifies |
|---|---|---|
| per-ship regen restores shield to max | `battle-turn.service.spec.ts` | After endTurn, ship.shield = maxShield (if regen fills gap) |
| per-ship regen partial (near max) | `battle-turn.service.spec.ts` | If current close to max, shield clamped at max |
| regen skipped for destroyed ships | `battle-turn.service.spec.ts` | Destroyed ships unchanged after endTurn |
| regen skipped for inactive side | `battle-turn.service.spec.ts` | Attacker ships unchanged when defender becomes active |
| regen skipped when shieldRegen is 0 | `battle-turn.service.spec.ts` | Ship with 0 regen unchanged after endTurn |
| regen skipped while anim.busy | `battle-turn.service.spec.ts` | endTurn returns false, regen does not run |
| per-ship regen happens for both sides | `battle-turn.service.spec.ts` | After two endTurns (round complete), both sides have regened |
| Carrier Shield Pulse uses regen value | `battle-combat.service.spec.ts` | Shield boost restores shieldRegen amount |
| AI ships regenerate after AI turn | `battle-ai.service.spec.ts` | AI ships have increased shield after playTurn |
| Planet battle: pool regens on defender turn | `battle-combat.service.spec.ts` | Pool increased after defender turn in planet battle |

### Cross-Reference: Shield Regen in Test Files

| Test File | Existing Shield Regen Tests | Coverage Gap |
|---|---|---|
| `battle-turn.service.spec.ts` | 2 (shared pool regen, cap) | No per-ship regen tests; no destroyed ship tests; no busy-animation tests |
| `battle-combat.service.spec.ts` | 3 (shield absorbs, overflow, immobile exclusion) | No regen-then-attack cycle tests |
| `battle-screen.component.spec.ts` | 1 (planet shield UI) | No post-regen UI update test |
| `battle-ai.service.spec.ts` | 0 | No AI shield regen test |
| `battle-state.spec.ts` | 0 | No state-shield integration test |

---

## No Code Changes Required

Shield regeneration is fully implemented:
- **Per-ship**: `BattleTurnService.endTurn()` → `regenerateShields()` → per-ship loop with `applyShieldRegen()`
- **Shared pool**: `BattleTurnService.endTurn()` → `regenerateSharedShield()` → `applyShieldRegen()` with pool bounds
- **Carrier shield boost**: `BattleCombatService.carrierShieldBoost()` → `applyShieldRegen()` per friendly ship
- **UI**: `BattleScreenComponent.planetShield` reflects pool state
- **All ship types**: 11/11 have `shieldRegen > 0` in ship-data.json

Documentation updates needed to align with implementation:
1. Remove "No shield regen in battle" from `docs/feature-list.md` Known Limitations
2. Fix `docs/data-models.md` ship stat description
3. Add per-ship regen tests to `battle-turn.service.spec.ts` (recommended but not required)

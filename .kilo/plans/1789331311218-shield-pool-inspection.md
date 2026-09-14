# Plan: Planetary Shield Pool — Inspection & Documentation Gap

> Date: 2026-09-13
> Scope: Verify shield pool consumption, identify documentation/code drift, propose corrective plan
> Do not code.

---

## Finding 1: Code DOES consume the shield pool (contradicts feature list)

The feature list (`docs/feature-list.md` line 371 and line 494) claims the battle minigame does **not** consume the planetary shield pool. This is **incorrect** — the code does consume it.

### Evidence

- `src/app/components/battle-screen/battle/battle-combat.service.ts:105-109` — shield pool absorbs damage before per-ship shields for immobile target stacks.
- `src/app/components/battle-screen/battle/battle-turn.service.ts:60-66` — pool regenerates at start of each defender turn.
- `src/app/components/battle-screen/battle/battle-state.ts:78-81` — pool initialized from transport for planet battles.
- `src/app/components/battle-screen/battle/battle-combat.service.spec.ts:642-674` — tests verify pool absorbs damage and spills overflow into hull.
- `src/app/components/battle-screen/battle/battle-turn.service.spec.ts:224-232` — test verifies pool regenerates at defender turn start.
- `src/app/services/planet-battle.service.spec.ts:66-93` — tests verify shield buildings contribute to pool (300, 15 and 600, 30).

### Root cause of discrepancy

`docs/battle-screen.md` line 602-603 says:
> "Shields/weapon types: loaded from data but **not applied (per design)**"

This is stale documentation. The code applies both shields and weapon effectiveness, but these docs were written before implementation.

`docs/battle-screen.md` line 614 says "Add shield/regen handling" — this is in an "Extending the System" section using shield as an example of how to add a new mechanic, not a statement that it's unimplemented.

---

## Finding 2: Shield system is fully implemented per `docs/battle-rules.md`

`docs/battle-rules.md` lines 105-116 is the authoritative specification. It defines all 10 questions the user asked:

| Question | Answer | Location |
|---|---|---|
| Where pool is created | `PlanetBattleService.createVirtualDefenseFleet()` sums `shield`/`shieldRegen` from building defs where `type === 'shield'` | `src/app/services/planet-battle.service.ts:64-119` |
| How passed into BattleService | VirtualDefenseFleet (Fleet + shieldPool/shieldPoolRegen) passed as `fleet2` in `BattleService.setPlanetBattle()` | `src/app/components/star-map/star-map-planet-arrival.service.ts:154` |
| How represented in BattleOutcome | **Not represented** — BattleFleetOutcome and BattleOutcome have no shield fields. By design, pool is battle-local. | `src/app/components/battle-screen/battle/battle.types.ts:203-221` |
| When absorbs damage | Before per-ship shields, on every attack targeting an immobile stack | `src/app/components/battle-screen/battle/battle-combat.service.ts:105-109` |
| Protects all or only planet | Only **immobile turret stacks**; garrison ships use their own per-ship shields | `docs/battle-rules.md:113-114`, code: `target.immobile` check |
| Depleted permanently? | Yes — `current` decreases on each absorption, recovers only via regen | `battle-combat.service.ts:106-108` |
| Attacker wins | Pool depleted as appropriate; planet captured (`applyPlanetBattleResult`); pool discarded (battle-local) | `src/app/components/battle-screen/battle-screen.component.ts:712` |
| Defender wins | Pool retains remaining `current`; still discarded after battle | Same flow |
| How remaining persists | **Not persisted** — recalculated fresh from planet buildings each battle | `battle.types.ts:139-140` comment |
| How regenerates between battles | **During battle**: regen at defender turn start, capped at max. **Between battles**: fresh calculation via `createVirtualDefenseFleet()` | `battle-turn.service.ts:60-66`, planet-battle.service.ts:70-81 |

---

## Finding 3: Data structures

### Input transport (`BattleFleet`, `docs/battle-rules.md` transport contract)
```typescript
// battle.types.ts:234-246
interface BattleFleet {
  id: number;
  name: string;
  factionId: string;
  ships: FleetShip[];
  shieldPool?: number;       // planet-battle only
  shieldPoolRegen?: number;  // planet-battle only
}
```

### Internal battle state
```typescript
// battle.types.ts:142-146
interface BattleShieldPool {
  current: number;
  max: number;
  regen: number;
}
// Stored as state.defenderShieldPool: BattleShieldPool | null
// in BattleModelState (battle.types.ts:155+)
```

### Output (`BattleFleetOutcome`, `BattleOutcome`)
No shield fields — confirmed by `battle.types.ts:203-221`.

### Creation logic
```typescript
// planet-battle.service.ts:79-82
if (def.type === 'shield') {
  totalShield += def.shield ?? 0;        // shield value from planet-data.json
  totalShieldRegen += def.shieldRegen ?? 0; // shieldRegen from planet-data.json
  continue;  // shield buildings do NOT become virtual ships
}
```

---

## Finding 4: Tests

### Currently passing tests (verify shield pool consumption)
| Test File | Test | What It Verifies |
|---|---|---|
| `planet-battle.service.spec.ts` | "turns planetary shields into a shared pool instead of ships" | `shieldPool: 300`, `shieldPoolRegen: 15` |
| `planet-battle.service.spec.ts` | "sums multiple shield buildings and keeps garrison ships out of the pool" | `shieldPool: 600`, `shieldPoolRegen: 30` |
| `battle-state.spec.ts` | "syncs the shared planetary shield pool from the transport into battle state" | `defenderShieldPool = {current: 300, max: 300, regen: 15}` |
| `battle-state.spec.ts` | "keeps fleet battles free of a shared shield pool" | `defenderShieldPool === null` |
| `battle-combat.service.spec.ts` | "absorbs turret damage with the shared planetary shield before hull HP" | Pool decreases by damage amount |
| `battle-combat.service.spec.ts` | "spills shared-shield overflow into turret hull HP" | Pool depleted first, then overflow to hull |
| `battle-turn.service.spec.ts` | "regenerates the shared planetary shield at the start of the defender turn" | Pool regenerates by regen amount |
| `battle-turn.service.spec.ts` | "caps shared planetary shield regen at its max" | Pool capped at max |
| `battle-screen.component.spec.ts` | "exposes the separate planet visual and shared shield pool for planet battles" | `planetShield = {current, max, regen}` |

---

## Recommended Corrective Actions (Documentation Only)

### 1. Update `docs/feature-list.md` line 371
**Current**: `Planetary shield pool not applied — Planetary Shield buildings contribute to shieldPool on virtual defense fleets, but the battle minigame does not consume it`
**Fix**: Remove or correct this known limitation — the pool IS consumed in `battle-combat.service.ts:105-109`.

### 2. Update `docs/feature-list.md` line 494
**Current**: `Shields not integrated into tactical combat — Planetary Shield buildings set up a shield pool that is never consumed by the battle minigame`
**Fix**: Remove or correct — shield pool is consumed per `docs/battle-rules.md` §Planet Battles.

### 3. Update `docs/battle-screen.md` line 602-603
**Current**: `Shields/weapon types: loaded from data but not applied (per design)`
**Fix**: `Shields/weapon types: loaded from data and applied in battle-combat.service.ts. See [Battle Rules](./battle-rules.md) §Combat and §Planet Battles.`

### 4. Update `docs/feature-list.md` Next Priority Areas
**Current**: `| Shield integration | 🛑 | Wire shield pool into battle combat resolution |`
**Fix**: Change to ✅ or remove — shield integration is complete per `docs/battle-rules.md`.

### 5. Ensure `docs/battle-rules.md` remains authoritative
No changes needed — it accurately documents the shield system at lines 105-116.

---

## No Code Changes Required

The shield pool is fully implemented:
- Created in `PlanetBattleService.createVirtualDefenseFleet()`
- Passed via `BattleService.setPlanetBattle()`
- Absorbed in `BattleCombatService.attackStack()` for immobile stacks only
- Regenerated in `BattleTurnService.regenerateSharedShield()` at defender turn start
- Not persisted (by design — recalculated fresh each battle)

The only remaining work is correcting the documentation to match the implementation.

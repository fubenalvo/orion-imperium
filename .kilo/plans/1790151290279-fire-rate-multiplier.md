# FIRE_RATE_MULTIPLIER — Global Battle Pace Multiplier

## Context

Add a background config constant that scales all battle attack timing globally. No UI, no buttons — purely a constant value. Current target: 0.5 (all stacks fire at 2x speed vs. default).

**Decision from user:** Option C — infrastructure + tuning now. Value = 0.5.

## Cooldown Mechanics (current state)

Two separate cooldown systems exist:

| System | Location | Formula | Default value |
|--------|----------|---------|---------------|
| Player auto-attack cooldown | `battle-screen.component.ts:895` | `fireRateMs = (1 / fireRate) * 1000` | 666.67ms (fireRate=1.5) |
| AI action cooldown | `battle-ai.service.ts:140` | `actionCooldownMs = AI_ACTION_COOLDOWN_MS` | 1000ms |

`attackCooldownUntil` (player) and `actionCooldownUntil` (AI) are separate fields on `BattleStack` (`battle.types.ts:164`, `:170`).

## Formula with multiplier

- Player: `fireRateMs = (1 / fireRate) * 1000 * FIRE_RATE_MULTIPLIER`
- AI: `cooldownMs = AI_ACTION_COOLDOWN_MS * FIRE_RATE_MULTIPLIER`

With `FIRE_RATE_MULTIPLIER = 0.5`:
- Player: 333ms (was 667ms) → 2x faster ✓
- AI: 500ms (was 1000ms) → 2x faster ✓

`hullBonus` in player cooldown (`battle-screen.component.ts:896`) is HP-based, not fire-rate based — do NOT multiply.

## Files to change

### 1. `src/app/components/battle-screen/battle/battle.types.ts`

Add after `AI_ACTION_COOLDOWN_MS` (line 35):

```ts
/* Global fire-rate / action cooldown multiplier. Scales all attack
 * timing in the battle minigame. <1 = faster, >1 = slower.
 * No UI — purely a background tuning constant. */
export const FIRE_RATE_MULTIPLIER = 0.5;
```

### 2. `src/app/components/battle-screen/battle-screen.component.ts`

Line 895 — change cooldown calculation:

```ts
// Before:
const fireRateMs = (1 / fireRate) * 1000;

// After:
const fireRateMs = (1 / fireRate) * 1000 * FIRE_RATE_MULTIPLIER;
```

Update console log on line 898 to mention the multiplier.

Import `FIRE_RATE_MULTIPLIER` from `./battle.types`.

### 3. `src/app/components/battle-screen/battle/battle-ai.service.ts`

Line 140 — change cooldown calculation:

```ts
// Before:
stack.actionCooldownUntil = this.time.battleElapsedMs + AI_ACTION_COOLDOWN_MS;

// After:
stack.actionCooldownUntil = this.time.battleElapsedMs + AI_ACTION_COOLDOWN_MS * FIRE_RATE_MULTIPLIER;
```

Import `FIRE_RATE_MULTIPLIER` from `./battle.types`.

## Verification

- Run existing tests: `ng test --include='**/battle**'`
- Verify no TypeScript errors after changes
- With multiplier = 0.5, player auto-attacks and AI actions should both resolve ~2x faster than default
- Changing multiplier to 1.0 should restore original timing exactly

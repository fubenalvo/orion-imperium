# Attack Not Firing / Repeated Attacks - Investigation Plan

## Problem Summary

1. **Some ships visually appear in range but don't fire**
2. **Same attack pairs repeat every AI tick** (e.g., `scout:1 -> frigate:0`, `frigate:0 -> dest`)

## Systems to Investigate

### 1. AI Action Cooldown (battle-ai.service.ts)
- `AI_ACTION_COOLDOWN_MS = 1500ms`
- `AI_ACTION_INTERVAL_MS = 800ms`
- Set in `applyActionCooldown()` after successful attack
- Checked in `onActionCooldown()` before each action

### 2. Player Auto-Attack (battle-screen.component.ts)
- Runs every frame
- Fire rate cooldown: `1/fireRate * 1000 + hullBonus`
- Animation lock: `anim.isStackBusy()`
- Per-frame target dedup: `attackedTargetsThisFrame`

### 3. Animation Lock (battle-animation.service.ts)
- Per-stack: `isStackBusy(stackId)`
- Global: `isBusy`
- Attack animation: ~520ms (projectile 320 + hit 200)

### 4. Battle Time (battle-time.service.ts)
- `battleElapsedMs` advances in `onTick()` with scaled delta
- Used by both AI and player cooldowns

## Diagnostic Logging to Add

### A. AI Cooldown State (battle-ai.service.ts)
In `playAction`, log cooldown state for each stack checked:
```typescript
console.log(`[AI-COOLDOWN] ${stack.stackId}: cooldownUntil=${stack.actionCooldownUntil}, now=${this.time.battleElapsedMs}, active=${stack.actionCooldownUntil > this.time.battleElapsedMs}, busy=${this.anim.isStackBusy(stack.stackId)}`);
```

### B. Attack Result & Cooldown Set (battle-ai.service.ts)
After attack:
```typescript
console.log(`[AI-ATTACK-RESULT] ${stack.stackId} -> ${target.stackId}: result=${result}, cooldownSet=${result}`);
```

### C. Player Auto-Attack Skip Reasons (battle-screen.component.ts)
In `tryAutoAttack`, log why attack skipped:
```typescript
console.log(`[PLAYER-AUTO-SKIP] ${attacker.stackId}: moving=${attacker.moving}, fireRateCD=${attacker.attackCooldownUntil > now}, animBusy=${this.anim.isStackBusy(attacker.stackId)}, explicitTarget=${attacker.explicitAttackTargetId}, targetsThisFrame=${attackedTargetsThisFrame?.size}`);
```

### D. Battle Time Advancement (battle-time.service.ts)
In `onTick`, periodically log:
```typescript
if (this._battleElapsedTime % 1 < 0.02) { // ~every second
  console.log(`[TIME] battleElapsedMs=${this.battleElapsedMs.toFixed(0)}`);
}
```

## Key Questions to Answer

1. **Is AI cooldown actually preventing re-attacks?**
   - Check if `actionCooldownUntil` is set and respected
   - Verify `battleElapsedMs` advances correctly

2. **Are repeated attacks from same stack or different stacks?**
   - Log stack ID each time

3. **Why don't some ships fire when visually in range?**
   - Fire rate cooldown not expired?
   - Animation lock held?
   - Explicit target invalid?
   - `attackedTargetsThisFrame` blocking?

4. **Is `attackedTargetsThisFrame` causing issues?**
   - It's per-frame, but player auto-attack runs every frame
   - Could cause ships to wait a frame even if fire rate allows

## Implementation Steps

1. Add diagnostic logs to the four locations above
2. Run battle, observe console
3. Identify root cause
4. Propose minimal fix

## Files to Modify (Temporary Logs)

1. `src/app/components/battle-screen/battle/battle-ai.service.ts` - AI cooldown & attack result
2. `src/app/components/battle-screen/battle-screen.component.ts` - Player auto-attack skip reasons
3. `src/app/components/battle-screen/battle/battle-time.service.ts` - Time advancement
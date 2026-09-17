# Plan: Allow Player Commands at Any Time During Battle

## Context

Players report that once a stack starts an action (movement or attack), they cannot issue further commands. The `anim.isBusy` lock gates all player input via `canAct`, and `attackStack`/`carrierShieldBoost` also reject calls when busy. In a real-time battle where multiple things happen simultaneously, the player should be able to select stacks and issue commands at any time — even during movement or attack animations.

## Root Cause

Three places gate player input on `anim.isBusy`:

1. **`canAct` getter** (`battle-screen.component.ts:190-192`): `playerHasStacks && !anim?.isBusy` — blocks ALL player input when any animation is in flight
2. **`attackStack`** (`battle-combat.service.ts:53`): `state.winner || this.anim.isBusy` — blocks new attacks during animations
3. **`carrierShieldBoost`** (`battle-combat.service.ts:169`): `state.winner || this.anim.isBusy` — blocks Shield Pulse during animations

These were designed for a turn-based model but are wrong for real-time combat where multiple actions happen concurrently.

## Design Decisions

### D1: Remove `anim.isBusy` from player-facing gates
**Recommendation**: Remove `!anim?.isBusy` from `canAct`, remove `this.anim.isBusy` from `attackStack` and `carrierShieldBoost`.
**Rationale**: Multiple stacks can act simultaneously in real-time. The animation service's `activeCount` already tracks concurrent animations for visual purposes — it shouldn't gate input.

### D2: Keep `anim.isBusy` gating for AI actions
**Recommendation**: Keep `!this.anim.isBusy` check in `gameLoopCallback` AI tick (line 527).
**Rationale**: Prevents AI from acting during player's active animations to avoid visual clutter and conflicting actions on the same targets. This is a separate concern from player input freedom.

### D3: Keep `stack.moving` / `attacker.moving` checks in combat/movement
**Recommendation**: Keep `attacker.moving` check in `attackStack` (line 59) and `canPlayerAct`'s `!stack.moving` check (line 199).
**Rationale**: These are legitimate gameplay constraints — a stack mid-movement can't fire (it's repositioning). This is different from the animation lock which prevents ALL input.

### D4: `attackStack` no longer has a global busy lock; concurrent volleys are possible
**Recommendation**: Accept concurrent attacks. Each attack runs its own `anim.run()` independently; `activeCount` tracks total active animations.
**Rationale**: In real-time battle, multiple stacks firing simultaneously is expected behavior.

## Changes

### Change 1: Remove `anim.isBusy` from `canAct`
**File**: `src/app/components/battle-screen/battle-screen.component.ts:190-192`
```typescript
// BEFORE
get canAct(): boolean {
  return this.playerHasStacks && !this.anim?.isBusy;
}
// AFTER
get canAct(): boolean {
  return this.playerHasStacks;
}
```

### Change 2: Remove `this.anim.isBusy` from `attackStack`
**File**: `src/app/components/battle-screen/battle/battle-combat.service.ts:53`
```typescript
// BEFORE
if (!attacker || !target || state.winner || this.anim.isBusy) {
// AFTER
if (!attacker || !target || state.winner) {
```

### Change 3: Remove `this.anim.isBusy` from `carrierShieldBoost`
**File**: `src/app/components/battle-screen/battle/battle-combat.service.ts:169`
```typescript
// BEFORE
if (state.winner || this.anim.isBusy) {
// AFTER
if (state.winner) {
```

### Change 4: Update tests
**File**: `src/app/components/battle-screen/battle/battle-combat.service.spec.ts`
- The test `"rejects a second attack by the same stack while the animation is busy"` (line 175) tests the OLD behavior. This test should be updated to reflect that concurrent attacks are now allowed, OR removed and replaced with a test verifying concurrent attacks work.
- Tests that check `isBusy` blocking should be reviewed.

**File**: `src/app/components/battle-screen/battle/battle-combat.service.spec.ts`
- Add test: `"allows concurrent attacks from different stacks"` — two stacks attack simultaneously, both succeed, `activeCount` reaches 2 during animations.

### Change 5: Update or add component-level tests
**File**: `src/app/components/battle-screen/battle-screen.component.spec.ts`
- Add test: `"canAct returns true during animation"` — start an attack, verify `canAct` is still true while `anim.isBusy` is true.
- The test `"animation lock prevents concurrent attacks while an animation is in flight"` (line 148) tests via `doAttack` — this should be updated or replaced since concurrent attacks are now allowed.

## Files to Modify

1. `src/app/components/battle-screen/battle-screen.component.ts` — Change 1
2. `src/app/components/battle-screen/battle/battle-combat.service.ts` — Changes 2, 3
3. `src/app/components/battle-screen/battle/battle-combat.service.spec.ts` — Change 4 (test updates)
4. `src/app/components/battle-screen/battle-screen.component.spec.ts` — Change 5 (test updates)

## Verification

1. `ng test --watch false`: All tests pass (existing + new)
2. Manual: Start a battle, have AI attack (animation in flight), then select your own stack and attack — attack should succeed, not be silently rejected
3. Manual: During movement animation, click a stack — selection and info panel should update, command options visible
4. Manual: Two stacks attack simultaneously — both projectiles should fly independently

## Risks

- **Concurrent volleys**: Removing the global busy lock means two stacks can fire at the same time. Visual effects (projectile paths, damage numbers) may overlap. This is expected in real-time combat.
- **Rapid double-click on same stack**: Player can click attack on the same stack twice quickly, starting two animations. The `activeCount` correctly tracks both, but there's no per-stack attack cooldown. This matches existing behavior (there was never a per-stack attack limit) but should be noted.

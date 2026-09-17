# Feature: Auto-Attack Chain for Player Stacks

## Context

Currently, each attack command fires exactly one volley. The player must manually click again to attack another target. Desired behavior: when a player orders a stack to attack, it should keep firing at targets in range until no enemies remain reachable — automatically selecting the next target when the current one is destroyed.

## Design Decisions

### D1: Auto-attack chain via recursive `autoAttack` method
After the first volley completes, if enemies remain in range and the stack is still selected, recursively attack next target.

### D2: Single chain guard via `autoAttackActive` flag
Prevent concurrent chains on the same stack. If a chain is already running, new attack commands are ignored until the chain finishes.

### D3: Chain stops when:
(a) No targets in range, (b) different stack selected, (c) battle over (`state.winner`), (d) attack rejected (target out of range mid-animation), (e) chain already active (D2 guard).

### D4: Movement interruption — OUT OF SCOPE
Moving stacks that encounter enemies in range is a separate feature requiring real-time range checks in the game loop and movement cancellation logic. Deferred.

## Implementation

### `battle-screen.component.ts` — Changes

1. Add `private autoAttackActive = false;` flag
2. Add `private async autoAttack(attacker): Promise<void>` method
3. Modify `private async doAttack(attacker, target)` to start chain

```typescript
private autoAttackActive = false;

private async autoAttack(attacker: BattleStack): Promise<void> {
  if (this.autoAttackActive) return;  // D2 guard
  if (!this.state) return;
  if (this.selectedStackId !== attacker.stackId) return;  // D3b
  if (this.state.winner) return;  // D3c

  const targets = computeAttackTargetIds(this.state, attacker);
  if (targets.length === 0) return;  // D3a

  this.autoAttackActive = true;
  try {
    const success = await this.combat.attackStack(this.state, attacker.stackId, targets[0]);
    if (!success) return;  // D3d
    this.cdr.detectChanges();
    await this.autoAttack(attacker);  // recurse
  } finally {
    this.autoAttackActive = false;
  }
}

private async doAttack(attacker: BattleStack, target: BattleStack): Promise<void> {
  if (!this.state) return;
  if (this.autoAttackActive) return;  // D2 — chain already running
  this.autoAttackActive = true;
  try {
    await this.combat.attackStack(this.state, attacker.stackId, target.stackId);
    this.cdr.detectChanges();
    await this.autoAttack(attacker);
  } finally {
    this.autoAttackActive = false;
  }
}
```

The `autoAttackActive` flag lives at component level, shared between `doAttack` and `autoAttack`. The flag prevents:
- Double-click starting two chains
- `doAttack` starting while `autoAttack` is still running
- `autoAttack` being called outside of a chain context (it checks `autoAttackActive` and returns if set)

Wait — there's a contradiction: if `doAttack` sets `autoAttackActive = true` and then calls `autoAttack`, and `autoAttack` also checks `autoAttackActive`, it would return immediately. The fix: `autoAttack` should NOT check `autoAttackActive` — only `doAttack` should set it. `autoAttack` trusts the flag.

Revised:

```typescript
private autoAttackActive = false;

private async autoAttack(attacker: BattleStack): Promise<void> {
  if (!this.state) return;
  if (this.selectedStackId !== attacker.stackId) return;
  if (this.state.winner) return;

  const targets = computeAttackTargetIds(this.state, attacker);
  if (targets.length === 0) return;

  const success = await this.combat.attackStack(this.state, attacker.stackId, targets[0]);
  if (!success) return;
  this.cdr.detectChanges();

  await this.autoAttack(attacker);
}

private async doAttack(attacker: BattleStack, target: BattleStack): Promise<void> {
  if (!this.state || this.autoAttackActive) return;
  this.autoAttackActive = true;
  try {
    await this.combat.attackStack(this.state, attacker.stackId, target.stackId);
    this.cdr.detectChanges();
    await this.autoAttack(attacker);
  } finally {
    this.autoAttackActive = false;
  }
}
```

This is cleaner. `doAttack` is the single entry point that sets the flag. `autoAttack` does the chaining without re-checking the flag.

### Tests

- `doAttack chains to next target when first is destroyed`
- `auto-attack chain stops when no targets remain`
- `auto-attack chain stops when different stack selected`
- `doAttack ignores calls while chain is active`

## Files to Modify

1. `src/app/components/battle-screen/battle-screen.component.ts`
2. `src/app/components/battle-screen/battle-screen.component.spec.ts`

## Verification

1. `ng test --watch false`: All tests pass
2. Manual: Attack enemy → stack keeps firing until no targets
3. Manual: Click different stack during chain → chain stops
4. Manual: Quick double-click on different enemies → only one chain runs

## Risks

- Recursive chain on many targets: acceptable, each level awaits animation
- `autoAttackActive` flag doesn't survive component destroy — but `state.winner` and `selectedStackId` checks handle cleanup
- Movement interruption deferred (D4)

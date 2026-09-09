# Fix: BattleAnimationService undefined in BattleScreenComponent

## Problem
`this.anim` is undefined at runtime when accessing `this.anim.isBusy`, causing TypeError on stack click.

## Root Cause
Unknown - likely DI timing issue or circular dependency. `BattleAnimationService` has `@Injectable({ providedIn: 'root' })` but isn't properly injected in some contexts.

## Fix
Add optional chaining (`?.`) to all `this.anim` accesses in `BattleScreenComponent`.

## Files to Modify
1. `src/app/components/battle-screen/battle-screen.component.ts` - Lines 97-103, 168

## Changes
- Line 98: `!this.anim.isBusy` → `!this.anim?.isBusy`
- Line 102: `!this.anim.isBusy` → `!this.anim?.isBusy`
- Line 168: `this.anim.isBusy` → `this.anim?.isBusy`

## Validation
- Run tests: `npx ng test --include="src/app/components/battle-screen/**/*.spec.ts"`
- Manual: Click own stack during player turn - should show green cells without error
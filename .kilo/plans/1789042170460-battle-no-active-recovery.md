# Battle Screen: No Active Battle Recovery

Status: Ready for implementation

## Decision

A direct or stale navigation to `/battle` must remain on a recoverable error screen rather than redirecting automatically or returning to the main menu.

- Keep the existing `NO ACTIVE BATTLE` message.
- Add a `BACK TO STAR MAP` button in the same error branch.
- The button calls the existing `BattleScreenComponent.backToStarMap()` method.
- With no battle or battle state, do not create a `BattleOutcome`, do not mark a fleet destroyed, and do not write battle data to autosave.
- Resume game time and navigate to `/star-map`.
- Clear stale battle transport state when there is no active battle so a previous result cannot be replayed after returning to the map.

## Context

- `/battle` is defined in `src/app/app.routes.ts:17`.
- `BattleScreenComponent` reads the active battle from `BattleService` in `src/app/components/battle-screen/battle-screen.component.ts:73`.
- When no battle exists, `battleState` is null and the template renders only `NO ACTIVE BATTLE` at `src/app/components/battle-screen/battle-screen.component.html:90`.
- `backToStarMap()` already handles a null battle safely by skipping result persistence, resuming time, and navigating to `/star-map` at `src/app/components/battle-screen/battle-screen.component.ts:310`.
- Normal battle results are applied by `StarMap.reloadAfterBattle()` and then cleared by `BattleService.clearBattle()` at `src/app/components/star-map/star-map.ts:2301` and `src/app/components/star-map/star-map.ts:2360`.

## Implementation Tasks

1. Update `src/app/components/battle-screen/battle-screen.component.html`.
   - In the `battleState` null branch, render the existing error message and a `BACK TO STAR MAP` button.
   - Bind the button to `backToStarMap()`.
   - Reuse the existing `.back-btn` styling.

2. Harden the no-battle return path in `src/app/components/battle-screen/battle-screen.component.ts` if needed.
   - Preserve the existing result-persistence path when `battle && state` are present.
   - In the no-battle branch, clear stale `BattleService` transport state before resuming time and navigating.
   - Do not change the normal battle completion flow.

3. Add a regression test in `src/app/components/battle-screen/battle-screen.component.spec.ts`.
   - Create the component with no battle in `BattleService`.
   - Verify the error text and return button are rendered.
   - Click the button and verify navigation to `/star-map`.
   - Verify game time is resumed.
   - Verify no battle result, destroyed fleet ID, or autosave battle mutation is produced.

## Validation

- Run the focused battle-screen component test.
- Run the full test command (`npm test`) and confirm no new failures.
- Run `npm run build` to verify the Angular template and TypeScript compilation.
- Manually verify:
  - Direct navigation to `/battle` shows `NO ACTIVE BATTLE` with the return button.
  - Clicking the button returns to the star map and the simulation is not left paused.
  - A normal completed battle still persists its outcome and returns to the star map unchanged.

## Out of Scope

- Automatic route guards or redirects.
- Main-menu fallback behavior.
- Changes to battle simulation, combat rules, or save-slot architecture.

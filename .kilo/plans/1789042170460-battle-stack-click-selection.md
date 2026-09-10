# Battle Grid: Ship Click Selection Only

Status: Ready for implementation

## Decision

Clicking any part of a battle stack, including the visual overhang of size-2 and size-3 stacks, must select that stack only. It must not also issue a move command for the grid cell underneath the cursor.

Clicks on empty grid cells remain movement commands when the current selection and move rules allow it.

## Root Cause

- `battle-grid.component.html:1` attaches the grid click handler to the whole battle grid.
- The stack button at `battle-grid.component.html:21` handles selection, but its click event bubbles to the parent grid.
- `battle-grid.component.ts:139` converts the bubbled event coordinates into a grid cell and calls `onCellClick`.
- `battle-screen.component.ts:263` then treats that cell as a movement target when the same stack is selected.
- The CSS makes the stack button clickable (`.stack { pointer-events: auto; }`) while its wrapper is not, so the event reaches the button but continues bubbling to the grid.

This is an event-propagation bug, not a missing move-target rule. The movement calculation itself should remain unchanged.

## Implementation Tasks

1. Update `src/app/components/battle-screen/battle-grid/battle-grid.component.html`.
   - Pass the click event to the stack handler, or otherwise stop propagation at the stack button.
   - Keep the existing selection callback and button markup.

2. Update `src/app/components/battle-screen/battle-grid/battle-grid.component.ts`.
   - Change `onStackClickHandler` to accept the `MouseEvent`.
   - Call `event.stopPropagation()` before invoking `onStackClick`.
   - Preserve the existing `canSelect` guard.

3. Add a regression test in `src/app/components/battle-screen/battle-grid/battle-grid.component.spec.ts`.
   - Render a selected size-2 stack.
   - Provide a move cell matching the grid cell that the bubbled click would resolve to.
   - Click the stack button.
   - Assert that `onStackClick` receives the stack id.
   - Assert that `onCellClick` is not called.
   - Optionally verify the same behavior for a size-3 stack or rely on the shared handler behavior.

4. Do not change:
   - `getReachableCells` or other movement validation.
   - Grid coordinate conversion.
   - Stack sizing or visual layout.
   - Empty-cell movement behavior.

## Validation

- Run the new battle-grid component regression test.
- Run the focused battle-screen and battle-grid-related tests.
- Run `npm test -- --watch=false`; compare against the known unrelated baseline failure in `src/app/app.spec.ts:22`.
- Run `npm run build`.
- Manually verify:
  - Clicking the anchor or overhanging part of a size-2/size-3 stack only selects it.
  - Clicking an empty highlighted grid cell still issues a move command.
  - Keyboard activation of the stack button still selects without moving.

## Out of Scope

- Changing ship dimensions, deployment rules, or battle movement rules.
- Adding a separate hit-test layer for only the overhanging pixels.
- Changing attack targeting or move-to-attack behavior.

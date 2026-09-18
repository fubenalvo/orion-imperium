# Connection Lines Enhancement: Move + Attack Indicators

## Context

After the move-to-attack recompute feature, the user wants two persistent connection lines visible on the battle grid whenever a stack is selected:
1. **Move line** (blue, dashed, thin): from selected stack to its move target (`targetX/targetY`) — visible when `moving = true`
2. **Attack line** (red, dashed, thin): from selected stack to its attack target — visible when the stack has an attack target (`explicitAttackTargetId` or `moveToAttackTargetId`)

Both lines should appear when the stack is selected (or re-selected), so clicking through all stacks reveals what each is doing.

## Decisions

- **Move line color**: `#8cc4ff` (existing `.connection-line` style)
- **Attack line color**: `#d65757` (red, matching attack-target highlight)
- **Both lines thin dashed**: same 2px height, no animation, persistent while selected
- **Attack target source**: `explicitAttackTargetId` first, then `moveToAttackTargetId` as fallback (covers move-to-attack stacks showing both lines)
- **Selection gating**: lines only render when a stack is selected (already handled by getter returning null when no selection)

## Files to Change

### 1. `battle-grid.component.ts`
- Add `@Input() attackConnectionLine: { from: { x: number; y: number } } | null = null;`
- Add `getAttackConnectionLine()` method (same geometry logic as `getConnectionLine()` but reads from `attackConnectionLine` input)

### 2. `battle-grid.component.html`
- Add attack line `@if (getAttackConnectionLine(); as line)` div with `.connection-line.attack` class, same style bindings as move line

### 3. `battle-grid.component.scss`
- Add `.connection-line.attack` modifier: `background-color: #d65757`, `box-shadow: 0 0 4px rgba(214, 87, 87, 0.6)`

### 4. `battle-screen.component.ts`
- Rename `connectionLine` getter → `moveConnectionLine` (returns line from selected stack to `targetX/targetY` when moving)
- Add `attackConnectionLine` getter (returns line from selected stack to attack target via `explicitAttackTargetId` or `moveToAttackTargetId`)

### 5. `battle-screen.component.html`
- Pass `[moveConnectionLine]="moveConnectionLine"` and `[attackConnectionLine]="attackConnectionLine"` to `app-battle-grid`

### 6. Tests
- Update `battle-grid.component.spec.ts`: rename `connectionLine` input tests to `moveConnectionLine`, add attack line tests
- Update `battle-screen.component.spec.ts`: rename `connectionLine` test to `moveConnectionLine`, add `attackConnectionLine` tests

## Edge Cases

- **Stack moving + attacking**: both blue and red lines visible
- **Stack only moving**: only blue line
- **Stack only attacking**: only red line
- **Target destroyed**: line disappears (getter returns null)
- **Stack deselected**: both lines disappear
- **Re-selected**: both lines reappear with current state

## Validation

- `npm run build` passes
- `npm test -- --watch=false` — all tests pass (619+)

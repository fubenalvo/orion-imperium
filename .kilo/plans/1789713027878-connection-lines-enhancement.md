# Connection Lines Enhancement: Move + Attack Indicators

## Context

After the move-to-attack recompute feature, the user wants two persistent connection lines visible on the battle grid whenever a stack is selected. The lines must be **dashed** (not solid), have **opacity 0.5**, and have **animated dashes moving toward the target** — matching the star-map fleet trail visual style.

Star-map trail reference (`_star-map-ships.scss:133-164`):
- `repeating-linear-gradient(to right, color 0, color 6px, transparent 6px, transparent 12px)` for dashed pattern
- `@keyframes trail-dash-move { 0% { background-position: 0 0 } 100% { background-position: 12px 0 } }` for animation
- `opacity: 0.85` (star-map uses 0.85; battle grid uses 0.5 per request)

## Decisions

- **Move line color**: `#8cc4ff` (blue)
- **Attack line color**: `#d65757` (red)
- **Dashed pattern**: `repeating-linear-gradient` (6px dash / 6px gap, matching star-map)
- **Opacity**: `0.5` (per user request; star-map uses 0.85)
- **Animation**: `background-position` shift via `@keyframes trail-dash-move` (0.5s linear infinite, matching star-map)
- **Attack target source**: `explicitAttackTargetId` first, then `moveToAttackTargetId` as fallback
- **Selection gating**: lines only render when a stack is selected (getter returns null when no selection)

## Files to Change

### 1. `battle-grid.component.ts`
- Add `@Input() attackConnectionLine: { from: { x: number; y: number } } | null = null;`
- Add `getAttackConnectionLine()` method (same geometry logic as `getConnectionLine()` but reads from `attackConnectionLine` input)

### 2. `battle-grid.component.html`
- Add move line `@if (getConnectionLine(); as line)` div with `.connection-line` class
- Add attack line `@if (getAttackConnectionLine(); as line)` div with `.connection-line.attack` class
- Both use same style bindings: `left`, `top`, `width`, `--connection-angle`

### 3. `battle-grid.component.scss`
- Update `.connection-line` base style:
  - Replace `background-color: #8cc4ff` with `repeating-linear-gradient(to right, #8cc4ff 0, #8cc4ff 6px, transparent 6px, transparent 12px)`
  - Add `opacity: 0.5`
  - Add `animation: trail-dash-move 0.5s linear infinite`
- Add `.connection-line.attack` modifier:
  - `repeating-linear-gradient(to right, #d65757 0, #d65757 6px, transparent 6px, transparent 12px)`
  - `opacity: 0.5`
  - `animation: trail-dash-move 0.5s linear infinite`
- Add `@keyframes trail-dash-move` (same as star-map: 0% → 12px background-position shift)

### 4. `battle-screen.component.ts`
- Rename `connectionLine` getter → `moveConnectionLine` (returns line from selected stack to `targetX/targetY` when moving)
- Add `attackConnectionLine` getter (returns line from selected stack to attack target via `explicitAttackTargetId` or `moveToAttackTargetId`)

### 5. `battle-screen.component.html`
- Pass `[connectionLine]="moveConnectionLine"` and `[attackConnectionLine]="attackConnectionLine"` to `app-battle-grid`

### 6. Tests
- Update `battle-grid.component.spec.ts`: keep `connectionLine` tests (input name unchanged), add attack line tests
- Update `battle-screen.component.spec.ts`: rename `connectionLine` → `moveConnectionLine` tests, add `attackConnectionLine` tests

## Edge Cases

- **Stack moving + attacking**: both blue and red lines visible, both animating
- **Stack only moving**: only blue line
- **Stack only attacking**: only red line
- **Target destroyed**: line disappears (getter returns null)
- **Stack deselected**: both lines disappear
- **Re-selected**: both lines reappear with current state

## Validation

- `npm run build` passes
- `npm test -- --watch=false` — all tests pass

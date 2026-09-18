# Battle Screen: Selected Stack Connection Line

## Context

When a player selects a stack on the battle screen, there's no visual indicator showing what the stack is doing (attacking which target, or moving where). Fleet movement lines on the star map solve this with a connecting line. The battle screen needs the same.

## Design

Draw a persistent line from the selected stack's current position to:
1. **Attack target**: if `explicitAttackTargetId` or `moveToAttackTargetId` is set → target stack's current (x, y)
2. **Movement destination**: if `targetX/targetY` is set (moving, no attack target) → (targetX, targetY)
3. **Nothing**: if no target and not moving → no line

The line updates every frame (real-time, follows moving targets).

## Implementation

### 1. `battle-grid.component.ts`
- Add `connectionLine: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null` input
- Add `getConnectionLine()` method returning line geometry (same pattern as `getProjectileLine()`):
  ```ts
  getConnectionLine(): { x: number; y: number; length: number; angleDeg: number } | null {
    if (!this.connectionLine) return null;
    const { from, to } = this.connectionLine;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.01) return null;
    return { x: from.x, y: from.y, length, angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI };
  }
  ```
- Add template rendering (after projectile section):
  ```html
  @if (getConnectionLine(); as line) {
    <div
      class="connection-line"
      [style.left]="line.x + 'vw'"
      [style.top]="line.y + 'vw'"
      [style.width]="line.length + 'vw'"
      [style.--connection-angle]="line.angleDeg + 'deg'"
    ></div>
  }
  ```

### 2. `battle-grid.component.scss`
- Add `.connection-line` style (persistent, no animation, cyan/blue):
  ```scss
  .connection-line {
    position: absolute;
    height: 2px;
    transform-origin: 0 0;
    background-color: #8cc4ff;
    box-shadow: 0 0 4px rgba(140, 196, 255, 0.6);
    z-index: 15;
    transform: rotate(var(--connection-angle, 0deg));
  }
  ```

### 3. `battle-screen.component.ts`
- Add `getConnectionLine(): { from: { x: number; y: number }; to: { x: number; y: number } } | null` method:
  ```ts
  getConnectionLine(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    if (!this.state || !this.selectedStackId) return null;
    const stack = this.state.stacks.find(
      (s) => s.stackId === this.selectedStackId && !s.destroyed
    );
    if (!stack) return null;
    // Attack target takes priority.
    const targetId = stack.explicitAttackTargetId ?? stack.moveToAttackTargetId;
    if (targetId) {
      const target = this.state.stacks.find((s) => s.stackId === targetId && !s.destroyed);
      if (target) return { from: { x: stack.x, y: stack.y }, to: { x: target.x, y: target.y } };
    }
    // Otherwise, movement destination.
    if (stack.targetX != null && stack.targetY != null) {
      return { from: { x: stack.x, y: stack.y }, to: { x: stack.targetX, y: stack.targetY } };
    }
    return null;
  }
  ```
- Pass to template: `[connectionLine]="getConnectionLine()"` on `<app-battle-grid>`

### 4. `battle-screen.component.html`
- Add `[connectionLine]="getConnectionLine()"` to `<app-battle-grid>`

### 5. Tests
- `battle-grid.component.spec.ts`: Add test that `getConnectionLine()` returns null when no input, and correct geometry when input is set
- If no spec file exists, add one with the connection line test

## Edge Cases
- **Selected stack destroyed**: no line (find returns undefined)
- **Target destroyed mid-movement**: line disappears (target not found → falls through to movement dest → if no movement dest, no line)
- **Both attack target and movement dest**: attack target wins (priority)
- **Zero-length line** (stack at target position): returns null (avoids 0-width div)

## Validation
- `npm run build` passes
- `npm test -- --watch=false` — all tests pass including new ones

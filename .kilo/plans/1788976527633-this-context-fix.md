# Fix: Lost `this` Context in BattleScreenComponent Callbacks

## Problem
`onStackClick` and `onCellClick` passed as `@Input()` to `BattleGridComponent` lose their `this` context. When grid calls them, `this` = grid component, not screen component → `this.state`, `this.anim` are `undefined`.

## Evidence
Console log shows all values as `undefined`:
```
[BattleScreen] onStackClick: attacker:frigate:0 canAct: undefined activeSide: undefined playerControlsActiveSide: undefined animBusy: undefined
```

## Fix Options

### Option 1: Bind in Constructor (Recommended)
```typescript
constructor(...) {
  ...
  this.onStackClick = this.onStackClick.bind(this);
  this.onCellClick = this.onCellClick.bind(this);
}
```

### Option 2: Arrow Functions
```typescript
onStackClick = (stackId: string): void => { ... }
onCellClick = (col: number, row: number): void => { ... }
```

## Files to Modify
- `src/app/components/battle-screen/battle-screen.component.ts` - Add binding in constructor

## Validation
- Click own stack → shows green cells, `canAct: true/false` (not undefined)
- Click enemy stack → attack or move-to-attack works
- All 63 tests pass
# Plan: Replace Hardcoded `enemy1`/`enemy2` IDs with `ai` Faction Flag

## Problem

AI faction identity is hardcoded as `new Set(['enemy1', 'enemy2'])` in 4 source files
and 3 dead declarations in 3 other files. Adding/remnameing enemy factions requires
code changes across the codebase. The new `ai: boolean` field on `Faction` will make
faction AI-control data-driven: any faction with `ai: true` is managed by the AI
pipeline, identified dynamically from the `factions` array at runtime.

## Root Cause Analysis

### Hardcoded sets in active use (4 sites)

| File | Line | Usage |
|------|------|-------|
| `star-map.ts:246` | `enemyFactionIds` field; iterated at lines 1823, 1841, 1856, 1878 in `gameLoopCallback` | Drives the entire V4.1→V5.2 AI pipeline loop per enemy faction |
| `enemy-strategy.service.ts:24` | `enemyFactionIds` field; iterated at line 63 in `tick()` | V4.1 strategy re-evaluation per enemy faction |
| `enemy-ai.service.ts:7` | `enemyFactionIds` field; checked at line 65 in `tick()` | V3 strength-based target selection filters enemy fleets |
| `enemy-action-executor.service.ts:54` | `enemyFactionIds` field; checked at line 90 in `tick()` | V5.1/V5.2 execution gate |

### Dead declarations (3 sites — field declared but never referenced)

| File | Line |
|------|------|
| `enemy-goal.service.ts:35` |
| `enemy-capability.service.ts:40` |
| `enemy-action.service.ts:47` |

### Key design distinction: `ai` flag vs `team` field

- **`team`**: alliance membership (1 = player, 0 = neutral, 2 = enemy). Used to identify player-team fleets for targeting/visibility (`faction.team === 1`). **Not changing.**
- **`ai`** (new): whether the AI pipeline should tick this faction. Replaces the hardcoded ID sets. **Adding.**

A faction can be `team: 2, ai: true` (current enemies), `team: 1, ai: false` (current player), or `team: 0, ai: false` (neutral). The `ai` flag is orthogonal to `team`.

## Implementation Steps

### 1. Add `ai` field to `Faction` interface — `star-map.models.ts:63`

Change:
```ts
export interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
  currencies: Record<string, number>;
  researchedTechnologies?: string[];
}
```
To:
```ts
export interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
  ai?: boolean;
  currencies: Record<string, number>;
  researchedTechnologies?: string[];
}
```

**Made optional (`ai?: boolean`)** to match the `researchedTechnologies?` backfill pattern for save/load backward compatibility. Migration (step 5) guarantees it is always `true`/`false` at runtime after load.

### 2. Add shared helper function — `star-map.models.ts`

Add after the `Faction` interface:
```ts
export function getAiFactionIds(factions: Faction[]): string[] {
  return factions.filter((f) => f.ai === true).map((f) => f.id);
}
```
This eliminates repeated `factions.filter(f => f.ai).map(f => f.id)` logic across services.

### 3. Update `star-map-data.json` — faction entries

Add `"ai": false` to `player`, `independent`, `unhabited`; `"ai": true` to `enemy1` and `enemy2` (lines 8–68).

### 4. Replace hardcoded sets in 4 source files

#### 4a. `star-map.ts` (lines 246, 1823, 1841, 1856, 1878)
- Remove field: `private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);`
- In `gameLoopCallback`, replace all 4 `for (const factionId of this.enemyFactionIds)` loops with:
  ```ts
  const aiFactionIds = getAiFactionIds(this.factions);
  for (const factionId of aiFactionIds) {
  ```
- Add import: `import { ..., getAiFactionIds } from './star-map.models';`

#### 4b. `enemy-strategy.service.ts` (lines 24, 63)
- Remove field: `private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);`
- In `tick()`, replace `for (const factionId of this.enemyFactionIds)` with:
  ```ts
  const aiFactionIds = getAiFactionIds(factions);
  for (const factionId of aiFactionIds) {
  ```
- Add import: `import { ..., getAiFactionIds } from './star-map.models';`

#### 4c. `enemy-ai.service.ts` (lines 7, 65)
- Remove field: `private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);`
- In `tick()`, after receiving `factions` param, build:
  ```ts
  const aiFactionIds = new Set(getAiFactionIds(factions));
  ```
- Replace `if (!this.enemyFactionIds.has(fleet.factionId))` with `if (!aiFactionIds.has(fleet.factionId))`
- Add import.

#### 4d. `enemy-action-executor.service.ts` (lines 54, 90)
- Remove field: `private readonly enemyFactionIds = new Set(['enemy1', 'enemy2']);`
- Replace the `if (!this.enemyFactionIds.has(action.factionId))` guard in `tick()` with:
  ```ts
  const faction = factions.find((f) => f.id === action.factionId);
  if (faction?.ai !== true) {
    return false;
  }
  ```

### 5. Remove dead `enemyFactionIds` declarations (3 files)

- `enemy-goal.service.ts:35` — delete the line (field is never read)
- `enemy-capability.service.ts:40` — delete the line (field is never read)
- `enemy-action.service.ts:47` — delete the line (field is never read)

### 6. Add `ai` backfill migration — `save-game.service.ts`

In `migrateSave()`, within the existing `for (const faction of data.factions ?? [])` loop, add:
```ts
if (faction.ai === undefined) {
  // Old saves lack the ai flag; derive from team (team 2 = AI enemy in the original convention)
  faction.ai = faction.team === 2;
}
```
This ensures old saves loaded before this change get `ai: true` for team-2 factions (enemy1, enemy2) and `ai: false` for everything else.

### 7. Update test fixtures (6 spec files)

Add `ai` field to all faction objects in test fixtures:

| File | Lines | Change |
|------|-------|--------|
| `enemy-ai.service.spec.ts` | 32–38 | Add `ai: true` to enemy1/enemy2, `ai: false` to player/independent/unhabited |
| `enemy-strategy.service.spec.ts` | 58–64 | Same pattern |
| `enemy-goal.service.spec.ts` | 58–64 | Same pattern |
| `enemy-capability.service.spec.ts` | 58–64 | Same pattern |
| `enemy-action.service.spec.ts` | 109–113 | Add `ai: false` to player, `ai: true` to enemy1/enemy2 |
| `enemy-action-executor.service.spec.ts` | 64–71 (`createFaction` default), 110–124+ (`baseFactions` array) | Add `ai: true` to enemy1/enemy2 defaults, `ai: false` to player |
| `save-game.service.spec.ts` | 13–28 (makeData helper) | Add `ai` field; add new test for `ai` backfill migration |

**Note**: `star-map.spec.ts` uses the real `star-map-data.json` (auto-updated in step 3), so no fixture changes needed there — but verify the AI pipeline tests still pass since they iterate over AI factions dynamically.

### 8. Update documentation

| File | Lines | Change |
|------|-------|--------|
| `docs/data-models.md` | 23–27 | Document `ai?: boolean` field on Faction with migration note |
| `docs/game-state.md` | 278 | Replace "(`enemy1`, `enemy2`)" with "factions with `ai: true`" |
| `docs/game-state.md` | 439–442 | Add `ai` to the Faction data model summary |
| `docs/game-state.md` | 557–562 | Update Faction descriptions to note `ai` flag |
| `docs/game-state.md` | 109 (migration section) | Add `ai` to the migration backfill list |

## Validation Plan

1. Run all existing specs: `npm test` (or `npx vitest run`) — all ~289 tests should pass
2. Verify no remaining `new Set(['enemy1', 'enemy2'])` in source (non-spec) files
3. Verify `getAiFactionIds` is used consistently across all 4 modified services
4. Confirm `star-map-data.json` factions all have the `ai` field
5. New test: verify `migrateSave` backfills `ai` from `team === 2` for old saves without the field

## Risk Assessment

- **Low risk**: The `ai` flag is additive; existing behavior is preserved by the migration backfill
- **Test fixture churn**: 6 spec files need `ai` field added; the `f.action.service.spec.ts` has 100+ `enemy1` string references — these are faction IDs used as data, not as AI-identification checks, so they don't need to change (only the faction *fixtures* need the new field)
- **Dead code removal**: Removing unused `enemyFactionIds` from 3 services has zero behavioral impact
- **No new save format version needed**: migration backfill handles all old saves transparently

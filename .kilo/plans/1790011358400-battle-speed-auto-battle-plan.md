# Battle Speed Increase + Auto Battle Toggle Plan

## Overview
Two changes to the battle screen:
1. Increase battle speeds by 25% (1x → 1.25x, 2x → 2.5x)
2. Add persistent "Auto Battle" toggle button defaulting to ON

## Current State
- **BattleTimeService** (`src/app/components/battle-screen/battle/battle-time.service.ts`):
  - `BattleSpeed = 0.5 | 1` (1x = 0.5, 2x = 1.0)
  - Default speed = 0.5 (1x)
- **Battle Screen Component** (`src/app/components/battle-screen/battle-screen.component.ts`):
  - Speed buttons at lines 20-37 in template
  - Uses `battleTime.setSpeed(0.5)` for 1x, `battleTime.setSpeed(1)` for 2x
- **Battle AI** (`battle-ai.service.ts`): Already controls non-player sides every 200ms

## Required Changes

### 1. Battle Speed Increase (25% faster)
**File:** `src/app/components/battle-screen/battle/battle-time.service.ts`
- Change `BattleSpeed` type from `0.5 | 1` to `0.625 | 1.25`
- Update default `_speed` from `0.5` to `0.625`
- Update `reset()` to use `0.625`
- Update initial state$ emission

**File:** `src/app/components/battle-screen/battle-screen.component.ts`
- Update `setBattleSpeed(0.5)` → `setBattleSpeed(0.625)` for 1x button
- Update `setBattleSpeed(1)` → `setBattleSpeed(1.25)` for 2x button
- Update active button condition: `battleSpeed === 0.5` → `battleSpeed === 0.625`
- Update active button condition: `battleSpeed === 1` → `battleSpeed === 1.25`

**File:** `src/app/components/battle-screen/battle-screen.component.html`
- Update aria-labels if needed (still show "1x" and "2x" labels)

### 2. Auto Battle Toggle (Auto-play mode)
**New Service:** `src/app/services/battle-settings.service.ts` (or extend existing pattern)
- Manage `autoBattleEnabled` boolean in localStorage
- Key: `orion_battle_auto_battle` (or similar)
- Default: `true` (ON)

**File:** `src/app/components/battle-screen/battle-screen.component.ts`
- Inject `BattleSettingsService`
- Add `autoBattleEnabled` signal/property
- Add `toggleAutoBattle()` method
- When autoBattle enabled: AI should also control player-controlled stacks
  - Modify `gameLoopCallback()` to run AI for player stacks too when autoBattle is ON
  - Or add a separate auto-battle tick that calls `ai.playAction()` for all stacks

**File:** `src/app/components/battle-screen/battle-screen.component.html`
- Add toggle button next to speed controls (after 2x button)
- Button shows "AUTO" with active/dimmed states
- Bind click to `toggleAutoBattle()`

**File:** `src/app/components/battle-screen/battle/battle-ai.service.ts`
- Ensure `playAction()` can handle player-controlled sides when called
- Currently filters to non-player sides; need parameter to override

### 3. Persistence
- Auto battle setting saved to localStorage
- Loaded on battle screen init
- Applied to next battle automatically

## Implementation Order
1. Create `BattleSettingsService` with localStorage persistence
2. Update `BattleTimeService` speed values
3. Update battle screen component template and logic
4. Modify AI service to support auto-play mode
5. Wire auto-battle logic into game loop
6. Test both changes

## Testing
- Verify 1x speed feels ~25% faster than before
- Verify 2x speed feels ~25% faster than before
- Verify auto battle toggle persists across browser sessions
- Verify auto battle ON makes AI control player units
- Verify auto battle OFF restores manual control

## Files to Modify
1. `src/app/components/battle-screen/battle/battle-time.service.ts`
2. `src/app/components/battle-screen/battle-screen.component.ts`
3. `src/app/components/battle-screen/battle-screen.component.html`
4. `src/app/components/battle-screen/battle/battle-ai.service.ts`
5. `src/app/services/battle-settings.service.ts` (NEW)

## Notes
- The speed labels ("1x", "2x") remain the same for UI familiarity
- Actual internal values change from 0.5/1.0 to 0.625/1.25
- Auto battle defaults to ON per user request
- No changes to `GameTimeService` (global galaxy time) — only battle-local time
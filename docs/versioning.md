# Versioning and Save Compatibility

The game has two independent version numbers: the **game version**, which is what players see, and the **save format version**, which is what the loader checks. This document defines both, how they are bumped, and which saves a release loads.

Related: [Data Models](./data-models.md) (`StarMapData`), [Architecture](./architecture.md) (save services), [Invariants](./invariants.md).

## Game version

- **Source of truth:** `version` in `package.json`, and nowhere else. `src/app/game-version.ts` exports it as `GAME_VERSION`.
- **Where it is used:**
  - the main menu footer shows it (`v0.3.0`);
  - every save stores it as `StarMapData.gameVersion`: `StarMap.serializeGameState` and `GalaxyGeneratorService.generate` write it.
- **Scheme:** semantic versioning, `MAJOR.MINOR.PATCH`. Before 1.0 this means `0.MINOR.PATCH`.

| Bump | When | Saves |
|---|---|---|
| PATCH (0.3.0 → 0.3.1) | bug fixes, balance values, UI polish | every save of the same MINOR line keeps loading |
| MINOR (0.3.x → 0.4.0) | a new system or larger feature | may raise the minimum supported save format; older saves are then rejected |
| MAJOR (0.x → 1.0.0) | the first complete release; after 1.0, large compatibility-breaking changes | as MINOR |

- Every release gets a git tag `vX.Y.Z` and an entry in `CHANGELOG.md` at the repository root.
- `package-lock.json` carries the same root version. `npm version <patch|minor|major> --no-git-tag-version` updates both files.

## Save format version

- `SAVE_VERSION` (`services/save-validation.ts`): an integer, bumped whenever the shape of the saved data changes in a way a loader must know about.
- **No bump is needed for an additive optional field** that has a safe default when missing. The codebase already relies on this, e.g. station `hullCurrent`. Document the default where the field is declared.
- `MIN_SUPPORTED_SAVE_VERSION`: the oldest format the game still loads.
- The version history comment next to `SAVE_VERSION` lists only the supported formats.

### Rules

1. **Within a MINOR line,** every format change needs a migration. A save written by 0.3.0 must load in 0.3.5. The migration goes into `SaveGameService.normalizeSave`, guarded by the save's `saveVersion`, and must be idempotent.
2. **A MINOR (or MAJOR) release may draw a line:** raise `MIN_SUPPORTED_SAVE_VERSION` to the current `SAVE_VERSION`, then delete every migration and every test for the formats below it. This is a deliberate decision per release, noted in `CHANGELOG.md`.
3. **A save outside `[MIN_SUPPORTED_SAVE_VERSION, SAVE_VERSION]` is never migrated or modified.** This also covers a save without a version, and one from a newer game. See [Loader behavior](#loader-behavior).

### Current line

Release **0.3.0** drew the first line: `SAVE_VERSION` = `MIN_SUPPORTED_SAVE_VERSION` = **12**.

- Every older format (0–11) is rejected.
- All migration code for those formats was removed, including the legacy 200 vw grid, the pre-v3 black hole backfill, the nebula backfill, the surface re-centering and the system-grid doubling. Their helpers (`legacyPlanetGridSize`, `markStarPositionsKnown`) and their tests went with it.

## Loader behavior

`isSupportedSaveVersion` (`save-validation.ts`) is the single check. Three places use it:

- **`validateSaveData`** returns one error, `save_version_unsupported`, for an unsupported save and checks nothing else. Its message says whether the save is older or newer, and names `gameVersion` when the save has one.
- **`SaveGameService.normalizeSave`** returns an unsupported save untouched and never raises a save's version.

  For a supported save it only does two things:
  - initializes state a freshly generated galaxy leaves to the first load: `spaceBases`, `diplomaticDemands`, `anomalies`, `tradeNetwork`, and empty `resourceTiles` on planets;
  - runs the idempotent repairs every load needs: `normalizeRelations`, in-system asteroid belts, planet deposits, unique ship ids.
- **`SaveGameService.getSlots`** lists an unsupported save with `incompatible: true`. The flag is derived on every read and never stored.

  What players see:
  - the main menu and pause menu load lists show such a slot as "Incompatible (vX.Y.Z)", or "Incompatible (older version)" when the save has no game version;
  - the slot is disabled.

  How the rest of the game treats it:
  - `activateSlot` refuses it;
  - `hasAnySave` and `getMostRecentSlotIndex` ignore it, so the game never tries to resume it;
  - a new game or manual save may overwrite the slot.

Other load-time defaults in `StarMap.loadGame` are runtime fallbacks for optional fields, not version migrations, and still apply. Examples: missing `exploredGridCells`, `StarSystem.explored`, `Fleet.sensorRange`, and planet surfaces created on first load.

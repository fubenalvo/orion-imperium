import packageJson from '../../package.json';

/*
 * The game's release version. package.json is the single source of truth;
 * bump it by the rules in docs/versioning.md. This is not the save format
 * version (SAVE_VERSION in services/save-validation.ts), which is a separate
 * integer that changes only when the saved data shape changes.
 */
export const GAME_VERSION: string = packageJson.version;

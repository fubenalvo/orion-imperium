/*
 * =========================================================
 * BATTLE MINIGAME — CORE TYPES & CONSTANTS
 * =========================================================
 *
 * Everything in this folder is battle-local. The minigame is a pure
 * INPUT → BATTLE → RESULT box: it receives two fleets (via the Battle
 * transport object) and returns a BattleOutcome. It never reads or
 * mutates StarMap / galaxy / economy / production / research state.
 *
 * The grid mirrors the System View grid concepts (1-indexed cells,
 * 5vw cell size) but keeps its own constants so the minigame has no
 * dependency on StarMapMovementService (a stateful root singleton).
 */
/* Grid: full-width tactical grid (72vw x 28vw, 4vw cells). */
export const BATTLE_GRID_COLUMNS = 18;
export const BATTLE_GRID_ROWS = 7;
export const BATTLE_CELL_SIZE_VW = 4;
/* AI action interval (ms). Both sides act simultaneously; AI takes one action per tick. */
export const AI_ACTION_INTERVAL_MS = 200;
/* Shield regeneration interval (ms). All sides regenerate simultaneously. */
export const SHIELD_REGEN_INTERVAL_MS = 1000;
/*
 * A stack renders up to MAX_STACK_SIZE ship icons; larger fleets of a
 * single ship type are split across multiple stacks of this size.
 */
export const MAX_STACK_SIZE = 5;
/* Deployment columns: attacker left, defender right. A third column is
 * used only when the number of stacks exceeds the two standard columns. */
export const ATTACKER_DEPLOY_COLS = [1, 2, 3, 4];
export const DEFENDER_DEPLOY_COLS = [18, 17, 16, 15];
/* Animation durations in ms. State commits after the animation resolves,
 * so the visible grid never shows a half-resolved action. */
export const ANIMATION_MS = {
    move: 180,
    projectile: 320,
    hit: 200,
    explosion: 420,
};

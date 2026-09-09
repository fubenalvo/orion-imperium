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

export type BattleSide = 'attacker' | 'defender';
export type BattlePhase = 'playerTurn' | 'aiTurn' | 'over';

/* Grid: same rendered dimensions as the System View grid (90vw x 35vw, 5vw cells). */
export const BATTLE_GRID_COLUMNS = 18;
export const BATTLE_GRID_ROWS = 7;
export const BATTLE_CELL_SIZE_VW = 5;

/* Shared per-side Action Point pool, refilled every turn. */
export const AP_PER_TURN = 10;

/*
 * A stack renders up to MAX_STACK_SIZE ship icons; larger fleets of a
 * single ship type are split across multiple stacks of this size.
 */
export const MAX_STACK_SIZE = 5;

/* Deployment columns: attacker left, defender right. A third column is
 * used only when the number of stacks exceeds the two standard columns. */
export const ATTACKER_DEPLOY_COLS = [1, 2, 3];
export const DEFENDER_DEPLOY_COLS = [17, 18, 16];

/* Animation durations in ms. State commits after the animation resolves,
 * so the visible grid never shows a half-resolved action. */
export const ANIMATION_MS = {
  move: 180,
  projectile: 320,
  hit: 200,
  explosion: 420,
} as const;

export interface GridCell {
  col: number;
  row: number;
}

/*
 * A single ship entry from the input fleet. The minigame deep-clones
 * these; the overworld Fleet objects are never mutated.
 */
export interface FleetShip {
  id: number;
  name: string;
  type: string;
  currentHp?: number;
  destroyed?: boolean;
}

/* One real ship inside a stack. shipId === FleetShip.id, the key used to
 * map battle results back onto the overworld fleet roster. */
export interface BattleShip {
  shipId: number;
  name: string;
  typeId: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  alive: boolean;
}

/*
 * BattleStack is the tactical unit: movement, attack, targeting, and
 * selection all operate on stacks. Individual BattleShip entries are
 * internal HP bookkeeping only.
 */
export interface BattleStack {
  stackId: string;
  side: BattleSide;
  typeId: string;
  typeName: string;
  col: number;
  row: number;
  ships: BattleShip[];
  tier: number;
  moveApPerCell: number;
  attackAp: number;
  moveRange: number;
  attackRange: number;
  immobile: boolean;
  cellsMovedThisTurn: number;
  attackedThisTurn: boolean;
  moving: boolean;
  firing: boolean;
  /* Transition duration (ms) of the current move tween; drives the CSS
   * transition so the tween length always matches the busy lock. */
  moveMs: number;
  destroyed: boolean;
}

/* Visual effect active during an attack animation. Only one animation
 * runs at a time (BattleAnimationService busy lock), so a single effect
 * slot on the state is sufficient. */
export interface BattleAttackEffect {
  phase: 'projectile' | 'impact' | 'explosion';
  from: GridCell;
  to: GridCell;
  targetStackId: string;
}

export interface BattleLogEntry {
  round: number;
  side: BattleSide;
  attackerStack: string;
  defenderStack: string;
  damage: number;
  kills: number;
}

export interface BattleModelState {
  round: number;
  activeSide: BattleSide;
  ap: number;
  apPerTurn: number;
  stacks: BattleStack[];
  phase: BattlePhase;
  log: BattleLogEntry[];
  effect: BattleAttackEffect | null;
  winner: BattleSide | null;
  attackerFleetId: number;
  defenderFleetId: number;
  attackerFactionId: string;
  defenderFactionId: string;
  attackerName: string;
  attackerColor: string;
  defenderName: string;
  defenderColor: string;
  battleType: 'fleet' | 'planet';
  planetId?: number;
  /*
   * Full rosters in input order. Stacks reference the same BattleShip
   * objects, so damage applied to a stack is immediately reflected here.
   * BattleOutcome is built from these to preserve overworld ship order.
   */
  attackerShips: BattleShip[];
  defenderShips: BattleShip[];
}

/* =========================================================
   RESULT MODEL
   ========================================================= */

export interface BattleShipOutcome {
  shipId: number;
  typeId: string;
  name: string;
  hp: number;
  destroyed: boolean;
}

export interface BattleFleetOutcome {
  fleetId: number;
  side: BattleSide;
  factionId: string;
  ships: BattleShipOutcome[];
  survivors: BattleShipOutcome[];
  wipedOut: boolean;
}

export interface BattleOutcome {
  winnerSide: BattleSide;
  winnerFleetId: number;
  loserFleetId: number;
  attacker: BattleFleetOutcome;
  defender: BattleFleetOutcome;
  rounds: number;
  battleType: 'fleet' | 'planet';
  planetId?: number;
}

/* =========================================================
   TRANSPORT CONTRACT (shared with BattleService)
   ========================================================= */

/*
 * Battle is the input contract between StarMap and the minigame. It is
 * kept structurally permissive: StarMap passes full overworld Fleet
 * objects (which satisfy BattleFleet via excess-property compatibility),
 * and the minigame only reads the fields below. It must NEVER mutate
 * fleet1/fleet2 — battle-state deep-clones the ships.
 */
export interface BattleFleet {
  id: number;
  name: string;
  factionId: string;
  ships: FleetShip[];
}

export interface Battle {
  fleet1: BattleFleet;
  fleet2: BattleFleet;
  faction1Name: string;
  faction1Color: string;
  faction2Name: string;
  faction2Color: string;
  attackerId: number;
  defenderId: number;
  type?: 'fleet' | 'planet';
  planetId?: number;
}

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
 * 4vw cell size) but keeps its own constants so the minigame has no
 * dependency on StarMapMovementService (a stateful root singleton).
 */

export type BattleSide = 'attacker' | 'defender';

/* Grid: full-width tactical grid (72vw x 28vw). 19x8 cells = rectangular cells. */
export const BATTLE_GRID_COLUMNS = 19;
export const BATTLE_GRID_ROWS = 8;
export const BATTLE_CELL_WIDTH_VW = 72 / 19;
export const BATTLE_CELL_HEIGHT_VW = 28 / 8;

/* Backward compatibility for code still using square-cell assumption.
 * Range calculations use the smaller dimension (3.5vw) to keep "range in cells" circular. */
export const BATTLE_CELL_SIZE_VW = Math.min(BATTLE_CELL_WIDTH_VW, BATTLE_CELL_HEIGHT_VW);

/* AI action interval (ms). Both sides act simultaneously; AI takes one action per tick. */
export const AI_ACTION_INTERVAL_MS = 800;

/* AI action cooldown (ms). After the AI commands a stack (move, attack, or
 * boost), that stack is locked for this duration and cannot be given another
 * AI command. Uses battle-local time so it scales with game speed and pauses
 * with the battle. */
export const AI_ACTION_COOLDOWN_MS = 1000;

/* Fraction of the attacker's attack range the AI closes to before stopping.
 * E.g. range 4 → stops at distance 3. Only affects WHERE the AI moves;
 * attack resolution and range checks are untouched. Tune freely. */
export const AI_MOVE_TO_ATTACK_RATIO = 0.9;

/* Deadband (vw units) before snapToGrid re-aligns a stack to a cell
 * centre. Prevents the out-and-back jitter that occurs when a stack's
 * interpolated x/y drifts a fraction of a cell off-centre every frame:
 * snapToGrid snaps it to the exact centre, the next frame it drifts
 * again, and the cycle repeats. Below this distance the stack is
 * considered settled and left alone. 0 disables the deadband. */
export const SNAP_DEADBAND_VW = 0;

/* Extra grid-cell tolerance on top of attackRange for the canAttack gate.
 * A stack that settled on a grid cell just outside absolute range (within
 * this many cells by grid steps) can still attack. Accounts for snap-to-grid
 * pushing a stack slightly outside its nominal range. Bounded — never lets
 * a stack attack from 2+ cells beyond range. 0 disables the tolerance. */
export const ATTACK_GRID_TOLERANCE_CELLS = 1;

/* Shield regeneration interval (ms). All sides regenerate simultaneously. */
export const SHIELD_REGEN_INTERVAL_MS = 2000;

/*
 * A stack renders up to MAX_STACK_SIZE ship icons; larger fleets of a
 * single ship type are split across multiple stacks of this size.
 */
export const MAX_STACK_SIZE = 5;

/* Deployment columns: attacker left, defender right. A third column is
 * used only when the number of stacks exceeds the two standard columns. */
export const ATTACKER_DEPLOY_COLS = [1, 2, 3, 4];
export const DEFENDER_DEPLOY_COLS = [19, 18, 17, 16];

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
 * map battle results back onto the overworld fleet roster.
 *
 * Shield and weapon fields are always present (defaults from
 * getBattleShipStats). BattleShipStats carries the authoritative
 * values; toBattleShip() copies them in. */
export interface BattleShip {
  shipId: number;
  name: string;
  typeId: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  shieldRegen: number;
  attackType: string;
  weakness: string;
  attack: number;
  defense: number;
  alive: boolean;
}

/*
 * BattleStack is the tactical unit: movement, attack, targeting, and
 * selection all operate on stacks. Individual BattleShip entries are
 * internal HP bookkeeping only.
 *
 * Real-time movement uses vw coordinates (x/y) and speed (vw/s).
 * Grid cells (col/row) are updated when a stack reaches its target,
 * and are used for movement, pathing, occupancy, and click cells.
 * Combat range uses the stacks' current absolute x/y positions.
 */
export interface BattleStack {
  stackId: string;
  side: BattleSide;
  typeId: string;
  typeName: string;
  role: string;
  col: number;
  row: number;
  ships: BattleShip[];
  size: number;
  tier: number;
  attackRange: number;
  immobile: boolean;
  moving: boolean;
  firing: boolean;
  destroyed: boolean;
  /* Real-time movement: vw coordinates and speed (vw/s from ship-data.json). */
  speed: number;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  /* Shots per second (from ship-data.json fireRate). */
  fireRate: number;

  /* Explicit attack target set by player command. Overrides auto-attack target selection.
   * When set, the stack will ONLY attack this target until it's destroyed or player gives new command. */
  explicitAttackTargetId?: string | null;

  /* Target stack for move-to-attack commands. Used by updateMoveToAttackTargets() to
   * periodically re-compute the destination cell based on the target's current position. */
  moveToAttackTargetId?: string | null;

  /* Timestamp (ms, from performance.now()) when this stack can attack again.
   * Used for fire-rate cooldown between volleys in auto-attack. */
  attackCooldownUntil?: number;

  /* Timestamp (ms, from performance.now()) when the AI can command this stack
   * again after its last command (move, attack, or boost). Prevents AI
   * micro-management — once the AI commands a stack, it leaves it alone for
   * AI_ACTION_COOLDOWN_MS. */
  actionCooldownUntil?: number;
}

/* Visual effect active during an attack animation. Multiple effects can run
 * concurrently (different stacks attacking simultaneously). */
export interface BattleAttackEffect {
  phase: 'projectile' | 'impact' | 'explosion';
  from: { x: number; y: number };
  to: { x: number; y: number };
  targetStackId: string;
  attackerStackId: string;
}

export interface BattleLogEntry {
  round: number;
  side: BattleSide;
  attackerStack: string;
  defenderStack: string;
  damage: number;
  kills: number;
}

/*
 * Battle-local shared shield pool granted by planetary shield buildings.
 * It protects only immobile defense stacks and is never persisted to a save
 * or to BattleOutcome.
 */
export interface BattleShieldPool {
  current: number;
  max: number;
  regen: number;
}

/* Planet identity used by the battle screen to render the separate planet
 * visual. This is presentation-only; it is never part of combat state. */
export interface BattlePlanetVisual {
  name: string;
  color: string;
}

export interface BattleModelState {
  round: number;
  stacks: BattleStack[];
  log: BattleLogEntry[];
  effects: BattleAttackEffect[];
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
  planetName?: string;
  planetColor?: string;
  /*
   * Shared planetary shield. Optional so existing model-state fixtures that
   * predate planet battles keep compiling without a new required field.
   */
  defenderShieldPool?: BattleShieldPool | null;
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
  shieldPoolCurrent?: number;
  shieldPoolMax?: number;
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
  /*
   * Planet-battle only: shared shield granted by planetary shield
   * buildings. StarMap sets these on the virtual defense fleet; normal
   * fleets leave them undefined.
   */
  shieldPool?: number;
  shieldPoolRegen?: number;
  /*
   * Planet-battle only: the total shared shield granted by shield buildings.
   * Kept separate from the current pool so a fully depleted (0) pool is
   * still represented as a regenerating pool in the battle minigame.
   */
  shieldPoolMax?: number;
  /*
   * Planet-battle only: identity of the real garrison fleet and a mapping
   * from the virtual ship ids used in battle back to the garrison fleet's
   * original ship ids. Used by the overworld to persist garrison damage.
   */
  garrisonFleetId?: number;
  garrisonShipMap?: Record<number, number>;
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
  planetName?: string;
  planetColor?: string;
}

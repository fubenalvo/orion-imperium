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
 * The grid reuses the System View concept of 1-indexed cells but keeps
 * its own constants so the minigame has no dependency on
 * StarMapMovementService (a stateful root singleton).
 */

export type BattleSide = 'attacker' | 'defender';

/* Battlefield: a fixed 72vw x 28vw area. The SCSS in battle-grid and
 * battle-planet derives its cell sizes from the same numbers, so keep them
 * in sync when changing the grid. */
export const BATTLE_FIELD_WIDTH_VW = 72;
export const BATTLE_FIELD_HEIGHT_VW = 28;

/* Grid density: 38 x 16 cells (doubled from the original 19 x 8). Cells are
 * slightly rectangular (~1.89vw x 1.75vw). Ships occupy 1-3 cells
 * horizontally (see BattleStack.size), so on the denser grid they render at
 * half their former on-screen size and have four times as much room. */
export const BATTLE_GRID_COLUMNS = 38;
export const BATTLE_GRID_ROWS = 16;
export const BATTLE_CELL_WIDTH_VW = BATTLE_FIELD_WIDTH_VW / BATTLE_GRID_COLUMNS;
export const BATTLE_CELL_HEIGHT_VW = BATTLE_FIELD_HEIGHT_VW / BATTLE_GRID_ROWS;

/* Physical length (vw) of one unit of the ship-data.json "range" stat.
 * Deliberately decoupled from the grid density: it equals the cell height
 * of the original 19x8 grid, so doubling the grid did not change how far
 * any weapon reaches. Never derive this from BATTLE_CELL_*_VW. */
export const BATTLE_RANGE_UNIT_VW = 3.5;

/* AI decision interval (ms). Every tick the tactical AI re-plans movement
 * (and Carrier Shield Pulse) for every stack it controls whose
 * AI_ACTION_COOLDOWN_MS has expired. Firing is NOT an AI decision: all
 * stacks on both sides fire through the shared fire-control pass in
 * BattleCombatService.runFireControl(). */
export const AI_ACTION_INTERVAL_MS = 400;

/* AI movement cooldown (ms). After the AI commands a stack (move or
 * boost), it leaves that stack alone for this long so it does not
 * micro-manage. Battle-local time: scales with speed and freezes on pause. */
export const AI_ACTION_COOLDOWN_MS = 1000;

/* Global fire-rate multiplier. The interval between two volleys of a stack
 * is (1 / fireRate) s * FIRE_RATE_MULTIPLIER, identical for both sides.
 * <1 = faster, >1 = slower. No UI — purely a tuning constant. */
export const FIRE_RATE_MULTIPLIER = 1.0;

/* How often (battle ms) chasing stacks re-plan their destination and
 * manual attack orders re-issue a chase. Throttled because each re-plan
 * scans the whole grid; per-frame re-planning was the main battle hot path. */
export const MOVE_REPLAN_INTERVAL_MS = 150;

/* Set to true to get the verbose [ATTACK]/[MOVE]/[AI] console traces.
 * Off by default: several of them sit in per-frame paths. */
export const BATTLE_DEBUG_LOG = false;

export function battleDebug(...args: unknown[]): void {
  if (BATTLE_DEBUG_LOG) {
    console.log(...args);
  }
}

/* Battle speed multipliers for the time control buttons.
 * 1x is the default; 2x doubles the game-time flow rate. */
export const BATTLE_SPEED_1X = 1.0;
export const BATTLE_SPEED_2X = 2.0;

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

/* Extra reach, in range units (BATTLE_RANGE_UNIT_VW), added on top of
 * attackRange by the canAttack gate. Originally added so a stack that
 * snapped to a cell just outside nominal range could still fire. It is part
 * of the established balance (every ship effectively reaches range + 1), so
 * it was kept in physical units when the grid was doubled. 0 disables it. */
export const ATTACK_RANGE_TOLERANCE = 1;

/* Shield regeneration interval (ms). All sides regenerate simultaneously. */
export const SHIELD_REGEN_INTERVAL_MS = 2000;

/*
 * A stack renders up to MAX_STACK_SIZE ship icons; larger fleets of a
 * single ship type are split across multiple stacks of this size.
 */
export const MAX_STACK_SIZE = 5;

/* Deployment slots. Anchors are spaced two cells apart so the opening
 * formation keeps the physical spacing it had on the 19x8 grid
 * (old column c -> new column 2c-1, old row r -> new row 2r). Columns are
 * listed from the outer edge inward; rows centre-out. battle-state falls
 * back to any free cell when these slots are exhausted. */
export const ATTACKER_DEPLOY_COLS = [1, 3, 5, 7];
export const DEFENDER_DEPLOY_COLS = [38, 36, 34, 32];
export const DEPLOY_ROW_ORDER = [8, 6, 10, 4, 12, 2, 14];

/* Automatic target-selection modes (scoring lives in battle-targeting.ts).
 * 'balanced' is the original role-aware score and the enemy AI default. */
export type BattleTargetingMode = 'balanced' | 'strongest' | 'weakest' | 'firepower';
export const DEFAULT_TARGETING_MODE: BattleTargetingMode = 'balanced';

/* Animation durations in ms. State commits after the animation resolves,
 * so the visible grid never shows a half-resolved action. */
export const ANIMATION_MS = {
  move: 90,
  projectile: 160,
  hit: 100,
  explosion: 210,
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

  /* Manual attack order (player command). Fire control shoots this target
   * whenever it is in range, and the movement service keeps chasing it while
   * it is out of range. Cleared ONLY when the target is destroyed or the
   * player gives this stack a new order — never by selection changes, range
   * loss, AUTO, or AI decisions. While the target is out of range the stack
   * may fire opportunistically at other in-range enemies without dropping
   * the order. */
  explicitAttackTargetId?: string | null;

  /* True while a player-issued move order is in flight. AUTO battle leaves
   * the stack alone until it arrives, so manual moves are not overridden. */
  manualMoveOrder?: boolean;

  /* Target stack for move-to-attack commands. Used by updateMoveToAttackTargets() to
   * periodically re-compute the destination cell based on the target's current position. */
  moveToAttackTargetId?: string | null;

  /* Automatic target-selection preference, used whenever the stack is free
   * to pick its own target (no manual order, or manual target out of range).
   * Battle-local only; never persisted. */
  targetingMode?: BattleTargetingMode;

  /* Sticky automatic target. Kept while it stays alive and in range so fire
   * control does not flip between targets every volley; cleared when the
   * targeting mode changes. */
  autoTargetId?: string | null;

  /* Battle-elapsed ms at which this stack may fire its next volley (or
   * Carrier Shield Pulse). Shared fire-rate cooldown for both sides. */
  attackCooldownUntil?: number;

  /* Battle-elapsed ms at which the AI may re-plan this stack after its last
   * AI command (move or boost). Independent from attackCooldownUntil so AI
   * pacing never throttles firing. */
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


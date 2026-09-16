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
   * Shield and weapon fields are optional (default 0 / '') so existing test
   * fixtures that build BattleShip literals without them keep working.
   * BattleShipStats carries the authoritative values; toBattleShip()
   * copies them in. */
  export interface BattleShip {
    shipId: number;
    name: string;
    typeId: string;
    hp: number;
    maxHp: number;
    shield?: number;
    maxShield?: number;
    shieldRegen?: number;
    attackType?: string;
    weakness?: string;
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
 * and are used for combat range/pathing checks.
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
}

/* Visual effect active during an attack animation. Only one animation
 * runs at a time (BattleAnimationService busy lock), so a single effect
 * slot on the state is sufficient. */
export interface BattleAttackEffect {
  phase: 'projectile' | 'impact' | 'explosion';
  from: { x: number; y: number };
  to: { x: number; y: number };
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

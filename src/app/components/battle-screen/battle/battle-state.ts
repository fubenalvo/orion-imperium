import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import {
  Battle,
  BattleFleet,
  BattleModelState,
  BattleShip,
  BattleSide,
  BattleStack,
  FleetShip,
  MAX_STACK_SIZE,
} from './battle.types';
import {
  ATTACKER_DEPLOY_COLS,
  DEFENDER_DEPLOY_COLS,
  DEPLOY_ROW_ORDER,
  BATTLE_GRID_COLUMNS,
  BATTLE_GRID_ROWS,
  DEFAULT_TARGETING_MODE,
} from './battle.types';
import { getBattleShipStats } from './battle-ship-stats';
import { isInBounds, occupiedCols, stackCenterVw } from './battle-grid';
import { BATTLE_SPEED_MULTIPLIER } from './battle.types';
import { copyEquipment, hasUpgrades, loadoutKey } from '../../star-map/equipment';
import { resolveShipStats } from '../../star-map/ship-stats';

/*
 * =========================================================
 * BATTLE MINIGAME — STATE FACTORY
 * =========================================================
 *
 * Builds the battle-local simulation state from the transport Battle
 * object. Deep-clones both fleets' ships: the overworld Fleet objects
 * passed by StarMap are NEVER mutated. Renders stacks are grouped by
 * side + ship type + loadout with a MAX_STACK_SIZE cap and deployed on the grid.
 */

/*
 * Fleets up to this many ships deploy one stack per ship; larger fleets
 * are grouped by type into MAX_STACK_SIZE stacks. 28 = the 4 x 7 deployment
 * slots of the original grid; kept as a fixed number when the grid was
 * doubled so the stacking behaviour (and thus balance) did not change.
 */
const INDIVIDUAL_STACK_LIMIT = 28;

export function createBattleState(
  battle: Battle,
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
): BattleModelState {
  const attackerFleet = sideFleet(battle, battle.attackerId);
  const defenderFleet = sideFleet(battle, battle.defenderId);
  const defender = battle.fleet1 === defenderFleet ? battle.fleet1 : battle.fleet2;

  // Hull → research multipliers → fixed module values (ship-stats.ts order).
  const battleShips = (fleet: BattleFleet): BattleShip[] => {
    const bonus = battle.combatBonuses?.[fleet.factionId];
    return fleet.ships.map((s) =>
      withEquipment(withCombatBonus(toBattleShip(s, shipService, planetBattleService), bonus), s, bonus, shipService));
  };
  const attackerShips = battleShips(attackerFleet);
  const defenderShips = battleShips(defenderFleet);

  const attackerStacks = buildStacks('attacker', attackerShips, shipService, planetBattleService);
  const defenderStacks = buildStacks('defender', defenderShips, shipService, planetBattleService);
  deploySide(attackerStacks, ATTACKER_DEPLOY_COLS);
  deploySide(defenderStacks, DEFENDER_DEPLOY_COLS);
  initializeStackPositions([...attackerStacks, ...defenderStacks]);

  /*
   * Shared shield pool exists only for planet battles. Fleet-vs-fleet
   * fleets never carry the transport fields, so they always get null.
   */
  const shieldPool = battle.type === 'planet' ? (defenderFleet.shieldPool ?? 0) : 0;
  const shieldPoolRegen =
    battle.type === 'planet' ? (defenderFleet.shieldPoolRegen ?? 0) : 0;
  const shieldPoolMax =
    battle.type === 'planet' ? (defenderFleet.shieldPoolMax ?? defenderFleet.shieldPool ?? 0) : 0;

  return {
    round: 1,
    stacks: [...attackerStacks, ...defenderStacks],
    log: [],
    effects: [],
    projectiles: [],
    winner: null,
    attackerFleetId: attackerFleet.id,
    defenderFleetId: defenderFleet.id,
    attackerFactionId: attackerFleet.factionId,
    defenderFactionId: defenderFleet.factionId,
    attackerName: attackerFleet.name,
    attackerColor: attackerFleet === battle.fleet1 ? battle.faction1Color : battle.faction2Color,
    defenderName: defenderFleet.name,
    defenderColor: defenderFleet === battle.fleet1 ? battle.faction1Color : battle.faction2Color,
    battleType: battle.type === 'planet' ? 'planet' : 'fleet',
    planetId: battle.planetId,
    planetName: battle.planetName,
    planetColor: battle.planetColor,
    spaceBaseId: battle.spaceBaseId,
    miningStation: battle.miningStation,
    defenderShieldPool:
      battle.type === 'planet' && shieldPoolMax > 0
        ? { current: shieldPool, max: shieldPoolMax, regen: shieldPoolRegen }
        : null,
    attackerShips,
    defenderShips,
  };
}

/*
 * Applies a faction's technology combat multipliers (Battle.combatBonuses)
 * to one battle ship. Battle ships are rebuilt from the overworld fleet for
 * every battle, so the bonus is applied exactly once per battle and never
 * written back to the fleet.
 */
function withCombatBonus(
  ship: BattleShip,
  bonus: { attack: Record<string, number>; shield: Record<string, number> } | undefined,
): BattleShip {
  if (!bonus) {
    return ship;
  }
  const attack = bonus.attack[ship.typeId] ?? 1;
  const shield = bonus.shield[ship.typeId] ?? 1;
  return { ...ship, attack: ship.attack * attack, shield: ship.shield * shield, maxShield: ship.maxShield * shield };
}

/*
 * Applies a ship's installed modules (docs/ship-equipment.md) after the
 * research bonus. A standard loadout returns the ship untouched, so
 * battles without upgrades are exactly as before. Otherwise the ship's
 * combat values are re-resolved by resolveShipStats with the same research
 * factors, which keeps one formula for battle, forecasts and displays.
 * Shields start full, as for every battle ship.
 */
function withEquipment(
  ship: BattleShip,
  source: FleetShip,
  bonus: { attack: Record<string, number>; shield: Record<string, number> } | undefined,
  shipService: ShipService,
): BattleShip {
  const shipType = shipService.getShipType(source.type);
  if (!shipType || !hasUpgrades(shipType.id, source.equipment)) {
    return ship;
  }
  const resolved = resolveShipStats(shipType, source.equipment, {
    attack: bonus?.attack[shipType.id],
    shield: bonus?.shield[shipType.id],
  });
  return {
    ...ship,
    attack: resolved.attack,
    defense: resolved.defense,
    shield: resolved.shield,
    maxShield: resolved.shield,
    shieldRegen: resolved.shieldRegen,
    attackType: resolved.attackType,
    weakness: resolved.weakness,
    ...copyEquipment(source),
  };
}

/*
 * Stack-level values that must hold for every ship of a stack: movement
 * speed, reach, cadence and turning. From the hull stats for a standard
 * loadout (no extra fields, so such stacks are unchanged), otherwise from
 * the resolved loadout. buildStacks groups by loadout, so one ship's
 * loadout stands for the whole stack.
 */
function stackMotionFields(
  typeId: string,
  equipment: FleetShip['equipment'],
  stats: { speed: number; attackRange: number; fireRate: number },
  shipService: ShipService,
): Pick<BattleStack, 'speed' | 'attackRange' | 'fireRate' | 'hullFireRate' | 'turnRateBonus' | 'loadout'> {
  const shipType = shipService.getShipType(typeId);
  if (!shipType || !hasUpgrades(typeId, equipment)) {
    return { speed: stats.speed, attackRange: stats.attackRange, fireRate: stats.fireRate };
  }
  const resolved = resolveShipStats(shipType, equipment);
  return {
    speed: resolved.battleSpeed * BATTLE_SPEED_MULTIPLIER,
    attackRange: resolved.range,
    fireRate: resolved.fireRate,
    ...(resolved.fireRate !== resolved.hullFireRate ? { hullFireRate: resolved.hullFireRate } : {}),
    ...(resolved.turnRateBonus !== 0 ? { turnRateBonus: resolved.turnRateBonus } : {}),
    loadout: { ...equipment },
  };
}

function sideFleet(battle: Battle, fleetId: number): BattleFleet {
  return battle.fleet1.id === fleetId ? battle.fleet1 : battle.fleet2;
}

function toBattleShip(
  ship: FleetShip,
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
): BattleShip {
  const stats = getBattleShipStats(ship.type, shipService, planetBattleService);
  const isRealShip = shipService.getShipType(ship.type) != null;
  const isVirtualShip = planetBattleService.getVirtualShipType(ship.type) != null;
  const recognized = isRealShip || isVirtualShip;
  const cameInDestroyed = ship.destroyed === true;

  /*
   * Real ships persist strategic HP and destroyed flags across battles.
   * Destroyed ships stay in the outcome roster (so the flag round-trips)
   * but are never deployed. Unknown ship types are quarantined: kept in
   * the save but excluded from combat instead of fighting as 1-HP units.
   */
  let hp: number;
  if (!recognized || cameInDestroyed) {
    hp = 0;
  } else if (isVirtualShip) {
    // Virtual defense ships carry their pre-set currentHp (PlanetBattleService
    // builds them with hp = attack * 3) because they have no ShipType entry.
    hp =
      typeof ship.currentHp === 'number' && Number.isFinite(ship.currentHp) && ship.currentHp > 0
        ? ship.currentHp
        : stats.maxHp;
  } else {
    const persisted =
      typeof ship.currentHp === 'number' && Number.isFinite(ship.currentHp)
        ? ship.currentHp
        : stats.maxHp;
    hp = persisted <= 0 ? 0 : Math.max(1, Math.min(persisted, stats.maxHp));
  }

  return {
    shipId: ship.id,
    name: ship.name,
    typeId: ship.type,
    hp,
    maxHp: stats.maxHp,
    // Shield is copied from the resolved ship stats so the battle state is
    // fully self-contained; the overworld FleetShip is never mutated.
    shield: stats.shield,
    maxShield: stats.shield,
    shieldRegen: stats.shieldRegen,
    // Weapon type is copied alongside shield so the battle sim is fully
    // self-contained; the overworld FleetShip is never mutated.
    attackType: stats.attackType,
    weakness: stats.weakness,
    attack: stats.attack,
    defense: stats.defense,
    alive: hp > 0,
  };
}

function buildStacks(
  side: BattleSide,
  roster: BattleShip[],
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
): BattleStack[] {
  /*
   * Fleet size boundary: small fleets get one stack per ship for tactical
   * clarity. Larger fleets are grouped by type and loadout into MAX_STACK_SIZE chunks
   * for readability and performance.
   */
  if (roster.length <= INDIVIDUAL_STACK_LIMIT) {
    const stacks: BattleStack[] = [];
    let index = 0;
    for (const ship of roster) {
      if (!ship.alive) {
        continue;
      }
      const stats = getBattleShipStats(ship.typeId, shipService, planetBattleService);
      const size = stats.tier >= 5 ? 3 : stats.tier >= 3 ? 2 : 1;
      stacks.push({
        stackId: `${side}:${ship.typeId}:${index++}`,
        side,
        typeId: ship.typeId,
        typeName: stats.typeName,
        role: stats.role,
        col: 1,
        row: 1,
        ships: [ship],
        size,
        tier: stats.tier,
        hullClass: stats.hullClass,
        shieldAura: stats.shieldAura,
        immobile: stats.immobile,
        moving: false,
        firing: false,
        destroyed: false,
        targetingMode: DEFAULT_TARGETING_MODE,
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
        ...stackMotionFields(ship.typeId, ship.equipment, stats, shipService),
      });
    }
    return stacks;
  }

  const living = roster.filter((ship) => ship.alive);
  if (living.length === 0) {
    return [];
  }

  // Grouped by type AND loadout: stack-level speed, reach and cadence must
  // hold for every ship in a stack. Standard ships have the key '', so
  // fleets without upgrades group exactly as before.
  const grouped = new Map<string, { typeId: string; ships: BattleShip[] }>();
  for (const ship of living) {
    const key = `${ship.typeId}|${loadoutKey(ship.typeId, ship.equipment)}`;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.ships.push(ship);
    } else {
      grouped.set(key, { typeId: ship.typeId, ships: [ship] });
    }
  }

  const stacks: BattleStack[] = [];
  let index = 0;
  for (const { typeId, ships } of grouped.values()) {
    const stats = getBattleShipStats(typeId, shipService, planetBattleService);
    const size = stats.tier >= 5 ? 3 : stats.tier >= 3 ? 2 : 1;
    for (let offset = 0; offset < ships.length; offset += MAX_STACK_SIZE) {
      const chunk = ships.slice(offset, offset + MAX_STACK_SIZE);
      stacks.push({
        stackId: `${side}:${typeId}:${index++}`,
        side,
        typeId,
        typeName: stats.typeName,
        role: stats.role,
        col: 1,
        row: 1,
        ships: chunk,
        size,
        tier: stats.tier,
        hullClass: stats.hullClass,
        shieldAura: stats.shieldAura,
        immobile: stats.immobile,
        moving: false,
        firing: false,
        destroyed: false,
        targetingMode: DEFAULT_TARGETING_MODE,
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
        ...stackMotionFields(typeId, chunk[0].equipment, stats, shipService),
      });
    }
  }
  return stacks;
}

/*
 * Deploys one side. Placement is occupancy-aware for both sides so wide
 * stacks (size 2-3) never overlap at battle start.
 *
 * Order of slots:
 *   1. Immobile planet defenses first, so they claim the outermost columns
 *      (the defense line sits in front of the planet visual).
 *   2. Mobile stacks next. In planet battles they start one slot column
 *      inward from the last column used by defenses (garrison behind/beside
 *      the turrets); in fleet battles they start at the outermost column.
 *   3. Within a column, rows fill centre-out (DEPLOY_ROW_ORDER).
 *   4. If all slots are taken, any free cell is used, scanning from the
 *      side's own edge inward, so a stack is never left off-grid.
 */
function deploySide(stacks: BattleStack[], columns: number[]): void {
  const occupied = new Set<string>();
  const immobile = stacks.filter((s) => s.immobile);
  const mobile = stacks.filter((s) => !s.immobile);

  let lastImmobileColumn = -1;
  for (const stack of immobile) {
    const used = placeInSlots(stack, columns, 0, occupied);
    lastImmobileColumn = Math.max(lastImmobileColumn, used);
  }
  const mobileStart = Math.min(lastImmobileColumn + 1, columns.length - 1);
  for (const stack of mobile) {
    placeInSlots(stack, columns, Math.max(0, mobileStart), occupied);
  }
}

/* Places the stack in the first free slot from columns[startIndex] onward.
 * Returns the index of the column used, or -1 when the fallback scan had
 * to be used. */
function placeInSlots(
  stack: BattleStack,
  columns: number[],
  startIndex: number,
  occupied: Set<string>,
): number {
  for (let i = startIndex; i < columns.length; i++) {
    for (const row of DEPLOY_ROW_ORDER) {
      if (canPlace(stack, columns[i], row, occupied)) {
        place(stack, columns[i], row, occupied);
        return i;
      }
    }
  }
  placeAnywhere(stack, occupied);
  return -1;
}

function canPlace(stack: BattleStack, col: number, row: number, occupied: Set<string>): boolean {
  return occupiedCols(stack, col).every((c) => isInBounds(c, row) && !occupied.has(cellKey(c, row)));
}

function place(stack: BattleStack, col: number, row: number, occupied: Set<string>): void {
  stack.col = col;
  stack.row = row;
  for (const c of occupiedCols(stack, col)) {
    occupied.add(cellKey(c, row));
  }
}

function placeAnywhere(stack: BattleStack, occupied: Set<string>): void {
  const fromEdge = stack.side === 'attacker';
  for (let k = 0; k < BATTLE_GRID_COLUMNS; k++) {
    const col = fromEdge ? 1 + k : BATTLE_GRID_COLUMNS - k;
    for (let row = 1; row <= BATTLE_GRID_ROWS; row++) {
      if (canPlace(stack, col, row, occupied)) {
        place(stack, col, row, occupied);
        return;
      }
    }
  }
  /* Last resort: keep the stack in bounds even if the grid is full. */
  stack.col = fromEdge ? 1 : BATTLE_GRID_COLUMNS;
  stack.row = DEPLOY_ROW_ORDER[0];
}

function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

/* Initialize x/y vw coordinates for all stacks based on their col/row deployment. */
function initializeStackPositions(stacks: BattleStack[]): void {
  for (const stack of stacks) {
    const center = stackCenterVw(stack);
    stack.x = center.x;
    stack.y = center.y;
  }
}

/* Stack for a side in a deterministic (stackId) order, alive only. */
export function getStacks(state: BattleModelState, side: BattleSide): BattleStack[] {
  return state.stacks
    .filter((s) => s.side === side && !s.destroyed)
    .sort((a, b) => a.stackId.localeCompare(b.stackId));
}

/*
 * The player always controls the 'player' faction. Every other faction
 * (enemies, planet defenses) is driven by the tactical AI.
 */
export function isSidePlayerControlled(state: BattleModelState, side: BattleSide): boolean {
  return (side === 'attacker' ? state.attackerFactionId : state.defenderFactionId) === 'player';
}

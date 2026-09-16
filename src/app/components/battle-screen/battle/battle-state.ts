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
import { ATTACKER_DEPLOY_COLS, DEFENDER_DEPLOY_COLS, BATTLE_CELL_SIZE_VW, BATTLE_GRID_COLUMNS } from './battle.types';
import { getBattleShipStats } from './battle-ship-stats';
import { isInBounds, cellToVw, stackCenterVw } from './battle-grid';

/*
 * =========================================================
 * BATTLE MINIGAME — STATE FACTORY
 * =========================================================
 *
 * Builds the battle-local simulation state from the transport Battle
 * object. Deep-clones both fleets' ships: the overworld Fleet objects
 * passed by StarMap are NEVER mutated. Renders stacks are grouped by
 * side + ship type with a MAX_STACK_SIZE cap and deployed on the grid.
 */

/* Rows filled centre-out from row 4 so stacks cluster around the middle. */
const ROW_ORDER = [4, 3, 5, 2, 6, 1, 7];

export function createBattleState(
  battle: Battle,
  shipService: ShipService,
  planetBattleService: PlanetBattleService,
): BattleModelState {
  const attackerFleet = sideFleet(battle, battle.attackerId);
  const defenderFleet = sideFleet(battle, battle.defenderId);
  const defender = battle.fleet1 === defenderFleet ? battle.fleet1 : battle.fleet2;

  const attackerShips = attackerFleet.ships.map((s) => toBattleShip(s, shipService, planetBattleService));
  const defenderShips = defenderFleet.ships.map((s) => toBattleShip(s, shipService, planetBattleService));

  const attackerStacks = buildStacks('attacker', attackerShips, shipService, planetBattleService);
  const defenderStacks = buildStacks('defender', defenderShips, shipService, planetBattleService);
  deployStacks(attackerStacks, ATTACKER_DEPLOY_COLS);
  deployDefenderStacks(defenderStacks);
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
    effect: null,
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
    defenderShieldPool:
      battle.type === 'planet' && shieldPoolMax > 0
        ? { current: shieldPool, max: shieldPoolMax, regen: shieldPoolRegen }
        : null,
    attackerShips,
    defenderShips,
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
  const maxIndividual = 4 * ROW_ORDER.length;

  if (roster.length <= maxIndividual) {
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
        attackRange: stats.attackRange,
        immobile: stats.immobile,
        moving: false,
        firing: false,
        destroyed: false,
        speed: stats.speed,
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
      });
    }
    return stacks;
  }

  const living = roster.filter((ship) => ship.alive);
  if (living.length === 0) {
    return [];
  }

  const grouped = new Map<string, BattleShip[]>();
  for (const ship of living) {
    const bucket = grouped.get(ship.typeId);
    if (bucket) {
      bucket.push(ship);
    } else {
      grouped.set(ship.typeId, [ship]);
    }
  }

  const stacks: BattleStack[] = [];
  let index = 0;
  for (const [typeId, ships] of grouped) {
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
        attackRange: stats.attackRange,
        immobile: stats.immobile,
        moving: false,
        firing: false,
        destroyed: false,
        speed: stats.speed,
        x: 0,
        y: 0,
        targetX: null,
        targetY: null,
      });
    }
  }
  return stacks;
}

function deployStacks(stacks: BattleStack[], columns: number[]): void {
  stacks.forEach((stack, i) => {
    const colIndex = Math.floor(i / ROW_ORDER.length);
    stack.col = columns[Math.min(colIndex, columns.length - 1)];
    stack.row = ROW_ORDER[i % ROW_ORDER.length];
  });
}

/*
 * Planet-defender deployment: immobile defense stacks claim the outer
 * defender columns first, then garrison stacks fill the remaining defender
 * cells behind them. Fleet-vs-fleet defenders have no immobile stacks, so
 * they keep the original deployStacks() behavior exactly.
 */
function deployDefenderStacks(stacks: BattleStack[]): void {
  const defenseStacks = stacks.filter((s) => s.immobile);
  const garrisonStacks = stacks.filter((s) => !s.immobile);

  if (defenseStacks.length === 0) {
    deployStacks(stacks, DEFENDER_DEPLOY_COLS);
    return;
  }

  const occupied = new Set<string>();
  let defenseColumnIndex = 0;
  let lastDefenseColumnIndex = -1;

  for (const stack of defenseStacks) {
    let placed = false;
    while (!placed && defenseColumnIndex < DEFENDER_DEPLOY_COLS.length) {
      const col = DEFENDER_DEPLOY_COLS[defenseColumnIndex];
      for (const row of ROW_ORDER) {
        if (canPlaceDefenderStack(stack, col, row, occupied)) {
          placeDefenderStack(stack, col, row, occupied);
          lastDefenseColumnIndex = defenseColumnIndex;
          placed = true;
          break;
        }
      }
      if (!placed) {
        defenseColumnIndex++;
      }
    }
    if (!placed) {
      placeDefenderStackAnywhere(stack, occupied);
    }
  }

  const garrisonStartIndex = Math.min(
    lastDefenseColumnIndex + 1,
    DEFENDER_DEPLOY_COLS.length,
  );

  for (const stack of garrisonStacks) {
    let placed = false;
    for (let i = garrisonStartIndex; i < DEFENDER_DEPLOY_COLS.length && !placed; i++) {
      const col = DEFENDER_DEPLOY_COLS[i];
      for (const row of ROW_ORDER) {
        if (canPlaceDefenderStack(stack, col, row, occupied)) {
          placeDefenderStack(stack, col, row, occupied);
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      placeDefenderStackAnywhere(stack, occupied);
    }
  }
}

/* Defender stacks grow left from their anchor column. */
function canPlaceDefenderStack(
  stack: BattleStack,
  col: number,
  row: number,
  occupied: Set<string>,
): boolean {
  for (let offset = 0; offset < stack.size; offset++) {
    const cellCol = col - offset;
    if (!isInBounds(cellCol, row) || occupied.has(cellKey(cellCol, row))) {
      return false;
    }
  }
  return true;
}

function placeDefenderStack(
  stack: BattleStack,
  col: number,
  row: number,
  occupied: Set<string>,
): void {
  stack.col = col;
  stack.row = row;
  for (let offset = 0; offset < stack.size; offset++) {
    occupied.add(cellKey(col - offset, row));
  }
}

function placeDefenderStackAnywhere(stack: BattleStack, occupied: Set<string>): void {
  for (let col = BATTLE_GRID_COLUMNS; col >= 1; col--) {
    for (const row of ROW_ORDER) {
      if (canPlaceDefenderStack(stack, col, row, occupied)) {
        placeDefenderStack(stack, col, row, occupied);
        return;
      }
    }
  }
  /* Last resort: keep a defender stack in bounds even if the grid is full. */
  stack.col = BATTLE_GRID_COLUMNS;
  stack.row = ROW_ORDER[0];
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

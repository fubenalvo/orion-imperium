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
import { ATTACKER_DEPLOY_COLS, DEFENDER_DEPLOY_COLS, ANIMATION_MS } from './battle.types';
import { getBattleShipStats } from './battle-ship-stats';

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
  deployStacks(defenderStacks, DEFENDER_DEPLOY_COLS);

  return {
    round: 1,
    activeSide: 'attacker',
    ap: 50,
    apPerTurn: 50,
    stacks: [...attackerStacks, ...defenderStacks],
    phase: isSidePlayerControlled({ attackerFactionId: attackerFleet.factionId, defenderFactionId: defenderFleet.factionId } as any, 'attacker') ? 'playerTurn' : 'aiTurn',
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
  // Real ships always start a battle at full hull; virtual defense ships
  // carry their pre-set currentHp (PlanetBattleService builds them with
  // hp = attack * 3) because they have no ShipType entry.
  const hp =
    shipService.getShipType(ship.type) != null ? stats.maxHp : (ship.currentHp ?? stats.maxHp);
  return {
    shipId: ship.id,
    name: ship.name,
    typeId: ship.type,
    hp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    alive: true,
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
      const stats = getBattleShipStats(ship.typeId, shipService, planetBattleService);
      const size = stats.tier >= 5 ? 3 : stats.tier >= 3 ? 2 : 1;
      stacks.push({
        stackId: `${side}:${ship.typeId}:${index++}`,
        side,
        typeId: ship.typeId,
        typeName: stats.typeName,
        col: 1,
        row: 1,
        ships: [ship],
        size,
        tier: stats.tier,
        moveApPerCell: stats.moveApPerCell,
        attackAp: stats.attackAp,
        moveRange: stats.moveRange,
        attackRange: stats.attackRange,
        immobile: stats.immobile,
        cellsMovedThisTurn: 0,
        attackedThisTurn: false,
        moving: false,
        firing: false,
        moveMs: ANIMATION_MS.move,
        destroyed: false,
      });
    }
    return stacks;
  }

  const grouped = new Map<string, BattleShip[]>();
  for (const ship of roster) {
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
        col: 1,
        row: 1,
        ships: chunk,
        size,
        tier: stats.tier,
        moveApPerCell: stats.moveApPerCell,
        attackAp: stats.attackAp,
        moveRange: stats.moveRange,
        attackRange: stats.attackRange,
        immobile: stats.immobile,
        cellsMovedThisTurn: 0,
        attackedThisTurn: false,
        moving: false,
        firing: false,
        moveMs: ANIMATION_MS.move,
        destroyed: false,
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

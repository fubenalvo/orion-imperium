import { TestBed } from '@angular/core/testing';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import {
  Battle,
  BattleSide,
  BattleStack,
  FleetShip,
} from './battle.types';
import { createBattleState, getStacks, isSidePlayerControlled } from './battle-state';

describe('battle-state', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
  });

  const fleet = (
    id: number,
    name: string,
    factionId: string,
    ships: FleetShip[],
  ): Battle['fleet1'] => ({ id, name, factionId, ships });

  const battle = (overrides: Partial<Battle> = {}): Battle => ({
    fleet1: fleet(1, 'ORION', 'player', []),
    fleet2: fleet(2, 'RAIDER', 'enemy1', []),
    faction1Name: 'Player',
    faction1Color: '#8cc4ff',
    faction2Name: 'Enemy 1',
    faction2Color: '#d65757',
    attackerId: 1,
    defenderId: 2,
    ...overrides,
  });

  it('does not mutate the input fleet ships', () => {
    const ships: FleetShip[] = [
      { id: 10, name: 'F1', type: 'fighter', currentHp: 40 },
    ];
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);
    state.attackerShips[0].hp = 0;
    state.attackerShips[0].alive = false;
    expect(ships[0].currentHp).toBe(40);
  });

  it('groups same-type ships into stacks capped at MAX_STACK_SIZE', () => {
    const ships: FleetShip[] = Array.from({ length: 12 }, (_, i) => ({
      id: 100 + i,
      name: 'Ftr',
      type: 'fighter',
    }));
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);
    const attackerStacks = getStacks(state, 'attacker');
    expect(attackerStacks).toHaveLength(3);
    expect(attackerStacks.map((s) => s.ships.length).sort()).toEqual([2, 5, 5]);
    expect(attackerStacks.every((s) => s.ships.length <= 5)).toBe(true);
  });

  it('deploys attacker on the left columns and defender on the right', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: fleet(2, 'RAIDER', 'enemy1', [{ id: 2, name: 'R1', type: 'frigate' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const attacker = getStacks(state, 'attacker')[0];
    const defender = getStacks(state, 'defender')[0];
    expect(attacker.col).toBeLessThanOrEqual(3);
    expect(attacker.col).toBeGreaterThanOrEqual(1);
    expect(defender.col).toBeGreaterThanOrEqual(16);

    for (const stack of state.stacks) {
      expect(stack.row).toBeGreaterThanOrEqual(1);
      expect(stack.row).toBeLessThanOrEqual(7);
    }
  });

  it('centres deployment around row 4 and wraps to the next column', () => {
    // 40 fighters of one type => 8 stacks (5 each) spread across the grid.
    const ships: FleetShip[] = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      name: 'Ftr',
      type: 'fighter',
    }));
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);
    const stacks = getStacks(state, 'attacker');
    expect(stacks.length).toBe(8);
    // ROW_ORDER = [4,3,5,2,6,1,7]; the 8th stack (index 7) wraps to col 2.
    expect(stacks[0].row).toBe(4);
    expect(stacks[1].row).toBe(3);
    expect(stacks[7].col).toBe(2);
    expect(stacks[7].row).toBe(4);
  });

  it('resolves stack combat stats from ShipService', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const stack = getStacks(state, 'attacker')[0];
    expect(stack.tier).toBe(1);
    expect(stack.moveRange).toBe(10); // battleMoveRange from ship-data.json
    expect(stack.attackRange).toBe(2);
    expect(stack.ships[0].maxHp).toBe(50);
  });

  it('marks virtual defense ships as immobile in planet battles', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: fleet(2, 'DEFENSE', 'enemy1', [{ id: 2, name: 'Laser', type: 'laser_turret' }]),
      attackerId: 1,
      defenderId: 2,
      type: 'planet',
      planetId: 5,
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const defender = getStacks(state, 'defender')[0];
    expect(defender.immobile).toBe(true);
    expect(defender.moveRange).toBe(0);
  });

  it('isSidePlayerControlled reports faction ownership', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', []),
      fleet2: fleet(2, 'RAIDER', 'enemy1', []),
      attackerId: 1,
      defenderId: 2,
    });
    const state = createBattleState(b, shipService, planetBattleService);
    expect(isSidePlayerControlled(state, 'attacker')).toBe(true);
    expect(isSidePlayerControlled(state, 'defender')).toBe(false);
  });

  it('assigns attackerId/defenderId sides regardless of fleet1/fleet2 order', () => {
    // attacker is fleet2 here
    const b = battle({
      fleet1: fleet(1, 'RAIDER', 'enemy1', [{ id: 5, name: 'R', type: 'fighter' }]),
      fleet2: fleet(2, 'ORION', 'player', [{ id: 6, name: 'F', type: 'fighter' }]),
      attackerId: 2,
      defenderId: 1,
    });
    const state = createBattleState(b, shipService, planetBattleService);
    expect(state.attackerFleetId).toBe(2);
    expect(state.defenderFleetId).toBe(1);
    expect(getStacks(state, 'attacker').length).toBe(1);
    expect(getStacks(state, 'defender').length).toBe(1);
  });
});

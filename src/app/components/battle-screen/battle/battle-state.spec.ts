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

  it('copies shield/shieldRegen from ship data into each BattleShip', () => {
    const ships: FleetShip[] = [
      { id: 10, name: 'F1', type: 'frigate' },
      { id: 11, name: 'F2', type: 'fighter' },
    ];
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);

    // Real ships start with shield fully charged and the overworld
    // FleetShip objects are untouched (no shield property added).
    expect(state.attackerShips[0].maxShield).toBe(80);
    expect(state.attackerShips[0].shield).toBe(80);
    expect(state.attackerShips[0].shieldRegen).toBe(5);
    expect(state.attackerShips[1].maxShield).toBe(30);
    expect(state.attackerShips[1].shield).toBe(30);
    expect(state.attackerShips[1].shieldRegen).toBe(2);
    expect((ships[0] as unknown as Record<string, unknown>)['shield']).toBeUndefined();
  });

  it('gives virtual defense ships zero shield', () => {
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
    expect(defender.ships[0].maxShield).toBe(0);
    expect(defender.ships[0].shield).toBe(0);
    expect(defender.ships[0].shieldRegen).toBe(0);
  });

  it('syncs the shared planetary shield pool from the transport into battle state', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: {
        ...fleet(2, 'DEFENSE', 'enemy1', [{ id: 2, name: 'Laser', type: 'laser_turret' }]),
        shieldPool: 300,
        shieldPoolRegen: 15,
      },
      attackerId: 1,
      defenderId: 2,
      type: 'planet',
      planetId: 5,
      planetName: 'Mars',
      planetColor: '#b35a2a',
    });
    const state = createBattleState(b, shipService, planetBattleService);
    expect(state.battleType).toBe('planet');
    expect(state.planetName).toBe('Mars');
    expect(state.planetColor).toBe('#b35a2a');
    expect(state.defenderShieldPool).toEqual({ current: 300, max: 300, regen: 15 });
  });

  it('keeps fleet battles free of a shared shield pool', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: fleet(2, 'RAIDER', 'enemy1', [{ id: 2, name: 'R1', type: 'frigate' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    expect(state.defenderShieldPool).toBeNull();
  });

  it('deploys immobile defenses outermost and garrison behind them', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: fleet(2, 'DEFENSE', 'enemy1', [
        { id: 2, name: 'Laser 1', type: 'laser_turret' },
        { id: 3, name: 'Laser 2', type: 'laser_turret' },
        { id: 4, name: 'Missile', type: 'missile_turret' },
        { id: 5, name: 'G1', type: 'fighter' },
        { id: 6, name: 'G2', type: 'frigate' },
      ]),
      attackerId: 1,
      defenderId: 2,
      type: 'planet',
      planetId: 5,
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const defenders = getStacks(state, 'defender');
    const turrets = defenders.filter((s) => s.immobile);
    const garrison = defenders.filter((s) => !s.immobile);

    expect(turrets).toHaveLength(3);
    expect(turrets.every((s) => s.col === 18)).toBe(true);
    expect(garrison).toHaveLength(2);
    expect(garrison.every((s) => s.col < 18)).toBe(true);

    const occupied = new Set<string>();
    for (const stack of defenders) {
      for (let offset = 0; offset < stack.size; offset++) {
        const key = `${stack.col - offset}:${stack.row}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
      }
    }
  });

  it('groups same-type ships into stacks capped at MAX_STACK_SIZE', () => {
    const ships: FleetShip[] = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      name: 'Ftr',
      type: 'fighter',
    }));
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);
    const attackerStacks = getStacks(state, 'attacker');
    expect(attackerStacks).toHaveLength(6);
    expect(attackerStacks.map((s) => s.ships.length).sort()).toEqual([5, 5, 5, 5, 5, 5]);
    expect(attackerStacks.every((s) => s.ships.length <= 5)).toBe(true);
  });

  it('places each ship individually when total ships fit in 4 columns', () => {
    const ships: FleetShip[] = Array.from({ length: 12 }, (_, i) => ({
      id: 200 + i,
      name: 'Ftr',
      type: 'fighter',
    }));
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', ships) });
    const state = createBattleState(b, shipService, planetBattleService);
    const attackerStacks = getStacks(state, 'attacker');
    expect(attackerStacks).toHaveLength(12);
    expect(attackerStacks.every((s) => s.ships.length === 1)).toBe(true);
  });

  it('deploys attacker on the left columns and defender on the right', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'fighter' }]),
      fleet2: fleet(2, 'RAIDER', 'enemy1', [{ id: 2, name: 'R1', type: 'frigate' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const attacker = getStacks(state, 'attacker')[0];
    const defender = getStacks(state, 'defender')[0];
    expect(attacker.col).toBeLessThanOrEqual(4);
    expect(attacker.col).toBeGreaterThanOrEqual(1);
    expect(defender.col).toBeGreaterThanOrEqual(15);
    expect(defender.col).toBeLessThanOrEqual(18);

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

  it('copies weapon type and weakness from ship data into each BattleShip', () => {
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [{ id: 1, name: 'F1', type: 'corvette' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    const ship = getStacks(state, 'attacker')[0].ships[0];
    expect(ship.attackType).toBe('energy');
    expect(ship.weakness).toBe('kinetic');
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

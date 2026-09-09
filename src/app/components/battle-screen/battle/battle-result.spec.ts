import { TestBed } from '@angular/core/testing';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { createBattleState } from './battle-state';
import { buildBattleOutcome } from './battle-result';

describe('battle-result', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
  });

  const fleetShip = (id: number, type: string): FleetShip => ({ id, name: `S${id}`, type });

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

  it('preserves input ship order with final HP and destroyed flags', () => {
    const attackerShips: FleetShip[] = [
      { id: 1, name: 'Ftr-1', type: 'fighter' },
      { id: 2, name: 'Ftr-2', type: 'fighter' },
      { id: 3, name: 'Ftr-3', type: 'fighter' },
    ];
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', attackerShips),
      fleet2: fleet(2, 'RAIDER', 'enemy1', [{ id: 9, name: 'R', type: 'frigate' }]),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    state.winner = 'attacker';

    // Simulate damage: kill ship 1, damage ship 2 to 20/50, ship 3 untouched.
    const as = state.attackerShips;
    as[0].hp = 0;
    as[0].alive = false;
    as[1].hp = 20;

    const outcome = buildBattleOutcome(state);
    expect(outcome.attacker.ships.map((s) => s.shipId)).toEqual([1, 2, 3]);
    expect(outcome.attacker.ships.find((s) => s.shipId === 1)!.destroyed).toBe(true);
    expect(outcome.attacker.ships.find((s) => s.shipId === 2)!.hp).toBe(20);
    expect(outcome.attacker.ships.find((s) => s.shipId === 2)!.destroyed).toBe(false);
  });

  it('reports survivors and wipedOut correctly', () => {
    const defenderShips: FleetShip[] = [{ id: 9, name: 'R', type: 'frigate' }];
    const b = battle({
      fleet1: fleet(1, 'ORION', 'player', [fleetShip(1, 'fighter')]),
      fleet2: fleet(2, 'RAIDER', 'enemy1', defenderShips),
    });
    const state = createBattleState(b, shipService, planetBattleService);
    state.winner = 'attacker';
    state.defenderShips[0].hp = 0;
    state.defenderShips[0].alive = false;

    const outcome = buildBattleOutcome(state);
    expect(outcome.defender.wipedOut).toBe(true);
    expect(outcome.defender.survivors).toHaveLength(0);
    expect(outcome.attacker.wipedOut).toBe(false);
    expect(outcome.attacker.survivors).toHaveLength(1);
  });

  it('maps winner/loser ids and battle type', () => {
    const b = battle({ fleet1: fleet(1, 'ORION', 'player', []) });
    const state = createBattleState(b, shipService, planetBattleService);
    state.winner = 'defender';
    const outcome = buildBattleOutcome(state);
    expect(outcome.winnerSide).toBe('defender');
    expect(outcome.winnerFleetId).toBe(2);
    expect(outcome.loserFleetId).toBe(1);
    expect(outcome.battleType).toBe('fleet');
  });

  it('carries planetId for planet battles', () => {
    const b = battle({ type: 'planet', planetId: 7 });
    const state = createBattleState(b, shipService, planetBattleService);
    state.winner = 'attacker';
    const outcome = buildBattleOutcome(state);
    expect(outcome.battleType).toBe('planet');
    expect(outcome.planetId).toBe(7);
  });
});

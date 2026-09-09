import { TestBed } from '@angular/core/testing';
import { BattleService } from './battle.service';
import { Battle, BattleOutcome } from '../components/battle-screen/battle/battle.types';

describe('BattleService (transport boundary)', () => {
  let service: BattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BattleService);
  });

  afterEach(() => {
    service.clearBattle();
  });

  const makeBattle = (overrides: Partial<Battle> = {}): Battle => ({
    fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [] },
    fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: [] },
    faction1Name: 'Player',
    faction1Color: '#8cc4ff',
    faction2Name: 'Enemy 1',
    faction2Color: '#d65757',
    attackerId: 1,
    defenderId: 2,
    ...overrides,
  });

  const makeOutcome = (): BattleOutcome => ({
    winnerSide: 'attacker',
    winnerFleetId: 1,
    loserFleetId: 2,
    attacker: {
      fleetId: 1,
      side: 'attacker',
      factionId: 'player',
      ships: [{ shipId: 1, typeId: 'fighter', name: 'F1', hp: 50, destroyed: false }],
      survivors: [{ shipId: 1, typeId: 'fighter', name: 'F1', hp: 50, destroyed: false }],
      wipedOut: false,
    },
    defender: {
      fleetId: 2,
      side: 'defender',
      factionId: 'enemy1',
      ships: [{ shipId: 2, typeId: 'frigate', name: 'R1', hp: 0, destroyed: true }],
      survivors: [],
      wipedOut: true,
    },
    rounds: 3,
    battleType: 'fleet',
    planetId: undefined,
  });

  it('round-trips a fleet battle', () => {
    const battle = makeBattle();
    service.setBattle(battle);
    expect(service.getBattle()).toEqual(battle);
    expect(service.getBattle()?.type).toBeUndefined();
  });

  it('setPlanetBattle tags the battle as a planet battle', () => {
    service.setPlanetBattle(makeBattle({ type: 'planet', planetId: 4 }));
    expect(service.getBattle()?.type).toBe('planet');
  });

  it('stores and returns a battle result', () => {
    service.setBattleResult(makeOutcome());
    const result = service.getBattleResult();
    expect(result?.winnerSide).toBe('attacker');
    expect(result?.defender.wipedOut).toBe(true);
  });

  it('stores and returns a destroyed fleet id', () => {
    service.setDestroyedFleetId(99);
    expect(service.getDestroyedFleetId()).toBe(99);
  });

  it('clearBattle resets all transport state', () => {
    service.setBattle(makeBattle());
    service.setBattleResult(makeOutcome());
    service.setDestroyedFleetId(99);
    service.clearBattle();
    expect(service.getBattle()).toBeNull();
    expect(service.getBattleResult()).toBeNull();
    expect(service.getDestroyedFleetId()).toBeNull();
  });

  it('setPlanetBattle clears stale result and destroyed id', () => {
    service.setBattleResult(makeOutcome());
    service.setDestroyedFleetId(99);
    service.setPlanetBattle(makeBattle());
    expect(service.getBattleResult()).toBeNull();
    expect(service.getDestroyedFleetId()).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { BattleTurnService } from './battle-turn.service';
import { BattleAnimationService } from './battle-animation.service';

describe('BattleTurnService', () => {
  let turn: BattleTurnService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    turn = TestBed.inject(BattleTurnService);
    anim = TestBed.inject(BattleAnimationService);
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
    vi.useFakeTimers();
  });

  afterEach(() => {
    anim.reset();
    vi.useRealTimers();
  });

  const fleetShip = (id: number, type: string): FleetShip => ({ id, name: `S${id}`, type });

  const setup = (
    attacker: FleetShip[] = [fleetShip(1, 'fighter')],
    defender: FleetShip[] = [fleetShip(100, 'frigate')],
  ): BattleModelState => {
    const state = createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: attacker },
        fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: defender },
        faction1Name: 'Player',
        faction1Color: '#8cc4ff',
        faction2Name: 'Enemy 1',
        faction2Color: '#d65757',
        attackerId: 1,
        defenderId: 2,
      },
      shipService,
      planetBattleService,
    );
    anim.reset();
    return state;
  };

  it('flips the active side and refills AP', () => {
    const state = setup();
    state.ap = 3;
    const ok = turn.endTurn(state);
    expect(ok).toBe(true);
    expect(state.activeSide).toBe('defender');
    expect(state.ap).toBe(state.apPerTurn);
  });

  it('resets per-stack turn counters for the new side', () => {
    const state = setup([fleetShip(1, 'fighter'), fleetShip(2, 'fighter'), fleetShip(3, 'scout')]);
    const attackerStack = getStacks(state, 'attacker')[0];
    attackerStack.cellsMovedThisTurn = 3;
    attackerStack.attackedThisTurn = true;

    turn.endTurn(state);

    for (const stack of state.stacks.filter((s) => s.side === 'defender')) {
      expect(stack.cellsMovedThisTurn).toBe(0);
      expect(stack.attackedThisTurn).toBe(false);
    }
    // attacker counters are not reset when they are not the active side
    expect(attackerStack.cellsMovedThisTurn).toBe(3);
  });

  it('increments round only when control returns to the attacker', () => {
    const state = setup();
    expect(state.round).toBe(1);
    turn.endTurn(state); // -> defender
    expect(state.round).toBe(1);
    turn.endTurn(state); // -> attacker
    expect(state.round).toBe(2);
  });

  it('sets aiTurn phase when the new side is not player-controlled', () => {
    const state = setup();
    turn.endTurn(state); // attacker(player) -> defender(enemy1, AI)
    expect(state.phase).toBe('aiTurn');
  });

  it('rejects endTurn while an animation is in flight', () => {
    const state = setup();
    anim.begin();
    const result = turn.endTurn(state);
    expect(result).toBe(false);
    anim.end();
  });

  it('detects victory when one side has no alive stacks', () => {
    const state = setup();
    // Wipe the attacker to give the defender a free win.
    state.stacks.filter((s) => s.side === 'attacker').forEach((s) => (s.destroyed = true));
    expect(turn.checkVictory(state)).toBe(true);
    expect(state.winner).toBe('defender');
    expect(state.phase).toBe('over');
  });
});

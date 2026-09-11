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

  /*
   * Shield regeneration. The newly-active side's living ships recover
   * shieldRegen per turn, capped at maxShield. Destroyed ships and the
   * inactive side are skipped. HP, AP, movement, combat, and AI are all
   * untouched.
   */
  it('regenerates the active side shield by shieldRegen, capped at maxShield', () => {
    // Fighter: shield 30, shieldRegen 2, maxShield 30.
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const defender = getStacks(state, 'defender')[0];
    defender.ships[0].shield = 50;

    turn.endTurn(state); // active becomes defender

    expect(state.activeSide).toBe('defender');
    expect(defender.ships[0].shield).toBe(55); // 50 + 5 (frigate regen)
  });

  it('caps regeneration at maxShield', () => {
    // Frigate: shield 80, shieldRegen 5, maxShield 80.
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const defender = getStacks(state, 'defender')[0];
    defender.ships[0].shield = 78;

    turn.endTurn(state); // active becomes defender

    expect(defender.ships[0].shield).toBe(80); // 78 + 5 capped at 80
  });

  it('does not regenerate the inactive side', () => {
    // Fighter: shield 30, shieldRegen 2, maxShield 30.
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const attacker = getStacks(state, 'attacker')[0];
    attacker.ships[0].shield = 10;

    turn.endTurn(state); // active becomes defender; attacker is now inactive

    expect(attacker.ships[0].shield).toBe(10); // untouched
  });

  it('does not regenerate destroyed ships', () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const defender = getStacks(state, 'defender')[0];
    defender.ships[0].shield = 40;
    defender.ships[0].alive = false;

    turn.endTurn(state); // active becomes defender

    expect(defender.ships[0].shield).toBe(40); // dead ship, no regen
  });

  it('leaves ships with no shield data unchanged', () => {
    // Laser turret: shield 0, shieldRegen 0, maxShield 0 (virtual defense).
    const state = setup(
      [fleetShip(1, 'fighter')],
      [fleetShip(100, 'laser_turret')],
    );
    const defender = getStacks(state, 'defender')[0];

    turn.endTurn(state); // active becomes defender

    expect(defender.ships[0].shield).toBe(0);
    expect(defender.ships[0].shieldRegen).toBe(0);
  });

  it('applies regeneration before the turn-counter reset', () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const defender = getStacks(state, 'defender')[0];
    defender.ships[0].shield = 50;
    defender.cellsMovedThisTurn = 5;
    defender.attackedThisTurn = true;

    turn.endTurn(state); // active becomes defender

    expect(defender.ships[0].shield).toBe(55); // regen applied
    expect(defender.cellsMovedThisTurn).toBe(0); // counters reset
    expect(defender.attackedThisTurn).toBe(false);
  });

  /*
   * Shared planetary shield. The pool is planet-battle only and regenerates
   * at the start of the defender's turn, capped at its max. Attacker turns
   * must never touch it.
   */
  const planetSetup = (shieldPool: number, shieldPoolRegen: number): BattleModelState => {
    const state = createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
        fleet2: {
          id: -5,
          name: 'DEFENSE',
          factionId: 'enemy1',
          ships: [fleetShip(100, 'laser_turret')],
          shieldPool,
          shieldPoolRegen,
        },
        faction1Name: 'Player',
        faction1Color: '#8cc4ff',
        faction2Name: 'Enemy 1',
        faction2Color: '#d65757',
        attackerId: 1,
        defenderId: -5,
        type: 'planet',
        planetId: 5,
      },
      shipService,
      planetBattleService,
    );
    anim.reset();
    return state;
  };

  it('regenerates the shared planetary shield at the start of the defender turn', () => {
    const state = planetSetup(300, 15);
    state.defenderShieldPool!.current = 100;

    turn.endTurn(state); // attacker -> defender

    expect(state.activeSide).toBe('defender');
    expect(state.defenderShieldPool?.current).toBe(115);
  });

  it('caps shared planetary shield regen at its max', () => {
    const state = planetSetup(300, 15);
    state.defenderShieldPool!.current = 295;

    turn.endTurn(state); // attacker -> defender

    expect(state.defenderShieldPool?.current).toBe(300);
  });

  it('does not regenerate the shared planetary shield on the attacker turn', () => {
    const state = planetSetup(300, 15);
    state.defenderShieldPool!.current = 100;
    state.activeSide = 'defender';

    turn.endTurn(state); // defender -> attacker

    expect(state.activeSide).toBe('attacker');
    expect(state.defenderShieldPool?.current).toBe(100);
  });
});

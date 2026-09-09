import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { BattleAiService } from './battle-ai.service';
import { BattleMovementService } from './battle-movement.service';
import { BattleCombatService } from './battle-combat.service';
import { BattleTurnService } from './battle-turn.service';
import { BattleAnimationService } from './battle-animation.service';
import { ANIMATION_MS } from './battle.types';

describe('BattleAiService', () => {
  let ai: BattleAiService;
  let movement: BattleMovementService;
  let combat: BattleCombatService;
  let turn: BattleTurnService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ai = TestBed.inject(BattleAiService);
    movement = TestBed.inject(BattleMovementService);
    combat = TestBed.inject(BattleCombatService);
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

  // attacker = AI (enemy1), defender = player. AI controls the attacker side.
  const setup = (attacker: FleetShip[], defender: FleetShip[]): BattleModelState => {
    const state = createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'enemy1', ships: attacker },
        fleet2: { id: 2, name: 'RAIDER', factionId: 'player', ships: defender },
        faction1Name: 'AI',
        faction1Color: '#d65757',
        faction2Name: 'Player',
        faction2Color: '#8cc4ff',
        attackerId: 1,
        defenderId: 2,
      },
      shipService,
      planetBattleService,
    );
    anim.reset();
    state.activeSide = 'attacker';
    return state;
  };

  const flush = async (): Promise<void> => {
    // Large enough to drain any single command's animation chain. Each
    // command is individually awaited by the AI, so a single big advance
    // per flush is safe under fake timers (no real time elapses).
    await vi.advanceTimersByTimeAsync(5000);
  };

  it('attacks an in-range enemy and ends its turn', async () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 2; // within range 2

    const p = ai.playTurn(state);
    await flush();
    await p;

    expect(atk.attackedThisTurn).toBe(true);
    expect(state.log.length).toBe(1);
    expect(state.activeSide).toBe('defender');
  });

  it('moves toward the nearest enemy when out of range then attacks', async () => {
    // Dreadnought (range 5, speed 1, tier 5, attackAp 5) vs fighter 7 cells away.
    const state = setup([fleetShip(1, 'dreadnought')], [fleetShip(100, 'fighter')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 7;

    const p = ai.playTurn(state);
    await flush();
    await p;

    // After moving 1 cell (speed), range is 6 — still out of range 5.
    expect(atk.attackedThisTurn).toBe(false);
    expect(state.log.length).toBe(0);
    // Turn still ends for the AI side.
    expect(state.activeSide).toBe('defender');
  });

  it('does not move immobile planet-defense stacks', async () => {
    // AI controls the defender (planet) side vs player attacker.
    const state = createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(1, 'fighter')] },
        fleet2: {
          id: -5,
          name: 'PLANET',
          factionId: 'enemy1',
          ships: [fleetShip(100, 'laser_turret')],
        },
        faction1Name: 'Player',
        faction1Color: '#8cc4ff',
        faction2Name: 'Defense',
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
    state.attackerFactionId = 'player';
    state.defenderFactionId = 'enemy1';
    state.activeSide = 'defender'; // defender is the AI side here

    const turret = state.stacks.find((s) => s.side === 'defender')!;
    const before = { col: turret.col, row: turret.row };
    const p = ai.playTurn(state);
    await flush();
    await p;

    expect(turret.immobile).toBe(true);
    expect(turret.col).toBe(before.col);
    expect(turret.row).toBe(before.row);
  });

  it('is deterministic: same state yields the same number of log entries', async () => {
    const make = (): BattleModelState => {
      const s = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
      const def = getStacks(s, 'defender')[0];
      def.col = s.stacks[0].col + 2;
      return s;
    };

    const s1 = make();
    const p1 = ai.playTurn(s1);
    await flush();
    await p1;

    const s2 = make();
    const p2 = ai.playTurn(s2);
    await flush();
    await p2;

    expect(s2.log.length).toBe(s1.log.length);
  });

  it('never spends more AP than the turn pool', async () => {
    const state = setup(
      Array.from({ length: 3 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'frigate'), fleetShip(101, 'frigate')],
    );
    const p = ai.playTurn(state);
    await flush();
    await p;

    expect(state.ap).toBeGreaterThanOrEqual(0);
    expect(state.ap).toBeLessThanOrEqual(state.apPerTurn);
    // The active side must have flipped back to the player (defender).
    expect(state.activeSide).toBe('defender');
  });
});

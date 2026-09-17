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
import { BattleAnimationService } from './battle-animation.service';

describe('BattleAiService', () => {
  let ai: BattleAiService;
  let movement: BattleMovementService;
  let combat: BattleCombatService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    ai = TestBed.inject(BattleAiService);
    movement = TestBed.inject(BattleMovementService);
    combat = TestBed.inject(BattleCombatService);
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

  // AI controls the attacker side (enemy1). Player controls defender.
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
    return state;
  };

  // Advance time to drain any animation timers (projectile + hit/explosion chain).
  // A single large advance covers all chained setTimeouts.
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(10000);
  };

  it('attacks an in-range enemy', async () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 2; // within range 2

    const p = ai.playAction(state);
    await flush();
    const result = await p;

    expect(result).toBe(true);
    expect(state.log.length).toBe(1);
    expect(state.log[0].defenderStack).toBe(def.stackId);
  });

  it('moves toward the nearest enemy when out of range', async () => {
    const state = setup([fleetShip(1, 'destroyer')], [fleetShip(100, 'fighter')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 7;

    const originalCol = atk.col;
    const p = ai.playAction(state);
    await flush();
    const result = await p;

    expect(result).toBe(true);
    // After moving, the stack's target col should have changed.
    expect(atk.targetX).not.toBeNull();
  });

  it('does not move immobile planet-defense stacks', async () => {
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

    const turret = state.stacks.find((s) => s.side === 'defender')!;
    const before = { col: turret.col, row: turret.row };
    const p = ai.playAction(state);
    await flush();
    const result = await p;

    // Immobile turrets can't move; no player-side stacks to attack either
    // (attacker is player, defender is immobile) — so no action.
    expect(result).toBe(false);
    expect(turret.immobile).toBe(true);
    expect(turret.col).toBe(before.col);
    expect(turret.row).toBe(before.row);
  });

  it('is deterministic: same state yields the same log entry', async () => {
    const make = (): BattleModelState => {
      const s = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
      const def = getStacks(s, 'defender')[0];
      def.col = s.stacks[0].col + 2;
      return s;
    };

    const s1 = make();
    const p1 = ai.playAction(s1);
    await flush();
    await p1;

    const s2 = make();
    const p2 = ai.playAction(s2);
    await flush();
    await p2;

    expect(s2.log.length).toBe(s1.log.length);
    if (s1.log.length > 0) {
      expect(s2.log[0].defenderStack).toBe(s1.log[0].defenderStack);
    }
  });

  /*
   * Role-aware target selection. bestTarget() scores in-range candidates by
   * target role priority + threat weight + distance, then stackId. It is
   * pure and deterministic — no randomness, no lookahead.
   */
  it('prefers a high-value target over a nearer low-value one', async () => {
    const state = setup([fleetShip(1, 'destroyer')], [
      fleetShip(100, 'dreadnought'),
      fleetShip(101, 'colonizer'),
    ]);
    const atk = getStacks(state, 'attacker')[0];
    const dread = getStacks(state, 'defender').find((s) => s.typeId === 'dreadnought')!;
    const colonizer = getStacks(state, 'defender').find((s) => s.typeId === 'colonizer')!;
    colonizer.col = atk.col + 1;
    dread.col = atk.col + 2;

    const p = ai.playAction(state);
    await flush();
    await p;

    expect(state.log[0].defenderStack).toBe(dread.stackId);
  });

  it('prefers the nearest when threat scores are equal', async () => {
    const state = setup([fleetShip(1, 'fighter')], [
      fleetShip(100, 'frigate'),
      fleetShip(101, 'frigate'),
    ]);
    const atk = getStacks(state, 'attacker')[0];
    const near = getStacks(state, 'defender').find((s) => s.stackId < getStacks(state, 'defender')[1].stackId)!;
    const far = getStacks(state, 'defender').find((s) => s.stackId !== near.stackId)!;
    near.col = atk.col + 1;
    far.col = atk.col + 2;

    const p = ai.playAction(state);
    await flush();
    await p;

    expect(state.log[0].defenderStack).toBe(near.stackId);
  });

  it('returns false when no action is possible', async () => {
    // All AI stacks are moving — no action possible
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    atk.moving = true;
    const result = await ai.playAction(state);
    expect(result).toBe(false);
  });

  it('returns false when the animation is busy', async () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    anim.begin(atk.stackId);
    const result = await ai.playAction(state);
    expect(result).toBe(false);
    anim.end(atk.stackId);
  });
});

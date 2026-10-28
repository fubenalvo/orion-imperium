import { TestBed } from '@angular/core/testing';
import { BattleTimeService } from './battle-time.service';
import { startBattleTestClock } from './battle-test-clock';
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
import { stackCenterVw } from './battle-grid';

describe('BattleAiService', () => {
  let stopClock: () => void = () => {};
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
    stopClock = startBattleTestClock(TestBed.inject(BattleTimeService));
  });

  afterEach(() => {
    anim.reset();
    stopClock();
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

  const syncPosition = (stack: BattleStack): void => {
    const center = stackCenterVw({
      side: stack.side,
      size: stack.size,
      col: stack.col,
      row: stack.row,
    } as BattleStack);
    stack.x = center.x;
    stack.y = center.y;
  };

  // Advance time to drain any animation timers (projectile + hit/explosion chain).
  // A single large advance covers all chained setTimeouts.
  const flush = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(10000);
  };

  /*
   * The AI only decides movement and Carrier Shield Pulse. Firing belongs
   * to BattleCombatService.runFireControl (see battle-combat.service.spec)
   * and target scoring to battle-targeting (see battle-targeting.spec).
   */
  it('holds position and never fires itself when an enemy is already in reach', async () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 2;
    syncPosition(def);

    const p = ai.playAction(state);
    await flush();
    const result = await p;

    expect(result).toBe(false);
    expect(state.log).toHaveLength(0);
    expect(atk.targetX).toBeNull();
  });

  it('moves toward the nearest enemy when out of reach', async () => {
    const state = setup([fleetShip(1, 'destroyer')], [fleetShip(100, 'fighter')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 16;
    syncPosition(def);

    const p = ai.playAction(state);
    await flush();
    const result = await p;

    expect(result).toBe(true);
    expect(atk.targetX).not.toBeNull();
    expect(atk.targetX!).toBeGreaterThan(atk.x);
    expect(atk.moveToAttackTargetId).toBe(def.stackId);
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

    expect(result).toBe(false);
    expect(turret.immobile).toBe(true);
    expect(turret.col).toBe(before.col);
    expect(turret.row).toBe(before.row);
  });

  it('commands every idle stack in one tick, not just the first', async () => {
    const state = setup(
      [fleetShip(1, 'destroyer'), fleetShip(2, 'destroyer'), fleetShip(3, 'destroyer')],
      [fleetShip(100, 'fighter')],
    );
    const def = getStacks(state, 'defender')[0];
    def.col = 38;
    def.row = 8;
    syncPosition(def);

    const p = ai.playAction(state);
    await flush();
    await p;

    for (const stack of getStacks(state, 'attacker')) {
      expect(stack.moveToAttackTargetId).toBe(def.stackId);
      expect(stack.actionCooldownUntil).toBeGreaterThan(0);
    }
  });

  it('is deterministic: the same state yields the same destination', async () => {
    const make = (): BattleModelState => {
      const s = setup([fleetShip(1, 'destroyer')], [fleetShip(100, 'fighter')]);
      const def = getStacks(s, 'defender')[0];
      def.col = s.stacks[0].col + 16;
      syncPosition(def);
      return s;
    };

    const s1 = make();
    await ai.playAction(s1);
    const s2 = make();
    await ai.playAction(s2);

    expect(s2.stacks[0].targetX).toBe(s1.stacks[0].targetX);
    expect(s2.stacks[0].targetY).toBe(s1.stacks[0].targetY);
  });

  it('returns false when no action is possible', async () => {
    // All AI stacks are moving — no action possible
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    atk.moving = true;
    const result = await ai.playAction(state);
    expect(result).toBe(false);
  });

  /*
   * AUTO battle: playAction(state, true) drives ONLY the player side, and
   * never a player stack that holds a manual order.
   */
  it('AUTO pass drives only player stacks and never ones with a manual order', async () => {
    // In this setup the defender is the player side.
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'destroyer'), fleetShip(101, 'destroyer')]);
    const enemy = getStacks(state, 'attacker')[0];
    const [free, ordered] = getStacks(state, 'defender');
    enemy.col = 2;
    enemy.row = 8;
    syncPosition(enemy);
    ordered.explicitAttackTargetId = enemy.stackId;

    await ai.playAction(state, true);

    expect(free.moveToAttackTargetId).toBe(enemy.stackId);
    expect(ordered.actionCooldownUntil).toBeUndefined();
    expect(ordered.targetX).toBeNull();
    // The enemy (non-player) stack was not commanded by the AUTO pass.
    expect(enemy.actionCooldownUntil).toBeUndefined();
  });

  it('AUTO pass leaves a stack with an in-flight manual move alone', async () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(100, 'destroyer')]);
    const mine = getStacks(state, 'defender')[0];
    mine.manualMoveOrder = true;

    const result = await ai.playAction(state, true);

    expect(result).toBe(false);
    expect(mine.actionCooldownUntil).toBeUndefined();
  });
});

import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { BattleCombatService } from './battle-combat.service';
import { BattleAnimationService } from './battle-animation.service';
import { ANIMATION_MS } from './battle.types';
import { stackCenterVw } from './battle-grid';

describe('BattleCombatService', () => {
  let combat: BattleCombatService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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

  const battle = (attacker: FleetShip[], defender: FleetShip[]): Battle => ({
    fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: attacker },
    fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: defender },
    faction1Name: 'Player',
    faction1Color: '#8cc4ff',
    faction2Name: 'Enemy 1',
    faction2Color: '#d65757',
    attackerId: 1,
    defenderId: 2,
  });

  const setup = (attacker: FleetShip[], defender: FleetShip[]): BattleModelState => {
    const state = createBattleState(battle(attacker, defender), shipService, planetBattleService);
    anim.reset();
    return state;
  };

  const placeAdjacent = (atker: BattleStack, defender: BattleStack): void => {
    defender.col = atker.col + Math.min(atker.attackRange, 3);
    defender.row = atker.row;
    const center = stackCenterVw({
      side: defender.side,
      size: defender.size,
      col: defender.col,
      row: defender.row,
    } as BattleStack);
    defender.x = center.x;
    defender.y = center.y;
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

  const mergeSameTypeStacks = (state: BattleModelState, side: 'attacker' | 'defender'): BattleStack => {
    const stacks = getStacks(state, side);
    const merged = stacks[0];
    for (let i = 1; i < stacks.length; i++) {
      for (const ship of stacks[i].ships) {
        merged.ships.push(ship);
      }
    }
    return merged;
  };

  it('applies max(1, totalAttack - frontDefense) to the front shield', async () => {
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'frigate')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    const shieldBefore = def.ships[0].shield!;
    const hpBefore = def.ships[0].hp;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].shield).toBe(shieldBefore - 67);
    expect(def.ships[0].hp).toBe(hpBefore);
    expect(def.ships[0].alive).toBe(true);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].kills).toBe(0);
  });

  it('spills overkill across a defender stack until a ship dies', async () => {
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'scout'), fleetShip(101, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = mergeSameTypeStacks(state, 'defender');
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    const dead = def.ships.filter((s) => !s.alive);
    const wounded = def.ships.filter(
      (s) => s.alive && (s.hp < s.maxHp || (s.shield ?? 0) < (s.maxShield ?? 0)),
    );
    expect(dead).toHaveLength(1);
    expect(wounded).toHaveLength(1);
    expect(wounded[0].hp).toBe(11);
    expect(wounded[0].shield).toBe(0);
    expect(state.log[0].kills).toBe(1);
  });

  it('destroys a stack when all its ships die and triggers victory', async () => {
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await p;

    expect(def.destroyed).toBe(true);
    expect(state.winner).toBe('attacker');
    expect(state.log[0].kills).toBe(1);
  });

  it('runs the projectile -> impact -> clear effect lifecycle with ticks', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    let tickCount = 0;
    const sub = anim.ticks$.subscribe(() => tickCount++);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    expect(state.effect?.phase).toBe('impact');
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    expect(state.effect).toBeNull();
    await p;

    expect(tickCount).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('rejects attacks from out of range', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    def.col = atk.col + 10;

    const result = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(result).toBe(false);
    expect(state.log).toHaveLength(0);
  });

  it('rejects attacking a same-side stack', async () => {
    const state = setup(
      [fleetShip(0, 'fighter'), fleetShip(1, 'scout')],
      [fleetShip(100, 'frigate')],
    );
    const atk = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    const buddy = getStacks(state, 'attacker').find((s) => s.typeId === 'scout')!;
    const result = await combat.attackStack(state, atk.stackId, buddy.stackId);
    expect(result).toBe(false);
    expect(state.log).toHaveLength(0);
  });

  it('allows a second attack after the first one completes', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const inFlight = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await inFlight;

    const result = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    expect(await result).toBe(true);
  });

  it('allows concurrent attacks from different stacks', async () => {
    const state = setup(
      [fleetShip(0, 'fighter'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const atk1 = getStacks(state, 'attacker')[0];
    const atk2 = getStacks(state, 'attacker')[1];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk1, def);
    placeAdjacent(atk2, def);

    const hpBefore = def.ships[0].hp;
    const shieldBefore = def.ships[0].shield ?? 0;

    const attack1 = combat.attackStack(state, atk1.stackId, def.stackId);
    const attack2 = combat.attackStack(state, atk2.stackId, def.stackId);

    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await attack1;
    await attack2;

    const totalDamage = (hpBefore - def.ships[0].hp) + (shieldBefore - (def.ships[0].shield ?? 0));
    expect(totalDamage).toBeGreaterThan(0);
  });

  it('allows attacks while the stack is moving', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    atk.moving = true;

    const hpBefore = def.ships[0].hp;
    const shieldBefore = def.ships[0].shield ?? 0;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    const result = await p;

    expect(result).toBe(true);
    const totalAfter = def.ships[0].hp + (def.ships[0].shield ?? 0);
    expect(totalAfter).toBeLessThan(hpBefore + shieldBefore);
  });

  it('absorbs damage completely with a full shield', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    const shieldBefore = def.ships[0].shield!;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].shield).toBe(shieldBefore - 7);
    expect(def.ships[0].hp).toBe(def.ships[0].maxHp);
    expect(def.ships[0].alive).toBe(true);
    expect(state.log[0].kills).toBe(0);
  });

  it('depletes the shield and applies overflow to hull HP', async () => {
    const state = setup(
      [fleetShip(0, 'cruiser'), fleetShip(1, 'cruiser'), fleetShip(2, 'cruiser')],
      [fleetShip(100, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 20;
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await p;

    expect(def.ships[0].shield).toBe(0);
    expect(def.ships[0].hp).toBe(0);
    expect(def.ships[0].alive).toBe(false);
    expect(def.destroyed).toBe(true);
    expect(state.log[0].kills).toBe(1);
  });

  it('deletes a ship when damage exceeds shield plus hull HP', async () => {
    const state = setup(
      [fleetShip(0, 'cruiser'), fleetShip(1, 'cruiser'), fleetShip(2, 'cruiser')],
      [fleetShip(100, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 20;
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await p;

    expect(def.ships[0].shield).toBe(0);
    expect(def.ships[0].hp).toBe(0);
    expect(def.ships[0].alive).toBe(false);
    expect(def.destroyed).toBe(true);
    expect(state.winner).toBe('attacker');
    expect(state.log[0].kills).toBe(1);
  });

  it('treats a zero shield as no shield and applies full damage to hull', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'scout')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0;
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].shield).toBe(0);
    expect(def.ships[0].hp).toBe(21);
    expect(def.ships[0].alive).toBe(true);
    expect(state.log[0].kills).toBe(0);
  });

  it('applies shield to each ship in order across a multi-ship stack', async () => {
    const state = setup(
      [fleetShip(0, 'cruiser'), fleetShip(1, 'cruiser'), fleetShip(2, 'cruiser')],
      [fleetShip(100, 'scout'), fleetShip(101, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = mergeSameTypeStacks(state, 'defender');
    placeAdjacent(atk, def);
    def.ships[0].shield = 20;
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;
    def.ships[1].shield = 10;
    def.ships[1].hp = 60;
    def.ships[1].maxHp = 60;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].shield).toBe(0);
    expect(def.ships[0].hp).toBe(0);
    expect(def.ships[0].alive).toBe(false);
    expect(def.ships[1].shield).toBe(0);
    expect(def.ships[1].hp).toBe(41);
    expect(def.ships[1].alive).toBe(true);
    expect(def.destroyed).toBe(false);
    expect(state.winner).toBeNull();
    expect(state.log[0].kills).toBe(1);
  });

  it('applies a strong (1.5x) multiplier for the strong matchup', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'scout')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0;
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].hp).toBe(21);
    expect(state.log[0].damage).toBe(19);
  });

  it('applies a neutral (1.0x) multiplier with no relationship', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0;
    def.ships[0].hp = 130;
    def.ships[0].maxHp = 130;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].hp).toBe(123);
    expect(state.log[0].damage).toBe(7);
  });

  it('applies a resistant (0.5x) multiplier when the target weakness resists the weapon', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'corvette')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0;
    def.ships[0].hp = 90;
    def.ships[0].maxHp = 90;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].hp).toBe(85);
    expect(state.log[0].damage).toBe(5);
  });

  it('projectile targets the target current visual position, not stale col/row', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    /*
     * Simulate the defender being mid-movement: its x/y have moved
     * away from its col/row grid cell center. The projectile should
     * aim at the current visual position (def.x/def.y), not the
     * stale cell center (stackCenterVw output).
     */
    def.col = atk.col + 1;
    def.row = atk.row;
    syncPosition(def);
    const movedX = def.x + 2.5;
    const movedY = def.y + 1.5;
    def.x = movedX;
    def.y = movedY;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    /* Advance past the projectile phase so the effect is active,
     * but before the animation clears it. */
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile + 1);
    expect(state.effect).not.toBeNull();
    expect(state.effect!.phase).toBe('impact');
    expect(state.effect!.to.x).toBe(movedX);
    expect(state.effect!.to.y).toBe(movedY);
    await vi.advanceTimersByTimeAsync(5000);
    await p;
  });

  it('still floors damage to at least 1 after applying the multiplier', async () => {
    const state = setup([fleetShip(0, 'colonizer')], [fleetShip(100, 'corvette')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0;
    def.ships[0].hp = 90;
    def.ships[0].maxHp = 90;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(state.log[0].damage).toBe(1);
    expect(def.ships[0].hp).toBe(89);
  });

  /*
   * Carrier Shield Pulse. The Carrier uses its action to restore
   * shieldRegen to every friendly stack within its attack range,
   * capped at each ship's maxShield. Deterministic and non-damage —
   * it reuses the same action gates (firing / moving lock) as a normal attack.
   */
  it('restores shieldRegen to a damaged friendly stack in range', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 3;
    ally.row = carrier.row;
    syncPosition(ally);
    ally.ships[0].shield = 10;
    ally.ships[0].maxShield = 30;

    const ok = combat.carrierShieldBoost(state, carrier.stackId);
    expect(ok).toBe(true);
    expect(ally.ships[0].shield).toBe(16);
  });

  it('caps the boost at each ship maxShield', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 3;
    ally.row = carrier.row;
    syncPosition(ally);
    ally.ships[0].shield = 28;
    ally.ships[0].maxShield = 30;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(ally.ships[0].shield).toBe(30);
  });

  it('does not affect the Carrier itself', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 3;
    ally.row = carrier.row;
    syncPosition(ally);
    carrier.ships[0].shield = 100;
    carrier.ships[0].maxShield = 220;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(carrier.ships[0].shield).toBe(100);
  });

  it('does not affect stacks out of range', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 10;
    ally.row = carrier.row;
    syncPosition(ally);
    ally.ships[0].shield = 10;
    ally.ships[0].maxShield = 30;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(ally.ships[0].shield).toBe(10);
  });

  it('does not affect enemy stacks', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const enemy = getStacks(state, 'defender')[0];
    enemy.col = carrier.col + 3;
    enemy.row = carrier.row;
    syncPosition(enemy);
    enemy.ships[0].shield = 50;
    enemy.ships[0].maxShield = 80;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(enemy.ships[0].shield).toBe(50);
  });

  it('returns false for a non-Carrier stack', () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    expect(combat.carrierShieldBoost(state, atk.stackId)).toBe(false);
  });

  it('returns false when the stack is firing', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    carrier.firing = true;
    expect(combat.carrierShieldBoost(state, carrier.stackId)).toBe(false);
  });

  /*
   * Shared planetary shield. In planet battles, immobile defense stacks
   * are protected by one pool before their own per-ship shields. Garrison
   * stacks keep their normal per-ship shields and never touch the pool.
   */
  const planetSetup = (defender: FleetShip[], shieldPool: number, shieldPoolRegen: number): BattleModelState => {
    const state = createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: [fleetShip(0, 'fighter')] },
        fleet2: {
          id: -5,
          name: 'DEFENSE',
          factionId: 'enemy1',
          ships: defender,
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

  it('absorbs turret damage with the shared planetary shield before hull HP', async () => {
    const state = planetSetup([fleetShip(100, 'laser_turret')], 300, 15);
    const atk = getStacks(state, 'attacker')[0];
    const turret = getStacks(state, 'defender')[0];
    placeAdjacent(atk, turret);
    const hpBefore = turret.ships[0].hp;

    const p = combat.attackStack(state, atk.stackId, turret.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    const damage = state.log[0].damage;
    expect(damage).toBeGreaterThan(0);
    expect(state.defenderShieldPool?.current).toBe(300 - damage);
    expect(turret.ships[0].hp).toBe(hpBefore);
    expect(state.log[0].kills).toBe(0);
  });

  it('spills shared-shield overflow into turret hull HP', async () => {
    const state = planetSetup([fleetShip(100, 'laser_turret')], 1, 15);
    const atk = getStacks(state, 'attacker')[0];
    const turret = getStacks(state, 'defender')[0];
    placeAdjacent(atk, turret);
    const hpBefore = turret.ships[0].hp;

    const p = combat.attackStack(state, atk.stackId, turret.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    const damage = state.log[0].damage;
    expect(state.defenderShieldPool?.current).toBe(0);
    expect(turret.ships[0].hp).toBe(hpBefore - Math.max(0, damage - 1));
  });

  it('does not protect mobile garrison stacks with the shared planetary shield', async () => {
    const state = planetSetup([fleetShip(100, 'laser_turret'), fleetShip(101, 'fighter')], 300, 15);
    const atk = getStacks(state, 'attacker')[0];
    const garrison = getStacks(state, 'defender').find((s) => !s.immobile)!;
    placeAdjacent(atk, garrison);

    const p = combat.attackStack(state, atk.stackId, garrison.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(state.defenderShieldPool?.current).toBe(300);
    expect(garrison.ships[0].hp + (garrison.ships[0].shield ?? 0)).toBeLessThan(
      garrison.ships[0].maxHp + (garrison.ships[0].maxShield ?? 0),
    );
  });

  it('depletes the shared planetary shield over multiple attacks', async () => {
    const state = planetSetup([fleetShip(100, 'laser_turret')], 30, 0);
    const atk = getStacks(state, 'attacker')[0];
    const turret = getStacks(state, 'defender')[0];
    placeAdjacent(atk, turret);
    expect(state.defenderShieldPool?.current).toBe(30);

    const p1 = combat.attackStack(state, atk.stackId, turret.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await p1;

    const shieldAfterFirst = state.defenderShieldPool?.current ?? 0;
    expect(shieldAfterFirst).toBeLessThan(30);

    const p2 = combat.attackStack(state, atk.stackId, turret.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await p2;

    expect(state.defenderShieldPool?.current ?? 0).toBeLessThan(shieldAfterFirst);
  });

  it('planet with no turret stacks: attacking a nonexistent target returns false', async () => {
    const state = planetSetup([], 300, 15);
    const atk = getStacks(state, 'attacker')[0];
    expect(getStacks(state, 'defender')).toHaveLength(0);

    const result = await combat.attackStack(state, atk.stackId, 'nonexistent');
    expect(result).toBe(false);
  });

  it('planet battle without shield: no pool, turret takes full damage', async () => {
    const state = planetSetup([fleetShip(100, 'laser_turret')], 0, 0);
    const atk = getStacks(state, 'attacker')[0];
    const turret = getStacks(state, 'defender')[0];
    placeAdjacent(atk, turret);

    expect(state.defenderShieldPool).toBeNull();

    const p = combat.attackStack(state, atk.stackId, turret.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(state.log[0].damage).toBeGreaterThan(0);
    expect(turret.ships[0].hp).toBeLessThan(100);
  });
});

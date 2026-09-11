import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { Battle, FleetShip } from './battle.types';
import { BattleModelState, BattleStack } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { BattleCombatService } from './battle-combat.service';
import { BattleTurnService } from './battle-turn.service';
import { BattleAnimationService } from './battle-animation.service';
import { ANIMATION_MS } from './battle.types';

describe('BattleCombatService', () => {
  let combat: BattleCombatService;
  let turn: BattleTurnService;
  let anim: BattleAnimationService;
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
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
    state.activeSide = 'attacker';
    return state;
  };

  const placeAdjacent = (atker: BattleStack, defender: BattleStack): void => {
    // defender within the attacker's attack range on the same row
    defender.col = atker.col + Math.min(atker.attackRange, 3);
    defender.row = atker.row;
  };

  /*
   * buildStacks() gives each ship its own stack when the roster is small,
   * so multi-ship stacks must be assembled by hand for tests that need
   * a whole-stack volley (totalAttack = sum of alive ships). This helper
   * mutates the first side stack's ships array in place, so the merged
   * stack is the one attackStack() looks up by stackId.
   */
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

  it('applies max(1, totalAttack - frontDefense) and deducts AP', async () => {
    // 5 fighters (kinetic, 75) vs 1 frigate (energy, defense 8, missile
    // weakness): kinetic vs missile is neutral (1.0x), so raw damage is
    // 67. The frigate's 80 shield fully absorbs 67; hull HP untouched.
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'frigate')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    const apBefore = state.ap;
    const shieldBefore = def.ships[0].shield!;
    const hpBefore = def.ships[0].hp;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(state.ap).toBe(apBefore - atk.attackAp);
    expect(def.ships[0].shield).toBe(shieldBefore - 67);
    expect(def.ships[0].hp).toBe(hpBefore);
    expect(def.ships[0].alive).toBe(true);
    expect(atk.attackedThisTurn).toBe(true);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].kills).toBe(0);
  });

  it('spills overkill across a defender stack until a ship dies', async () => {
    // 5 fighters (kinetic, 75) vs 2 scouts (kinetic, defense 2, energy
    // weakness): kinetic vs energy is strong (1.5x), so damage is
    // floor(73 * 1.5) = 109. Scout shield 20 / HP 40:
    //   ship 1: shield 20 -> 0 (89 left), hull 40 -> 0 dies (49 left)
    //   ship 2: shield 20 -> 0 (29 left), hull 40 -> 11 alive
    // One kill, one wounded with shield 0 / HP 11.
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [
        fleetShip(100, 'scout'),
        fleetShip(101, 'scout'),
      ],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = mergeSameTypeStacks(state, 'defender');
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    const dead = def.ships.filter((s) => !s.alive);
    // A ship is "wounded" if it survived but took damage to either hull or
    // shield — the shield change is the visible effect of the volley.
    const wounded = def.ships.filter(
      (s) =>
        s.alive &&
        (s.hp < s.maxHp || ((s.shield ?? 0) < (s.maxShield ?? 0))),
    );
    expect(dead).toHaveLength(1);
    expect(wounded).toHaveLength(1);
    expect(wounded[0].hp).toBe(11);
    expect(wounded[0].shield).toBe(0);
    expect(state.log[0].kills).toBe(1);
  });

  it('destroys a stack when all its ships die and triggers victory', async () => {
    // 5 fighters (75) vs 1 scout (hp 40, defense 2): damage 73 → scout dies
    const state = setup(
      Array.from({ length: 5 }, (_, i) => fleetShip(i, 'fighter')),
      [fleetShip(100, 'scout')],
    );
    const atk = mergeSameTypeStacks(state, 'attacker');
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    // explosion phase for a wiped target
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.explosion);
    await p;

    expect(def.destroyed).toBe(true);
    expect(state.winner).toBe('attacker');
    expect(state.log[0].kills).toBe(1);
  });

  it('runs the projectile -> impact -> clear effect lifecycle with ticks', async () => {
    const state = setup(
      [fleetShip(0, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
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
    def.col = atk.col + 10; // beyond range 2

    const result = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(result).toBe(false);
    expect(state.ap).toBe(10);
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
    expect(state.ap).toBe(10);
  });

  it('rejects a second attack by the same stack in one turn', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const first = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await first;
    expect(state.ap).toBe(10 - atk.attackAp);

    const second = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(second).toBe(false);
  });

  /*
   * Shield absorption. Each ship's shield absorbs damage first; only
   * overflow reaches hull HP. A ship is destroyed only when hull HP hits
   * zero. Shield regeneration is intentionally not exercised here.
   *
   * NOTE: buildStacks() gives each ship its own stack when the roster is
   * small, so the attacker here uses multiple ships of the SAME type,
   * which buildStacks() groups into one stack (totalAttack = sum).
   */
  it('absorbs damage completely with a full shield', async () => {
    // 1 fighter (attack 15) vs 1 frigate (defense 8) => damage 7.
    // Frigate shield 80 fully absorbs 7; hull HP untouched.
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
    // 3 cruisers (attack 60 each = 180) vs 1 scout (defense 2) => damage 178.
    // Custom defender ship: shield 20, hp 40. Shield absorbs 20, hull
    // takes 40 and dies. Single-ship stack, so the stack is destroyed.
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

  it('destroys a ship when damage exceeds shield plus hull HP', async () => {
    // 3 cruisers (180) vs 1 scout (defense 2) => damage 178.
    // Custom defender ship: shield 20, hp 40. 178 > 20 + 40 => destroyed.
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
    // 1 fighter (kinetic, attack 15) vs 1 scout (kinetic, defense 2, energy
    // weakness): kinetic vs energy is strong (1.5x). raw = 13, damage = floor(13 * 1.5) = 19.
    // Custom defender ship: shield 0, hp 40. All 19 reaches hull HP.
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
    // 3 cruisers (energy, attack 60 each = 180) vs 2 scouts (kinetic,
    // defense 2, energy weakness): energy vs energy is resistant (0.5x).
    // raw = 178, damage = floor(178 * 0.5) = 89.
    // Custom defender stack: ship A shield 20 hp 40, ship B shield 10 hp 60.
    // A: shield 20 -> 0 (69 left), hull 40 -> 0 dies (29 left).
    // B: shield 10 -> 0 (19 left), hull 60 -> 41 alive.
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

  /*
   * Weapon effectiveness. The attacker's attackType vs the front target
   * ship's weakness scales the raw (attack - defense) volley:
   *   strong matchup    = 1.5x
   *   neutral matchup   = 1.0x
   *   resisted matchup  = 0.5x
   * Pure and deterministic — no randomness, no ammo, no cooldowns.
   */
  it('applies a strong (1.5x) multiplier for the strong matchup', async () => {
    // 1 fighter (kinetic, attack 15) vs 1 scout (kinetic, defense 2, energy
    // weakness): kinetic vs energy is strong. raw = 13, damage = floor(13 * 1.5) = 19.
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'scout')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);
    def.ships[0].shield = 0; // isolate the weapon modifier from shield absorption
    def.ships[0].hp = 40;
    def.ships[0].maxHp = 40;

    const p = combat.attackStack(state, atk.stackId, def.stackId);
    await vi.advanceTimersByTimeAsync(5000);
    await p;

    expect(def.ships[0].hp).toBe(21); // 40 - 19
    expect(def.ships[0].alive).toBe(true);
    expect(state.log[0].damage).toBe(19);
  });

  it('applies a neutral (1.0x) multiplier with no relationship', async () => {
    // 1 fighter (kinetic, attack 15) vs 1 frigate (energy, defense 8, missile
    // weakness): kinetic vs missile is neutral. raw = 7, damage = 7.
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

    expect(def.ships[0].hp).toBe(123); // 130 - 7
    expect(state.log[0].damage).toBe(7);
  });

  it('applies a resistant (0.5x) multiplier when the target weakness resists the weapon', async () => {
    // 1 fighter (kinetic, attack 15) vs 1 corvette (energy, defense 5, kinetic
    // weakness): kinetic vs kinetic is resisted. raw = 10, damage = floor(10 * 0.5) = 5.
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

    expect(def.ships[0].hp).toBe(85); // 90 - 5
    expect(state.log[0].damage).toBe(5);
  });

  it('still floors damage to at least 1 after applying the multiplier', async () => {
    // 1 colonizer (kinetic, attack 2) vs 1 corvette (energy, defense 5,
    // kinetic weakness): resistant. raw = max(1, 2 - 5) = 1,
    // floor(1 * 0.5) = 0 -> floored to 1.
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

  it('rejects attacks while the animation lock is busy', async () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const def = getStacks(state, 'defender')[0];
    placeAdjacent(atk, def);

    const inFlight = combat.attackStack(state, atk.stackId, def.stackId);
    const result = await combat.attackStack(state, atk.stackId, def.stackId);
    expect(result).toBe(false);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.projectile);
    await vi.advanceTimersByTimeAsync(ANIMATION_MS.hit);
    await inFlight;
  });

  /*
   * Carrier Shield Pulse. The Carrier spends its attack action to restore
   * its shieldRegen (6) to every friendly stack within its attack range
   * (4), capped at each ship's maxShield. Deterministic and non-damage —
   * it reuses the same action gates (attackedThisTurn + attackAp) as a
   * normal attack.
   *
   * NOTE: buildStacks() gives each ship its own stack when the roster is
   * small, so the Carrier and its Fighter ally are separate stacks here;
   * they are simply positioned within range of each other.
   */
  it('restores shieldRegen to a damaged friendly stack in range', () => {
    // Attacker fleet: 1 carrier + 1 fighter (separate stacks). Defender: 1 frigate.
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 3; // distance 3 <= attackRange 4
    ally.row = carrier.row;
    ally.ships[0].shield = 10; // fighter maxShield 30, regen 2
    ally.ships[0].maxShield = 30;

    const ok = combat.carrierShieldBoost(state, carrier.stackId);
    expect(ok).toBe(true);
    expect(state.ap).toBe(50 - carrier.attackAp);
    expect(carrier.attackedThisTurn).toBe(true);
    expect(ally.ships[0].shield).toBe(16); // 10 + 6 (Carrier shieldRegen)
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
    ally.ships[0].shield = 28; // fighter maxShield 30, regen 2 -> capped at 30
    ally.ships[0].maxShield = 30;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(ally.ships[0].shield).toBe(30); // 28 + 6 capped at 30
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
    carrier.ships[0].shield = 100; // carrier maxShield 220
    carrier.ships[0].maxShield = 220;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(carrier.ships[0].shield).toBe(100); // untouched
  });

  it('does not affect stacks out of range', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 10; // out of range 4
    ally.row = carrier.row;
    ally.ships[0].shield = 10;
    ally.ships[0].maxShield = 30;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(ally.ships[0].shield).toBe(10); // untouched
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
    enemy.ships[0].shield = 50;
    enemy.ships[0].maxShield = 80;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(enemy.ships[0].shield).toBe(50); // untouched
  });

  it('returns false for a non-Carrier stack', () => {
    const state = setup([fleetShip(0, 'fighter')], [fleetShip(100, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    expect(combat.carrierShieldBoost(state, atk.stackId)).toBe(false);
  });

  it('returns false when the Carrier already acted this turn', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    carrier.attackedThisTurn = true;
    expect(combat.carrierShieldBoost(state, carrier.stackId)).toBe(false);
  });

  it('returns false when AP is insufficient', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    state.ap = 2; // carrier attackAp is 5
    expect(combat.carrierShieldBoost(state, carrier.stackId)).toBe(false);
  });

  it('spends attackAp and marks attackedThisTurn', () => {
    const state = setup(
      [fleetShip(0, 'carrier'), fleetShip(1, 'fighter')],
      [fleetShip(100, 'frigate')],
    );
    const carrier = getStacks(state, 'attacker').find((s) => s.typeId === 'carrier')!;
    const ally = getStacks(state, 'attacker').find((s) => s.typeId === 'fighter')!;
    ally.col = carrier.col + 3;
    ally.row = carrier.row;
    const apBefore = state.ap;

    combat.carrierShieldBoost(state, carrier.stackId);
    expect(state.ap).toBe(apBefore - carrier.attackAp);
    expect(carrier.attackedThisTurn).toBe(true);
  });

  /*
   * Shared planetary shield. In planet battles, immobile defense stacks
   * are protected by one pool before their own per-ship shields. Garrison
   * stacks keep their normal per-ship shields and never touch the pool.
   */
  const planetSetup = (
    defender: FleetShip[],
    shieldPool: number,
    shieldPoolRegen: number,
  ): BattleModelState => {
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
    state.activeSide = 'attacker';
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
    const state = planetSetup(
      [fleetShip(100, 'laser_turret'), fleetShip(101, 'fighter')],
      300,
      15,
    );
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
});

import { TestBed } from '@angular/core/testing';
import { ShipService } from '../../../services/ship.service';
import { PlanetBattleService } from '../../../services/planet-battle.service';
import { BattleModelState, BattleStack, FleetShip } from './battle.types';
import { createBattleState, getStacks } from './battle-state';
import { stackCenterVw } from './battle-grid';
import {
  effectiveDurability,
  expectedVolleyDamage,
  rememberAutoTarget,
  selectBestTarget,
  selectFireTarget,
  setTargetingMode,
  volleysToKill,
} from './battle-targeting';

describe('battle-targeting', () => {
  let shipService: ShipService;
  let planetBattleService: PlanetBattleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    shipService = TestBed.inject(ShipService);
    planetBattleService = TestBed.inject(PlanetBattleService);
  });

  const fleetShip = (id: number, type: string): FleetShip => ({ id, name: `S${id}`, type });

  const setup = (attacker: FleetShip[], defender: FleetShip[]): BattleModelState =>
    createBattleState(
      {
        fleet1: { id: 1, name: 'ORION', factionId: 'player', ships: attacker },
        fleet2: { id: 2, name: 'RAIDER', factionId: 'enemy1', ships: defender },
        faction1Name: 'Player',
        faction1Color: '#8cc4ff',
        faction2Name: 'Enemy',
        faction2Color: '#d65757',
        attackerId: 1,
        defenderId: 2,
      },
      shipService,
      planetBattleService,
    );

  const place = (stack: BattleStack, col: number, row: number): void => {
    stack.col = col;
    stack.row = row;
    const c = stackCenterVw(stack);
    stack.x = c.x;
    stack.y = c.y;
  };

  const byType = (state: BattleModelState, type: string): BattleStack =>
    getStacks(state, 'defender').find((s) => s.typeId === type)!;

  /* Battleship (range 4 → reach 17.5vw ≈ 9 cells) at (5,8), every enemy
   * placed within reach on distinct cells. */
  const mixedSetup = () => {
    const state = setup(
      [fleetShip(1, 'battleship')],
      [fleetShip(10, 'colonizer'), fleetShip(11, 'dreadnought'), fleetShip(12, 'scout'), fleetShip(13, 'battlecruiser')],
    );
    const atk = getStacks(state, 'attacker')[0];
    place(atk, 5, 8);
    place(byType(state, 'colonizer'), 8, 8);
    place(byType(state, 'scout'), 9, 6);
    place(byType(state, 'battlecruiser'), 12, 10);
    place(byType(state, 'dreadnought'), 13, 6);
    return { state, atk };
  };

  it('balanced (default) prefers a high-value role over a nearer low-value one', () => {
    const { state, atk } = mixedSetup();
    expect(atk.targetingMode).toBe('balanced');
    expect(selectBestTarget(state, atk)!.typeId).toBe('dreadnought');
  });

  it('strongest picks the greatest remaining hull + shield', () => {
    const { state, atk } = mixedSetup();
    expect(selectBestTarget(state, atk, 'strongest')!.typeId).toBe('dreadnought');
    // A badly damaged dreadnought is no longer the strongest.
    const dread = byType(state, 'dreadnought');
    dread.ships[0].hp = 10;
    dread.ships[0].shield = 0;
    expect(selectBestTarget(state, atk, 'strongest')!.typeId).toBe('battlecruiser');
  });

  it('weakest picks the target needing the fewest volleys from this attacker', () => {
    const { state, atk } = mixedSetup();
    const colonizer = byType(state, 'colonizer');
    const scout = byType(state, 'scout');
    // Both die to one battleship volley; the tie-break is lower durability.
    expect(volleysToKill(state, atk, colonizer)).toBe(1);
    expect(volleysToKill(state, atk, scout)).toBe(1);
    expect(selectBestTarget(state, atk, 'weakest')!.typeId).toBe('colonizer');
  });

  it('estimates volley damage with the same defense and weapon-matchup rules as combat', () => {
    const { state, atk } = mixedSetup();
    // Battleship: attack 90, kinetic. Scout: defense 2, weakness energy.
    // WEAPON_EFFECTIVENESS.kinetic.energy = 1.5.
    const scout = byType(state, 'scout');
    expect(expectedVolleyDamage(atk, scout)).toBe(Math.floor((90 - 2) * 1.5));
    // Dreadnought: defense 28, weakness missile → kinetic vs missile = 1.0.
    expect(expectedVolleyDamage(atk, byType(state, 'dreadnought'))).toBe(90 - 28);
  });

  it('firepower picks the greatest attack output', () => {
    const { state, atk } = mixedSetup();
    expect(selectBestTarget(state, atk, 'firepower')!.typeId).toBe('dreadnought');
    byType(state, 'dreadnought').ships[0].attack = 1;
    expect(selectBestTarget(state, atk, 'firepower')!.typeId).toBe('battlecruiser');
  });

  it('breaks exact ties by distance, then by stackId', () => {
    const state = setup([fleetShip(1, 'fighter')], [fleetShip(10, 'frigate'), fleetShip(11, 'frigate')]);
    const atk = getStacks(state, 'attacker')[0];
    const [f1, f2] = getStacks(state, 'defender');
    place(atk, 5, 8);
    place(f1, 9, 8);
    place(f2, 7, 8);
    for (const mode of ['balanced', 'strongest', 'weakest', 'firepower'] as const) {
      expect(selectBestTarget(state, atk, mode)!.stackId).toBe(f2.stackId);
    }
    place(f2, 9, 10);
    place(f1, 9, 6);
    for (const mode of ['balanced', 'strongest', 'weakest', 'firepower'] as const) {
      expect(selectBestTarget(state, atk, mode)!.stackId).toBe(f1.stackId);
    }
  });

  it('ignores destroyed, friendly and out-of-reach stacks and returns null when nothing is in reach', () => {
    const { state, atk } = mixedSetup();
    for (const s of getStacks(state, 'defender')) {
      if (s.typeId !== 'scout') place(s, 36, s.row);
    }
    expect(selectBestTarget(state, atk)!.typeId).toBe('scout');
    byType(state, 'scout').destroyed = true;
    expect(selectBestTarget(state, atk)).toBeNull();
  });

  it('a manual target in reach always wins over automatic scoring', () => {
    const { state, atk } = mixedSetup();
    atk.explicitAttackTargetId = byType(state, 'colonizer').stackId;
    expect(selectFireTarget(state, atk)!.typeId).toBe('colonizer');
  });

  it('fires opportunistically when the manual target is out of reach, without dropping the order', () => {
    const { state, atk } = mixedSetup();
    const far = byType(state, 'colonizer');
    place(far, 36, 2);
    atk.explicitAttackTargetId = far.stackId;
    expect(selectFireTarget(state, atk)!.typeId).toBe('dreadnought');
    expect(atk.explicitAttackTargetId).toBe(far.stackId);
  });

  it('keeps a sticky automatic target while it stays in reach', () => {
    const { state, atk } = mixedSetup();
    const scout = byType(state, 'scout');
    rememberAutoTarget(atk, scout);
    expect(selectFireTarget(state, atk)!.stackId).toBe(scout.stackId);

    place(scout, 36, 2);
    expect(selectFireTarget(state, atk)!.typeId).toBe('dreadnought');
  });

  it('does not record manual-order volleys as the sticky target', () => {
    const { state, atk } = mixedSetup();
    const colonizer = byType(state, 'colonizer');
    atk.explicitAttackTargetId = colonizer.stackId;
    rememberAutoTarget(atk, colonizer);
    expect(atk.autoTargetId ?? null).toBeNull();
  });

  it('changing the targeting mode drops the sticky target immediately', () => {
    const { state, atk } = mixedSetup();
    rememberAutoTarget(atk, byType(state, 'scout'));
    setTargetingMode(atk, 'weakest');
    expect(atk.autoTargetId).toBeNull();
    expect(selectFireTarget(state, atk)!.typeId).toBe('colonizer');
  });

  it('counts the shared planetary shield as durability for immobile defenses', () => {
    const { state } = mixedSetup();
    const colonizer = byType(state, 'colonizer');
    const base = effectiveDurability(state, colonizer);
    state.defenderShieldPool = { current: 500, max: 500, regen: 0 };
    expect(effectiveDurability(state, colonizer)).toBe(base);
    colonizer.immobile = true;
    expect(effectiveDurability(state, colonizer)).toBe(base + 500);
  });
});

import { BattleModelState, BattleStack } from './battle.types';
import { angleDelta, stackHeading, updateStackHeadings } from './battle-heading';

function makeStack(overrides: Partial<BattleStack> = {}): BattleStack {
  return {
    stackId: 'attacker:fighter:0',
    side: 'attacker',
    typeId: 'fighter',
    typeName: 'Fighter',
    role: 'Interceptor',
    col: 5,
    row: 5,
    ships: [],
    size: 1,
    tier: 1,
    attackRange: 2,
    immobile: false,
    moving: false,
    firing: false,
    destroyed: false,
    speed: 3,
    fireRate: 1.5,
    x: 10,
    y: 10,
    targetX: null,
    targetY: null,
    ...overrides,
  };
}

const stateOf = (...stacks: BattleStack[]) => ({ stacks }) as unknown as BattleModelState;

/* Runs the heading update for `seconds` of battle time in 60 fps frames. */
function run(state: BattleModelState, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    updateStackHeadings(state, 1 / 60);
  }
}

describe('battle heading', () => {
  it('defaults to facing the enemy side', () => {
    expect(stackHeading(makeStack())).toBe(0);
    expect(stackHeading(makeStack({ side: 'defender' }))).toBe(180);
  });

  it('wraps angle differences to the shortest turn', () => {
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });

  it('turns gradually toward the movement target, not instantly', () => {
    const stack = makeStack({ moving: true, targetX: 10, targetY: 20 }); // straight down = 90°
    const state = stateOf(stack);
    updateStackHeadings(state, 1 / 60);
    expect(stack.heading!).toBeGreaterThan(0);
    expect(stack.heading!).toBeLessThan(10);
    run(state, 1);
    expect(stack.heading!).toBeCloseTo(90, 5);
  });

  it('turns capital ships more slowly than light ships', () => {
    const fighter = makeStack({ moving: true, targetX: 10, targetY: 0 });
    const dread = makeStack({ stackId: 'd', tier: 5, moving: true, targetX: 10, targetY: 0 });
    run(stateOf(fighter, dread), 0.25);
    expect(Math.abs(fighter.heading!)).toBeGreaterThan(Math.abs(dread.heading!));
  });

  it('takes the short way round across ±180°', () => {
    const stack = makeStack({ side: 'defender', heading: 170, moving: true, targetX: 0, targetY: 11 });
    // Target bearing ≈ 174°; moving left-and-slightly-down never sweeps through 0°.
    run(stateOf(stack), 0.5);
    expect(Math.abs(stack.heading!)).toBeGreaterThan(160);
  });

  it('eases back to the default facing once idle', () => {
    const stack = makeStack({ heading: 90 });
    run(stateOf(stack), 1);
    expect(stack.heading!).toBeCloseTo(0, 5);
  });

  it('keeps its heading on very short final approaches (no snap twitch)', () => {
    const stack = makeStack({ heading: 45, moving: true, targetX: 10.1, targetY: 9.9 });
    run(stateOf(stack), 0.5);
    expect(stack.heading!).toBe(45);
  });

  it('never turns immobile turrets and freezes while paused', () => {
    const turret = makeStack({ immobile: true, side: 'defender', moving: true, targetX: 10, targetY: 30 });
    const mover = makeStack({ stackId: 'm', moving: true, targetX: 10, targetY: 30 });
    const state = stateOf(turret, mover);
    updateStackHeadings(state, 0);
    expect(mover.heading).toBeUndefined();
    run(state, 1);
    expect(turret.heading).toBe(180);
  });
});

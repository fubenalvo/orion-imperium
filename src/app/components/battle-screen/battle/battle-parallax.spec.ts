import { BattleParallax, PARALLAX_SMOOTHING_TAU_S } from './battle-parallax';

describe('BattleParallax', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  /* Runs `seconds` of 60 fps frames. */
  const run = (p: BattleParallax, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      p.step(1 / 60);
    }
  };

  it('normalises the pointer against the given rect, not the window', () => {
    const p = new BattleParallax();
    p.setPointer(100, 50, rect); // top-left corner of the element
    run(p, 5);
    expect(p.x).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(-1);

    p.setPointer(500, 250, rect); // centre
    run(p, 5);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('clamps pointer positions outside the rect to the edge', () => {
    const p = new BattleParallax();
    p.setPointer(5000, -5000, rect);
    run(p, 5);
    expect(p.x).toBe(1);
    expect(p.y).toBe(-1);
  });

  it('eases toward the target instead of jumping', () => {
    const p = new BattleParallax();
    p.setPointer(900, 450, rect); // target (1, 1)
    p.step(1 / 60);
    // One frame covers only a small fraction of the way.
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(0.1);
    // After one time constant ~63% of the way.
    const q = new BattleParallax();
    q.setPointer(900, 450, rect);
    q.step(PARALLAX_SMOOTHING_TAU_S);
    expect(q.x).toBeCloseTo(1 - Math.exp(-1), 5);
  });

  it('is frame-rate independent', () => {
    const fast = new BattleParallax();
    const slow = new BattleParallax();
    fast.setPointer(900, 450, rect);
    slow.setPointer(900, 450, rect);
    for (let i = 0; i < 12; i++) fast.step(0.01);
    for (let i = 0; i < 3; i++) slow.step(0.04);
    expect(fast.x).toBeCloseTo(slow.x, 10);
  });

  it('never moves without new input — leaving and re-entering causes no jump', () => {
    const p = new BattleParallax();
    p.setPointer(800, 300, rect);
    run(p, 3);
    const settledX = p.x;
    const settledY = p.y;

    // Pointer leaves the screen: there is no input at all, the offset holds.
    run(p, 2);
    expect(p.x).toBe(settledX);
    expect(p.y).toBe(settledY);

    // Re-enters on the opposite side: the first frame covers only a small
    // fraction (< 10%) of the distance to the new target.
    p.setPointer(110, 60, rect);
    const distX = Math.abs(-0.975 - settledX);
    p.step(1 / 60);
    expect(Math.abs(p.x - settledX)).toBeLessThan(distX * 0.1);
    expect(Math.abs(p.x - settledX)).toBeGreaterThan(0);
  });

  it('settles exactly on the target so idle frames stop changing the transform', () => {
    const p = new BattleParallax();
    p.setPointer(700, 100, rect);
    run(p, 5);
    expect(p.settled).toBe(true);
  });

  it('ignores device-orientation events without data instead of snapping to centre', () => {
    const p = new BattleParallax();
    p.setTilt(45, 22.5); // target (0.5, 0.5)
    run(p, 5);
    p.setTilt(null, null);
    run(p, 1);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.5);
  });

  it('ignores degenerate rects and non-positive time steps', () => {
    const p = new BattleParallax();
    p.setPointer(10, 10, { left: 0, top: 0, width: 0, height: 0 });
    p.step(0);
    p.step(-1);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});

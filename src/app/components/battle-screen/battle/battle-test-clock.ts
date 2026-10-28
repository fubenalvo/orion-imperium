import { BattleTimeService } from './battle-time.service';

/*
 * Test-only helper. Animation waits are resolved by BattleTimeService's
 * frame-driven scheduler (not setTimeout), so specs that only advance fake
 * timers would never finish an attack. This drives onTick() from a fake
 * setInterval so that N ms of fake time == N ms of battle time, regardless
 * of the current battle speed. Call it after vi.useFakeTimers() and invoke
 * the returned function in afterEach.
 *
 * Specs that run the real BattleGameLoopService (component specs) must NOT
 * use this, or battle time would advance twice per frame.
 */
export function startBattleTestClock(time: BattleTimeService, stepMs = 10): () => void {
  const id = setInterval(() => {
    // The tiny epsilon keeps float accumulation from leaving a wait at
    // 0.0000001 ms remaining after exactly its nominal duration.
    time.onTick((stepMs + 1e-6) / 1000 / time.speed);
  }, stepMs);
  return () => clearInterval(id);
}

import { BattleTimeService } from './battle-time.service';

/*
 * Test-only helper. Animation waits and laser bolts run on battle time
 * (BattleTimeService / the game loop), not on setTimeout, so specs that
 * only advance fake timers would never finish an attack. This drives
 * onTick() from a fake setInterval so that N ms of fake time == N ms of
 * battle time, regardless of the current battle speed.
 *
 * `onFrame` receives the scaled delta (seconds) of each step — specs that
 * fire volleys pass a callback that calls BattleCombatService
 * .updateProjectiles, standing in for the game loop. It is not called
 * while paused, matching the real loop.
 *
 * Call it after vi.useFakeTimers() and invoke the returned function in
 * afterEach. Specs that run the real BattleGameLoopService (component
 * specs) must NOT use this, or battle time would advance twice per frame.
 */
export function startBattleTestClock(
  time: BattleTimeService,
  onFrame?: (deltaSec: number) => void,
  stepMs = 10,
): () => void {
  const id = setInterval(() => {
    // The tiny epsilon keeps float accumulation from leaving a wait at
    // 0.0000001 ms remaining after exactly its nominal duration.
    const real = (stepMs + 1e-6) / 1000 / time.speed;
    time.onTick(real);
    const scaled = time.getScaledDeltaTime(real);
    if (onFrame && scaled > 0) {
      onFrame(scaled);
    }
  }, stepMs);
  return () => clearInterval(id);
}

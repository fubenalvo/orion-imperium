/*
 * Player-facing stability warnings for the galaxy map (docs/economy.md,
 * "Energy and satisfaction").
 *
 * StarMap takes a snapshot of the player's planets right before and right
 * after each economy tick and turns the differences into map notices:
 *  - a planet newly short on energy (reported once until it recovers);
 *  - satisfaction falling through a warning level (50%, 20%);
 *  - a planet lost to rebellion during the tick.
 *
 * Only the economy tick runs between the two snapshots, so a planet that
 * disappears from the player's list in between rebelled (captures and
 * colonization happen elsewhere in the frame).
 */

export const SATISFACTION_WARNING_LEVELS = [50, 20] as const;

export interface PlanetStabilityState {
  satisfaction: number;
  /* Energy efficiency 0..1; below 1 the planet is short on energy. */
  efficiency: number;
  /* Satisfaction change per second (PlanetEconomy.satisfactionDrift). */
  satisfactionDrift: number;
}

export function planetStabilityNotices(
  before: ReadonlyMap<string, PlanetStabilityState>,
  after: ReadonlyMap<string, PlanetStabilityState>,
  // Planets already announced as energy-short; updated in place so a
  // shortage is reported once, and again only after it was fixed.
  announcedEnergyShort: Set<string>,
): string[] {
  const lines: string[] = [];

  for (const name of before.keys()) {
    if (!after.has(name)) {
      lines.push(`${name} rebelled and declared independence.`);
      announcedEnergyShort.delete(name);
    }
  }

  for (const [name, now] of after) {
    const prev = before.get(name);

    if (now.efficiency < 1) {
      if (!announcedEnergyShort.has(name)) {
        announcedEnergyShort.add(name);
        const shortPct = Math.round((1 - now.efficiency) * 100);
        lines.push(
          now.satisfactionDrift < 0
            ? `${name} is ${shortPct}% short on energy: output falls and satisfaction drops. Build power.`
            : `${name} is ${shortPct}% short on energy: output is reduced. Build power.`,
        );
      }
    } else {
      announcedEnergyShort.delete(name);
    }

    if (prev) {
      // Report only the lowest level crossed in this tick.
      const crossed = SATISFACTION_WARNING_LEVELS.filter((level) => prev.satisfaction > level && now.satisfaction <= level);
      if (crossed.length > 0) {
        const level = Math.min(...crossed);
        lines.push(`${name} satisfaction is down to ${level}%. At 0% the planet rebels.`);
      }
    }
  }

  // Forget planets the player no longer owns.
  for (const name of [...announcedEnergyShort]) {
    if (!after.has(name)) announcedEnergyShort.delete(name);
  }
  return lines;
}

import { Injectable } from '@angular/core';
import { ShipService } from '../../services/ship.service';
import { isCombatShipType } from './ai-queries';
import { isAdaptiveAiFaction, isAdaptiveDifficultyEnabled, nextAdaptiveFactor } from './ai-difficulty';
import { Faction, FactionShipStock, Fleet, StarSystem } from './star-map.models';

/*
 * =========================================================
 * AI ADAPTIVE DIFFICULTY
 * =========================================================
 *
 * Moves each adaptive AI faction's `aiAdaptiveFactor` (ai-difficulty.ts)
 * once per ADAPTIVE_INTERVAL seconds of game time, comparing the AI's
 * empire power with the human player's (empirePowerRatio). An AI running
 * away from the player slows down; one falling behind speeds up, always
 * inside its difficulty's band.
 *
 * - Runs only while the global ADAPTIVE AI option is on (AiSettingsService,
 *   Options menu); then every AI with a difficulty is adaptive, in any game,
 *   also an older save (its factor starts at 1). Headless games
 *   (simulations, unit tests) never turn the option on.
 * - With the option off nothing moves; the saved factors are kept.
 * - It is a game director, not an AI decision: it reads the real world,
 *   not the faction's fog-of-war view, and the AI never reads the ratio.
 * - Nothing changes while the player owns no planet (the game is lost).
 * - The factor is saved on the faction; the minute accumulator is in
 *   memory, so a load restarts the current minute.
 */
const ADAPTIVE_INTERVAL = 60;
const HUMAN_FACTION_ID = 'player';

/* Smoothing added to both sides of every component, so a tiny empire does not produce extreme ratios. */
const POWER_SMOOTHING = { planets: 1, population: 500, military: 100, technologies: 1 } as const;

export interface EmpirePower {
  planets: number;
  population: number;
  /* Combat strength of fleets and reserve (ShipService.calculateFleetStrength, equipment included). */
  military: number;
  technologies: number;
}

@Injectable({ providedIn: 'root' })
export class AiAdaptiveDifficultyService {
  private accumulator = 0;

  constructor(private readonly shipService: ShipService) {}

  reset(): void {
    this.accumulator = 0;
  }

  /* Returns true when any faction's factor changed. */
  tick(
    gameDeltaTime: number,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] },
  ): boolean {
    if (gameDeltaTime <= 0 || !isAdaptiveDifficultyEnabled()) return false;
    this.accumulator += gameDeltaTime;
    if (this.accumulator < ADAPTIVE_INTERVAL) return false;
    this.accumulator -= ADAPTIVE_INTERVAL;

    const adaptive = data.factions.filter((f) => isAdaptiveAiFaction(f));
    if (adaptive.length === 0) return false;
    const player = this.measure(HUMAN_FACTION_ID, data);
    if (player.planets === 0) return false;

    let changed = false;
    for (const faction of adaptive) {
      const ratio = empirePowerRatio(this.measure(faction.id, data), player);
      const next = nextAdaptiveFactor(faction, ratio);
      if (next !== faction.aiAdaptiveFactor) {
        faction.aiAdaptiveFactor = next;
        changed = true;
      }
    }
    return changed;
  }

  measure(
    factionId: string,
    data: { factions: Faction[]; starSystems: StarSystem[]; fleets: Fleet[]; shipStock: FactionShipStock[] },
  ): EmpirePower {
    const planets = data.starSystems.flatMap((s) => s.planetsTiles).filter((p) => p.factionId === factionId);
    const isCombat = (type: string) => isCombatShipType(this.shipService.getShipType(type));
    const ships = [
      ...data.fleets.filter((f) => f.factionId === factionId && !f.destroyed).flatMap((f) => f.ships),
      ...(data.shipStock.find((s) => s.factionId === factionId)?.ships ?? []),
    ].filter((s) => isCombat(s.type));
    return {
      planets: planets.length,
      population: planets.reduce((sum, p) => sum + (p.population ?? 0), 0),
      military: this.shipService.calculateFleetStrength(ships),
      technologies: data.factions.find((f) => f.id === factionId)?.researchedTechnologies?.length ?? 0,
    };
  }
}

/*
 * AI power / player power: the geometric mean of the smoothed per-component
 * ratios, so no single component (a huge fleet, many tiny colonies)
 * dominates and the ratio is symmetric (swapping sides inverts it).
 */
export function empirePowerRatio(ai: EmpirePower, player: EmpirePower): number {
  const keys = Object.keys(POWER_SMOOTHING) as (keyof EmpirePower)[];
  const logSum = keys.reduce(
    (sum, k) => sum + Math.log((ai[k] + POWER_SMOOTHING[k]) / (player[k] + POWER_SMOOTHING[k])),
    0,
  );
  return Math.exp(logSum / keys.length);
}

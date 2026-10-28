import { Injectable } from '@angular/core';
import { StarMapData } from '../components/star-map/star-map.models';
import { SaveGameService, MANUAL_SLOT_START, TOTAL_SLOT_COUNT } from './save-game.service';
import { GalaxyGeneratorService } from './galaxy-generator.service';
import { validateGeneratedGalaxy } from './galaxy-validation';
import { validateNewGameConfig } from './new-game-config';
import { NewGameConfig } from './new-game.models';

/*
 * =========================================================
 * NEW GAME SERVICE
 * =========================================================
 *
 * Start Game workflow: validate config → generate galaxy → strictly
 * validate it → write it to the chosen manual slot → activate the slot
 * (which copies it into autosave, the active-session source of truth,
 * see docs/architecture.md § Save Slots). Only when every step succeeds
 * does the caller navigate to /star-map, so a broken galaxy can never
 * become the active session.
 *
 * Generation failures (layout constraints or validation) are retried with
 * seeds derived deterministically from the requested seed, so a given
 * seed still always yields the same galaxy. The seed that actually
 * produced the galaxy is recorded in `StarMapData.galaxy.seed`.
 *
 * After this point the generated galaxy is an ordinary save: loading it
 * restores the stored snapshot and never regenerates anything.
 */

export type NewGameResult =
  | { ok: true; data: StarMapData }
  | { ok: false; errors: string[] };

export const MAX_GENERATION_ATTEMPTS = 8;

@Injectable({ providedIn: 'root' })
export class NewGameService {
  constructor(
    private readonly generator: GalaxyGeneratorService,
    private readonly saveGameService: SaveGameService,
  ) {}

  /* Generates and validates a galaxy without persisting it. */
  createGame(config: NewGameConfig): NewGameResult {
    const configResult = validateNewGameConfig(config);
    if (!configResult.ok) {
      return { ok: false, errors: configResult.errors };
    }

    const baseSeed = config.seed ?? randomSeed();
    let lastErrors: string[] = ['Galaxy generation failed.'];
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
      const seed = deriveSeed(baseSeed, attempt);
      try {
        const data = this.generator.generate(config, seed);
        const validation = validateGeneratedGalaxy(data, config);
        if (validation.ok) {
          return { ok: true, data };
        }
        lastErrors = validation.errors;
        console.warn(`[new-game] seed ${seed} produced an invalid galaxy:`, validation.errors);
      } catch (error) {
        lastErrors = [error instanceof Error ? error.message : String(error)];
        console.warn(`[new-game] seed ${seed} failed to generate:`, error);
      }
    }
    return { ok: false, errors: ['Could not generate a valid galaxy. Try a different seed.', ...lastErrors] };
  }

  /*
   * Creates the game and makes it the active session in `slotIndex`.
   * On failure nothing is activated; the target slot may only be written
   * when generation succeeded but activation failed (e.g. storage quota).
   */
  startNewGame(config: NewGameConfig, slotIndex: number): NewGameResult {
    if (!Number.isInteger(slotIndex) || slotIndex < MANUAL_SLOT_START || slotIndex >= TOTAL_SLOT_COUNT) {
      return { ok: false, errors: ['Select a save slot for the new game.'] };
    }
    const result = this.createGame(config);
    if (!result.ok) {
      return result;
    }
    if (!this.saveGameService.saveToSlot(slotIndex, result.data)) {
      return { ok: false, errors: [`Could not save the new game (${this.saveGameService.lastError ?? 'storage error'}).`] };
    }
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return { ok: false, errors: [`Could not start the new game (${this.saveGameService.lastError ?? 'activation failed'}).`] };
    }
    return result;
  }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/* Attempt 0 uses the seed as-is; retries walk a fixed odd stride through uint32 space. */
function deriveSeed(baseSeed: number, attempt: number): number {
  return (baseSeed + Math.imul(attempt, 0x9e3779b1)) >>> 0;
}

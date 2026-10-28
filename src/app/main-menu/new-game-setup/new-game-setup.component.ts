import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AiDifficulty, GalaxySize } from '../../components/star-map/star-map.models';
import { AI_DIFFICULTIES, AI_DIFFICULTY_PROFILES } from '../../components/star-map/ai-difficulty';
import { SaveSlot, MANUAL_SLOT_START } from '../../services/save-game.service';
import {
  GALAXY_SIZES,
  GALAXY_SIZE_PRESETS,
  MAX_PLAYER_NAME_LENGTH,
  NewGameConfig,
  PLAYER_COLOR_PALETTE,
  ControllerType,
} from '../../services/new-game.models';
import {
  addPlayer,
  canAddPlayer,
  canRemovePlayer,
  colorsTooSimilar,
  createDefaultNewGameConfig,
  getMaxPlayers,
  removePlayer,
  setGalaxySize,
  setPlayerController,
  validateNewGameConfig,
} from '../../services/new-game-config';

export interface NewGameStartRequest {
  config: NewGameConfig;
  slotIndex: number;
}

/*
 * New Game configuration screen (galaxy size, participants, seed, save slot).
 *
 * Presentational: it owns only the editable NewGameConfig and emits a
 * StartRequest; MainMenu runs NewGameService and navigates. Every edit goes
 * through the pure helpers in new-game-config.ts, which keep the "exactly
 * one human" and per-size player-limit invariants intact, and the live
 * validation result gates the Start button.
 */
@Component({
  selector: 'app-new-game-setup',
  templateUrl: './new-game-setup.component.html',
  styleUrl: './new-game-setup.component.scss',
})
export class NewGameSetupComponent implements OnInit {
  @Input() slots: SaveSlot[] = [];
  /* Error reported by the parent after a failed start (generation/storage). */
  @Input() startError: string[] = [];
  @Input() starting = false;

  @Output() start = new EventEmitter<NewGameStartRequest>();
  @Output() cancel = new EventEmitter<void>();

  config: NewGameConfig = createDefaultNewGameConfig();
  slotIndex: number = MANUAL_SLOT_START;
  seedText = '';

  readonly galaxySizes = GALAXY_SIZES.map((id) => GALAXY_SIZE_PRESETS[id]);
  readonly palette = PLAYER_COLOR_PALETTE;
  readonly difficulties = AI_DIFFICULTIES.map((id) => AI_DIFFICULTY_PROFILES[id]);
  readonly maxNameLength = MAX_PLAYER_NAME_LENGTH;

  ngOnInit(): void {
    // Default to the first empty manual slot so a new game does not
    // silently overwrite an existing save.
    const firstEmpty = this.manualSlots.find((s) => !s.slot.data);
    this.slotIndex = firstEmpty?.index ?? MANUAL_SLOT_START;
  }

  get manualSlots(): { index: number; slot: SaveSlot }[] {
    return this.slots
      .map((slot, index) => ({ index, slot }))
      .filter((s) => s.index >= MANUAL_SLOT_START);
  }

  get maxPlayers(): number {
    return getMaxPlayers(this.config.galaxySize);
  }

  get canAdd(): boolean {
    return canAddPlayer(this.config);
  }

  get seedError(): string | null {
    const text = this.seedText.trim();
    if (!text) return null;
    if (!/^\d+$/.test(text) || Number(text) > 0xffffffff) {
      return 'Seed must be a whole number between 0 and 4294967295.';
    }
    return null;
  }

  get validationErrors(): string[] {
    const errors = validateNewGameConfig(this.buildConfig()).errors;
    return this.seedError ? [this.seedError, ...errors.filter((e) => !e.startsWith('Seed'))] : errors;
  }

  get selectedSlotHasSave(): boolean {
    return !!this.slots[this.slotIndex]?.data;
  }

  canRemove(index: number): boolean {
    return canRemovePlayer(this.config, index);
  }

  /* A color is unavailable when another player already uses a similar one. */
  isColorTaken(color: string, playerIndex: number): boolean {
    return this.config.players.some((p, i) => i !== playerIndex && colorsTooSimilar(p.color, color));
  }

  selectGalaxySize(size: GalaxySize): void {
    this.config = setGalaxySize(this.config, size);
  }

  addPlayer(): void {
    this.config = addPlayer(this.config);
  }

  removePlayer(index: number): void {
    this.config = removePlayer(this.config, index);
  }

  setName(index: number, event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.updatePlayer(index, { name });
  }

  setColor(index: number, color: string): void {
    if (this.isColorTaken(color, index)) return;
    this.updatePlayer(index, { color });
  }

  setController(index: number, event: Event): void {
    const controller = (event.target as HTMLSelectElement).value as ControllerType;
    this.config = setPlayerController(this.config, index, controller);
  }

  setDifficulty(index: number, event: Event): void {
    const difficulty = (event.target as HTMLSelectElement).value as AiDifficulty;
    this.updatePlayer(index, { difficulty });
  }

  setSlot(event: Event): void {
    this.slotIndex = Number((event.target as HTMLSelectElement).value);
  }

  setSeed(event: Event): void {
    this.seedText = (event.target as HTMLInputElement).value;
  }

  formatSlotDate(date: string | null): string {
    return date ? new Date(date).toLocaleString() : 'Empty';
  }

  onStart(): void {
    if (this.starting || this.validationErrors.length > 0) return;
    this.start.emit({ config: this.buildConfig(), slotIndex: this.slotIndex });
  }

  private buildConfig(): NewGameConfig {
    const text = this.seedText.trim();
    const seed = text && !this.seedError ? Number(text) : null;
    return {
      ...this.config,
      seed,
      players: this.config.players.map((p) => ({ ...p, name: p.name.trim() })),
    };
  }

  private updatePlayer(index: number, patch: Partial<NewGameConfig['players'][number]>): void {
    this.config = {
      ...this.config,
      players: this.config.players.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    };
  }
}

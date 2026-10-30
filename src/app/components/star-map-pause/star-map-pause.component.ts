import { Component, Input, Output, EventEmitter } from '@angular/core';
import { SaveGameService, SaveSlot, SaveSlotId } from '../../services/save-game.service';

/*
 * =========================================================
 * STAR MAP PAUSE COMPONENT
 * =========================================================
 *
 * Renders the pause menu overlay and handles save/load UI.
 * Communicates with StarMap via event emitters.
 *
 * States:
 * - Closed: renders nothing
 * - Paused (menu open): shows Continue, Save, Load, Main Menu buttons
 * - Paused (load slots): shows 4 save slots for loading
 *
 * Notes:
 * - The simulation freezes when paused (via GameTimeService).
 * - The menu is opened by StarMap, either from the ☰ button in the shared
 *   game header (StarMapHeaderComponent → openMenu) or by pressing ESC.
 *   This component has no trigger button of its own.
 */

@Component({
  selector: 'app-star-map-pause',
  standalone: true,
  templateUrl: './star-map-pause.component.html',
  styleUrl: './star-map-pause.component.scss',
})
export class StarMapPauseComponent {
  @Input() pauseMenuOpen = false;
  @Input() currentSlot: number | null = null;
  @Input() loadError = '';
  @Input() saveError = '';

  @Output() closePauseMenu = new EventEmitter<void>();
  @Output() saveGame = new EventEmitter<number>();
  @Output() loadGame = new EventEmitter<number>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() exitToMainMenu = new EventEmitter<void>();
  @Output() openOptionsMenu = new EventEmitter<void>();

  SaveSlotId = SaveSlotId;

  showLoadSlots = false;
  showSaveSlots = false;
  gameSaved = false;
  private savedMessageTimeout: number | null = null;

  constructor(private saveGameService: SaveGameService) {}

  get slots(): SaveSlot[] {
    return this.saveGameService.getSlots();
  }

  hasAnySave(): boolean {
    return this.saveGameService.hasAnySave();
  }

  formatDate(date: string | null): string {
    if (!date) {
      return 'Empty';
    }

    const d = new Date(date);
    return d.toLocaleString();
  }

  /*
   * onSaveGame: Opens manual save slot selection instead of saving immediately.
   * The actual save is handled by StarMap after the player selects a slot.
   */
  onSaveGame(): void {
    this.showSaveSlots = true;
  }

  onSaveSlotSelected(slotIndex: number): void {
    this.saveGame.emit(slotIndex);
    this.showSaveSlots = false;
    this.gameSaved = true;

    if (this.savedMessageTimeout) {
      clearTimeout(this.savedMessageTimeout);
    }

    this.savedMessageTimeout = window.setTimeout(() => {
      this.gameSaved = false;
    }, 2000);
  }

  onLoadGame(): void {
    this.showLoadSlots = true;
  }

  onBackToMenu(): void {
    this.showLoadSlots = false;
    this.showSaveSlots = false;
  }

  onSelectSlot(slotIndex: number): void {
    this.loadGame.emit(slotIndex);
    this.showLoadSlots = false;
  }
}

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { SaveGameService, SaveSlot } from '../../services/save-game.service';

/*
 * =========================================================
 * STAR MAP PAUSE COMPONENT
 * =========================================================
 *
 * Renders the pause menu overlay and handles save/load UI.
 * Communicates with StarMap via event emitters.
 *
 * States:
 * - Normal: shows ⏸ button (toggles pause, no overlay)
 * - Paused (menu open): shows Continue, Save, Load, Main Menu buttons
 * - Paused (load slots): shows 4 save slots for loading
 *
 * Notes:
 * - The simulation freezes when paused (via GameTimeService), but NO overlay
 *   appears unless ESC is pressed. The UI remains interactive.
 * - The ⏸ button toggles pause without opening the menu.
 * - ESC opens the pause menu (pause + overlay).
 */

@Component({
  selector: 'app-star-map-pause',
  standalone: true,
  templateUrl: './star-map-pause.component.html',
  styleUrl: './star-map-pause.component.scss'
})
export class StarMapPauseComponent {
  @Input() pauseMenuOpen = false;
  @Input() currentSlot: number | null = null;

  @Output() openPauseMenu = new EventEmitter<void>();
  @Output() closePauseMenu = new EventEmitter<void>();
  @Output() saveGame = new EventEmitter<void>();
  @Output() loadGame = new EventEmitter<number>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() exitToMainMenu = new EventEmitter<void>();

  showLoadSlots = false;
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
   * onSaveGame: Emits saveGame event and shows "GAME SAVED" toast for 2 seconds.
   * The actual save is handled by StarMap.
   */
  onSaveGame(): void {
    this.saveGame.emit();
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
  }

  onSelectSlot(slotIndex: number): void {
    this.loadGame.emit(slotIndex);
    this.showLoadSlots = false;
  }
}

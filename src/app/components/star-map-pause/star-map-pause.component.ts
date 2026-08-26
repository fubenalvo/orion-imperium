import { Component, Input, Output, EventEmitter } from '@angular/core';
import { SaveGameService, SaveSlot } from '../../services/save-game.service';

@Component({
  selector: 'app-star-map-pause',
  standalone: true,
  templateUrl: './star-map-pause.component.html',
  styleUrl: './star-map-pause.component.scss'
})
export class StarMapPauseComponent {
  @Input() isPaused = false;
  @Input() pauseMenuOpen = false;
  @Input() currentSlot: number | null = null;

  @Output() openPauseMenu = new EventEmitter<void>();
  @Output() closePauseMenu = new EventEmitter<void>();
  @Output() saveGame = new EventEmitter<void>();
  @Output() loadGame = new EventEmitter<number>();
  @Output() resumeGame = new EventEmitter<void>();
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

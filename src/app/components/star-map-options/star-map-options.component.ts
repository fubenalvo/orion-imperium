import { Component, inject, HostListener } from '@angular/core';
import { GameSettingsService } from '../../services/game-settings.service';

/*
 * =========================================================
 * STAR MAP OPTIONS COMPONENT
 * =========================================================
 *
 * Overlay options menu accessible from the main menu and the
 * pause menu. Currently exposes the fog-of-war toggle.
 *
 * Lifecycle:
 *   - Rendered conditionally by App via the optionsMenuOpen
 *     getter from GameSettingsService.
 *   - ESC key closes the overlay (document-level listener).
 *   - BACK button emits a close event.
 */

@Component({
  selector: 'app-star-map-options',
  standalone: true,
  templateUrl: './star-map-options.component.html',
  styleUrl: './star-map-options.component.scss',
})
export class StarMapOptionsComponent {
  private gameSettingsService = inject(GameSettingsService);

  readonly fogOfWarEnabled = this.gameSettingsService.fogOfWarEnabled;

  onToggleFogOfWar(): void {
    this.gameSettingsService.toggleFogOfWar();
  }

  onClose(): void {
    this.gameSettingsService.closeOptionsMenu();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.onClose();
  }
}

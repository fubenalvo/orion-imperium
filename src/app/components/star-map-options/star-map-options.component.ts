import { Component, inject, HostListener } from '@angular/core';
import { GameSettingsService } from '../../services/game-settings.service';
import { UiSoundService } from '../../services/ui-sound.service';
import { MusicService } from '../../services/music.service';
import { TutorialService } from '../../services/tutorial.service';
import { AiSettingsService } from '../../services/ai-settings.service';
import { FrameLimitService } from '../../services/frame-limit.service';

/*
 * =========================================================
 * STAR MAP OPTIONS COMPONENT
 * =========================================================
 *
 * Overlay options menu accessible from the main menu and the
 * pause menu: the fog-of-war toggle, the UI sounds toggle
 * (UiSoundService) and the music toggle and volume (MusicService),
 * both remembered in localStorage, the global ADAPTIVE AI toggle
 * (AiSettingsService, localStorage), the FPS LIMIT toggle
 * (FrameLimitService, localStorage), and — inside a game — the TUTORIAL
 * toggle and RESET TUTORIAL (TutorialService, saved with the game).
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

  readonly uiSound = inject(UiSoundService);
  readonly music = inject(MusicService);
  readonly aiSettings = inject(AiSettingsService);
  readonly frameLimit = inject(FrameLimitService);
  /* In a game only: the tutorial flag belongs to the running game (docs/tutorial-hints.md). */
  readonly tutorial = inject(TutorialService);

  onMusicVolume(event: Event): void {
    this.music.setVolume(Number((event.target as HTMLInputElement).value) / 100);
  }

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

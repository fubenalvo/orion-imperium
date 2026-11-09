import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GameSettingsService } from './services/game-settings.service';
import { TouchLongPressService } from './services/touch-long-press.service';
import { UiSoundService } from './services/ui-sound.service';
import { StarMapOptionsComponent } from './components/star-map-options/star-map-options.component';
import { OrientationGateComponent } from './components/orientation-gate/orientation-gate.component';
import { TutorialHintComponent } from './components/tutorial/tutorial-hint.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, StarMapOptionsComponent, OrientationGateComponent, TutorialHintComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  gameSettingsService = inject(GameSettingsService);

  constructor() {
    // Touch long-press acts as a right-click everywhere in the game.
    inject(TouchLongPressService).install();
    // Global UI sound listeners (button hover/press, dialog power on/off).
    inject(UiSoundService).install();
  }
}

import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GameSettingsService } from './services/game-settings.service';
import { TouchLongPressService } from './services/touch-long-press.service';
import { StarMapOptionsComponent } from './components/star-map-options/star-map-options.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, StarMapOptionsComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  gameSettingsService = inject(GameSettingsService);

  constructor() {
    // Touch long-press acts as a right-click everywhere in the game.
    inject(TouchLongPressService).install();
  }
}

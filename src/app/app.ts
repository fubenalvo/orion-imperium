import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GameSettingsService } from './services/game-settings.service';
import { StarMapOptionsComponent } from './components/star-map-options/star-map-options.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, StarMapOptionsComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  gameSettingsService = inject(GameSettingsService);
}

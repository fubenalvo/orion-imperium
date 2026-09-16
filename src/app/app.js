import { __decorate } from "tslib";
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GameSettingsService } from './services/game-settings.service';
import { StarMapOptionsComponent } from './components/star-map-options/star-map-options.component';
let App = class App {
    gameSettingsService = inject(GameSettingsService);
};
App = __decorate([
    Component({
        selector: 'app-root',
        imports: [RouterOutlet, StarMapOptionsComponent],
        templateUrl: './app.html',
        styleUrl: './app.scss',
    })
], App);
export { App };

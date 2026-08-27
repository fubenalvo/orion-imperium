import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { SaveGameService, SaveSlot } from '../services/save-game.service';
import { StarMapData } from '../components/star-map/star-map';
import starMapData from '../components/star-map/star-map-data.json';

/*
 * =========================================================
 * MAIN MENU COMPONENT
 * =========================================================
 *
 * Entry point of the application.
 * Provides New Game, Load Game, Options, and Credits buttons.
 *
 * New Game: Saves the default starMapData JSON into the selected slot,
 *           then navigates to /star-map.
 * Load Game: Reads saved data from the selected slot and navigates to /star-map.
 *            The actual state restoration happens in StarMap.ngOnInit().
 */

@Component({
  imports: [],
  selector: 'app-main-menu',
  styleUrl: './main-menu.scss',
  templateUrl: './main-menu.html',
})
export class MainMenu {
  showNewGameSlots = false;
  showLoadGameSlots = false;

  constructor(private saveGameService: SaveGameService, private router: Router) {}

  get slots(): SaveSlot[] {
    return this.saveGameService.getSlots();
  }

  get hasAnySave(): boolean {
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
   * newGame: Saves the default map data into the chosen slot and starts the game.
   * The starMapData JSON is cast to StarMapData; it contains the initial game state.
   */
  newGame(slotIndex: number): void {
    const defaultData = structuredClone(starMapData) as StarMapData;
    this.saveGameService.saveToSlot(slotIndex, defaultData);
    this.saveGameService.currentSlot = slotIndex;
    this.router.navigate(['/star-map']);
  }

  /*
   * loadGame: Sets the current slot and navigates to /star-map.
   * The actual data loading and state restoration is performed by StarMap.
   */
  loadGame(slotIndex: number): void {
    const data = this.saveGameService.loadFromSlot(slotIndex);
    if (!data) {
      return;
    }

    this.saveGameService.currentSlot = slotIndex;
    this.router.navigate(['/star-map']);
  }
}

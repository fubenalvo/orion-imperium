import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { SaveGameService, SaveSlot, SaveSlotId, MANUAL_SLOT_START } from '../services/save-game.service';
import { StarMapData } from '../components/star-map/star-map.models';
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
   *
   * After writing the manual snapshot, the slot is activated so the active
   * session is backed by the autosave slot. This keeps runtime saves and
   * battle results on the same slot that reloadAfterBattle / loadGame read.
   */
  newGame(slotIndex: number): void {
    if (slotIndex < MANUAL_SLOT_START) {
      return;
    }

    const defaultData = structuredClone(starMapData) as StarMapData;
    this.saveGameService.saveToSlot(slotIndex, defaultData);
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return;
    }
    this.router.navigate(['/star-map']);
  }

  /*
   * loadGame: Activates the chosen slot as the active session and navigates to
   * /star-map. Activation copies the manual snapshot into autosave and
   * switches currentSlot to 0, so subsequent gameplay writes and battle
   * results accumulate in the same slot that StarMap reads back. The actual
   * data loading and state restoration is performed by StarMap.
   */
  loadGame(slotIndex: number): void {
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return;
    }
    this.router.navigate(['/star-map']);
  }
}

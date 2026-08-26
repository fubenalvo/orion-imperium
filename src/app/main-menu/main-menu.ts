import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { SaveGameService, SaveSlot } from '../services/save-game.service';
import { StarMapData } from '../components/star-map/star-map';
import starMapData from '../components/star-map/star-map-data.json';

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

  newGame(slotIndex: number): void {
    const defaultData = starMapData as StarMapData;
    this.saveGameService.saveToSlot(slotIndex, defaultData);
    this.saveGameService.currentSlot = slotIndex;
    this.router.navigate(['/star-map']);
  }

  loadGame(slotIndex: number): void {
    const data = this.saveGameService.loadFromSlot(slotIndex);
    if (!data) {
      return;
    }

    this.saveGameService.currentSlot = slotIndex;
    this.router.navigate(['/star-map']);
  }
}

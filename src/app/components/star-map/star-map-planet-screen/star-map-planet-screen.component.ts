import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanetTile, PLANET_SURFACE_CELL_VW } from '../star-map.models';
import { FactionCurrenciesComponent } from '../faction-currencies/faction-currencies.component';

/*
 * =========================================================
 * PLANET SCREEN COMPONENT
 * =========================================================
 *
 * Renders the planet surface view: a grid (similar to the star map
 * grid but sized per planet) over a planet-type-colored background
 * with a noise texture.  The sidebar shows planet details and
 * action buttons (Build, Details, Back to Star Map).
 *
 * Grid dimension formula: gridSize = planetNumericSize * 2 + 3
 *   size 1 -> 5x5, size 2 -> 7x7, size 3 -> 9x9, size 4 -> 11x11
 */

@Component({
  selector: 'app-star-map-planet-screen',
  standalone: true,
  imports: [CommonModule, FactionCurrenciesComponent],
  templateUrl: './star-map-planet-screen.component.html',
  styleUrl: './star-map-planet-screen.component.scss',
})
export class StarMapPlanetScreenComponent {
  @Input() planet: PlanetTile | null = null;
  @Input() gridSize: number = 5;
  @Input() planetColor: string = '#ffffff';
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() getFactionCurrencies: (factionId: string) => { name: string; value: number }[] = () => [];
  @Input() getEnergyForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() getTaxForPlanet: (planet: PlanetTile) => number = () => 0;

  @Output() backToStarMap = new EventEmitter<void>();

  readonly cellVw = PLANET_SURFACE_CELL_VW;

  /** Returns an array [0, 1, ..., gridSize-1] for rendering grid cells. */
  get gridCells(): number[] {
    return Array.from({ length: this.gridSize }, (_, i) => i);
  }

  /** Returns the CSS grid template string for the planet surface grid. */
  get gridTemplateColumns(): string {
    return `repeat(${this.gridSize}, ${this.cellVw}vw)`;
  }
}

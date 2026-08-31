import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanetTile, PLANET_SURFACE_CELL_VW, PlanetEconomyEntry } from '../star-map.models';
import { FactionCurrenciesComponent } from '../faction-currencies/faction-currencies.component';
import planetData from '../planet-data.json';

export interface BuildingType {
  id: string;
  name: string;
  role: string;
  price: number;
  size: number;
  maintenanceCost: number;
  population: number;
  workforce: number;
  moraleRate: number;
  energyConsumption: number;
  energyProduction: number;
  defense: {
    type: string;
    attack?: number;
    attackType?: string;
    range?: number;
    weakness?: string;
    shield?: number;
    shieldRegen?: number;
  } | null;
}

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
 *
 * Build mode:
 * - After selecting a building type, the screen enters build mode.
 * - Clicking a grid cell highlights the potential building footprint.
 * - A BUILD button appears when the placement is valid.
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
  @Input() planetEconomy: PlanetEconomyEntry | null = null;
  @Input() getPlayerCredits: () => number = () => 0;
  @Input() onSelectBuildingType: (buildingId: string) => void = () => {};
  @Input() onConfirmBuild: (buildingId: string, x: number, y: number) => void = () => {};

  @Output() backToStarMap = new EventEmitter<void>();
  @Output() buildConfirmed = new EventEmitter<{ buildingId: string; x: number; y: number }>();

  readonly cellVw = PLANET_SURFACE_CELL_VW;
  readonly buildingTypes: BuildingType[] = (planetData as { buildings: BuildingType[] }).buildings;

  showBuildMenu = false;
  isBuildMode = false;
  selectedBuildingType: BuildingType | null = null;
  selectedCell: { row: number; col: number } | null = null;
  previewCells: Set<string> = new Set();
  isPreviewValid = false;
  buildError = '';

  /** Returns an array [0, 1, ..., gridSize-1] for rendering grid cells. */
  get gridCells(): number[] {
    return Array.from({ length: this.gridSize }, (_, i) => i);
  }

  /** Returns the CSS grid template string for the planet surface grid. */
  get gridTemplateColumns(): string {
    return `repeat(${this.gridSize}, ${this.cellVw}vw)`;
  }

  openBuildMenu(): void {
    this.showBuildMenu = true;
  }

  closeBuildMenu(): void {
    this.showBuildMenu = false;
  }

  exitBuildMode(): void {
    this.isBuildMode = false;
    this.selectedBuildingType = null;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
  }

  selectBuildingType(buildingId: string): void {
    const building = this.buildingTypes.find((b) => b.id === buildingId) ?? null;
    this.selectedBuildingType = building;
    this.isBuildMode = true;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
    this.closeBuildMenu();
  }

  onCellClick(row: number, col: number): void {
    if (!this.isBuildMode || !this.selectedBuildingType) {
      return;
    }

    this.selectedCell = { row, col };
    this.updatePreview(row, col);
  }

  private updatePreview(row: number, col: number): void {
    if (!this.selectedBuildingType) {
      return;
    }

    const size = this.selectedBuildingType.size;
    this.previewCells = new Set<string>();

    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        this.previewCells.add(`${r},${c}`);
      }
    }

    const fitsGrid = col + size <= this.gridSize && row + size <= this.gridSize;
    if (!fitsGrid) {
      this.isPreviewValid = false;
      this.buildError = 'This area does not fit the building.';
      return;
    }

    const overlaps = (this.planet?.buildings ?? []).some((b) => {
      const bSize = b.size;
      return col < b.x + bSize && col + size > b.x && row < b.y + bSize && row + size > b.y;
    });

    if (overlaps) {
      this.isPreviewValid = false;
      this.buildError = 'Area overlaps with existing buildings.';
      return;
    }

    this.isPreviewValid = true;
    this.buildError = '';
  }

  confirmBuild(): void {
    if (!this.isPreviewValid || !this.selectedCell || !this.selectedBuildingType) {
      return;
    }

    const { col, row } = this.selectedCell;
    this.buildConfirmed.emit({
      buildingId: this.selectedBuildingType.id,
      x: col,
      y: row,
    });
    this.onConfirmBuild(this.selectedBuildingType.id, col, row);
    this.exitBuildMode();
  }

  canAfford(building: BuildingType): boolean {
    return this.getPlayerCredits() >= building.price;
  }

  isCellInPreview(row: number, col: number): boolean {
    return this.previewCells.has(`${row},${col}`);
  }
}

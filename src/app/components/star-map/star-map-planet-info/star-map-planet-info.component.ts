import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpperCasePipe } from '@angular/common';
import { PlanetTile, PlanetEconomyEntry } from '../star-map.models';

@Component({
  selector: 'app-star-map-planet-info',
  standalone: true,
  imports: [CommonModule, UpperCasePipe],
  templateUrl: './star-map-planet-info.component.html',
  styleUrl: './star-map-planet-info.component.scss',
})
export class StarMapPlanetInfoComponent {
  @Input() planet: PlanetTile | null = null;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getEnergyForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() getTaxForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() planetEconomy: PlanetEconomyEntry | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() openPlanet = new EventEmitter<void>();
}

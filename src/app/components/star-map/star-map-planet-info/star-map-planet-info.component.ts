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

  get groupedBuildings(): Array<{ name: string; count: number }> {
    if (!this.planet?.buildings) {
      return [];
    }
    const map = new Map<string, number>();
    for (const b of this.planet.buildings) {
      const key = b.id ?? b.name;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count }));
  }
}

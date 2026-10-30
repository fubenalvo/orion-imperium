import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UpperCasePipe } from '@angular/common';
import { PlanetTile, PlanetEconomyEntry } from '../star-map.models';

/*
 * Colonization guidance for an uninhabited planet, built by StarMap. The
 * panel only explains the next step: colonizing is done with the COLONIZE
 * button of the fleet panel, which appears when a player fleet with a
 * colonizer is parked on the planet.
 *   parked    - a colonizer fleet is on the planet and can colonize now
 *   en_route  - a colonizer fleet is ordered onto the planet
 *   in_system - a colonizer fleet is in this system elsewhere
 *   none      - no player colonizer fleet in this system
 */
export interface PlanetColonizationVm {
  status: 'parked' | 'en_route' | 'in_system' | 'none';
  fleetName: string | null;
}

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
  @Input() colonization: PlanetColonizationVm | null = null;

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

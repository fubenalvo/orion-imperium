import { Component, Input, Output, EventEmitter } from '@angular/core';
import { PlanetTile, PlanetEconomyEntry } from '../star-map.models';
import { PlanetDetailsComponent } from '../planet-details/planet-details.component';

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

/*
 * System view planet card (bottom left). Its body is PlanetDetailsComponent,
 * the same minimal summary as the planet view's DETAILS tab, plus the
 * colonization note and the OPEN PLANET action.
 */
@Component({
  selector: 'app-star-map-planet-info',
  standalone: true,
  imports: [PlanetDetailsComponent],
  templateUrl: './star-map-planet-info.component.html',
  styleUrl: './star-map-planet-info.component.scss',
})
export class StarMapPlanetInfoComponent {
  @Input() planet: PlanetTile | null = null;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() planetEconomy: PlanetEconomyEntry | null = null;
  @Input() colonization: PlanetColonizationVm | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() openPlanet = new EventEmitter<void>();
}

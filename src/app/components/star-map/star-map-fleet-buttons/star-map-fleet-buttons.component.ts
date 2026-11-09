import { TutorialAnchorDirective } from '../../tutorial/tutorial-anchor.directive';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Fleet, PlanetTile, StarSystem } from '../star-map.models';

/** A player-owned planet together with the system it belongs to. */
export interface RosterPlanet {
  system: StarSystem;
  planet: PlanetTile;
}

/*
 * Top-left roster on the galaxy map: the player's planets (click opens the
 * planet surface view directly) above the player's fleets (click selects).
 * Both lists share one positioned column so they stack without overlapping.
 */
@Component({
  selector: 'app-star-map-fleet-buttons',
  standalone: true,
  imports: [CommonModule, TutorialAnchorDirective],
  templateUrl: './star-map-fleet-buttons.component.html',
  styleUrl: './star-map-fleet-buttons.component.scss',
})
export class StarMapFleetButtonsComponent {
  @Input() fleets: Fleet[] = [];
  @Input() systems: StarSystem[] = [];
  @Input() selectedFleetId: number | null = null;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';

  @Output() selectFleet = new EventEmitter<Fleet>();
  @Output() openPlanet = new EventEmitter<RosterPlanet>();

  get playerFleets(): Fleet[] {
    return this.fleets.filter((fleet) => fleet.factionId === 'player');
  }

  get playerPlanets(): RosterPlanet[] {
    const result: RosterPlanet[] = [];
    for (const system of this.systems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId === 'player') {
          result.push({ system, planet });
        }
      }
    }
    return result;
  }
}

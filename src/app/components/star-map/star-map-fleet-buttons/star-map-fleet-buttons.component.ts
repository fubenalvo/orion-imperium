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
 *
 * The planet view reuses it planets-only (`showFleets` off): the open planet
 * is highlighted (`selectedPlanetId`) and ◀ ▶ step through the player's
 * planets in roster order (a planet outside the list steps to the first or
 * last one). The `roster.planet` tutorial anchor belongs to the galaxy
 * map copy only, so the planet-view copy does not register it.
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
  @Input() showFleets = true;
  @Input() selectedPlanetId: number | null = null;

  @Output() selectFleet = new EventEmitter<Fleet>();
  @Output() openPlanet = new EventEmitter<RosterPlanet>();

  /* ◀ / ▶: opens the previous / next player planet, wrapping around. */
  step(direction: -1 | 1): void {
    const planets = this.playerPlanets;
    if (planets.length === 0) return;
    const index = planets.findIndex((entry) => entry.planet.id === this.selectedPlanetId);
    const next =
      index < 0
        ? direction > 0 ? 0 : planets.length - 1
        : (index + direction + planets.length) % planets.length;
    this.openPlanet.emit(planets[next]);
  }

  get playerFleets(): Fleet[] {
    if (!this.showFleets) return [];
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

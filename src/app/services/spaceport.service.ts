import { Injectable } from '@angular/core';
import { PlanetTile, StarSystem } from '../components/star-map/star-map.models';

export interface SpaceportLocation {
  system: StarSystem;
  planet: PlanetTile;
}

/*
 * SpaceportService
 * ----------------
 * The `Spaceport` building is a permission flag, not a storage depot. This
 * service answers "does the faction have at least one Spaceport?" and
 * "which planets act as assembly points?". Ships are not stored here; they
 * live in the global stock.
 */
@Injectable({ providedIn: 'root' })
export class SpaceportService {
  private static readonly SPACEPORT_NAME = 'Spaceport';

  hasSpaceport(factionId: string, starSystems: StarSystem[]): boolean {
    return this.listSpaceports(factionId, starSystems).length > 0;
  }

  listSpaceports(factionId: string, starSystems: StarSystem[]): SpaceportLocation[] {
    const out: SpaceportLocation[] = [];
    for (const system of starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId !== factionId) {
          continue;
        }
        if (this.isSpaceportPlanet(planet)) {
          out.push({ system, planet });
        }
      }
    }
    return out;
  }

  isSpaceportPlanet(planet: PlanetTile | null | undefined): boolean {
    if (!planet) {
      return false;
    }
    return (planet.buildings ?? []).some((b) => b.name === SpaceportService.SPACEPORT_NAME);
  }
}

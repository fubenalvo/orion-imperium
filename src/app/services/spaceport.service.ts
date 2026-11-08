import { Injectable } from '@angular/core';
import { operationalBuildings } from '../components/star-map/building-construction';
import { Fleet, PlanetTile, StarSystem } from '../components/star-map/star-map.models';
import { SYSTEM_PLANET_FOOTPRINT, planetFootprintOrigin, systemCellAtVw } from '../components/star-map/system-grid';

/* Equipment can be installed within this many system cells of an own Spaceport planet (docs/ship-equipment.md, B.6). */
export const EQUIPMENT_SPACEPORT_RANGE_CELLS = 2;

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

  /*
   * The faction's Spaceport at a galaxy cell (`floor(x)`, `floor(y)`), if
   * any. Ships may only move between the global stock and a fleet when the
   * fleet stands on such a cell (docs/fleet-organization.md#reserve).
   */
  spaceportAt(factionId: string, position: { x: number; y: number }, starSystems: StarSystem[]): SpaceportLocation | null {
    const col = Math.floor(position.x);
    const row = Math.floor(position.y);
    return (
      this.listSpaceports(factionId, starSystems).find(
        ({ system }) => Math.floor(system.x) === col && Math.floor(system.y) === row,
      ) ?? null
    );
  }

  /*
   * The faction's Spaceport planet the fleet is close enough to for
   * installing equipment, or null. Stricter than spaceportAt (the reserve
   * rule, whole star system): the fleet must have an in-system position in
   * that system and stand within `maxCells` system cells of the planet's
   * 2 × 2 footprint, measured as the Chebyshev distance (diagonal steps
   * count as one, like the 8-direction grid) to the nearest footprint cell;
   * on the planet = 0. A fleet without an in-system position never
   * qualifies.
   */
  spaceportPlanetNear(
    factionId: string,
    fleet: Pick<Fleet, 'x' | 'y' | 'system'>,
    starSystems: StarSystem[],
    maxCells = EQUIPMENT_SPACEPORT_RANGE_CELLS,
  ): SpaceportLocation | null {
    const location = fleet.system;
    if (!location || location.id == null) {
      return null;
    }
    const cell = systemCellAtVw(location.x, location.y);
    const col = Math.floor(fleet.x);
    const row = Math.floor(fleet.y);
    for (const spaceport of this.listSpaceports(factionId, starSystems)) {
      const { system, planet } = spaceport;
      if (system.id !== location.id || Math.floor(system.x) !== col || Math.floor(system.y) !== row) {
        continue;
      }
      if (SpaceportService.cellsToFootprint(cell, planetFootprintOrigin(planet)) <= maxCells) {
        return spaceport;
      }
    }
    return null;
  }

  /* Chebyshev distance from a cell to the nearest cell of a footprint starting at `origin`. */
  private static cellsToFootprint(cell: { col: number; row: number }, origin: { col: number; row: number }): number {
    const last = SYSTEM_PLANET_FOOTPRINT - 1;
    const dx = Math.max(0, origin.col - cell.col, cell.col - (origin.col + last));
    const dy = Math.max(0, origin.row - cell.row, cell.row - (origin.row + last));
    return Math.max(dx, dy);
  }

  isSpaceportPlanet(planet: PlanetTile | null | undefined): boolean {
    if (!planet) {
      return false;
    }
    return operationalBuildings(planet).some((b) => b.name === SpaceportService.SPACEPORT_NAME);
  }
}

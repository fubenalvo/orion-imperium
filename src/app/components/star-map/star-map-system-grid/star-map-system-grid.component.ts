import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { Fleet, FleetTrail, PlanetTile, StarSystem, SystemAsteroid } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';
import { FleetShipComponent } from '../fleet-ship/fleet-ship.component';
import {
  SYSTEM_PLANET_FOOTPRINT,
  SYSTEM_SUN_CENTER_X_VW,
  SYSTEM_SUN_CENTER_Y_VW,
} from '../system-grid';

/*
 * The star's center (system-grid.ts) follows from the .sun placement in the
 * SCSS: an implicit 37th column at x = 36 * 2.5vw, shifted right by
 * `left: 5vw`, spanning rows 5-10 (y 10vw..25vw). Keep both in sync if the
 * sun is moved.
 */
export { SYSTEM_SUN_CENTER_X_VW, SYSTEM_SUN_CENTER_Y_VW } from '../system-grid';

/*
 * =========================================================
 * STAR MAP SYSTEM GRID VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of StarMap: renders the star system
 * view grid (sun, system-view sensor highlights, planets,
 * fleets inside the system, and the movement target marker).
 *
 * All simulation/selection logic stays in the parent. Event
 * handlers are provided as @Input functions by the parent and
 * are invoked synchronously during the native event dispatch,
 * so `currentTarget`, `stopPropagation`, and `preventDefault`
 * behave exactly like inline bindings.
 */
@Component({
  selector: 'app-star-map-system-grid',
  standalone: true,
  imports: [NgClass, FleetShipComponent],
  templateUrl: './star-map-system-grid.component.html',
  styleUrl: './star-map-system-grid.component.scss',
})
export class StarMapSystemGridViewComponent {
  @Input() selectedSystem: StarSystem | null = null;
  @Input() selectedFleet: Fleet | null = null;
  @Input() fleets: Fleet[] = [];
  @Input() targetX: number | null = null;
  @Input() targetY: number | null = null;
  @Input() sensorRangeEnabled = true;
  @Input() systemSensorCells: {
    cells: { col: number; row: number }[];
    preview: { col: number; row: number }[];
  } = { cells: [], preview: [] };
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  /* Screen heading of a fleet's ship in this view (CSS rotate degrees); see fleet-heading.ts. */
  @Input() fleetHeading: (fleet: Fleet) => number = () => 0;
  @Input() getPlanetClassNames: (planet: PlanetTile) => string[] = () => [];

  /*
   * Diameter (vw) of the decorative orbit ring that passes through a
   * planet's cell center around the star. Purely visual: planets do not
   * move along it.
   */
  orbitDiameterVw(planet: PlanetTile): number {
    const center = this.movementService.getPlanetCellCenter(planet);
    return 2 * Math.hypot(SYSTEM_SUN_CENTER_X_VW - center.x, SYSTEM_SUN_CENTER_Y_VW - center.y);
  }

  /* CSS grid placement of a planet's footprint block. */
  planetGridColumn(planet: PlanetTile): string {
    return `${this.movementService.getPlanetGridPosition(planet).col} / span ${SYSTEM_PLANET_FOOTPRINT}`;
  }

  planetGridRow(planet: PlanetTile): string {
    return `${this.movementService.getPlanetGridPosition(planet).row} / span ${SYSTEM_PLANET_FOOTPRINT}`;
  }

  /*
   * Stable per-cell look of an asteroid (rotation, size, nudge), hashed from
   * its cell so it never changes between frames or loads. Render-only.
   */
  asteroidShape(asteroid: SystemAsteroid): { rotate: string; scale: number; dx: string; dy: string } {
    let h = Math.imul(asteroid.col * 73856093 ^ asteroid.row * 19349663, 0x9e3779b1);
    const next = () => {
      h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
      return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
    };
    return {
      rotate: `${Math.round(next() * 360)}deg`,
      scale: 0.7 + next() * 0.6,
      dx: `${(next() - 0.5) * 0.6}vw`,
      dy: `${(next() - 0.5) * 0.6}vw`,
    };
  }
  @Input() trails: FleetTrail[] = [];

  /*
   * getTrailTransform: Computes the CSS transform for a movement-trail div
   * that runs from (x1, y1) to (x2, y2) in vw units (system view uses vw
   * directly). The div is positioned at the start point with its left edge
   * there (transform-origin: 0 0), stretched to the line length along the
   * X axis, then rotated around the origin to point toward the target.
   * Returns null when the trail is degenerate so the template can hide it.
   */
  getTrailTransform(trail: FleetTrail): string | null {
    const dx = trail.x2 - trail.x1;
    const dy = trail.y2 - trail.y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.0001) {
      return null;
    }
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    return `rotate(${angleDeg}deg)`;
  }

  /** Returns the line length in vw, or 0 when the trail is degenerate. */
  getTrailLength(trail: FleetTrail): number {
    const dx = trail.x2 - trail.x1;
    const dy = trail.y2 - trail.y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  @Input() onSystemGridClick: (event: MouseEvent) => void = () => {};
  @Input() onPlanetClick: (planet: PlanetTile, event: MouseEvent) => void = () => {};
  @Input() onFleetClick: (fleet: Fleet, event: MouseEvent) => void = () => {};
  /* Right-click handlers: with a player fleet selected they issue move orders. */
  @Input() onSystemGridContextMenu: (event: MouseEvent) => void = () => {};
  @Input() onPlanetContextMenu: (planet: PlanetTile, event: MouseEvent) => void = () => {};
  @Input() onFleetContextMenu: (fleet: Fleet, event: MouseEvent) => void = () => {};

  constructor(public movementService: StarMapMovementService) {}
}

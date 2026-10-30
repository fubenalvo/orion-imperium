import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { Fleet, FleetTrail, PlanetTile, StarSystem } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';
import { FleetShipComponent } from '../fleet-ship/fleet-ship.component';

/*
 * Center of the system's star in system-grid coordinates (vw). It follows
 * from the .sun placement in _star-map-system-view.scss: an implicit 19th
 * column at x = 18 * 5vw, shifted right by `left: 5vw`, spanning rows 3-5
 * (y 10vw..25vw). Keep both in sync if the sun is moved.
 */
export const SYSTEM_SUN_CENTER_X_VW = 95;
export const SYSTEM_SUN_CENTER_Y_VW = 17.5;
/* System grid cell size (vw); matches grid-template-columns in the SCSS. */
const SYSTEM_CELL_VW = 5;

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
    const cell = this.movementService.getPlanetGridPosition(planet);
    const x = (cell.col - 0.5) * SYSTEM_CELL_VW;
    const y = (cell.row - 0.5) * SYSTEM_CELL_VW;
    return 2 * Math.hypot(SYSTEM_SUN_CENTER_X_VW - x, SYSTEM_SUN_CENTER_Y_VW - y);
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

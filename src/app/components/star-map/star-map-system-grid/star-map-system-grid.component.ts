import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { Fleet, PlanetTile, StarSystem } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';

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
  imports: [NgClass],
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
  @Input() getPlanetClassNames: (planet: PlanetTile) => string[] = () => [];

  @Input() onSystemGridClick: (event: MouseEvent) => void = () => {};
  @Input() onPlanetClick: (planet: PlanetTile, event: MouseEvent) => void = () => {};
  @Input() onFleetClick: (fleet: Fleet, event: MouseEvent) => void = () => {};
  @Input() onPlanetContextMenu: (event: MouseEvent) => void = () => {};
  @Input() onFleetContextMenu: (event: MouseEvent) => void = () => {};

  constructor(public movementService: StarMapMovementService) {}
}

import { Component, Input } from '@angular/core';
import { Fleet, StarSystem } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';
import { SensorCellInfo, SensorPreviewCellInfo } from '../star-map-sensor.service';

/*
 * =========================================================
 * STAR MAP GALAXY VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of StarMap: renders the galaxy map
 * viewport (world grid, fog-of-war cells, sensor highlights,
 * star systems, fleets, and the movement target marker).
 *
 * All simulation/selection/camera logic stays in the parent.
 * Event handlers are provided as @Input functions by the
 * parent and are invoked synchronously during the native
 * event dispatch, so `currentTarget`, `stopPropagation`, and
 * `preventDefault` behave exactly like inline bindings.
 */
@Component({
  selector: 'app-star-map-galaxy-view',
  standalone: true,
  templateUrl: './star-map-galaxy-view.component.html',
  styleUrl: './star-map-galaxy-view.component.scss',
})
export class StarMapGalaxyViewComponent {
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 0;
  @Input() gridRows = 0;
  @Input() sensorRangeEnabled = true;
  @Input() fogCells: { col: number; row: number; explored: boolean }[] = [];
  @Input() sensorRangeCells: SensorCellInfo[] = [];
  @Input() sensorPreviewCells: SensorPreviewCellInfo[] = [];
  @Input() systems: StarSystem[] = [];
  @Input() fleets: Fleet[] = [];
  @Input() selectedSystem: StarSystem | null = null;
  @Input() selectedFleet: Fleet | null = null;
  @Input() targetX: number | null = null;
  @Input() targetY: number | null = null;
  @Input() isEnemyInPreview: (fleet: Fleet) => boolean = () => false;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';

  @Input() onMapClick: (event: MouseEvent) => void = () => {};
  @Input() onPointerDown: (event: PointerEvent) => void = () => {};
  @Input() onPointerMove: (event: PointerEvent) => void = () => {};
  @Input() onPointerUp: (event: PointerEvent) => void = () => {};
  @Input() onSystemClick: (system: StarSystem, event: MouseEvent) => void = () => {};
  @Input() onFleetClick: (fleet: Fleet, event: MouseEvent) => void = () => {};
  @Input() onSystemContextMenu: (event: MouseEvent) => void = () => {};
  @Input() onFleetContextMenu: (event: MouseEvent) => void = () => {};

  constructor(public movementService: StarMapMovementService) {}
}

import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { AsteroidType, Fleet, FleetTrail, StarSystem, SpecialObject } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';
import { StarMapBlackholeComponent } from '../blackhole/blackhole.component';
import { SensorCellInfo, SensorPreviewCellInfo } from '../star-map-sensor.service';
import { blackHoleNavigationRadius } from '../fleet-navigation';
import { BeltView } from '../asteroid-belts';
import { FleetShipComponent } from '../fleet-ship/fleet-ship.component';

/* Pre-built SVG paths of one nebula (grid units; see nebulaSvgPath). */
export interface NebulaView {
  id: number;
  color: string;
  halo: string;
  body: string;
  core: string;
  /* Center (SVG grid units) and side of the square gas-texture image. */
  cx: number;
  cy: number;
  textureSize: number;
  /* Texture rotation in degrees (from the nebula's shape rotation), so
     nebulae sharing the one texture still look different. */
  rotationDeg: number;
}

/*
 * One empire's territory as SVG paths in grid units (territory.ts
 * buildTerritoryShapes) plus its render color. `own` marks the player's
 * territory, drawn with a solid border; foreign borders are dashed.
 */
export interface TerritoryShapeView {
  factionId: string;
  fill: string;
  border: string;
  color: string;
  own: boolean;
}

/* A space base marker, positioned in world vw like fleets. */
export interface SpaceBaseMapView {
  id: number;
  name: string;
  ownerName: string;
  color: string;
  own: boolean;
  left: number;
  top: number;
  /* Claim radius in world vw (TERRITORY_CONFIG.baseClaimRadius cells). */
  claimRadiusVw: number;
}

/* Black hole no-fly zone outline in SVG grid units. */
export interface BlackHoleRingView {
  cx: number;
  cy: number;
  r: number;
}

/* A visible drifting asteroid, positioned in world vw like fleets. */
export interface AsteroidMapView {
  id: number;
  type: AsteroidType;
  label: string;
  left: number;
  top: number;
  trailLength: number;
  angleDeg: number;
  selected: boolean;
  /* A player fleet has an intercept order on it. */
  targeted: boolean;
}

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
  imports: [StarMapBlackholeComponent, FleetShipComponent],
  templateUrl: './star-map-galaxy-view.component.html',
  styleUrl: './star-map-galaxy-view.component.scss',
})
export class StarMapGalaxyViewComponent {
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() zoom = 1;
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
  @Input() specialObjects: SpecialObject[] = [];
  @Input() nebulae: NebulaView[] = [];
  @Input() belts: BeltView[] = [];
  @Input() blackHoleRings: BlackHoleRingView[] = [];
  @Input() asteroids: AsteroidMapView[] = [];
  @Input() territories: TerritoryShapeView[] = [];
  @Input() spaceBases: SpaceBaseMapView[] = [];
  /* Base marker click (info only; the click also reaches the map, so move orders still work). */
  @Input() onSpaceBaseClick: (baseId: number) => void = () => {};
  @Input() isFleetInNebula: (fleet: Fleet) => boolean = () => false;
  /* Screen heading of a fleet's ship (CSS rotate degrees); see fleet-heading.ts. */
  @Input() fleetHeading: (fleet: Fleet) => number = () => 0;
  @Input() onAsteroidClick: (asteroidId: number, event: MouseEvent) => void = () => {};
  @Input() selectedSystem: StarSystem | null = null;
  @Input() selectedFleet: Fleet | null = null;
  @Input() targetX: number | null = null;
  @Input() targetY: number | null = null;
  @Input() trails: FleetTrail[] = [];
  @Input() isEnemyInPreview: (fleet: Fleet) => boolean = () => false;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';

  @Input() onMapClick: (event: MouseEvent) => void = () => {};
  @Input() onPointerDown: (event: PointerEvent) => void = () => {};
  @Input() onPointerMove: (event: PointerEvent) => void = () => {};
  @Input() onPointerUp: (event: PointerEvent) => void = () => {};
  @Input() onWheel: (event: WheelEvent) => void = () => {};
  @Input() onSystemClick: (system: StarSystem, event: MouseEvent) => void = () => {};
  @Input() onFleetClick: (fleet: Fleet, event: MouseEvent) => void = () => {};
  /* Right-click handlers: with a player fleet selected they issue move/attack/intercept orders. */
  @Input() onMapContextMenu: (event: MouseEvent) => void = () => {};
  @Input() onSystemContextMenu: (system: StarSystem, event: MouseEvent) => void = () => {};
  @Input() onFleetContextMenu: (fleet: Fleet, event: MouseEvent) => void = () => {};
  @Input() onAsteroidContextMenu: (asteroidId: number, event: MouseEvent) => void = () => {};

  constructor(public movementService: StarMapMovementService) {}

  /*
   * Size of the black hole visual in world vw, derived from its no-fly
   * radius so the rendered photon ring matches the forbidden area exactly
   * at every zoom level and window width (the visual used to be sized in px).
   */
  blackHoleRadiusVw(obj: SpecialObject): number {
    return blackHoleNavigationRadius(obj) * this.cellSizeVw;
  }

  trackTrail(trail: FleetTrail): string {
    return `${trail.fleetId}-${trail.segment ?? 0}`;
  }

  /*
   * The camera is in world (unscaled) vw, so the translation is multiplied
   * by zoom to convert it to screen vw before scale() is applied. This
   * relies on .map-world having transform-origin: 0 0; with any other
   * origin the scale would shift the world and break screen->world math.
   */
  get worldTransform(): string {
    return `translate(${-this.cameraX * this.zoom}vw, ${-this.cameraY * this.zoom}vw) scale(${this.zoom})`;
  }

  /*
   * getTrailTransform: Computes the CSS transform for a movement-trail div
   * that runs from (x1, y1) to (x2, y2) in vw units.
   *
   * The div is positioned at the start point with its left edge there
   * (transform-origin: 0 0), stretched to the line length along the X axis,
   * then rotated around the origin to point toward the target. This avoids
   * needing an SVG/canvas element — pure HTML/CSS.
   *
   * Returns a CSS transform string, or null when the trail has zero length
   * (fleet already at its target) so the template can hide it.
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
}

import { TutorialAnchorDirective } from '../../tutorial/tutorial-anchor.directive';
import { AfterViewChecked, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { NgClass } from '@angular/common';
import { AsteroidType, Fleet, FleetTrail, StarSystem, SpecialObject } from '../star-map.models';
import { StarMapMovementService } from '../star-map-movement.service';
import { StarMapBlackholeComponent } from '../blackhole/blackhole.component';
import { SensorCellInfo, SensorPreviewCellInfo } from '../star-map-sensor.service';
import { blackHoleNavigationRadius } from '../fleet-navigation';
import { BeltView } from '../asteroid-belts';
import { FleetShipComponent } from '../fleet-ship/fleet-ship.component';
import { FogLayerPainter } from './fog-layer';

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

const STATION_TURRET_SLOTS: readonly number[] = [0, 1, 2];

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
  /* Defense turrets (owner's Turret Research level, 0–3; station-defense.ts). */
  turrets: number;
  /* Construction site (station-construction.ts): no claim, no turrets yet. */
  building: boolean;
  /* 0 … 1 share of the construction done; 1 for a complete base. */
  buildProgress: number;
  /* Ring slot of a Dyson anchor; null for an ordinary base. */
  dysonSlot: number | null;
  /* Its panel is open (anchors only). */
  selected: boolean;
}

/*
 * The Dyson ring around the black hole (dyson-ring.ts) in SVG grid units:
 * one annular-sector path per wedge and the empty anchor slots.
 */
export interface DysonRingView {
  wedges: string[];
  slots: { index: number; cx: number; cy: number }[];
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
 * A visible travelling civilian trader (docs/trade-network.md), in world vw.
 * Docked traders are not drawn: they sit on their star system.
 */
export interface TraderMapView {
  id: number;
  left: number;
  top: number;
  /* Screen heading toward the next route point (CSS rotate degrees). */
  angleDeg: number;
  /* Home post owner's color (neutral civilians: the independent gold). */
  color: string;
  label: string;
  selected: boolean;
}

/*
 * A discovered but unvisited exploration anomaly (docs/exploration-anomalies.md),
 * in world vw. System and asteroid sites are drawn at the corner of the
 * star's cell (`inSystem`). The type is not revealed before a visit.
 */
export interface AnomalyMapView {
  id: number;
  left: number;
  top: number;
  inSystem: boolean;
  title: string;
}

/*
 * =========================================================
 * STAR MAP GALAXY VIEW COMPONENT
 * =========================================================
 *
 * Presentational child of StarMap: renders the galaxy map
 * viewport (world grid, fog-of-war layer, sensor highlights,
 * star systems, fleets, and the movement target marker).
 *
 * All simulation/selection/camera logic stays in the parent.
 * Event handlers are provided as @Input functions by the
 * parent and are invoked synchronously during the native
 * event dispatch, so `currentTarget`, `stopPropagation`, and
 * `preventDefault` behave exactly like inline bindings.
 */
/* A campaign site on the galaxy map (Mission 6's archives): claimant color, or the player's hold progress (0–1). */
export interface CampaignSiteView {
  id: string;
  x: number;
  y: number;
  name: string;
  active: boolean;
  claimedBy: string | null;
  color: string | null;
  progress: number;
}

@Component({
  selector: 'app-star-map-galaxy-view',
  standalone: true,
  imports: [StarMapBlackholeComponent, FleetShipComponent, TutorialAnchorDirective],
  templateUrl: './star-map-galaxy-view.component.html',
  styleUrl: './star-map-galaxy-view.component.scss',
})
export class StarMapGalaxyViewComponent implements AfterViewChecked {
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() zoom = 1;
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 0;
  @Input() gridRows = 0;
  @Input() sensorRangeEnabled = true;
  /* Cells the player has ever sensed (StarMap.exploredGridCells; only grows). Drawn by the fog layer, see fog-layer.ts. */
  @Input() exploredCells: ReadonlySet<string> = new Set();
  @Input() sensorRangeCells: SensorCellInfo[] = [];
  @Input() sensorPreviewCells: SensorPreviewCellInfo[] = [];
  @Input() systems: StarSystem[] = [];
  @Input() fleets: Fleet[] = [];
  @Input() specialObjects: SpecialObject[] = [];
  /* Campaign sites (explored ones only, StarMap.campaignSiteViews). */
  @Input() campaignSites: CampaignSiteView[] = [];
  /* Campaign wormhole mouths (explored ones only, StarMap.wormholeViews). */
  @Input() wormholes: { key: string; x: number; y: number; name: string; active: boolean }[] = [];
  @Input() nebulae: NebulaView[] = [];
  @Input() belts: BeltView[] = [];
  @Input() blackHoleRings: BlackHoleRingView[] = [];
  @Input() dysonRing: DysonRingView | null = null;

  /* An anchor stands on this ring slot, so its empty-slot marker is hidden. */
  isDysonSlotTaken(slot: number): boolean {
    return this.spaceBases.some((b) => b.dysonSlot === slot);
  }
  @Input() asteroids: AsteroidMapView[] = [];
  @Input() traders: TraderMapView[] = [];
  /* Fleets a player fleet is pursuing with an attack order (marked like an intercepted asteroid). */
  @Input() attackTargetIds: ReadonlySet<number> = new Set();
  /* Fleets being repaired right now (StarMap.updateFleetRepair): green repair aura. */
  @Input() repairingFleetIds: ReadonlySet<number> = new Set();
  @Input() territories: TerritoryShapeView[] = [];
  @Input() spaceBases: SpaceBaseMapView[] = [];
  @Input() anomalies: AnomalyMapView[] = [];

  /* One entry per visible turret pip (template iteration helper). */
  turretSlots(count: number): readonly number[] {
    return STATION_TURRET_SLOTS.slice(0, Math.max(0, count));
  }
  /* Base marker click (info only; the click also reaches the map, so move orders still work). */
  @Input() onSpaceBaseClick: (baseId: number) => void = () => {};
  @Input() isFleetInNebula: (fleet: Fleet) => boolean = () => false;
  /* Screen heading of a fleet's ship (CSS rotate degrees); see fleet-heading.ts. */
  @Input() fleetHeading: (fleet: Fleet) => number = () => 0;
  @Input() onAsteroidClick: (asteroidId: number, event: MouseEvent) => void = () => {};
  @Input() onTraderClick: (traderId: number, event: MouseEvent) => void = () => {};
  /* Right-click on a trader with a player fleet selected: raid order. */
  @Input() onTraderContextMenu: (traderId: number, event: MouseEvent) => void = () => {};
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

  /* Present only while fog is on (the canvas sits inside @if). */
  @ViewChild('fogCanvas') fogCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fogImage') fogImage?: ElementRef<HTMLImageElement>;
  private readonly fogPainter = new FogLayerPainter();

  constructor(public movementService: StarMapMovementService) {}

  /*
   * Redraws the fog canvas after each check. The painter skips the work when
   * the explored set and the sensed cells did not change, so this is cheap
   * on frames where only other things moved.
   */
  ngAfterViewChecked(): void {
    const canvas = this.fogCanvas?.nativeElement;
    const image = this.fogImage?.nativeElement;
    if (!canvas || !image) return;
    // A re-created image (fog toggle) has no picture yet: force a redraw.
    const fresh = !image.getAttribute('src');
    if (this.fogPainter.paint(canvas, this.gridColumns, this.gridRows, this.exploredCells, this.sensorRangeCells, fresh)) {
      image.src = canvas.toDataURL();
    }
  }

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
    // The start point is in the transform, not in left / top (see .fleet-trail).
    return `translate3d(${trail.x1}vw, ${trail.y1}vw, 0) rotate(${angleDeg}deg)`;
  }

  /** Returns the line length in vw, or 0 when the trail is degenerate. */
  getTrailLength(trail: FleetTrail): number {
    const dx = trail.x2 - trail.x1;
    const dy = trail.y2 - trail.y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

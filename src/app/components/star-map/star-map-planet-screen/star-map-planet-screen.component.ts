import { TutorialAnchorDirective } from '../../tutorial/tutorial-anchor.directive';
import { hasTradingPost } from '../trade';
import {
  buildingConstructionProgress,
  constructionRefund,
  constructionSecondsFor,
  constructionSecondsLeft,
  constructionSites,
  isBuildingComplete,
} from '../building-construction';
import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  DoCheck,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  ElementRef,
  HostListener,
  inject,
} from '@angular/core';
import { TutorialService } from '../../../services/tutorial.service';
import { TutorialEvent } from '../../tutorial/tutorial-steps';
import { CommonModule } from '@angular/common';
import { PlanetDetailsComponent } from '../planet-details/planet-details.component';
import {
  PlanetTile,
  PlanetBuilding,
  PLANET_SURFACE_CELL_VW,
  PlanetEconomyEntry,
  ResourceRates,
} from '../star-map.models';
import { depositMiningBlocker } from '../raw-deposits';
import { BuildingInfo, describeBuilding, unlockingTechnologyName } from '../building-info';
import {
  BuildCategoryGroup,
  BuildCategoryId,
  buildCategoryOf,
  groupBuildingsByCategory,
  loadCollapsedBuildCategories,
  saveCollapsedBuildCategories,
} from './build-categories';
import {
  StarMapProductionPanelComponent,
  ProductionPanelViewModel,
  QueueOrderRequest,
} from '../star-map-production-panel/star-map-production-panel.component';
import {
  StarMapSpaceportPanelComponent,
  SpaceportPanelViewModel,
} from '../star-map-spaceport-panel/star-map-spaceport-panel.component';
import planetData from '../planet-data.json';
import { getBlockedMask } from '../planet-surface/planet-surface';
import { PLACEMENT_ERROR_MESSAGES, checkBuildingPlacement, isBuildingLimitReached } from '../building-placement';
import { PLANET_SURFACE_MARGIN } from '../planet-surface/planet-surface-field';
import {
  SurfaceRenderResult,
  renderPlanetSurface,
  surfaceHazeColor,
} from '../planet-surface/planet-surface-renderer';
import { SettlementLayout, computeSettlementLayout } from '../planet-surface/planet-settlement';

export interface BuildingType {
  id: string;
  name: string;
  role: string;
  price: number;
  rawMaterialCost?: number;
  size: number;
  maintenanceCost: number;
  population: number;
  workforce: number;
  moraleRate: number;
  /* Comfort points (comfort.ts); missing for non-comfort buildings. */
  comfort?: number;
  energyConsumption: number;
  energyProduction: number;
  production?: ResourceRates;
  consumption?: ResourceRates;
  defense: {
    type: string;
    attack?: number;
    attackType?: string;
    range?: number;
    weakness?: string;
    shield?: number;
    shieldRegen?: number;
  } | null;
  /* Housing and core buildings only: workers they supply to the planet. */
  providesWorkforce?: number;
  /* Turret / shield combat stats, top-level in planet-data.json. */
  attack?: number;
  range?: number;
  shield?: number;
  shieldRegen?: number;
  requiresOreProximity?: boolean;
  maxPerPlanet?: number;
  /* Core buildings (colony-core.ts): placed by the game, never in the build list. */
  autoPlaced?: boolean;
  /* Construction time in work-seconds (building-construction.ts); 0 = instant. */
  constructionSeconds?: number;
}

export type PlanetSidebarTab = 'details' | 'build' | 'assembly' | 'production';

/*
 * This planet's Trading Post traders, shown on the DETAILS tab
 * (docs/trade-network.md); built by StarMap. The exchange and the
 * empire-wide trade figures live in the header's resource overlay.
 */
export interface TradePostView {
  docked: number;
  travelling: number;
  respawning: number;
  /* Traders of any node currently heading here. */
  inbound: number;
}

/**
 * Continuous camera zoom of the planet surface view, as a screen-space scale
 * relative to PLANET_SURFACE_CELL_VW. The range spans the former FAR (0.537)
 * to one even step (~1.36x) beyond the former CLOSE (1), so the closest view
 * shows building details. The default is the former MEDIUM framing.
 */
export const PLANET_SURFACE_ZOOM_MIN = 0.537;
export const PLANET_SURFACE_ZOOM_MAX = 1.364;
/** Zoom scale active whenever a planet surface is opened. */
export const DEFAULT_PLANET_SURFACE_ZOOM = 0.733;
/**
 * Mouse-wheel sensitivity: the scale changes by exp(-deltaY * this), so one
 * ~100 px wheel notch is a ~14% step and trackpad scrolling stays smooth.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
/** Steps of the zoom slider; the slider is logarithmic in scale. */
export const PLANET_SURFACE_ZOOM_SLIDER_STEPS = 100;

function clampZoom(scale: number): number {
  return Math.max(PLANET_SURFACE_ZOOM_MIN, Math.min(PLANET_SURFACE_ZOOM_MAX, scale));
}

/*
 * Sprites stand inset from their footprint; the gap is where streets run.
 * The building SVGs are generated for this inset (scripts/building-sprites/generate.mjs).
 */
const SPRITE_INSET = 0.15;
/* Deposits are small outcrops inside their cell. */
const DEPOSIT_INSET = 0.2;
const DEPOSIT_SPRITE = 'planet-surface/ore-deposit.svg';

/** A depth-sorted image in the object layer (building, construction site, deposit, build ghost). */
export interface SurfaceSprite {
  key: string;
  src: string;
  /* Anchor (bottom center) and width in vw at zoom 1, relative to the world center. */
  left: number;
  top: number;
  width: number;
  z: number;
  kind: 'building' | 'site' | 'deposit' | 'ghost';
  /* The site's building record (kind 'site'): progress is read live from it. */
  building?: PlanetBuilding;
}

/* One construction site in the BUILD tab's construction list. */
export interface ConstructionSiteView {
  building: PlanetBuilding;
  name: string;
  /* 0 … 100, floored so it never shows 100 before completion. */
  percent: number;
  secondsLeft: number;
  paid: { credits: number; rawmaterials: number };
  refund: { credits: number; rawmaterials: number };
}

const EMPTY_SETTLEMENT: SettlementLayout = { streets: '', accessRoads: [], plots: [], lights: [] };

/*
 * =========================================================
 * PLANET SCREEN COMPONENT
 * =========================================================
 *
 * The planet view: a colony on an isometric planet surface plus a sidebar
 * with DETAILS, BUILD, ASSEMBLY and PRODUCTION tabs. Terrain, street and
 * rendering rules are documented in docs/planet-surface.md.
 *
 * Scene layers (inside one camera element that pans and zooms):
 *   1. Terrain canvas — the environment, baked once per planet by
 *      renderPlanetSurface (screen space, includes cliffs and decor).
 *   2. Ground plane — a flat element tilted with rotateX(60) rotateZ(45)
 *      holding the settlement SVG (plots, streets, shadows, lights) and the
 *      interactive CSS grid of cells. Its projection matches the terrain
 *      canvas exactly, and buildable cells are flat (h = 0) in the terrain.
 *   3. Object layer — upright sprites (buildings, deposits, build ghost)
 *      positioned with the same projection and depth-sorted.
 *   4. Labels.
 * World coordinates are cell units; the grid occupies [margin, margin + N).
 *
 * Tab visibility:
 *   - DETAILS:    always (PlanetDetailsComponent, shared with the system
 *                 view's planet info card)
 *   - BUILD:      only when the player owns the planet
 *   - PRODUCTION: only when the planet has a Spaceship Factory
 *   - ASSEMBLY:   only when the planet has a Spaceport
 *
 * Zoom (continuous, PLANET_SURFACE_ZOOM_MIN..MAX):
 * - Driven by the slider (logarithmic), the magnifier button (reset), the
 *   mouse wheel and a two-finger pinch; wheel and pinch zoom around the
 *   pointer / finger midpoint, so the point under them stays put.
 * - Purely presentational camera state; never written to the planet, the
 *   game state, or the save. The zoom is a `scale()` on the camera, so all
 *   layers scale together and build placement logic is unaffected.
 * - Not persisted: the component is destroyed when the planet view closes
 *   (`@if` in star-map.html), and a change of the `planet` input id also
 *   resets it, so every planet opening starts at DEFAULT_PLANET_SURFACE_ZOOM.
 *
 * Build mode:
 * - After selecting a building type (BUILD tab), clicking a cell previews the
 *   footprint (cells + a ghost sprite). A placement must fit the grid, avoid
 *   terrain obstacles (planet.surface), buildings and deposits (the Mining
 *   Complex must touch one instead) — checkBuildingPlacement in
 *   building-placement.ts, which StarMap.onBuildingConfirmed re-checks. The
 *   AI applies the same terrain rule in EnemyEconomyService.canPlace.
 *
 * Derived scene data (sprites, streets, zone outline) is rebuilt only when
 * the planet's buildings / surface signature changes (ngDoCheck), because
 * StarMap pushes new buildings into the planet's array in place.
 */

@Component({
  selector: 'app-star-map-planet-screen',
  standalone: true,
  imports: [
    CommonModule,
    PlanetDetailsComponent,
    StarMapProductionPanelComponent,
    StarMapSpaceportPanelComponent,
    TutorialAnchorDirective,
  ],
  templateUrl: './star-map-planet-screen.component.html',
  styleUrl: './star-map-planet-screen.component.scss',
})
export class StarMapPlanetScreenComponent implements AfterViewInit, OnChanges, OnDestroy, DoCheck {
  @Input() planet: PlanetTile | null = null;
  @Input() gridSize: number = 10;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() getEnergyForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() getTaxForPlanet: (planet: PlanetTile) => number = () => 0;
  @Input() planetEconomy: PlanetEconomyEntry | null = null;

  @Input() getPlayerCredits: () => number = () => 0;
  @Input() getPlayerRawMaterials: () => number = () => 0;

  @Input() hasFactory: () => boolean = () => false;
  @Input() hasSpaceport: () => boolean = () => false;
  @Input() getProductionPanelVm: () => ProductionPanelViewModel | null = () => null;
  @Input() getSpaceportPanelVm: () => SpaceportPanelViewModel | null = () => null;
  @Input() spaceportFleetName = 'New Fleet';
  @Input() productionBuildError: string | null = null;
  @Input() spaceportError: string | null = null;
  @Input() isBuildingUnlocked: (buildingId: string) => boolean = () => false;
  @Input() getTradePostVm: (planet: PlanetTile) => TradePostView | null = () => null;
  /* Game pause: construction sites show PAUSED and do not progress. */
  @Input() isPaused = false;
  /* Construction speed of a planet (core × technology); see building-construction.ts. */
  @Input() getConstructionSpeed: (planet: PlanetTile) => number = () => 1;

  @Output() backToStarMap = new EventEmitter<void>();
  @Output() buildConfirmed = new EventEmitter<{ buildingId: string; x: number; y: number }>();
  @Output() queueOrder = new EventEmitter<QueueOrderRequest>();
  @Output() cancelOrder = new EventEmitter<number>();
  @Output() spaceportConfirm = new EventEmitter<{
    fleetName: string;
    composition: { typeId: string; count: number }[];
    systemId: string;
    planetId: number;
  }>();
  @Output() spaceportFleetNameChange = new EventEmitter<string>();
  @Output() openProductionTab = new EventEmitter<void>();
  @Output() openSpaceportTab = new EventEmitter<void>();
  /* Cancel the construction site at a cell; StarMap re-checks and refunds. */
  @Output() cancelConstruction = new EventEmitter<{ x: number; y: number }>();

  /*
   * Construction sites of this planet for the BUILD tab, rebuilt on every
   * read (a handful of entries; progress changes every redraw).
   */
  get constructionSiteViews(): ConstructionSiteView[] {
    const planet = this.planet;
    if (!planet) return [];
    const sites = constructionSites(planet);
    if (sites.length === 0) return [];
    const speed = this.getConstructionSpeed(planet);
    return sites.map((building) => ({
      building,
      name: building.name,
      percent: Math.min(99, Math.floor(buildingConstructionProgress(building) * 100)),
      secondsLeft: constructionSecondsLeft(building, speed),
      paid: building.constructionPaid ?? { credits: 0, rawmaterials: 0 },
      refund: constructionRefund(building),
    }));
  }

  /* Construction speed of this planet as a percentage (100 = base speed). */
  get constructionSpeedPercent(): number {
    return this.planet ? Math.round(this.getConstructionSpeed(this.planet) * 100) : 100;
  }

  requestCancelConstruction(site: ConstructionSiteView): void {
    if (this.planet?.factionId !== 'player') return;
    this.cancelConstruction.emit({ x: site.building.x, y: site.building.y });
  }

  /* Live 0 … 1 progress of a site sprite (the template reads it each redraw). */
  siteProgress(building: PlanetBuilding | undefined): number {
    return building ? buildingConstructionProgress(building) : 1;
  }

  /* Game seconds a new building of this type takes on this planet (0 = instant). */
  buildTimeOnPlanet(building: BuildingType): number {
    const base = constructionSecondsFor(building);
    if (base <= 0 || !this.planet) return 0;
    return base / this.getConstructionSpeed(this.planet);
  }

  /* Whole percent done, floored and capped at 99 so 100 means "complete". */
  sitePercent(building: PlanetBuilding): number {
    return Math.min(99, Math.floor(buildingConstructionProgress(building) * 100));
  }

  readonly constructionSegments = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  /* Height / width of each building sprite, learned when its image loads. */
  private readonly spriteAspect = new Map<string, number>();

  onSiteSpriteLoad(src: string, event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) this.spriteAspect.set(src, img.naturalHeight / img.naturalWidth);
  }

  /*
   * Construction rig in the sprite's own isometric frame, so scaffold and
   * crane stand on the same ground plane as the building.
   *
   * Units: the sprite is 100 wide; y = 0 is its bottom edge (the footprint's
   * front corner) and grows downward, so the box spans y = -A … 0 with
   * A = 100 × height / width. Building sprites are exactly as wide as their
   * footprint diamond and the projection is 2:1 (scripts/building-sprites/
   * iso-svg.mjs), so the ground diamond is front (50, 0), left (0, -25),
   * right (100, -25), back (50, -50), and a point `z` units above the
   * ground is drawn `z` higher. The scaffold climbs to `top` with the
   * progress, in proportion to the building's height above its footprint.
   */
  siteRig(src: string, progress: number): {
    viewBox: string; scaffold: string; back: string; deck: string; mast: string; jib: string;
    jibY: number; hookY: number; lampX: number; lampY: number; cornerY: number; weldTop: number;
  } {
    const a = 100 * (this.spriteAspect.get(src) ?? 1.5);
    const height = Math.max(10, a - 50);
    const top = 6 + Math.max(0, Math.min(1, progress)) * (height - 6);
    const r = (n: number) => Math.round(n * 10) / 10;
    // Front faces: poles on the left, front and right corners and the two edge midpoints.
    const poles: [number, number][] = [[0, -25], [25, -12.5], [50, 0], [75, -12.5], [100, -25]];
    let scaffold = poles.map(([x, y]) => `M${x} ${y}V${r(y - top)}`).join('');
    const edge = (z: number) => `M0 ${r(-25 - z)}L50 ${r(-z)}L100 ${r(-25 - z)}`;
    for (let z = 12; z < top; z += 12) scaffold += edge(z);
    // Cross braces in every bay, alternating direction per level.
    for (let z = 0, level = 0; z < top - 0.01; z += 12, level++) {
      const z2 = Math.min(top, z + 12);
      for (let i = 0; i < poles.length - 1; i++) {
        const [x1, y1] = poles[i];
        const [x2, y2] = poles[i + 1];
        scaffold += (i + level) % 2 === 0
          ? `M${x1} ${r(y1 - z)}L${x2} ${r(y2 - z2)}`
          : `M${x2} ${r(y2 - z)}L${x1} ${r(y1 - z2)}`;
      }
    }
    const back = `M50 -50V${r(-50 - top)}M0 ${r(-25 - top)}L50 ${r(-50 - top)}L100 ${r(-25 - top)}`;
    const deck = `0,${r(-25 - top)} 50,${r(-top)} 100,${r(-25 - top)}`;
    // Mast on the right corner, rising above the finished building.
    const jibY = r(-25 - height - 22);
    let mast = `M93 -24V${jibY}M98 -26V${jibY}`;
    for (let y = -24, left = true; y > jibY + 6; y -= 8, left = !left) mast += left ? `M93 ${y}L98 ${y - 8}` : `M98 ${y}L93 ${y - 8}`;
    // Jib along the footprint's left–right diagonal (over the centre), counter-jib past the mast.
    const jib = `M8 ${jibY}H108M20 ${jibY - 4}H98M20 ${jibY - 4}L96 ${jibY - 12}L108 ${jibY}`;
    return {
      viewBox: `0 ${r(-a)} 100 ${r(a)}`,
      scaffold,
      back,
      deck,
      mast,
      jib,
      jibY,
      hookY: r(-25 - top - 4),
      lampX: 96,
      lampY: r(jibY - 14),
      cornerY: r(-25 - top - 1.5),
      weldTop: r(((a - 12.5 - Math.max(0, top - 3)) / a) * 100),
    };
  }

  /* "1:05" style countdown for construction times. */
  formatDuration(seconds: number): string {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  /* Own Trading Post on this planet: the DETAILS tab lists its traders. */
  get tradePostVm(): TradePostView | null {
    return this.planet?.factionId === 'player' && hasTradingPost(this.planet) ? this.getTradePostVm(this.planet) : null;
  }

  readonly cellVw = PLANET_SURFACE_CELL_VW;
  readonly margin = PLANET_SURFACE_MARGIN;
  private readonly tutorial = inject(TutorialService);
  private tutorialSpotCache: { key: string; spot: { row: number; col: number } | null } | null = null;
  private readonly _buildingTypes: BuildingType[] = (planetData as { buildings: BuildingType[] }).buildings;

  // Surface panning state (in vw units, matching the codebase grid convention).
  // `scrollX/Y = 0` means the world center is in the middle of the viewport;
  // positive values pan toward the right/bottom of the screen.
  scrollX = 0;
  scrollY = 0;
  private isSurfaceDragging = false;
  private dragMoved = false;
  private wasDragged = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragScrollStartX = 0;
  private dragScrollStartY = 0;
  private readonly dragThreshold = 5;
  private panIntervalId: number | null = null;
  private readonly panStepVw = 3;
  private readonly panRepeatDelay = 50;
  private maxScrollX = 0;
  private maxScrollY = 0;

  zoomScale = DEFAULT_PLANET_SURFACE_ZOOM;
  readonly zoomSliderSteps = PLANET_SURFACE_ZOOM_SLIDER_STEPS;

  /*
   * Touch pointers currently down on the viewport (client px). Two of them
   * switch from drag panning to pinch zoom; every pinch move is computed from
   * the gesture start values, so rounding does not drift.
   */
  private readonly touchPointers = new Map<number, { x: number; y: number }>();
  private pinchStart: {
    dist: number;
    scale: number;
    mid: { x: number; y: number };
    scrollX: number;
    scrollY: number;
  } | null = null;

  /** Slider position (0..zoomSliderSteps), logarithmic in the zoom scale. */
  get zoomSliderValue(): number {
    const t =
      Math.log(this.zoomScale / PLANET_SURFACE_ZOOM_MIN) /
      Math.log(PLANET_SURFACE_ZOOM_MAX / PLANET_SURFACE_ZOOM_MIN);
    return Math.round(t * PLANET_SURFACE_ZOOM_SLIDER_STEPS);
  }

  @ViewChild('surfaceViewport') surfaceViewport: ElementRef<HTMLElement> | null = null;
  @ViewChild('terrainHost') terrainHost: ElementRef<HTMLElement> | null = null;

  // Building names are hidden by default (hover still shows one); the NAMES toggle shows them all.
  showLabels = false;
  terrainReady = false;
  terrainBox: { left: number; top: number; width: number; height: number } | null = null;
  settlement: SettlementLayout = EMPTY_SETTLEMENT;
  sprites: SurfaceSprite[] = [];
  zoneOutline = '';
  hoveredCell: { row: number; col: number } | null = null;
  private terrain: SurfaceRenderResult | null = null;
  private sceneSignature = '';
  private terrainSignature = '';
  private renderHandle: number | null = null;

  get buildingTypes(): BuildingType[] {
    return this._buildingTypes;
  }

  readonly buildableTypes: BuildingType[] = this._buildingTypes.filter((b) => !b.autoPlaced);

  /* The BUILD tab shows buildableTypes in collapsible categories (build-categories.ts). */
  readonly buildCategoryGroups: BuildCategoryGroup<BuildingType>[] =
    groupBuildingsByCategory(this.buildableTypes);
  private readonly collapsedBuildCategories = loadCollapsedBuildCategories();

  isBuildCategoryOpen(id: BuildCategoryId): boolean {
    return !this.collapsedBuildCategories.has(id);
  }

  toggleBuildCategory(id: BuildCategoryId): void {
    if (this.collapsedBuildCategories.has(id)) {
      this.collapsedBuildCategories.delete(id);
    } else {
      this.collapsedBuildCategories.add(id);
      // An open info box inside the collapsed category would otherwise
      // reappear unexpectedly when the category is opened again.
      const expanded = this.buildableTypes.find((b) => b.id === this.expandedBuildingId);
      if (expanded && buildCategoryOf(expanded) === id) {
        this.closeBuildingInfo();
      }
    }
    saveCollapsedBuildCategories(this.collapsedBuildCategories);
  }

  getBuildingName(building: BuildingType): string {
    return building.name;
  }

  getBuildingPrice(building: BuildingType): number {
    return building.price;
  }

  getBuildingRawCost(building: BuildingType): number {
    return building.rawMaterialCost ?? 0;
  }

  /*
   * Energy change of one building, as listed in planet-data.json. Energy
   * technologies raise a power building's real output a little above this
   * (EconomyService), so the preview is conservative for power buildings.
   */
  getBuildingEnergyDelta(building: BuildingType): number {
    return (building.energyProduction ?? 0) - (building.energyConsumption ?? 0);
  }

  /*
   * Planet energy after adding `building`: production / consumption and the
   * shortfall share (0 when fully powered). Null without an economy entry.
   * Sites under construction count with their listed values: the economy
   * entry only holds operational buildings, and the preview must show the
   * planet as it will be once everything already paid for is complete.
   */
  getEnergyAfterBuilding(building: BuildingType): { production: number; consumption: number; shortPct: number } | null {
    const economy = this.planetEconomy;
    if (!economy) return null;
    let pendingProduction = 0;
    let pendingConsumption = 0;
    for (const site of constructionSites(this.planet)) {
      const def = this._buildingTypes.find((t) => t.name === site.name);
      pendingProduction += def?.energyProduction ?? 0;
      pendingConsumption += def?.energyConsumption ?? 0;
    }
    const production = economy.energyProduction + pendingProduction + (building.energyProduction ?? 0);
    const consumption = economy.energyConsumption + pendingConsumption + (building.energyConsumption ?? 0);
    const shortPct = consumption > production ? Math.round((1 - production / Math.max(consumption, 1)) * 100) : 0;
    return { production, consumption, shortPct };
  }

  /* True when building it would leave (or keep) the planet short on energy. */
  causesEnergyShortage(building: BuildingType): boolean {
    return (this.getEnergyAfterBuilding(building)?.shortPct ?? 0) > 0 && this.getBuildingEnergyDelta(building) < 0;
  }

  /*
   * Build-list info box (building-info.ts). Clicking a row opens its box right
   * under it (one at a time) and, when the building can be built here, starts
   * placement at once: the box then holds the placement controls (hint,
   * confirm BUILD, CANCEL). Blocked rows only open the box, with the reason.
   * Invariant: while placing, expandedBuildingId === selectedBuildingType.id,
   * so closing the box always ends placement. Ending placement alone (e.g. a
   * row that was blocked when opened) leaves the box open with its BUILD
   * button, which starts placement again.
   */
  private readonly buildingInfoCache = new Map<string, BuildingInfo>();
  expandedBuildingId: string | null = null;

  getBuildingInfo(building: BuildingType): BuildingInfo {
    let info = this.buildingInfoCache.get(building.id);
    if (!info) {
      info = describeBuilding(building);
      this.buildingInfoCache.set(building.id, info);
    }
    return info;
  }

  getUnlockingTechnology(building: BuildingType): string | null {
    return unlockingTechnologyName(building.id);
  }

  toggleBuildingInfo(building: BuildingType): void {
    if (this.expandedBuildingId === building.id) {
      this.closeBuildingInfo();
      return;
    }
    if (this.getBuildBlocker(building)) {
      this.exitBuildMode();
      this.expandedBuildingId = building.id;
    } else {
      this.selectBuildingType(building.id);
    }
    // A box opened near the bottom of the list would hide its controls
    // below the fold; scroll it in once Angular has rendered it.
    const id = `building-info-${building.id}`;
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  /* Closes the open info box and ends any placement started from it. */
  closeBuildingInfo(): void {
    this.expandedBuildingId = null;
    this.exitBuildMode();
  }

  /* True when the box of this building currently holds the placement controls. */
  isPlacing(building: BuildingType): boolean {
    return this.isBuildMode && this.selectedBuildingType?.id === building.id;
  }

  /* Why the BUILD button is disabled right now, or null when it can start. */
  getBuildBlocker(building: BuildingType): string | null {
    if (!this.isBuildingUnlocked(building.id)) return 'Not researched yet.';
    const site = this.getSiteBlocker(building);
    if (site === 'ALREADY BUILT') return 'Already built on this planet.';
    if (site === 'LIMIT REACHED') return 'Limit reached on this planet.';
    if (site === 'NO DEPOSIT') return 'This planet has no ore deposit.';
    if (site === 'DEPLETED') return 'The ore deposit is depleted.';
    if (site) return site;
    if (!this.canAfford(building)) return 'Not enough credits or raw materials.';
    return null;
  }

  activeTab: PlanetSidebarTab = 'details';
  isBuildMode = false;
  selectedBuildingType: BuildingType | null = null;
  selectedCell: { row: number; col: number } | null = null;
  previewCells: Set<string> = new Set();
  isPreviewValid = false;
  buildError = '';
  showProductionBuildMenu = false;

  /** Returns an array [0, 1, ..., gridSize-1] for rendering grid cells. */
  get gridCells(): number[] {
    return Array.from({ length: this.gridSize }, (_, i) => i);
  }

  /** Returns the CSS grid template string for the planet surface grid. */
  get gridTemplateColumns(): string {
    return `repeat(${this.gridSize}, ${this.cellVw}vw)`;
  }

  get worldSize(): number {
    return this.gridSize + this.margin * 2;
  }

  /* World side in vw at zoom 1 (layout size of the ground plane). */
  get worldVw(): number {
    return this.worldSize * this.cellVw;
  }

  get hazeColor(): string {
    return surfaceHazeColor(this.planet?.type ?? 'earthlike');
  }

  /**
   * Camera transform: pans in screen space (unscaled vw), then zooms around
   * the world center, which is anchored at the viewport center. The
   * isometric tilt lives on the ground plane only, so sprites and the baked
   * terrain stay upright.
   */
  get cameraTransform(): string {
    return `translate(${-this.scrollX}vw, ${-this.scrollY}vw) scale(${this.zoomScale})`;
  }

  /**
   * Tabs available for the current planet, in display order. Visibility is
   * driven by ownership and the buildings the planet actually has.
   */
  get availableTabs(): PlanetSidebarTab[] {
    const tabs: PlanetSidebarTab[] = ['details'];
    if (this.planet?.factionId === 'player') {
      tabs.push('build');
    }
    if (this.hasFactory()) {
      tabs.push('production');
    }
    if (this.hasSpaceport()) {
      tabs.push('assembly');
    }
    return tabs;
  }

  /** True when the active tab is still available — guards stale state. */
  get activeTabAvailable(): boolean {
    return this.availableTabs.includes(this.activeTab);
  }

  setTab(tab: PlanetSidebarTab): void {
    this.activeTab = tab;
    if (tab !== 'details') this.tutorial.notify(`planet-tab:${tab}` as TutorialEvent);
    this.expandedBuildingId = null;
    this.showProductionBuildMenu = false;
    if (tab === 'build') {
      this.isBuildMode = false;
      this.selectedBuildingType = null;
      this.selectedCell = null;
      this.previewCells = new Set();
      this.isPreviewValid = false;
      this.buildError = '';
      this.updateSprites();
    } else {
      this.exitBuildMode();
    }
    if (tab === 'production') {
      this.openProductionTab.emit();
    }
    if (tab === 'assembly') {
      this.openSpaceportTab.emit();
    }
  }

  openProductionBuildMenu(): void {
    this.showProductionBuildMenu = true;
  }

  closeProductionBuildMenu(): void {
    this.showProductionBuildMenu = false;
  }

  exitBuildMode(): void {
    this.isBuildMode = false;
    this.selectedBuildingType = null;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
    this.updateSprites();
  }

  selectBuildingType(buildingId: string): void {
    const building = this.buildingTypes.find((b) => b.id === buildingId) ?? null;
    if (['mining_complex', 'spaceship_factory', 'spaceport'].includes(buildingId)) {
      this.tutorial.notify(`pick:${buildingId}` as TutorialEvent);
    }
    this.selectedBuildingType = building;
    this.expandedBuildingId = building?.id ?? null;
    this.isBuildMode = true;
    this.selectedCell = null;
    this.previewCells = new Set();
    this.isPreviewValid = false;
    this.buildError = '';
    this.updateSprites();
  }

  onCellClick(row: number, col: number): void {
    // Suppress the trailing click of a drag-pan so it cannot place a building.
    if (this.wasDragged || this.dragMoved) {
      return;
    }
    if (!this.isBuildMode || !this.selectedBuildingType) {
      return;
    }

    this.selectedCell = { row, col };
    this.updatePreview(row, col);
    this.updateSprites();
  }

  private updatePreview(row: number, col: number): void {
    if (!this.selectedBuildingType) {
      return;
    }

    const size = this.selectedBuildingType.size;
    this.previewCells = new Set<string>();

    for (let r = row; r < row + size; r++) {
      for (let c = col; c < col + size; c++) {
        this.previewCells.add(`${r},${c}`);
      }
    }

    const error = this.planet
      ? checkBuildingPlacement(this.planet, this.gridSize, this.selectedBuildingType, col, row)
      : 'out_of_grid';
    if (error) {
      this.isPreviewValid = false;
      this.buildError = PLACEMENT_ERROR_MESSAGES[error];
      return;
    }

    this.isPreviewValid = true;
    this.buildError = '';
  }

  /** True when an environmental obstacle covers the cell (not buildable). */
  isBlockedCell(row: number, col: number): boolean {
    const mask = this.planet ? getBlockedMask(this.planet) : null;
    if (!mask || row < 0 || col < 0 || row >= this.gridSize || col >= this.gridSize) {
      return false;
    }
    return mask[row * this.gridSize + col] === 1;
  }

  /*
   * Tutorial anchor (docs/tutorial-hints.md): while a Mining Complex is being
   * placed and no cell is picked yet, the first top-left cell where it is
   * valid, i.e. touching the deposit. Clicking that cell gives a valid
   * preview. Cached per planet and building count: the search runs the
   * placement rule over the grid.
   */
  get tutorialMineSpot(): { row: number; col: number } | null {
    const type = this.selectedBuildingType;
    if (!this.isBuildMode || type?.id !== 'mining_complex' || this.selectedCell || !this.planet || !this.tutorial.enabled()) {
      return null;
    }
    const key = `${this.planet.id}:${this.planet.buildings.length}:${this.gridSize}`;
    if (this.tutorialSpotCache?.key !== key) {
      this.tutorialSpotCache = { key, spot: this.findMineSpot(type) };
    }
    return this.tutorialSpotCache.spot;
  }

  private findMineSpot(type: BuildingType): { row: number; col: number } | null {
    const planet = this.planet!;
    for (const tile of planet.resourceTiles ?? []) {
      for (let row = tile.y - type.size; row <= tile.y + 1; row++) {
        for (let col = tile.x - type.size; col <= tile.x + 1; col++) {
          if (checkBuildingPlacement(planet, this.gridSize, type, col, row) === null) {
            return { row, col };
          }
        }
      }
    }
    return null;
  }

  isResourceTile(row: number, col: number): boolean {
    return (this.planet?.resourceTiles ?? []).some(
      (rt) => rt.x === col && rt.y === row,
    );
  }

  confirmBuild(): void {
    if (!this.isPreviewValid || !this.selectedCell || !this.selectedBuildingType) {
      return;
    }

    const { col, row } = this.selectedCell;
    this.buildConfirmed.emit({
      buildingId: this.selectedBuildingType.id,
      x: col,
      y: row,
    });
    this.closeBuildingInfo();
  }

  /* Same rule StarMap.onBuildingConfirmed enforces: credits AND raw materials. */
  canAfford(building: BuildingType): boolean {
    return (
      this.getPlayerCredits() >= building.price
      && this.getPlayerRawMaterials() >= this.getBuildingRawCost(building)
    );
  }

  /*
   * Why this building cannot be built on this planet regardless of money
   * (the per-planet cap is reached, or a mine needs a deposit that is not
   * empty), as a short tag; null if it can.
   */
  getSiteBlocker(building: BuildingType): string | null {
    if (!this.planet) return null;
    if (isBuildingLimitReached(this.planet, building)) return building.maxPerPlanet === 1 ? 'ALREADY BUILT' : 'LIMIT REACHED';
    if (!building.requiresOreProximity) return null;
    const blocker = depositMiningBlocker(this.planet);
    if (blocker === 'no_deposit') return 'NO DEPOSIT';
    if (blocker === 'depleted') return 'DEPLETED';
    return null;
  }

  isCellInPreview(row: number, col: number): boolean {
    return this.previewCells.has(`${row},${col}`);
  }

  ngAfterViewInit(): void {
    this.updateClamp();
    this.refreshScene();
    this.scheduleTerrainRender();
  }

  ngDoCheck(): void {
    this.refreshScene();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Compare by id: the parent may hand over a new object for the same
    // planet, which must not reset the player's chosen zoom.
    const planetChange = changes['planet'];
    if (
      planetChange &&
      planetChange.previousValue?.id !== planetChange.currentValue?.id
    ) {
      this.zoomScale = DEFAULT_PLANET_SURFACE_ZOOM;
      this.centerScroll();
      // A placement preview belongs to the planet it was started on.
      if (planetChange.previousValue) {
        this.closeBuildingInfo();
      }
      this.hoveredCell = null;
      this.terrain = null;
      this.terrainBox = null;
      this.terrainReady = false;
    }
    if (changes['gridSize'] || planetChange) {
      this.updateClamp();
      this.scheduleTerrainRender();
      this.refreshScene();
    }
  }

  /**
   * Sets the camera zoom (clamped to the allowed range). The scroll offset is
   * rescaled so the surface point under `anchor` stays put instead of
   * jumping, then re-clamped against the new (scaled) bounds. `anchor` is in
   * vw relative to the viewport center; the default keeps the center fixed.
   */
  setZoom(scale: number, anchor: { x: number; y: number } = { x: 0, y: 0 }): void {
    const next = clampZoom(scale);
    if (next === this.zoomScale) {
      return;
    }
    const ratio = next / this.zoomScale;
    this.zoomScale = next;
    // Screen point p shows world point (p + scroll) / scale; keep it under p.
    this.scrollX = (anchor.x + this.scrollX) * ratio - anchor.x;
    this.scrollY = (anchor.y + this.scrollY) * ratio - anchor.y;
    this.updateClamp();
  }

  onZoomSlider(event: Event): void {
    const t = Number((event.target as HTMLInputElement).value) / PLANET_SURFACE_ZOOM_SLIDER_STEPS;
    this.setZoom(PLANET_SURFACE_ZOOM_MIN * Math.pow(PLANET_SURFACE_ZOOM_MAX / PLANET_SURFACE_ZOOM_MIN, t));
  }

  resetZoom(): void {
    this.setZoom(DEFAULT_PLANET_SURFACE_ZOOM);
  }

  /** Mouse wheel / trackpad scroll on the surface zooms around the cursor. */
  onSurfaceWheel(event: WheelEvent): void {
    event.preventDefault();
    // deltaMode 1 = lines, 2 = pages (rare); normalize to pixels.
    const px = event.deltaY * (event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1);
    this.setZoom(
      this.zoomScale * Math.exp(-px * WHEEL_ZOOM_SENSITIVITY),
      this.viewportOffsetVw(event.clientX, event.clientY),
    );
  }

  /** Client px -> vw offset from the viewport center (the camera origin). */
  private viewportOffsetVw(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.surfaceViewport?.nativeElement.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    const vwUnit = window.innerWidth / 100;
    return {
      x: (clientX - (rect.left + rect.width / 2)) / vwUnit,
      y: (clientY - (rect.top + rect.height / 2)) / vwUnit,
    };
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateClamp();
  }

  /**
   * Recomputes the scroll clamp. The camera center may roam over the grid's
   * projected diamond (plus one cell of headroom for buildings at the back),
   * so every edge of the colony can be brought to the middle of the screen
   * and the terrain around it inspected; the world margin keeps the view
   * filled. Bounds are in screen vw, so they scale with the zoom.
   */
  private updateClamp(): void {
    if (!this.surfaceViewport) {
      return;
    }
    const gridVw = this.gridSize * this.cellVw * this.zoomScale;
    this.maxScrollX = (gridVw * Math.SQRT2) / 2;
    this.maxScrollY = (gridVw * Math.SQRT2) / 4 + this.cellVw * this.zoomScale;
    this.clampScroll();
  }

  /**
   * Clamps scroll to the computed bounds. Returns true when the scroll was
   * actually changed, false when it was already within bounds.
   */
  private clampScroll(): boolean {
    const clampedX = Math.max(-this.maxScrollX, Math.min(this.maxScrollX, this.scrollX));
    const clampedY = Math.max(-this.maxScrollY, Math.min(this.maxScrollY, this.scrollY));
    const moved = clampedX !== this.scrollX || clampedY !== this.scrollY;
    this.scrollX = clampedX;
    this.scrollY = clampedY;
    return moved;
  }

  /** Pans the surface by the given vw delta. Stops panning when clamped so
   * a held d-pad button at the edge does not keep scheduling change
   * detection. */
  panBy(deltaX: number, deltaY: number): void {
    this.scrollX += deltaX;
    this.scrollY += deltaY;
    if (!this.clampScroll()) {
      this.stopPan();
    }
  }

  /** Resets panning so the grid is centered again. */
  centerScroll(): void {
    this.scrollX = 0;
    this.scrollY = 0;
  }

  /**
   * Starts continuous panning in the given direction. Emits one step
   * immediately, then repeats every 50ms — mirrors the galaxy navigation
   * d-pad behaviour. Stop with {@link stopPan}.
   */
  startPan(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.stopPan();
    this.panStep(direction);
    this.panIntervalId = window.setInterval(() => {
      this.panStep(direction);
    }, this.panRepeatDelay);
  }

  /** Stops the continuous pan interval. */
  stopPan(): void {
    if (this.panIntervalId !== null) {
      window.clearInterval(this.panIntervalId);
      this.panIntervalId = null;
    }
  }

  /** Clears timers so a held button or pending render cannot outlive the view. */
  ngOnDestroy(): void {
    this.stopPan();
    this.cancelTerrainRender();
  }

  private panStep(direction: 'up' | 'down' | 'left' | 'right'): void {
    switch (direction) {
      case 'up':
        this.panBy(0, -this.panStepVw);
        break;
      case 'down':
        this.panBy(0, this.panStepVw);
        break;
      case 'left':
        this.panBy(-this.panStepVw, 0);
        break;
      case 'right':
        this.panBy(this.panStepVw, 0);
        break;
    }
  }

  /** Pointer down on the surface viewport — begins drag tracking. */
  onSurfacePointerDown(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPointers.size === 2) {
        this.startPinch(event.currentTarget as HTMLElement);
        return;
      }
      if (this.touchPointers.size > 2) {
        return;
      }
    }
    this.dragMoved = false;
    this.wasDragged = false;
    // While in build mode, cells are interactive (building placement), so
    // drags must not start there. Outside build mode cells are inert, so
    // letting the drag start on them keeps touch panning usable.
    if (this.isBuildMode && this.isCellOrBuilding(event.target as HTMLElement)) {
      return;
    }
    const viewport = event.currentTarget as HTMLElement;
    viewport.setPointerCapture(event.pointerId);

    this.isSurfaceDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragScrollStartX = this.scrollX;
    this.dragScrollStartY = this.scrollY;

    viewport.classList.add('dragging');
  }

  /** Pointer move during drag — updates scroll with clamping. */
  onSurfacePointerMove(event: PointerEvent): void {
    if (this.touchPointers.has(event.pointerId)) {
      this.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinchStart) {
        this.updatePinch();
        return;
      }
    }
    if (!this.isSurfaceDragging) {
      return;
    }
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;

    if (Math.abs(deltaX) + Math.abs(deltaY) > this.dragThreshold) {
      this.dragMoved = true;
    }

    const vwUnit = window.innerWidth / 100;
    this.scrollX = this.dragScrollStartX - deltaX / vwUnit;
    this.scrollY = this.dragScrollStartY - deltaY / vwUnit;
    this.clampScroll();
  }

  /** Pointer up — ends drag; a short drag that moved is treated as a pan. */
  onSurfacePointerUp(event: PointerEvent): void {
    const viewport = event.currentTarget as HTMLElement;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    this.touchPointers.delete(event.pointerId);
    if (this.pinchStart) {
      // A pinch ends when a finger lifts; the remaining finger does not
      // resume panning, so the view does not jump to it.
      if (this.touchPointers.size < 2) {
        this.pinchStart = null;
      }
      return;
    }
    if (!this.isSurfaceDragging) {
      return;
    }
    viewport.classList.remove('dragging');

    this.isSurfaceDragging = false;
    if (this.dragMoved) {
      this.wasDragged = true;
    }
  }

  /**
   * Begins a two-finger pinch: a running drag stops, and the gesture counts
   * as a drag so its trailing click cannot place a building.
   */
  private startPinch(viewport: HTMLElement): void {
    const [a, b] = [...this.touchPointers.values()];
    for (const id of this.touchPointers.keys()) {
      if (!viewport.hasPointerCapture(id)) {
        try {
          viewport.setPointerCapture(id);
        } catch {
          // The pointer may already be gone; the pinch works without capture.
        }
      }
    }
    this.isSurfaceDragging = false;
    this.dragMoved = true;
    this.wasDragged = true;
    viewport.classList.remove('dragging');
    this.pinchStart = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: this.zoomScale,
      mid: this.viewportOffsetVw((a.x + b.x) / 2, (a.y + b.y) / 2),
      scrollX: this.scrollX,
      scrollY: this.scrollY,
    };
  }

  /**
   * Pinch zoom and two-finger pan together: the world point that was under
   * the start midpoint is kept under the current midpoint.
   */
  private updatePinch(): void {
    const start = this.pinchStart;
    if (!start || this.touchPointers.size < 2) {
      return;
    }
    const [a, b] = [...this.touchPointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = this.viewportOffsetVw((a.x + b.x) / 2, (a.y + b.y) / 2);
    const scale = clampZoom((start.scale * dist) / start.dist);
    const ratio = scale / start.scale;
    this.zoomScale = scale;
    this.scrollX = (start.mid.x + start.scrollX) * ratio - mid.x;
    this.scrollY = (start.mid.y + start.scrollY) * ratio - mid.y;
    this.updateClamp();
  }

  /** Returns true when the drag started on an interactive grid element. */
  private isCellOrBuilding(element: HTMLElement): boolean {
    let el: HTMLElement | null = element;
    while (el && el !== document.body) {
      if (el.classList.contains('planet-surface__cell')) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  /**
   * Sprite of a placed building or a building type. Every building has an
   * SVG generated by `npm run sprites:buildings` (scripts/building-sprites),
   * drawn with the same projection and inset as the planet view.
   */
  getBuildingSprite(b: { name: string; id?: string }): string {
    const def = this.buildingTypes.find((t) => t.name === b.name || t.id === b.id);
    const id = def?.id ?? this.slugify(b.name);
    return `buildings-svg/${id.replace(/_/g, '-')}.svg`;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  // ---------------------------------------------------------------
  // Scene: projection, sprites, streets, terrain
  // ---------------------------------------------------------------

  /** Screen position (vw at zoom 1) of a ground point given in world cells. */
  private project(u: number, v: number): { x: number; y: number } {
    const c = this.worldSize / 2;
    const du = u - c;
    const dv = v - c;
    return {
      x: ((du - dv) / Math.SQRT2) * this.cellVw,
      y: ((du + dv) / (2 * Math.SQRT2)) * this.cellVw,
    };
  }

  private refreshScene(): void {
    const planet = this.planet;
    const signature = planet
      ? `${planet.id}|${this.gridSize}|${planet.surface?.blocked ?? ''}|` +
        // `~` marks a site, so completion swaps it for the finished sprite.
        planet.buildings.map((b) => `${b.name}@${b.x},${b.y},${b.size}${isBuildingComplete(b) ? '' : '~'}`).join(';') +
        '|' +
        (planet.resourceTiles ?? []).map((r) => `${r.x},${r.y}`).join(';') +
        `|${this.terrain ? 1 : 0}`
      : '';
    if (signature === this.sceneSignature) {
      return;
    }
    this.sceneSignature = signature;
    if (!planet) {
      this.sprites = [];
      this.settlement = EMPTY_SETTLEMENT;
      this.zoneOutline = '';
      return;
    }
    const mask = getBlockedMask(planet);
    const terrain = this.terrain;
    this.settlement = computeSettlementLayout(
      planet.buildings,
      this.gridSize,
      mask,
      this.margin,
      terrain ? (u, v) => terrain.isOpenLand(u, v) : undefined,
    );
    this.zoneOutline = this.computeZoneOutline(mask);
    this.updateSprites();
  }

  /*
   * Rebuilds the sprite list (buildings, deposits, build ghost) in painter's
   * order. For non-overlapping footprints, A is behind B when A ends before
   * B starts on either ground axis. That relation is only applied when the
   * two sprites overlap horizontally on screen, which keeps it acyclic, so a
   * topological sort gives a correct order even for mixed footprint sizes
   * (sorting by the front corner alone is wrong for e.g. a 4×4 next to a 1×1).
   */
  private updateSprites(): void {
    const planet = this.planet;
    if (!planet) {
      this.sprites = [];
      return;
    }
    const items: DepthItem<Omit<SurfaceSprite, 'z'>>[] = [];
    planet.buildings.forEach((b, index) => {
      items.push({
        gx: b.x,
        gy: b.y,
        size: b.size,
        value: isBuildingComplete(b)
          ? { ...this.spriteFor(b.x, b.y, b.size, this.getBuildingSprite(b)), key: `b${index}`, kind: 'building' }
          : { ...this.spriteFor(b.x, b.y, b.size, this.getBuildingSprite(b)), key: `s${index}`, kind: 'site', building: b },
      });
    });
    (planet.resourceTiles ?? []).forEach((r, index) => {
      items.push({
        gx: r.x,
        gy: r.y,
        size: 1,
        value: { ...this.spriteFor(r.x, r.y, 1, DEPOSIT_SPRITE, DEPOSIT_INSET), key: `r${index}`, kind: 'deposit' },
      });
    });
    const sprites: SurfaceSprite[] = sortByDepth(items).map((item, i) => ({ ...item.value, z: i + 1 }));
    if (this.isBuildMode && this.selectedBuildingType && this.selectedCell) {
      const size = this.selectedBuildingType.size;
      sprites.push({
        ...this.spriteFor(
          this.selectedCell.col,
          this.selectedCell.row,
          size,
          this.getBuildingSprite(this.selectedBuildingType),
        ),
        key: 'ghost',
        kind: 'ghost',
        z: sprites.length + 1,
      });
    }
    this.sprites = sprites;
  }

  private spriteFor(
    x: number,
    y: number,
    size: number,
    src: string,
    inset = SPRITE_INSET,
  ): Pick<SurfaceSprite, 'src' | 'left' | 'top' | 'width'> {
    const front = this.project(this.margin + x + size - inset, this.margin + y + size - inset);
    return {
      src,
      left: front.x,
      top: front.y,
      width: (size - inset * 2) * Math.SQRT2 * this.cellVw,
    };
  }

  /** Outline (world cell units) around the buildable area of the grid. */
  private computeZoneOutline(mask: Uint8Array | null): string {
    const n = this.gridSize;
    const m = this.margin;
    const open = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < n && y < n && !(mask && mask[y * n + x]);
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!open(x, y)) continue;
        if (!open(x, y - 1)) d += `M${m + x} ${m + y}h1`;
        if (!open(x, y + 1)) d += `M${m + x} ${m + y + 1}h1`;
        if (!open(x - 1, y)) d += `M${m + x} ${m + y}v1`;
        if (!open(x + 1, y)) d += `M${m + x + 1} ${m + y}v1`;
      }
    }
    return d;
  }

  /** Building occupying a grid cell, if any. */
  buildingAt(row: number, col: number): PlanetBuilding | null {
    return (
      this.planet?.buildings.find(
        (b) => col >= b.x && col < b.x + b.size && row >= b.y && row < b.y + b.size,
      ) ?? null
    );
  }

  get hoveredBuilding(): PlanetBuilding | null {
    return this.hoveredCell ? this.buildingAt(this.hoveredCell.row, this.hoveredCell.col) : null;
  }

  onCellHover(row: number, col: number): void {
    this.hoveredCell = { row, col };
  }

  onSurfaceLeave(): void {
    this.hoveredCell = null;
  }

  /** Label anchor (vw at zoom 1) above a building's footprint center. */
  labelPosition(b: PlanetBuilding): { left: number; top: number } {
    const p = this.project(this.margin + b.x + b.size / 2, this.margin + b.y + b.size / 2);
    return { left: p.x, top: p.y - b.size * 0.45 * this.cellVw };
  }

  toggleLabels(): void {
    this.showLabels = !this.showLabels;
  }

  /*
   * The terrain is baked after the first frame so the view opens at once;
   * the canvas fades in when ready. The renderer caches results, so
   * reopening a planet is instant. Skipped under jsdom (no canvas).
   */
  private scheduleTerrainRender(): void {
    const planet = this.planet;
    const surface = planet?.surface;
    if (!planet || !surface || !this.terrainHost || isJsdom()) {
      return;
    }
    const pxPerCell = Math.max(24, Math.min(40, ((window.innerWidth * this.cellVw) / 100) * 0.55));
    const signature = `${planet.id}|${surface.seed}|${surface.blocked}|${Math.round(pxPerCell)}`;
    if (signature === this.terrainSignature) {
      return;
    }
    this.terrainSignature = signature;
    this.cancelTerrainRender();
    this.renderHandle = window.setTimeout(() => {
      this.renderHandle = null;
      const result = renderPlanetSurface({ surface, type: planet.type, pxPerCell });
      if (!result || !this.terrainHost || this.planet?.id !== planet.id) {
        return;
      }
      this.terrain = result;
      result.canvas.classList.add('planet-surface__terrain-canvas');
      this.terrainHost.nativeElement.replaceChildren(result.canvas);
      this.terrainBox = {
        left: result.left * this.cellVw,
        top: result.top * this.cellVw,
        width: result.width * this.cellVw,
        height: result.height * this.cellVw,
      };
      // Streets need the terrain's open-land data for the access road.
      this.refreshScene();
      requestAnimationFrame(() => (this.terrainReady = true));
    }, 30);
  }

  private cancelTerrainRender(): void {
    if (this.renderHandle !== null) {
      window.clearTimeout(this.renderHandle);
      this.renderHandle = null;
    }
  }
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

interface DepthItem<T> {
  gx: number;
  gy: number;
  size: number;
  value: T;
}

/* Topological painter's order for non-overlapping footprints, see updateSprites. */
function sortByDepth<T>(items: DepthItem<T>[]): DepthItem<T>[] {
  const n = items.length;
  const before: number[][] = items.map(() => []);
  const indegree = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const A = items[a];
      const B = items[b];
      // Screen X extent of a footprint spans (minX - maxY) .. (maxX - minY).
      const overlapX =
        A.gx + A.size - A.gy > B.gx - B.gy - B.size && B.gx + B.size - B.gy > A.gx - A.gy - A.size;
      if (overlapX && (A.gx + A.size <= B.gx || A.gy + A.size <= B.gy)) {
        before[a].push(b);
        indegree[b]++;
      }
    }
  }
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) ready.push(i);
  const out: DepthItem<T>[] = [];
  const placed = new Uint8Array(n);
  while (ready.length) {
    // Deterministic: among ready items emit the one furthest back first.
    ready.sort((x, y) => items[y].gx + items[y].gy - (items[x].gx + items[x].gy));
    const next = ready.pop()!;
    placed[next] = 1;
    out.push(items[next]);
    for (const b of before[next]) {
      if (--indegree[b] === 0) ready.push(b);
    }
  }
  // Overlapping (invalid) footprints could form a cycle; never drop sprites.
  for (let i = 0; i < n; i++) if (!placed[i]) out.push(items[i]);
  return out;
}

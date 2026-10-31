import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit,
} from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { BattleService, BattleOutcome } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { generatePlanetSurface, needsSurface } from './planet-surface/planet-surface-generator';
import { SAVE_VERSION, validateSaveData } from '../../services/save-validation';
import { EconomyService } from '../../services/economy.service';
import { GameTimeService, GameSpeed } from '../../services/game-time.service';
import { GameSettingsService } from '../../services/game-settings.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { GameOutcomeService, GameOutcome } from '../../services/game-outcome.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';
import {
  FleetOrganizationPlan,
  FleetOrganizationService,
  fleetCell,
} from '../../services/fleet-organization.service';
import { StarMapFleetManagerComponent } from './star-map-fleet-manager/star-map-fleet-manager.component';
import { ResearchService } from '../../services/research.service';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';
import { StarMapPauseComponent } from '../star-map-pause/star-map-pause.component';
import starMapData from './star-map-data.json';
import shipData from './ship-data.json';
import planetData from './planet-data.json';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import { StarMapAiTickService } from './star-map-ai-tick.service';
import { PlanetOwnershipService } from '../../services/planet-ownership.service';
import { EnemyDebugService, AiDebugSnapshot } from './enemy-debug.service';
import { AiDebugPanelComponent } from './ai-debug-panel/ai-debug-panel.component';
import {
  StarMapSensorService,
  SensorCellInfo,
  SensorPreviewCellInfo,
  SYSTEM_GRID_COLUMNS,
  SYSTEM_GRID_ROWS,
} from './star-map-sensor.service';
import {
  StarMapData,
  Fleet,
  FleetTrail,
  StarSystem,
  PlanetTile,
  ShipType,
  FleetShipTypeSummary,
  ContextMenuItem,
  PlanetEconomyEntry,
  ResourceDeposit,
  Faction,
  SpecialObject,
  GalaxyInfo,
  Nebula,
  DriftingAsteroid,
  AsteroidBelt,
} from './star-map.models';
import { DIPLOMACY_TURN_SECONDS, TRUCE_TURNS, areFactionsAllied, areFactionsHostile } from './diplomacy';
import { DiplomacyFailure, DiplomacyService } from '../../services/diplomacy.service';
import { EnemyDiplomacyService } from './enemy-diplomacy.service';
import { StarMapDiplomacyComponent } from './star-map-diplomacy/star-map-diplomacy.component';
import { StarMapPeaceNegotiationComponent } from './star-map-peace-negotiation/star-map-peace-negotiation.component';
import { PeaceTreaty, describeTreatyInvalid } from './peace-treaty';
import {
  DiplomacyRowVm,
  DiplomacySummaryVm,
  NegotiationVm,
  buildDiplomacyRows,
  buildDiplomacySummary,
  buildNegotiationVm,
  summarizeTreaty,
} from './star-map-diplomacy-vm';
import { StarMapTerrainService } from './star-map-terrain.service';
import { DriftingAsteroidService, AsteroidTickResult } from './drifting-asteroid.service';
import {
  ASTEROID_CONFIG,
  asteroidPosition,
  asteroidRemainingSeconds,
} from './drifting-asteroids';
import { NEBULA_CONFIG, nebulaSvgPath } from './nebula';
import { BeltView, buildBeltView } from './asteroid-belts';
import { RouteFailure } from './fleet-navigation';
import { FleetHeadingTracker, headingForDirection } from './fleet-heading';
import { AttackOrderHooks, updateAttackOrders } from './fleet-attack-orders';
import {
  StarMapAsteroidInfoComponent,
  AsteroidPanelViewModel,
} from './star-map-asteroid-info/star-map-asteroid-info.component';
import {
  AsteroidMapView,
  BlackHoleRingView,
  NebulaView,
} from './star-map-galaxy-view/star-map-galaxy-view.component';
import {
  createMulberry32,
  generateResourceTilesForPlanet as generateResourceTilesUtil,
  selectPlanetsForResources as selectPlanetsUtil,
} from './star-map-resources.util';
import { StarMapPanelVmService } from './star-map-panel-vm.service';
import { StarMapPlanetArrivalService } from './star-map-planet-arrival.service';
import {
  getFactionColor as getFactionColorUtil,
  getFactionName as getFactionNameUtil,
  getFactionCurrencies as getFactionCurrenciesUtil,
  getPlayerCurrencies as getPlayerCurrenciesUtil,
  getPlayerCredits as getPlayerCreditsUtil,
  getPlanetClassNames as getPlanetClassNamesUtil,
  getPlanetNumericSize as getPlanetNumericSizeUtil,
  getPlanetGridSize as getPlanetGridSizeUtil,
  getPlanetColor as getPlanetColorUtil,
  getFleetShipTypeSummary as getFleetShipTypeSummaryUtil,
  getFleetTotalAttack as getFleetTotalAttackUtil,
  getFleetTotalDefense as getFleetTotalDefenseUtil,
  getShipTypeById,
} from './star-map-display.util';

import { EconomyBreakdown } from '../../services/economy.service';

import { StarMapFleetInfoComponent } from './star-map-fleet-info/star-map-fleet-info.component';
import { StarMapSystemInfoComponent } from './star-map-system-info/star-map-system-info.component';
import { PlanetColonizationVm, StarMapPlanetInfoComponent } from './star-map-planet-info/star-map-planet-info.component';
import { StarMapPlanetScreenComponent } from './star-map-planet-screen/star-map-planet-screen.component';
import { StarMapFleetButtonsComponent } from './star-map-fleet-buttons/star-map-fleet-buttons.component';
import { StarMapContextMenuComponent } from './star-map-context-menu/star-map-context-menu.component';
import { StarMapHeaderComponent } from './star-map-header/star-map-header.component';
import { StarMapGalaxyViewComponent } from './star-map-galaxy-view/star-map-galaxy-view.component';
import { SpaceNebulaFieldComponent } from '../space-nebula-field/space-nebula-field.component';
import { StarMapSystemGridViewComponent } from './star-map-system-grid/star-map-system-grid.component';
import { ShipStockEntryDisplay } from './star-map-ship-stock/star-map-ship-stock.component';
import {
  ProductionPanelViewModel,
  QueueOrderRequest,
} from './star-map-production-panel/star-map-production-panel.component';
import { SpaceportPanelViewModel } from './star-map-spaceport-panel/star-map-spaceport-panel.component';
import { StarMapBlackholeComponent } from './blackhole/blackhole.component';
import { StarMapResearchTreeComponent } from './star-map-research-tree/star-map-research-tree.component';
import { buildingCost, payCost } from '../../services/resource-cost';

/*
 * =========================================================
 * STAR MAP COMPONENT
 * =========================================================
 *
 * Central gameplay component for Orion Imperium.
 * Now acts as an orchestrator, delegating logic to services
 * and UI to child components.
 *
 * Manages:
 * - Map view and system view switching
 * - Fleet movement (delegated to StarMapMovementService)
 * - Camera panning and clamping
 * - Grid-based object selection and context menus
 * - Collision-based battle detection (delegated to StarMapBattleDetectionService)
 * - Sensor range & fog-of-war computation (delegated to StarMapSensorService)
 * - Game loop with pause/resume (delegated to StarMapGameLoopService)
 * - Auto-save on state changes
 * - Save/load via SaveGameService
 */

const initialStarMapData = structuredClone(starMapData) as StarMapData;

@Component({
  selector: 'app-star-map',
  imports: [
    AiDebugPanelComponent,
    SpaceNebulaFieldComponent,
    StarMapPauseComponent,
    StarMapNavigationComponent,
    StarMapFleetInfoComponent,
    StarMapSystemInfoComponent,
    StarMapPlanetInfoComponent,
    StarMapPlanetScreenComponent,
    StarMapFleetButtonsComponent,
    StarMapContextMenuComponent,
    StarMapHeaderComponent,
    StarMapGalaxyViewComponent,
    StarMapSystemGridViewComponent,
    StarMapResearchTreeComponent,
    StarMapDiplomacyComponent,
    StarMapPeaceNegotiationComponent,
    StarMapAsteroidInfoComponent,
    StarMapFleetManagerComponent,
  ],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {
  currentView: 'map' | 'system' | 'planet' = 'map';

pauseMenuOpen = false;
loadError = '';
  saveError = '';

  // Game outcome
  gameOutcome: GameOutcome = 'inProgress';
  // Grid dimensions come from the loaded save (generated galaxies vary in
  // size); the legacy map's values are only the pre-load defaults.
  mapWidth = initialStarMapData.map.width;
  mapHeight = initialStarMapData.map.height;
  cellSizeVw = initialStarMapData.map.cellSizeVw;
  cellSizeVh = initialStarMapData.map.cellSizeVh;
  private readonly gridBreakpointPx = 1300;

  // Game state
  starSystems: StarSystem[] = initialStarMapData.starSystems;
  fleets: Fleet[] = initialStarMapData.fleets;
  factions: StarMapData['factions'] = initialStarMapData.factions;
  specialObjects: SpecialObject[] = initialStarMapData.specialObjects ?? [];
  // Terrain of the loaded galaxy (persisted in the save, never regenerated on load).
  nebulae: Nebula[] = [];
  // Render-only data derived from the terrain once per load (SVG paths are
  // not cheap enough to rebuild on every change-detection pass).
  nebulaViews: NebulaView[] = [];
  blackHoleRings: BlackHoleRingView[] = [];
  // Impassable asteroid belts (persisted geometry) and their render data.
  asteroidBelts: AsteroidBelt[] = [];
  beltViews: BeltView[] = [];

  // Drifting asteroid selection / panel state (asteroids themselves live in
  // DriftingAsteroidService and are persisted through serializeGameState).
  selectedAsteroidId: number | null = null;
  asteroidPanelVm: AsteroidPanelViewModel | null = null;
  asteroidPanelMessage: string | null = null;
  private asteroidPanelClock = 0;
  // Short gameplay notice on the galaxy HUD (asteroid collected, route blocked…).
  mapNotice: string | null = null;
  private mapNoticeClock = 0;
  private static readonly MAP_NOTICE_SECONDS = 6;
  shipStock: import('./star-map.models').FactionShipStock[] = initialStarMapData.shipStock ?? [];
  production: import('./star-map.models').FactionProduction[] = initialStarMapData.production ?? [];
  defaultView: import('./star-map.models').StarMapData['defaultView'] = initialStarMapData.defaultView ?? undefined;
  // Generation metadata of the current galaxy; carried through every save unchanged.
  galaxy: GalaxyInfo | undefined = undefined;

  private routerSubscription = new Subscription();
  // Tracks the most recent router URL that was not /star-map, so that
  // reloadAfterBattle() only runs when the player is actually returning
  // from the battle screen — not on MainMenu -> StarMap or any other
  // re-entry into the map view. The default '/' handles the very first
  // navigation into the component (MainMenu -> /star-map).
  private lastNonStarMapUrl: string = '/';
  // Selection state
  selectedSystem: StarSystem | null = null;
  selectedFleet: Fleet | null = null;
  selectedPlanetTile: PlanetTile | null = null;
  selectedFleetAction: 'move' | null = null;

  // Camera state.
  // cameraX/cameraY are the world-space (unscaled vw) coordinates of the
  // viewport's top-left corner. Zoom never changes this coordinate system:
  // it only scales how much world fits on screen (visibleWidthVw/HeightVw)
  // and is applied as a CSS scale() on the world grid. Every screen→world
  // conversion must therefore divide screen vw by `zoom`.
  cameraX = 0;
  cameraY = 0;
  readonly cameraSpeed = 2;

  // Discrete galaxy-map zoom levels, closest first. 1 is the original
  // (and closest) view; the remaining entries are the zoom-out steps
  // reachable with the mouse wheel. Zoom is a view preference and is not
  // persisted in saves (the camera position is stored in world units, so a
  // loaded camera is valid at any zoom).
  readonly zoomLevels: readonly number[] = [1, 0.75, 0.5, 0.35];
  zoomIndex = 0;
  // Trackpads and free-spinning wheels emit bursts of wheel events; without
  // a cooldown a single gesture would skip straight across every level.
  private readonly zoomStepCooldownMs = 150;
  private lastZoomStepAt = 0;

  get zoom(): number {
    return this.zoomLevels[this.zoomIndex];
  }

  // Drag/pan state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragCameraStartX = 0;
  private dragCameraStartY = 0;
  private dragMoved = false;
  private readonly dragThreshold = 5;

  // Parallax background: the background div must always be 200% of the actual
  // map grid (not 200% of the viewport) so the parallax shift never causes it to
  // "run out" when the camera is panned to the map edges.  All values are in vw
  // to stay consistent with the camera / parallax transform units.
  /** Background width in vw — 200% of the map grid width. */
  get bgWidthVw(): number {
    return this.movementService.gridColumns * this.cellSizeVw * 2;
  }

  /** Background height in vw — 200% of the map grid height. */
  get bgHeightVw(): number {
    return this.movementService.gridRows * this.cellSizeVh * 2;
  }

  /** Left offset in vw that centers the (2× map) background on the viewport. */
  get bgLeftVw(): number {
    return 50 - this.movementService.gridColumns * this.cellSizeVw;
  }

  /** Top offset in vw that centers the (2× map) background on the viewport. */
  get bgTopVw(): number {
    const viewportHeightVw = (window.innerHeight / window.innerWidth) * 100;
    return viewportHeightVw / 2 - this.movementService.gridRows * this.cellSizeVh;
  }

  // Movement targets
  targetX: number | null = null;
  targetY: number | null = null;

  // UI state
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  // Game time state
  get isPaused(): boolean {
    return this.gameTimeService.isPaused;
  }

  get gameSpeed(): GameSpeed {
    return this.gameTimeService.speed;
  }

  private timeControlSubscription?: Subscription;
  private settingsSubscription?: Subscription;

  // Production / spaceport panel state
  showProductionPanel = false;
  showBuildMenu = false;
  productionBuildError: string | null = null;
  showSpaceportPanel = false;
  spaceportError: string | null = null;
  // Why the player's last move command was rejected; shown in the fleet panel.
  // Set only by moveSelectedFleet (always a player click) and cleared by the
  // next accepted move or a selection change.
  fleetMoveError: string | null = null;
  spaceportFleetName = 'New Fleet';

  showResearchTree = false;
  showDiplomacy = false;
  /* Result line of the player's last diplomatic action, shown in the panel. */
  diplomacyMessage: string | null = null;
  /*
   * Open peace negotiation with one AI: the player's editable draft, the
   * AI's terms on the table (its proposal or counter-offer), the last
   * result line, and whether to resume the game on close.
   */
  negotiation: {
    aiId: string;
    draft: PeaceTreaty;
    incoming: NegotiationVm['incoming'];
    message: string | null;
    resumeOnClose: boolean;
  } | null = null;
  /* Set when an AI-vs-AI battle was auto-resolved this frame (fleet losses can end the game). */
  private autoBattleResolved = false;
  /* Offers already announced with a map notice (an offer is announced once). */
  private announcedOffers = new Set<string>();

  // Fleet manager dialog (docs/fleet-organization.md). Holds the co-located
  // player fleets captured when the dialog opened; null while closed. The
  // game is paused while it is open so the fleets cannot drift apart or be
  // attacked mid-edit; `fleetManagerResumeOnClose` restores the prior state.
  fleetManagerFleets: Fleet[] | null = null;
  // The player's ship stock when the dialog opened at an own Spaceport
  // (shown as the Reserve column), otherwise null: the stock is out of reach.
  fleetManagerReserve: import('./star-map.models').ShipStockEntry[] | null = null;
  fleetManagerError: string | null = null;
  private fleetManagerResumeOnClose = false;
  // Developer AI debug panel (F9). Snapshots refresh ~1×/s of real time only while open.
  aiDebugVisible = false;
  aiDebugSnapshots: AiDebugSnapshot[] = [];
  private aiDebugRefreshedAt = 0;

  isLandscape = false;

  // Event handlers for focus tracking
  private onWindowBlur = (): void => this.gameTimeService.pause();
  private onVisibilityChange = (): void => {
    if (document.hidden) this.gameTimeService.pause();
  };

  // Ship types
  readonly shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes;

  private economyAccumulator = 0;
  // Last PlanetOwnershipService.revision seen by the outcome check.
  private lastOwnershipRevision = -1;
  private readonly economyTickInterval = 1;
  private cachedPlayerEconomyBreakdown: EconomyBreakdown | null = null;

  // Throttled autosave for simulation-driven mutations (AI, economy,
  // production) that do not each have their own save trigger.
  private autosaveAccumulator = 0;
  private readonly autosaveIntervalSeconds = 3;
  private simStateDirty = false;

  // Sensor range & fog-of-war state
  exploredGridCells = new Set<string>();
  sensorRangeCells: Map<string, SensorCellInfo> = new Map();
  sensorPreviewCells: Map<string, SensorPreviewCellInfo> = new Map();
  sensorRangeEnabled = true;
  private visibilityDirty = true;

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private router: Router,
    private battleService: BattleService,
    private saveGameService: SaveGameService,
    private shipService: ShipService,
    private economyService: EconomyService,
    private planetBattleService: PlanetBattleService,
    private gameLoopService: StarMapGameLoopService,
    private gameTimeService: GameTimeService,
    public movementService: StarMapMovementService,
    private battleDetectionService: StarMapBattleDetectionService,
    private aiTickService: StarMapAiTickService,
    private sensorService: StarMapSensorService,
    private shipStockService: ShipStockService,
    private productionService: ProductionService,
    public spaceportService: SpaceportService,
    private fleetAssemblyService: FleetAssemblyService,
    private researchService: ResearchService,
    private panelVmService: StarMapPanelVmService,
    private arrivalService: StarMapPlanetArrivalService,
    private gameSettingsService: GameSettingsService,
    private gameOutcomeService: GameOutcomeService,
    private planetOwnership: PlanetOwnershipService,
    public aiDebugService: EnemyDebugService,
    private terrainService: StarMapTerrainService,
    private asteroidService: DriftingAsteroidService,
    private fleetOrganizationService: FleetOrganizationService,
    private diplomacyService: DiplomacyService,
    private enemyDiplomacyService: EnemyDiplomacyService,
  ) {
    this.movementService.initialize(
      this.cellSizeVw,
      this.cellSizeVh,
      this.mapWidth,
      this.mapHeight,
    );

    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        const url = event.urlAfterRedirects || event.url;
        const previousUrl = this.lastNonStarMapUrl;
        this.lastNonStarMapUrl = url;
        if (url === '/star-map' && previousUrl === '/battle') {
          this.reloadAfterBattle();
        }
      });
  }

  get currentSlot(): number | null {
    // Current save slot used by SaveGameService.
    return this.saveGameService.currentSlot;
  }

  get visibleFleets(): Fleet[] {
    // Fleets that are not destroyed AND visible to the player (fog-of-war).
    // Player fleets are always visible; enemy fleets must be in sensor range.
    // In system view, all fleets in the current system are visible.
    return this.fleets.filter((f) => !f.destroyed && this.isFleetVisible(f));
  }

  get minimapFleets(): { id: number; x: number; y: number; color: string }[] {
    return this.visibleFleets.map((f) => ({
      id: f.id,
      x: f.x,
      y: f.y,
      color: this.getFactionColor(f.factionId),
    }));
  }

  /** Star systems that have been explored (visible on the galaxy map). */
  get exploredStarSystems(): StarSystem[] {
    return this.starSystems.filter((s) => s.explored !== false);
  }

  /** Returns true if a fleet is visible to the player under fog-of-war rules. */
  isFleetVisible(fleet: Fleet): boolean {
    if (!this.sensorRangeEnabled) {
      return true;
    }
    if (fleet.factionId === 'player') {
      return true;
    }
    if (
      this.currentView === 'system' &&
      this.selectedSystem &&
      fleet.system?.id === this.selectedSystem.id
    ) {
      return true;
    }
    const col = Math.floor(fleet.x);
    const row = Math.floor(fleet.y);
    const key = `${col}-${row}`;
    return this.sensorRangeCells.has(key) || this.sensorPreviewCells.has(key);
  }

  /**
   * Returns true if a fleet is detected in the outer-ring preview band
   * (R+1..R+2) but NOT in the fully-clear sensor range. Used to attach the
   * faded `.fleet--preview` modifier so the player sees that the contact is
   * low-confidence.
   *
   * Player fleets are never faded, even if they happen to land in another
   * player source's preview band.
   */
  isEnemyInPreview(fleet: Fleet): boolean {
    if (fleet.factionId === 'player') {
      return false;
    }
    const col = Math.floor(fleet.x);
    const row = Math.floor(fleet.y);
    const key = `${col}-${row}`;
    return this.sensorPreviewCells.has(key) && !this.sensorRangeCells.has(key);
  }

  /**
   * Movement trails for the galaxy map view.
   *
   * A trail is rendered for every fleet that has an active target, i.e. is
   * currently travelling. Visibility follows the same fog-of-war rules as
   * fleets themselves:
   * - Fog of war ON: only the player's own trails are shown.
   * - Fog of war OFF: every faction's trails are shown, regardless of
   *   sensor range.
   *
   * The returned coordinates are already in vw units so the presentational
   * galaxy-view child component only binds style properties.
   */
  get galaxyTrails(): FleetTrail[] {
    const trails: FleetTrail[] = [];
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }
      // Visibility: player trails always show; enemy trails only when
      // fog of war is disabled OR the fleet itself is visible.
      if (fleet.factionId !== 'player') {
        if (this.sensorRangeEnabled && !this.isFleetVisible(fleet)) {
          continue;
        }
      }
      // One trail per route leg so a detour around a black hole is drawn
      // exactly as it will be flown.
      const color = this.getFactionColor(fleet.factionId);
      this.movementService.getGalaxyTrailSegmentsVw(fleet).forEach((vw, segment) => {
        trails.push({
          fleetId: fleet.id,
          segment,
          factionId: fleet.factionId,
          color,
          x1: vw.x1,
          y1: vw.y1,
          x2: vw.x2,
          y2: vw.y2,
        });
      });
    }
    return trails;
  }

  /*
   * Drifting asteroids the player can see. Asteroids are bright, fast-moving
   * objects visible across the map, except inside a nebula: there they are
   * only seen within the player's (nebula-reduced) sensor coverage — the
   * same rule EnemyIntelService.isPointSensed applies to the AI.
   */
  isAsteroidVisible(asteroid: DriftingAsteroid): boolean {
    if (!this.sensorRangeEnabled) {
      return true;
    }
    const pos = asteroidPosition(asteroid);
    if (!this.terrainService.isPointInNebula(pos.x, pos.y)) {
      return true;
    }
    const key = `${Math.floor(pos.x)}-${Math.floor(pos.y)}`;
    return this.sensorRangeCells.has(key) || this.sensorPreviewCells.has(key);
  }

  get visibleAsteroids(): AsteroidMapView[] {
    const targeted = new Set(
      this.fleets
        .filter((f) => f.factionId === 'player' && !f.destroyed && f.interceptAsteroidId != null)
        .map((f) => f.interceptAsteroidId as number),
    );
    const views: AsteroidMapView[] = [];
    for (const asteroid of this.asteroidService.active) {
      if (!this.isAsteroidVisible(asteroid)) {
        continue;
      }
      const pos = asteroidPosition(asteroid);
      views.push({
        id: asteroid.id,
        type: asteroid.type,
        label: ASTEROID_CONFIG.types[asteroid.type].label,
        left: (pos.x - 0.5) * this.cellSizeVw,
        top: (pos.y - 0.5) * this.cellSizeVh,
        // The tail grows from the entry point up to its full length, so it
        // never extends outside the map.
        trailLength: Math.min(asteroid.traveled, ASTEROID_CONFIG.trailLength) * this.cellSizeVw,
        angleDeg: (Math.atan2(asteroid.dirY, asteroid.dirX) * 180) / Math.PI,
        selected: this.selectedAsteroidId === asteroid.id,
        targeted: targeted.has(asteroid.id),
      });
    }
    return views;
  }

  /* True when a fleet's galaxy position is inside a nebula (slowed, sensors impaired). */
  isFleetInNebula(fleet: Fleet): boolean {
    return this.terrainService.isPointInNebula(fleet.x, fleet.y);
  }

  /* Remaining galaxy travel time of the selected fleet (game seconds), or null. */
  getSelectedFleetEta(): number | null {
    if (!this.selectedFleet || this.currentView !== 'map') {
      return null;
    }
    return this.movementService.estimateRemainingTravelSeconds(this.selectedFleet);
  }

  getSelectedFleetInterceptLabel(): string | null {
    const id = this.selectedFleet?.interceptAsteroidId;
    if (id == null) {
      return null;
    }
    const asteroid = this.asteroidService.getAsteroid(id);
    return asteroid ? ASTEROID_CONFIG.types[asteroid.type].label : null;
  }

  readonly nebulaSpeedPenaltyPercent = Math.round((1 - NEBULA_CONFIG.speedMultiplier) * 100);
  readonly nebulaSensorPenaltyPercent = Math.round((1 - NEBULA_CONFIG.sensorMultiplier) * 100);

  /*
   * Click on an asteroid. With a player fleet selected in MOVE mode the
   * click is an intercept order for that fleet; otherwise it opens the
   * asteroid panel (fleet selection is kept so the player can compare).
   */
  onAsteroidClick(asteroidId: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }
    if (this.selectedFleet?.factionId === 'player' && this.selectedFleetAction === 'move') {
      this.selectedFleetAction = null;
      this.selectAsteroid(asteroidId);
      this.onInterceptAsteroid(this.selectedFleet.id);
      return;
    }
    this.selectAsteroid(asteroidId);
  }

  selectAsteroid(asteroidId: number): void {
    this.selectedAsteroidId = asteroidId;
    this.asteroidPanelMessage = null;
    this.selectedSystem = null;
    this.refreshAsteroidPanel();
    this.cdr.detectChanges();
  }

  deselectAsteroid(): void {
    this.selectedAsteroidId = null;
    this.asteroidPanelVm = null;
    this.asteroidPanelMessage = null;
    this.cdr.detectChanges();
  }

  /* Orders a player fleet to intercept the selected asteroid. */
  onInterceptAsteroid(fleetId: number): void {
    const fleet = this.fleets.find((f) => f.id === fleetId && f.factionId === 'player' && !f.destroyed);
    if (!fleet || this.selectedAsteroidId == null) {
      return;
    }
    const result = this.asteroidService.orderIntercept(fleet, this.selectedAsteroidId);
    if (result.ok) {
      fleet.attackFleetId = null;
      this.asteroidPanelMessage = null;
      if (this.selectedFleet?.id === fleet.id) {
        this.fleetMoveError = null;
        this.targetX = fleet.targetX;
        this.targetY = fleet.targetY;
      }
      this.saveGame();
    } else {
      this.asteroidPanelMessage =
        result.reason === 'gone'
          ? 'The asteroid is no longer there.'
          : `${fleet.name} cannot reach the asteroid before it leaves the map.`;
    }
    this.refreshAsteroidPanel();
    this.cdr.detectChanges();
  }

  /*
   * Rebuilds the asteroid panel view model. Intercept estimates plan routes,
   * so this runs on selection, after orders, and at most every 0.5 game
   * seconds from the game loop — not from a template getter.
   */
  private refreshAsteroidPanel(): void {
    const asteroid = this.selectedAsteroidId == null ? undefined : this.asteroidService.getAsteroid(this.selectedAsteroidId);
    if (!asteroid || !this.isAsteroidVisible(asteroid)) {
      this.selectedAsteroidId = null;
      this.asteroidPanelVm = null;
      return;
    }
    const cargo: { label: string; amount: number }[] = [];
    if (asteroid.reward.rawmaterials) cargo.push({ label: 'RAW MATERIALS', amount: asteroid.reward.rawmaterials });
    if (asteroid.reward.research) cargo.push({ label: 'RESEARCH POINTS', amount: asteroid.reward.research });
    const fleets = this.fleets
      .filter((f) => f.factionId === 'player' && !f.destroyed && f.ships.some((s) => !s.destroyed))
      .map((fleet) => {
        const intercepting = fleet.interceptAsteroidId === asteroid.id;
        const plan = intercepting ? null : this.asteroidService.planIntercept(fleet, asteroid);
        return { fleetId: fleet.id, name: fleet.name, etaSeconds: plan ? plan.time : null, intercepting };
      });
    this.asteroidPanelVm = {
      id: asteroid.id,
      type: asteroid.type,
      label: ASTEROID_CONFIG.types[asteroid.type].label,
      cargo,
      secondsToExit: asteroidRemainingSeconds(asteroid),
      fleets,
    };
  }

  private showMapNotice(text: string): void {
    this.mapNotice = text;
    this.mapNoticeClock = 0;
  }

  /* Player-facing reactions to one asteroid tick (rewards, lost targets). */
  private handleAsteroidEvents(result: AsteroidTickResult): void {
    for (const collection of result.collected) {
      const fleet = this.fleets.find((f) => f.id === collection.fleetId);
      const label = ASTEROID_CONFIG.types[collection.asteroid.type].label;
      const parts: string[] = [];
      if (collection.reward.rawmaterials) parts.push(`+${collection.reward.rawmaterials} raw materials`);
      if (collection.reward.research) parts.push(`+${collection.reward.research} research`);
      if (collection.factionId === 'player') {
        this.showMapNotice(`${fleet?.name ?? 'Fleet'} recovered a ${label}: ${parts.join(', ')}`);
      } else if (this.isAsteroidVisible(collection.asteroid)) {
        this.showMapNotice(`${this.getFactionName(collection.factionId)} claimed a ${label}.`);
      }
      if (this.selectedAsteroidId === collection.asteroid.id) {
        this.selectedAsteroidId = null;
        this.asteroidPanelVm = null;
      }
    }
    for (const failure of result.failedIntercepts) {
      const fleet = this.fleets.find((f) => f.id === failure.fleetId);
      if (fleet?.factionId === 'player') {
        this.showMapNotice(`${fleet.name} lost the asteroid: it can no longer be intercepted.`);
        if (this.selectedFleet?.id === fleet.id) {
          this.targetX = null;
          this.targetY = null;
        }
      }
    }
  }

  readonly boundOnAsteroidClick = this.onAsteroidClick.bind(this);
  readonly boundIsFleetInNebula = this.isFleetInNebula.bind(this);

  /*
   * Render-only ship headings, one tracker per view (a fleet's galaxy leg
   * and its in-system movement point in unrelated directions). Never saved.
   */
  private readonly galaxyHeadings = new FleetHeadingTracker();
  private readonly systemHeadings = new FleetHeadingTracker();
  readonly boundGalaxyFleetHeading = (fleet: Fleet): number => this.galaxyHeadings.get(fleet.id);
  readonly boundSystemFleetHeading = (fleet: Fleet): number => this.systemHeadings.get(fleet.id);

  /*
   * Turns every ship toward its current movement leg. Galaxy: the next route
   * waypoint (fleets steer around obstacles) or the final target, converted
   * to screen space with the view's per-axis cell sizes. System view: the
   * in-system target, already in uniform vw. Returns true if any heading
   * changed (redraw needed; not a simulation change).
   */
  private updateFleetHeadings(dt: number): boolean {
    const galaxyChanged = this.galaxyHeadings.update(this.fleets, dt, (fleet) => {
      if (fleet.targetX === null || fleet.targetY === null) return null;
      const next = this.movementService.getActiveRoute(fleet)?.waypoints[0];
      const nx = next ? next.x : fleet.targetX;
      const ny = next ? next.y : fleet.targetY;
      return headingForDirection((nx - fleet.x) * this.cellSizeVw, (ny - fleet.y) * this.cellSizeVh);
    });
    const systemChanged = this.systemHeadings.update(this.fleets, dt, (fleet) => {
      const sys = fleet.system;
      if (!sys || sys.targetX === null || sys.targetY === null) return null;
      return headingForDirection(sys.targetX - sys.x, sys.targetY - sys.y);
    });
    return galaxyChanged || systemChanged;
  }

  /*
   * Derives the render-only terrain data (nebula SVG paths, black hole
   * no-fly rings) from the loaded save.
   */
  private rebuildTerrainViews(): void {
    this.nebulaViews = this.nebulae.map((nebula) => ({
      id: nebula.id,
      color: nebula.color,
      halo: nebulaSvgPath(nebula, 1.15),
      body: nebulaSvgPath(nebula, 1),
      core: nebulaSvgPath(nebula, 0.55),
      cx: nebula.x - 0.5,
      cy: nebula.y - 0.5,
      // Covers the halo (scale 1.15 x the largest lobe, <= ~1.26) on every side.
      textureSize: nebula.radius * 3,
      rotationDeg: (nebula.rotation * 180) / Math.PI,
    }));
    this.beltViews = this.asteroidBelts.map((belt) => buildBeltView(belt));
    this.blackHoleRings = this.terrainService.obstacles.filter((o) => o.kind === 'blackhole').map((o) => ({
      cx: o.x - 0.5,
      cy: o.y - 0.5,
      r: o.radius,
    }));
  }

  /**
   * Movement trails for the currently open star system view.
   *
   * Only fleets that are inside the selected system AND have an active
   * system-view target contribute a trail. Visibility follows the same
   * fog-of-war rules as `galaxyTrails`.
   */
  get systemTrails(): FleetTrail[] {
    if (!this.selectedSystem) {
      return [];
    }
    const trails: FleetTrail[] = [];
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }
      if (fleet.factionId !== 'player') {
        if (this.sensorRangeEnabled && !this.isFleetVisible(fleet)) {
          continue;
        }
      }
      const vw = this.movementService.getSystemTrailVw(fleet, this.selectedSystem.id);
      if (!vw) {
        continue;
      }
      trails.push({
        fleetId: fleet.id,
        factionId: fleet.factionId,
        color: this.getFactionColor(fleet.factionId),
        x1: vw.x1,
        y1: vw.y1,
        x2: vw.x2,
        y2: vw.y2,
      });
    }
    return trails;
  }

  /** Returns the array of sensor range cell infos for template rendering. */
  get sensorRangeCellsArray(): SensorCellInfo[] {
    return Array.from(this.sensorRangeCells.values());
  }

  /**
   * Returns the array of outer-ring preview cell infos for template rendering.
   * Preview cells render as a faint dashed halo just outside the fully-clear
   * sensor radius and are NOT part of the explored set.
   */
  get sensorPreviewCellsArray(): SensorPreviewCellInfo[] {
    return Array.from(this.sensorPreviewCells.values());
  }

  /**
   * Returns fog cells (unexplored cells within the viewport) for template rendering.
   * Called only when the camera is stationary or the explored set changes.
   */
  get fogCells(): { col: number; row: number; explored: boolean }[] {
    if (!this.sensorRangeEnabled) {
      return [];
    }

    const cells = this.sensorService.getViewportCells(
      this.cameraX,
      this.cameraY,
      this.visibleWidthVw,
      this.visibleHeightVw,
      this.cellSizeVw,
      this.cellSizeVh,
      this.mapWidth,
      this.mapHeight,
    );

    const fog: { col: number; row: number; explored: boolean }[] = [];
    for (const cell of cells) {
      const key = `${cell.col}-${cell.row}`;
      if (!this.exploredGridCells.has(key)) {
        fog.push({ col: cell.col, row: cell.row, explored: false });
      } else if (!this.sensorRangeCells.has(key) && this.sensorRangeEnabled) {
        fog.push({ col: cell.col, row: cell.row, explored: true });
      }
    }
    return fog;
  }

  /**
   * Returns the sensor range cells for the selected fleet in system view,
   * split into fully-clear cells and outer-ring preview cells.
   */
  get systemSensorCells(): {
    cells: { col: number; row: number }[];
    preview: { col: number; row: number }[];
  } {
    if (!this.sensorRangeEnabled || !this.selectedFleet || !this.selectedFleet.system?.id) {
      return { cells: [], preview: [] };
    }
    return this.sensorService.computeSystemSensorCells(this.selectedFleet);
  }

  /** Toggles the visibility of sensor range grid highlights. */
  toggleSensorRange(): void {
    this.sensorRangeEnabled = !this.sensorRangeEnabled;
    this.cdr.detectChanges();
  }

  // Pause menu handlers

  /** Opens the pause menu and pauses the game loop. */
  openPauseMenu(): void {
    this.pauseMenuOpen = true;
    this.gameTimeService.pause();
  }

  onOpenOptionsMenu(): void {
    this.gameSettingsService.openOptionsMenu();
  }

  /** Closes the pause menu and resumes the game loop. */
  closePauseMenu(): void {
    this.pauseMenuOpen = false;
    this.gameTimeService.resume();
  }

  /** Saves the current game state to the chosen manual slot. */
  saveFromMenu(slotIndex: number): void {
    const data = this.serializeGameState();
    this.saveGameService.saveToSlot(slotIndex, data);
    this.saveError = this.saveGameService.getSlotsError() ?? '';
  }

  /** Loads a save game from the specified slot index. */
  loadFromMenu(slotIndex: number): void {
    if (!this.saveGameService.activateSlot(slotIndex)) {
      return;
    }
    // A manual load starts a fresh session; drop any transient battle
    // residue that belongs to the session being replaced.
    this.battleService.clearBattle();
    this.loadGame();
    this.closePauseMenu();
  }

  /** Saves the game and navigates back to the main menu. */
  exitToMainMenu(): void {
    this.saveGame();
    this.router.navigate(['']);
  }

  /** Transitions from the map view into a star system view, syncing fleet positions. */
  enterSystem(): void {
    this.saveGame();
    if (this.selectedSystem) {
      this.currentView = 'system';
      this.initFleetsInSystem(this.selectedSystem);
      this.syncTargetFromSelectedFleet();
    }
  }

  /*
   * initFleetsInSystem: For every active fleet whose galaxy cell matches
   * `system`, ensure `fleet.system` is set and re-derive `gridCol` /
   * `gridRow` from `fleet.system.{x,y}`. This is what makes the system
   * view actually render fleets after a save/restore round-trip and
   * after `createFleet` spawns a new fleet on a planet cell.
   */
  private initFleetsInSystem(system: StarSystem): void {
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (this.movementService.isFleetInSystem(fleet, system)) {
        if (!fleet.system) {
          fleet.system = {
            id: system.id,
            x: 2.5,
            y: 32.5,
            targetX: null,
            targetY: null,
          };
        } else {
          fleet.system.id = system.id;
        }
        const sysCell = this.movementService.calculateSystemGridCell(
          fleet.system.x,
          fleet.system.y,
        );
        fleet.gridCol = sysCell.col;
        fleet.gridRow = sysCell.row;
      }
    }
  }

  /*
   * syncTargetFromSelectedFleet: Copy the selected fleet's movement
   * target to the visible target marker, depending on the current view.
   * Centralised so both `enterSystem` and the create-success path can
   * use it.
   */
  private syncTargetFromSelectedFleet(): void {
    if (this.selectedFleet && this.selectedFleet.system?.targetX != null) {
      this.targetX = this.selectedFleet.system.targetX ?? null;
      this.targetY = this.selectedFleet.system.targetY ?? null;
    } else {
      this.targetX = null;
      this.targetY = null;
    }
  }

  /*
   * applyDefaultView: Sets the initial view from the star-map-data.json
   * defaultView config. Used only when starting a new game with no saved
   * runtime view state. Falls back to 'map' if the referenced system or
   * planet does not exist.
   */
  private applyDefaultView(defaultView: StarMapData['defaultView']): void {
    if (!defaultView) {
      this.currentView = 'map';
      this.selectedSystem = null;
      this.selectedPlanetTile = null;
      this.cameraX = 0;
      this.cameraY = 0;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
      return;
    }

    switch (defaultView.type) {
      case 'map':
        this.currentView = 'map';
        this.cameraX = defaultView.cameraX ?? 0;
        this.cameraY = defaultView.cameraY ?? 0;
        this.selectedSystem = null;
        this.selectedPlanetTile = null;
        this.targetX = null;
        this.targetY = null;
        this.selectedFleetAction = null;
        break;

      case 'system': {
        const system = this.starSystems.find((s) => s.id === defaultView.systemId);
        if (!system) {
          this.currentView = 'map';
          this.selectedSystem = null;
          this.selectedPlanetTile = null;
          this.cameraX = 0;
          this.cameraY = 0;
          this.targetX = null;
          this.targetY = null;
          this.selectedFleetAction = null;
          break;
        }
        this.currentView = 'system';
        this.selectedSystem = system;
        this.selectedPlanetTile = null;
        this.centerCameraOnDefaultView(defaultView, system);
        this.targetX = null;
        this.targetY = null;
        this.selectedFleetAction = null;
        this.initFleetsInSystem(system);
        this.syncTargetFromSelectedFleet();
        break;
      }

      case 'planet': {
        const system = this.starSystems.find((s) => s.id === defaultView.systemId);
        const planet = system?.planetsTiles?.find((p) => p.id === defaultView.planetId);
        if (!system || !planet) {
          this.currentView = 'map';
          this.selectedSystem = null;
          this.selectedPlanetTile = null;
          this.cameraX = 0;
          this.cameraY = 0;
          this.targetX = null;
          this.targetY = null;
          this.selectedFleetAction = null;
          break;
        }
        this.currentView = 'planet';
        this.selectedSystem = system;
        this.selectedPlanetTile = planet;
        this.centerCameraOnDefaultView(defaultView, system);
        this.targetX = null;
        this.targetY = null;
        this.selectedFleetAction = null;
        this.initFleetsInSystem(system);
        this.syncTargetFromSelectedFleet();
        break;
      }

      default:
        this.currentView = 'map';
        this.selectedSystem = null;
        this.selectedPlanetTile = null;
        this.cameraX = 0;
        this.cameraY = 0;
        this.targetX = null;
        this.targetY = null;
        this.selectedFleetAction = null;
    }
  }

  /*
   * Positions the galaxy camera for a system/planet default view so that
   * leaving the start view lands on the home system. Generated galaxies can
   * put the home anywhere, so the camera cannot simply stay at (0, 0).
   * Explicit cameraX/cameraY in the defaultView still win.
   */
  private centerCameraOnDefaultView(
    defaultView: NonNullable<StarMapData['defaultView']>,
    system: StarSystem,
  ): void {
    if (defaultView.cameraX !== undefined || defaultView.cameraY !== undefined) {
      this.cameraX = defaultView.cameraX ?? 0;
      this.cameraY = defaultView.cameraY ?? 0;
      return;
    }
    this.centerCameraOnGridPosition(system.x, system.y);
  }

  /** Exits the current star system and returns to the galaxy map view. */
  leaveSystem(): void {
    this.saveGame();
    this.currentView = 'map';

    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.system?.id != null) {
        const mapCell = this.movementService.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = mapCell.col;
        fleet.gridRow = mapCell.row;
      }
    }

    if (this.selectedFleet && this.selectedFleet.targetX != null) {
      this.targetX = this.selectedFleet.targetX;
      this.targetY = this.selectedFleet.targetY;
    } else {
      this.targetX = null;
      this.targetY = null;
    }
  }

  // Faction helpers

  /** Returns the color associated with a faction ID. */
  getFactionColor(factionId: string): string {
    return getFactionColorUtil(this.factions, factionId);
  }

  /** Returns the display name of a faction by its ID. */
  getFactionName(factionId: string): string {
    return getFactionNameUtil(this.factions, factionId);
  }

  /** Returns the player's currencies as key-value pairs. */
  getPlayerCurrencies(): { name: string; value: number }[] {
    return getPlayerCurrenciesUtil(this.factions);
  }

  /** Returns the player's current credit balance. */
  getPlayerCredits(): number {
    return getPlayerCreditsUtil(this.factions);
  }

  /** Handles confirmation of a building placement from the planet screen. */
  onBuildingConfirmed(event: { buildingId: string; x: number; y: number }): void {
    const planet = this.selectedPlanetTile;
    if (!planet) return;

    const player = this.factions.find((f) => f.id === 'player');
    if (!player?.currencies) return;

    if (!this.researchService.isBuildingUnlocked(player, event.buildingId)) {
      return;
    }

    const buildingDef = (
      planetData as { buildings: { id: string; price: number; rawMaterialCost?: number; size: number; name: string }[] }
    ).buildings.find((b) => b.id === event.buildingId);
    if (!buildingDef) return;

    // Credits and raw materials are checked and deducted together.
    if (!payCost(player, buildingCost(buildingDef))) return;

    planet.buildings.push({
      name: buildingDef.name,
      size: buildingDef.size,
      x: event.x,
      y: event.y,
    });

    this.cdr.detectChanges();
  }

  /** Returns the player's economy breakdown for the currency overlay. */
  getPlayerEconomyBreakdown(): EconomyBreakdown {
    if (this.cachedPlayerEconomyBreakdown) {
      return this.cachedPlayerEconomyBreakdown;
    }
    return this.economyService.calculateEconomy(
      'player',
      this.factions,
      this.starSystems,
      this.fleets,
      this.shipStock,
    );
  }

  getPlayerShipStockEntries(): ShipStockEntryDisplay[] {
    const summary = this.shipStockService.getSummary(this, 'player');
    return summary
      .map((entry) => {
        const type = this.shipService.getShipType(entry.typeId);
        return { typeId: entry.typeId, typeName: type?.name ?? entry.typeId, count: entry.count };
      })
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
  }

  getPlayerShipStockTotal(): number {
    return this.shipStockService.getCount(this, 'player');
  }

  getProductionPanelVm(): ProductionPanelViewModel | null {
    return this.panelVmService.getProductionPanelVm(
      this,
      this.selectedPlanetTile,
      this.selectedSystem,
      this.factions,
    );
  }

  getSpaceportPanelVm(): SpaceportPanelViewModel | null {
    return this.panelVmService.getSpaceportPanelVm(
      this,
      this.selectedPlanetTile,
      this.selectedSystem,
      this.starSystems,
      this.factions,
      this.spaceportError,
    );
  }

  openProductionPanel(): void {
    this.showProductionPanel = true;
    this.showBuildMenu = false;
    this.productionBuildError = null;
  }

  closeProductionPanel(): void {
    this.showProductionPanel = false;
    this.showBuildMenu = false;
  }

  onOpenBuildMenu(): void {
    this.showBuildMenu = true;
    this.productionBuildError = null;
  }

  onCloseBuildMenu(): void {
    this.showBuildMenu = false;
  }

  onQueueOrder(req: QueueOrderRequest): void {
    if (!this.selectedPlanetTile) {
      return;
    }
    const result = this.productionService.queueOrder(
      this,
      'player',
      this.selectedPlanetTile.id,
      req.shipTypeId,
      req.quantity,
      this.starSystems,
      this.factions,
    );
    if (!result.ok) {
      this.productionBuildError = this.describeProductionError(result.reason);
      return;
    }
    this.productionBuildError = null;
    this.saveGame();
  }

  onCancelOrder(orderId: number): void {
    if (!this.selectedPlanetTile) {
      return;
    }
    this.productionService.cancelOrder(
      this,
      'player',
      this.selectedPlanetTile.id,
      orderId,
      this.factions,
    );
    this.saveGame();
  }

  private describeProductionError(reason: string | undefined): string {
    return this.panelVmService.describeProductionError(reason);
  }

  openSpaceportPanel(): void {
    if (!this.spaceportService.hasSpaceport('player', this.starSystems)) {
      this.spaceportError = 'You need a Spaceport to assemble fleets.';
      return;
    }
    this.spaceportFleetName = this.suggestFleetName();
    this.spaceportError = null;
    this.showSpaceportPanel = true;
  }

  closeSpaceportPanel(): void {
    this.showSpaceportPanel = false;
    this.spaceportError = null;
  }

  openResearchTree(): void {
    this.showResearchTree = true;
  }

  closeResearchTree(): void {
    this.showResearchTree = false;
  }

  /* ---------- Diplomacy (docs/diplomacy.md) ---------- */

  openDiplomacy(): void {
    this.diplomacyMessage = null;
    this.showDiplomacy = true;
  }

  closeDiplomacy(): void {
    this.showDiplomacy = false;
  }

  /* Number of open AI peace proposals; drives the header badge. */
  getDiplomacyAlertCount(): number {
    return this.diplomacyService.getOfferIds().length;
  }

  getDiplomacyRows(): DiplomacyRowVm[] {
    const player = this.getPlayerFaction();
    return player ? buildDiplomacyRows(player, this.liveDiplomacyContext(), this.diplomacyService, this.enemyDiplomacyService) : [];
  }

  getDiplomacySummary(): DiplomacySummaryVm | null {
    const player = this.getPlayerFaction();
    return player ? buildDiplomacySummary(player, this.liveDiplomacyContext()) : null;
  }

  onDeclareWar(factionId: string): void {
    const player = this.getPlayerFaction();
    const target = this.factions.find((f) => f.id === factionId);
    if (!player || !target) return;
    const result = this.diplomacyService.declareWar(player, target);
    this.diplomacyMessage = result.ok
      ? `You declared war on ${target.name}. Reputation and their opinion of you dropped.`
      : this.describeDiplomacyFailure(target, result.reason, result.waitSeconds);
    if (result.ok) this.afterTreatyChange();
  }

  onBreakTreaty(factionId: string): void {
    const player = this.getPlayerFaction();
    const target = this.factions.find((f) => f.id === factionId);
    if (!player || !target) return;
    const result = this.diplomacyService.breakTreaty(player, target);
    this.diplomacyMessage = result.ok
      ? `You broke the treaty with ${target.name}. Every empire now trusts you less.`
      : this.describeDiplomacyFailure(target, result.reason, result.waitSeconds);
    if (result.ok) this.afterTreatyChange();
  }

  onDeclinePeaceOffer(factionId: string): void {
    const ai = this.factions.find((f) => f.id === factionId);
    this.diplomacyService.removeOffer(factionId);
    if (this.negotiation?.aiId === factionId && this.negotiation.incoming?.kind === 'offer') {
      this.negotiation = { ...this.negotiation, incoming: null, message: ai ? `You rejected the proposal of ${ai.name}.` : null };
    }
    this.diplomacyMessage = ai ? `You rejected the peace proposal of ${ai.name}.` : null;
  }

  /*
   * Opens the negotiation dialog with an AI at war with the player. The
   * game pauses while negotiating (resumed on close if it was running), so
   * the AI's judgment shown in the dialog cannot go stale meanwhile. An
   * open AI proposal is shown as incoming terms.
   */
  openNegotiation(factionId: string): void {
    const player = this.getPlayerFaction();
    const ai = this.factions.find((f) => f.id === factionId);
    if (!player || !ai || ai.ai !== true) return;
    const offer = this.diplomacyService.getOffer(ai.id);
    if (!offer && !this.diplomacyService.canNegotiate(player, ai).ok) return;
    this.negotiation = {
      aiId: ai.id,
      draft: { proposerId: player.id, recipientId: ai.id, items: [] },
      incoming: offer
        ? { kind: 'offer', treaty: offer.treaty, summary: summarizeTreaty(offer.treaty, player.id, this.liveDiplomacyContext()), secondsLeft: Math.ceil(offer.secondsLeft) }
        : null,
      message: null,
      resumeOnClose: !this.gameTimeService.isPaused,
    };
    this.gameTimeService.pause();
    this.cdr.detectChanges();
  }

  closeNegotiation(): void {
    const resume = this.negotiation?.resumeOnClose ?? false;
    this.negotiation = null;
    if (resume) this.gameTimeService.resume();
    this.cdr.detectChanges();
  }

  getNegotiationVm(): NegotiationVm | null {
    const player = this.getPlayerFaction();
    const ai = this.negotiation ? this.factions.find((f) => f.id === this.negotiation!.aiId) : undefined;
    if (!this.negotiation || !player || !ai) return null;
    return buildNegotiationVm(player, ai, this.negotiation.draft, this.negotiation.incoming, this.negotiation.message,
      this.liveDiplomacyContext(), this.enemyDiplomacyService);
  }

  onNegotiationDraftChange(treaty: PeaceTreaty): void {
    if (!this.negotiation) return;
    this.negotiation = { ...this.negotiation, draft: treaty, message: null };
  }

  /* The player sends the draft; the AI accepts (executed at once), counters or refuses. */
  onSendPeaceProposal(treaty: PeaceTreaty): void {
    const player = this.getPlayerFaction();
    const ai = this.negotiation ? this.factions.find((f) => f.id === this.negotiation!.aiId) : undefined;
    if (!this.negotiation || !player || !ai) return;
    const world = this.liveDiplomacyContext();
    const response = this.enemyDiplomacyService.respondToProposal(ai, treaty, world);
    if (response.decision === 'accept') {
      this.concludeTreaty(treaty, ai);
      return;
    }
    if (response.decision === 'counter' && response.counter) {
      this.negotiation = {
        ...this.negotiation,
        draft: treaty,
        incoming: { kind: 'counter', treaty: response.counter, summary: summarizeTreaty(response.counter, player.id, world) },
        message: `${ai.name} refuses these terms but makes a counter-offer.`,
      };
      return;
    }
    this.negotiation = {
      ...this.negotiation,
      draft: treaty,
      message: response.evaluation.validation.ok
        ? `${ai.name} refuses: these terms are far from what it would accept.`
        : describeTreatyInvalid(response.evaluation.validation.reason),
    };
  }

  /*
   * Accepts the AI's terms on the table (its proposal or counter-offer).
   * The AI's agreement is re-checked against the current state, then the
   * treaty is executed atomically.
   */
  onAcceptIncomingTreaty(): void {
    const ai = this.negotiation ? this.factions.find((f) => f.id === this.negotiation!.aiId) : undefined;
    const incoming = this.negotiation?.incoming;
    if (!this.negotiation || !ai || !incoming) return;
    if (!this.enemyDiplomacyService.evaluateTreaty(ai, incoming.treaty, this.liveDiplomacyContext()).accept) {
      this.diplomacyService.removeOffer(ai.id);
      this.negotiation = { ...this.negotiation, incoming: null, message: `${ai.name} has withdrawn these terms: the situation changed.` };
      return;
    }
    this.concludeTreaty(incoming.treaty, ai);
  }

  /* Loads the AI's terms into the editable draft (to adjust and send back). */
  onEditIncomingTreaty(): void {
    const player = this.getPlayerFaction();
    if (!this.negotiation?.incoming || !player) return;
    const { treaty } = this.negotiation.incoming;
    this.negotiation = {
      ...this.negotiation,
      draft: { proposerId: player.id, recipientId: this.negotiation.aiId, items: treaty.items.map((item) => ({ ...item })) },
      message: null,
    };
  }

  private concludeTreaty(treaty: PeaceTreaty, ai: Faction): void {
    const execution = this.diplomacyService.executeTreaty({ ...this.liveDiplomacyContext(), production: this.production }, treaty);
    if (!execution.ok) {
      if (this.negotiation) this.negotiation = { ...this.negotiation, message: describeTreatyInvalid(execution.validation.reason) };
      return;
    }
    this.diplomacyMessage = `Peace signed with ${ai.name}. Truce: ${TRUCE_TURNS} turns.`;
    this.closeNegotiation();
    this.afterTreatyChange();
  }

  private describeDiplomacyFailure(target: Faction, reason: DiplomacyFailure | undefined, waitSeconds?: number): string {
    switch (reason) {
      case 'truce':
        return `The truce with ${target.name} holds for another ${Math.ceil((waitSeconds ?? 0) / DIPLOMACY_TURN_SECONDS)} turn(s). Only breaking the treaty can end it.`;
      case 'locked':
        return `The war with ${target.name} is too fresh: wait ${Math.ceil(waitSeconds ?? 0)} s.`;
      case 'already':
        return `Nothing to change: that is already the state with ${target.name}.`;
      case 'not_in_truce':
        return `There is no running truce with ${target.name}.`;
      default:
        return `No treaty is possible with ${target.name}.`;
    }
  }

  private liveDiplomacyContext(): { factions: Faction[]; fleets: Fleet[]; starSystems: StarSystem[] } {
    return { factions: this.factions, fleets: this.fleets, starSystems: this.starSystems };
  }

  /* Player treaty change: drop its events (the panel already reports it), re-check the outcome, save. */
  private afterTreatyChange(): void {
    this.diplomacyService.drainEvents();
    this.checkGameOutcome();
    this.saveGame();
    this.cdr.detectChanges();
  }

  /*
   * Turns treaty events and new AI peace proposals into one map notice.
   * Returns true when anything happened (diplomatic state is saved with
   * the factions, so the caller marks the save dirty).
   */
  private handleDiplomacyEvents(): boolean {
    const events = this.diplomacyService.drainEvents();
    for (const id of [...this.announcedOffers]) {
      if (!this.diplomacyService.hasOffer(id)) this.announcedOffers.delete(id);
    }
    const offers = this.diplomacyService.getOfferIds().filter((id) => !this.announcedOffers.has(id));
    if (events.length === 0 && offers.length === 0) return false;
    const name = (id: string) => (id === 'player' ? 'you' : this.factions.find((f) => f.id === id)?.name ?? id);
    const lines: string[] = [];
    for (const event of events) {
      const involvesPlayer = event.initiatorId === 'player' || event.targetId === 'player';
      switch (event.kind) {
        case 'war':
          lines.push(event.targetId === 'player'
            ? `${name(event.initiatorId)} declared war on you!`
            : `${name(event.initiatorId)} declared war on ${name(event.targetId)}.`);
          break;
        case 'breach':
          lines.push(`${name(event.initiatorId)} broke its treaty with ${name(event.targetId)}!`);
          break;
        case 'peace':
          lines.push(`${name(event.initiatorId)} and ${name(event.targetId)} signed peace.`);
          break;
        case 'honored':
          if (involvesPlayer) lines.push(`The truce between ${name(event.initiatorId)} and ${name(event.targetId)} was honored. Reputation improved.`);
          break;
      }
    }
    for (const id of offers) {
      this.announcedOffers.add(id);
      lines.push(`${name(id)} proposes peace. Open DIPLOMACY to answer.`);
    }
    if (lines.length > 0) this.showMapNotice(lines.join(' '));
    return true;
  }

  onTechnologyResearched(): void {
    this.cdr.detectChanges();
    this.saveGame();
  }

  getPlayerFaction(): Faction | undefined {
    return this.factions.find((f) => f.id === 'player');
  }

  isBuildingUnlocked = (buildingId: string): boolean => {
    const player = this.getPlayerFaction();
    if (!player) return false;
    return this.researchService.isBuildingUnlocked(player, buildingId);
  };

  onSpaceportConfirm(event: {
    fleetName: string;
    composition: { typeId: string; count: number }[];
    systemId: string;
    planetId: number;
  }): void {
    const result = this.fleetAssemblyService.createFleet(this, this.starSystems, {
      factionId: 'player',
      fleetName: event.fleetName,
      systemId: event.systemId,
      planetId: event.planetId,
      composition: event.composition,
    });
    if (!result.ok) {
      this.spaceportError = this.describeAssemblyError(result.reason);
      return;
    }
    if (result.fleet) {
      // Place the new fleet on its host planet's system cell and
      // transition into the system view. The view flip MUST happen
      // before `selectFleet` because `selectFleet` clears
      // `selectedSystem` whenever it is called from a non-system
      // view (`star-map.ts:971-973`). If the order is wrong,
      // `selectedSystem` is nulled and the system-view template
      // renders as a blank grid.
      const hostSystem = this.starSystems.find((s) => s.id === event.systemId);
      if (hostSystem) {
        this.selectSystem(hostSystem);
      }
      this.currentView = 'system';
      if (hostSystem) {
        this.initFleetsInSystem(hostSystem);
      }
      this.selectFleet(result.fleet);
    }
    this.spaceportError = null;
    this.showSpaceportPanel = false;
    this.saveGame();
  }

  disbandSelectedFleet(): void {
    if (!this.selectedFleet) {
      return;
    }
    this.fleetAssemblyService.disbandFleet(this, 'player', this.selectedFleet.id);
    this.deselectFleet();
    this.saveGame();
  }

  /* Planet the selected player fleet can colonize now (drives the fleet panel's COLONIZE button). */
  getSelectedFleetColonizeTarget(): PlanetTile | null {
    const fleet = this.commandableFleet();
    return fleet ? this.arrivalService.getColonizablePlanet(fleet, this.starSystems) : null;
  }

  /*
   * COLONIZE button: the only way the player colonizes. Arriving on an
   * uninhabited planet just parks the fleet (StarMapPlanetArrivalService).
   */
  onColonizeSelected(): void {
    const fleet = this.commandableFleet();
    const planet = this.getSelectedFleetColonizeTarget();
    if (!fleet || !planet) {
      return;
    }
    const result = this.arrivalService.colonize(fleet, planet, { production: this.production, factions: this.factions });
    if (!result) {
      return;
    }
    this.showMapNotice(`${fleet.name} colonized ${planet.name}.`);
    if (result.fleetRetired) {
      this.deselectFleet();
    }
    this.saveGame();
    this.cdr.detectChanges();
  }

  onDisbandSelected(): void {
    if (!this.selectedFleet) {
      return;
    }
    const ok = window.confirm(
      `Disband ${this.selectedFleet.name}? Surviving ships return to the global stock.`,
    );
    if (!ok) {
      return;
    }
    this.disbandSelectedFleet();
  }

  hasSpaceport(): boolean {
    return this.spaceportService.hasSpaceport('player', this.starSystems);
  }

  // Fleet organization (merge / split / redistribute)

  /* Number of player fleets (including this one) the fleet can be organized with. */
  getCoLocatedPlayerFleetCount(fleet: Fleet): number {
    if (fleet.factionId !== 'player' || fleet.destroyed) {
      return 0;
    }
    return this.fleetOrganizationService.getCoLocatedFleets(this.fleets, fleet).length;
  }

  /* True when the fleet stands in a system with one of the player's Spaceports (reserve reachable). */
  isFleetAtOwnSpaceport(fleet: Fleet): boolean {
    return fleet.factionId === 'player' && this.fleetOrganizationService.canUseReserve('player', fleet, this.starSystems);
  }

  /* A fleet can be organized if it is the player's and has a living ship to move. */
  canOrganizeFleet(fleet: Fleet): boolean {
    return fleet.factionId === 'player' && !fleet.destroyed && fleet.ships.some((s) => !s.destroyed);
  }

  openFleetManager(): void {
    const anchor = this.selectedFleet;
    if (!anchor || !this.canOrganizeFleet(anchor)) {
      return;
    }
    this.fleetManagerFleets = this.fleetOrganizationService.getCoLocatedFleets(this.fleets, anchor);
    this.fleetManagerReserve = this.isFleetAtOwnSpaceport(anchor)
      ? [...this.shipStockService.getStock(this, 'player')]
      : null;
    this.fleetManagerError = null;
    this.selectedFleetAction = null;
    this.contextMenu = null;
    this.fleetManagerResumeOnClose = !this.gameTimeService.isPaused;
    this.gameTimeService.pause();
    this.cdr.detectChanges();
  }

  closeFleetManager(): void {
    this.fleetManagerFleets = null;
    this.fleetManagerReserve = null;
    this.fleetManagerError = null;
    if (this.fleetManagerResumeOnClose) {
      this.gameTimeService.resume();
    }
    this.fleetManagerResumeOnClose = false;
    this.cdr.detectChanges();
  }

  onFleetManagerApply(plan: FleetOrganizationPlan): void {
    const result = this.fleetOrganizationService.applyPlan(this, this.starSystems, plan);
    if (!result.ok) {
      this.fleetManagerError = this.fleetOrganizationService.describeFailure(result.reason);
      this.cdr.detectChanges();
      return;
    }
    // Keep the selected fleet if it survived; otherwise follow its ships to
    // the first fleet of the new layout (the dialog lists the opener first).
    // No fleet left means everything went back to the reserve.
    const selected = this.selectedFleet;
    const next = selected && result.fleets.includes(selected) ? selected : result.fleets[0];
    if (next) {
      this.selectFleet(next);
    } else {
      this.deselectFleet();
    }
    // Ship ranges feed fleet sensor ranges, so moving scouts changes coverage.
    this.updateSensorVisibility(/*force=*/ true);
    this.saveGame();
    this.closeFleetManager();
  }

  /* Star system name at the dialog's cell, or the deep-space sector. */
  get fleetManagerLocationLabel(): string {
    const anchor = this.fleetManagerFleets?.[0];
    if (!anchor) {
      return '';
    }
    const cell = fleetCell(anchor);
    const system = this.starSystems.find(
      (s) => Math.floor(s.x) === cell.col && Math.floor(s.y) === cell.row,
    );
    return system ? `${system.name} system` : `Deep space ${cell.col}:${cell.row}`;
  }

  get fleetManagerReservedNames(): string[] {
    const inDialog = new Set(this.fleetManagerFleets?.map((f) => f.id) ?? []);
    return this.fleets
      .filter((f) => f.factionId === 'player' && !f.destroyed && !inDialog.has(f.id))
      .map((f) => f.name);
  }

  hasFactoryOnSelectedPlanet(): boolean {
    if (!this.selectedPlanetTile) {
      return false;
    }
    return this.productionService.getPlanetCapacity(this.selectedPlanetTile) > 0;
  }

  hasSpaceportOnSelectedPlanet(): boolean {
    if (!this.selectedPlanetTile) {
      return false;
    }
    return this.spaceportService.isSpaceportPlanet(this.selectedPlanetTile);
  }

  private describeAssemblyError(reason: string | undefined): string {
    return this.panelVmService.describeAssemblyError(reason);
  }

  private suggestFleetName(): string {
    return this.panelVmService.suggestFleetName(this.fleets);
  }

  /** Returns a faction's currencies as key-value pairs. */
  getFactionCurrencies(factionId: string): { name: string; value: number }[] {
    return getFactionCurrenciesUtil(this.factions, factionId);
  }

  // Bound versions for child component inputs to preserve `this` context
  readonly boundGetFactionColor = this.getFactionColor.bind(this);
  readonly boundGetFactionName = this.getFactionName.bind(this);
  readonly boundGetFactionCurrencies = this.getFactionCurrencies.bind(this);
  readonly boundGetPlayerEconomyBreakdown = this.getPlayerEconomyBreakdown.bind(this);
  readonly boundGetPlanetColor = this.getPlanetColor.bind(this);
  readonly boundGetPlayerCredits = this.getPlayerCredits.bind(this);
  readonly boundGetPlayerRawMaterials = (): number =>
    this.factions.find((f) => f.id === 'player')?.currencies['rawmaterials'] ?? 0;
  readonly boundIsEnemyInPreview = this.isEnemyInPreview.bind(this);
  readonly boundGetPlanetEconomy = this.getPlanetEconomy.bind(this);
  readonly boundGetEnergyForPlanet = this.getEnergyForPlanet.bind(this);
  readonly boundGetTaxForPlanet = this.getTaxForPlanet.bind(this);
  readonly boundGetPlayerShipStockEntries = this.getPlayerShipStockEntries.bind(this);
  readonly boundGetPlayerShipStockTotal = this.getPlayerShipStockTotal.bind(this);
  readonly boundGetProductionPanelVm = this.getProductionPanelVm.bind(this);
  readonly boundGetSpaceportPanelVm = this.getSpaceportPanelVm.bind(this);
  readonly boundHasFactory = this.hasFactoryOnSelectedPlanet.bind(this);
  readonly boundHasSpaceportOnSelectedPlanet = this.hasSpaceportOnSelectedPlanet.bind(this);
  // Event handlers forwarded to the galaxy/system grid child components
  readonly boundOnMapClick = this.onMapClick.bind(this);
  readonly boundOnPointerDown = this.onPointerDown.bind(this);
  readonly boundOnPointerMove = this.onPointerMove.bind(this);
  readonly boundOnPointerUp = this.onPointerUp.bind(this);
  readonly boundOnMapWheel = this.onMapWheel.bind(this);
  readonly boundOnSystemClick = this.onSystemClick.bind(this);
  readonly boundOnFleetClick = this.onFleetClick.bind(this);
  readonly boundOnSystemGridClick = this.onSystemGridClick.bind(this);
  readonly boundOnPlanetClick = this.onPlanetClick.bind(this);
  readonly boundOnSystemContextMenu = this.onSystemContextMenu.bind(this);
  readonly boundOnFleetContextMenu = this.onFleetContextMenu.bind(this);
  readonly boundOnPlanetContextMenu = this.onPlanetContextMenu.bind(this);
  readonly boundOnMapContextMenu = this.onMapContextMenu.bind(this);
  readonly boundOnSystemGridContextMenu = this.onSystemGridContextMenu.bind(this);
  readonly boundOnAsteroidContextMenu = this.onAsteroidContextMenu.bind(this);
  readonly boundGetPlanetClassNames = this.getPlanetClassNames.bind(this);

  // Ship type helpers

  /** Looks up a ship type definition by its ID. */
  getShipType(typeId: string): ShipType | undefined {
    return getShipTypeById(typeId);
  }

  /** Builds a summary of ship types and counts present in a fleet. */
  getFleetShipTypeSummary(fleet: Fleet): FleetShipTypeSummary[] {
    return getFleetShipTypeSummaryUtil(fleet);
  }

  /** Calculates the total attack value of all ships in a fleet. */
  getFleetTotalAttack(fleet: Fleet): number {
    return getFleetTotalAttackUtil(fleet);
  }

  /** Calculates the total defense value of all ships in a fleet. */
  getFleetTotalDefense(fleet: Fleet): number {
    return getFleetTotalDefenseUtil(fleet);
  }

  /** Computes energy production for a planet based on its power-producing buildings. */
  getEnergyForPlanet(planet: PlanetTile): number {
    return this.economyService.getPlanetEnergy(planet, this.factions.find((f) => f.id === planet.factionId));
  }

  /** Computes tax income for a planet based on population and industrial buildings. */
  getTaxForPlanet(planet: PlanetTile): number {
    return this.economyService.getPlanetTax(planet);
  }

  /** Returns the economy breakdown for a planet. */
  getPlanetEconomy(planet: PlanetTile): PlanetEconomyEntry {
    return this.economyService.getPlanetEconomyBreakdown(planet, this.factions, this.starSystems);
  }

  /** Returns the CSS class names to apply to a planet tile for styling. */
  getPlanetClassNames(planet: PlanetTile): string[] {
    return getPlanetClassNamesUtil(planet);
  }

  /** Maps a planet's string size to a numeric size (1-4) for grid calculations. */
  getPlanetNumericSize(planet: PlanetTile): number {
    return getPlanetNumericSizeUtil(planet);
  }

  /**
   * Returns the grid dimension (side length) for a planet's surface grid.
   * Size 1 -> 10, 2 -> 14, 3 -> 18, 4 -> 22 (see planet-surface.ts).
   */
  getPlanetGridSize(planet: PlanetTile): number {
    return getPlanetGridSizeUtil(planet);
  }

  /** Returns the representative color for a planet based on its type. */
  getPlanetColor(planet: PlanetTile): string {
    return getPlanetColorUtil(planet);
  }

  // Resource deposit generation helpers

  private generateResourceTilesForPlanet(planet: PlanetTile): ResourceDeposit[] {
    return generateResourceTilesUtil(planet, (p: PlanetTile) => this.getPlanetGridSize(p));
  }

  private selectPlanetsForResources(planets: PlanetTile[]): Set<number> {
    return selectPlanetsUtil(planets);
  }

  /*
   * Backfills surface terrain for planets without a usable record (e.g. a
   * save edited by hand). The v6 save migration normally does this; existing
   * buildings and deposits are always kept buildable.
   */
  ensurePlanetSurfaces(): void {
    const galaxySeed = this.galaxy?.seed ?? 0;
    for (const planet of this.starSystems.flatMap((s) => s.planetsTiles)) {
      if (needsSurface(planet)) {
        planet.surface = generatePlanetSurface(planet, galaxySeed);
      }
    }
  }

  /** Ensures every planet has a deterministic resourceTiles array. */
  ensureResourceTiles(): void {
    const allPlanets = this.starSystems.flatMap((s) => s.planetsTiles);
    const selectedIds = this.selectPlanetsForResources(allPlanets);
    for (const planet of allPlanets) {
      if (selectedIds.has(planet.id)) {
        if (!planet.resourceTiles || planet.resourceTiles.length === 0) {
          planet.resourceTiles = this.generateResourceTilesForPlanet(planet);
        }
      } else {
        planet.resourceTiles = [];
      }
    }
  }

  // Selection handlers

  /** Selects a fleet, updates the camera, and tracks its movement target. */
  selectFleet(fleet: Fleet): void {
    this.selectedFleet = fleet;
    this.fleetMoveError = null;

    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
    this.selectedPlanetTile = null;

    if (this.currentView === 'map') {
      this.centerCameraOnGridPosition(fleet.x, fleet.y);
    }

    if (this.currentView === 'system') {
      if (fleet.system?.targetX != null && fleet.system?.targetY != null) {
        this.targetX = fleet.system.targetX ?? null;
        this.targetY = fleet.system.targetY ?? null;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    } else {
      if (fleet.targetX !== null && fleet.targetY !== null) {
        this.targetX = fleet.targetX;
        this.targetY = fleet.targetY;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    }
    this.cdr.detectChanges();
  }

  /** Clears the current fleet selection and its movement target. */
  deselectFleet(): void {
    this.selectedFleet = null;
    this.fleetMoveError = null;
    this.selectedFleetAction = null;
    this.targetX = null;
    this.targetY = null;
    this.cdr.detectChanges();
  }

  /** Sets the active action mode for the selected fleet ('move'). */
  setFleetAction(action: 'move'): void {
    this.selectedFleetAction = action;
    this.cdr.detectChanges();
  }

  /** Clears the currently selected star system. */
  deselectSystem(): void {
    this.selectedSystem = null;
    this.cdr.detectChanges();
  }

  /* Colonization guidance for the planet panel; null unless the planet is explored and uninhabited. */
  getPlanetColonizationVm(planet: PlanetTile): PlanetColonizationVm | null {
    if (!this.selectedSystem || !planet.explored || planet.factionId !== 'unhabited') {
      return null;
    }
    const { carriers, parked, enRoute } = this.arrivalService.getColonizationCarriers(
      this.fleets,
      this.selectedSystem,
      planet,
    );
    if (parked) return { status: 'parked', fleetName: parked.name };
    if (enRoute) return { status: 'en_route', fleetName: enRoute.name };
    if (carriers[0]) return { status: 'in_system', fleetName: carriers[0].name };
    return { status: 'none', fleetName: null };
  }

  /** Clears the currently selected planet tile. */
  deselectPlanetTile(): void {
    this.selectedPlanetTile = null;
    this.cdr.detectChanges();
  }

  // Planet view helpers

  /** Enters the planet surface view, saving game state first. */
  openPlanetView(): void {
    if (!this.selectedPlanetTile || !this.selectedPlanetTile.explored) {
      return;
    }
    this.saveGame();
    this.currentView = 'planet';
  }

  /** Exits the planet surface view back to the system view. */
  leavePlanetView(): void {
    this.saveGame();
    this.currentView = 'system';
  }

  /** Selects a star system, or moves the selected fleet to it if in move mode. */
  selectSystem(system: StarSystem): void {
    if (this.selectedFleet && this.currentView === 'map' && this.selectedFleetAction === 'move') {
      this.moveSelectedFleet(system.x, system.y);
    }

    this.selectedSystem = system;
    this.selectedFleet = null;
    this.selectedFleetAction = null;
    this.selectedPlanetTile = null;
    this.cdr.detectChanges();
  }

  /**
   * Selects a planet tile, clearing any fleet selection.
   *
   * If the planet-info window is already open and the clicked planet differs
   * (by id), the window is closed first so the component is destroyed and
   * re-created fresh with the new data rather than just receiving new inputs.
   */
  selectPlanetTile(tile: PlanetTile): void {
    this.selectedFleet = null;

    if (this.selectedPlanetTile && this.selectedPlanetTile.id !== tile.id) {
      this.selectedPlanetTile = null;
      this.cdr.detectChanges();
    }

    this.selectedPlanetTile = tile;

    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
    this.cdr.detectChanges();
  }

  // Context menu

  /** Displays a context menu at the given screen coordinates with the provided items. */
  showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    this.contextMenu = { x, y, items };
  }

  /** Hides the currently open context menu. */
  closeContextMenu(): void {
    this.contextMenu = null;
    this.cdr.detectChanges();
  }

  /** Handles a context menu item selection, dispatching to the appropriate handler. */
  onContextMenuSelect(item: ContextMenuItem): void {
    this.closeContextMenu();

    switch (item.type) {
      case 'fleet':
        this.selectFleet(item.data as Fleet);
        break;
      case 'system':
        this.selectSystem(item.data as StarSystem);
        break;
      case 'planet':
        this.selectPlanetTile(item.data as PlanetTile);
        break;
    }
    this.cdr.detectChanges();
  }

  /*
   * Contextmenu handlers for the extracted galaxy/system grid child
   * components. Preserve the original inline binding behavior exactly:
   * deselect first, then suppress the native menu and stop propagation.
   */
  /*
   * Right-click orders. With a player fleet selected, a right-click issues
   * an order depending on what is under the cursor (no MOVE button needed;
   * the button still works):
   *   - empty space / star system / planet / friendly or neutral fleet: move there
   *     (moving onto an enemy planet is the planet attack, via arrival handling)
   *   - hostile fleet on the galaxy map: attack order (pursuit, see fleet-attack-orders.ts)
   *   - drifting asteroid: intercept order
   *   - the selected fleet itself: deselect
   * Without a commandable fleet the old behavior stays: right-click clears
   * the selection of the clicked object type. The native menu is always
   * suppressed.
   */
  private commandableFleet(): Fleet | null {
    const fleet = this.selectedFleet;
    return fleet && fleet.factionId === 'player' && !fleet.destroyed ? fleet : null;
  }

  /* Same rule as battle detection: the owners are at war (diplomacy.ts). */
  areFleetsHostile(a: Fleet, b: Fleet): boolean {
    const fa = this.factions.find((f) => f.id === a.factionId);
    const fb = this.factions.find((f) => f.id === b.factionId);
    return areFactionsHostile(fa, fb);
  }

  /* Suppresses the native menu; true when the click only closed the disambiguation menu. */
  private consumeRightClick(event: MouseEvent): boolean {
    event.preventDefault();
    event.stopPropagation();
    if (this.contextMenu) {
      this.closeContextMenu();
      return true;
    }
    return false;
  }

  onSystemContextMenu(system: StarSystem, event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    if (this.commandableFleet() && this.currentView === 'map') {
      this.selectedFleetAction = null;
      this.moveSelectedFleet(system.x, system.y);
      this.cdr.detectChanges();
      return;
    }
    this.deselectSystem();
  }

  onFleetContextMenu(target: Fleet, event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    const fleet = this.commandableFleet();
    if (!fleet || fleet.id === target.id) {
      this.deselectFleet();
      return;
    }
    this.selectedFleetAction = null;
    if (this.currentView === 'map') {
      if (this.areFleetsHostile(fleet, target)) {
        this.orderAttack(target);
      } else {
        this.moveSelectedFleet(target.x, target.y);
      }
    } else if (this.selectedSystem && fleet.system?.id === this.selectedSystem.id && target.system) {
      const tile = this.movementService.getSystemTileCenter(target.system.x, target.system.y);
      this.moveSelectedFleet(tile.x, tile.y);
    }
    this.cdr.detectChanges();
  }

  onPlanetContextMenu(planet: PlanetTile, event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    const fleet = this.commandableFleet();
    if (fleet && this.selectedSystem && fleet.system?.id === this.selectedSystem.id) {
      const center = this.movementService.getPlanetCellCenter(planet);
      this.selectedFleetAction = null;
      this.moveSelectedFleet(center.x, center.y);
      this.cdr.detectChanges();
      return;
    }
    this.deselectPlanetTile();
  }

  /* Right-click on empty galaxy space: move the selected fleet there. */
  onMapContextMenu(event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    // `dragMoved` describes the LAST left-button drag and stays true until the
    // next left press, so it must not gate right-clicks (that silently
    // dropped orders after every camera pan). Only an in-progress drag does.
    if (!this.commandableFleet() || this.isDragging) {
      return;
    }
    const tile = this.galaxyTileAt(event);
    this.selectedFleetAction = null;
    this.moveSelectedFleet(tile.x, tile.y);
    this.cdr.detectChanges();
  }

  /* Right-click on empty system-view space: move the selected fleet there. */
  onSystemGridContextMenu(event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    const fleet = this.commandableFleet();
    if (!fleet || !this.selectedSystem || fleet.system?.id !== this.selectedSystem.id) {
      return;
    }
    const tile = this.systemTileAt(event);
    this.selectedFleetAction = null;
    this.moveSelectedFleet(tile.x, tile.y);
    this.cdr.detectChanges();
  }

  /* Right-click on a drifting asteroid: intercept it with the selected fleet. */
  onAsteroidContextMenu(asteroidId: number, event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    const fleet = this.commandableFleet();
    if (!fleet) {
      return;
    }
    this.selectedFleetAction = null;
    this.selectAsteroid(asteroidId);
    this.onInterceptAsteroid(fleet.id);
  }

  /* Starts pursuing a hostile fleet; the order is validated like a move. */
  orderAttack(quarry: Fleet): void {
    const fleet = this.commandableFleet();
    if (!fleet || this.currentView !== 'map') {
      return;
    }
    if (this.moveSelectedFleet(quarry.x, quarry.y)) {
      fleet.attackFleetId = quarry.id;
      this.simStateDirty = true;
    }
  }

  /* Name of the fleet the selected fleet is attacking, for the fleet panel. */
  getSelectedFleetAttackLabel(): string | null {
    const id = this.selectedFleet?.attackFleetId;
    if (id == null) {
      return null;
    }
    return this.fleets.find((f) => f.id === id && !f.destroyed)?.name ?? null;
  }

  private readonly attackOrderHooks: AttackOrderHooks = {
    isVisible: (quarry) => this.isFleetVisible(quarry),
    isHostile: (attacker, quarry) => this.areFleetsHostile(attacker, quarry),
    retarget: (attacker, x, y) => {
      if (!this.movementService.planGalaxyRoute({ x: attacker.x, y: attacker.y }, { x, y }).ok) {
        return false;
      }
      attacker.interceptAsteroidId = null;
      attacker.targetX = x;
      attacker.targetY = y;
      if (this.selectedFleet?.id === attacker.id && this.currentView === 'map') {
        this.targetX = x;
        this.targetY = y;
      }
      return true;
    },
  };

  /* Re-aims pursuing fleets; tells the player when an attack order ends without a fight. */
  private updateAttackOrders(): boolean {
    const { ended, retargeted } = updateAttackOrders(this.fleets, this.attackOrderHooks);
    for (const end of ended) {
      const quarryName = end.quarry?.name ?? 'the target';
      if (end.reason === 'lost-contact') {
        this.showMapNotice(`${end.attacker.name} lost contact with ${quarryName}.`);
      } else if (end.reason === 'no-route') {
        this.showMapNotice(`${end.attacker.name}: no safe route to ${quarryName}. Attack cancelled.`);
      }
    }
    return retargeted || ended.length > 0;
  }

  // Click handlers

  /** Handles a click on a fleet icon, resolving overlapping objects via context menu if needed. */
  onFleetClick(fleet: Fleet, event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      event.stopPropagation();
      return;
    }

    if (this.selectedFleetAction === 'move') {
      return;
    }

    event.stopPropagation();

    if (this.currentView === 'map') {
      const cell = this.movementService.calculateGridCell(fleet.x, fleet.y);
      const items = this.movementService.getObjectsAtMapCell(
        this.fleets,
        this.starSystems,
        cell.col,
        cell.row,
      );
      this.handleObjectClick(items, event);
    } else if (this.selectedSystem) {
      const sysCell = this.movementService.calculateSystemGridCell(
        fleet.system?.x ?? 0,
        fleet.system?.y ?? 0,
      );
      const items = this.movementService.getObjectsAtSystemCell(
        this.fleets,
        this.selectedSystem,
        sysCell.col,
        sysCell.row,
      );
      this.handleObjectClick(items, event);
    } else {
      this.selectFleet(fleet);
    }
  }

  /** Handles a click on a star system, showing a context menu if objects overlap. */
  onSystemClick(system: StarSystem, event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      event.stopPropagation();
      return;
    }

    if (this.selectedFleetAction === 'move') {
      return;
    }

    event.stopPropagation();

    if (this.currentView === 'map') {
      const cell = this.movementService.calculateGridCell(system.x, system.y);
      const items = this.movementService.getObjectsAtMapCell(
        this.fleets,
        this.starSystems,
        cell.col,
        cell.row,
      );
      this.handleObjectClick(items, event);
    } else {
      this.selectSystem(system);
    }
  }

  /** Handles a click on a planet tile, showing a context menu if fleets are present. */
  onPlanetClick(planet: PlanetTile, event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      event.stopPropagation();
      return;
    }

    if (this.selectedFleetAction === 'move') {
      return;
    }

    event.stopPropagation();

    if (this.currentView === 'system' && this.selectedSystem) {
      const planetCell = this.movementService.getPlanetGridPosition(planet);
      const items = this.movementService.getObjectsAtSystemCell(
        this.fleets,
        this.selectedSystem,
        planetCell.col,
        planetCell.row,
      );

      if (items.length > 1) {
        this.showContextMenu(event.clientX, event.clientY, items);
        return;
      }

      if (items.length === 1) {
        this.onContextMenuSelect(items[0]);
        return;
      }
    }

    this.selectPlanetTile(planet);
  }

  /** Resolves a click by showing a context menu or selecting the single hit object. */
  private handleObjectClick(items: ContextMenuItem[], event: MouseEvent): void {
    if (items.length > 1) {
      this.showContextMenu(event.clientX, event.clientY, items);
      return;
    }

    if (items.length === 1) {
      this.onContextMenuSelect(items[0]);
    }
  }

  // Movement

  /** Validates whether the selected fleet can move to the given system grid coordinates. */
  private validateFleetMove(
    targetX: number,
    targetY: number,
  ): 'allowed' | 'blocked-team' | 'blocked-ours' {
    if (this.currentView !== 'system' || !this.selectedSystem || !this.selectedFleet) {
      return 'allowed';
    }

    const targetTile = this.movementService.getSystemTileCenter(targetX, targetY);
    const targetCell = this.movementService.calculateSystemGridCell(targetTile.x, targetTile.y);

    for (const planet of this.selectedSystem.planetsTiles) {
      const planetCell = this.movementService.getPlanetGridPosition(planet);
      if (planetCell.col !== targetCell.col || planetCell.row !== targetCell.row) {
        continue;
      }

      const planetFaction = this.factions.find((f) => f.id === planet.factionId);
      const playerFaction = this.factions.find((f) => f.id === 'player');
      if (!planetFaction || !playerFaction) {
        continue;
      }

      if (planet.factionId === 'unhabited') {
        return 'allowed';
      }

      // Permanent allies' planets are off limits; planets of a faction at
      // peace may be visited (arrival then does nothing, see arrival service).
      if (areFactionsAllied(planetFaction, playerFaction) && planet.factionId !== 'player') {
        return 'blocked-team';
      }

      if (planet.factionId === 'player') {
        const fleetOnPlanet = this.arrivalService.getFleetOnPlanet(
          this.fleets,
          this.selectedSystem,
          planet,
        );
        if (fleetOnPlanet) {
          return 'blocked-ours';
        }
        return 'allowed';
      }

      return 'allowed';
    }

    return 'allowed';
  }

  /*
   * Commands the selected fleet to move to the given world coordinates.
   * Returns true when the order was accepted. Any accepted manual order
   * replaces an attack order (orderAttack re-sets it afterwards).
   */
  moveSelectedFleet(x: number, y: number): boolean {
    if (!this.selectedFleet) {
      return false;
    }

    const validation = this.validateFleetMove(x, y);
    if (validation !== 'allowed') {
      this.fleetMoveError = this.panelVmService.describeFleetMoveRejection(validation);
      this.cdr.detectChanges();
      return false;
    }
    this.fleetMoveError = null;

    if (this.currentView === 'system') {
      if (this.selectedSystem && this.selectedFleet.system?.id === this.selectedSystem.id) {
        this.selectedFleet.attackFleetId = null;
        this.selectedFleet.system.targetX = x;
        this.selectedFleet.system.targetY = y;
        this.targetX = x;
        this.targetY = y;
        return true;
      }
      return false;
    } else {
      // Reject destinations that cannot be reached without crossing a black
      // hole or an asteroid belt before the order is accepted, so the fleet
      // never starts moving.
      const plan = this.movementService.planGalaxyRoute(
        { x: this.selectedFleet.x, y: this.selectedFleet.y },
        { x, y },
      );
      if (!plan.ok) {
        this.fleetMoveError = this.panelVmService.describeFleetMoveRejection(
          plan.reason === 'no_route'
            ? 'no-route'
            : plan.blockedBy === 'belt'
              ? 'blocked-belt'
              : 'blocked-black-hole',
        );
        this.cdr.detectChanges();
        return false;
      }
      // A manual order replaces any asteroid intercept or attack order.
      this.selectedFleet.interceptAsteroidId = null;
      this.selectedFleet.attackFleetId = null;
      this.selectedFleet.targetX = x;
      this.selectedFleet.targetY = y;
      this.targetX = x;
      this.targetY = y;
      return true;
    }
  }

  /** Handles a click on the galaxy map, moving the selected fleet if an action is active. */
  onMapClick(event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    if (!this.selectedFleet || !this.selectedFleetAction) {
      return;
    }

    const targetTile = this.galaxyTileAt(event);
    this.moveSelectedFleet(targetTile.x, targetTile.y);

    if (this.selectedFleet && this.selectedFleetAction) {
      this.selectedFleetAction = null;
    }
  }

  /** Handles a click inside a star system grid, moving the selected fleet if an action is active. */
  onSystemGridClick(event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    if (
      !this.selectedFleet ||
      !this.selectedSystem ||
      this.selectedFleet.system?.id !== this.selectedSystem.id ||
      !this.selectedFleetAction
    ) {
      return;
    }

    const targetTile = this.systemTileAt(event);
    this.moveSelectedFleet(targetTile.x, targetTile.y);
  }

  /* Galaxy grid tile under a mouse event on the map viewport (event.currentTarget). */
  private galaxyTileAt(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const viewportUnitInPixels = window.innerWidth / 100;
    const worldX = this.cameraX + (event.clientX - rect.left) / viewportUnitInPixels / this.zoom;
    const worldY = this.cameraY + (event.clientY - rect.top) / viewportUnitInPixels / this.zoom;
    return this.movementService.getTileCenter(worldX, worldY);
  }

  /* System-view tile center (vw) under a mouse event on the system grid (event.currentTarget). */
  private systemTileAt(event: MouseEvent): { x: number; y: number } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const viewportUnitInPixels = window.innerWidth / 100;
    return this.movementService.getSystemTileCenter(
      (event.clientX - rect.left) / viewportUnitInPixels,
      (event.clientY - rect.top) / viewportUnitInPixels,
    );
  }

  // Camera

  /** Viewport height in vw units, derived from the current window aspect ratio. */
  get viewportHeightVw(): number {
    return (window.innerHeight / window.innerWidth) * 100;
  }

  /** Width of the galaxy area visible on screen, in world (unscaled) vw. */
  get visibleWidthVw(): number {
    return 100 / this.zoom;
  }

  /** Height of the galaxy area visible on screen, in world (unscaled) vw. */
  get visibleHeightVw(): number {
    return this.viewportHeightVw / this.zoom;
  }

  /**
   * Centers the galaxy camera on a 1-indexed grid position (fleet/system
   * coordinates). Fleets and systems are drawn at ((x - 0.5) * cellSize,
   * (y - 0.5) * cellSize) world vw, so that point is placed at the middle of
   * the visible area. Horizontal and vertical halves must be computed
   * separately: the viewport is 100 vw wide but its height in vw depends on
   * the aspect ratio. Near the map edges clampCamera() wins, so the target
   * can end up off-center there by design.
   */
  centerCameraOnGridPosition(gridX: number, gridY: number): void {
    this.cameraX = (gridX - 0.5) * this.cellSizeVw - this.visibleWidthVw / 2;
    this.cameraY = (gridY - 0.5) * this.cellSizeVh - this.visibleHeightVw / 2;
    this.clampCamera();
  }

  /**
   * Mouse wheel on the galaxy map: steps one discrete zoom level per
   * gesture (see zoomStepCooldownMs) and keeps the world point under the
   * cursor fixed on screen.
   */
  onMapWheel(event: WheelEvent): void {
    // Always swallow the wheel so the page itself never scrolls/zooms.
    event.preventDefault();
    if (this.contextMenu || event.deltaY === 0) {
      return;
    }

    const now = performance.now();
    if (now - this.lastZoomStepAt < this.zoomStepCooldownMs) {
      return;
    }

    const direction = event.deltaY > 0 ? 1 : -1; // wheel down = zoom out
    const nextIndex = Math.max(
      0,
      Math.min(this.zoomLevels.length - 1, this.zoomIndex + direction),
    );
    if (nextIndex === this.zoomIndex) {
      return;
    }
    this.lastZoomStepAt = now;

    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    const viewportUnitInPixels = window.innerWidth / 100;
    const anchorScreenX = (event.clientX - rect.left) / viewportUnitInPixels;
    const anchorScreenY = (event.clientY - rect.top) / viewportUnitInPixels;

    this.setZoomIndex(nextIndex, anchorScreenX, anchorScreenY);

    // A wheel step during a drag would otherwise make the drag jump, because
    // the drag math converts pixel deltas with the zoom that is now stale.
    if (this.isDragging) {
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragCameraStartX = this.cameraX;
      this.dragCameraStartY = this.cameraY;
    }

    this.cdr.detectChanges();
  }

  /**
   * Changes the zoom level while keeping the world point at the given
   * screen anchor (in screen vw, relative to the viewport's top-left)
   * stationary. Defaults to the viewport center.
   */
  setZoomIndex(
    index: number,
    anchorScreenX = 50,
    anchorScreenY = this.viewportHeightVw / 2,
  ): void {
    const clamped = Math.max(0, Math.min(this.zoomLevels.length - 1, index));
    const oldZoom = this.zoom;
    const anchorWorldX = this.cameraX + anchorScreenX / oldZoom;
    const anchorWorldY = this.cameraY + anchorScreenY / oldZoom;

    this.zoomIndex = clamped;
    this.cameraX = anchorWorldX - anchorScreenX / this.zoom;
    this.cameraY = anchorWorldY - anchorScreenY / this.zoom;
    this.clampCamera();
  }

  /** Sets the camera to an absolute position and clamps it within bounds. */
  setCamera(pos: { x: number; y: number }): void {
    this.cameraX = pos.x;
    this.cameraY = pos.y;
    this.clampCamera();
  }

  /** Pans the camera in the specified direction and clamps it within bounds. */
  moveCamera(direction: 'up' | 'down' | 'left' | 'right'): void {
    // cameraSpeed is defined in screen vw; dividing by zoom keeps the
    // on-screen pan speed constant at every zoom level.
    const step = this.cameraSpeed / this.zoom;
    switch (direction) {
      case 'up':
        this.cameraY -= step;
        break;
      case 'down':
        this.cameraY += step;
        break;
      case 'left':
        this.cameraX -= step;
        break;
      case 'right':
        this.cameraX += step;
        break;
    }
    this.clampCamera();
  }

  /**
   * Constrains the camera position so it cannot scroll past the map edges.
   * The actual grid extent depends on the current cell size (which varies
   * between desktop ~2 vw and mobile ~7 vw), so we compute it dynamically
   * from gridColumns/gridRows × cellSize rather than using the fixed
   * mapWidth/mapHeight constants.
   *
   * The visible extent shrinks/grows with zoom. If the whole grid fits on
   * one axis (possible on small galaxies at the farthest zoom), the grid is
   * centered on that axis instead of being pinned to the top-left corner.
   */
  private clampCamera(): void {
    this.cameraX = this.clampCameraAxis(
      this.cameraX,
      this.movementService.gridColumns * this.cellSizeVw,
      this.visibleWidthVw,
    );
    this.cameraY = this.clampCameraAxis(
      this.cameraY,
      this.movementService.gridRows * this.cellSizeVh,
      this.visibleHeightVw,
    );
  }

  private clampCameraAxis(camera: number, gridSizeVw: number, visibleSizeVw: number): number {
    if (gridSizeVw <= visibleSizeVw) {
      return (gridSizeVw - visibleSizeVw) / 2;
    }
    return Math.max(0, Math.min(camera, gridSizeVw - visibleSizeVw));
  }

  /** Pointer down on the map viewport — begins drag tracking (empty areas only). */
  onPointerDown(event: PointerEvent): void {
    if (this.contextMenu) {
      return;
    }
    // The right button issues orders (onMapContextMenu); it never drags.
    if (event.button === 2) {
      return;
    }
    if (this.isInteractiveElement(event.target as HTMLElement)) {
      return;
    }

    const vp = event.currentTarget as HTMLElement;
    vp.setPointerCapture(event.pointerId);

    this.isDragging = true;
    this.dragMoved = false;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragCameraStartX = this.cameraX;
    this.dragCameraStartY = this.cameraY;

    vp.classList.add('dragging');
  }

  /** Returns true if the element is an interactive child (button, system, fleet, etc.). */
  private isInteractiveElement(element: HTMLElement): boolean {
    let el: HTMLElement | null = element;
    while (el && el !== document.body) {
      if (
        el.tagName === 'BUTTON' ||
        el.classList.contains('star-system') ||
        el.classList.contains('fleet')
      ) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  /** Pointer move during drag — updates camera position with clamping. */
  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;

    if (Math.abs(deltaX) + Math.abs(deltaY) > this.dragThreshold) {
      this.dragMoved = true;
    }

    const viewportUnitInPixels = window.innerWidth / 100;
    this.cameraX = this.dragCameraStartX - deltaX / viewportUnitInPixels / this.zoom;
    this.cameraY = this.dragCameraStartY - deltaY / viewportUnitInPixels / this.zoom;
    this.clampCamera();
    this.cdr.detectChanges();
  }

  /** Pointer up — ends drag, dispatches click if no movement occurred. */
  onPointerUp(event: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    const vp = event.currentTarget as HTMLElement;
    vp.releasePointerCapture(event.pointerId);
    vp.classList.remove('dragging');

    this.isDragging = false;

    if (!this.dragMoved) {
      this.onMapClick(event as unknown as MouseEvent);
    }
  }

  // Game loop

  /** Starts the game loop and registers focus-loss pause handlers after the view initializes. */
  ngAfterViewInit(): void {
    this.startGameLoop();
    this.setupFocusHandlers();
    window.addEventListener('orientationchange', this.onOrientationChange);
    this.checkOrientation();
  }

  /** Registers the game loop tick callback with the game loop service. */
  private startGameLoop(): void {
    this.gameLoopService.startGameLoop((deltaTime: number) => {
      this.gameLoopCallback(deltaTime);
    });
  }

  /**
   * Single consolidated tick callback received from the game loop service.
   * Receives the SCALED game delta time (0 when paused, realDelta * speed when running).
   * All simulation systems use this value directly — none check pause or
   * multiply speed themselves; that is centralized in GameTimeService.
   */
  private gameLoopCallback(gameDeltaTime: number): void {
    if (this.gameOutcome !== 'inProgress') {
      this.cdr.detectChanges();
      return;
    }
    this.diplomacyService.tick(gameDeltaTime, this.factions, { starSystems: this.starSystems, fleets: this.fleets });
    const attackOrdersChanged = gameDeltaTime > 0 && this.updateAttackOrders();
    const didMoveFleets = this.updateFleets(gameDeltaTime) || attackOrdersChanged;
    const headingsChanged = this.updateFleetHeadings(gameDeltaTime);
    const asteroidResult = this.asteroidService.tick(
      gameDeltaTime,
      this.fleets,
      this.factions,
      this.mapWidth,
      this.mapHeight,
    );
    const asteroidsChanged = this.updateAsteroidUi(asteroidResult, gameDeltaTime);
    const aiChanged = this.aiTickService.tick(gameDeltaTime, {
      fleets: this.fleets,
      factions: this.factions,
      starSystems: this.starSystems,
      shipStock: this.shipStock,
      production: this.production,
    });

    const diplomacyChanged = this.handleDiplomacyEvents();

    // AI assault on a defended player planet: the player defends it on the
    // battle screen (same transport as a player-initiated planet battle).
    const aiPlanetBattle = this.aiTickService.takePendingPlayerBattle();
    if (aiPlanetBattle) {
      this.battleService.setPlanetBattle(aiPlanetBattle);
      this.enterBattleScreen();
      return;
    }

    const visibilityChanged = this.updateSensorVisibility();

    const productionResult = this.productionService.tick(
      gameDeltaTime,
      this,
      this.starSystems,
      this.fleets,
      this.factions,
    );
    const productionChanged = productionResult.stateChanged;

    this.economyAccumulator += gameDeltaTime;
    let economyUpdated = false;
    // The economy (income, upkeep, arrears) is charged only here, once per
    // ~1 s tick of accumulated game time, so costs are frame-rate independent.
    if (this.economyAccumulator >= this.economyTickInterval) {
      let playerUnpaidUpkeep = 0;
      for (const faction of this.factions) {
        const applied = this.economyService.applyEconomyDelta(
          faction.id,
          this.factions,
          this.starSystems,
          this.fleets,
          this.economyAccumulator,
          this.production,
          this.shipStock,
        );
        if (faction.id === 'player') playerUnpaidUpkeep = applied.unpaidUpkeepPerSecond;
      }
      // Post-tick rates for the HUD; arrears are a property of the tick just applied.
      this.cachedPlayerEconomyBreakdown = {
        ...this.economyService.calculateEconomy('player', this.factions, this.starSystems, this.fleets, this.shipStock),
        unpaidUpkeepPerSecond: playerUnpaidUpkeep,
      };
      this.economyAccumulator = 0;
      economyUpdated = true;
    }

    // Ownership changed during this frame (AI capture, colonization,
    // rebellion), an AI-vs-AI battle destroyed fleets, or a treaty changed
    // (peace partners do not block victory): the outcome may have become
    // terminal.
    if (this.planetOwnership.revision !== this.lastOwnershipRevision || this.autoBattleResolved || diplomacyChanged) {
      this.lastOwnershipRevision = this.planetOwnership.revision;
      this.autoBattleResolved = false;
      this.checkGameOutcome();
      if (this.gameOutcome !== 'inProgress') {
        return;
      }
    }

    const debugRefreshed = this.refreshAiDebug();
    if ((debugRefreshed || headingsChanged) && !(didMoveFleets || aiChanged || economyUpdated || visibilityChanged || productionChanged)) {
      // Presentation-only refresh (AI debug panel, ship turning): redraw, but do
      // not mark the save dirty.
      this.ngZone.run(() => this.cdr.detectChanges());
    }

    if (didMoveFleets || aiChanged || economyUpdated || visibilityChanged || productionChanged || asteroidsChanged || diplomacyChanged) {
      this.ngZone.run(() => this.cdr.detectChanges());
      this.simStateDirty = true;
    }

    // Persist simulation mutations together with a bounded write cadence
    // instead of writing on every frame.
    this.autosaveAccumulator += gameDeltaTime;
    if (this.simStateDirty && this.autosaveAccumulator >= this.autosaveIntervalSeconds) {
      this.saveGame();
      this.autosaveAccumulator = 0;
      this.simStateDirty = false;
    }
  }

  /*
   * Applies one asteroid tick to the UI state. A collection grants
   * currencies, so it is persisted to the autosave immediately (like
   * planet arrivals): a battle-return reload must never bring a collected
   * asteroid back.
   */
  private updateAsteroidUi(result: AsteroidTickResult, gameDeltaTime: number): boolean {
    let changed = result.changed;
    if (result.collected.length > 0 || result.failedIntercepts.length > 0) {
      this.handleAsteroidEvents(result);
      changed = true;
    }
    if (result.collected.length > 0) {
      this.saveGame();
    }
    if (this.mapNotice) {
      this.mapNoticeClock += gameDeltaTime;
      if (this.mapNoticeClock >= StarMap.MAP_NOTICE_SECONDS) {
        this.mapNotice = null;
        changed = true;
      }
    }
    if (this.selectedAsteroidId != null) {
      this.asteroidPanelClock += gameDeltaTime;
      if (this.asteroidPanelClock >= 0.5 || !this.asteroidService.getAsteroid(this.selectedAsteroidId)) {
        this.asteroidPanelClock = 0;
        this.refreshAsteroidPanel();
        changed = true;
      }
    }
    return changed;
  }

  private describeRouteFailure(fleet: Fleet, reason: RouteFailure): string {
    return reason === 'target_blocked'
      ? `${fleet.name}: destination lies inside a black hole or an asteroid belt. Order cancelled.`
      : `${fleet.name}: no safe route around the black hole and asteroid belts. Order cancelled.`;
  }

  /** Advances fleet movement and checks for new battles each frame. */
  private updateFleets(deltaTime: number): boolean {
    const didMoveFleets = this.movementService.updateFleets(
      this.fleets,
      this.starSystems,
      this.selectedFleet?.id ?? null,
      this.currentView,
      deltaTime,
      (fleetId: number) => {
        if (this.selectedFleet?.id === fleetId) {
          this.targetX = null;
          this.targetY = null;
        }
      },
      (fleetId: number) => {
        const fleet = this.fleets.find((f) => f.id === fleetId);
        if (fleet) {
          fleet.system = null;
        }
      },
      (fleetId: number, reason: RouteFailure) => {
        // An accepted order became unreachable (e.g. a loaded legacy order
        // or a moving intercept point): the fleet stays put; tell the player.
        const fleet = this.fleets.find((f) => f.id === fleetId);
        if (fleet?.factionId !== 'player') {
          return;
        }
        if (this.selectedFleet?.id === fleetId) {
          this.targetX = null;
          this.targetY = null;
          this.fleetMoveError = this.describeRouteFailure(fleet, reason);
        } else {
          this.showMapNotice(this.describeRouteFailure(fleet, reason));
        }
      },
    );

    this.updateExploredPlanets();
    this.arrivalService.checkFleetPlanetArrivals({
      fleets: this.fleets,
      currentView: this.currentView,
      selectedSystem: this.selectedSystem,
      factions: this.factions,
      production: this.production,
      saveGame: () => this.saveGame(),
      enterBattleScreen: () => this.enterBattleScreen(),
    });

    this.battleDetectionService.checkForBattles(
      this.fleets,
      this.factions,
      (x, y) => this.movementService.calculateGridCell(x, y),
      (fleet, system) => this.movementService.isFleetInSystem(fleet, system),
      this.starSystems,
      this.enterBattleScreen.bind(this),
      this.arrivalService.triggeredBattles,
      () => {
        this.autoBattleResolved = true;
      },
    );

    return didMoveFleets;
  }

  /**
   * Computes the initial explored state after loading a save or starting a new game.
   * Marks star systems as explored when within sensor range of player fleets
   * or player-owned systems.
   */
  private computeInitialSensorVisibility(): void {
    // Recompute sensor cells to update exploredGridCells
    this.updateSensorVisibility(/*force=*/ true);
  }

  /**
   * Recomputes the current sensor range cells and updates explored state.
   * Called every frame from the game loop. Returns true if visibility changed
   * (so change detection can run).
   */
  private updateSensorVisibility(force = false): boolean {
    if (this.currentView === 'planet') {
      return false;
    }

    const oldCellCount = this.sensorRangeCells.size;
    const oldPreviewCount = this.sensorPreviewCells.size;
    const oldExploredCount = this.exploredGridCells.size;

    // Recompute current sensor range cells for highlighting
    const layer = this.sensorService.computeGalaxySensorCells(
      this.fleets,
      this.starSystems,
      this.factions,
      this.movementService.gridColumns,
      this.movementService.gridRows,
    );
    this.sensorRangeCells = layer.cells;
    this.sensorPreviewCells = layer.preview;

    // Expand explored cells (preview layer is never added to explored)
    this.sensorService.updateExploredCells(this.exploredGridCells, this.sensorRangeCells);

    // Mark star systems as explored when within sensor range
    let systemsChanged = false;
    for (const system of this.starSystems) {
      if (system.explored) {
        continue;
      }
      if (this.sensorService.isSystemExplored(system, this.sensorRangeCells)) {
        system.explored = true;
        systemsChanged = true;
      }
    }

    const changed =
      force ||
      this.sensorRangeCells.size !== oldCellCount ||
      this.sensorPreviewCells.size !== oldPreviewCount ||
      this.exploredGridCells.size !== oldExploredCount ||
      systemsChanged;

    this.visibilityDirty = changed;
    return changed;
  }

  /** Updates planet exploration in system view based on fleet sensor range. */
  private updateExploredPlanets(): void {
    if (this.currentView !== 'system' || !this.selectedSystem) {
      return;
    }

    for (const fleet of this.fleets) {
      if (fleet.destroyed || fleet.factionId !== 'player') {
        continue;
      }

      if (fleet.system?.id !== this.selectedSystem.id) {
        continue;
      }

      if (fleet.system?.targetX != null || fleet.system?.targetY != null) {
        continue;
      }

      const range = this.sensorService.getFleetSensorRange(fleet);

      for (const planet of this.selectedSystem.planetsTiles) {
        if (planet.explored) {
          continue;
        }

        const planetCell = this.movementService.getPlanetGridPosition(planet);
        const inFull = this.sensorService.isPlanetInRange(
          planetCell.col,
          planetCell.row,
          fleet.system.x,
          fleet.system.y,
          range,
        );
        const inPreview = this.sensorService.isPlanetInPreviewRange(
          planetCell.col,
          planetCell.row,
          fleet.system.x,
          fleet.system.y,
          range,
        );
        if (inFull || inPreview) {
          planet.explored = true;
        }
      }
    }
  }

  /** Registers window blur and visibility-change listeners to auto-pause the game. */
  private setupFocusHandlers(): void {
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Detects whether the device is currently in landscape orientation. */
  private checkOrientation(): void {
    if (typeof screen !== 'undefined' && screen.orientation && screen.orientation.type) {
      this.isLandscape = screen.orientation.type.includes('landscape');
    } else {
      this.isLandscape = window.innerWidth > window.innerHeight;
    }
    this.cdr.detectChanges();
  }

  private onOrientationChange = (): void => {
    this.checkOrientation();
  };

  @HostListener('window:resize')
  onResize(): void {
    const oldCellSizeVw = this.cellSizeVw;
    const oldCellSizeVh = this.cellSizeVh;

    const isWide = window.innerWidth >= this.gridBreakpointPx;
    this.cellSizeVw = isWide ? 2 : 3.5;
    this.cellSizeVh = isWide ? 2 : 3.5;
    this.movementService.initialize(
      this.cellSizeVw,
      this.cellSizeVh,
      this.mapWidth,
      this.mapHeight,
    );
    this.movementService.refreshGridPositions(this.fleets, this.starSystems);

    // Scale camera proportionally so the same grid area stays in view
    if (oldCellSizeVw > 0) {
      this.cameraX *= this.cellSizeVw / oldCellSizeVw;
      this.cameraY *= this.cellSizeVh / oldCellSizeVh;
    }

    this.clampCamera();
    this.checkOrientation();
  }

  /** Resumes the game loop via GameTimeService. Kept as a thin wrapper for backward compat with StarMapPauseComponent's resumeGame output. */
  resumeGame(): void {
    this.gameTimeService.resume();
  }

  /** Header time control: set simulation speed (1x or 2x) and un-pause. */
  onSetSpeed(speed: GameSpeed): void {
    this.gameTimeService.setSpeed(speed);
  }

  /** Header time control: toggle pause/resume state. */
  onTogglePause(): void {
    this.gameTimeService.togglePause();
  }

  // Save/Load

  /** Builds the current StarMapData snapshot without writing to any slot. */
  private serializeGameState(): StarMapData {
    return {
      saveVersion: SAVE_VERSION,
      galaxy: this.galaxy,
      factions: this.factions,
      specialObjects: this.specialObjects,
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        cellSizeVw: this.cellSizeVw,
        cellSizeVh: this.cellSizeVh,
      },
      starSystems: this.starSystems,
      fleets: this.fleets,
      currentView: this.currentView,
      cameraX: this.cameraX,
      cameraY: this.cameraY,
      selectedSystemId: this.selectedSystem?.id ?? null,
      selectedFleetId: this.selectedFleet?.id ?? null,
      selectedPlanetTileId: this.selectedPlanetTile?.id ?? null,
      selectedFleetAction: this.selectedFleetAction,
      targetX: this.targetX,
      targetY: this.targetY,
      destroyedFleetId: this.battleService.getDestroyedFleetId(),
      exploredGridCells: Array.from(this.exploredGridCells),
      shipStock: this.shipStock,
      production: this.production,
      defaultView: this.defaultView,
      gameOutcome: this.gameOutcome,
      nebulae: this.nebulae,
      asteroidBelts: this.asteroidBelts,
      asteroidEvents: this.asteroidService.serialize(),
    };
  }

  /** Serializes the current game state into the autosave slot. */
  private saveGame(): void {
    const data = this.serializeGameState();
    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
  }

  /**
   * Writes the autosave and then navigates to the battle screen.
   *
   * Centralizes the "navigate to /battle" operation so that every
   * path that enters the battle screen is guaranteed to persist a
   * pre-battle snapshot first. Without this helper, future
   * contributors could add a new battle trigger that forgets to
   * save, which would re-introduce the post-battle "reset" bug.
   */
  private enterBattleScreen(): void {
    this.saveGame();
    this.aiTickService.suspendForBattle();
    this.ngZone.run(() => this.router.navigate(['/battle']));
  }

  /** Restores game state from the active save slot and refreshes selection and grid data. */
  /*
   * resumeAi: true only for the reload after the battle screen; the AI
   * keeps its memory (see StarMapAiTickService.suspendForBattle). Every
   * other load (new game, main-menu or pause-menu load) resets the AI.
   */
  loadGame(options: { resumeAi?: boolean } = {}): void {
    if (this.saveGameService.currentSlot === null) {
      return;
    }

    this.arrivalService.reset();

    const data = this.saveGameService.loadFromSlot(this.saveGameService.currentSlot);
    if (!data || !data.fleets || !data.starSystems || !data.factions) {
      this.loadError = 'save_unreadable';
      return;
    }

    this.gameOutcome = data.gameOutcome ?? 'inProgress';
    if (this.gameOutcome !== 'inProgress') {
      this.gameTimeService.pause();
    }

    // Reject structurally invalid saves before replacing live state. This
    // mirrors the gate used by activateSlot so manual loads and runtime
    // autosaves agree on what is loadable.
    const validation = validateSaveData(data);
    if (!validation.ok) {
      this.loadError = validation.errors[0]?.message ?? 'save_invalid';
      console.warn('[save/load] rejecting invalid save:', validation.errors);
      return;
    }
    this.loadError = '';

    this.factions = data.factions;
    this.starSystems = data.starSystems;
    this.fleets = data.fleets ?? [];
    this.galaxy = data.galaxy;
    this.specialObjects = data.specialObjects ?? [];
    // Map size is per save. Re-initialize the movement grid before any
    // coordinate math below runs against the new dimensions.
    if (data.map && data.map.width > 0 && data.map.height > 0) {
      this.mapWidth = data.map.width;
      this.mapHeight = data.map.height;
    }
    this.movementService.initialize(this.cellSizeVw, this.cellSizeVh, this.mapWidth, this.mapHeight);
    // Terrain must be configured before any movement or sensor update runs
    // against the new galaxy. Nebulae come from the save (migration
    // backfilled old saves); they are never regenerated here.
    this.nebulae = data.nebulae ?? [];
    this.asteroidBelts = data.asteroidBelts ?? [];
    this.terrainService.configure({
      specialObjects: this.specialObjects,
      nebulae: this.nebulae,
      asteroidBelts: this.asteroidBelts,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    this.rebuildTerrainViews();
    this.asteroidService.restore(data.asteroidEvents, this.galaxy?.seed ?? 0, this.fleets);
    this.selectedAsteroidId = null;
    this.asteroidPanelVm = null;
    this.asteroidPanelMessage = null;
    this.mapNotice = null;
    this.shipStock = data.shipStock ?? [];
    this.production = data.production ?? [];
    this.productionService.rebaseFromSave(this.production);

    // Backward compatibility: old saves have no exploredGridCells or
    // StarSystem.explored. Default: all systems explored so old saves
    // don't regress into a fully-fogged map.
    const hasSensorData = data.exploredGridCells !== undefined;
    if (hasSensorData) {
      this.exploredGridCells = new Set(data.exploredGridCells ?? []);
    } else {
      // Mark all systems explored + every cell in viewport as explored
      this.exploredGridCells = new Set();
      for (const system of this.starSystems) {
        system.explored = true;
      }
    }

    // Old saves may not carry the per-system explored flag. Treat the
    // absence as explored (matches the no-fog-regression fallback above).
    for (const system of this.starSystems) {
      if (system.explored === undefined) {
        system.explored = true;
      }
    }

    // Ensure every fleet has a sensorRange floor (defaults to 3).
    // sensorRange is the minimum floor; the effective range is computed
    // dynamically from ship types via StarMapSensorService.getFleetSensorRange.
    for (const fleet of this.fleets) {
      if (!fleet.destroyed && fleet.sensorRange == null) {
        fleet.sensorRange = 3;
      }
    }

    // Legacy grid migration is performed by SaveGameService.migrateSave
    // (versioned and idempotent). Here we only renormalize values that
    // depend on the current building set.
    this.planetBattleService.reconcilePlanetShields(this.starSystems);

    if (data.destroyedFleetId != null) {
      const fleet = this.fleets.find((f) => f.id === data.destroyedFleetId);
      if (fleet) {
        fleet.destroyed = true;
      }
    }

    this.movementService.initializeCoordinates(this.fleets, this.starSystems);

    // View state: saved runtime state takes precedence over defaultView config.
    // defaultView is only applied when there is no saved view state (i.e., new game).
    if (data.currentView) {
      this.currentView = data.currentView;
      this.cameraX = data.cameraX ?? 0;
      this.cameraY = data.cameraY ?? 0;
      this.targetX = data.targetX ?? null;
      this.targetY = data.targetY ?? null;
      this.selectedFleetAction = data.selectedFleetAction ?? null;
    } else if (data.defaultView) {
      this.applyDefaultView(data.defaultView);
    } else {
      this.currentView = 'map';
      this.cameraX = 0;
      this.cameraY = 0;
      this.targetX = null;
      this.targetY = null;
      this.selectedFleetAction = null;
    }

    this.defaultView = data.defaultView;

    // Selection state: only restore when the save data explicitly contains the IDs.
    // For new games, applyDefaultView() already set the correct selection;
    // we must not overwrite it with null just because the default data lacks
    // selected*Id fields (those only exist in saved games).
    if (data.selectedSystemId != null) {
      this.selectedSystem = this.starSystems.find((s) => s.id === data.selectedSystemId) ?? null;
    }
    if (data.selectedFleetId != null) {
      this.selectedFleet = this.fleets.find((f) => f.id === data.selectedFleetId) ?? null;
    }
    if (data.selectedPlanetTileId != null) {
      this.selectedPlanetTile =
        this.selectedSystem?.planetsTiles?.find((p) => p.id === data.selectedPlanetTileId) ?? null;
    }

    this.movementService.refreshGridPositions(this.fleets, this.starSystems);

    // Compute initial sensor visibility after loading
    this.computeInitialSensorVisibility();
    this.updateSensorVisibility();

    // Terrain first: deposit generation avoids blocked surface cells.
    this.ensurePlanetSurfaces();
    // Ensure every planet has deterministic resource deposit tiles
    this.ensureResourceTiles();

    // Reset game time state (speed=1, not paused) on every load
    this.gameTimeService.reset();

    if (options.resumeAi) {
      this.aiTickService.resumeAfterBattle();
    } else {
      this.aiTickService.resetAiPipeline();
    }

    this.clampCamera();
  }

  /** Removes a fleet from the game state and clears it from the selection if needed. */
  removeFleet(fleetId: number): void {
    this.fleets = this.fleets.filter((f) => f.id !== fleetId);
    if (this.selectedFleet?.id === fleetId) {
      this.selectedFleet = null;
      this.selectedFleetAction = null;
      this.targetX = null;
      this.targetY = null;
    }
  }

  /*
   * ngOnInit: Initializes the map view and restores game state.
   *
   * Direct /star-map navigation bypasses MainMenu, so currentSlot may be null
   * even when a save exists. In that case, auto-load the most recent save.
   * If no save exists at all, redirect to the main menu instead of starting
   * an unsaveable default game.
   *
   * Any non-autosave slot is normalized through activateSlot() so the active
   * session is backed by the autosave slot; otherwise a stale manual
   * snapshot could resurrect fleets destroyed in earlier battles.
   */
  ngOnInit(): void {
    this.onResize();
    // Taken before any early return so a stale flag can never leak into a
    // later, unrelated session start.
    const resumeAi = this.aiTickService.takeBattleSuspension();

    if (this.saveGameService.currentSlot === null) {
      const slotIndex = this.saveGameService.getMostRecentSlotIndex();
      if (slotIndex !== null) {
        this.saveGameService.currentSlot = slotIndex;
      } else {
        this.router.navigate(['']);
        return;
      }
    }

    if (this.saveGameService.currentSlot !== SaveSlotId.AUTOSAVE) {
      if (!this.saveGameService.activateSlot(this.saveGameService.currentSlot)) {
        this.router.navigate(['']);
        return;
      }
    }

    this.loadGame({ resumeAi });
    this.removeDestroyedFleetFromService();
    this.checkGameOutcome();

    this.sensorRangeEnabled = this.gameSettingsService.fogOfWarEnabled;

    // Subscribe to game time state changes (pause/resume/speed)
    // so the header overlays update reactively on auto-pause (blur/visibility)
    // and keyboard shortcuts.
    this.timeControlSubscription = this.gameTimeService.state$.subscribe(() => {
      this.cdr.detectChanges();
    });

    // Subscribe to game settings changes so fog-of-war toggles from the
    // options menu are applied immediately while the star map is active.
    this.settingsSubscription = this.gameSettingsService.state$.subscribe((settings) => {
      if (this.sensorRangeEnabled !== settings.fogOfWarEnabled) {
        this.sensorRangeEnabled = settings.fogOfWarEnabled;
        this.cdr.detectChanges();
      }
    });
  }

  /*
   * reloadAfterBattle: Reloads the game state from the active save slot
   * after the player returns from the battle screen. The active session is
   * always backed by the AUTOSAVE slot (slot 0): session start (new game,
   * manual load, pause-menu load, direct /star-map navigation) normalizes
   * currentSlot to autosave, and every runtime save plus battle result
   * writes to the same slot. This method therefore reads the same snapshot
   * that carries cumulative fleet destructions and planet ownership changes.
   */
    private reloadAfterBattle(): void {
      if (this.saveGameService.currentSlot === null) return;
      this.arrivalService.triggeredBattles.clear();
      this.loadGame({ resumeAi: this.aiTickService.takeBattleSuspension() });
      this.removeDestroyedFleetFromService();
      this.checkGameOutcome();
      this.cdr.detectChanges();
    }

  /**
   * Applies a previously destroyed fleet from the battle service into the
   * current save. The active session is backed by the AUTOSAVE slot, so the
   * destroyed flag persists across sibling-route reloads even though the
   * StarMap component instance is recreated on every /star-map navigation.
   *
   * Also applies the survivor rosters carried by the battle result: both
   * real fleets get their per-ship final HP / destroyed flags written
   * back, so a damaged winner returns damaged and a fleet can lose ships
   * without being wiped out.
   */
  private removeDestroyedFleetFromService(): void {
    const destroyedFleetId = this.battleService.getDestroyedFleetId();
    const battleResult = this.battleService.getBattleResult();
    if (destroyedFleetId == null && battleResult == null) {
      return;
    }

    if (battleResult) {
      this.applyBattleResult(battleResult);
    }

    if (destroyedFleetId != null) {
      const fleet = this.fleets.find((f) => f.id === destroyedFleetId);
      if (fleet) {
        fleet.destroyed = true;
      }
      if (this.selectedFleet?.id === destroyedFleetId) {
        this.selectedFleet = null;
        this.selectedFleetAction = null;
        this.targetX = null;
        this.targetY = null;
      }
    }

    this.battleService.clearBattle();
    this.saveGame();
    this.checkGameOutcome();
  }

  /*
   * Applies a battle outcome's per-fleet rosters onto the live fleets.
   * Virtual planet-defense fleets (negative ids) never persist.
   * Surviving fleets are snapped to their current grid cell and have
   * movement targets cleared to prevent immediate re-triggering of
   * the same encounter. Destroyed fleets are marked destroyed and
   * left in place (they are filtered from rendering and movement).
   */
  private checkGameOutcome(): void {
    if (this.gameOutcome !== 'inProgress') return;
    const data = this.serializeGameState();
    const outcome = this.gameOutcomeService.evaluate(data);
    if (outcome !== 'inProgress') {
      this.gameOutcome = outcome;
      data.gameOutcome = outcome;
      this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
      this.gameTimeService.pause();
      this.cdr.detectChanges();
    }
  }
  private applyBattleResult(result: BattleOutcome): void {
    for (const fleetOutcome of [result.attacker, result.defender]) {
      if (fleetOutcome.fleetId < 0) {
        continue;
      }
      const fleet = this.fleets.find((f) => f.id === fleetOutcome.fleetId);
      if (!fleet) {
        continue;
      }
      fleet.ships = fleetOutcome.ships.map((s) => ({
        id: s.shipId,
        name: s.name,
        type: s.typeId,
        currentHp: s.hp,
        destroyed: s.destroyed,
      }));
      if (fleetOutcome.wipedOut) {
        fleet.destroyed = true;
      } else {
        // Winner stays at the battle location, snapped to the nearest
        // grid cell. Movement targets are cleared so the fleet does not
        // immediately re-enter the same encounter.
        fleet.x = Math.floor(fleet.x);
        fleet.y = Math.floor(fleet.y);
        fleet.targetX = null;
        fleet.targetY = null;
      }
    }
    this.checkGameOutcome();
  }

  // Keyboard

  /** Listens for arrow keys to pan the camera around the map, and time-control shortcuts. */
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    // Skip when typing in an input/textarea to avoid conflicts
    const target = event.target as HTMLElement | null;
    const isInput =
      target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
    if (isInput) return;
    // The fleet manager is modal: it handles Escape itself, and map shortcuts
    // (including un-pausing with Space) must not act behind it.
    if (this.fleetManagerFleets) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        this.moveCamera('up');
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveCamera('down');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveCamera('left');
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.moveCamera('right');
        break;
      case ' ':
        event.preventDefault();
        this.gameTimeService.togglePause();
        break;
      case '1':
        event.preventDefault();
        this.gameTimeService.setSpeed(1);
        break;
      case '2':
        event.preventDefault();
        this.gameTimeService.setSpeed(2);
        break;
      case 'Escape':
        event.preventDefault();
        this.openPauseMenu();
        break;
      case 'F9':
        event.preventDefault();
        this.toggleAiDebug();
        break;
    }
  }

  toggleAiDebug(): void {
    this.aiDebugVisible = !this.aiDebugVisible;
    this.aiDebugRefreshedAt = 0;
    this.refreshAiDebug();
    this.cdr.detectChanges();
  }

  toggleAiDebugConsole(): void {
    this.aiDebugService.consoleEnabled = !this.aiDebugService.consoleEnabled;
  }

  /* Rebuilds the debug snapshots at most once per real second; returns true when refreshed. */
  private refreshAiDebug(): boolean {
    if (!this.aiDebugVisible) {
      return false;
    }
    const now = performance.now();
    if (now - this.aiDebugRefreshedAt < 1000) {
      return false;
    }
    this.aiDebugRefreshedAt = now;
    this.aiDebugSnapshots = this.aiDebugService.snapshots({
      factions: this.factions,
      starSystems: this.starSystems,
      fleets: this.fleets,
      shipStock: this.shipStock,
    });
    return true;
  }

  // Cleanup

  /** Saves the game, removes event listeners, and stops the game loop when the component is destroyed. */
  ngOnDestroy(): void {
    this.saveGame();

    this.routerSubscription.unsubscribe();
    this.timeControlSubscription?.unsubscribe();
    this.settingsSubscription?.unsubscribe();

    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('orientationchange', this.onOrientationChange);

    this.gameLoopService.stopGameLoop();
  }

  getTotalInhabitedPlanetCount(): number {
    let count = 0;
    for (const system of this.starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId === 'unhabited') continue;
        if ((planet.population ?? 0) <= 0 && !(planet.buildings ?? []).length) continue;
        count++;
      }
    }
    return count;
  }

  getAlliedInhabitedPlanetCount(): number {
    const playerFaction = this.factions.find((f) => f.id === 'player');
    const allied = new Set<string>();
    allied.add('player');
    if (playerFaction) {
      for (const faction of this.factions) {
        if (faction.id === 'player') continue;
        if (faction.ai === false && faction.team !== 0 && faction.team === playerFaction.team) {
          allied.add(faction.id);
        }
      }
    }
    let count = 0;
    for (const system of this.starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId === 'unhabited') continue;
        if ((planet.population ?? 0) <= 0 && !(planet.buildings ?? []).length) continue;
        if (allied.has(planet.factionId)) count++;
      }
    }
    return count;
  }

  returnToMainMenu(): void {
    this.saveGame();
    this.router.navigate(['']);
  }

  startNewGameFromEnd(): void {
    this.saveGame();
    this.router.navigate(['']);
  }
}

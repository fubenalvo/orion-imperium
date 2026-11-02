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
import { DysonRingService } from './dyson-ring.service';
import { DysonVictoryService } from './dyson-victory.service';
import { DYSON_WARMUP_SECONDS, DysonWarmupEvent, formatWarmup } from './dyson-victory';
import { DysonNewsEvent, diffDysonAnchors, snapshotDysonAnchors } from './dyson-news';
import { AnchorPanelViewModel, StarMapAnchorInfoComponent } from './star-map-anchor-info/star-map-anchor-info.component';
import {
  DYSON_BONUSES,
  DysonBonusId,
  describeAnchorDeploymentFailure,
  dysonBonusDef,
  hasLivingSwarmConstructor,
  isDysonAnchor,
} from './dyson-anchor';
import { dysonWedgePath } from './dyson-ring';
import {
  STATION_CONSTRUCTION_SECONDS,
  advanceMiningStationConstruction,
  allMiningStations,
  constructionProgress,
  describeConstruction,
  isStationComplete,
} from './station-construction';
import { GAME_VERSION } from '../../game-version';
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
import { TradeDirection, executeTrade } from './trade';
import { checkBuildingPlacement } from './building-placement';
import { TRADE_INCOME_WINDOW_SECONDS, TradeNetworkService, TraderRaid } from './trade-network.service';
import { RaidBlocker, TRADE_NETWORK_CONFIG, raidBlocker } from './trade-network';
import { RaidOrderHooks, updateRaidOrders } from './fleet-raid-orders';
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
  Trader,
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
  SystemAsteroid,
  getAiFactionIds,
} from './star-map.models';
import { TRUCE_SECONDS, areFactionsAllied, areFactionsHostile, formatGameDuration, getRelationKind, isNeutralFaction } from './diplomacy';
import { DemandFailure, DiplomacyFailure, DiplomacyService } from '../../services/diplomacy.service';
import { DiplomacyContext, EnemyDiplomacyService } from './enemy-diplomacy.service';
import { DEMAND_RULES, DemandInvalidReason, DemandKind, FOLLOW_THROUGH_SECONDS, describeDemandInvalid } from './diplomatic-demand';
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
  StarMapTraderInfoComponent,
  TraderPanelViewModel,
} from './star-map-trader-info/star-map-trader-info.component';
import {
  AsteroidMapView,
  BlackHoleRingView,
  DysonRingView,
  NebulaView,
  SpaceBaseMapView,
  TerritoryShapeView,
  TraderMapView,
} from './star-map-galaxy-view/star-map-galaxy-view.component';
import {
  createMulberry32,
  ensurePlanetResources as ensurePlanetResourcesUtil,
} from './star-map-resources.util';
import { StarMapPanelVmService } from './star-map-panel-vm.service';
import { describeStationDefense } from './station-defense';
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
import { PlanetStabilityState, planetStabilityNotices } from './planet-stability';

import { StarMapFleetInfoComponent } from './star-map-fleet-info/star-map-fleet-info.component';
import { StarMapSystemInfoComponent } from './star-map-system-info/star-map-system-info.component';
import { PlanetColonizationVm, StarMapPlanetInfoComponent } from './star-map-planet-info/star-map-planet-info.component';
import { StarMapPlanetScreenComponent, TradePostView } from './star-map-planet-screen/star-map-planet-screen.component';
import { RosterPlanet, StarMapFleetButtonsComponent } from './star-map-fleet-buttons/star-map-fleet-buttons.component';
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
import { SpaceBaseService } from './space-base.service';
import { TerritoryService } from './territory.service';
import { BorderService } from './border.service';
import { buildTerritoryShapes, TerritoryMap, TERRITORY_CONFIG } from './territory';
import { describeDeploymentFailure, hasLivingOutpostShip } from './space-base';
import { isPointInObstacle } from './fleet-navigation';
import { surveySystemAsteroids } from './system-asteroids';
import {
  AsteroidHint,
  describeAsteroidForFaction,
  describeMiningDeploymentFailure,
  deployMiningStation,
  stationExtractionRate,
  validateMiningStationDeployment,
} from './mining-station';
import { SYSTEM_FLEET_ENTRY_VW } from './system-grid';
import { minedDepositsOf } from './raw-deposits';
import { AnomalyContext, AnomalyEventVm, AnomalyService } from './anomaly.service';
import { StarMapAnomalyEventComponent } from './star-map-anomaly-event/star-map-anomaly-event.component';
import { AnomalyMapView } from './star-map-galaxy-view/star-map-galaxy-view.component';
import { AnomalyCellView } from './star-map-system-grid/star-map-system-grid.component';
import { ensureColonyCore, isCoreOwner } from './colony-core';

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
    StarMapAnchorInfoComponent,
    StarMapTraderInfoComponent,
    StarMapFleetManagerComponent,
    StarMapAnomalyEventComponent,
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
  dysonRingView: DysonRingView | null = null;
  // Impassable asteroid belts (persisted geometry) and their render data.
  asteroidBelts: AsteroidBelt[] = [];
  beltViews: BeltView[] = [];
  // Territory render data (docs/territory.md). Rebuilt only when the cached
  // TerritoryMap instance changes (ownership / base events), never per frame.
  territoryViews: TerritoryShapeView[] = [];
  private renderedTerritory: TerritoryMap | null = null;

  // Drifting asteroid selection / panel state (asteroids themselves live in
  // DriftingAsteroidService and are persisted through serializeGameState).
  selectedAsteroidId: number | null = null;
  /* Dyson anchor whose panel is open (a base id), or null. */
  selectedAnchorId: number | null = null;
  asteroidPanelVm: AsteroidPanelViewModel | null = null;
  asteroidPanelMessage: string | null = null;
  private asteroidPanelClock = 0;
  // Civilian trader selection / panel state (traders live in
  // TradeNetworkService). At most one of asteroid and trader is selected.
  selectedTraderId: number | null = null;
  traderPanelVm: TraderPanelViewModel | null = null;
  private traderPanelClock = 0;
  // Game seconds played, saved as StarMapData.gameSeconds.
  private gameSeconds = 0;
  // Short gameplay notice on the galaxy HUD (asteroid collected, route blocked…).
  mapNotice: string | null = null;
  /* Throttles redraws of construction progress to once per second of game time. */
  private constructionRedrawClock = 0;
  private mapNoticeClock = 0;
  private static readonly MAP_NOTICE_SECONDS = 6;
  /* Player planets whose energy shortage was already announced (planet-stability.ts; not persisted). */
  private readonly announcedEnergyShort = new Set<string>();
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
  /** Viewport element of the current drag, so a long press can end it (endStillDrag). */
  private dragViewport: HTMLElement | null = null;
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
  // Exploration event dialog (docs/exploration-anomalies.md): the oldest
  // pending anomaly event, null while none is pending. Modal like the fleet
  // manager: the game is paused while it is open and resumed on close only
  // if it was running when the dialog opened.
  anomalyEvent: AnomalyEventVm | null = null;
  anomalyError: string | null = null;
  private anomalyResumeOnClose = false;
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
    private tradeNetworkService: TradeNetworkService,
    private fleetOrganizationService: FleetOrganizationService,
    private diplomacyService: DiplomacyService,
    private enemyDiplomacyService: EnemyDiplomacyService,
    private spaceBaseService: SpaceBaseService,
    private dysonRingService: DysonRingService,
    private dysonVictoryService: DysonVictoryService,
    private territoryService: TerritoryService,
    private borderService: BorderService,
    private anomalyService: AnomalyService,
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
    this.selectedTraderId = null;
    this.traderPanelVm = null;
    this.selectedSystem = null;
    this.refreshAsteroidPanel();
    this.cdr.detectChanges();
  }

  /* View model of the selected Dyson anchor; closes the panel when the anchor is gone. */
  get anchorPanelVm(): AnchorPanelViewModel | null {
    if (this.selectedAnchorId === null) return null;
    const base = this.spaceBaseService.getBase(this.selectedAnchorId);
    if (!base || !isDysonAnchor(base)) return null;
    const building = !isStationComplete(base);
    return {
      id: base.id,
      name: base.name,
      ownerName: this.getFactionName(base.factionId),
      color: this.getFactionColor(base.factionId),
      own: base.factionId === 'player',
      building,
      secondsLeft: Math.ceil(base.constructionRemaining ?? 0),
      progress: constructionProgress(base, STATION_CONSTRUCTION_SECONDS.dysonAnchor),
      defense: building
        ? 'None while building'
        : describeStationDefense(base, this.getStationTurrets(base.factionId)),
      bonus: dysonBonusDef(base.dysonBonus),
      bonusOptions: DYSON_BONUSES,
    };
  }

  deselectAnchor(): void {
    this.selectedAnchorId = null;
    this.cdr.detectChanges();
  }

  onAnchorBonusPicked(bonus: DysonBonusId): void {
    if (this.selectedAnchorId === null) return;
    if (this.spaceBaseService.chooseBonus(this.selectedAnchorId, 'player', bonus)) {
      this.saveGame();
    }
    this.cdr.detectChanges();
  }

  onAnchorDemolished(): void {
    if (this.selectedAnchorId === null) return;
    const base = this.spaceBaseService.getBase(this.selectedAnchorId);
    if (base && this.spaceBaseService.demolish(base.id, 'player')) {
      this.showMapNotice(`${base.name} demolished. The slot is free again.`);
      this.selectedAnchorId = null;
      this.refreshTerritoryViews();
      this.updateSensorVisibility(true);
      this.saveGame();
    }
    this.cdr.detectChanges();
  }

  /* DEPLOY ANCHOR state of the selected player fleet; null when it carries no Swarm Constructor. */
  getSelectedFleetAnchorDeployment(): { canDeploy: boolean; reason: string | null } | null {
    const fleet = this.commandableFleet();
    if (!fleet || !hasLivingSwarmConstructor(fleet)) return null;
    const check = this.spaceBaseService.checkAnchor(fleet, this.factions);
    return check.ok ? { canDeploy: true, reason: null } : { canDeploy: false, reason: describeAnchorDeploymentFailure(check.reason) };
  }

  /* DEPLOY ANCHOR: the Swarm Constructor becomes a Dyson anchor site on the ring slot. */
  onDeployAnchorSelected(): void {
    const fleet = this.commandableFleet();
    if (!fleet) return;
    const result = this.spaceBaseService.deployAnchor(fleet, this.factions);
    if (!result.base) {
      if (!result.check.ok) this.showMapNotice(describeAnchorDeploymentFailure(result.check.reason));
      return;
    }
    this.showMapNotice(
      `${result.base.name}: construction started (${STATION_CONSTRUCTION_SECONDS.dysonAnchor} s). ` +
        'It is defenseless until complete, then claims its ring wedge.',
    );
    if (result.fleetRetired) this.deselectFleet();
    this.selectedAnchorId = result.base.id;
    this.saveGame();
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
      fleet.raidTraderId = null;
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

  /* ---------- Civilian traders (docs/trade-network.md) ---------- */

  private findPlanetWithSystem(planetId: number): { planet: PlanetTile; system: StarSystem } | null {
    for (const system of this.starSystems) {
      const planet = system.planetsTiles?.find((p) => p.id === planetId);
      if (planet) return { planet, system };
    }
    return null;
  }

  /*
   * Only travelling traders are drawn (a docked one sits on its star system).
   * Fog of war follows the fleet rule: the player's own network is always
   * known; other traders only inside the player's sensor coverage.
   */
  isTraderVisible(trader: Trader): boolean {
    if (trader.status !== 'travelling') return false;
    if (!this.sensorRangeEnabled) return true;
    if (this.findPlanetWithSystem(trader.homePlanetId)?.planet.factionId === 'player') return true;
    const key = `${Math.floor(trader.x)}-${Math.floor(trader.y)}`;
    return this.sensorRangeCells.has(key) || this.sensorPreviewCells.has(key);
  }

  /* Fleets pursued by a player attack order; the galaxy view rings them like a targeted asteroid. */
  get attackTargetFleetIds(): ReadonlySet<number> {
    const ids = new Set<number>();
    for (const fleet of this.fleets) {
      if (fleet.factionId === 'player' && !fleet.destroyed && fleet.attackFleetId != null) ids.add(fleet.attackFleetId);
    }
    return ids;
  }

  get visibleTraders(): TraderMapView[] {
    const views: TraderMapView[] = [];
    for (const trader of this.tradeNetworkService.traders) {
      if (!this.isTraderVisible(trader)) continue;
      const next = this.tradeNetworkService.getRoute(trader)[0];
      const ownerId = this.findPlanetWithSystem(trader.homePlanetId)?.planet.factionId ?? 'independent';
      views.push({
        id: trader.id,
        left: (trader.x - 0.5) * this.cellSizeVw,
        top: (trader.y - 0.5) * this.cellSizeVh,
        angleDeg: next ? (Math.atan2(next.y - trader.y, next.x - trader.x) * 180) / Math.PI : 0,
        color: this.getFactionColor(ownerId),
        label: `Trader · ${trader.cargo?.goods ?? 'empty'}`,
        selected: this.selectedTraderId === trader.id,
      });
    }
    return views;
  }

  onTraderClick(traderId: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }
    this.selectTrader(traderId);
  }

  selectTrader(traderId: number): void {
    this.selectedTraderId = traderId;
    this.selectedAsteroidId = null;
    this.asteroidPanelVm = null;
    this.asteroidPanelMessage = null;
    this.selectedSystem = null;
    this.refreshTraderPanel();
    this.cdr.detectChanges();
  }

  deselectTrader(): void {
    this.selectedTraderId = null;
    this.traderPanelVm = null;
    this.cdr.detectChanges();
  }

  /* Rebuilds the trader panel; throttled from the game loop like the asteroid panel. */
  private refreshTraderPanel(): void {
    const trader = this.selectedTraderId == null ? undefined : this.tradeNetworkService.getTrader(this.selectedTraderId);
    if (!trader || !this.isTraderVisible(trader)) {
      this.selectedTraderId = null;
      this.traderPanelVm = null;
      return;
    }
    const home = this.findPlanetWithSystem(trader.homePlanetId);
    const from = this.findPlanetWithSystem(trader.portPlanetId);
    const to = trader.destinationPlanetId === null ? null : this.findPlanetWithSystem(trader.destinationPlanetId);
    const ownerId = home?.planet.factionId ?? 'independent';
    const owner = this.factions.find((f) => f.id === ownerId);
    const civilian = !owner || isNeutralFaction(owner);
    const route = this.tradeNetworkService.getRoute(trader);
    const placeName = (place: { planet: PlanetTile; system: StarSystem } | null) =>
      place ? `${place.planet.name} (${place.system.name})` : 'Unknown';
    this.traderPanelVm = {
      id: trader.id,
      affiliation: civilian ? 'Independent' : this.getFactionName(ownerId),
      affiliationColor: this.getFactionColor(civilian ? 'independent' : ownerId),
      relation: ownerId === 'player' ? 'own' : civilian ? 'civilian' : 'foreign',
      homePost: placeName(home),
      from: placeName(from),
      to: placeName(to),
      goods: trader.cargo?.goods ?? 'Empty hold',
      cargoCredits: trader.cargo?.credits ?? 0,
      etaSeconds: route.length > 0
        ? this.terrainService.nebulaField.pathTravelSeconds([{ x: trader.x, y: trader.y }, ...route], TRADE_NETWORK_CONFIG.speed)
        : null,
      hullPercent: Math.round((100 * trader.hull) / TRADE_NETWORK_CONFIG.hull),
      raid: ownerId === 'player' ? null : this.traderRaidSection(trader, owner),
    };
  }

  /*
   * Raid section of the trader panel. Raids are ordered only by right-click
   * (onTraderContextMenu); the panel shows whether it may be raided, the
   * diplomatic cost, and which player fleets are already raiding it.
   */
  private traderRaidSection(trader: Trader, owner: Faction | undefined): NonNullable<TraderPanelViewModel['raid']> {
    const player = this.factions.find((f) => f.id === 'player');
    if (raidBlocker(player, owner) === 'allied_trader') {
      return { blocked: 'An allied trader: it cannot be raided.', warning: null, raiders: [] };
    }
    const raiders = this.fleets
      .filter((f) => f.factionId === 'player' && !f.destroyed && f.raidTraderId === trader.id)
      .map((f) => f.name);
    return { blocked: null, warning: this.traderRaidCost(player, owner), raiders };
  }

  /* The diplomatic cost of raiding a trader of `owner` (docs/trade-network.md#raids), or null at war. */
  private traderRaidCost(player: Faction | undefined, owner: Faction | undefined): string | null {
    if (!owner || isNeutralFaction(owner)) {
      return 'Piracy against civilians costs a little reputation.';
    }
    if (player && getRelationKind(player, owner) === 'peace') {
      return `${owner.name} is at peace with you: raiding its trader costs opinion and reputation (no war by itself).`;
    }
    return null;
  }

  /* Why the fleet's faction may not raid this trader (trade-network.ts raidBlocker), or null. */
  traderRaidBlocker(fleet: Fleet, trader: Trader): RaidBlocker | null {
    const raider = this.factions.find((f) => f.id === fleet.factionId);
    return raidBlocker(raider, this.tradeNetworkService.traderOwner(trader, this.starSystems, this.factions));
  }

  /*
   * Orders a player fleet to raid the selected trader: a pursuit validated
   * like a move (fleet-raid-orders.ts keeps re-aiming it). Replaces any other
   * order of the fleet.
   */
  onRaidTrader(fleetId: number): void {
    const fleet = this.fleets.find((f) => f.id === fleetId && f.factionId === 'player' && !f.destroyed);
    const trader = this.selectedTraderId == null ? undefined : this.tradeNetworkService.getTrader(this.selectedTraderId);
    if (!fleet || !trader || trader.status !== 'travelling') return;
    if (this.traderRaidBlocker(fleet, trader)) {
      this.showMapNotice('An allied trader: it cannot be raided.');
      return;
    }
    if (fleet.raidTraderId === trader.id) return;
    if (this.tradeNetworkService.raidDamagePerSecond(fleet) <= 0) {
      this.showMapNotice(`${fleet.name} has no warships to raid with.`);
      return;
    }
    if (!this.movementService.planGalaxyRoute({ x: fleet.x, y: fleet.y }, { x: trader.x, y: trader.y }).ok) {
      this.showMapNotice(`${fleet.name}: no safe route to the trader.`);
      return;
    }
    fleet.interceptAsteroidId = null;
    fleet.attackFleetId = null;
    fleet.raidTraderId = trader.id;
    fleet.targetX = trader.x;
    fleet.targetY = trader.y;
    if (this.selectedFleet?.id === fleet.id) {
      this.fleetMoveError = null;
      this.targetX = trader.x;
      this.targetY = trader.y;
    }
    // The order is a single right-click, so the price is stated when it is given.
    const cost = this.traderRaidCost(
      this.factions.find((f) => f.id === 'player'),
      this.tradeNetworkService.traderOwner(trader, this.starSystems, this.factions),
    );
    this.showMapNotice(`${fleet.name} is raiding the trader.${cost ? ' ' + cost : ''}`);
    this.simStateDirty = true;
    this.saveGame();
    this.refreshTraderPanel();
    this.cdr.detectChanges();
  }

  /* Right-click on a trader with a commandable fleet selected: raid it. */
  onTraderContextMenu(traderId: number, event: MouseEvent): void {
    if (this.consumeRightClick(event)) return;
    const fleet = this.commandableFleet();
    if (!fleet) return;
    this.selectedFleetAction = null;
    this.selectTrader(traderId);
    this.onRaidTrader(fleet.id);
  }

  /*
   * Notices for traders destroyed by raids. A raid the player took part in
   * (as raider or as the trader's owner) is saved at once, like a collected
   * asteroid, so a battle-return reload cannot bring the trader back.
   */
  private handleTraderRaids(raids: readonly TraderRaid[]): boolean {
    let playerInvolved = false;
    for (const raid of raids) {
      if (this.selectedTraderId === raid.traderId) {
        this.selectedTraderId = null;
        this.traderPanelVm = null;
      }
      const raider = this.fleets.find((f) => f.id === raid.raiderFleetId);
      if (raid.raiderFactionId === 'player') {
        playerInvolved = true;
        const cost = raid.opinion > 0
          ? ` ${this.getFactionName(raid.ownerId!)} resents it (opinion −${raid.opinion}, reputation −${raid.reputation}).`
          : raid.reputation > 0 ? ` Piracy costs reputation (−${raid.reputation}).` : '';
        this.showMapNotice(`${raider?.name ?? 'Your fleet'} raided a trader: +${raid.loot} credits.${cost}`);
      } else if (raid.ownerId === 'player') {
        playerInvolved = true;
        this.showMapNotice(`${this.getFactionName(raid.raiderFactionId)} raided one of your traders (${raid.cargoCredits} credits lost).`);
      }
    }
    if (playerInvolved) this.saveGame();
    return raids.length > 0;
  }

  /* Network figures for the TRADE tab of a planet with a Trading Post. */
  getTradePostVm(planet: PlanetTile): TradePostView {
    const stats = this.tradeNetworkService.postStats(planet.id);
    return {
      ...stats,
      recentIncome: this.tradeNetworkService.recentIncome(planet.factionId),
      windowMinutes: TRADE_INCOME_WINDOW_SECONDS / 60,
    };
  }

  /* Satisfaction and energy state of every player planet, keyed by planet name. */
  private playerPlanetStability(): Map<string, PlanetStabilityState> {
    const player = this.factions.find((f) => f.id === 'player') ?? null;
    const states = new Map<string, PlanetStabilityState>();
    for (const system of this.starSystems) {
      for (const planet of system.planetsTiles ?? []) {
        if (planet.factionId !== 'player') continue;
        const economy = this.economyService.calculatePlanetEconomy(planet, player);
        states.set(planet.name, {
          satisfaction: economy.satisfaction,
          efficiency: economy.efficiency,
          satisfactionDrift: economy.satisfactionDrift,
        });
      }
    }
    return states;
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
  readonly boundOnTraderClick = this.onTraderClick.bind(this);
  readonly boundOnTraderContextMenu = this.onTraderContextMenu.bind(this);
  readonly boundGetTradePostVm = this.getTradePostVm.bind(this);
  readonly boundOnSpaceBaseClick = this.onSpaceBaseClick.bind(this);
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
    const ring = this.dysonRingService.ring;
    this.dysonRingView = ring
      ? {
          wedges: ring.slots.map((slot) => dysonWedgePath(ring, slot.index)),
          slots: ring.slots.map((slot) => ({ index: slot.index, cx: slot.col - 0.5, cy: slot.row - 0.5 })),
        }
      : null;
    this.blackHoleRings = this.terrainService.obstacles.filter((o) => o.kind === 'blackhole').map((o) => ({
      cx: o.x - 0.5,
      cy: o.y - 0.5,
      r: o.radius,
    }));
  }

  /*
   * Rebuilds the territory overlay when the territory changed. Cheap to call
   * every frame: TerritoryService returns the same TerritoryMap instance
   * until a planet ownership change or a base event invalidates it, so the
   * SVG paths are only rebuilt on those events.
   */
  private refreshTerritoryViews(): boolean {
    const territory = this.territoryService.get(this.starSystems, this.factions);
    if (territory === this.renderedTerritory) {
      return false;
    }
    this.renderedTerritory = territory;
    this.territoryViews = buildTerritoryShapes(territory).map((shape) => ({
      ...shape,
      color: this.getFactionColor(shape.factionId),
      own: shape.factionId === 'player',
    }));
    return true;
  }

  /*
   * Space bases drawn on the galaxy map: own bases always, foreign bases
   * once their cell has been explored (a base is a static structure, like a
   * star, so it stays known after first sight). Fog disabled shows all.
   */
  get visibleSpaceBases(): SpaceBaseMapView[] {
    return this.spaceBaseService.bases
      // Dyson anchors are known to every empire regardless of fog (docs/dyson-swarm.md).
      .filter((b) => isDysonAnchor(b) || !this.sensorRangeEnabled || b.factionId === 'player' || this.exploredGridCells.has(`${b.x}-${b.y}`))
      .map((b) => ({
        id: b.id,
        name: b.name,
        ownerName: this.getFactionName(b.factionId),
        color: this.getFactionColor(b.factionId),
        own: b.factionId === 'player',
        left: (b.x - 0.5) * this.cellSizeVw,
        top: (b.y - 0.5) * this.cellSizeVh,
        claimRadiusVw: TERRITORY_CONFIG.baseClaimRadius * this.cellSizeVw,
        turrets: this.getStationTurrets(b.factionId),
        building: !isStationComplete(b),
        buildProgress: constructionProgress(
          b,
          isDysonAnchor(b) ? STATION_CONSTRUCTION_SECONDS.dysonAnchor : STATION_CONSTRUCTION_SECONDS.spaceBase,
        ),
        dysonSlot: isDysonAnchor(b) ? (b.dysonSlot ?? null) : null,
        selected: this.selectedAnchorId === b.id,
      }));
  }

  /*
   * Turrets on every station (space base or mining station) of a faction:
   * derived from its Turret Research level, so the markers follow research
   * immediately (station-defense.ts).
   */
  getStationTurrets(factionId: string): number {
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? this.battleDetectionService.stationTurretsOf(faction) : 0;
  }

  readonly boundGetStationTurrets = this.getStationTurrets.bind(this);

  /* Base marker click: names the base; the click still reaches the map, so move orders work through it. */
  onSpaceBaseClick(baseId: number): void {
    const base = this.spaceBaseService.getBase(baseId);
    if (!base) return;
    if (isDysonAnchor(base)) {
      this.selectedAnchorId = base.id;
      this.cdr.detectChanges();
      return;
    }
    const owner = base.factionId === 'player' ? 'your' : this.getFactionName(base.factionId);
    if (!isStationComplete(base)) {
      this.showMapNotice(
        `${base.name}: ${owner} space base. ${describeConstruction(base)}: no territory, sensors or defenses until complete.`,
      );
      return;
    }
    const defense = describeStationDefense(base, this.getStationTurrets(base.factionId));
    this.showMapNotice(`${base.name}: ${owner} space base. Claims ${TERRITORY_CONFIG.baseClaimRadius} cells around it. ${defense}.`);
  }

  private baseDeployContext() {
    return {
      factions: this.factions,
      starSystems: this.starSystems,
      territory: this.territoryService.get(this.starSystems, this.factions),
      width: this.mapWidth,
      height: this.mapHeight,
      isBlocked: (x: number, y: number) => this.terrainService.obstacles.some((o) => isPointInObstacle({ x, y }, o)),
    };
  }

  /* DEPLOY BASE state of the selected player fleet; null when it carries no outpost ship. */
  getSelectedFleetBaseDeployment(): { canDeploy: boolean; reason: string | null } | null {
    const fleet = this.commandableFleet();
    if (!fleet || !hasLivingOutpostShip(fleet)) {
      return null;
    }
    const check = this.spaceBaseService.check(fleet, this.baseDeployContext());
    return check.ok ? { canDeploy: true, reason: null } : { canDeploy: false, reason: describeDeploymentFailure(check.reason) };
  }

  /* DEPLOY BASE: the outpost ship becomes a permanent space base on the fleet's cell. */
  onDeployBaseSelected(): void {
    const fleet = this.commandableFleet();
    if (!fleet) {
      return;
    }
    const result = this.spaceBaseService.deploy(fleet, this.baseDeployContext());
    if (!result.base) {
      if (!result.check.ok) this.showMapNotice(describeDeploymentFailure(result.check.reason));
      return;
    }
    this.showMapNotice(
      `${result.base.name}: construction started. It claims territory and senses once complete ` +
        `(${STATION_CONSTRUCTION_SECONDS.spaceBase} s), and is defenseless until then.`,
    );
    if (result.fleetRetired) {
      this.deselectFleet();
    }
    this.refreshTerritoryViews();
    this.updateSensorVisibility(true);
    this.saveGame();
    this.cdr.detectChanges();
  }

  /*
   * DEPLOY MINING state of the selected player fleet: only inside a star
   * system and only with an outpost ship (null hides the button). Inside a
   * system it replaces DEPLOY BASE, which only works in open space.
   */
  getSelectedFleetMiningDeployment(): { canDeploy: boolean; reason: string | null } | null {
    const fleet = this.commandableFleet();
    if (!fleet || !fleet.system || !hasLivingOutpostShip(fleet)) {
      return null;
    }
    const check = validateMiningStationDeployment(this.miningDeployInput(fleet));
    if (check.ok) {
      return {
        canDeploy: true,
        reason: `Build a mining station on this ${Math.floor(check.asteroid.rawMaterials).toLocaleString('en-US')} raw deposit (uses one Outpost Ship)`,
      };
    }
    return { canDeploy: false, reason: describeMiningDeploymentFailure(check.reason) };
  }

  private miningDeployInput(fleet: Fleet) {
    return {
      fleet,
      factions: this.factions,
      starSystems: this.starSystems,
      territory: this.territoryService.get(this.starSystems, this.factions),
    };
  }

  /* DEPLOY MINING: the outpost ship becomes a mining station on the asteroid the fleet stands on. */
  onDeployMiningSelected(): void {
    const fleet = this.commandableFleet();
    if (!fleet) {
      return;
    }
    const result = deployMiningStation(this.miningDeployInput(fleet));
    if (!result.ok) {
      if (!result.check.ok) this.showMapNotice(describeMiningDeploymentFailure(result.check.reason));
      return;
    }
    this.showMapNotice(
      `Mining station under construction in the ${result.system.name} asteroid belt ` +
        `(${STATION_CONSTRUCTION_SECONDS.miningStation} s, defenseless until then): it will extract ` +
        `${stationExtractionRate(result.asteroid)} raw materials/s from a ` +
        `${Math.floor(result.asteroid.rawMaterials).toLocaleString('en-US')} deposit.`,
    );
    if (result.fleetRetired) {
      this.deselectFleet();
    }
    this.saveGame();
    this.cdr.detectChanges();
  }

  /* Hover card of an in-system asteroid (mining target status), for the player. */
  getAsteroidHint(asteroid: SystemAsteroid): AsteroidHint | null {
    const system = this.selectedSystem;
    if (!system) return null;
    return describeAsteroidForFaction({
      factionId: 'player',
      system,
      asteroid,
      territory: this.territoryService.get(this.starSystems, this.factions),
      fleets: this.fleets,
      factionName: (id) => this.getFactionName(id),
      stationTurrets: (id) => this.getStationTurrets(id),
    });
  }

  readonly boundGetAsteroidHint = this.getAsteroidHint.bind(this);

  /* Why the selected fleet's parked colonizer may not settle (another empire's territory). */
  getSelectedFleetColonizeBlock(): string | null {
    const fleet = this.commandableFleet();
    const blocker = fleet ? this.arrivalService.getTerritoryBlocker(fleet, this.starSystems, this.factions) : null;
    return blocker ? `${blocker.name} territory: colonizing here is only possible at war with them.` : null;
  }

  /* Empire whose borders the selected player fleet is violating right now, if any. */
  getSelectedFleetBorderViolation(): string | null {
    const fleet = this.selectedFleet;
    if (!fleet || fleet.factionId !== 'player') return null;
    const ownerId = this.borderService.violatedTerritoryOf(fleet.id);
    return ownerId ? this.getFactionName(ownerId) : null;
  }

  /* Map notices for border violations involving the player (docs/territory.md#border-violations). */
  private handleBorderEvents(): boolean {
    const events = this.borderService.drainEvents();
    for (const event of events) {
      if (event.intruderId === 'player') {
        this.showMapNotice(`${event.fleetName} entered ${this.getFactionName(event.ownerId)} territory: border violation. Their opinion of you drops while it stays.`);
      } else if (event.ownerId === 'player') {
        this.showMapNotice(`A ${this.getFactionName(event.intruderId)} fleet (${event.fleetName}) is violating your borders.`);
      }
    }
    return events.length > 0;
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
            x: SYSTEM_FLEET_ENTRY_VW.x,
            y: SYSTEM_FLEET_ENTRY_VW.y,
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
      planetData as {
        buildings: { id: string; price: number; rawMaterialCost?: number; size: number; name: string; maxPerPlanet?: number; requiresOreProximity?: boolean }[];
      }
    ).buildings.find((b) => b.id === event.buildingId);
    if (!buildingDef) return;

    // The planet screen only emits valid placements, but this is the point
    // that changes the game state, so the rule is enforced here too, before
    // anything is paid.
    if (checkBuildingPlacement(planet, this.getPlanetGridSize(planet), buildingDef, event.x, event.y) !== null) return;

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

  /*
   * Trading Post exchange from the planet screen. trade.ts re-checks every
   * rule (post on the planet, owner, stock), so a stale button can never
   * trade at a loss of resources the player no longer has.
   */
  onTradeRequest(event: { planetId: number; direction: TradeDirection; raw: number }): void {
    const player = this.factions.find((f) => f.id === 'player');
    const planet = this.starSystems.flatMap((s) => s.planetsTiles ?? []).find((p) => p.id === event.planetId);
    if (!player) return;
    const result = executeTrade(player, planet, event.direction, event.raw);
    if (!result.ok) return;
    const { quote } = result;
    this.showMapNotice(quote.direction === 'buyRaw'
      ? `Trading Post: bought ${quote.raw} raw materials for ${quote.credits} credits.`
      : `Trading Post: sold ${quote.raw} raw materials for ${quote.credits} credits.`);
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
    const playerId = this.getPlayerFaction()?.id;
    const openDemands = this.diplomacyService.getDemands().filter((d) =>
      (d.stage === 'pending' && d.targetId === playerId) || (d.stage === 'follow_through' && d.demanderId === playerId));
    return this.diplomacyService.getOfferIds().length + openDemands.length;
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
    const casusBelli = this.diplomacyService.isDysonCasusBelli(target);
    const result = this.diplomacyService.declareWar(player, target);
    this.diplomacyMessage = result.ok
      ? casusBelli
        ? `You declared war on ${target.name} to stop their Dyson swarm. No reputation was lost; their opinion of you dropped.`
        : `You declared war on ${target.name}. Reputation and their opinion of you dropped.`
      : this.describeDiplomacyFailure(target, result.reason, result.waitSeconds);
    if (result.ok) this.afterTreatyChange();
  }

  onBreakTreaty(factionId: string): void {
    const player = this.getPlayerFaction();
    const target = this.factions.find((f) => f.id === factionId);
    if (!player || !target) return;
    const casusBelli = this.diplomacyService.isDysonCasusBelli(target);
    const result = this.diplomacyService.breakTreaty(player, target);
    this.diplomacyMessage = result.ok
      ? casusBelli
        ? `You broke the treaty with ${target.name} to stop their Dyson swarm. No reputation was lost.`
        : `You broke the treaty with ${target.name}. Every empire now trusts you less.`
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

  /* ---------- Credit demands (docs/diplomacy.md) ---------- */

  /*
   * The player demands credits from an AI at peace. Same path as an AI
   * demander (EnemyDiplomacyService.makeDemand): the AI answers at once;
   * a refused ultimatum leaves the player a follow-through decision.
   */
  onSendDemand(request: { targetId: string; kind: DemandKind; amount: number }): void {
    const player = this.getPlayerFaction();
    const target = this.factions.find((f) => f.id === request.targetId);
    if (!player || !target) return;
    const result = this.enemyDiplomacyService.makeDemand(player, target, request.kind, request.amount, this.demandContext());
    if (!result.ok) {
      this.diplomacyMessage = this.describeDemandFailure(target, result.reason, result.waitSeconds);
      return;
    }
    const amount = request.amount.toLocaleString('en-US');
    switch (result.outcome) {
      case 'paid':
        this.diplomacyMessage = `${target.name} pays you ${amount} credits.`;
        break;
      case 'follow_through':
        this.diplomacyMessage = `${target.name} rejects your ultimatum. Declare war within ${formatGameDuration(FOLLOW_THROUGH_SECONDS)} of game time, or back down.`;
        break;
      default:
        this.diplomacyMessage = `${target.name} refuses to pay ${amount} credits.`;
    }
    this.afterTreatyChange();
  }

  /* The player pays an AI's demand (one atomic transfer; nothing changes if the credits are short). */
  onAcceptDemand(demandId: number): void {
    const demand = this.diplomacyService.getDemand(demandId);
    const demander = demand ? this.factions.find((f) => f.id === demand.demanderId) : undefined;
    if (!demand || !demander || demand.stage !== 'pending') return;
    const result = this.diplomacyService.acceptDemand(demand, this.liveDiplomacyContext());
    const amount = demand.amount.toLocaleString('en-US');
    if (result.ok) {
      this.diplomacyMessage = `You paid ${amount} credits to ${demander.name}.`;
      this.afterTreatyChange();
    } else if (result.reason === 'insufficient_credits') {
      this.diplomacyMessage = `You do not hold ${amount} credits right now. Decline, or pay before the deadline.`;
    } else {
      this.diplomacyMessage = describeDemandInvalid(result.reason as DemandInvalidReason);
    }
  }

  /* The player refuses an AI's demand; for an ultimatum the AI decides war or bluff at once. */
  onDeclineDemand(demandId: number): void {
    const demand = this.diplomacyService.getDemand(demandId);
    const demander = demand ? this.factions.find((f) => f.id === demand.demanderId) : undefined;
    if (!demand || !demander || demand.stage !== 'pending') return;
    const outcome = this.enemyDiplomacyService.handleRefusal(demand, this.demandContext());
    this.diplomacyMessage = outcome === 'war'
      ? `You refused the ultimatum. ${demander.name} declared war on you!`
      : outcome === 'bluff'
        ? `You refused the ultimatum. ${demander.name} backed down.`
        : `You refused the demand of ${demander.name}. Their opinion of you dropped.`;
    this.afterTreatyChange();
  }

  /* The player enforces a refused ultimatum: an ordinary war declaration. */
  onCarryOutThreat(demandId: number): void {
    const demand = this.diplomacyService.getDemand(demandId);
    const target = demand ? this.factions.find((f) => f.id === demand.targetId) : undefined;
    if (!demand || !target || demand.stage !== 'follow_through') return;
    const result = this.diplomacyService.carryOutThreat(demand, this.factions);
    this.diplomacyMessage = result.ok
      ? `You enforced your ultimatum: war with ${target.name}.`
      : `War with ${target.name} cannot be declared right now.`;
    if (result.ok) this.afterTreatyChange();
  }

  /* The player backs down from a refused ultimatum (reputation and credibility suffer). */
  onBackDownThreat(demandId: number): void {
    const demand = this.diplomacyService.getDemand(demandId);
    const target = demand ? this.factions.find((f) => f.id === demand.targetId) : undefined;
    if (!demand || !target || demand.stage !== 'follow_through') return;
    this.diplomacyService.backDown(demand, this.factions);
    this.diplomacyMessage = `You backed down from your ultimatum to ${target.name}. Your reputation dropped and your threats carry less weight.`;
    this.afterTreatyChange();
  }

  /* Diplomacy context with the economy data the AI needs to judge what it can pay. */
  private demandContext(): DiplomacyContext {
    return { ...this.liveDiplomacyContext(), production: this.production, shipStock: this.shipStock };
  }

  private describeDemandFailure(target: Faction, reason: DemandFailure | undefined, waitSeconds?: number): string {
    switch (reason) {
      case 'cooldown':
        return `Too soon: you can make your next demand in ${formatGameDuration(waitSeconds ?? 0)}.`;
      case 'open_demand':
        return `A demand between you and ${target.name} is still open.`;
      case 'unknown_faction':
      case 'not_at_peace':
      case 'eliminated':
      case 'truce':
      case 'invalid_amount':
      case 'insufficient_credits':
        return describeDemandInvalid(reason);
      default:
        return 'This demand is not possible right now.';
    }
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
    this.diplomacyMessage = `Peace signed with ${ai.name}. Truce: ${formatGameDuration(TRUCE_SECONDS)} of game time.`;
    this.closeNegotiation();
    this.afterTreatyChange();
  }

  private describeDiplomacyFailure(target: Faction, reason: DiplomacyFailure | undefined, waitSeconds?: number): string {
    switch (reason) {
      case 'truce':
        return `The truce with ${target.name} holds for another ${formatGameDuration(waitSeconds ?? 0)}. Only breaking the treaty can end it.`;
      case 'locked':
        return `The war with ${target.name} is too fresh: wait ${formatGameDuration(waitSeconds ?? 0)}.`;
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
          lines.push((event.targetId === 'player'
            ? `${name(event.initiatorId)} declared war on you!`
            : `${name(event.initiatorId)} declared war on ${name(event.targetId)}.`) + (event.dysonCasusBelli ? ' Casus belli: the Dyson swarm.' : ''));
          break;
        case 'breach':
          lines.push(`${name(event.initiatorId)} broke its treaty with ${name(event.targetId)}!` + (event.dysonCasusBelli ? ' Casus belli: the Dyson swarm.' : ''));
          break;
        case 'peace':
          lines.push(`${name(event.initiatorId)} and ${name(event.targetId)} signed peace.`);
          break;
        case 'honored':
          if (involvesPlayer) lines.push(`The truce between ${name(event.initiatorId)} and ${name(event.targetId)} was honored. Reputation improved.`);
          break;
        case 'demand':
          // Demands to the player get a notice; AI–AI demands only once they resolve.
          if (event.targetId === 'player' && event.demand) {
            lines.push(`${name(event.initiatorId)}: ${DEMAND_RULES[event.demand.kind].label.toLowerCase()} for ${event.demand.amount.toLocaleString('en-US')} credits. Open DIPLOMACY to answer.`);
          }
          break;
        case 'demand_paid':
          if (!involvesPlayer && event.demand?.kind === 'threat') {
            lines.push(`${name(event.targetId)} paid ${event.demand.amount.toLocaleString('en-US')} credits to ${name(event.initiatorId)} under threat of war.`);
          }
          break;
        case 'demand_refused':
          // Only an expired demand reaches here for the player (answers are reported in the panel).
          if (event.targetId === 'player') lines.push(`You let the demand of ${name(event.initiatorId)} expire: it counts as refused.`);
          break;
        case 'bluff':
          lines.push(event.initiatorId === 'player'
            ? `You did not enforce your ultimatum to ${name(event.targetId)}. Your reputation dropped.`
            : `${name(event.initiatorId)} backed down from its ultimatum to ${name(event.targetId)}.`);
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
    return fleet ? this.arrivalService.getColonizablePlanet(fleet, this.starSystems, this.factions) : null;
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
    const result = this.arrivalService.colonize(fleet, planet, {
      production: this.production,
      factions: this.factions,
      starSystems: this.starSystems,
    });
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

  /*
   * Every planet owned by a faction must have a core building (colony-core.ts).
   * Saves from before cores existed get a Colony Center on each owned planet
   * (old homeworlds too: a save does not record which planet was the
   * homeworld). Idempotent; runs after terrain and deposits so it avoids both.
   */
  ensureColonyCores(): void {
    for (const planet of this.starSystems.flatMap((s) => s.planetsTiles)) {
      if (isCoreOwner(planet.factionId)) {
        ensureColonyCore(planet);
      }
    }
  }

  /** Ensures every planet has deterministic deposit tiles and, where it has tiles, a finite reserve. */
  ensureResourceTiles(): void {
    ensurePlanetResourcesUtil(this.starSystems.flatMap((s) => s.planetsTiles), (p: PlanetTile) => this.getPlanetGridSize(p));
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

  /*
   * Whether the player has ever had sensor coverage of a system's galaxy
   * cell (the persistent exploredGridCells set). StarSystem.explored is not
   * usable for this: every generated system has it set from the start.
   * With fog of war off the whole map counts as charted.
   */
  isSystemCharted(system: StarSystem): boolean {
    if (!this.sensorRangeEnabled) return true;
    const col = system.gridCol ?? Math.floor(system.x);
    const row = system.gridRow ?? Math.floor(system.y);
    return this.exploredGridCells.has(`${col}-${row}`);
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

  /*
   * Jumps from the galaxy map roster straight into a planet's surface view.
   * The planet's system becomes the selected system and its fleets are
   * placed like enterSystem() does, so "back" from the planet lands in a
   * consistent system view; the map camera is centered on the system so
   * leaving the system returns there too.
   */
  openPlanetFromRoster({ system, planet }: RosterPlanet): void {
    this.saveGame();
    this.selectedFleet = null;
    this.selectedFleetAction = null;
    this.fleetMoveError = null;
    this.selectedSystem = system;
    this.selectedPlanetTile = planet;
    this.centerCameraOnGridPosition(system.x, system.y);
    this.initFleetsInSystem(system);
    this.currentView = 'planet';
    this.cdr.detectChanges();
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
   *   - civilian trader: raid order (the only way to order one)
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
    this.endStillDrag(event);
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
        // Only a war makes a fleet attackable (diplomacy.ts); say so, or the
        // right-click looks like a failed attack order.
        const moved = this.moveSelectedFleet(target.x, target.y);
        if (moved && target.factionId !== 'player') {
          this.showMapNotice(`Not at war with ${this.getFactionName(target.factionId)}: ${fleet.name} moves to ${target.name} without attacking.`);
        }
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

  private readonly raidOrderHooks: RaidOrderHooks = {
    getTrader: (id) => this.tradeNetworkService.getTrader(id),
    isVisible: (trader) => this.isTraderVisible(trader),
    canRaid: (raider, trader) => this.traderRaidBlocker(raider, trader) === null,
    retarget: (raider, x, y) => {
      if (!this.movementService.planGalaxyRoute({ x: raider.x, y: raider.y }, { x, y }).ok) {
        return false;
      }
      raider.interceptAsteroidId = null;
      raider.attackFleetId = null;
      raider.targetX = x;
      raider.targetY = y;
      if (this.selectedFleet?.id === raider.id && this.currentView === 'map') {
        this.targetX = x;
        this.targetY = y;
      }
      return true;
    },
  };

  /* Re-aims raiding fleets; tells the player when a raid ends without a kill. */
  private updateRaidOrders(): boolean {
    const { ended, retargeted } = updateRaidOrders(this.fleets, this.raidOrderHooks);
    for (const end of ended) {
      if (end.reason === 'docked') {
        this.showMapNotice(`${end.raider.name}: the trader reached port. Raid cancelled.`);
      } else if (end.reason === 'lost-contact') {
        this.showMapNotice(`${end.raider.name} lost contact with the trader.`);
      } else if (end.reason === 'no-route') {
        this.showMapNotice(`${end.raider.name}: no safe route to the trader. Raid cancelled.`);
      } else if (end.reason === 'not-allowed') {
        this.showMapNotice(`${end.raider.name}: that trader may no longer be raided. Raid cancelled.`);
      }
    }
    return retargeted || ended.length > 0;
  }

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
      const items = this.movementService.getObjectsAtPlanet(this.fleets, this.selectedSystem, planet);

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
      if (!this.movementService.isSystemCellOnPlanet(planet, targetCell.col, targetCell.row)) {
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
        this.selectedFleet.raidTraderId = null;
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
      // A manual order replaces any asteroid intercept, attack or raid order.
      this.selectedFleet.interceptAsteroidId = null;
      this.selectedFleet.attackFleetId = null;
      this.selectedFleet.raidTraderId = null;
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

  /*
   * A touch long-press arrives as a contextmenu (TouchLongPressService) while
   * the same finger has already started a camera drag on pointerdown. If the
   * camera has not moved, that "drag" was really the press: end it, so the
   * lift is not read as a tap (onMapClick) that would undo the order.
   * The synthetic long-press event (not trusted) also ends a drag that passed
   * the 5px drag threshold, because the long press only fires while the
   * finger stayed within its own, larger touch tolerance (finger jitter).
   */
  private endStillDrag(event: MouseEvent): void {
    if (!this.isDragging || (this.dragMoved && event.isTrusted)) return;
    this.isDragging = false;
    this.dragViewport?.classList.remove('dragging');
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
    this.dragViewport = vp;

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
    // Border violations only change opinion; they never start a war.
    const bordersChanged = this.borderService.tick(gameDeltaTime, {
      factions: this.factions,
      fleets: this.fleets,
      starSystems: this.starSystems,
    });
    const borderNotices = this.handleBorderEvents();
    const attackOrdersChanged = gameDeltaTime > 0 && this.updateAttackOrders();
    const raidOrdersChanged = gameDeltaTime > 0 && this.updateRaidOrders();
    const didMoveFleets = this.updateFleets(gameDeltaTime) || attackOrdersChanged || raidOrdersChanged;
    const headingsChanged = this.updateFleetHeadings(gameDeltaTime);
    const asteroidResult = this.asteroidService.tick(
      gameDeltaTime,
      this.fleets,
      this.factions,
      this.mapWidth,
      this.mapHeight,
    );
    const asteroidsChanged = this.updateAsteroidUi(asteroidResult, gameDeltaTime);
    const tradeResult = this.tradeNetworkService.tick(gameDeltaTime, {
      starSystems: this.starSystems,
      factions: this.factions,
      fleets: this.fleets,
    });
    const tradeChanged = this.handleTraderRaids(tradeResult.raids) || tradeResult.changed;
    const constructionChanged = this.updateStationConstruction(gameDeltaTime);
    const dysonChanged = this.updateDysonSwarm(gameDeltaTime);
    if (this.gameOutcome !== 'inProgress') {
      return;
    }
    this.gameSeconds += gameDeltaTime;
    const aiChanged = this.aiTickService.tick(gameDeltaTime, {
      fleets: this.fleets,
      factions: this.factions,
      starSystems: this.starSystems,
      shipStock: this.shipStock,
      production: this.production,
      gameSeconds: this.gameSeconds,
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
    const territoryChanged = this.refreshTerritoryViews();
    const anomaliesChanged = this.updateAnomalies();

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
      const playerDeposits = minedDepositsOf('player', this.starSystems);
      const stabilityBefore = this.playerPlanetStability();
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
      for (const deposit of playerDeposits) {
        if (deposit.isEmpty()) {
          this.showMapNotice(`Mining stopped: ${deposit.label} is depleted. Find new deposits to keep raw materials flowing.`);
        }
      }
      const stabilityLines = planetStabilityNotices(stabilityBefore, this.playerPlanetStability(), this.announcedEnergyShort);
      if (stabilityLines.length > 0) this.showMapNotice(stabilityLines.join(' '));
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

    if (
      didMoveFleets || aiChanged || economyUpdated || visibilityChanged || productionChanged || asteroidsChanged || tradeChanged ||
      diplomacyChanged || territoryChanged || bordersChanged || borderNotices || anomaliesChanged || constructionChanged || dysonChanged
    ) {
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
   * Advances every station under construction (station-construction.ts).
   * A completed base bumps the base registry revision, so territory and
   * sensors pick it up on this frame's refresh. Returns true when the view
   * must redraw: a completion, or once per second while sites progress.
   */
  private updateStationConstruction(gameDeltaTime: number): boolean {
    if (!(gameDeltaTime > 0)) return false;
    const bases = this.spaceBaseService.advanceConstruction(gameDeltaTime);
    const mines = advanceMiningStationConstruction(this.starSystems, gameDeltaTime);
    // Dyson anchors are announced by the global Dyson news (updateDysonSwarm).
    const ownBase = bases.find((b) => b.factionId === 'player' && !isDysonAnchor(b));
    const ownMine = mines.find((m) => m.asteroid.miningStation?.factionId === 'player');
    if (ownBase) {
      this.showMapNotice(`${ownBase.name} is complete: it now claims territory and senses around it.`);
    } else if (ownMine) {
      this.showMapNotice(`Mining station in the ${ownMine.system.name} belt is complete and extracting.`);
    }
    if (bases.length > 0) {
      this.refreshTerritoryViews();
      this.updateSensorVisibility(true);
    }
    if (bases.length > 0 || mines.length > 0) {
      this.constructionRedrawClock = 0;
      return true;
    }
    const building =
      this.spaceBaseService.bases.some((b) => !isStationComplete(b)) ||
      allMiningStations(this.starSystems).some(({ asteroid }) => !isStationComplete(asteroid.miningStation!));
    if (!building) return false;
    this.constructionRedrawClock += gameDeltaTime;
    if (this.constructionRedrawClock < 1) return false;
    this.constructionRedrawClock = 0;
    return true;
  }

  /*
   * Dyson Swarm per frame (docs/dyson-swarm.md): announces anchor events to
   * the player regardless of fog (global news), advances the warm-up and,
   * when it completes, decides the game. Returns true when the view must
   * redraw: an event, or once per second while a warm-up counts down.
   */
  private updateDysonSwarm(gameDeltaTime: number): boolean {
    const now = snapshotDysonAnchors(this.spaceBaseService.bases);
    const news = diffDysonAnchors(this.dysonVictoryService.anchorsSeen, now, (id) => this.spaceBaseService.takeDemolished(id));
    this.dysonVictoryService.anchorsSeen = now;
    if (news.some((e) => e.kind === 'destroyed' || e.kind === 'demolished')) {
      if (this.selectedAnchorId !== null && !this.spaceBaseService.getBase(this.selectedAnchorId)) this.selectedAnchorId = null;
    }

    const before = this.dysonVictoryService.warmup?.remaining ?? null;
    const warmupEvents = gameDeltaTime > 0 ? this.dysonVictoryService.tick(gameDeltaTime, this.starSystems) : [];
    const lines = [...this.describeDysonNewsBatch(news), ...warmupEvents.map((e) => this.describeDysonWarmup(e))];
    if (lines.length > 0) this.showMapNotice(lines.join(' '));

    if (warmupEvents.some((e) => e.kind === 'completed')) {
      this.checkGameOutcome();
      return true;
    }
    const after = this.dysonVictoryService.warmup?.remaining ?? null;
    const secondTicked = before !== null && after !== null && Math.ceil(before) !== Math.ceil(after);
    return news.length > 0 || warmupEvents.length > 0 || secondTicked;
  }

  /*
   * News lines for one frame. Several events of the same kind and faction
   * (a battle return, a long step) become one line, so the notice stays short.
   */
  private describeDysonNewsBatch(events: DysonNewsEvent[]): string[] {
    const groups = new Map<string, DysonNewsEvent[]>();
    for (const event of events) {
      const key = `${event.kind}|${event.anchor.factionId}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    const lines: string[] = [];
    for (const group of groups.values()) {
      const line = group.length === 1 ? this.describeDysonNews(group[0]) : this.describeDysonNewsGroup(group);
      if (line) lines.push(line);
    }
    return lines;
  }

  private describeDysonNewsGroup(group: DysonNewsEvent[]): string | null {
    const { kind, anchor } = group[0];
    const own = anchor.factionId === 'player';
    const who = own ? 'You' : this.getFactionName(anchor.factionId);
    const count = `${group.length} Dyson anchors`;
    switch (kind) {
      case 'started':
        return own ? null : `${who} began building ${count}.`;
      case 'completed':
        return own ? `${count} are complete: their ring wedges are now your territory.` : `${who} completed ${count}.`;
      case 'destroyed':
        return own ? `${count} of yours were destroyed.` : `${count} of ${who} were destroyed.`;
      case 'demolished':
        return own ? null : `${who} demolished ${count}.`;
    }
  }

  /*
   * One news line. The player's own deploy and demolish are skipped: their
   * buttons already show a detailed notice.
   */
  private describeDysonNews(event: DysonNewsEvent): string | null {
    const own = event.anchor.factionId === 'player';
    const who = own ? 'You' : this.getFactionName(event.anchor.factionId);
    switch (event.kind) {
      case 'started':
        return own ? null : `${who} began building ${event.anchor.name}.`;
      case 'completed':
        return own ? `${event.anchor.name} is complete: its ring wedge is now your territory.` : `${who} completed ${event.anchor.name}.`;
      case 'destroyed':
        return own ? `Your ${event.anchor.name} was destroyed.` : `${who}'s ${event.anchor.name} was destroyed.`;
      case 'demolished':
        return own ? null : `${who} demolished ${event.anchor.name}.`;
    }
  }

  private describeDysonWarmup(event: DysonWarmupEvent): string {
    const own = event.factionId === 'player';
    const who = own ? 'You' : this.getFactionName(event.factionId);
    switch (event.kind) {
      case 'started':
        return own
          ? `Your Dyson swarm is complete. Hold every anchor for ${formatWarmup(DYSON_WARMUP_SECONDS)} to win.`
          : `${who} holds the whole Dyson ring! The warm-up has started: ${formatWarmup(DYSON_WARMUP_SECONDS)} until they win.`;
      case 'cancelled':
        return own ? 'Your Dyson warm-up was interrupted.' : `${who}'s Dyson warm-up was interrupted.`;
      case 'completed':
        return own ? 'The Dyson swarm is online.' : `${who}'s Dyson swarm is online.`;
    }
  }

  /* The running warm-up as the map banner shows it; null when there is none. */
  get dysonCountdown(): { ownerName: string; color: string; own: boolean; time: string } | null {
    const warmup = this.dysonVictoryService.warmup;
    if (!warmup || warmup.remaining <= 0) return null;
    return {
      ownerName: warmup.factionId === 'player' ? 'You' : this.getFactionName(warmup.factionId),
      color: this.getFactionColor(warmup.factionId),
      own: warmup.factionId === 'player',
      time: formatWarmup(warmup.remaining),
    };
  }

  /* The faction name of a completed Dyson warm-up (the game was decided by the swarm), or null. */
  get dysonWinnerName(): string | null {
    const warmup = this.dysonVictoryService.warmup;
    if (!warmup || warmup.remaining > 0) return null;
    return warmup.factionId === 'player' ? 'You' : this.getFactionName(warmup.factionId);
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
    if (this.selectedTraderId != null) {
      this.traderPanelClock += gameDeltaTime;
      if (this.traderPanelClock >= 0.5 || !this.tradeNetworkService.getTrader(this.selectedTraderId)) {
        this.traderPanelClock = 0;
        this.refreshTraderPanel();
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
    this.surveyAsteroids();
    this.arrivalService.checkFleetPlanetArrivals({
      fleets: this.fleets,
      currentView: this.currentView,
      selectedSystem: this.selectedSystem,
      factions: this.factions,
      production: this.production,
      saveGame: () => this.saveGame(),
      enterBattleScreen: () => this.enterBattleScreen(),
    });

    const fleetBattleStarted = this.battleDetectionService.checkForBattles(
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
    const baseBattleStarted =
      !fleetBattleStarted &&
      this.battleDetectionService.checkBaseBattles(
        this.fleets,
        this.factions,
        this.enterBattleScreen.bind(this),
        this.arrivalService.triggeredBattles,
        () => {
          this.autoBattleResolved = true;
        },
      );
    if (!fleetBattleStarted && !baseBattleStarted) {
      this.battleDetectionService.checkMiningStationBattles(
        this.fleets,
        this.factions,
        this.starSystems,
        this.enterBattleScreen.bind(this),
        this.arrivalService.triggeredBattles,
        () => {
          this.autoBattleResolved = true;
        },
      );
    }

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
      // Construction sites sense nothing (station-construction.ts).
      this.spaceBaseService.completeBases,
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

  /*
   * Fleets survey the in-system asteroid they stand on (any view: fleets
   * keep moving inside systems while the player looks elsewhere). AI
   * factions survey by the same rule (EnemyMiningService flies their outpost
   * fleets over belts). Only the player's found deposits are announced;
   * barren rocks are marked silently.
   */
  private surveyAsteroids(): void {
    const aiIds = new Set(getAiFactionIds(this.factions));
    const surveyed = surveySystemAsteroids(this.fleets, this.starSystems, 'player', (id) => id === 'player' || aiIds.has(id));
    for (const { fleet, system, asteroid } of surveyed) {
      if (fleet.factionId === 'player' && asteroid.rawMaterials > 0) {
        this.showMapNotice(
          `${fleet.name} found a raw material deposit in the ${system.name} asteroid belt: ` +
            `${asteroid.rawMaterials.toLocaleString('en-US')} raw materials.`,
        );
      }
    }
  }

  /*
   * Exploration anomalies, once per frame after sensors: discovery from the
   * explored cells, activation by arriving player fleets (AI fleets never
   * trigger them), then the event dialog follows the oldest pending event.
   * A state change is saved at once, like asteroid collections, so a
   * battle-return reload can never bring a triggered event back.
   */
  private updateAnomalies(): boolean {
    const changed = this.anomalyService.update(this.exploredGridCells, this.fleets);
    const dialogChanged = this.syncAnomalyEvent();
    if (changed) {
      this.saveGame();
    }
    return changed || dialogChanged;
  }

  private anomalyContext(): AnomalyContext {
    return { factions: this.factions, fleets: this.fleets, starSystems: this.starSystems, shipStock: this.shipStock };
  }

  /* Opens, switches or closes the event dialog to match the pending events. */
  private syncAnomalyEvent(): boolean {
    const pending = this.anomalyService.currentEvent();
    if (!pending) {
      if (!this.anomalyEvent) return false;
      this.closeAnomalyEvent();
      return true;
    }
    if (this.anomalyEvent?.anomalyId === pending.id) return false;
    if (!this.anomalyEvent) {
      this.anomalyResumeOnClose = !this.gameTimeService.isPaused;
      this.gameTimeService.pause();
    }
    this.anomalyEvent = this.anomalyService.buildEventVm(pending, this.anomalyContext());
    this.anomalyError = null;
    return true;
  }

  private closeAnomalyEvent(): void {
    this.anomalyEvent = null;
    this.anomalyError = null;
    if (this.anomalyResumeOnClose) {
      this.gameTimeService.resume();
    }
    this.anomalyResumeOnClose = false;
  }

  /*
   * The player's choice in the event dialog. AnomalyService validates it
   * (still pending, affordable) and resolves the anomaly; a pirate ambush
   * then starts through the normal fleet-battle transport.
   */
  onAnomalyChoice(choiceId: string): void {
    const event = this.anomalyEvent;
    if (!event) return;
    const result = this.anomalyService.resolve(event.anomalyId, choiceId, this.anomalyContext());
    if (!result.ok) {
      // Keep the dialog on the same event with the reason; if the event is
      // gone, fall through to whatever is pending next.
      const pending = this.anomalyService.getAnomaly(event.anomalyId);
      if (pending?.status === 'active') {
        this.anomalyEvent = this.anomalyService.buildEventVm(pending, this.anomalyContext());
        this.anomalyError = result.reason;
      } else {
        this.syncAnomalyEvent();
      }
      this.cdr.detectChanges();
      return;
    }
    if (result.battle) {
      // The battle screen owns time from here; loadGame resets it on return.
      this.anomalyEvent = null;
      this.anomalyError = null;
      this.anomalyResumeOnClose = false;
      this.battleService.setBattle(result.battle);
      this.enterBattleScreen();
      return;
    }
    this.showMapNotice(result.message);
    // Switches to the next pending event, or closes the dialog (and resumes).
    this.syncAnomalyEvent();
    this.saveGame();
    this.cdr.detectChanges();
  }

  /* Discovered, unvisited anomalies on the galaxy map (type unknown until visited). */
  get anomalyMarkers(): AnomalyMapView[] {
    return this.anomalyService.discoveredAnomalies().map((anomaly) => {
      const inSystem = anomaly.site.kind !== 'space';
      // System and asteroid sites sit at the corner of the star's cell so
      // the marker does not hide the star.
      const offset = inSystem ? 0.45 : 0;
      return {
        id: anomaly.id,
        left: (anomaly.site.x - 0.5 + offset) * this.cellSizeVw,
        top: (anomaly.site.y - 0.5 - offset) * this.cellSizeVh,
        inSystem,
        title: `Unidentified anomaly: ${this.anomalyService.locationLabel(anomaly, this.starSystems)}. Send a fleet to investigate.`,
      };
    });
  }

  /* Discovered asteroid anomalies of the open system (system view markers). */
  get systemAnomalyCells(): AnomalyCellView[] {
    const systemId = this.selectedSystem?.id;
    if (!systemId) return [];
    return this.anomalyService
      .discoveredAnomalies()
      .filter((a) => a.site.kind === 'asteroid' && a.site.systemId === systemId)
      .map((a) => ({
        id: a.id,
        col: a.site.col ?? 0,
        row: a.site.row ?? 0,
        title: 'Unidentified anomaly: move a fleet onto this asteroid to investigate.',
      }));
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

        // Footprint center in cell coordinates (cell N's center is N).
        const center = this.movementService.getPlanetCellCenter(planet);
        const centerCol = center.x / StarMapMovementService.systemCellSizeVw + 0.5;
        const centerRow = center.y / StarMapMovementService.systemCellSizeVw + 0.5;
        const inFull = this.sensorService.isPlanetInRange(
          centerCol,
          centerRow,
          fleet.system.x,
          fleet.system.y,
          range,
        );
        const inPreview = this.sensorService.isPlanetInPreviewRange(
          centerCol,
          centerRow,
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

  /** Header time control: set simulation speed (1x or 3x) and un-pause. */
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
      gameVersion: GAME_VERSION,
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
      spaceBases: this.spaceBaseService.serialize(),
      dysonWarmup: this.dysonVictoryService.serialize(),
      diplomaticDemands: this.diplomacyService.serializeDemands(),
      anomalies: this.anomalyService.serialize(),
      tradeNetwork: this.tradeNetworkService.serialize(),
      gameSeconds: this.gameSeconds,
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
    // against the new galaxy. Nebulae come from the save; they are never
    // regenerated here.
    this.nebulae = data.nebulae ?? [];
    this.asteroidBelts = data.asteroidBelts ?? [];
    this.terrainService.configure({
      specialObjects: this.specialObjects,
      nebulae: this.nebulae,
      asteroidBelts: this.asteroidBelts,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    // The Dyson ring is derived from the black hole on every load (never saved).
    this.dysonRingService.configure(this.specialObjects);
    this.rebuildTerrainViews();
    this.asteroidService.restore(data.asteroidEvents, this.galaxy?.seed ?? 0, this.fleets);
    this.anomalyService.restore(data.anomalies, {
      seed: this.galaxy?.seed ?? 0,
      width: this.mapWidth,
      height: this.mapHeight,
      starSystems: this.starSystems,
      factions: this.factions,
      fleets: this.fleets,
      specialObjects: this.specialObjects,
      asteroidBelts: this.asteroidBelts,
    });
    this.tradeNetworkService.restore(data.tradeNetwork, this.galaxy?.seed ?? 0, this.starSystems);
    this.gameSeconds = Number.isFinite(data.gameSeconds) ? Math.max(0, data.gameSeconds!) : 0;
    // A pending event re-opens from the restored state on the next frame.
    this.anomalyEvent = null;
    this.anomalyError = null;
    this.anomalyResumeOnClose = false;
    // Bases before sensors and territory: both are derived from them.
    this.spaceBaseService.restore(data.spaceBases);
    this.dysonVictoryService.restore(data.dysonWarmup);
    // A fresh load starts the news from what is there; a battle return
    // compares with the pre-battle anchors (see dysonAnchorsSeen).
    if (!options.resumeAi) {
      this.dysonVictoryService.anchorsSeen = snapshotDysonAnchors(this.spaceBaseService.bases);
    }
    this.borderService.reset();
    this.renderedTerritory = null;
    this.selectedAsteroidId = null;
    this.asteroidPanelVm = null;
    this.asteroidPanelMessage = null;
    this.selectedTraderId = null;
    this.traderPanelVm = null;
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

    // Saves reach this point normalized by SaveGameService.normalizeSave.
    // Here we only renormalize values that depend on the current building set.
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
    this.refreshTerritoryViews();

    // Terrain first: deposit generation avoids blocked surface cells.
    this.ensurePlanetSurfaces();
    // Ensure every planet has deterministic resource deposit tiles
    this.ensureResourceTiles();
    // Owned planets from saves before colony cores get their Colony Center.
    this.ensureColonyCores();

    // Un-pause and clear elapsed time on every load; the chosen speed is
    // kept for the session (also across battles, which reload the autosave).
    this.gameTimeService.reset();

    if (options.resumeAi) {
      this.aiTickService.resumeAfterBattle();
    } else {
      this.aiTickService.resetAiPipeline();
    }
    // Open demands come from the save on every load (after the reset
    // above), so a reload can never skip or replay an ultimatum.
    this.diplomacyService.restoreDemands(data.diplomaticDemands, this.factions);

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
      // Pirate ambush (exploration anomaly): victory loot, paid exactly once
      // because the battle result is consumed (cleared) right below.
      const anomalyNotice = this.anomalyService.applyBattleOutcome(battleResult, this.factions);
      if (anomalyNotice) this.showMapNotice(anomalyNotice);
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
    if (this.fleetManagerFleets || this.anomalyEvent) return;

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
      case '3':
        event.preventDefault();
        this.gameTimeService.setSpeed(3);
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

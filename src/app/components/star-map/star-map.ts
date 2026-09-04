import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { SaveGameService } from '../../services/save-game.service';
import { EconomyService } from '../../services/economy.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { ShipStockService } from '../../services/ship-stock.service';
import { ProductionService } from '../../services/production.service';
import { SpaceportService } from '../../services/spaceport.service';
import { FleetAssemblyService } from '../../services/fleet-assembly.service';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';
import { StarMapPauseComponent } from '../star-map-pause/star-map-pause.component';
import starMapData from './star-map-data.json';
import shipData from './ship-data.json';
import planetData from './planet-data.json';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
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
  StarSystem,
  PlanetTile,
  ShipType,
  FleetShipTypeSummary,
  ContextMenuItem,
  PLANET_SIZE_MAP,
  PLANET_TYPE_COLORS,
  PlanetEconomyEntry,
} from './star-map.models';

import { EconomyBreakdown } from '../../services/economy.service';

import { StarMapFleetInfoComponent } from './star-map-fleet-info/star-map-fleet-info.component';
import { StarMapSystemInfoComponent } from './star-map-system-info/star-map-system-info.component';
import { StarMapPlanetInfoComponent } from './star-map-planet-info/star-map-planet-info.component';
import { StarMapPlanetScreenComponent } from './star-map-planet-screen/star-map-planet-screen.component';
import { StarMapFleetButtonsComponent } from './star-map-fleet-buttons/star-map-fleet-buttons.component';
import { StarMapContextMenuComponent } from './star-map-context-menu/star-map-context-menu.component';
import { FactionCurrenciesComponent } from './faction-currencies/faction-currencies.component';
import { StarMapShipStockComponent, ShipStockEntryDisplay } from './star-map-ship-stock/star-map-ship-stock.component';
import { StarMapProductionPanelComponent, ProductionPanelViewModel, QueueOrderRequest } from './star-map-production-panel/star-map-production-panel.component';
import { StarMapSpaceportPanelComponent, SpaceportPanelViewModel } from './star-map-spaceport-panel/star-map-spaceport-panel.component';

export type { StarMapData } from './star-map.models';

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
    StarMapPauseComponent,
    StarMapNavigationComponent,
    StarMapFleetInfoComponent,
    StarMapSystemInfoComponent,
    StarMapPlanetInfoComponent,
    StarMapPlanetScreenComponent,
    StarMapFleetButtonsComponent,
    StarMapContextMenuComponent,
    FactionCurrenciesComponent,
    StarMapShipStockComponent,
    StarMapProductionPanelComponent,
    StarMapSpaceportPanelComponent,
    NgClass,
  ],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {
  currentView: 'map' | 'system' | 'planet' = 'map';

  pauseMenuOpen = false;

  // Map configuration
  readonly mapWidth = initialStarMapData.map.width;
  readonly mapHeight = initialStarMapData.map.height;
  cellSizeVw = initialStarMapData.map.cellSizeVw;
  cellSizeVh = initialStarMapData.map.cellSizeVh;
  private readonly gridBreakpointPx = 1300;

  // Game state
  starSystems: StarSystem[] = initialStarMapData.starSystems;
  fleets: Fleet[] = initialStarMapData.fleets;
  factions: StarMapData['factions'] = initialStarMapData.factions;
  shipStock: import('./star-map.models').FactionShipStock[] = initialStarMapData.shipStock ?? [];
  production: import('./star-map.models').FactionProduction[] = initialStarMapData.production ?? [];

  // Track which fleet is currently on which planet grid cell to log arrivals
  private fleetPlanetMap = new Map<number, number>();
  private routerSubscription = new Subscription();
  // Selection state
  selectedSystem: StarSystem | null = null;
  selectedFleet: Fleet | null = null;
  selectedPlanetTile: PlanetTile | null = null;
  selectedFleetAction: 'move' | null = null;

  // Camera state
  cameraX = 0;
  cameraY = 0;
  readonly cameraSpeed = 2;

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
  isPaused = false;

  // Production / spaceport panel state
  showProductionPanel = false;
  showBuildMenu = false;
  productionBuildError: string | null = null;
  showSpaceportPanel = false;
  spaceportError: string | null = null;
  spaceportFleetName = 'New Fleet';
  spaceportMode: 'create' | 'reinforce' = 'create';
  spaceportTargetFleetId: number | null = null;

  isLandscape = false;

  // Event handlers for focus tracking
  private onWindowBlur = (): void => this.pauseGame();
  private onVisibilityChange = (): void => {
    if (document.hidden) this.pauseGame();
  };

  // Ship types
  readonly shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes;
  private readonly shipTypeById: Map<string, ShipType> = new Map(
    this.shipTypes.map((type) => [type.id, type] as [string, ShipType]),
  );

  // Battle tracking
  private triggeredBattles = new Set<string>();

  private economyAccumulator = 0;
  private readonly economyTickInterval = 1;
  private cachedPlayerEconomyBreakdown: EconomyBreakdown | null = null;

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
    public movementService: StarMapMovementService,
    private battleDetectionService: StarMapBattleDetectionService,
    private sensorService: StarMapSensorService,
    private shipStockService: ShipStockService,
    private productionService: ProductionService,
    public spaceportService: SpaceportService,
    private fleetAssemblyService: FleetAssemblyService,
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
        if (event.url === '/star-map' || event.urlAfterRedirects === '/star-map') {
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
    if (fleet.factionId === 'player') {
      return true;
    }
    if (this.currentView === 'system' && this.selectedSystem && fleet.system?.id === this.selectedSystem.id) {
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

    const viewportWidthVw = 100;
    const viewportHeightVw = (window.innerHeight / window.innerWidth) * 100;
    const cells = this.sensorService.getViewportCells(
      this.cameraX,
      this.cameraY,
      viewportWidthVw,
      viewportHeightVw,
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
  get systemSensorCells(): { cells: { col: number; row: number }[]; preview: { col: number; row: number }[] } {
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
    this.pauseGame();
  }

  /** Closes the pause menu and resumes the game loop. */
  closePauseMenu(): void {
    this.pauseMenuOpen = false;
    this.resumeGame();
  }

  /** Saves the current game state, selecting an empty slot if none is active. */
  saveFromMenu(): void {
    if (this.saveGameService.currentSlot === null) {
      const slots = this.saveGameService.getSlots();
      const emptyIndex = slots.findIndex((slot) => !slot.data);
      this.saveGameService.currentSlot = emptyIndex >= 0 ? emptyIndex : 0;
    }
    this.saveGame();
  }

  /** Loads a save game from the specified slot index. */
  loadFromMenu(slotIndex: number): void {
    this.saveGameService.currentSlot = slotIndex;
    this.loadGame();
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

      for (const fleet of this.fleets) {
        if (fleet.destroyed) {
          continue;
        }

        if (this.movementService.isFleetInSystem(fleet, this.selectedSystem)) {
          if (!fleet.system) {
            fleet.system = {
              id: this.selectedSystem.id,
              x: 2.5,
              y: 32.5,
              targetX: null,
              targetY: null,
            };
          } else {
            fleet.system.id = this.selectedSystem.id;
          }
          const sysCell = this.movementService.calculateSystemGridCell(
            fleet.system.x,
            fleet.system.y,
          );
          fleet.gridCol = sysCell.col;
          fleet.gridRow = sysCell.row;
        }
      }

      if (this.selectedFleet && this.selectedFleet.system?.targetX != null) {
        this.targetX = this.selectedFleet.system.targetX ?? null;
        this.targetY = this.selectedFleet.system.targetY ?? null;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    }
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
    if (!this.factions) {
      return '#ffffff';
    }
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.color : '#ffffff';
  }

  /** Returns the display name of a faction by its ID. */
  getFactionName(factionId: string): string {
    if (!this.factions) {
      return 'Unknown';
    }
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.name : 'Unknown';
  }

  /** Returns the player's currencies as key-value pairs. */
  getPlayerCurrencies(): { name: string; value: number }[] {
    const player = this.factions.find((f) => f.id === 'player');
    if (!player?.currencies) {
      return [];
    }
    return Object.entries(player.currencies).map(([name, value]) => ({ name, value }));
  }

  /** Returns the player's current credit balance. */
  getPlayerCredits(): number {
    const player = this.factions.find((f) => f.id === 'player');
    return player?.currencies?.['credits'] ?? 0;
  }

  /** Handles selection of a building type from the planet build menu. */
  onSelectBuildingType(buildingId: string): void {
    console.log('[StarMap] Building type selected:', buildingId);
  }

  /** Handles confirmation of a building placement from the planet screen. */
  onBuildingConfirmed(event: { buildingId: string; x: number; y: number }): void {
    const planet = this.selectedPlanetTile;
    if (!planet) return;

    const player = this.factions.find((f) => f.id === 'player');
    if (!player?.currencies) return;

    const buildingDef = (
      planetData as { buildings: { id: string; price: number; size: number; name: string }[] }
    ).buildings.find((b) => b.id === event.buildingId);
    if (!buildingDef) return;

    const credits = player.currencies['credits'] ?? 0;
    if (credits < buildingDef.price) return;

    player.currencies['credits'] = credits - buildingDef.price;

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
    if (!this.selectedPlanetTile || !this.selectedSystem) {
      return null;
    }
    const buildable = this.productionService.listBuildableShipTypes(this.selectedPlanetTile);
    const queue = this.productionService.getQueue(this, 'player', this.selectedPlanetTile.id);
    const etas: Record<number, number | null> = {};
    for (const order of queue) {
      etas[order.id] = this.productionService.getOrderEta(order, this.selectedPlanetTile);
    }
    const shipCosts: Record<string, number> = {};
    const shipBuildTimes: Record<string, number> = {};
    for (const t of buildable) {
      shipCosts[t.id] = t.cost;
      shipBuildTimes[t.id] = t.buildTime ?? Math.max(1, t.cost * 0.1);
    }
    return {
      planet: this.selectedPlanetTile,
      system: this.selectedSystem,
      factionId: 'player',
      buildable,
      capacity: this.productionService.getPlanetCapacity(this.selectedPlanetTile),
      power: this.productionService.getPlanetPower(this.selectedPlanetTile),
      queue,
      shipCosts,
      shipBuildTimes,
      etas,
      factionCredits: this.getPlayerCredits(),
    };
  }

  getSpaceportPanelVm(): SpaceportPanelViewModel | null {
    if (!this.selectedPlanetTile || !this.selectedSystem) {
      return null;
    }
    if (!this.spaceportService.isSpaceportPlanet(this.selectedPlanetTile)) {
      return null;
    }
    const assemblySystems = this.spaceportService
      .listSpaceports('player', this.starSystems)
      .map((loc) => ({
        systemId: loc.system.id,
        systemName: loc.system.name,
        planets: loc.system.planetsTiles
          .filter((p) => p.factionId === 'player' && this.spaceportService.isSpaceportPlanet(p))
          .map((p) => ({ id: p.id, name: p.name })),
      }));
    const summary = this.shipStockService.getSummary(this, 'player');
    const available = summary
      .map((entry) => {
        const type = this.shipService.getShipType(entry.typeId);
        return { typeId: entry.typeId, typeName: type?.name ?? entry.typeId, available: entry.count };
      })
      .sort((a, b) => a.typeName.localeCompare(b.typeName));
    return {
      system: this.selectedSystem,
      planet: this.selectedPlanetTile,
      factionId: 'player',
      available,
      selectedSystemId: this.selectedSystem.id,
      selectedPlanetId: this.selectedPlanetTile.id,
      assemblySystems,
      errorMessage: this.spaceportError,
    };
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
    this.productionService.cancelOrder(this, 'player', this.selectedPlanetTile.id, orderId, this.factions);
    this.saveGame();
  }

  private describeProductionError(reason: string | undefined): string {
    switch (reason) {
      case 'no_factory': return 'No factory on this planet.';
      case 'insufficient_resources': return 'Not enough credits.';
      case 'invalid_type': return 'Invalid ship type.';
      case 'invalid_quantity': return 'Invalid quantity.';
      default: return 'Could not queue order.';
    }
  }

  openSpaceportPanel(mode: 'create' | 'reinforce' = 'create', fleetId: number | null = null): void {
    if (!this.spaceportService.hasSpaceport('player', this.starSystems)) {
      this.spaceportError = 'You need a Spaceport to assemble fleets.';
      return;
    }
    this.spaceportMode = mode;
    this.spaceportTargetFleetId = fleetId;
    this.spaceportFleetName = mode === 'create' ? this.suggestFleetName() : (this.fleets.find((f) => f.id === fleetId)?.name ?? 'New Fleet');
    this.spaceportError = null;
    this.showSpaceportPanel = true;
  }

  closeSpaceportPanel(): void {
    this.showSpaceportPanel = false;
    this.spaceportError = null;
  }

  onSpaceportConfirm(event: { fleetName: string; composition: { typeId: string; count: number }[]; systemId: string; planetId: number; fleetId: number | null }): void {
    if (event.fleetId != null) {
      const result = this.fleetAssemblyService.reinforceFleet(
        this,
        this.starSystems,
        {
          factionId: 'player',
          fleetId: event.fleetId,
          composition: event.composition,
        },
      );
      if (!result.ok) {
        this.spaceportError = this.describeAssemblyError(result.reason);
        return;
      }
    } else {
      const result = this.fleetAssemblyService.createFleet(
        this,
        this.starSystems,
        {
          factionId: 'player',
          fleetName: event.fleetName,
          systemId: event.systemId,
          planetId: event.planetId,
          composition: event.composition,
        },
      );
      if (!result.ok) {
        this.spaceportError = this.describeAssemblyError(result.reason);
        return;
      }
      if (result.fleet) {
        // Place the new fleet on its host planet's system cell and
        // transition into the system view via `enterSystem()` so the
        // fleet-init loop runs. The loop normalises every active
        // fleet's `gridCol` / `gridRow` from `fleet.system.{x,y}` —
        // skipping it is what was leaving the sun, planets, and
        // fleets invisible until the player manually re-entered the
        // system.
        const hostSystem = this.starSystems.find((s) => s.id === event.systemId);
        if (hostSystem) {
          this.selectSystem(hostSystem);
        }
        this.selectFleet(result.fleet);
        this.enterSystem();
      }
    }
    this.spaceportError = null;
    this.showSpaceportPanel = false;
    this.saveGame();
  }

  onSpaceportDisband(): void {
    const fleetId = this.spaceportTargetFleetId;
    if (fleetId == null) {
      return;
    }
    const fleet = this.fleets.find((f) => f.id === fleetId);
    if (!fleet) {
      return;
    }
    const ok = window.confirm(`Disband ${fleet.name}? Surviving ships return to the global stock.`);
    if (!ok) {
      return;
    }
    this.fleetAssemblyService.disbandFleet(this, 'player', fleetId);
    if (this.selectedFleet?.id === fleetId) {
      this.deselectFleet();
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

  onReinforceSelected(): void {
    if (!this.selectedFleet) {
      return;
    }
    this.openSpaceportPanel('reinforce', this.selectedFleet.id);
  }

  onDisbandSelected(): void {
    if (!this.selectedFleet) {
      return;
    }
    const ok = window.confirm(`Disband ${this.selectedFleet.name}? Surviving ships return to the global stock.`);
    if (!ok) {
      return;
    }
    this.disbandSelectedFleet();
  }

  hasSpaceport(): boolean {
    return this.spaceportService.hasSpaceport('player', this.starSystems);
  }

  private describeAssemblyError(reason: string | undefined): string {
    switch (reason) {
      case 'no_spaceport': return 'No Spaceport available.';
      case 'insufficient_stock': return 'Not enough ships in stock.';
      case 'invalid_composition': return 'Select at least one ship.';
      case 'invalid_target': return 'Invalid assembly point.';
      case 'fleet_not_found': return 'Fleet not found.';
      case 'enemy_fleet': return 'Cannot modify an enemy fleet.';
      default: return 'Assembly failed.';
    }
  }

  private suggestFleetName(): string {
    const used = new Set(this.fleets.filter((f) => f.factionId === 'player').map((f) => f.name));
    for (let i = 1; i < 1000; i++) {
      const name = `${i}${this.ordinalSuffix(i)} Fleet`;
      if (!used.has(name)) {
        return name;
      }
    }
    return 'New Fleet';
  }

  private ordinalSuffix(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  /** Returns a faction's currencies as key-value pairs. */
  getFactionCurrencies(factionId: string): { name: string; value: number }[] {
    const faction = this.factions.find((f) => f.id === factionId);
    if (!faction?.currencies) {
      return [];
    }
    return Object.entries(faction.currencies).map(([name, value]) => ({ name, value }));
  }

  // Bound versions for child component inputs to preserve `this` context
  readonly boundGetFactionColor = this.getFactionColor.bind(this);
  readonly boundGetFactionName = this.getFactionName.bind(this);
  readonly boundGetFactionCurrencies = this.getFactionCurrencies.bind(this);
  readonly boundGetPlayerEconomyBreakdown = this.getPlayerEconomyBreakdown.bind(this);
  readonly boundGetPlanetColor = this.getPlanetColor.bind(this);
  readonly boundGetPlayerCredits = this.getPlayerCredits.bind(this);
  readonly boundOnSelectBuildingType = this.onSelectBuildingType.bind(this);
  readonly boundOnConfirmBuild = (buildingId: string, x: number, y: number) =>
    this.onBuildingConfirmed({ buildingId, x, y });
  readonly boundGetPlanetEconomy = this.getPlanetEconomy.bind(this);
  readonly boundGetEnergyForPlanet = this.getEnergyForPlanet.bind(this);
  readonly boundGetTaxForPlanet = this.getTaxForPlanet.bind(this);
  readonly boundGetPlayerShipStockEntries = this.getPlayerShipStockEntries.bind(this);
  readonly boundGetPlayerShipStockTotal = this.getPlayerShipStockTotal.bind(this);
  readonly boundGetProductionPanelVm = this.getProductionPanelVm.bind(this);
  readonly boundGetSpaceportPanelVm = this.getSpaceportPanelVm.bind(this);

  // Ship type helpers

  /** Looks up a ship type definition by its ID. */
  getShipType(typeId: string): ShipType | undefined {
    return this.shipTypeById.get(typeId);
  }

  /** Builds a summary of ship types and counts present in a fleet. */
  getFleetShipTypeSummary(fleet: Fleet): FleetShipTypeSummary[] {
    const counts = new Map<string, number>();
    for (const ship of fleet.ships) {
      counts.set(ship.type, (counts.get(ship.type) || 0) + 1);
    }

    const summary: FleetShipTypeSummary[] = [];
    for (const [typeId, count] of counts) {
      const type = this.getShipType(typeId);
      if (type) {
        summary.push({
          typeId,
          typeName: type.name,
          count,
          attack: type.attack,
          defense: type.defense,
        });
      }
    }
    return summary;
  }

  /** Calculates the total attack value of all ships in a fleet. */
  getFleetTotalAttack(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => sum + (this.getShipType(ship.type)?.attack ?? 0), 0);
  }

  /** Calculates the total defense value of all ships in a fleet. */
  getFleetTotalDefense(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => sum + (this.getShipType(ship.type)?.defense ?? 0), 0);
  }

  /** Computes energy production for a planet based on its power-producing buildings. */
  getEnergyForPlanet(planet: PlanetTile): number {
    return this.economyService.getPlanetEnergy(planet);
  }

  /** Computes tax income for a planet based on population and industrial buildings. */
  getTaxForPlanet(planet: PlanetTile): number {
    return this.economyService.getPlanetTax(planet);
  }

  /** Returns the economy breakdown for a planet. */
  getPlanetEconomy(planet: PlanetTile): PlanetEconomyEntry {
    return this.economyService.getPlanetEconomyBreakdown(planet);
  }

  /** Returns the CSS class names to apply to a planet tile for styling. */
  getPlanetClassNames(planet: PlanetTile): string[] {
    return [
      planet.type,
      planet.size,
      planet.size ? `planet-size-${planet.size}` : undefined,
    ].filter((className): className is string => Boolean(className));
  }

  /** Maps a planet's string size to a numeric size (1-4) for grid calculations. */
  getPlanetNumericSize(planet: PlanetTile): number {
    return PLANET_SIZE_MAP[planet.size] ?? 3;
  }

  /**
   * Returns the grid dimension (side length) for a planet's surface grid.
   * Formula: size * 2 + 3, so size 1 -> 5, size 2 -> 7, size 3 -> 9, size 4 -> 11.
   */
  getPlanetGridSize(planet: PlanetTile): number {
    const numericSize = this.getPlanetNumericSize(planet);
    return numericSize * 2 + 3;
  }

  /** Returns the representative color for a planet based on its type. */
  getPlanetColor(planet: PlanetTile): string {
    return PLANET_TYPE_COLORS[planet.type] ?? '#ffffff';
  }

  // Selection handlers

  /** Selects a fleet, updates the camera, and tracks its movement target. */
  selectFleet(fleet: Fleet): void {
    this.selectedFleet = fleet;

    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
    this.selectedPlanetTile = null;

    if (this.currentView === 'map') {
      this.cameraX = (fleet.x - 0.5) * this.cellSizeVw - 50;
      this.cameraY = (fleet.y - 0.5) * this.cellSizeVh - 50;
      this.clampCamera();
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
      console.log('[StarMap] selectPlanetTile: closing window from', this.selectedPlanetTile.name, '-> switching to', tile.name);
      this.selectedPlanetTile = null;
      this.cdr.detectChanges();
    }

    this.selectedPlanetTile = tile;
    console.log('[StarMap] selectPlanetTile:', tile.name);
    console.log('[StarMap] selectedPlanetTile set:', this.selectedPlanetTile.name);

    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
    try {
      this.cdr.detectChanges();
      console.log('[StarMap] detectChanges succeeded');
    } catch (e) {
      console.error('[StarMap] detectChanges failed:', e);
    }
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
      console.log(planet);

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
        console.log(items[0]);
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
  private validateFleetMove(targetX: number, targetY: number): 'allowed' | 'blocked-team' | 'blocked-ours' {
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

      if (planetFaction.team === playerFaction.team && planet.factionId !== 'player') {
        return 'blocked-team';
      }

      if (planet.factionId === 'player') {
        const fleetOnPlanet = this.getFleetOnPlanet(planet);
        if (fleetOnPlanet) {
          return 'blocked-ours';
        }
        return 'allowed';
      }

      return 'allowed';
    }

    return 'allowed';
  }

  /** Returns a garrisoned fleet on the given planet that belongs to the planet's owner faction. */
  private getFleetOnPlanet(planet: PlanetTile): Fleet | null {
    if (!this.selectedSystem) return null;

    for (const fleet of this.fleets) {
      if (fleet.destroyed || fleet.system?.id !== this.selectedSystem.id) continue;
      if (fleet.factionId !== planet.factionId) continue;
      if (fleet.system.targetX != null || fleet.system.targetY != null) continue;

      const fleetCell = this.movementService.calculateSystemGridCell(
        fleet.system.x,
        fleet.system.y,
      );
      const planetCell = this.movementService.getPlanetGridPosition(planet);
      if (fleetCell.col === planetCell.col && fleetCell.row === planetCell.row) {
        return fleet;
      }
    }
    return null;
  }

  /** Commands the selected fleet to move to the given world coordinates. */
  moveSelectedFleet(x: number, y: number): void {
    if (!this.selectedFleet) {
      return;
    }

    const validation = this.validateFleetMove(x, y);
    if (validation === 'blocked-team') {
      console.log('[StarMap] Cannot move fleet to teammate planet');
      return;
    }
    if (validation === 'blocked-ours') {
      console.log('[StarMap] Cannot move fleet to own planet with existing fleet');
      return;
    }

    if (this.currentView === 'system') {
      if (this.selectedSystem && this.selectedFleet.system?.id === this.selectedSystem.id) {
        this.selectedFleet.system.targetX = x;
        this.selectedFleet.system.targetY = y;
        this.targetX = x;
        this.targetY = y;
      }
    } else {
      this.selectedFleet.targetX = x;
      this.selectedFleet.targetY = y;
      this.targetX = x;
      this.targetY = y;
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

    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    const viewportUnitInPixels = window.innerWidth / 100;
    const worldX = this.cameraX + screenX / viewportUnitInPixels;
    const worldY = this.cameraY + screenY / viewportUnitInPixels;

    const targetTile = this.movementService.getTileCenter(worldX, worldY);
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

    const viewport = event.currentTarget as HTMLElement;
    const rect = viewport.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    const viewportUnitInPixels = window.innerWidth / 100;
    const systemX = screenX / viewportUnitInPixels;
    const systemY = screenY / viewportUnitInPixels;

    const targetTile = this.movementService.getSystemTileCenter(systemX, systemY);
    this.moveSelectedFleet(targetTile.x, targetTile.y);
  }

  // Camera

  /** Viewport height in vw units, derived from the current window aspect ratio. */
  get viewportHeightVw(): number {
    return (window.innerHeight / window.innerWidth) * 100;
  }

  /** Sets the camera to an absolute position and clamps it within bounds. */
  setCamera(pos: { x: number; y: number }): void {
    this.cameraX = pos.x;
    this.cameraY = pos.y;
    this.clampCamera();
  }

  /** Pans the camera in the specified direction and clamps it within bounds. */
  moveCamera(direction: 'up' | 'down' | 'left' | 'right'): void {
    switch (direction) {
      case 'up':
        this.cameraY -= this.cameraSpeed;
        break;
      case 'down':
        this.cameraY += this.cameraSpeed;
        break;
      case 'left':
        this.cameraX -= this.cameraSpeed;
        break;
      case 'right':
        this.cameraX += this.cameraSpeed;
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
   */
  private clampCamera(): void {
    const gridWidthVw = this.movementService.gridColumns * this.cellSizeVw;
    const gridHeightVw = this.movementService.gridRows * this.cellSizeVh;
    const viewportWidthVw = 100;
    const viewportHeightVw = (window.innerHeight / window.innerWidth) * 100;

    const maxCameraX = Math.max(0, gridWidthVw - viewportWidthVw);
    const maxCameraY = Math.max(0, gridHeightVw - viewportHeightVw);

    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCameraX));
    this.cameraY = Math.max(0, Math.min(this.cameraY, maxCameraY));
  }

  /** Pointer down on the map viewport — begins drag tracking (empty areas only). */
  onPointerDown(event: PointerEvent): void {
    if (this.contextMenu) {
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
    this.cameraX = this.dragCameraStartX - deltaX / viewportUnitInPixels;
    this.cameraY = this.dragCameraStartY - deltaY / viewportUnitInPixels;
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
    console.log('[StarMap] ngAfterViewInit, starting game loop');
    this.startGameLoop();
    this.setupFocusHandlers();
    window.addEventListener('orientationchange', this.onOrientationChange);
    this.checkOrientation();
  }

  /** Registers the game loop tick callback with the game loop service. */
  private startGameLoop(): void {
    console.log('[StarMap] startGameLoop called');
    this.gameLoopService.startGameLoop((deltaTime: number) => {
      const didMoveFleets = this.updateFleets(deltaTime);
      const visibilityChanged = this.updateSensorVisibility();

      const productionResult = this.productionService.tick(
        deltaTime,
        this,
        this.starSystems,
        this.fleets,
        this.factions,
      );
      const productionChanged = productionResult.stateChanged;

      this.economyAccumulator += deltaTime;
      let economyUpdated = false;
      if (this.economyAccumulator >= this.economyTickInterval) {
        for (const faction of this.factions) {
          this.economyService.applyEconomyDelta(
            faction.id,
            this.factions,
            this.starSystems,
            this.fleets,
            this.economyAccumulator,
          );
        }
        this.cachedPlayerEconomyBreakdown = this.economyService.calculateEconomy(
          'player',
          this.factions,
          this.starSystems,
          this.fleets,
        );
        this.economyAccumulator = 0;
        economyUpdated = true;
      }

      if (didMoveFleets || economyUpdated || visibilityChanged || productionChanged) {
        this.ngZone.run(() => this.cdr.detectChanges());
      }
    });
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
        console.log('[StarMap] Target reached for fleet', fleetId);
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
    );

    if (didMoveFleets) {
      console.log('[StarMap] movementService.updateFleets returned true');
    }

    this.updateExploredPlanets();
    this.checkFleetPlanetArrivals();

    this.battleDetectionService.checkForBattles(
      this.fleets,
      this.factions,
      (x, y) => this.movementService.calculateGridCell(x, y),
      (fleet, system) => this.movementService.isFleetInSystem(fleet, system),
      this.starSystems,
      () => this.saveGame(),
      () => this.ngZone.run(() => this.router.navigate(['/battle'])),
      this.triggeredBattles,
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

    const changed = force ||
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

  /** Checks if any fleet arrived at a planet's grid cell and handles the interaction. */
  private checkFleetPlanetArrivals(): void {
    if (this.currentView !== 'system' || !this.selectedSystem) {
      return;
    }

    for (const fleet of this.fleets) {
      if (fleet.destroyed || fleet.system?.id !== this.selectedSystem.id) {
        continue;
      }
      if (fleet.system.targetX != null || fleet.system.targetY != null) {
        continue;
      }

      const fleetCell = this.movementService.calculateSystemGridCell(
        fleet.system.x,
        fleet.system.y,
      );

      for (const planet of this.selectedSystem.planetsTiles) {
        const planetCell = this.movementService.getPlanetGridPosition(planet);
        if (fleetCell.col !== planetCell.col || fleetCell.row !== planetCell.row) {
          continue;
        }

        const lastPlanetId = this.fleetPlanetMap.get(fleet.id);
        if (lastPlanetId === planet.id) {
          break;
        }

        console.log('[PLANET ARRIVAL] Fleet', fleet.id, fleet.name, 'factionId:', fleet.factionId, 'arrived at planet', planet.id, planet.name, 'factionId:', planet.factionId, 'cell:', fleetCell);
        this.fleetPlanetMap.set(fleet.id, planet.id);
        this.handleFleetPlanetArrival(fleet, planet);
        break;
      }
    }
  }

  /** Handles a fleet arriving at a planet: colonization, orbit, or battle trigger. */
  private handleFleetPlanetArrival(fleet: Fleet, planet: PlanetTile): void {
    if (planet.factionId === 'unhabited') {
      const result = this.planetBattleService.resolveUninhabitedArrival(fleet);
      if (result.colonized && result.colonizerIndex >= 0) {
        fleet.ships.splice(result.colonizerIndex, 1);
        planet.factionId = fleet.factionId;
        console.log(`[StarMap] Fleet ${fleet.name} colonized ${planet.name}`);
      } else {
        console.log(`[StarMap] Fleet ${fleet.name} orbiting uninhabited ${planet.name} (no colonizer)`);
      }
      this.saveGame();
      return;
    }

    if (planet.factionId === fleet.factionId) {
      console.log(`[StarMap] Fleet ${fleet.name} arrived at own planet ${planet.name} (factionId: ${planet.factionId})`);
      return;
    }

    const planetFaction = this.factions.find((f) => f.id === planet.factionId);
    const fleetFaction = this.factions.find((f) => f.id === fleet.factionId);
    if (!planetFaction || !fleetFaction) {
      console.log(`[StarMap] Faction not found - planetFaction: ${planetFaction?.id}, fleetFaction: ${fleetFaction?.id}`);
      return;
    }

    console.log(`[StarMap] Fleet ${fleet.name} (${fleetFaction.name}, team ${fleetFaction.team}) vs planet ${planet.name} (${planetFaction.name}, team ${planetFaction.team})`);

    if (planetFaction.team === fleetFaction.team) {
      console.log(`[StarMap] Fleet ${fleet.name} cannot attack teammate planet ${planet.name}`);
      return;
    }

    if (!this.planetBattleService.hasPlanetDefenses(planet)) {
      console.log(`[StarMap] Fleet ${fleet.name} captured undefended planet ${planet.name}`);
      planet.factionId = fleet.factionId;
      this.saveGame();
      return;
    }

    this.triggerPlanetBattle(fleet, planet);
  }

  /** Triggers a battle between an attacking fleet and a planet's defenses. */
  private triggerPlanetBattle(attackerFleet: Fleet, targetPlanet: PlanetTile): void {
    const garrisonFleet = this.getFleetOnPlanet(targetPlanet);
    const defenseFleet = this.planetBattleService.createVirtualDefenseFleet(
      targetPlanet,
      garrisonFleet,
    );

    const attackerFaction = this.factions.find((f) => f.id === attackerFleet.factionId);
    const defenderFaction = this.factions.find((f) => f.id === targetPlanet.factionId);
    if (!attackerFaction || !defenderFaction) {
      return;
    }

    if (garrisonFleet) {
      const battleKey = `${Math.min(attackerFleet.id, garrisonFleet.id)}-${Math.max(attackerFleet.id, garrisonFleet.id)}`;
      this.triggeredBattles.add(battleKey);
    }

    console.log('[PLANET BATTLE] Attacker:', JSON.stringify({ id: attackerFleet.id, name: attackerFleet.name, factionId: attackerFleet.factionId, ships: attackerFleet.ships.map(s => ({ type: s.type, hp: s.currentHp })) }));
    console.log('[PLANET BATTLE] Planet:', JSON.stringify({ id: targetPlanet.id, name: targetPlanet.name, factionId: targetPlanet.factionId, buildings: targetPlanet.buildings.map(b => b.name) }));
    console.log('[PLANET BATTLE] Garrison:', garrisonFleet ? JSON.stringify({ id: garrisonFleet.id, name: garrisonFleet.name, factionId: garrisonFleet.factionId }) : 'none');
    console.log('[PLANET BATTLE] Virtual Defense Fleet ships:', JSON.stringify(defenseFleet.ships.map(s => ({ type: s.type, name: s.name }))));

    this.battleService.setPlanetBattle({
      fleet1: attackerFleet,
      fleet2: defenseFleet,
      faction1Name: attackerFaction.name,
      faction1Color: attackerFaction.color,
      faction2Name: defenderFaction.name,
      faction2Color: defenderFaction.color,
      attackerId: attackerFleet.id,
      defenderId: defenseFleet.id,
      planetId: targetPlanet.id,
    });

    this.saveGame();
    this.ngZone.run(() => this.router.navigate(['/battle']));
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

  /** Pauses the game loop if it is not already paused. */
  private pauseGame(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    this.gameLoopService.pauseGame();
  }

  /** Resumes the game loop and reattaches the per-frame update callback. */
  resumeGame(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.gameLoopService.resumeGame((deltaTime: number) => {
      const didMoveFleets = this.updateFleets(deltaTime);
      const visibilityChanged = this.updateSensorVisibility();

      const productionResult = this.productionService.tick(
        deltaTime,
        this,
        this.starSystems,
        this.fleets,
        this.factions,
      );
      const productionChanged = productionResult.stateChanged;

      this.economyAccumulator += deltaTime;
      let economyUpdated = false;
      if (this.economyAccumulator >= this.economyTickInterval) {
        for (const faction of this.factions) {
          this.economyService.applyEconomyDelta(
            faction.id,
            this.factions,
            this.starSystems,
            this.fleets,
            this.economyAccumulator,
          );
        }
        this.cachedPlayerEconomyBreakdown = this.economyService.calculateEconomy(
          'player',
          this.factions,
          this.starSystems,
          this.fleets,
        );
        this.economyAccumulator = 0;
        economyUpdated = true;
      }

      if (didMoveFleets || economyUpdated || visibilityChanged || productionChanged) {
        this.ngZone.run(() => this.cdr.detectChanges());
      }
    });
  }

  // Save/Load

  /** Serializes the current game state into the active save slot. */
  private saveGame(): void {
    if (this.saveGameService.currentSlot === null) {
      return;
    }

    const data: StarMapData = {
      factions: this.factions,
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
    };

    this.saveGameService.saveToSlot(this.saveGameService.currentSlot, data);
  }

  /** Restores game state from the active save slot and refreshes selection and grid data. */
  loadGame(): void {
    if (this.saveGameService.currentSlot === null) {
      return;
    }

    const data = this.saveGameService.loadFromSlot(this.saveGameService.currentSlot);
    if (!data || !data.fleets || !data.starSystems || !data.factions) {
      return;
    }

    this.factions = data.factions;
    this.starSystems = data.starSystems;
    this.fleets = data.fleets ?? [];
    this.shipStock = data.shipStock ?? [];
    this.production = data.production ?? [];

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

    // Ensure every system has an explored flag (old saves may not have it)
    if (!hasSensorData) {
      for (const system of this.starSystems) {
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

    // Legacy save migration: old saves stored map dimensions in vw (width=200)
    // and star system / fleet x/y in vw units. Convert to grid cell coordinates.
    if (data.map && data.map.width > 150) {
      const refCellSize = 2;
      for (const system of this.starSystems) {
        system.x = Math.min(Math.floor(system.x / refCellSize) + 1, this.mapWidth);
        system.y = Math.min(Math.floor(system.y / refCellSize) + 1, this.mapHeight);
      }
      for (const fleet of this.fleets) {
        if (fleet.destroyed) continue;
        fleet.x = Math.min(Math.floor(fleet.x / refCellSize) + 1, this.mapWidth);
        fleet.y = Math.min(Math.floor(fleet.y / refCellSize) + 1, this.mapHeight);
        if (fleet.targetX != null) {
          fleet.targetX = Math.min(Math.floor(fleet.targetX / refCellSize) + 1, this.mapWidth);
        }
        if (fleet.targetY != null) {
          fleet.targetY = Math.min(Math.floor(fleet.targetY / refCellSize) + 1, this.mapHeight);
        }
      }
    }

    if (data.destroyedFleetId != null) {
      const fleet = this.fleets.find((f) => f.id === data.destroyedFleetId);
      if (fleet) {
        fleet.destroyed = true;
      }
    }

    this.movementService.initializeCoordinates(this.fleets, this.starSystems);

    this.currentView = data.currentView ?? 'map';
    this.cameraX = data.cameraX ?? 0;
    this.cameraY = data.cameraY ?? 0;
    this.targetX = data.targetX ?? null;
    this.targetY = data.targetY ?? null;
    this.selectedFleetAction = data.selectedFleetAction ?? null;

    this.selectedSystem = this.starSystems.find((s) => s.id === data.selectedSystemId) ?? null;
    this.selectedFleet = this.fleets.find((f) => f.id === data.selectedFleetId) ?? null;
    this.selectedPlanetTile =
      this.selectedSystem?.planetsTiles?.find((p) => p.id === data.selectedPlanetTileId) ?? null;

    this.movementService.refreshGridPositions(this.fleets, this.starSystems);

    // Compute initial sensor visibility after loading
    this.computeInitialSensorVisibility();
    this.updateSensorVisibility();

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
   */
  ngOnInit(): void {
    this.onResize();

    if (this.saveGameService.currentSlot === null) {
      const slotIndex = this.saveGameService.getMostRecentSlotIndex();
      if (slotIndex !== null) {
        this.saveGameService.currentSlot = slotIndex;
      } else {
        this.router.navigate(['']);
        return;
      }
    }

    this.loadGame();
    this.removeDestroyedFleetFromService();
  }

  private reloadAfterBattle(): void {
    if (this.saveGameService.currentSlot === null) return;
    console.log('[RELOAD AFTER BATTLE] Reloading game state from save...');
    this.loadGame();
    console.log('[RELOAD AFTER BATTLE] Planets:', this.starSystems.flatMap(s => s.planetsTiles).map(p => ({ id: p.id, name: p.name, factionId: p.factionId })));
    console.log('[RELOAD AFTER BATTLE] Fleets:', this.fleets.map(f => ({ id: f.id, name: f.name, factionId: f.factionId, destroyed: f.destroyed })));
    this.removeDestroyedFleetFromService();
    this.cdr.detectChanges();
  }

  /** Applies a previously destroyed fleet from the battle service into the current save. */
  private removeDestroyedFleetFromService(): void {
    const destroyedFleetId = this.battleService.getDestroyedFleetId();
    if (destroyedFleetId != null) {
      this.battleService.clearBattle();
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
      this.saveGame();
    }
  }

  // Keyboard

  /** Listens for arrow keys to pan the camera around the map. */
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
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
    }
  }

  // Cleanup

  /** Saves the game, removes event listeners, and stops the game loop when the component is destroyed. */
  ngOnDestroy(): void {
    this.saveGame();

    this.routerSubscription.unsubscribe();

    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('orientationchange', this.onOrientationChange);

    this.gameLoopService.stopGameLoop();
  }
}

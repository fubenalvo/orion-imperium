import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { SaveGameService } from '../../services/save-game.service';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';
import { StarMapPauseComponent } from '../star-map-pause/star-map-pause.component';
import starMapData from './star-map-data.json';
import shipData from './ship-data.json';
import { StarMapGameLoopService } from './star-map-game-loop.service';
import { StarMapMovementService } from './star-map-movement.service';
import { StarMapBattleDetectionService } from './star-map-battle-detection.service';
import {
  StarMapData,
  Fleet,
  StarSystem,
  PlanetTile,
  ShipType,
  FleetShipTypeSummary,
  ContextMenuItem,
} from './star-map.models';

import { StarMapFleetInfoComponent } from './star-map-fleet-info/star-map-fleet-info.component';
import { StarMapSystemInfoComponent } from './star-map-system-info/star-map-system-info.component';
import { StarMapPlanetInfoComponent } from './star-map-planet-info/star-map-planet-info.component';
import { StarMapFleetButtonsComponent } from './star-map-fleet-buttons/star-map-fleet-buttons.component';
import { StarMapContextMenuComponent } from './star-map-context-menu/star-map-context-menu.component';

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
    StarMapFleetButtonsComponent,
    StarMapContextMenuComponent,
    NgClass,
  ],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {
  currentView: 'map' | 'system' = 'map';

  pauseMenuOpen = false;

  // Map configuration
  readonly mapWidth = initialStarMapData.map.width;
  readonly mapHeight = initialStarMapData.map.height;
  readonly cellSizeVw = initialStarMapData.map.cellSizeVw;
  readonly cellSizeVh = initialStarMapData.map.cellSizeVh;

  // Game state
  starSystems: StarSystem[] = initialStarMapData.starSystems;
  fleets: Fleet[] = initialStarMapData.fleets;
  factions: StarMapData['factions'] = initialStarMapData.factions;

  // Selection state
  selectedSystem: StarSystem | null = null;
  selectedFleet: Fleet | null = null;
  selectedPlanetTile: PlanetTile | null = null;
  selectedFleetAction: 'move' | 'attack' | null = null;

  // Camera state
  cameraX = 0;
  cameraY = 0;
  readonly cameraSpeed = 2;

  // Movement targets
  targetX: number | null = null;
  targetY: number | null = null;

  // UI state
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  isPaused = false;

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

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private router: Router,
    private battleService: BattleService,
    private saveGameService: SaveGameService,
    private shipService: ShipService,
    private gameLoopService: StarMapGameLoopService,
    public movementService: StarMapMovementService,
    private battleDetectionService: StarMapBattleDetectionService,
  ) {
    this.movementService.initialize(this.cellSizeVw, this.cellSizeVh, this.mapWidth, this.mapHeight);
  }

  get currentSlot(): number | null {
    return this.saveGameService.currentSlot;
  }

  get visibleFleets(): Fleet[] {
    return this.fleets.filter((f) => !f.destroyed);
  }

  // Pause menu handlers
  openPauseMenu(): void {
    this.pauseMenuOpen = true;
    this.pauseGame();
  }

  closePauseMenu(): void {
    this.pauseMenuOpen = false;
    this.resumeGame();
  }

  saveFromMenu(): void {
    if (this.saveGameService.currentSlot === null) {
      const slots = this.saveGameService.getSlots();
      const emptyIndex = slots.findIndex((slot) => !slot.data);
      this.saveGameService.currentSlot = emptyIndex >= 0 ? emptyIndex : 0;
    }
    this.saveGame();
  }

  loadFromMenu(slotIndex: number): void {
    this.saveGameService.currentSlot = slotIndex;
    this.loadGame();
  }

  exitToMainMenu(): void {
    this.saveGame();
    this.router.navigate(['']);
  }

  enterSystem(): void {
    this.saveGame();
    if (this.selectedSystem) {
      this.currentView = 'system';

      for (const fleet of this.fleets) {
        if (fleet.destroyed) {
          continue;
        }

        if (this.movementService.isFleetInSystem(fleet, this.selectedSystem)) {
          fleet.systemId = this.selectedSystem.id;
          if (fleet.systemX == null) {
            fleet.systemX = 2.5;
            fleet.systemY = 32.5;
          }
          const sysCell = this.movementService.calculateGridCell(fleet.systemX!, fleet.systemY!);
          fleet.gridCol = sysCell.col;
          fleet.gridRow = sysCell.row;
        }
      }

      if (this.selectedFleet && this.selectedFleet.systemTargetX != null) {
        this.targetX = this.selectedFleet.systemTargetX ?? null;
        this.targetY = this.selectedFleet.systemTargetY ?? null;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    }
  }

  leaveSystem(): void {
    this.saveGame();
    this.currentView = 'map';

    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.systemId !== undefined) {
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
  getFactionColor(factionId: string): string {
    if (!this.factions) {
      return '#ffffff';
    }
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.color : '#ffffff';
  }

  getFactionName(factionId: string): string {
    if (!this.factions) {
      return 'Unknown';
    }
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.name : 'Unknown';
  }

  // Bound versions for child component inputs to preserve `this` context
  readonly boundGetFactionColor = this.getFactionColor.bind(this);
  readonly boundGetFactionName = this.getFactionName.bind(this);

  // Ship type helpers
  getShipType(typeId: string): ShipType | undefined {
    return this.shipTypeById.get(typeId);
  }

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

  getFleetTotalAttack(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => sum + (this.getShipType(ship.type)?.attack ?? 0), 0);
  }

  getFleetTotalDefense(fleet: Fleet): number {
    return fleet.ships.reduce((sum, ship) => sum + (this.getShipType(ship.type)?.defense ?? 0), 0);
  }

  getEnergyForPlanet(planet: PlanetTile): number {
    const solarPlants = planet.buildings?.find((b) => b.name === 'Solar Array')?.count || 0;
    const fusionPlants = planet.buildings?.find((b) => b.name === 'Fusion Power Plant')?.count || 0;
    return solarPlants * 40 + fusionPlants * 100;
  }

  getTaxForPlanet(planet: PlanetTile): number {
    const factories = planet.buildings?.find((b) => b.name === 'Industrial Factory')?.count || 0;
    const pop = planet.population || 0;
    return Math.floor(pop * 0.1) + factories * 500;
  }

  getPlanetClassNames(planet: PlanetTile): string[] {
    return [
      planet.type,
      planet.size,
      planet.size ? `planet-size-${planet.size}` : undefined,
    ].filter((className): className is string => Boolean(className));
  }

  // Selection handlers
  selectFleet(fleet: Fleet): void {
    this.selectedFleet = fleet;

    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
    this.selectedPlanetTile = null;

    if (this.currentView === 'map') {
      this.cameraX = fleet.x - 50;
      this.cameraY = fleet.y - 50;
      this.clampCamera();
    }

    if (this.currentView === 'system') {
      if (fleet.systemTargetX != null && fleet.systemTargetY != null) {
        this.targetX = fleet.systemTargetX ?? null;
        this.targetY = fleet.systemTargetY ?? null;
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
  }

  deselectFleet(): void {
    this.selectedFleet = null;
    this.selectedFleetAction = null;
    this.targetX = null;
    this.targetY = null;
  }

  setFleetAction(action: 'move' | 'attack'): void {
    this.selectedFleetAction = action;
  }

  deselectSystem(): void {
    this.selectedSystem = null;
  }

  deselectPlanetTile(): void {
    this.selectedPlanetTile = null;
  }

  selectSystem(system: StarSystem): void {
    if (this.selectedFleet && this.currentView === 'map' && this.selectedFleetAction === 'move') {
      const targetTile = this.movementService.getTileCenter(system.x, system.y);
      this.moveSelectedFleet(targetTile.x, targetTile.y);
    }

    this.selectedSystem = system;
    this.selectedFleet = null;
    this.selectedFleetAction = null;
    this.selectedPlanetTile = null;
  }

  selectPlanetTile(tile: PlanetTile): void {
    this.selectedPlanetTile = tile;
    this.selectedFleet = null;
    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
  }

  // Context menu
  showContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
    this.contextMenu = { x, y, items };
  }

  closeContextMenu(): void {
    this.contextMenu = null;
  }

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
  }

  // Click handlers
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
      const items = this.movementService.getObjectsAtMapCell(this.fleets, this.starSystems, cell.col, cell.row);
      this.handleObjectClick(items, event);
    } else if (this.selectedSystem) {
      const sysCell = this.movementService.calculateGridCell(fleet.systemX ?? 0, fleet.systemY ?? 0);
      const items = this.movementService.getObjectsAtSystemCell(this.fleets, this.selectedSystem, sysCell.col, sysCell.row);
      this.handleObjectClick(items, event);
    } else {
      this.selectFleet(fleet);
    }
  }

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
      const items = this.movementService.getObjectsAtMapCell(this.fleets, this.starSystems, cell.col, cell.row);
      this.handleObjectClick(items, event);
    } else {
      this.selectSystem(system);
    }
  }

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
  moveSelectedFleet(x: number, y: number): void {
    if (!this.selectedFleet) {
      return;
    }

    if (this.currentView === 'system') {
      if (this.selectedSystem && this.selectedFleet.systemId === this.selectedSystem.id) {
        this.selectedFleet.systemTargetX = x;
        this.selectedFleet.systemTargetY = y;
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

  onSystemGridClick(event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    if (
      !this.selectedFleet ||
      !this.selectedSystem ||
      this.selectedFleet.systemId !== this.selectedSystem.id ||
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

    const targetTile = this.movementService.getTileCenter(systemX, systemY);
    this.moveSelectedFleet(targetTile.x, targetTile.y);
  }

  // Camera
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

  private clampCamera(): void {
    const gridWidthVw = this.movementService.gridColumns * 5;
    const gridHeightVw = this.movementService.gridRows * 5;
    const viewportWidthVw = 100;
    const viewportHeightVw = (window.innerHeight / window.innerWidth) * 100;

    const maxCameraX = Math.max(0, gridWidthVw - viewportWidthVw);
    const maxCameraY = Math.max(0, gridHeightVw - viewportHeightVw);

    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCameraX));
    this.cameraY = Math.max(0, Math.min(this.cameraY, maxCameraY));
  }

  // Game loop
  ngAfterViewInit(): void {
    console.log('[StarMap] ngAfterViewInit, starting game loop');
    this.startGameLoop();
    this.setupFocusHandlers();
  }

  private startGameLoop(): void {
    console.log('[StarMap] startGameLoop called');
    this.gameLoopService.startGameLoop((deltaTime: number) => {
      const didMoveFleets = this.updateFleets(deltaTime);
      if (didMoveFleets) {
        console.log('[StarMap] Fleets moved, triggering change detection');
        this.ngZone.run(() => this.cdr.detectChanges());
      }
    });
  }

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
          fleet.systemId = undefined;
          fleet.systemX = null;
          fleet.systemY = null;
          fleet.systemTargetX = null;
          fleet.systemTargetY = null;
        }
      },
    );

    if (didMoveFleets) {
      console.log('[StarMap] movementService.updateFleets returned true');
    }

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

  private setupFocusHandlers(): void {
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private pauseGame(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    this.gameLoopService.pauseGame();
  }

  resumeGame(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.gameLoopService.resumeGame((deltaTime: number) => {
      const didMoveFleets = this.updateFleets(deltaTime);
      if (didMoveFleets) {
        this.ngZone.run(() => this.cdr.detectChanges());
      }
    });
  }

  // Save/Load
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
    };

    this.saveGameService.saveToSlot(this.saveGameService.currentSlot, data);
  }

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
    this.selectedPlanetTile = this.selectedSystem?.planetsTiles?.find((p) => p.id === data.selectedPlanetTileId) ?? null;

    this.movementService.refreshGridPositions(this.fleets, this.starSystems);
  }

  removeFleet(fleetId: number): void {
    this.fleets = this.fleets.filter((f) => f.id !== fleetId);
    if (this.selectedFleet?.id === fleetId) {
      this.selectedFleet = null;
      this.selectedFleetAction = null;
      this.targetX = null;
      this.targetY = null;
    }
  }

  ngOnInit(): void {
    if (this.saveGameService.currentSlot !== null) {
      this.loadGame();
      this.removeDestroyedFleetFromService();
      return;
    }

    this.movementService.initializeCoordinates(this.fleets, this.starSystems);
    this.movementService.refreshGridPositions(this.fleets, this.starSystems);
  }

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
  ngOnDestroy(): void {
    this.saveGame();

    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.gameLoopService.stopGameLoop();
  }
}

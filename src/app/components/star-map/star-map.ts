/*
 * =========================================================
 * STAR MAP COMPONENT
 * =========================================================
 *
 * Central gameplay component for Orion Imperium.
 *
 * Manages:
 * - Map view and system view switching
 * - Fleet movement (map-level and system-level)
 * - Camera panning and clamping
 * - Grid-based object selection and context menus
 * - Collision-based battle detection
 * - Game loop with pause/resume on window blur
 * - Auto-save on state changes
 * - Save/load via SaveGameService
 *
 * State is owned entirely by this component. Services are used
 * for persistence (SaveGameService), battle handoff (BattleService),
 * and ship stat lookup (ShipService).
 */

import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit,
} from '@angular/core';
import { NgClass, UpperCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Fleet } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';
import { StarMapPauseComponent } from '../star-map-pause/star-map-pause.component';
import starMapData from './star-map-data.json';
import shipData from './ship-data.json';
import { SaveGameService } from '../../services/save-game.service';

interface PlanetBuilding {
  name: string;
  count: number;
}

/*
 * Planet type and size are used for rendering and planet classification.
 * These values are purely cosmetic in the current implementation;
 * they do not affect gameplay mechanics.
 */
type PlanetType = 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert';
type PlanetSize = 'huge' | 'big' | 'medium' | 'small' | 'tiny';

interface Faction {
  id: string;
  name: string;
  color: string;
  team: number;
}

/*
 * PlanetTile represents a single planet within a star system.
 *
 * NOTE: x, y, xOffset, yOffset are loaded from JSON but are NOT used
 * for rendering. Planets are positioned using a hardcoded grid formula
 * in getPlanetGridPosition() and in the template.
 */
interface PlanetTile {
  id: number;
  index: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  xOffset: number;
  yOffset: number;
  type: PlanetType;
  size: PlanetSize;
  population: number;
  buildings: PlanetBuilding[];
}

interface StarSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  planets: number;
  color: string;
  planetsTiles: PlanetTile[];
  gridCol: number;
  gridRow: number;
}

interface FleetShip {
  id: number;
  name: string;
  type: string;
}

/*
 * WARNING: ShipType, FleetShip, and FleetShipTypeSummary are duplicated
 * from battle.service.ts and ship.service.ts. These should be consolidated
 * into shared interfaces to avoid divergence.
 */
interface ShipType {
  id: string;
  name: string;
  role: string;
  hitPoints: number;
  shield: number;
  shieldRegen: number;
  attack: number;
  attackType: string;
  weakness: string;
  defense: number;
  speed: number;
  range: number;
  cost: number;
}

interface FleetShipTypeSummary {
  typeId: string;
  typeName: string;
  count: number;
  attack: number;
  defense: number;
}

export interface StarMapData {
  factions: Faction[];
  map: {
    width: number;
    height: number;
    cellSizeVw: number;
    cellSizeVh: number;
  };
  starSystems: StarSystem[];
  fleets: Fleet[];
  currentView?: 'map' | 'system';
  cameraX?: number;
  cameraY?: number;
  selectedSystemId?: number | null;
  selectedFleetId?: number | null;
  selectedPlanetTileId?: number | null;
  selectedFleetAction?: 'move' | 'attack' | null;
  targetX?: number | null;
  targetY?: number | null;
  destroyedFleetId?: number | null;
}

/*
 * initialStarMapData is a deep clone of the JSON seed data.
 * It is used as the default state for new games.
 * structuredClone is used because the JSON import gives us a fresh copy,
 * but we want to ensure no reference sharing with the module-level import.
 */
const initialStarMapData = structuredClone(starMapData) as StarMapData;

interface ContextMenuItem {
  type: 'fleet' | 'system' | 'planet';
  label: string;
  data: Fleet | StarSystem | PlanetTile;
}

@Component({
  selector: 'app-star-map',
  imports: [StarMapPauseComponent, StarMapNavigationComponent, NgClass, UpperCasePipe],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {
  currentView: 'map' | 'system' = 'map';

  pauseMenuOpen = false;

  /*
   * Pause menu handlers are exposed to the child pause component.
   * The pause menu itself is rendered by StarMapPauseComponent.
   */

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

        if (this.isFleetInSystem(fleet, this.selectedSystem)) {
          fleet.systemId = this.selectedSystem.id;
          if (fleet.systemX == null) {
            fleet.systemX = 2.5;
            fleet.systemY = 32.5;
          }
          const sysCell = this.calculateGridCell(fleet.systemX!, fleet.systemY!);
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
        const mapCell = this.calculateGridCell(fleet.x, fleet.y);
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

  /*
   * =========================================================
   * MAP CONFIG & DATA (loaded from JSON)
   * =========================================================
   *
   * World coordinates work in vw (viewport width) units.
   * 1 vw = 1% of viewport width.
   * Grid cell size is 5vw x 5vh.
   */

  readonly mapWidth = initialStarMapData.map.width;
  readonly mapHeight = initialStarMapData.map.height;

  readonly cellSizeVw = initialStarMapData.map.cellSizeVw;
  readonly cellSizeVh = initialStarMapData.map.cellSizeVh;

  gridColumns = Math.ceil(this.mapWidth / this.cellSizeVw);
  gridRows = Math.ceil(this.mapHeight / this.cellSizeVh);

  // Star systems and fleets are loaded directly from JSON
  starSystems: StarSystem[] = initialStarMapData.starSystems;
  fleets: Fleet[] = initialStarMapData.fleets;
  factions: Faction[] = initialStarMapData.factions;

  getFactionColor(factionId: string): string {
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.color : '#ffffff';
  }

  getFactionName(factionId: string): string {
    const faction = this.factions.find((f) => f.id === factionId);
    return faction ? faction.name : 'Unknown';
  }

  get visibleFleets(): Fleet[] {
    return this.fleets.filter((f) => !f.destroyed);
  }

  /*
   * =========================================================
   * SHIP TYPES (loaded from JSON)
   * =========================================================
   *
   * ShipType interface is duplicated from ship.service.ts here.
   * ship.service.getShipTypeMap() returns only attack and shield values,
   * but StarMap uses the full ShipType here for the fleet info panel.
   */

  readonly shipTypes: ShipType[] = (shipData as { shipTypes: ShipType[] }).shipTypes;

  private readonly shipTypeById: Map<string, ShipType> = new Map(
    this.shipTypes.map((type) => [type.id, type] as [string, ShipType]),
  );

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

  private checkForBattles(): void {
    /*
     * Collision-based battle detection: two fleets end up in the same grid cell.
     * Only hostile factions (different teams) trigger battles.
     * Neutral factions (team 0) do not participate in battles.
     * triggeredBattles Set prevents duplicate battle triggers for the same fleet pair.
     */
    const activeFleets = this.fleets.filter((f) => !f.destroyed);
    for (let i = 0; i < activeFleets.length; i++) {
      for (let j = i + 1; j < activeFleets.length; j++) {
        const fleet1 = activeFleets[i];
        const fleet2 = activeFleets[j];

        if (fleet1.gridCol !== fleet2.gridCol || fleet1.gridRow !== fleet2.gridRow) {
          continue;
        }

        const faction1 = this.factions.find((f) => f.id === fleet1.factionId);
        const faction2 = this.factions.find((f) => f.id === fleet2.factionId);

        if (!faction1 || !faction2) {
          continue;
        }

        if (faction1.team === 0 || faction2.team === 0) {
          continue;
        }

        if (faction1.team === faction2.team) {
          continue;
        }

        const battleKey = `${Math.min(fleet1.id, fleet2.id)}-${Math.max(fleet1.id, fleet2.id)}`;

        if (this.triggeredBattles.has(battleKey)) {
          continue;
        }

        this.triggeredBattles.add(battleKey);

        this.battleService.setBattle({
          fleet1,
          fleet2,
          faction1Name: faction1.name,
          faction1Color: faction1.color,
          faction2Name: faction2.name,
          faction2Color: faction2.color,
        });

        this.saveGame();

        /*
         * NgZone.run() is necessary because the game loop runs outside Angular zone.
         * router.navigate() only works correctly inside the zone.
         */
        this.ngZone.run(() => {
          this.router.navigate(['/battle']);
        });

        return;
      }
    }
  }

  calculateGridCell(x: number, y: number): { col: number; row: number } {
    /*
     * Grid cell calculation: 1-indexed cells.
     * e.g. x=0 -> col=1, x=5 -> col=2
     * World coordinates point to the center of the cell.
     */
    const col = Math.floor(x / this.cellSizeVw) + 1;
    const row = Math.floor(y / this.cellSizeVh) + 1;

    return { col, row };
  }

  isFleetInSystem(fleet: Fleet, system: StarSystem): boolean {
    const fleetCell = this.calculateGridCell(fleet.x, fleet.y);
    const sysCell = this.calculateGridCell(system.x, system.y);
    return fleetCell.col === sysCell.col && fleetCell.row === sysCell.row;
  }

  private getObjectsAtMapCell(col: number, row: number): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    // Fleets
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.gridCol === col && fleet.gridRow === row) {
        items.push({
          type: 'fleet',
          label: `Fleet: ${fleet.name}`,
          data: fleet,
        });
      }
    }

    // Star systems
    for (const system of this.starSystems) {
      if (system.gridCol === col && system.gridRow === row) {
        items.push({
          type: 'system',
          label: `System: ${system.name}`,
          data: system,
        });
      }
    }

    return items;
  }

  private getPlanetGridPosition(planet: PlanetTile): { col: number; row: number } {
    /*
     * Planet positioning uses a hardcoded formula in system view.
     * The 20 and 6 values represent the system grid offset.
     * Positions are calculated by index to arrange planets
     * in a semi-circle around the sun.
     */
    return {
      col: 20 - planet.index * 2,
      row: 6 + (planet.index % 2 === 0 ? 1 : -1) * (planet.index % 3),
    };
  }

  private getObjectsAtSystemCell(col: number, row: number, system: StarSystem): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.systemId === system.id && fleet.systemX != null && fleet.systemY != null) {
        const fleetCell = this.calculateGridCell(fleet.systemX, fleet.systemY);
        if (fleetCell.col === col && fleetCell.row === row) {
          items.push({ type: 'fleet', label: `Fleet: ${fleet.name}`, data: fleet });
        }
      }
    }

    for (const planet of system.planetsTiles) {
      const planetCell = this.getPlanetGridPosition(planet);
      if (planetCell.col === col && planetCell.row === row) {
        items.push({ type: 'planet', label: `Planet: ${planet.name}`, data: planet });
      }
    }

    return items;
  }

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

  private handleMapObjectClick(col: number, row: number, event: MouseEvent): void {
    const items = this.getObjectsAtMapCell(col, row);

    if (items.length > 1) {
      /*
       * Multiple objects in the same cell -> show context menu.
       * The user can select which object to interact with.
       */
      this.showContextMenu(event.clientX, event.clientY, items);
      return;
    }

    if (items.length === 1) {
      this.onContextMenuSelect(items[0]);
      return;
    }
  }

  private handleSystemObjectClick(
    col: number,
    row: number,
    system: StarSystem,
    event: MouseEvent,
  ): void {
    const items = this.getObjectsAtSystemCell(col, row, system);

    if (items.length > 1) {
      this.showContextMenu(event.clientX, event.clientY, items);
      return;
    }

    if (items.length === 1) {
      this.onContextMenuSelect(items[0]);
      return;
    }
  }

  private getTileCenter(x: number, y: number): { x: number; y: number } {
    const tileColumn = Math.max(0, Math.min(Math.floor(x / this.cellSizeVw), this.gridColumns - 1));
    const tileRow = Math.max(0, Math.min(Math.floor(y / this.cellSizeVh), this.gridRows - 1));

    return {
      x: tileColumn * this.cellSizeVw + this.cellSizeVw / 2,
      y: tileRow * this.cellSizeVh + this.cellSizeVh / 2,
    };
  }

  cameraX = 0;
  cameraY = 0;
  readonly cameraSpeed = 2;

  selectedSystem: StarSystem | null = null;
  selectedFleet: Fleet | null = null;
  selectedPlanetTile: PlanetTile | null = null;
  selectedFleetAction: 'move' | 'attack' | null = null;

  targetX: number | null = null;
  targetY: number | null = null;

  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null = null;

  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  isPaused = false;
  private triggeredBattles = new Set<string>();

  private readonly onWindowBlur = (): void => this.pauseGame();
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pauseGame();
  };

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private router: Router,
    private battleService: BattleService,
    private saveGameService: SaveGameService,
    private shipService: ShipService,
  ) {}

  get currentSlot(): number | null {
    return this.saveGameService.currentSlot;
  }

  private saveGame(): void {
    if (this.saveGameService.currentSlot === null) {
      return;
    }

    /*
     * StarMapData full snapshot is saved.
     * destroyedFleetId is stored separately because the fleet object's
     * destroyed flag is not sufficient across save/load cycles;
     * if the fleet is removed from the list, preserving the ID allows
     * recovery.
     */
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
    if (!data) {
      return;
    }

    this.factions = data.factions;
    this.starSystems = data.starSystems;
    this.fleets = data.fleets ?? [];

    /*
     * destroyedFleetId handling: the fleet is already in the fleets array,
     * but the destroyed flag is not set. We set it here.
     * This ensures the fleet is in the correct state after loading from save.
     */
    if (data.destroyedFleetId != null) {
      const fleet = this.fleets.find((f) => f.id === data.destroyedFleetId);
      if (fleet) {
        fleet.destroyed = true;
      }
    }

    /*
     * Compatibility layer: older saves may lack gridCol/gridRow
     * but have x/y values. In that case, gridCol/Row are calculated from x/y (1-indexed).
     */
    for (const fleet of this.fleets) {
      if (fleet.gridCol == null || fleet.gridRow == null) {
        const gridX = fleet.x;
        const gridY = fleet.y;
        fleet.x = (gridX - 1) * this.cellSizeVw + this.cellSizeVw / 2;
        fleet.y = (gridY - 1) * this.cellSizeVh + this.cellSizeVh / 2;
        fleet.gridCol = gridX;
        fleet.gridRow = gridY;
      }
    }

    this.currentView = data.currentView ?? 'map';
    this.cameraX = data.cameraX ?? 0;
    this.cameraY = data.cameraY ?? 0;
    this.targetX = data.targetX ?? null;
    this.targetY = data.targetY ?? null;
    this.selectedFleetAction = data.selectedFleetAction ?? null;

    this.selectedSystem = this.starSystems.find((s) => s.id === data.selectedSystemId) ?? null;
    this.selectedFleet = this.fleets.find((f) => f.id === data.selectedFleetId) ?? null;
    this.selectedPlanetTile = this.selectedSystem?.planetsTiles.find((p) => p.id === data.selectedPlanetTileId) ?? null;

    this.refreshGridPositions();
  }

  private initializeCoordinates(): void {
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.gridCol == null || fleet.gridRow == null) {
        const gridX = fleet.x;
        const gridY = fleet.y;
        fleet.x = (gridX - 1) * this.cellSizeVw + this.cellSizeVw / 2;
        fleet.y = (gridY - 1) * this.cellSizeVh + this.cellSizeVh / 2;
        fleet.gridCol = gridX;
        fleet.gridRow = gridY;
      }
    }

    for (const system of this.starSystems) {
      const cell = this.calculateGridCell(system.x, system.y);
      system.gridCol = cell.col;
      system.gridRow = cell.row;
    }
  }

  private refreshGridPositions(): void {
    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.x != null && fleet.y != null) {
        const cell = this.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = cell.col;
        fleet.gridRow = cell.row;
      }
    }

    for (const system of this.starSystems) {
      const cell = this.calculateGridCell(system.x, system.y);
      system.gridCol = cell.col;
      system.gridRow = cell.row;
    }
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

    this.initializeCoordinates();
    this.refreshGridPositions();
  }

  /*
   * removeDestroyedFleetFromService: Processes the destroyedFleetId
   * stored in BattleService when StarMap starts.
   * This ensures the post-battle fleet removal happens correctly
   * in StarMap state as well.
   */
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

  getPlanetClassNames(planet: PlanetTile): string[] {
    return [
      planet.type,
      planet.size,
      planet.size ? `planet-size-${planet.size}` : undefined,
    ].filter((className): className is string => Boolean(className));
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

  /*
   * =========================================================
   * VIEW READY
   * =========================================================
   */

  ngAfterViewInit(): void {
    this.startGameLoop();
    this.setupFocusHandlers();
  }

  /*
   * =========================================================
   * FOCUS / PAUSE HANDLERS
   * =========================================================
   *
   * The game automatically pauses when the window loses focus
   * or the tab becomes hidden. This prevents the game from continuing
   * while the user is not watching.
   */

  private setupFocusHandlers(): void {
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  pauseGame(): void {
    if (this.isPaused) return;
    this.isPaused = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  resumeGame(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.update(time));
    });
  }

  /*
   * =========================================================
   * START GAME LOOP
   * =========================================================
   *
   * The game loop runs outside Angular zone to avoid triggering
   * unnecessary change detection every frame.
   * Change detection is only signaled when fleets actually move.
   */

  private startGameLoop(): void {
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.update(time));
    });
  }

  /*
   * =========================================================
   * GAME LOOP
   * =========================================================
   *
   * deltaTime = elapsed time since previous frame in seconds.
   * DeltaTime is capped at 0.1s to prevent large jumps
   * after tab switches.
   */

  private update(time: number): void {
    const deltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);

    this.lastFrameTime = time;

    const didMoveFleets = this.updateFleets(deltaTime);

    if (didMoveFleets) {
      this.ngZone.run(() => this.cdr.detectChanges());
    }

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((nextTime) => this.update(nextTime));
    });
  }

  /*
   * =========================================================
   * UPDATE FLEETS
   * =========================================================
   *
   * Processes fleet movement every frame.
   * Two different coordinate systems are used:
   * - Map movement: targetX/targetY (vw units, world coordinates)
   * - System movement: systemTargetX/systemTargetY (vw units, system coordinates)
   *
   * If a fleet has a map target, does it take priority over system movement?
   * No: both movements update independently, but in practice
   * a fleet can only move in one mode at a time.
   */

  private updateFleets(deltaTime: number): boolean {
    let didMoveFleets = false;

    for (const fleet of this.fleets) {
      if (fleet.destroyed) {
        continue;
      }

      // Map movement
      if (fleet.targetX !== null && fleet.targetY !== null) {
        didMoveFleets = true;

        const dx = fleet.targetX - fleet.x;
        const dy = fleet.targetY - fleet.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const movement = fleet.speed * deltaTime;

        if (distance <= movement) {
          fleet.x = fleet.targetX;
          fleet.y = fleet.targetY;
          fleet.targetX = null;
          fleet.targetY = null;

          if (this.selectedFleet?.id === fleet.id && this.currentView === 'map') {
            this.targetX = null;
            this.targetY = null;
          }
        } else {
          fleet.x += (dx / distance) * movement;
          fleet.y += (dy / distance) * movement;
        }

        const mapCell = this.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = mapCell.col;
        fleet.gridRow = mapCell.row;

        // If the fleet moved on the world map, check if it left its current system
        if (fleet.systemId !== undefined) {
          const system = this.starSystems.find((s) => s.id === fleet.systemId);
          if (system && !this.isFleetInSystem(fleet, system)) {
            fleet.systemId = undefined;
            fleet.systemX = null;
            fleet.systemY = null;
            fleet.systemTargetX = null;
            fleet.systemTargetY = null;
          }
        }
      }

      // System movement
      if (fleet.systemTargetX != null && fleet.systemTargetY != null) {
        didMoveFleets = true;

        const dx = fleet.systemTargetX - (fleet.systemX || 0);
        const dy = fleet.systemTargetY - (fleet.systemY || 0);
        const distance = Math.sqrt(dx * dx + dy * dy);
        const movement = fleet.speed * deltaTime;

        if (distance <= movement) {
          fleet.systemX = fleet.systemTargetX;
          fleet.systemY = fleet.systemTargetY;
          fleet.systemTargetX = null;
          fleet.systemTargetY = null;

          if (this.selectedFleet?.id === fleet.id && this.currentView === 'system') {
            this.targetX = null;
            this.targetY = null;
          }
        } else {
          fleet.systemX = (fleet.systemX || 0) + (dx / distance) * movement;
          fleet.systemY = (fleet.systemY || 0) + (dy / distance) * movement;
        }

        if (fleet.systemX != null && fleet.systemY != null) {
          const sysCell = this.calculateGridCell(fleet.systemX, fleet.systemY);
          fleet.gridCol = sysCell.col;
          fleet.gridRow = sysCell.row;
        }
      }
    }

    this.checkForBattles();

    return didMoveFleets;
  }

  /*
   * -------------------------------------------------------
   * SELECT FLEET
   * -------------------------------------------------------
   */

  selectFleet(fleet: Fleet): void {
    this.selectedFleet = fleet;

    console.log('this.selectedFleet: ' + this.selectedFleet);

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

  /*
   * -------------------------------------------------------
   * OVERLAP-AWARE CLICK HANDLERS
   * -------------------------------------------------------
   */

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
      this.handleMapObjectClick(fleet.gridCol, fleet.gridRow, event);
    } else if (this.selectedSystem) {
      const sysCell = this.calculateGridCell(fleet.systemX ?? 0, fleet.systemY ?? 0);
      this.handleSystemObjectClick(sysCell.col, sysCell.row, this.selectedSystem, event);
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
      this.handleMapObjectClick(system.gridCol, system.gridRow, event);
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
      const planetCell = this.getPlanetGridPosition(planet);
      const items = this.getObjectsAtSystemCell(
        planetCell.col,
        planetCell.row,
        this.selectedSystem,
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

  /*
   * -------------------------------------------------------
   * GIVE MOVEMENT ORDER
   * -------------------------------------------------------
   */

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

  /*
   * -------------------------------------------------------
   * SELECT PLANET TILE
   * -------------------------------------------------------
   */

  selectPlanetTile(tile: PlanetTile): void {
    this.selectedPlanetTile = tile;
    this.selectedFleet = null;
    if (this.currentView !== 'system') {
      this.selectedSystem = null;
    }
  }

  /*
   * -------------------------------------------------------
   * MAP CLICK
   * -------------------------------------------------------
   */

  onMapClick(event: MouseEvent): void {
    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    /*
     * No selected fleet or no selected action = no movement order.
     */

    if (!this.selectedFleet || !this.selectedFleetAction) {
      return;
    }

    const viewport = event.currentTarget as HTMLElement;

    const rect = viewport.getBoundingClientRect();

    /*
     * Mouse position inside viewport.
     */

    const screenX = event.clientX - rect.left;

    const screenY = event.clientY - rect.top;

    /*
     * Convert viewport pixels to the same vw-based
     * world units used by the grid and camera transform.
     */

    const viewportUnitInPixels = window.innerWidth / 100;

    const worldX = this.cameraX + screenX / viewportUnitInPixels;

    const worldY = this.cameraY + screenY / viewportUnitInPixels;

    /*
     * The command belongs to the clicked tile,
     * so store the destination at that tile's center.
     */

    const targetTile = this.getTileCenter(worldX, worldY);

    /*
     * Give movement order.
     */

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

    // System grid doesn't have camera translation
    const systemX = screenX / viewportUnitInPixels;
    const systemY = screenY / viewportUnitInPixels;

    // Use getTileCenter to snap to grid cells (system view also uses 5vw grid)
    const targetTile = this.getTileCenter(systemX, systemY);

    this.moveSelectedFleet(targetTile.x, targetTile.y);
  }

  /*
   * -------------------------------------------------------
   * SELECT STAR SYSTEM
   * -------------------------------------------------------
   */

  selectSystem(system: StarSystem): void {
    if (this.selectedFleet && this.currentView === 'map' && this.selectedFleetAction === 'move') {
      const targetTile = this.getTileCenter(system.x, system.y);
      this.moveSelectedFleet(targetTile.x, targetTile.y);
    }

    this.selectedSystem = system;
    this.selectedFleet = null;
    this.selectedFleetAction = null;
    this.selectedPlanetTile = null;
  }

  /*
   * -------------------------------------------------------
   * CAMERA MOVEMENT
   * -------------------------------------------------------
   */

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

  /*
   * -------------------------------------------------------
   * KEEP CAMERA INSIDE MAP
   * -------------------------------------------------------
   */

  private clampCamera(): void {
    const gridWidthVw = this.gridColumns * 5;
    const gridHeightVw = this.gridRows * 5;
    const viewportWidthVw = 100;
    const viewportHeightVw = (window.innerHeight / window.innerWidth) * 100;

    const maxCameraX = Math.max(0, gridWidthVw - viewportWidthVw);
    const maxCameraY = Math.max(0, gridHeightVw - viewportHeightVw);

    this.cameraX = Math.max(0, Math.min(this.cameraX, maxCameraX));
    this.cameraY = Math.max(0, Math.min(this.cameraY, maxCameraY));
  }

  /*
   * -------------------------------------------------------
   * KEYBOARD
   * -------------------------------------------------------
   */

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

  /*
   * -------------------------------------------------------
   * CLEANUP
   * -------------------------------------------------------
   */

  ngOnDestroy(): void {
    this.saveGame();

    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);

      this.animationFrameId = null;
    }
  }
}

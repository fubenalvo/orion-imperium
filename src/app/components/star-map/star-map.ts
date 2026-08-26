import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit,
} from '@angular/core';
import { NgClass, UpperCasePipe } from '@angular/common';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';
import starMapData from './star-map-data.json';
import shipData from './ship-data.json';

interface PlanetBuilding {
  name: string;
  count: number;
}

type PlanetType = 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert';
type PlanetSize = 'huge' | 'big' | 'medium' | 'small' | 'tiny';

interface Faction {
  id: string;
  name: string;
  color: string;
}

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

interface Fleet {
  id: number;
  name: string;
  factionId: string;

  x: number;
  y: number;

  targetX: number | null;
  targetY: number | null;

  speed: number;

  systemId?: number;
  systemX?: number | null;
  systemY?: number | null;
  systemTargetX?: number | null;
  systemTargetY?: number | null;

  gridCol: number;
  gridRow: number;

  ships: FleetShip[];
}

interface StarMapData {
  factions: Faction[];
  map: {
    width: number;
    height: number;
    cellSizeVw: number;
    cellSizeVh: number;
  };
  starSystems: StarSystem[];
  fleets: Fleet[];
}

interface ContextMenuItem {
  type: 'fleet' | 'system' | 'planet';
  label: string;
  data: Fleet | StarSystem | PlanetTile;
}

const initialStarMapData = starMapData as StarMapData;

@Component({
  selector: 'app-star-map',
  imports: [StarMapNavigationComponent, NgClass, UpperCasePipe],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {
  currentView: 'map' | 'system' = 'map';

  enterSystem(): void {
    if (this.selectedSystem) {
      this.currentView = 'system';

      for (const fleet of this.fleets) {
        if (this.isFleetInSystem(fleet, this.selectedSystem)) {
          fleet.systemId = this.selectedSystem.id;
          if (fleet.systemX == null) {
            fleet.systemX = 2.5;
            fleet.systemY = 32.5;
          }
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
    this.currentView = 'map';

    if (this.selectedFleet && this.selectedFleet.targetX != null) {
      this.targetX = this.selectedFleet.targetX;
      this.targetY = this.selectedFleet.targetY;
    } else {
      this.targetX = null;
      this.targetY = null;
    }
  }

  /*
   * -------------------------------------------------------
   * MAP CONFIG & DATA (JSON-ból betöltve)
   * -------------------------------------------------------
   */

  readonly mapWidth = initialStarMapData.map.width;
  readonly mapHeight = initialStarMapData.map.height;

  readonly cellSizeVw = initialStarMapData.map.cellSizeVw;
  readonly cellSizeVh = initialStarMapData.map.cellSizeVh;

  gridColumns = Math.ceil(this.mapWidth / this.cellSizeVw);
  gridRows = Math.ceil(this.mapHeight / this.cellSizeVh);

  // A csillagrendszerek és flották most már közvetlenül a JSON-ból jönnek
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

  /*
   * -------------------------------------------------------
   * SHIP TYPES (JSON-ből betöltve)
   * -------------------------------------------------------
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
    return fleet.ships.reduce(
      (sum, ship) => sum + (this.getShipType(ship.type)?.attack ?? 0),
      0,
    );
  }

  getFleetTotalDefense(fleet: Fleet): number {
    return fleet.ships.reduce(
      (sum, ship) => sum + (this.getShipType(ship.type)?.defense ?? 0),
      0,
    );
  }

  calculateGridCell(x: number, y: number): { col: number; row: number } {
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

    console.log(`[getObjectsAtMapCell] Searching cell: col=${col}, row=${row}`);
    console.log(`[getObjectsAtMapCell] Fleets count: ${this.fleets.length}`);
    console.log(`[getObjectsAtMapCell] Star systems count: ${this.starSystems.length}`);

    // Fleets
    for (const fleet of this.fleets) {
      console.log(
        `[getObjectsAtMapCell] Checking fleet "${fleet.name}": ` +
          `gridCol=${fleet.gridCol}, gridRow=${fleet.gridRow} ` +
          `(target: ${col}, ${row})`,
      );

      if (fleet.gridCol === col && fleet.gridRow === row) {
        console.log(`[getObjectsAtMapCell] ✓ FLEET MATCH: "${fleet.name}" at ${col}, ${row}`);

        items.push({
          type: 'fleet',
          label: `Fleet: ${fleet.name}`,
          data: fleet,
        });
      }
    }

    // Star systems
    for (const system of this.starSystems) {
      console.log(
        `[getObjectsAtMapCell] Checking system "${system.name}": ` +
          `gridCol=${system.gridCol}, gridRow=${system.gridRow} ` +
          `(target: ${col}, ${row})`,
      );

      if (system.gridCol === col && system.gridRow === row) {
        console.log(
          `[getObjectsAtMapCell] ✓ STAR SYSTEM MATCH: "${system.name}" at ${col}, ${row}`,
        );

        items.push({
          type: 'system',
          label: `System: ${system.name}`,
          data: system,
        });
      }
    }

    console.log(`[getObjectsAtMapCell] Result for ${col}, ${row}:`, items);

    return items;
  }

  private getPlanetGridPosition(planet: PlanetTile): { col: number; row: number } {
    return {
      col: 20 - planet.index * 2,
      row: 6 + (planet.index % 2 === 0 ? 1 : -1) * (planet.index % 3),
    };
  }

  private getObjectsAtSystemCell(col: number, row: number, system: StarSystem): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const fleet of this.fleets) {
      if (fleet.systemId === system.id && fleet.gridCol === col && fleet.gridRow === row) {
        items.push({ type: 'fleet', label: `Fleet: ${fleet.name}`, data: fleet });
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
    console.log(`showContextMenu ${x} ${y} ${items}`);
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
    console.log(`[handleMapObjectClick] Clicked map cell: col=${col}, row=${row}`);

    console.log(`[handleMapObjectClick] Mouse position: x=${event.clientX}, y=${event.clientY}`);

    const items = this.getObjectsAtMapCell(col, row);

    console.log(`[handleMapObjectClick] Objects found: ${items.length}`, items);

    if (items.length > 1) {
      console.log(
        `[handleMapObjectClick] Multiple objects found (${items.length}) -> showing context menu`,
      );

      this.showContextMenu(event.clientX, event.clientY, items);
      return;
    }

    if (items.length === 1) {
      console.log(`[handleMapObjectClick] Exactly one object found -> selecting:`, items[0]);

      this.onContextMenuSelect(items[0]);
      return;
    }

    console.log(`[handleMapObjectClick] No objects found at cell col=${col}, row=${row}`);
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

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
  ) {}

  // A korábbi random generálás törölve lett, mert minden a JSON-ból töltődik be
  ngOnInit(): void {
    for (const fleet of this.fleets) {
      const cell = this.calculateGridCell(fleet.x, fleet.y);
      fleet.gridCol = cell.col;
      fleet.gridRow = cell.row;
    }

    for (const system of this.starSystems) {
      const cell = this.calculateGridCell(system.x, system.y);
      system.gridCol = cell.col;
      system.gridRow = cell.row;
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
    const powerPlants = planet.buildings?.find((b) => b.name === 'Solar Power Plant')?.count || 0;
    return powerPlants * 50;
  }

  getTaxForPlanet(planet: PlanetTile): number {
    const banks = planet.buildings?.find((b) => b.name === 'Bank')?.count || 0;
    const pop = planet.population || 0;
    return Math.floor(pop * 0.1) + banks * 500;
  }

  /*
   * -------------------------------------------------------
   * VIEW READY
   * -------------------------------------------------------
   */

  ngAfterViewInit(): void {
    this.startGameLoop();
  }

  /*
   * -------------------------------------------------------
   * START GAME LOOP
   * -------------------------------------------------------
   */

  private startGameLoop(): void {
    this.lastFrameTime = performance.now();

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((time) => this.update(time));
    });
  }

  /*
   * -------------------------------------------------------
   * GAME LOOP
   * -------------------------------------------------------
   *
   * This runs continuously.
   *
   * deltaTime = elapsed time since previous frame
   * in seconds.
   */

  private update(time: number): void {
    const deltaTime = Math.min((time - this.lastFrameTime) / 1000, 0.1);

    this.lastFrameTime = time;

    /*
     * Update all moving fleets.
     */

    const didMoveFleets = this.updateFleets(deltaTime);

    /*
     * Tell Angular that values used by the
     * template have changed.
     */

    if (didMoveFleets) {
      this.ngZone.run(() => this.cdr.detectChanges());
    }

    /*
     * Schedule next frame.
     */

    this.ngZone.runOutsideAngular(() => {
      this.animationFrameId = requestAnimationFrame((nextTime) => this.update(nextTime));
    });
  }

  /*
   * -------------------------------------------------------
   * UPDATE FLEETS
   * -------------------------------------------------------
   */

  private updateFleets(deltaTime: number): boolean {
    let didMoveFleets = false;

    for (const fleet of this.fleets) {
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

    return didMoveFleets;
  }

  /*
   * -------------------------------------------------------
   * SELECT FLEET
   * -------------------------------------------------------
   */

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

  /*
   * -------------------------------------------------------
   * OVERLAP-AWARE CLICK HANDLERS
   * -------------------------------------------------------
   */

  onFleetClick(fleet: Fleet, event: MouseEvent): void {
    event.stopPropagation();

    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    if (this.currentView === 'map') {
      this.handleMapObjectClick(fleet.gridCol, fleet.gridRow, event);
    } else if (this.selectedSystem) {
      this.handleSystemObjectClick(fleet.gridCol, fleet.gridRow, this.selectedSystem, event);
    } else {
      this.selectFleet(fleet);
    }
  }

  onSystemClick(system: StarSystem, event: MouseEvent): void {
    event.stopPropagation();

    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

    if (this.currentView === 'map') {
      this.handleMapObjectClick(system.gridCol, system.gridRow, event);
    } else {
      this.selectSystem(system);
    }
  }

  onPlanetClick(planet: PlanetTile, event: MouseEvent): void {
    event.stopPropagation();

    if (this.contextMenu) {
      this.closeContextMenu();
      return;
    }

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
    this.cameraX = Math.max(0, Math.min(this.cameraX, this.mapWidth));

    this.cameraY = Math.max(0, Math.min(this.cameraY, this.mapHeight));
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);

      this.animationFrameId = null;
    }
  }
}

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

interface PlanetBuilding {
  name: string;
  count: number;
}

type PlanetType = 'earthlike' | 'marslike' | 'venuslike' | 'gasgiant' | 'ice' | 'desert';
type PlanetSize = 'huge' | 'big' | 'medium' | 'small' | 'tiny';

interface PlanetTile {
  id: number;
  index: number;
  name: string;
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
}

interface Ship {
  id: number;
  name: string;

  /*
   * Current position in world coordinates.
   */
  x: number;
  y: number;

  /*
   * Destination.
   * null = ship is idle.
   */
  targetX: number | null;
  targetY: number | null;

  /*
   * Movement speed in world units / second.
   */
  speed: number;

  /*
   * System-level properties
   */
  systemId?: number;
  systemX?: number | null;
  systemY?: number | null;
  systemTargetX?: number | null;
  systemTargetY?: number | null;
}

interface StarMapData {
  map: {
    width: number;
    height: number;
    cellSizeVw: number;
    cellSizeVh: number;
  };
  starSystems: StarSystem[];
  ships: Ship[];
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

      for (const ship of this.ships) {
        if (this.isShipInSystem(ship, this.selectedSystem)) {
          ship.systemId = this.selectedSystem.id;
          if (ship.systemX == null) {
            ship.systemX = 2.5;
            ship.systemY = 32.5;
          }
        }
      }

      if (this.selectedShip && this.selectedShip.systemTargetX != null) {
        this.targetX = this.selectedShip.systemTargetX ?? null;
        this.targetY = this.selectedShip.systemTargetY ?? null;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    }
  }

  leaveSystem(): void {
    this.currentView = 'map';

    if (this.selectedShip && this.selectedShip.targetX != null) {
      this.targetX = this.selectedShip.targetX;
      this.targetY = this.selectedShip.targetY;
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

  // A csillagrendszerek és hajók most már közvetlenül a JSON-ból jönnek
  starSystems: StarSystem[] = initialStarMapData.starSystems;
  ships: Ship[] = initialStarMapData.ships;

  calculateGridCell(x: number, y: number): { col: number; row: number } {
    const col = Math.floor(x / this.cellSizeVw) + 1;
    const row = Math.floor(y / this.cellSizeVh) + 1;

    return { col, row };
  }

  isShipInSystem(ship: Ship, system: StarSystem): boolean {
    const shipCell = this.calculateGridCell(ship.x, ship.y);
    const sysCell = this.calculateGridCell(system.x, system.y);
    return shipCell.col === sysCell.col && shipCell.row === sysCell.row;
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
  selectedShip: Ship | null = null;
  selectedPlanetTile: PlanetTile | null = null;

  targetX: number | null = null;
  targetY: number | null = null;

  private animationFrameId: number | null = null;
  private lastFrameTime = 0;

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
  ) {}

  // A korábbi random generálás törölve lett, mert minden a JSON-ból töltődik be
  ngOnInit(): void {}

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
     * Update all moving ships.
     */

    const didMoveShips = this.updateShips(deltaTime);

    /*
     * Tell Angular that values used by the
     * template have changed.
     */

    if (didMoveShips) {
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
   * UPDATE SHIPS
   * -------------------------------------------------------
   */

  private updateShips(deltaTime: number): boolean {
    let didMoveShips = false;

    for (const ship of this.ships) {
      // Map movement
      if (ship.targetX !== null && ship.targetY !== null) {
        didMoveShips = true;

        const dx = ship.targetX - ship.x;
        const dy = ship.targetY - ship.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const movement = ship.speed * deltaTime;

        if (distance <= movement) {
          ship.x = ship.targetX;
          ship.y = ship.targetY;
          ship.targetX = null;
          ship.targetY = null;

          if (this.selectedShip?.id === ship.id && this.currentView === 'map') {
            this.targetX = null;
            this.targetY = null;
          }
        } else {
          ship.x += (dx / distance) * movement;
          ship.y += (dy / distance) * movement;
        }

        // If the ship moved on the world map, check if it left its current system
        if (ship.systemId !== undefined) {
          const system = this.starSystems.find((s) => s.id === ship.systemId);
          if (system && !this.isShipInSystem(ship, system)) {
            ship.systemId = undefined;
            ship.systemX = null;
            ship.systemY = null;
            ship.systemTargetX = null;
            ship.systemTargetY = null;
          }
        }
      }

      // System movement
      if (ship.systemTargetX != null && ship.systemTargetY != null) {
        didMoveShips = true;

        const dx = ship.systemTargetX - (ship.systemX || 0);
        const dy = ship.systemTargetY - (ship.systemY || 0);
        const distance = Math.sqrt(dx * dx + dy * dy);
        const movement = ship.speed * deltaTime;

        if (distance <= movement) {
          ship.systemX = ship.systemTargetX;
          ship.systemY = ship.systemTargetY;
          ship.systemTargetX = null;
          ship.systemTargetY = null;

          if (this.selectedShip?.id === ship.id && this.currentView === 'system') {
            this.targetX = null;
            this.targetY = null;
          }
        } else {
          ship.systemX = (ship.systemX || 0) + (dx / distance) * movement;
          ship.systemY = (ship.systemY || 0) + (dy / distance) * movement;
        }
      }
    }

    return didMoveShips;
  }

  /*
   * -------------------------------------------------------
   * SELECT SHIP
   * -------------------------------------------------------
   */

  selectShip(ship: Ship): void {
    this.selectedShip = ship;

    if (this.currentView === 'map') {
      this.cameraX = ship.x - 50;
      this.cameraY = ship.y - 50;
      this.clampCamera();
    }

    if (this.currentView === 'system') {
      if (ship.systemTargetX != null && ship.systemTargetY != null) {
        this.targetX = ship.systemTargetX ?? null;
        this.targetY = ship.systemTargetY ?? null;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    } else {
      if (ship.targetX !== null && ship.targetY !== null) {
        this.targetX = ship.targetX;
        this.targetY = ship.targetY;
      } else {
        this.targetX = null;
        this.targetY = null;
      }
    }
  }

  deselectShip(): void {
    this.selectedShip = null;
    this.targetX = null;
    this.targetY = null;
  }

  deselectSystem(): void {
    this.selectedSystem = null;
  }

  deselectPlanetTile(): void {
    this.selectedPlanetTile = null;
  }

  /*
   * -------------------------------------------------------
   * GIVE MOVEMENT ORDER
   * -------------------------------------------------------
   */

  moveSelectedShip(x: number, y: number): void {
    if (!this.selectedShip) {
      return;
    }

    if (this.currentView === 'system') {
      // Only allow movement in system if the ship is actually in this system
      if (this.selectedSystem && this.selectedShip.systemId === this.selectedSystem.id) {
        this.selectedShip.systemTargetX = x;
        this.selectedShip.systemTargetY = y;
        this.targetX = x;
        this.targetY = y;
      }
    } else {
      this.selectedShip.targetX = x;
      this.selectedShip.targetY = y;
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
  }

  /*
   * -------------------------------------------------------
   * MAP CLICK
   * -------------------------------------------------------
   */

  onMapClick(event: MouseEvent): void {
    /*
     * No selected ship = no movement order.
     */

    if (!this.selectedShip) {
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

    this.moveSelectedShip(targetTile.x, targetTile.y);
  }

  onSystemGridClick(event: MouseEvent): void {
    if (
      !this.selectedShip ||
      !this.selectedSystem ||
      this.selectedShip.systemId !== this.selectedSystem.id
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

    this.moveSelectedShip(targetTile.x, targetTile.y);
  }

  /*
   * -------------------------------------------------------
   * SELECT STAR SYSTEM
   * -------------------------------------------------------
   */

  selectSystem(system: StarSystem): void {
    this.selectedSystem = system;

    // Ha van kiválasztott hajó, és a világtérképen vagyunk, menjen oda a hajó
    if (this.selectedShip && this.currentView === 'map') {
      const targetTile = this.getTileCenter(system.x, system.y);
      this.moveSelectedShip(targetTile.x, targetTile.y);
    }
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

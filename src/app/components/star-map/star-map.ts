import {
  Component,
  HostListener,
  OnDestroy,
  ChangeDetectorRef,
  NgZone,
  AfterViewInit
} from '@angular/core';

import { StarMapNavigationComponent } from '../star-map-navigation/star-map-navigation.component';

interface PlanetTile {
  id: number;
  index: number;
  x: number;
  y: number;
  xOffset: number;
  yOffset: number;
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
}

@Component({
  selector: 'app-star-map',
  imports: [StarMapNavigationComponent],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements AfterViewInit, OnDestroy {

  /*
   * -------------------------------------------------------
   * MAP
   * -------------------------------------------------------
   *
   * Coordinates are world coordinates.
   *
   * The world is deliberately larger than the viewport.
   */

  readonly mapWidth = 200;
  readonly mapHeight = 120;

  readonly cellSizeVw = 5;
  readonly cellSizeVh = 5;

  gridColumns = Math.ceil(this.mapWidth / this.cellSizeVw);
  gridRows = Math.ceil(this.mapHeight / this.cellSizeVh);

  calculateGridCell(x: number, y: number): { col: number; row: number } {
    const col = Math.floor(x / this.cellSizeVw) + 1;
    const row = Math.floor(y / this.cellSizeVh) + 1;

    return {
      col,
      row
    };
  }

  private getTileCenter(
    x: number,
    y: number
  ): { x: number; y: number } {
    const tileColumn =
      Math.max(
        0,
        Math.min(
          Math.floor(x / this.cellSizeVw),
          this.gridColumns - 1
        )
      );

    const tileRow =
      Math.max(
        0,
        Math.min(
          Math.floor(y / this.cellSizeVh),
          this.gridRows - 1
        )
      );

    return {
      x:
        tileColumn * this.cellSizeVw +
        this.cellSizeVw / 2,
      y:
        tileRow * this.cellSizeVh +
        this.cellSizeVh / 2
    };
  }


  /*
   * -------------------------------------------------------
   * CAMERA
   * -------------------------------------------------------
   */

  cameraX = 0;
  cameraY = 0;

  readonly cameraSpeed = 2;


  /*
   * -------------------------------------------------------
   * STAR SYSTEMS
   * -------------------------------------------------------
   */

  starSystems: StarSystem[] = [

    {
      id: 1,
      name: 'SOL',
      x: 35,
      y: 25,
      planets: 8,
      color: '#f3f3f3',
      planetsTiles: [
        { id: 1, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 2, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 3, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 4, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 5, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 6, index: 6, x: -20, y: -50, xOffset: 0, yOffset: 0 },
        { id: 7, index: 7, x: 0, y: -50, xOffset: 0, yOffset: 0 },
        { id: 8, index: 8, x: 20, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 2,
      name: 'VEGA',
      x: 78,
      y: 18,
      planets: 5,
      color: '#5ca8ff',
      planetsTiles: [
        { id: 9, index: 1, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 10, index: 2, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 11, index: 3, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 12, index: 4, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 13, index: 5, x: -20, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 3,
      name: 'SIRIUS',
      x: 125,
      y: 35,
      planets: 6,
      color: '#f3f3f3',
      planetsTiles: [
        { id: 14, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 15, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 16, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 17, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 18, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 19, index: 6, x: -20, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 4,
      name: 'ARCTURUS',
      x: 165,
      y: 22,
      planets: 3,
      color: '#39b8a8',
      planetsTiles: [
        { id: 20, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 21, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 22, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 5,
      name: 'RIGEL',
      x: 55,
      y: 65,
      planets: 7,
      color: '#5ca8ff',
      planetsTiles: [
        { id: 23, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 24, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 25, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 26, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 27, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 28, index: 6, x: -20, y: -50, xOffset: 0, yOffset: 0 },
        { id: 29, index: 7, x: 0, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 6,
      name: 'ALTAIR',
      x: 105,
      y: 75,
      planets: 4,
      color: '#f3f3f3',
      planetsTiles: [
        { id: 30, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 31, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 32, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 33, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 7,
      name: 'BETELGEUSE',
      x: 155,
      y: 68,
      planets: 9,
      color: '#d65757',
      planetsTiles: [
        { id: 34, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 35, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 36, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 37, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 38, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 39, index: 6, x: -20, y: -50, xOffset: 0, yOffset: 0 },
        { id: 40, index: 7, x: 0, y: -50, xOffset: 0, yOffset: 0 },
        { id: 41, index: 8, x: 20, y: -50, xOffset: 0, yOffset: 0 },
        { id: 42, index: 9, x: 40, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 8,
      name: 'PROCYON',
      x: 25,
      y: 95,
      planets: 2,
      color: '#39b8a8',
      planetsTiles: [
        { id: 43, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 44, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 9,
      name: 'DENEB',
      x: 90,
      y: 105,
      planets: 5,
      color: '#5ca8ff',
      planetsTiles: [
        { id: 45, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 46, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 47, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 48, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 49, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
      ],
    },

    {
      id: 10,
      name: 'ANTARES',
      x: 175,
      y: 100,
      planets: 6,
      color: '#d65757',
      planetsTiles: [
        { id: 50, index: 1, x: -120, y: -50, xOffset: 0, yOffset: 0 },
        { id: 51, index: 2, x: -100, y: -50, xOffset: 0, yOffset: 0 },
        { id: 52, index: 3, x: -80, y: -50, xOffset: 0, yOffset: 0 },
        { id: 53, index: 4, x: -60, y: -50, xOffset: 0, yOffset: 0 },
        { id: 54, index: 5, x: -40, y: -50, xOffset: 0, yOffset: 0 },
        { id: 55, index: 6, x: -20, y: -50, xOffset: 0, yOffset: 0 },
      ],
    }

  ];


  /*
   * -------------------------------------------------------
   * SHIPS
   * -------------------------------------------------------
   */

  ships: Ship[] = [

    {
      id: 1,
      name: 'ORION',
      x: 50,
      y: 40,
      targetX: null,
      targetY: null,
      speed: 8
    },

    {
      id: 2,
      name: 'PEGASUS',
      x: 120,
      y: 60,
      targetX: null,
      targetY: null,
      speed: 6
    }

  ];


  /*
   * -------------------------------------------------------
   * SELECTED OBJECTS
   * -------------------------------------------------------
   */

  selectedSystem: StarSystem | null = null;

  selectedShip: Ship | null = null;

  selectedPlanetTile: PlanetTile | null = null;


  /*
   * -------------------------------------------------------
   * CURRENT SHIP TARGET
   * -------------------------------------------------------
   */

  targetX: number | null = null;

  targetY: number | null = null;


  /*
   * -------------------------------------------------------
   * REALTIME GAME LOOP
   * -------------------------------------------------------
   */

  private animationFrameId: number | null = null;

  private lastFrameTime = 0;


  /*
   * -------------------------------------------------------
   * CONSTRUCTOR
   * -------------------------------------------------------
   */

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {

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

    this.ngZone.runOutsideAngular(
      () => {
        this.animationFrameId =
          requestAnimationFrame(
            (time) => this.update(time)
          );
      }
    );

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

    const deltaTime =
      Math.min(
        (time - this.lastFrameTime) / 1000,
        0.1
      );

    this.lastFrameTime = time;


    /*
     * Update all moving ships.
     */

    const didMoveShips =
      this.updateShips(deltaTime);


    /*
     * Tell Angular that values used by the
     * template have changed.
     */

    if (didMoveShips) {

      this.ngZone.run(
        () => this.cdr.detectChanges()
      );

    }


    /*
     * Schedule next frame.
     */

    this.ngZone.runOutsideAngular(
      () => {
        this.animationFrameId =
          requestAnimationFrame(
            (nextTime) => this.update(nextTime)
          );
      }
    );

  }


  /*
   * -------------------------------------------------------
   * UPDATE SHIPS
   * -------------------------------------------------------
   */

  private updateShips(deltaTime: number): boolean {

    let didMoveShips = false;

    for (const ship of this.ships) {

      /*
       * No destination = ship is idle.
       */

      if (
        ship.targetX === null ||
        ship.targetY === null
      ) {

        continue;

      }

      didMoveShips = true;


      /*
       * Distance from ship to target.
       */

      const dx =
        ship.targetX - ship.x;

      const dy =
        ship.targetY - ship.y;

      const distance =
        Math.sqrt(
          dx * dx +
          dy * dy
        );


      /*
       * Has the ship reached its destination?
       */

      const movement =
        ship.speed * deltaTime;

      if (distance <= movement) {

        ship.x = ship.targetX;
        ship.y = ship.targetY;

        ship.targetX = null;
        ship.targetY = null;

        /*
         * Clear target marker if this was
         * the selected ship.
         */

        if (this.selectedShip?.id === ship.id) {

          this.targetX = null;
          this.targetY = null;

        }

        continue;

      }


      /*
       * Normalize direction.
       */

      const directionX =
        dx / distance;

      const directionY =
        dy / distance;


      /*
       * Move ship according to elapsed time.
       */

      ship.x +=
        directionX *
        movement;

      ship.y +=
        directionY *
        movement;

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


    /*
     * If the ship already has a destination,
     * show it.
     */

    if (
      ship.targetX !== null &&
      ship.targetY !== null
    ) {

      this.targetX = ship.targetX;
      this.targetY = ship.targetY;

    } else {

      this.targetX = null;
      this.targetY = null;

    }

  }


  /*
   * -------------------------------------------------------
   * GIVE MOVEMENT ORDER
   * -------------------------------------------------------
   */

  moveSelectedShip(
    x: number,
    y: number
  ): void {

    if (!this.selectedShip) {

      return;

    }


    this.selectedShip.targetX = x;
    this.selectedShip.targetY = y;


    /*
     * Show destination marker.
     */

    this.targetX = x;
    this.targetY = y;

  }


  /*
   * -------------------------------------------------------
   * SELECT PLANET TILE
   * -------------------------------------------------------
   */

  selectPlanetTile(
    tile: PlanetTile
  ): void {

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


    const viewport =
      event.currentTarget as HTMLElement;

    const rect =
      viewport.getBoundingClientRect();


    /*
     * Mouse position inside viewport.
     */

    const screenX =
      event.clientX - rect.left;

    const screenY =
      event.clientY - rect.top;


    /*
     * Convert viewport pixels to the same vw-based
     * world units used by the grid and camera transform.
     */

    const viewportUnitInPixels =
      window.innerWidth / 100;

    const worldX =
      this.cameraX +
      screenX / viewportUnitInPixels;

    const worldY =
      this.cameraY +
      screenY / viewportUnitInPixels;


    /*
     * The command belongs to the clicked tile,
     * so store the destination at that tile's center.
     */

    const targetTile =
      this.getTileCenter(
        worldX,
        worldY
      );


    /*
     * Give movement order.
     */

    this.moveSelectedShip(
      targetTile.x,
      targetTile.y
    );

  }


  /*
   * -------------------------------------------------------
   * SELECT STAR SYSTEM
   * -------------------------------------------------------
   */

  selectSystem(
    system: StarSystem
  ): void {

    this.selectedSystem = system;

  }


  /*
   * -------------------------------------------------------
   * CAMERA MOVEMENT
   * -------------------------------------------------------
   */

  moveCamera(
    direction:
      'up' |
      'down' |
      'left' |
      'right'
  ): void {

    switch (direction) {

      case 'up':

        this.cameraY -=
          this.cameraSpeed;

        break;


      case 'down':

        this.cameraY +=
          this.cameraSpeed;

        break;


      case 'left':

        this.cameraX -=
          this.cameraSpeed;

        break;


      case 'right':

        this.cameraX +=
          this.cameraSpeed;

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

    this.cameraX =
      Math.max(
        0,
        Math.min(
          this.cameraX,
          this.mapWidth
        )
      );


    this.cameraY =
      Math.max(
        0,
        Math.min(
          this.cameraY,
          this.mapHeight
        )
      );

  }


  /*
   * -------------------------------------------------------
   * KEYBOARD
   * -------------------------------------------------------
   */

  @HostListener(
    'window:keydown',
    ['$event']
  )
  handleKeyboard(
    event: KeyboardEvent
  ): void {

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

    if (
      this.animationFrameId !== null
    ) {

      cancelAnimationFrame(
        this.animationFrameId
      );

      this.animationFrameId = null;

    }

  }

}

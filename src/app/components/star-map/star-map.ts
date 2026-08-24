import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy
} from '@angular/core';

interface StarSystem {
  id: number;
  name: string;
  x: number;
  y: number;
  planets: number;
  color: string;
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
  imports: [],
  templateUrl: './star-map.html',
  styleUrl: './star-map.scss',
})
export class StarMap implements OnDestroy {

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
      color: '#f3f3f3'
    },

    {
      id: 2,
      name: 'VEGA',
      x: 78,
      y: 18,
      planets: 5,
      color: '#5ca8ff'
    },

    {
      id: 3,
      name: 'SIRIUS',
      x: 125,
      y: 35,
      planets: 6,
      color: '#f3f3f3'
    },

    {
      id: 4,
      name: 'ARCTURUS',
      x: 165,
      y: 22,
      planets: 3,
      color: '#39b8a8'
    },

    {
      id: 5,
      name: 'RIGEL',
      x: 55,
      y: 65,
      planets: 7,
      color: '#5ca8ff'
    },

    {
      id: 6,
      name: 'ALTAIR',
      x: 105,
      y: 75,
      planets: 4,
      color: '#f3f3f3'
    },

    {
      id: 7,
      name: 'BETELGEUSE',
      x: 155,
      y: 68,
      planets: 9,
      color: '#d65757'
    },

    {
      id: 8,
      name: 'PROCYON',
      x: 25,
      y: 95,
      planets: 2,
      color: '#39b8a8'
    },

    {
      id: 9,
      name: 'DENEB',
      x: 90,
      y: 105,
      planets: 5,
      color: '#5ca8ff'
    },

    {
      id: 10,
      name: 'ANTARES',
      x: 175,
      y: 100,
      planets: 6,
      color: '#d65757'
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
    private cdr: ChangeDetectorRef
  ) {

    this.startGameLoop();

  }


  /*
   * -------------------------------------------------------
   * START GAME LOOP
   * -------------------------------------------------------
   */

  private startGameLoop(): void {

    this.lastFrameTime = performance.now();

    this.animationFrameId =
      requestAnimationFrame(
        (time) => this.update(time)
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

    this.updateShips(deltaTime);


    /*
     * Tell Angular that values used by the
     * template have changed.
     */

    this.cdr.detectChanges();


    /*
     * Schedule next frame.
     */

    this.animationFrameId =
      requestAnimationFrame(
        (nextTime) => this.update(nextTime)
      );

  }


  /*
   * -------------------------------------------------------
   * UPDATE SHIPS
   * -------------------------------------------------------
   */

  private updateShips(deltaTime: number): void {

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
     * Convert viewport coordinates
     * to world coordinates.
     */

    const worldX =
      this.cameraX +
      (screenX / rect.width) * 100;

    const worldY =
      this.cameraY +
      (screenY / rect.height) * 100;


    /*
     * Keep target inside the world.
     */

    const clampedX =
      Math.max(
        0,
        Math.min(
          worldX,
          this.mapWidth
        )
      );

    const clampedY =
      Math.max(
        0,
        Math.min(
          worldY,
          this.mapHeight
        )
      );


    /*
     * Give movement order.
     */

    this.moveSelectedShip(
      clampedX,
      clampedY
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
import { Injectable } from '@angular/core';
import { Fleet, StarSystem, PlanetTile, ContextMenuItem } from './star-map.models';
import { StarMapTerrainService } from './star-map-terrain.service';
import { NavPoint, RouteFailure, RoutePlan } from './fleet-navigation';

/*
 * Route the movement service is currently flying for a fleet. Cached per
 * fleet object (not persisted): it is re-planned whenever the fleet's
 * target differs from the one it was planned for, which also covers saves
 * loaded with an old straight-line order through a black hole.
 */
interface ActiveRoute {
  targetX: number;
  targetY: number;
  waypoints: NavPoint[];
}

/*
 * =========================================================
 * STAR MAP MOVEMENT SERVICE
 * =========================================================
 *
 * Handles fleet movement, grid cell calculation,
 * coordinate conversion, and position refreshing.
 *
 * Coordinate system:
 * - Star systems and fleets use 1-indexed grid cell coordinates
 *   for x/y (e.g., x=53 means the 53rd column from the left).
 * - Grid cells are rendered as `cellSizeVw` vw wide and `cellSizeVh` vw tall.
 * - Fleet positions can be fractional within a cell for smooth movement.
 * - Fleet speed is in vw/s at the reference cell size; galaxy movement
 *   converts it to cells/s via speed / 10 / GALAXY_MOVEMENT_CELL_SIZE_VW.
 *   The *rendered* cell size (cellSizeVw: 2 desktop, 3.5 mobile) is never
 *   used for simulation, so travel time does not depend on window width.
 *
 * The system view (inside star systems) uses a separate fixed 18x10 grid
 * with 5vw cells. System view positions (systemX/Y) remain in vw units.
 *
 * Galaxy terrain (docs/star-map-terrain.md), applied to every fleet alike:
 * - Black holes: `Fleet.targetX/targetY` is always the final destination;
 *   the service plans a route around black-hole no-fly zones
 *   (fleet-navigation.ts) and flies its waypoints first. A target that
 *   cannot be reached safely clears the order (the fleet stays put) and
 *   reports it through `onRouteBlocked`.
 * - Nebulae: the per-step galaxy speed is multiplied by the nebula factor
 *   at the fleet's current position.
 */

@Injectable({ providedIn: 'root' })
export class StarMapMovementService {
  cellSizeVw: number = 0;
  cellSizeVh: number = 0;
  gridColumns = 0;
  gridRows = 0;

  private static readonly SYSTEM_CELL_SIZE_VW = 5;

  /*
   * Fixed vw-per-cell used to convert fleet speed to galaxy cells/s. It
   * equals the desktop render size (2), which every balance value was tuned
   * against (AI colonization reach and timeouts assume 0.2 cells/s for
   * speed 4). Using the render cell size instead made fleets ~43% slower
   * below the 1300px breakpoint and let a window resize change game speed.
   */
  static readonly GALAXY_MOVEMENT_CELL_SIZE_VW = 2;

  static get systemCellSizeVw(): number {
    return StarMapMovementService.SYSTEM_CELL_SIZE_VW;
  }

  private readonly routes = new WeakMap<Fleet, ActiveRoute>();

  // The default keeps `new StarMapMovementService()` (unit tests) working
  // with empty terrain; Angular DI always passes the shared instance.
  constructor(private readonly terrain: StarMapTerrainService = new StarMapTerrainService()) {}

  /* Open-space galaxy speed of a fleet in grid cells per game second. */
  static galaxyCellsPerSecond(fleet: Pick<Fleet, 'speed'>): number {
    return fleet.speed / 10 / StarMapMovementService.GALAXY_MOVEMENT_CELL_SIZE_VW;
  }

  /* Plans a galaxy route against the current terrain (no fleet state is touched). */
  planGalaxyRoute(from: NavPoint, to: NavPoint): RoutePlan {
    return this.terrain.navGraph.plan(from, to);
  }

  /*
   * Returns the route the fleet is flying toward its current target,
   * planning it if the target changed. Returns null when the fleet has no
   * galaxy target or the target is unreachable.
   */
  getActiveRoute(fleet: Fleet): { waypoints: readonly NavPoint[] } | null {
    if (fleet.targetX === null || fleet.targetY === null) {
      return null;
    }
    const route = this.ensureRoute(fleet);
    return 'failure' in route ? null : route;
  }

  private ensureRoute(fleet: Fleet): ActiveRoute | { failure: RouteFailure } {
    const targetX = fleet.targetX as number;
    const targetY = fleet.targetY as number;
    const cached = this.routes.get(fleet);
    if (cached && cached.targetX === targetX && cached.targetY === targetY) {
      return cached;
    }
    const plan = this.planGalaxyRoute({ x: fleet.x, y: fleet.y }, { x: targetX, y: targetY });
    if (!plan.ok) {
      this.routes.delete(fleet);
      return { failure: plan.reason };
    }
    const route: ActiveRoute = { targetX, targetY, waypoints: plan.waypoints.map((p) => ({ ...p })) };
    this.routes.set(fleet, route);
    return route;
  }

  /*
   * Game seconds the fleet still needs to reach its galaxy target along its
   * route, including nebula slowdown. Null when it has no target or no route.
   */
  estimateRemainingTravelSeconds(fleet: Fleet): number | null {
    const route = this.getActiveRoute(fleet);
    if (!route) {
      return null;
    }
    const points = [
      { x: fleet.x, y: fleet.y },
      ...route.waypoints,
      { x: fleet.targetX as number, y: fleet.targetY as number },
    ];
    return this.terrain.nebulaField.pathTravelSeconds(points, StarMapMovementService.galaxyCellsPerSecond(fleet));
  }

  /*
   * Game seconds a fleet with `cellsPerSecond` open-space speed needs from
   * `from` to `to` (route around black holes + nebula slowdown). Infinity
   * when no safe route exists.
   */
  estimateTravelSeconds(from: NavPoint, to: NavPoint, cellsPerSecond: number): number {
    const plan = this.planGalaxyRoute(from, to);
    if (!plan.ok) {
      return Infinity;
    }
    return this.terrain.nebulaField.pathTravelSeconds([from, ...plan.waypoints, to], cellsPerSecond);
  }

  /*
   * initialize: Set grid dimensions.
   * gridColumns and gridRows are the actual grid dimensions (in cells),
   * read directly from map.width/height in the data file.
   * cellSizeVw/Vh is the vw size per cell (2 desktop, 3.5 mobile).
   */
  initialize(cellSizeVw: number, cellSizeVh: number, mapWidth: number, mapHeight: number): void {
    this.cellSizeVw = cellSizeVw;
    this.cellSizeVh = cellSizeVh;
    this.gridColumns = mapWidth;
    this.gridRows = mapHeight;
  }

  /*
   * calculateGridCell: Snaps 1-indexed grid cell coordinates to integer cells.
   * Accepts fractional grid positions (e.g., 6.5) and returns the containing
   * integer cell (e.g., 6). Used for collision detection and placement.
   */
  calculateGridCell(x: number, y: number): { col: number; row: number } {
    return {
      col: Math.floor(x),
      row: Math.floor(y),
    };
  }

  /*
    * getSystemTileCenter: Snaps system view vw coordinates to the center of the
    * containing system grid cell. Returns vw coordinates for system view movement.
    * The system view uses a fixed 18x10 grid with 5vw cells.
    */
  getSystemTileCenter(vwX: number, vwY: number): { x: number; y: number } {
    const col = Math.floor(vwX / StarMapMovementService.SYSTEM_CELL_SIZE_VW);
    const row = Math.floor(vwY / StarMapMovementService.SYSTEM_CELL_SIZE_VW);
    return {
      x:
        col * StarMapMovementService.SYSTEM_CELL_SIZE_VW +
        StarMapMovementService.SYSTEM_CELL_SIZE_VW / 2,
      y:
        row * StarMapMovementService.SYSTEM_CELL_SIZE_VW +
        StarMapMovementService.SYSTEM_CELL_SIZE_VW / 2,
    };
  }

  /*
    * calculateSystemGridCell: Converts system view vw coordinates to grid cells.
    * The system view uses a fixed 18x10 grid with 5vw cells.
    * Returns 1-indexed grid positions.
    */
  calculateSystemGridCell(vwX: number, vwY: number): { col: number; row: number } {
    return {
      col: Math.floor(vwX / StarMapMovementService.SYSTEM_CELL_SIZE_VW) + 1,
      row: Math.floor(vwY / StarMapMovementService.SYSTEM_CELL_SIZE_VW) + 1,
    };
  }

  /*
   * isFleetInSystem: Checks if a fleet is within the grid cell of a star system.
   * Both fleet.x/y and system.x/y are 1-indexed map grid cell coordinates.
   */
  isFleetInSystem(fleet: Fleet, system: StarSystem): boolean {
    const fleetCell = this.calculateGridCell(fleet.x, fleet.y);
    const sysCell = this.calculateGridCell(system.x, system.y);
    return fleetCell.col === sysCell.col && fleetCell.row === sysCell.row;
  }

  /* System-view (vw) center of a planet's cell: the point a fleet must stop on to arrive at the planet. */
  getPlanetCellCenter(planet: PlanetTile): { x: number; y: number } {
    const cell = this.getPlanetGridPosition(planet);
    const size = StarMapMovementService.systemCellSizeVw;
    return { x: (cell.col - 0.5) * size, y: (cell.row - 0.5) * size };
  }

  /*
   * getPlanetGridPosition: Returns the planet's grid position in system view.
   * Uses planet.x and planet.y as 1-indexed column/row coordinates.
   * Falls back to the index-based formula if values are out of bounds.
   */
  getPlanetGridPosition(planet: PlanetTile): { col: number; row: number } {
    const col = planet.x;
    const row = planet.y;
    if (col < 1 || col > 18 || row < 1 || row > 10) {
      return {
        col: Math.max(1, 14 - planet.index * 2),
        row: 1 + ((planet.index * 3 + (planet.index % 2)) % 7),
      };
    }
    return { col, row };
  }

  /*
   * getTileCenter: Converts vw world coordinates to the 1-indexed grid cell
   * that contains them. The returned grid cell IS the center of that cell
   * in grid cell space (since cell N covers vw range [(N-1)*cellSize, N*cellSize)
   * and its center is N in 1-indexed space).
   * Used for map click-to-move targeting.
   */
  getTileCenter(vwX: number, vwY: number): { x: number; y: number } {
    const col = Math.floor(vwX / this.cellSizeVw) + 1;
    const row = Math.floor(vwY / this.cellSizeVh) + 1;
    return { x: col, y: row };
  }

  /*
   * updateFleets: Processes fleet movement for one frame.
   * Returns true if any fleet moved.
   */
  updateFleets(
    fleets: Fleet[],
    starSystems: StarSystem[],
    selectedFleetId: number | null,
    currentView: 'map' | 'system' | 'planet',
    deltaTime: number,
    onTargetReached: (fleetId: number) => void,
    onLeaveSystem: (fleetId: number) => void,
    onRouteBlocked?: (fleetId: number, reason: RouteFailure) => void,
  ): boolean {
    let didMoveFleets = false;

    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      // Map movement (fleet.x/y are 1-indexed grid cell coordinates)
      if (fleet.targetX !== null && fleet.targetY !== null) {
        const route = this.ensureRoute(fleet);
        if ('failure' in route) {
          // Never fly straight through a black hole as a fallback: drop the
          // order and leave the fleet where it is.
          fleet.targetX = null;
          fleet.targetY = null;
          if (fleet.interceptAsteroidId != null) {
            fleet.interceptAsteroidId = null;
          }
          if (fleet.attackFleetId != null) {
            fleet.attackFleetId = null;
          }
          onRouteBlocked?.(fleet.id, route.failure);
          continue;
        }
        didMoveFleets = true;

        const waypoint = route.waypoints[0];
        const legX = waypoint ? waypoint.x : fleet.targetX;
        const legY = waypoint ? waypoint.y : fleet.targetY;
        const dx = legX - fleet.x;
        const dy = legY - fleet.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (waypoint && distance <= 0.01) {
          route.waypoints.shift();
        } else if (distance <= 0.01) {
          fleet.x = fleet.targetX;
          fleet.y = fleet.targetY;
          fleet.targetX = null;
          fleet.targetY = null;
          this.routes.delete(fleet);

          if (selectedFleetId === fleet.id && currentView === 'map') {
            onTargetReached(fleet.id);
          }
        } else {
          // Fleet speed is in vw/s; convert to grid cells/s.
          // Star map view uses 1/10 of the configured fleet speed so that
          // long-distance travel across the galaxy takes meaningful time.
          // Nebulae slow the fleet while its current position is inside one.
          const movement =
            StarMapMovementService.galaxyCellsPerSecond(fleet) *
            this.terrain.nebulaField.speedMultiplierAt(fleet.x, fleet.y) *
            deltaTime;
          const step = Math.min(movement, distance);
          fleet.x += (dx / distance) * step;
          fleet.y += (dy / distance) * step;
          if (waypoint && step >= distance) {
            // Land exactly on the waypoint so the next leg starts on the
            // validated route.
            fleet.x = waypoint.x;
            fleet.y = waypoint.y;
            route.waypoints.shift();
          }
        }

        const mapCell = this.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = mapCell.col;
        fleet.gridRow = mapCell.row;

        // Check if fleet left its current system
        if (fleet.system?.id != null) {
          const system = starSystems.find((s) => s.id === fleet.system?.id);
          if (system && !this.isFleetInSystem(fleet, system)) {
            onLeaveSystem(fleet.id);
          }
        }
      }

      // System movement
      if (fleet.system?.targetX != null && fleet.system?.targetY != null) {
        didMoveFleets = true;

        const dx = fleet.system.targetX - fleet.system.x;
        const dy = fleet.system.targetY - fleet.system.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= 0.01) {
          fleet.system.x = fleet.system.targetX;
          fleet.system.y = fleet.system.targetY;
          fleet.system.targetX = null;
          fleet.system.targetY = null;

          if (selectedFleetId === fleet.id && currentView === 'system') {
            onTargetReached(fleet.id);
          }
        } else {
          const movement = fleet.speed * deltaTime;
          const step = Math.min(movement, distance);
          fleet.system.x = fleet.system.x + (dx / distance) * step;
          fleet.system.y = fleet.system.y + (dy / distance) * step;
        }

        const sysCell = this.calculateSystemGridCell(fleet.system.x, fleet.system.y);
        fleet.gridCol = sysCell.col;
        fleet.gridRow = sysCell.row;
      }
    }

    return didMoveFleets;
  }

  /*
   * refreshGridPositions: Recalculates integer grid cells for all fleets and systems.
   * Fleet x/y and system x/y are 1-indexed grid cell coordinates; this snaps them
   * to integer cells for collision detection.
   */
  refreshGridPositions(fleets: Fleet[], starSystems: StarSystem[]): void {
    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.x != null && fleet.y != null) {
        const cell = this.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = cell.col;
        fleet.gridRow = cell.row;
      }
    }

    for (const system of starSystems) {
      const cell = this.calculateGridCell(system.x, system.y);
      system.gridCol = cell.col;
      system.gridRow = cell.row;
    }
  }

  /*
   * initializeCoordinates: Ensures all fleets and systems have grid cell
   * coordinates. Legacy vw->grid conversion is centralized in
   * SaveGameService.migrateSave so it is versioned and idempotent; the
   * grid columns/rows here come from the current map constants.
   */
  initializeCoordinates(fleets: Fleet[], starSystems: StarSystem[]): void {
    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      fleet.gridCol = Math.floor(fleet.x);
      fleet.gridRow = Math.floor(fleet.y);
    }

    for (const system of starSystems) {
      system.gridCol = Math.floor(system.x);
      system.gridRow = Math.floor(system.y);
    }
  }

  /*
   * getObjectsAtMapCell: Returns all fleets and star systems at a given map cell.
   */
  getObjectsAtMapCell(
    fleets: Fleet[],
    starSystems: StarSystem[],
    col: number,
    row: number,
  ): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const fleet of fleets) {
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

    for (const system of starSystems) {
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

  /*
   * getObjectsAtSystemCell: Returns all fleets and planets at a given system cell.
   */
  getObjectsAtSystemCell(
    fleets: Fleet[],
    system: StarSystem,
    col: number,
    row: number,
  ): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (fleet.system?.id === system.id) {
        const fleetCell = this.calculateSystemGridCell(fleet.system.x, fleet.system.y);
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

  /*
   * getGalaxyTrailVw: Converts a fleet's current position and target
   * (1-indexed grid cells) into vw coordinates suitable for rendering
   * a movement trail on the galaxy map.
   *
   * The fleet's center in vw is `(gridCell - 0.5) * cellSize`, matching the
   * positioning used by `.fleet-cell` in the galaxy view template.
   * Returns null when the fleet has no active target (not moving).
   */
  getGalaxyTrailVw(fleet: Fleet): { x1: number; y1: number; x2: number; y2: number } | null {
    if (fleet.targetX == null || fleet.targetY == null) {
      return null;
    }
    const x1 = (fleet.x - 0.5) * this.cellSizeVw;
    const y1 = (fleet.y - 0.5) * this.cellSizeVh;
    const x2 = (fleet.targetX - 0.5) * this.cellSizeVw;
    const y2 = (fleet.targetY - 0.5) * this.cellSizeVh;
    return { x1, y1, x2, y2 };
  }

  /*
   * getGalaxyTrailSegmentsVw: Like getGalaxyTrailVw, but one segment per
   * route leg (current position → waypoints around black holes → target),
   * so the rendered trail is the path the fleet will actually fly.
   */
  getGalaxyTrailSegmentsVw(fleet: Fleet): { x1: number; y1: number; x2: number; y2: number }[] {
    if (fleet.targetX == null || fleet.targetY == null) {
      return [];
    }
    const route = this.getActiveRoute(fleet);
    if (!route) {
      return [];
    }
    const points = [{ x: fleet.x, y: fleet.y }, ...route.waypoints, { x: fleet.targetX, y: fleet.targetY }];
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 1; i < points.length; i++) {
      segments.push({
        x1: (points[i - 1].x - 0.5) * this.cellSizeVw,
        y1: (points[i - 1].y - 0.5) * this.cellSizeVh,
        x2: (points[i].x - 0.5) * this.cellSizeVw,
        y2: (points[i].y - 0.5) * this.cellSizeVh,
      });
    }
    return segments;
  }

  /*
   * getSystemTrailVw: Returns a fleet's current system-view position and
   * target in vw units for rendering a movement trail inside a star system.
   * The system view uses vw units directly, so no conversion is needed.
   * Returns null when the fleet is not in the given system or has no target.
   */
  getSystemTrailVw(
    fleet: Fleet,
    systemId: string,
  ): { x1: number; y1: number; x2: number; y2: number } | null {
    if (!fleet.system || fleet.system.id !== systemId) {
      return null;
    }
    if (fleet.system.targetX == null || fleet.system.targetY == null) {
      return null;
    }
    return {
      x1: fleet.system.x,
      y1: fleet.system.y,
      x2: fleet.system.targetX,
      y2: fleet.system.targetY,
    };
  }
}

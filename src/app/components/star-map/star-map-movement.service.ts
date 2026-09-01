import { Injectable } from '@angular/core';
import { Fleet, StarSystem, PlanetTile, ContextMenuItem } from './star-map.models';

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
 * - Fleet speed is in vw/s; converted to cells/s via speed / cellSizeVw.
 *
 * The system view (inside star systems) uses a separate fixed 20x12 grid
 * with 5vw cells. System view positions (systemX/Y) remain in vw units.
 */

@Injectable({ providedIn: 'root' })
export class StarMapMovementService {
  cellSizeVw: number = 0;
  cellSizeVh: number = 0;
  gridColumns = 0;
  gridRows = 0;

  private static readonly SYSTEM_CELL_SIZE_VW = 5;

  constructor() {}

  /*
   * initialize: Set grid dimensions.
   * gridColumns and gridRows are the actual grid dimensions (in cells),
   * read directly from map.width/height in the data file.
   * cellSizeVw/Vh is the vw size per cell (2 desktop, 7 mobile).
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
   * The system view uses a fixed 20x12 grid with 5vw cells.
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
   * The system view uses a fixed 20x12 grid with 5vw cells.
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

  /*
   * getPlanetGridPosition: Returns grid position for a planet in system view.
   * Uses hardcoded formula to arrange planets in a semi-circle around the sun.
   */
  getPlanetGridPosition(planet: PlanetTile): { col: number; row: number } {
    return {
      col: 20 - planet.index * 2,
      row: 6 + (planet.index % 2 === 0 ? 1 : -1) * (planet.index % 3),
    };
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
  ): boolean {
    let didMoveFleets = false;

    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      // Map movement (fleet.x/y are 1-indexed grid cell coordinates)
      if (fleet.targetX !== null && fleet.targetY !== null) {
        didMoveFleets = true;

        const dx = fleet.targetX - fleet.x;
        const dy = fleet.targetY - fleet.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= 0.01) {
          fleet.x = fleet.targetX;
          fleet.y = fleet.targetY;
          fleet.targetX = null;
          fleet.targetY = null;

          if (selectedFleetId === fleet.id && currentView === 'map') {
            onTargetReached(fleet.id);
          }
        } else {
          // Fleet speed is in vw/s; convert to grid cells/s
          const movement = (fleet.speed / this.cellSizeVw) * deltaTime;
          const step = Math.min(movement, distance);
          console.log(
            `[Movement] Moving fleet ${fleet.id} from (${fleet.x}, ${fleet.y}) step=${step.toFixed(2)}`,
          );
          fleet.x += (dx / distance) * step;
          fleet.y += (dy / distance) * step;
          console.log(
            `[Movement] Fleet ${fleet.id} new pos: (${fleet.x.toFixed(2)}, ${fleet.y.toFixed(2)})`,
          );
        }

        const mapCell = this.calculateGridCell(fleet.x, fleet.y);
        fleet.gridCol = mapCell.col;
        fleet.gridRow = mapCell.row;

        // Check if fleet left its current system
        if (fleet.systemId !== undefined) {
          const system = starSystems.find((s) => s.id === fleet.systemId);
          if (system && !this.isFleetInSystem(fleet, system)) {
            onLeaveSystem(fleet.id);
          }
        }
      }

      // System movement
      if (fleet.systemTargetX != null && fleet.systemTargetY != null) {
        didMoveFleets = true;

        const dx = fleet.systemTargetX - (fleet.systemX || 0);
        const dy = fleet.systemTargetY - (fleet.systemY || 0);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= 0.01) {
          fleet.systemX = fleet.systemTargetX;
          fleet.systemY = fleet.systemTargetY;
          fleet.systemTargetX = null;
          fleet.systemTargetY = null;

          if (selectedFleetId === fleet.id && currentView === 'system') {
            onTargetReached(fleet.id);
          }
        } else {
          const movement = fleet.speed * deltaTime;
          const step = Math.min(movement, distance);
          fleet.systemX = (fleet.systemX || 0) + (dx / distance) * step;
          fleet.systemY = (fleet.systemY || 0) + (dy / distance) * step;
        }

        if (fleet.systemX != null && fleet.systemY != null) {
          const sysCell = this.calculateSystemGridCell(fleet.systemX, fleet.systemY);
          fleet.gridCol = sysCell.col;
          fleet.gridRow = sysCell.row;
        }
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
   * initializeCoordinates: Ensures all fleets and systems have grid cell coordinates.
   * In the new system, x/y are already 1-indexed grid cells. For legacy saves
   * (map.width === 200, meaning vw dimensions), converts vw positions to grid cells
   * using the reference cell size of 2vw.
   */
  initializeCoordinates(fleets: Fleet[], starSystems: StarSystem[]): void {
    const isLegacyVw = this.gridColumns === 0 || this.gridColumns > 150;

    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      if (isLegacyVw && (fleet.x > this.gridColumns || fleet.y > this.gridRows)) {
        // Legacy: x/y are vw coordinates; convert to 1-indexed grid cells
        const gridX = Math.floor(fleet.x / this.cellSizeVw) + 1;
        const gridY = Math.floor(fleet.y / this.cellSizeVh) + 1;
        fleet.x = gridX;
        fleet.y = gridY;
        if (fleet.targetX != null) {
          fleet.targetX = Math.floor(fleet.targetX / this.cellSizeVw) + 1;
        }
        if (fleet.targetY != null) {
          fleet.targetY = Math.floor(fleet.targetY / this.cellSizeVh) + 1;
        }
      }

      fleet.gridCol = Math.floor(fleet.x);
      fleet.gridRow = Math.floor(fleet.y);
    }

    for (const system of starSystems) {
      if (isLegacyVw && (system.x > this.gridColumns || system.y > this.gridRows)) {
        system.x = Math.floor(system.x / this.cellSizeVw) + 1;
        system.y = Math.floor(system.y / this.cellSizeVh) + 1;
      }
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

      if (fleet.systemId === system.id && fleet.systemX != null && fleet.systemY != null) {
        const fleetCell = this.calculateSystemGridCell(fleet.systemX, fleet.systemY);
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
}

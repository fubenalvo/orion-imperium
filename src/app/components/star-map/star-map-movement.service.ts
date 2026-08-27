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
 * World coordinates use vw (viewport width) units.
 * 1 vw = 1% of viewport width.
 * Grid cell size is 5vw x 5vh.
 */

@Injectable({ providedIn: 'root' })
export class StarMapMovementService {
  cellSizeVw: number = 0;
  cellSizeVh: number = 0;
  gridColumns = 0;
  gridRows = 0;

  constructor() {}

  /*
   * initialize: Set grid dimensions. Called once on component init.
   */
  initialize(cellSizeVw: number, cellSizeVh: number, mapWidth: number, mapHeight: number): void {
    this.cellSizeVw = cellSizeVw;
    this.cellSizeVh = cellSizeVh;
    this.gridColumns = Math.ceil(mapWidth / cellSizeVw);
    this.gridRows = Math.ceil(mapHeight / cellSizeVh);
  }

  /*
   * calculateGridCell: Converts world coordinates to 1-indexed grid cell.
   * e.g. x=0 -> col=1, x=5 -> col=2
   * World coordinates point to the center of the cell.
   */
  calculateGridCell(x: number, y: number): { col: number; row: number } {
    const col = Math.floor(x / this.cellSizeVw) + 1;
    const row = Math.floor(y / this.cellSizeVh) + 1;
    return { col, row };
  }

  /*
   * isFleetInSystem: Checks if a fleet is within the grid cell of a star system.
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
   * getTileCenter: Snap world coordinates to the center of the containing grid cell.
   */
  getTileCenter(x: number, y: number): { x: number; y: number } {
    const tileColumn = Math.max(0, Math.min(Math.floor(x / this.cellSizeVw), this.gridColumns - 1));
    const tileRow = Math.max(0, Math.min(Math.floor(y / this.cellSizeVh), this.gridRows - 1));

    return {
      x: tileColumn * this.cellSizeVw + this.cellSizeVw / 2,
      y: tileRow * this.cellSizeVh + this.cellSizeVh / 2,
    };
  }

  /*
   * updateFleets: Processes fleet movement for one frame.
   * Returns true if any fleet moved.
   */
  updateFleets(
    fleets: Fleet[],
    starSystems: StarSystem[],
    selectedFleetId: number | null,
    currentView: 'map' | 'system',
    deltaTime: number,
    onTargetReached: (fleetId: number) => void,
    onLeaveSystem: (fleetId: number) => void,
  ): boolean {
    let didMoveFleets = false;

    for (const fleet of fleets) {
      if (fleet.destroyed) {
        continue;
      }

      // Map movement
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
          const movement = fleet.speed * deltaTime;
          const step = Math.min(movement, distance);
          console.log(`[Movement] Moving fleet ${fleet.id} from (${fleet.x}, ${fleet.y}) step=${step.toFixed(2)}`);
          fleet.x += (dx / distance) * step;
          fleet.y += (dy / distance) * step;
          console.log(`[Movement] Fleet ${fleet.id} new pos: (${fleet.x.toFixed(2)}, ${fleet.y.toFixed(2)})`);
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
          const sysCell = this.calculateGridCell(fleet.systemX, fleet.systemY);
          fleet.gridCol = sysCell.col;
          fleet.gridRow = sysCell.row;
        }
      }
    }

    return didMoveFleets;
  }

  /*
   * refreshGridPositions: Recalculates grid positions for all fleets and systems.
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
   * initializeCoordinates: Converts legacy grid coordinates to vw coordinates.
   * Used for fleets loaded from older save formats.
   */
  initializeCoordinates(fleets: Fleet[], starSystems: StarSystem[]): void {
    for (const fleet of fleets) {
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

    for (const system of starSystems) {
      const cell = this.calculateGridCell(system.x, system.y);
      system.gridCol = cell.col;
      system.gridRow = cell.row;
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
}

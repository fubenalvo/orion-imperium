import { Injectable } from '@angular/core';
import { Fleet, StarSystem, Faction } from './star-map.models';

/*
 * =========================================================
 * STAR MAP SENSOR SERVICE
 * =========================================================
 *
 * Handles sensor-range computation for the fog-of-war system:
 * - Cells within a Euclidean radius of a fleet or system
 * - Union of all player sensor ranges (fleets + player-owned systems)
 * - Exploration tracking (cells and star systems)
 * - Fleet visibility checks
 *
 * Coordinate system:
 * - Galaxy map uses 1-indexed grid cell coordinates for fleet.x/y and
 *   system.gridCol/gridRow. Sensor ranges are computed around integer cell
 *   positions (Math.floor for fleets, gridCol/gridRow for systems).
 *
 * - System view uses a separate 18×10 grid with 5vw cells. Sensor ranges
 *   in system view are computed around the fleet's system grid cell.
 */

export interface SensorCellInfo {
  col: number;
  row: number;
  factionId: string;
  color: string;
}

export const DEFAULT_FLEET_SENSOR_RANGE = 3;
export const PLAYER_SYSTEM_SENSOR_RANGE = 5;

/** System-view grid dimensions (fixed 18×10 with 5vw cells). */
export const SYSTEM_GRID_COLUMNS = 18;
export const SYSTEM_GRID_ROWS = 10;
export const SYSTEM_CELL_SIZE_VW = 5;

@Injectable({ providedIn: 'root' })
export class StarMapSensorService {
  /** Returns true if a grid cell is within map bounds. */
  isCellInBounds(col: number, row: number, gridColumns: number, gridRows: number): boolean {
    return col >= 1 && col <= gridColumns && row >= 1 && row <= gridRows;
  }

  /**
   * Returns all 1-indexed grid cells within a Euclidean radius of (centerX, centerY).
   * centerX/Y are floating-point grid coordinates (1-indexed). The search
   * iterates a bounding box of size (2*ceil(radius)+1)² and tests each cell.
   */
  getCellsInRadius(
    centerX: number,
    centerY: number,
    radius: number,
    gridColumns: number,
    gridRows: number,
  ): { col: number; row: number }[] {
    const cells: { col: number; row: number }[] = [];
    const intCenterX = Math.floor(centerX);
    const intCenterY = Math.floor(centerY);
    const r = Math.ceil(radius);

    for (let col = intCenterX - r; col <= intCenterX + r; col++) {
      for (let row = intCenterY - r; row <= intCenterY + r; row++) {
        if (!this.isCellInBounds(col, row, gridColumns, gridRows)) {
          continue;
        }
        const dx = col - centerX;
        const dy = row - centerY;
        if (dx * dx + dy * dy <= radius * radius) {
          cells.push({ col, row });
        }
      }
    }

    return cells;
  }

  /**
   * Computes all cells currently within player sensor range on the galaxy map.
   * Sources (player faction only):
   *   1. Player-owned star systems — fixed range 5 (base visibility)
   *   2. Player fleets — range = fleet.sensorRange (default 3)
   *
   * Returns a Map keyed "col-row" whose values carry the faction color
   * for rendering. Player-owned systems take priority over fleets.
   */
  computeGalaxySensorCells(
    fleets: Fleet[],
    starSystems: StarSystem[],
    factions: Faction[],
    gridColumns: number,
    gridRows: number,
  ): Map<string, SensorCellInfo> {
    const cells = new Map<string, SensorCellInfo>();
    const playerColor = this.getFactionColor(factions, 'player');
    const playerSystemKeys = new Set<string>();

    // 1. Player-owned systems provide 5-grid base sensor radius
    const ownedSystems = starSystems.filter((s) =>
      s.planetsTiles.some((p) => p.factionId === 'player'),
    );

    for (const system of ownedSystems) {
      const col = system.gridCol ?? Math.floor(system.x);
      const row = system.gridRow ?? Math.floor(system.y);
      const sensorCells = this.getCellsInRadius(col, row, PLAYER_SYSTEM_SENSOR_RANGE, gridColumns, gridRows);
      for (const cell of sensorCells) {
        const key = `${cell.col}-${cell.row}`;
        playerSystemKeys.add(key);
        cells.set(key, {
          col: cell.col,
          row: cell.row,
          factionId: 'player',
          color: playerColor,
        });
      }
    }

    // 2. Player fleet sensor ranges (lower priority than owned systems)
    for (const fleet of fleets) {
      if (fleet.destroyed || fleet.factionId !== 'player') {
        continue;
      }
      const range = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;
      const fleetCells = this.getCellsInRadius(fleet.x, fleet.y, range, gridColumns, gridRows);
      for (const cell of fleetCells) {
        const key = `${cell.col}-${cell.row}`;
        if (!playerSystemKeys.has(key)) {
          cells.set(key, {
            col: cell.col,
            row: cell.row,
            factionId: 'player',
            color: playerColor,
          });
        }
      }
    }

    return cells;
  }

  /**
   * Computes sensor range cells for a fleet in the system view.
   * The system grid is 18×10 with 5vw cells. The fleet's system.x/y are in vw.
   */
  computeSystemSensorCells(
    fleet: Fleet,
  ): { col: number; row: number }[] {
    if (!fleet.system?.id) {
      return [];
    }

    const range = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;
    const centerCol = Math.floor((fleet.system.x ?? 0) / SYSTEM_CELL_SIZE_VW) + 1;
    const centerRow = Math.floor((fleet.system.y ?? 0) / SYSTEM_CELL_SIZE_VW) + 1;

    return this.getCellsInRadius(
      centerCol,
      centerRow,
      range,
      SYSTEM_GRID_COLUMNS,
      SYSTEM_GRID_ROWS,
    );
  }

  /**
   * Merges newly-sensed cells into the persistent explored set.
   * Returns the updated set (mutates and returns the input for chaining).
   */
  updateExploredCells(
    explored: Set<string>,
    sensorCells: Map<string, SensorCellInfo>,
  ): Set<string> {
    for (const key of sensorCells.keys()) {
      explored.add(key);
    }
    return explored;
  }

  /**
   * Returns true if a star system's grid cell falls within the given sensor cells.
   */
  isSystemExplored(system: StarSystem, sensorCells: Map<string, SensorCellInfo>): boolean {
    if (system.explored) {
      return true;
    }
    const col = system.gridCol ?? Math.floor(system.x);
    const row = system.gridRow ?? Math.floor(system.y);
    return sensorCells.has(`${col}-${row}`);
  }

  /**
   * Returns true if a fleet is visible to the player.
   * Rules:
   * - Player fleets are always visible.
   * - Enemy/neutral fleets are visible only if their cell is in the player's
   *   sensor range (sensorCells from the galaxy map).
   * - In system view, all active fleets in the current system are visible
   *   (the player is physically present).
   */
  isFleetVisible(
    fleet: Fleet,
    sensorCells: Map<string, SensorCellInfo>,
    currentView: 'map' | 'system' | 'planet',
    selectedSystem: StarSystem | null,
  ): boolean {
    if (fleet.factionId === 'player') {
      return true;
    }

    if (currentView === 'system' && selectedSystem && fleet.system?.id === selectedSystem.id) {
      return true;
    }

    const col = Math.floor(fleet.x);
    const row = Math.floor(fleet.y);
    return sensorCells.has(`${col}-${row}`);
  }

  /**
   * Returns true if a fleet can explore a planet within its sensor range
   * in the system view. A planet is explored if it's within the fleet's
   * sensor radius on the system grid.
   *
   * planetCol/planetRow are 1-indexed system grid cells from getPlanetGridPosition().
   * fleetSystemX/Y are vw coordinates on the 18×10 system grid.
   */
  isPlanetInRange(
    planetCol: number,
    planetRow: number,
    fleetSystemX: number,
    fleetSystemY: number,
    range: number,
  ): boolean {
    const fleetCol = Math.floor(fleetSystemX / SYSTEM_CELL_SIZE_VW) + 1;
    const fleetRow = Math.floor(fleetSystemY / SYSTEM_CELL_SIZE_VW) + 1;
    const dx = planetCol - fleetCol;
    const dy = planetRow - fleetRow;
    return dx * dx + dy * dy <= range * range;
  }

  /**
   * Returns the viewport bounds in grid cells, with a 1-cell buffer.
   * Used to cull fog cells to only those visible on screen.
   */
  getViewportCells(
    cameraX: number,
    cameraY: number,
    viewportWidthVw: number,
    viewportHeightVw: number,
    cellSizeVw: number,
    cellSizeVh: number,
    gridColumns: number,
    gridRows: number,
  ): { col: number; row: number }[] {
    const startCol = Math.max(1, Math.floor(cameraX / cellSizeVw) - 1);
    const endCol = Math.min(
      gridColumns,
      Math.floor((cameraX + viewportWidthVw) / cellSizeVw) + 2,
    );
    const startRow = Math.max(1, Math.floor(cameraY / cellSizeVh) - 1);
    const endRow = Math.min(
      gridRows,
      Math.floor((cameraY + viewportHeightVw) / cellSizeVh) + 2,
    );

    const cells: { col: number; row: number }[] = [];
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        cells.push({ col, row });
      }
    }
    return cells;
  }

  private getFactionColor(factions: Faction[], factionId: string): string {
    const f = factions.find((x) => x.id === factionId);
    return f ? f.color : '#ffffff';
  }
}

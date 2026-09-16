var StarMapMovementService_1;
import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
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
 * The system view (inside star systems) uses a separate fixed 18x10 grid
 * with 5vw cells. System view positions (systemX/Y) remain in vw units.
 */
let StarMapMovementService = class StarMapMovementService {
    static { StarMapMovementService_1 = this; }
    cellSizeVw = 0;
    cellSizeVh = 0;
    gridColumns = 0;
    gridRows = 0;
    static SYSTEM_CELL_SIZE_VW = 5;
    static get systemCellSizeVw() {
        return StarMapMovementService_1.SYSTEM_CELL_SIZE_VW;
    }
    constructor() { }
    /*
     * initialize: Set grid dimensions.
     * gridColumns and gridRows are the actual grid dimensions (in cells),
     * read directly from map.width/height in the data file.
     * cellSizeVw/Vh is the vw size per cell (2 desktop, 3.5 mobile).
     */
    initialize(cellSizeVw, cellSizeVh, mapWidth, mapHeight) {
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
    calculateGridCell(x, y) {
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
    getSystemTileCenter(vwX, vwY) {
        const col = Math.floor(vwX / StarMapMovementService_1.SYSTEM_CELL_SIZE_VW);
        const row = Math.floor(vwY / StarMapMovementService_1.SYSTEM_CELL_SIZE_VW);
        return {
            x: col * StarMapMovementService_1.SYSTEM_CELL_SIZE_VW +
                StarMapMovementService_1.SYSTEM_CELL_SIZE_VW / 2,
            y: row * StarMapMovementService_1.SYSTEM_CELL_SIZE_VW +
                StarMapMovementService_1.SYSTEM_CELL_SIZE_VW / 2,
        };
    }
    /*
      * calculateSystemGridCell: Converts system view vw coordinates to grid cells.
      * The system view uses a fixed 18x10 grid with 5vw cells.
      * Returns 1-indexed grid positions.
      */
    calculateSystemGridCell(vwX, vwY) {
        return {
            col: Math.floor(vwX / StarMapMovementService_1.SYSTEM_CELL_SIZE_VW) + 1,
            row: Math.floor(vwY / StarMapMovementService_1.SYSTEM_CELL_SIZE_VW) + 1,
        };
    }
    /*
     * isFleetInSystem: Checks if a fleet is within the grid cell of a star system.
     * Both fleet.x/y and system.x/y are 1-indexed map grid cell coordinates.
     */
    isFleetInSystem(fleet, system) {
        const fleetCell = this.calculateGridCell(fleet.x, fleet.y);
        const sysCell = this.calculateGridCell(system.x, system.y);
        return fleetCell.col === sysCell.col && fleetCell.row === sysCell.row;
    }
    /*
     * getPlanetGridPosition: Returns the planet's grid position in system view.
     * Uses planet.x and planet.y as 1-indexed column/row coordinates.
     * Falls back to the index-based formula if values are out of bounds.
     */
    getPlanetGridPosition(planet) {
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
    getTileCenter(vwX, vwY) {
        const col = Math.floor(vwX / this.cellSizeVw) + 1;
        const row = Math.floor(vwY / this.cellSizeVh) + 1;
        return { x: col, y: row };
    }
    /*
     * updateFleets: Processes fleet movement for one frame.
     * Returns true if any fleet moved.
     */
    updateFleets(fleets, starSystems, selectedFleetId, currentView, deltaTime, onTargetReached, onLeaveSystem) {
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
                }
                else {
                    // Fleet speed is in vw/s; convert to grid cells/s.
                    // Star map view uses 1/10 of the configured fleet speed so that
                    // long-distance travel across the galaxy takes meaningful time.
                    const movement = (fleet.speed / 10 / this.cellSizeVw) * deltaTime;
                    const step = Math.min(movement, distance);
                    fleet.x += (dx / distance) * step;
                    fleet.y += (dy / distance) * step;
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
                }
                else {
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
    refreshGridPositions(fleets, starSystems) {
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
    initializeCoordinates(fleets, starSystems) {
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
    getObjectsAtMapCell(fleets, starSystems, col, row) {
        const items = [];
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
    getObjectsAtSystemCell(fleets, system, col, row) {
        const items = [];
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
    getGalaxyTrailVw(fleet) {
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
     * getSystemTrailVw: Returns a fleet's current system-view position and
     * target in vw units for rendering a movement trail inside a star system.
     * The system view uses vw units directly, so no conversion is needed.
     * Returns null when the fleet is not in the given system or has no target.
     */
    getSystemTrailVw(fleet, systemId) {
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
};
StarMapMovementService = StarMapMovementService_1 = __decorate([
    Injectable({ providedIn: 'root' })
], StarMapMovementService);
export { StarMapMovementService };

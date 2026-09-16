import { __decorate } from "tslib";
import { Injectable } from '@angular/core';
export const DEFAULT_FLEET_SENSOR_RANGE = 3;
export const PLAYER_SYSTEM_SENSOR_RANGE = 5;
/** System-view grid dimensions (fixed 18×10 with 5vw cells). */
export const SYSTEM_GRID_COLUMNS = 18;
export const SYSTEM_GRID_ROWS = 10;
export const SYSTEM_CELL_SIZE_VW = 5;
let StarMapSensorService = class StarMapSensorService {
    shipService;
    researchService;
    constructor(shipService, researchService) {
        this.shipService = shipService;
        this.researchService = researchService;
    }
    /**
     * Computes the effective sensor range for a fleet.
     *
     * `Fleet.sensorRange` is treated as a minimum floor (default 3). If any
     * non-destroyed ship in the fleet has a `ShipType.range` greater than the
     * floor, the highest such range becomes the effective range. A fleet with
     * no ships or all destroyed ships falls back to the floor.
     */
    getFleetSensorRange(fleet, faction) {
        const floor = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;
        let maxShipRange = 0;
        for (const ship of fleet.ships) {
            if (ship.destroyed)
                continue;
            const type = this.shipService.getShipType(ship.type);
            if (type && type.range > maxShipRange) {
                maxShipRange = type.range;
            }
        }
        const base = Math.max(floor, maxShipRange);
        if (faction) {
            return base + this.researchService.getSensorRangeBonus(faction);
        }
        return base;
    }
    /** Returns true if a grid cell is within map bounds. */
    isCellInBounds(col, row, gridColumns, gridRows) {
        return col >= 1 && col <= gridColumns && row >= 1 && row <= gridRows;
    }
    /**
     * Returns all 1-indexed grid cells within a Euclidean radius of (centerX, centerY).
     * centerX/Y are floating-point grid coordinates (1-indexed). The search
     * iterates a bounding box of size (2*ceil(radius)+1)² and tests each cell.
     */
    getCellsInRadius(centerX, centerY, radius, gridColumns, gridRows) {
        const cells = [];
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
     * Returns cells in the "outer ring" preview band around (centerX, centerY):
     * cells whose Euclidean distance from the center is strictly greater than
     * `radius` and at most `radius + 2`. These two extra layers are rendered as
     * a faint halo to show that the source's reach is about to extend there.
     *
     * The bounding box is enlarged by 2 cells compared to `getCellsInRadius` so
     * every candidate cell inside the (R, R+2] annulus is tested.
     */
    getOuterRingCells(centerX, centerY, radius, gridColumns, gridRows) {
        const cells = [];
        const intCenterX = Math.floor(centerX);
        const intCenterY = Math.floor(centerY);
        // Enlarge the bounding box by 2 to cover the (R, R+2] annulus safely.
        const r = Math.ceil(radius) + 2;
        const innerSq = radius * radius;
        const outerSq = (radius + 2) * (radius + 2);
        for (let col = intCenterX - r; col <= intCenterX + r; col++) {
            for (let row = intCenterY - r; row <= intCenterY + r; row++) {
                if (!this.isCellInBounds(col, row, gridColumns, gridRows)) {
                    continue;
                }
                const dx = col - centerX;
                const dy = row - centerY;
                const distSq = dx * dx + dy * dy;
                if (distSq > innerSq && distSq <= outerSq) {
                    cells.push({ col, row });
                }
            }
        }
        return cells;
    }
    /**
     * Computes all cells currently within player sensor range on the galaxy map,
     * plus the outer-ring preview cells that lie just beyond the fully-clear
     * radius.
     *
     * Sources (player faction only):
     *   1. Player-owned star systems — fixed range 5 (base visibility)
     *   2. Player fleets — range = getFleetSensorRange(fleet): max of the fleet's
     *      `sensorRange` floor (default 3) and the highest `ShipType.range`
     *      among the fleet's non-destroyed ships
     *
     * Returns a `SensorLayerResult` with two maps keyed "col-row":
     * - `cells` — the fully-clear range, carries the faction color for rendering.
     * - `preview` — outer-ring cells (strictly beyond `cells` within R+2).
     *
     * Player-owned systems take priority: a fleet cell that overlaps a system
     * cell is owned by the system; a preview cell that overlaps a full cell
     * is dropped (the full layer wins).
     *
     * Preview cells are returned for rendering only. They are never added to
     * the explored set (see `updateExploredCells`).
     */
    computeGalaxySensorCells(fleets, starSystems, factions, gridColumns, gridRows) {
        const cells = new Map();
        const preview = new Map();
        const playerColor = this.getFactionColor(factions, 'player');
        const playerFaction = factions.find((f) => f.id === 'player');
        const playerSystemKeys = new Set();
        const systemSensorRange = PLAYER_SYSTEM_SENSOR_RANGE +
            (playerFaction ? this.researchService.getSensorRangeBonus(playerFaction) : 0);
        // 1. Player-owned systems provide base sensor radius
        const ownedSystems = starSystems.filter((s) => s.planetsTiles.some((p) => p.factionId === 'player'));
        for (const system of ownedSystems) {
            const col = system.gridCol ?? Math.floor(system.x);
            const row = system.gridRow ?? Math.floor(system.y);
            const sensorCells = this.getCellsInRadius(col, row, systemSensorRange, gridColumns, gridRows);
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
            const range = this.getFleetSensorRange(fleet, playerFaction);
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
        // 3. Outer-ring preview cells: skip anything already in the full layer or
        //    covered by a player-owned system. Sources mirror the full layer so
        //    every sensor source gets a matching halo.
        for (const system of ownedSystems) {
            const col = system.gridCol ?? Math.floor(system.x);
            const row = system.gridRow ?? Math.floor(system.y);
            const ringCells = this.getOuterRingCells(col, row, systemSensorRange, gridColumns, gridRows);
            for (const cell of ringCells) {
                const key = `${cell.col}-${cell.row}`;
                if (playerSystemKeys.has(key) || cells.has(key)) {
                    continue;
                }
                preview.set(key, {
                    col: cell.col,
                    row: cell.row,
                    factionId: 'player',
                    color: playerColor,
                });
            }
        }
        for (const fleet of fleets) {
            if (fleet.destroyed || fleet.factionId !== 'player') {
                continue;
            }
            const range = this.getFleetSensorRange(fleet, playerFaction);
            const ringCells = this.getOuterRingCells(fleet.x, fleet.y, range, gridColumns, gridRows);
            for (const cell of ringCells) {
                const key = `${cell.col}-${cell.row}`;
                if (playerSystemKeys.has(key) || cells.has(key)) {
                    continue;
                }
                preview.set(key, {
                    col: cell.col,
                    row: cell.row,
                    factionId: 'player',
                    color: playerColor,
                });
            }
        }
        return { cells, preview };
    }
    /**
     * Computes sensor range cells for a fleet in the system view, plus the
     * outer-ring preview cells.
     *
     * The system grid is 18×10 with 5vw cells. The fleet's system.x/y are in vw.
     * Preview cells are NOT used for fog/exploration.
     */
    computeSystemSensorCells(fleet) {
        if (!fleet.system?.id) {
            return { cells: [], preview: [] };
        }
        const range = fleet.sensorRange ?? DEFAULT_FLEET_SENSOR_RANGE;
        const centerCol = Math.floor((fleet.system.x ?? 0) / SYSTEM_CELL_SIZE_VW) + 1;
        const centerRow = Math.floor((fleet.system.y ?? 0) / SYSTEM_CELL_SIZE_VW) + 1;
        const cells = this.getCellsInRadius(centerCol, centerRow, range, SYSTEM_GRID_COLUMNS, SYSTEM_GRID_ROWS);
        const preview = this.getOuterRingCells(centerCol, centerRow, range, SYSTEM_GRID_COLUMNS, SYSTEM_GRID_ROWS);
        return { cells, preview };
    }
    /**
     * Merges newly-sensed cells into the persistent explored set.
     * Returns the updated set (mutates and returns the input for chaining).
     */
    updateExploredCells(explored, sensorCells) {
        for (const key of sensorCells.keys()) {
            explored.add(key);
        }
        return explored;
    }
    /**
     * Returns true if a star system's grid cell falls within the given sensor cells.
     */
    isSystemExplored(system, sensorCells) {
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
    isFleetVisible(fleet, sensorCells, currentView, selectedSystem) {
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
     * planetCol/planetRow are 1-indexed system grid cells from planet.x/y.
     * fleetSystemX/Y are vw coordinates on the 18×10 system grid.
     */
    isPlanetInRange(planetCol, planetRow, fleetSystemX, fleetSystemY, range) {
        const fleetCol = Math.floor(fleetSystemX / SYSTEM_CELL_SIZE_VW) + 1;
        const fleetRow = Math.floor(fleetSystemY / SYSTEM_CELL_SIZE_VW) + 1;
        const dx = planetCol - fleetCol;
        const dy = planetRow - fleetRow;
        return dx * dx + dy * dy <= range * range;
    }
    /**
     * Returns true if a planet lies in the outer-ring preview annulus of a
     * fleet in the system view: strictly farther than `range` and at most
     * `range + 2` (Euclidean). Used to auto-explore planets at the edge of
     * sensor reach without making the underlying galaxy cell "explored".
     *
     * planetCol/planetRow are 1-indexed system grid cells from planet.x/y.
     * fleetSystemX/Y are vw coordinates on the 18×10
     * system grid.
     */
    isPlanetInPreviewRange(planetCol, planetRow, fleetSystemX, fleetSystemY, range) {
        const fleetCol = Math.floor(fleetSystemX / SYSTEM_CELL_SIZE_VW) + 1;
        const fleetRow = Math.floor(fleetSystemY / SYSTEM_CELL_SIZE_VW) + 1;
        const dx = planetCol - fleetCol;
        const dy = planetRow - fleetRow;
        const distSq = dx * dx + dy * dy;
        return distSq > range * range && distSq <= (range + 2) * (range + 2);
    }
    /**
     * Returns the viewport bounds in grid cells, with a 1-cell buffer.
     * Used to cull fog cells to only those visible on screen.
     */
    getViewportCells(cameraX, cameraY, viewportWidthVw, viewportHeightVw, cellSizeVw, cellSizeVh, gridColumns, gridRows) {
        const startCol = Math.max(1, Math.floor(cameraX / cellSizeVw) - 1);
        const endCol = Math.min(gridColumns, Math.floor((cameraX + viewportWidthVw) / cellSizeVw) + 2);
        const startRow = Math.max(1, Math.floor(cameraY / cellSizeVh) - 1);
        const endRow = Math.min(gridRows, Math.floor((cameraY + viewportHeightVw) / cellSizeVh) + 2);
        const cells = [];
        for (let col = startCol; col <= endCol; col++) {
            for (let row = startRow; row <= endRow; row++) {
                cells.push({ col, row });
            }
        }
        return cells;
    }
    getFactionColor(factions, factionId) {
        const f = factions.find((x) => x.id === factionId);
        return f ? f.color : '#ffffff';
    }
};
StarMapSensorService = __decorate([
    Injectable({ providedIn: 'root' })
], StarMapSensorService);
export { StarMapSensorService };

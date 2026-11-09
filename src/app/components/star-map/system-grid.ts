/*
 * Geometry of the star system view (docs/game-systems.md, "Star system view").
 *
 * The scene is a fixed 90vw × 35vw rectangle. It is divided into a
 * 36 × 14 grid of 2.5vw cells: twice as many columns and rows as the
 * original 18 × 7 grid of 5vw cells, on the same physical area.
 *
 * Invariants other code relies on:
 * - Fleet positions inside a system (`Fleet.system.x/y`) are vw, never cells,
 *   so the grid density can change without touching saved fleet positions.
 * - A planet occupies a SYSTEM_PLANET_FOOTPRINT × SYSTEM_PLANET_FOOTPRINT
 *   block of cells. `PlanetTile.x/y` is the block's top-left cell (1-indexed).
 *   Planets keep their visual size (it is set in vw, not in cells).
 * - Sensor ranges are measured in "range units" of the old 5vw cell
 *   (SYSTEM_SENSOR_RANGE_UNIT_CELLS cells each), so doubling the grid did not
 *   shrink how far a fleet sees inside a system.
 * - The star sits right of the grid; its center must match the `.sun`
 *   placement in star-map-system-grid.component.scss.
 */

export const SYSTEM_CELL_SIZE_VW = 2.5;
export const SYSTEM_GRID_COLUMNS = 36;
export const SYSTEM_GRID_ROWS = 14;

/* Side length (in cells) of the square block a planet occupies. */
export const SYSTEM_PLANET_FOOTPRINT = 2;

/* System cells per unit of sensor range (one unit = the old 5vw cell). */
export const SYSTEM_SENSOR_RANGE_UNIT_CELLS = 2;

export const SYSTEM_SUN_CENTER_X_VW = 95;
export const SYSTEM_SUN_CENTER_Y_VW = 17.5;

/*
 * Where a fleet that has no in-system position yet appears (vw): the middle
 * of the left edge, far from the star. Belt generation keeps this cell free,
 * and no PLANET_SYSTEM_LAYOUT slot (galaxy-generator.service.ts) covers it.
 * A fleet without an in-system position counts as standing here for the
 * in-system battle separation (system-pursuit.ts).
 */
export const SYSTEM_FLEET_ENTRY_VW = { x: 2.5, y: 17.5 } as const;

/*
 * In-system speed as a share of the fleet's engine-adjusted speed (vw/s).
 * The galaxy map moves at 1/10 of the same value; the system scene is far
 * smaller, so half speed keeps an in-system crossing at a readable pace
 * without making it as slow as a galaxy jump.
 */
export const SYSTEM_SPEED_FACTOR = 0.5;

/* Center (vw) of a 1-indexed system cell. */
export function systemCellCenterVw(col: number, row: number): { x: number; y: number } {
  return { x: (col - 0.5) * SYSTEM_CELL_SIZE_VW, y: (row - 0.5) * SYSTEM_CELL_SIZE_VW };
}

/* 1-indexed system cell containing a vw point. */
export function systemCellAtVw(x: number, y: number): { col: number; row: number } {
  return {
    col: Math.floor(x / SYSTEM_CELL_SIZE_VW) + 1,
    row: Math.floor(y / SYSTEM_CELL_SIZE_VW) + 1,
  };
}

/*
 * Top-left cell (1-indexed) of a planet's footprint block, from planet.x/y.
 * Values that do not fit the grid fall back to an index-based layout so a
 * malformed save still renders every planet.
 */
export function planetFootprintOrigin(planet: { x: number; y: number; index: number }): { col: number; row: number } {
  const col = planet.x;
  const row = planet.y;
  const maxCol = SYSTEM_GRID_COLUMNS - SYSTEM_PLANET_FOOTPRINT + 1;
  const maxRow = SYSTEM_GRID_ROWS - SYSTEM_PLANET_FOOTPRINT + 1;
  if (col >= 1 && col <= maxCol && row >= 1 && row <= maxRow) {
    return { col, row };
  }
  return {
    col: 2 * Math.max(1, 14 - planet.index * 2) - 1,
    row: 2 * (1 + ((planet.index * 3 + (planet.index % 2)) % 7)) - 1,
  };
}

/* Center (vw) of a planet's footprint block; the planet is drawn there. */
export function planetFootprintCenterVw(planet: { x: number; y: number; index: number }): { x: number; y: number } {
  const origin = planetFootprintOrigin(planet);
  return {
    x: (origin.col - 1 + SYSTEM_PLANET_FOOTPRINT / 2) * SYSTEM_CELL_SIZE_VW,
    y: (origin.row - 1 + SYSTEM_PLANET_FOOTPRINT / 2) * SYSTEM_CELL_SIZE_VW,
  };
}

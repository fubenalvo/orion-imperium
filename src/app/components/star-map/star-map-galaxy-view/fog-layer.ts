/*
 * =========================================================
 * GALAXY FOG-OF-WAR LAYER
 * =========================================================
 *
 * The galaxy map fog is one canvas with ONE PIXEL PER GRID CELL, stretched
 * by CSS over the whole grid. The browser's smooth (bilinear) upscaling
 * blends neighbouring pixels, which gives the soft falloff at the edge of
 * explored space without per-cell blurred shadows.
 *
 * Why a whole-map canvas and not viewport-culled cell divs: `.map-world`
 * has a 100 ms CSS transform transition (pan and zoom). Culled cells were
 * computed for the NEW camera at once, while the transition still showed
 * the OLD view, so the area outside the new viewport (most of the screen
 * when zooming in) briefly showed with no fog at all: the reported fog
 * flicker. A layer that always covers the whole map cannot have that gap,
 * at any zoom or transition length. It is also far cheaper than ~1,500
 * blurred box-shadow divs repainting whenever a fleet moves.
 *
 * Pixel rules (same as the old cell rules):
 * - never explored              → FOG_ALPHA_UNEXPLORED
 * - explored, not sensed now    → FOG_ALPHA_EXPLORED (preview ring included)
 * - in the player's sensor range → transparent
 */

/* Fog color rgb(1, 4, 8): nearly black with a cold tint. */
const FOG_RGB = [1, 4, 8] as const;
export const FOG_ALPHA_UNEXPLORED = 0.82;
export const FOG_ALPHA_EXPLORED = 0.5;

const ALPHA_UNEXPLORED = Math.round(FOG_ALPHA_UNEXPLORED * 255);
const ALPHA_EXPLORED = Math.round(FOG_ALPHA_EXPLORED * 255);

export interface FogCell {
  col: number;
  row: number;
}

/*
 * RGBA pixels (width = columns, height = rows) of the explored/unexplored
 * base, before sensed cells are cleared. Keys are the 1-indexed "col-row"
 * strings of StarMap.exploredGridCells; keys outside the grid are ignored.
 */
export function buildFogBase(columns: number, rows: number, explored: Iterable<string>): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(columns * rows * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = FOG_RGB[0];
    pixels[i + 1] = FOG_RGB[1];
    pixels[i + 2] = FOG_RGB[2];
    pixels[i + 3] = ALPHA_UNEXPLORED;
  }
  for (const key of explored) {
    const dash = key.indexOf('-');
    const col = Number(key.slice(0, dash));
    const row = Number(key.slice(dash + 1));
    const index = pixelIndex(col, row, columns, rows);
    if (index >= 0) pixels[index + 3] = ALPHA_EXPLORED;
  }
  return pixels;
}

/* Clears the sensed cells (in place) on a copy of the base. */
export function clearSensedCells(pixels: Uint8ClampedArray, columns: number, rows: number, sensed: Iterable<FogCell>): void {
  for (const cell of sensed) {
    const index = pixelIndex(cell.col, cell.row, columns, rows);
    if (index >= 0) pixels[index + 3] = 0;
  }
}

function pixelIndex(col: number, row: number, columns: number, rows: number): number {
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 1 || row < 1 || col > columns || row > rows) {
    return -1;
  }
  return ((row - 1) * columns + (col - 1)) * 4;
}

/*
 * Draws the fog onto a canvas and skips work that is not needed.
 *
 * The explored set only grows, so its size is a valid change signal: the
 * base (explored/unexplored) is rebuilt only when it grows. The sensed cells
 * are compared by content, because StarMap builds a new sensor map every
 * frame even when nothing moved. A new canvas element (the fog toggle
 * re-creates it), a new grid size or `force` forces a full redraw.
 * Returns true when the canvas was redrawn; the galaxy view then copies it
 * into the visible fog image.
 */
export class FogLayerPainter {
  private canvas: HTMLCanvasElement | null = null;
  private columns = 0;
  private rows = 0;
  private exploredSize = -1;
  private base: Uint8ClampedArray | null = null;
  private lastSensed: FogCell[] = [];
  private unsupportedCanvas: HTMLCanvasElement | null = null;

  paint(
    canvas: HTMLCanvasElement,
    columns: number,
    rows: number,
    explored: ReadonlySet<string>,
    sensed: readonly FogCell[],
    force = false,
  ): boolean {
    if (columns <= 0 || rows <= 0 || canvas === this.unsupportedCanvas) return false;

    const newTarget = canvas !== this.canvas || columns !== this.columns || rows !== this.rows;
    const exploredGrew = explored.size !== this.exploredSize;
    if (!force && !newTarget && !exploredGrew && sameCells(sensed, this.lastSensed)) return false;

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    // No 2D context (test DOM without canvas support): nothing to draw, and
    // do not ask again for this element on every change detection.
    if (!ctx) {
      this.unsupportedCanvas = canvas;
      return false;
    }

    if (newTarget) {
      canvas.width = columns;
      canvas.height = rows;
      this.canvas = canvas;
      this.columns = columns;
      this.rows = rows;
    }
    if (newTarget || exploredGrew || !this.base) {
      this.base = buildFogBase(columns, rows, explored);
      this.exploredSize = explored.size;
    }

    const pixels = new Uint8ClampedArray(this.base);
    clearSensedCells(pixels, columns, rows, sensed);
    ctx.putImageData(new ImageData(pixels, columns, rows), 0, 0);
    this.lastSensed = sensed.map((c) => ({ col: c.col, row: c.row }));
    return true;
  }
}

function sameCells(a: readonly FogCell[], b: readonly FogCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].col !== b[i].col || a[i].row !== b[i].row) return false;
  }
  return true;
}

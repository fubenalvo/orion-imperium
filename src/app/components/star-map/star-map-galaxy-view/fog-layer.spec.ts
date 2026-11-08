import { buildFogBase, clearSensedCells, FOG_ALPHA_EXPLORED, FOG_ALPHA_UNEXPLORED } from './fog-layer';

/* Alpha of the 1-indexed cell (col, row) in an RGBA buffer `columns` wide. */
function alphaAt(pixels: Uint8ClampedArray, columns: number, col: number, row: number): number {
  return pixels[((row - 1) * columns + (col - 1)) * 4 + 3];
}

describe('fog layer pixels', () => {
  it('covers the whole grid: unexplored, explored and sensed cells get their own alpha', () => {
    const columns = 4;
    const rows = 3;
    const pixels = buildFogBase(columns, rows, new Set(['2-1', '3-2', '4-3']));
    clearSensedCells(pixels, columns, rows, [{ col: 3, row: 2 }]);

    expect(pixels.length).toBe(columns * rows * 4);
    expect(alphaAt(pixels, columns, 1, 1)).toBe(Math.round(FOG_ALPHA_UNEXPLORED * 255));
    expect(alphaAt(pixels, columns, 2, 1)).toBe(Math.round(FOG_ALPHA_EXPLORED * 255));
    expect(alphaAt(pixels, columns, 4, 3)).toBe(Math.round(FOG_ALPHA_EXPLORED * 255));
    // Sensed now: fully clear.
    expect(alphaAt(pixels, columns, 3, 2)).toBe(0);
  });

  it('ignores keys and cells outside the grid', () => {
    const columns = 2;
    const rows = 2;
    const pixels = buildFogBase(columns, rows, ['0-1', '3-1', '1-3', 'bad']);
    clearSensedCells(pixels, columns, rows, [{ col: 5, row: 5 }]);

    const unexplored = Math.round(FOG_ALPHA_UNEXPLORED * 255);
    for (let i = 3; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(unexplored);
    }
  });
});

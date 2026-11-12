import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/*
 * Decorative, endlessly repeating field of nebula formations for scrolling
 * scenes (the galaxy map). See docs/ui-styling.md#space-scenery.
 *
 * Why it exists: the galaxy can be many screens wide, so nebulae placed on
 * a map-sized background would almost never be on screen, and one huge
 * filtered layer would be expensive. Instead a TILE (TILE_W x TILE_H vw)
 * holds a few formations and is drawn 2 x 2 times inside a viewport-pinned
 * layer. The layer is translated by the camera pan modulo one tile, so the
 * pattern wraps seamlessly and only a compositor transform changes while
 * panning; the filtered clouds are rasterized once.
 *
 * Invariants:
 * - every formation lies fully inside its tile (see the SCSS), and
 * - the viewport is at most one tile in each direction (TILE_W >= 100vw,
 *   TILE_H >= the viewport height in vw on supported aspect ratios),
 * so 2 x 2 copies always cover the screen at any wrap offset.
 */
export const NEBULA_TILE_W_VW = 180;
export const NEBULA_TILE_H_VW = 130;

@Component({
  selector: 'app-space-nebula-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field" [style.transform]="transform">
      @for (copy of copies; track copy) {
        <div class="tile" [style.left.vw]="copy[0] * tileW" [style.top.vw]="copy[1] * tileH">
          <div class="cloud cloud--a"></div>
          <div class="cloud cloud--b"></div>
          <div class="cloud cloud--c"></div>
        </div>
      }
    </div>
  `,
  styleUrl: './space-nebula-field.component.scss',
  host: { 'aria-hidden': 'true' },
})
export class SpaceNebulaFieldComponent {
  /* Camera position in vw (same units as StarMap.cameraX / cameraY). */
  @Input() panX = 0;
  @Input() panY = 0;
  /* Parallax factor: how fast the clouds move relative to the camera. */
  @Input() factor = 0.12;

  readonly tileW = NEBULA_TILE_W_VW;
  readonly tileH = NEBULA_TILE_H_VW;
  readonly copies: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];

  get transform(): string {
    const x = wrap(this.panX * this.factor, this.tileW);
    const y = wrap(this.panY * this.factor, this.tileH);
    return `translate3d(${-x}vw, ${-y}vw, 0)`;
  }
}

/* Positive modulo: keeps the offset in [0, size) for negative pans too. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

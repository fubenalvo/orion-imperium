import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  inject,
} from '@angular/core';

/*
 * Decorative, endlessly repeating field of nebula formations for scrolling
 * scenes (the galaxy map). See docs/ui-styling.md#space-scenery.
 *
 * Why it exists: the galaxy can be many screens wide, so nebulae placed on
 * a map-sized background would almost never be on screen, and one huge
 * filtered layer would be expensive. Instead the formations repeat on a
 * TILE_W x TILE_H vw lattice that scrolls with the camera pan (times a
 * parallax factor).
 *
 * Rendering: every on-screen copy of a formation is its own small layer,
 * positioned by a compositor transform. Only copies within PREPAINT_VW of the
 * host exist, so new copies are created (and rasterized) just before they
 * scroll in. A copy is keyed by its absolute lattice index, so it keeps its
 * element (and its rasterized texture) for as long as it stays near the
 * screen; panning only changes transforms. The former implementation drew the
 * whole 2 x 2 tile block as one 360 x 260 vw layer, which on phones was the
 * largest GPU texture of the game.
 *
 * The filter and mask (nebula-cloud mixin) sit on the inner element, never on
 * the transformed wrapper, so they are baked once into the copy's texture
 * instead of being applied by the compositor every frame.
 */
export const NEBULA_TILE_W_VW = 180;
export const NEBULA_TILE_H_VW = 130;

/* How far outside the host (vw) copies already exist, so they are rasterized
   before they become visible while panning. */
const PREPAINT_VW = 25;

interface NebulaFormation {
  kind: 'a' | 'b' | 'c';
  /* Top-left corner and width inside the tile, vw. Formations are square. */
  x: number;
  y: number;
  w: number;
}

/* Every formation must lie fully inside the tile (x + w <= TILE_W,
   y + w <= TILE_H), otherwise neighbouring copies would overlap. */
const FORMATIONS: readonly NebulaFormation[] = [
  { kind: 'a', x: 4, y: 2, w: 72 },
  { kind: 'b', x: 100, y: 36, w: 58 },
  { kind: 'c', x: 34, y: 70, w: 56 },
];

interface NebulaCopy {
  key: string;
  kind: NebulaFormation['kind'];
  w: number;
  transform: string;
}

@Component({
  selector: 'app-space-nebula-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (copy of copies; track copy.key) {
      <div class="copy" [style.width.vw]="copy.w" [style.transform]="copy.transform">
        <div [class]="'cloud cloud--' + copy.kind"></div>
      </div>
    }
  `,
  styleUrl: './space-nebula-field.component.scss',
  host: { 'aria-hidden': 'true' },
})
export class SpaceNebulaFieldComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cdr = inject(ChangeDetectorRef);

  /* Camera position in vw (same units as StarMap.cameraX / cameraY). */
  @Input() panX = 0;
  @Input() panY = 0;
  /* Parallax factor: how fast the clouds move relative to the camera. */
  @Input() factor = 0.12;

  @HostListener('window:resize')
  onResize(): void {
    this.cdr.markForCheck();
  }

  get copies(): NebulaCopy[] {
    const { widthVw, heightVw } = this.hostSizeVw();
    return nebulaCopies(this.panX * this.factor, this.panY * this.factor, widthVw, heightVw);
  }

  /* Host size in vw; falls back to a 16:9 screen before layout. */
  private hostSizeVw(): { widthVw: number; heightVw: number } {
    const el = this.host.nativeElement;
    const vwPx = window.innerWidth / 100;
    const w = el.clientWidth || window.innerWidth;
    const h = el.clientHeight || window.innerHeight;
    return vwPx > 0 ? { widthVw: w / vwPx, heightVw: h / vwPx } : { widthVw: 100, heightVw: 56.25 };
  }
}

/*
 * Copies of every formation that overlap the host area (offset by the
 * parallax pan, all in vw) widened by PREPAINT_VW on each side. A copy at
 * lattice index (i, j) sits at (x + i * TILE_W - offsetX, y + j * TILE_H - offsetY).
 */
export function nebulaCopies(offsetX: number, offsetY: number, widthVw: number, heightVw: number): NebulaCopy[] {
  const out: NebulaCopy[] = [];
  for (const f of FORMATIONS) {
    const i0 = Math.ceil((offsetX - PREPAINT_VW - f.w - f.x) / NEBULA_TILE_W_VW);
    const i1 = Math.floor((offsetX + widthVw + PREPAINT_VW - f.x) / NEBULA_TILE_W_VW);
    const j0 = Math.ceil((offsetY - PREPAINT_VW - f.w - f.y) / NEBULA_TILE_H_VW);
    const j1 = Math.floor((offsetY + heightVw + PREPAINT_VW - f.y) / NEBULA_TILE_H_VW);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const left = f.x + i * NEBULA_TILE_W_VW - offsetX;
        const top = f.y + j * NEBULA_TILE_H_VW - offsetY;
        out.push({ key: `${f.kind}:${i}:${j}`, kind: f.kind, w: f.w, transform: `translate3d(${left}vw, ${top}vw, 0)` });
      }
    }
  }
  return out;
}

/* Positive modulo: keeps the offset in [0, size) for negative pans too. */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

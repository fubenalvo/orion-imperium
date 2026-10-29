import { Component, Input, Output, EventEmitter, NgZone, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarSystem } from '../star-map/star-map.models';
import { MinimapFleet } from './star-map-minimap.models';
import { NebulaView } from '../star-map/star-map-galaxy-view/star-map-galaxy-view.component';
import { BeltView } from '../star-map/asteroid-belts';

@Component({
  selector: 'app-star-map-minimap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-minimap.component.html',
  styleUrl: './star-map-minimap.component.scss'
})
export class StarMapMinimapComponent implements OnChanges {
  @Input() starSystems: StarSystem[] = [];
  @Input() fleets: MinimapFleet[] = [];
  // Nebula outlines pre-built by StarMap for the galaxy view (grid units).
  @Input() nebulae: NebulaView[] = [];
  // Asteroid belt axes (same SVG units as nebulae), drawn as thick rock lines.
  @Input() belts: BeltView[] = [];
  /*
   * Fog of war: galaxy cells ("col-row") the player has explored. The Set is
   * mutated in place by StarMap, so `exploredCount` (its size) is the
   * change signal; the fog path is rebuilt only when it changes.
   */
  @Input() exploredCells: ReadonlySet<string> = new Set();
  @Input() exploredCount = 0;
  @Input() fogEnabled = false;

  /* One path covering every unexplored cell (SVG units of nebulaTransform). */
  fogPath = '';
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 100;
  @Input() gridRows = 60;
  // Visible galaxy extent in world vw (already divided by the map zoom),
  // used both for the viewport rectangle and for centering on click.
  @Input() viewportWidthVw = 100;
  @Input() viewportHeightVw = 56.25;

  @Output() cameraChange = new EventEmitter<{ x: number; y: number }>();

  readonly MINIMAP_W = 240;
  readonly MINIMAP_H = 144;

  private dragging = false;
  private lastEmit = 0;

  constructor(private zone: NgZone) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['exploredCount'] || changes['exploredCells'] || changes['fogEnabled'] || changes['gridColumns'] || changes['gridRows']) {
      this.fogPath = this.fogEnabled ? this.buildFogPath() : '';
    }
  }

  /*
   * Unexplored cells merged into horizontal runs per row and emitted as one
   * path, so the fog costs a single SVG element regardless of map size.
   * In nebulaTransform units, cell `col` spans [col - 1, col].
   */
  private buildFogPath(): string {
    const exploredByRow = new Map<number, number[]>();
    for (const key of this.exploredCells) {
      const dash = key.indexOf('-');
      const col = Number(key.slice(0, dash));
      const row = Number(key.slice(dash + 1));
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const cols = exploredByRow.get(row);
      if (cols) cols.push(col);
      else exploredByRow.set(row, [col]);
    }
    const parts: string[] = [];
    const run = (row: number, from: number, to: number) => {
      // Covers cells from..to of this row.
      parts.push(`M${from - 1} ${row - 1}H${to}V${row}H${from - 1}Z`);
    };
    for (let row = 1; row <= this.gridRows; row++) {
      const cols = (exploredByRow.get(row) ?? []).sort((a, b) => a - b);
      let next = 1;
      for (const col of cols) {
        if (col > next) run(row, next, col - 1);
        next = Math.max(next, col + 1);
      }
      if (next <= this.gridColumns) run(row, next, this.gridColumns);
    }
    return parts.join('');
  }

  get totalMapVw(): number {
    return this.gridColumns * this.cellSizeVw;
  }

  get totalMapVh(): number {
    return this.gridRows * this.cellSizeVh;
  }

  get pxPerCol(): number {
    return this.MINIMAP_W / this.gridColumns;
  }

  get pxPerRow(): number {
    return this.MINIMAP_H / this.gridRows;
  }

  systemX(s: StarSystem): number {
    return (s.x - 1) * this.pxPerCol;
  }

  systemY(s: StarSystem): number {
    return (s.y - 1) * this.pxPerRow;
  }

  fleetX(f: MinimapFleet): number {
    return (f.x - 1) * this.pxPerCol;
  }

  fleetY(f: MinimapFleet): number {
    return (f.y - 1) * this.pxPerRow;
  }

  get viewportX(): number {
    return (this.cameraX / this.totalMapVw) * this.MINIMAP_W;
  }

  get viewportY(): number {
    return (this.cameraY / this.totalMapVh) * this.MINIMAP_H;
  }

  get viewportW(): number {
    return (this.viewportWidthVw / this.totalMapVw) * this.MINIMAP_W;
  }

  get viewportH(): number {
    return (this.viewportHeightVw / this.totalMapVh) * this.MINIMAP_H;
  }

  /*
   * Maps the galaxy view's nebula paths onto the minimap. Those paths put
   * grid coordinate N at N - 0.5 (cell center); the minimap places N at
   * (N - 1) × pxPerCol, hence the extra -0.5 shift before scaling.
   */
  get nebulaTransform(): string {
    return `scale(${this.pxPerCol} ${this.pxPerRow}) translate(-0.5 -0.5)`;
  }

  get viewBox(): string {
    return `0 0 ${this.MINIMAP_W} ${this.MINIMAP_H}`;
  }

  onPointerDown(e: PointerEvent): void {
    this.dragging = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    this.emitCamera(e);
  }

  onPointerMove(e: PointerEvent): void {
    if (!this.dragging) {
      return;
    }
    const now = performance.now();
    if (now - this.lastEmit > 16) {
      this.emitCamera(e);
      this.lastEmit = now;
    }
  }

  onPointerUp(): void {
    this.dragging = false;
  }

  private emitCamera(e: PointerEvent): void {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const cameraX = (pxX / rect.width) * this.totalMapVw - this.viewportWidthVw / 2;
    const cameraY = (pxY / rect.height) * this.totalMapVh - this.viewportHeightVw / 2;
    this.zone.run(() => {
      this.cameraChange.emit({ x: cameraX, y: cameraY });
    });
  }
}

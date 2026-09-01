import { Component, Input, Output, EventEmitter, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarSystem } from '../star-map/star-map.models';
import { MinimapFleet } from './star-map-minimap.models';

@Component({
  selector: 'app-star-map-minimap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-minimap.component.html',
  styleUrls: ['./star-map-minimap.component.scss']
})
export class StarMapMinimapComponent {
  @Input() starSystems: StarSystem[] = [];
  @Input() fleets: MinimapFleet[] = [];
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 100;
  @Input() gridRows = 60;
  @Input() viewportHeightVw = 56.25;

  @Output() cameraChange = new EventEmitter<{ x: number; y: number }>();

  readonly MINIMAP_W = 240;
  readonly MINIMAP_H = 144;

  private dragging = false;
  private lastEmit = 0;

  constructor(private zone: NgZone) {}

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
    return (100 / this.totalMapVw) * this.MINIMAP_W;
  }

  get viewportH(): number {
    return (this.viewportHeightVw / this.totalMapVh) * this.MINIMAP_H;
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
    const cameraX = (pxX / this.MINIMAP_W) * this.totalMapVw - 50;
    const cameraY = (pxY / this.MINIMAP_H) * this.totalMapVh - this.viewportHeightVw / 2;
    this.zone.run(() => {
      this.cameraChange.emit({ x: cameraX, y: cameraY });
    });
  }
}

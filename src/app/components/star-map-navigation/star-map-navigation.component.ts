import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarSystem } from '../star-map/star-map.models';
import { StarMapMinimapComponent } from '../star-map-minimap/star-map-minimap.component';
import { MinimapFleet } from '../star-map-minimap/star-map-minimap.models';

/*
 * =========================================================
 * STAR MAP NAVIGATION COMPONENT
 * =========================================================
 *
 * Provides directional buttons for camera panning and a minimap
 * for quick navigation. Uses setInterval for continuous movement
 * while a button is held. Supports both mouse and touch events.
 *
 * The 50ms repeat delay creates a smooth continuous movement effect.
 */

@Component({
  selector: 'app-star-map-navigation',
  standalone: true,
  imports: [CommonModule, StarMapMinimapComponent],
  templateUrl: './star-map-navigation.component.html',
  styleUrls: ['./star-map-navigation.component.scss']
})
export class StarMapNavigationComponent implements OnDestroy {
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  @Input() starSystems: StarSystem[] = [];
  @Input() fleets: MinimapFleet[] = [];
  @Input() cellSizeVw = 2;
  @Input() cellSizeVh = 2;
  @Input() gridColumns = 100;
  @Input() gridRows = 60;
  @Input() viewportHeightVw = 56.25;

  @Output() cameraMove = new EventEmitter<'up' | 'down' | 'left' | 'right'>();
  @Output() cameraSet = new EventEmitter<{ x: number; y: number }>();
  @Output() centerCamera = new EventEmitter<void>();

  private intervalId: number | null = null;
  private readonly repeatDelay = 50;

  /*
   * startMoving: Begins continuous camera movement in the given direction.
   * Emits the first movement immediately, then repeats every 50ms.
   */
  startMoving(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.stopMoving();
    this.cameraMove.emit(direction);
    this.intervalId = window.setInterval(() => {
      this.cameraMove.emit(direction);
    }, this.repeatDelay);
  }

  /*
   * stopMoving: Clears the movement interval.
   * Called on mouseup, mouseleave, touchend, touchcancel.
   */
  stopMoving(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onMinimapCameraChange(pos: { x: number; y: number }): void {
    this.cameraSet.emit(pos);
  }

  /*
   * ngOnDestroy: Ensures the interval is cleared when the component is destroyed.
   * Prevents memory leaks from orphaned intervals.
   */
  ngOnDestroy(): void {
    this.stopMoving();
  }
}

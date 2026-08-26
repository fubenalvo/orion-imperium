import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';

/*
 * =========================================================
 * STAR MAP NAVIGATION COMPONENT
 * =========================================================
 *
 * Provides directional buttons for camera panning.
 * Uses setInterval for continuous movement while the button is held.
 * Supports both mouse and touch events.
 *
 * The 50ms repeat delay creates a smooth continuous movement effect.
 */

@Component({
  selector: 'app-star-map-navigation',
  templateUrl: './star-map-navigation.component.html',
  styleUrls: ['./star-map-navigation.component.scss']
})
export class StarMapNavigationComponent implements OnDestroy {
  @Input() cameraX = 0;
  @Input() cameraY = 0;

  @Output() cameraMove = new EventEmitter<'up' | 'down' | 'left' | 'right'>();
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

  /*
   * ngOnDestroy: Ensures the interval is cleared when the component is destroyed.
   * Prevents memory leaks from orphaned intervals.
   */
  ngOnDestroy(): void {
    this.stopMoving();
  }
}
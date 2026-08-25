import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';

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

  startMoving(direction: 'up' | 'down' | 'left' | 'right'): void {
    this.stopMoving();
    this.cameraMove.emit(direction);
    this.intervalId = window.setInterval(() => {
      this.cameraMove.emit(direction);
    }, this.repeatDelay);
  }

  stopMoving(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  ngOnDestroy(): void {
    this.stopMoving();
  }
}
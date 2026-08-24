import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-star-map-navigation',
  templateUrl: './star-map-navigation.component.html',
  styleUrls: ['./star-map-navigation.component.scss']
})
export class StarMapNavigationComponent {
  @Input() cameraX = 0;
  @Input() cameraY = 0;
  
  @Output() cameraMove = new EventEmitter<'up' | 'down' | 'left' | 'right'>(); 
  @Output() centerCamera = new EventEmitter<void>();
}
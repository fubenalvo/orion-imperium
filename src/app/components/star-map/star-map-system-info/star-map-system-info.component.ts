import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarSystem } from '../star-map.models';

@Component({
  selector: 'app-star-map-system-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-system-info.component.html',
  styleUrl: './star-map-system-info.component.scss',
})
export class StarMapSystemInfoComponent {
  @Input() system: StarSystem | null = null;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';

  @Output() enterSystem = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
}

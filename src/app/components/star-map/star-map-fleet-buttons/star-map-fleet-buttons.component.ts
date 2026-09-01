import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Fleet } from '../star-map.models';

@Component({
  selector: 'app-star-map-fleet-buttons',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-fleet-buttons.component.html',
  styleUrl: './star-map-fleet-buttons.component.scss',
})
export class StarMapFleetButtonsComponent {
  @Input() fleets: Fleet[] = [];
  @Input() selectedFleetId: number | null = null;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';

  @Output() selectFleet = new EventEmitter<Fleet>();
}

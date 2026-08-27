import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Fleet, FleetShipTypeSummary } from '../star-map.models';

@Component({
  selector: 'app-star-map-fleet-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-fleet-info.component.html',
  styleUrl: './star-map-fleet-info.component.scss'
})
export class StarMapFleetInfoComponent {
  @Input() fleet: Fleet | null = null;
  @Input() fleetSummary: FleetShipTypeSummary[] = [];
  @Input() totalAttack = 0;
  @Input() totalDefense = 0;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() isPlayerFleet = false;
  @Input() selectedFleetAction: 'move' | 'attack' | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() setFleetAction = new EventEmitter<'move' | 'attack'>();
  @Output() selectFleet = new EventEmitter<Fleet>();
}

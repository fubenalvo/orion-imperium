import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Fleet, FleetShipTypeSummary } from '../star-map.models';

@Component({
  selector: 'app-star-map-fleet-info',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-fleet-info.component.html',
  styleUrl: './star-map-fleet-info.component.scss',
})
export class StarMapFleetInfoComponent {
  @Input() fleet: Fleet | null = null;
  @Input() fleetSummary: FleetShipTypeSummary[] = [];
  @Input() totalAttack = 0;
  @Input() totalDefense = 0;
  @Input() getFactionColor: (factionId: string) => string = () => '#fff';
  @Input() isPlayerFleet = false;
  @Input() selectedFleetAction: 'move' | null = null;
  @Input() canDisband = false;
  // Reason the last move command was rejected (null when the last move was accepted).
  @Input() moveError: string | null = null;
  // Remaining galaxy travel time in game seconds (route + nebula slowdown); null when idle.
  @Input() etaSeconds: number | null = null;
  @Input() inNebula = false;
  @Input() nebulaSpeedPenaltyPercent = 0;
  @Input() nebulaSensorPenaltyPercent = 0;
  // Label of the asteroid this fleet is intercepting, if any.
  @Input() interceptLabel: string | null = null;
  /* Name of the hostile fleet this fleet is pursuing (attack order), if any. */
  @Input() attackLabel: string | null = null;
  /* Fleet can be opened in the fleet manager (player fleet with living ships). */
  @Input() canOrganize = false;
  /* Player fleets on this fleet's cell, itself included; >1 means merging is possible. */
  @Input() coLocatedFleetCount = 1;
  /* Fleet stands at an own Spaceport: the ship reserve can be used in the fleet manager. */
  @Input() atSpaceport = false;
  /* Uninhabited planet the fleet is parked on and can colonize now (it carries a colonizer); null hides COLONIZE. */
  @Input() colonizeTargetName: string | null = null;

  formatEta(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }

  @Output() close = new EventEmitter<void>();
  @Output() setFleetAction = new EventEmitter<'move'>();
  @Output() selectFleet = new EventEmitter<Fleet>();
  @Output() disband = new EventEmitter<void>();
  @Output() organize = new EventEmitter<void>();
  @Output() colonize = new EventEmitter<void>();
}

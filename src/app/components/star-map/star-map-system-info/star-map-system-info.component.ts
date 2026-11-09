import { TutorialAnchorDirective } from '../../tutorial/tutorial-anchor.directive';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StarSystem } from '../star-map.models';

export type SystemStatusTone = 'unexplored' | 'explored' | 'own' | 'foreign' | 'contested';

export interface SystemStatus {
  label: string;
  tone: SystemStatusTone;
}

/*
 * Status line of the galaxy-map system panel, built only from what the
 * player legitimately knows:
 * - `charted`: the system's galaxy cell has been inside a player sensor
 *   range (or fog of war is off). StarSystem.explored cannot be used: every
 *   generated system has it set from the start so stars stay visible.
 * - Ownership: only from the player's own planets and from planets the
 *   player has explored (PlanetTile.explored); an unexplored planet's owner
 *   is hidden, exactly as in the system view.
 * Owning a planet in a system always counts as charted.
 */
export function getSystemStatus(
  system: StarSystem,
  charted: boolean,
  getFactionName: (factionId: string) => string,
): SystemStatus {
  const knownOwners = new Set<string>();
  for (const planet of system.planetsTiles ?? []) {
    if (planet.factionId === 'unhabited') continue;
    if (planet.factionId === 'player' || planet.explored) {
      knownOwners.add(planet.factionId);
    }
  }

  if (!charted && !knownOwners.has('player')) {
    return { label: 'Unexplored', tone: 'unexplored' };
  }
  if (knownOwners.size === 0) {
    return { label: 'Explored', tone: 'explored' };
  }
  if (knownOwners.size > 1) {
    return { label: 'Contested', tone: 'contested' };
  }
  const [owner] = knownOwners;
  return owner === 'player'
    ? { label: 'Your system', tone: 'own' }
    : { label: getFactionName(owner), tone: 'foreign' };
}

@Component({
  selector: 'app-star-map-system-info',
  standalone: true,
  imports: [CommonModule, TutorialAnchorDirective],
  templateUrl: './star-map-system-info.component.html',
  styleUrl: './star-map-system-info.component.scss',
})
export class StarMapSystemInfoComponent {
  @Input() system: StarSystem | null = null;
  /* True once the system's cell was in player sensor range (see getSystemStatus). */
  @Input() charted = false;
  @Input() getFactionName: (factionId: string) => string = () => 'Unknown';

  @Output() enterSystem = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  get status(): SystemStatus {
    return this.system
      ? getSystemStatus(this.system, this.charted, this.getFactionName)
      : { label: 'Unexplored', tone: 'unexplored' };
  }
}

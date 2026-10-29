import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AsteroidType } from '../star-map.models';

/*
 * View model of the selected drifting asteroid. Built by StarMap (throttled,
 * see StarMap.refreshAsteroidPanel) so the intercept estimates — which plan
 * routes — are not recomputed on every change-detection pass.
 */
export interface AsteroidPanelViewModel {
  id: number;
  type: AsteroidType;
  label: string;
  cargo: { label: string; amount: number }[];
  secondsToExit: number;
  /* Player fleets with their intercept estimate (null = cannot reach in time). */
  fleets: { fleetId: number; name: string; etaSeconds: number | null; intercepting: boolean }[];
}

/*
 * Presentational panel for a selected drifting asteroid: cargo, time left
 * before it leaves the map, and one INTERCEPT action per player fleet that
 * can reach it in time (fleets that cannot are listed as out of reach).
 */
@Component({
  selector: 'app-star-map-asteroid-info',
  standalone: true,
  templateUrl: './star-map-asteroid-info.component.html',
  styleUrl: './star-map-asteroid-info.component.scss',
})
export class StarMapAsteroidInfoComponent {
  @Input() vm: AsteroidPanelViewModel | null = null;
  @Input() message: string | null = null;

  @Output() intercept = new EventEmitter<number>();
  @Output() close = new EventEmitter<void>();

  formatSeconds(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}

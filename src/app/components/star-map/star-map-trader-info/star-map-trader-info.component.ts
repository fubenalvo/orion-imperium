import { Component, EventEmitter, Input, Output } from '@angular/core';

/*
 * View model of the selected civilian trader (docs/trade-network.md). Built
 * by StarMap and refreshed at most every 0.5 game seconds (the ETA reads the
 * remaining route), not from a template getter.
 */
export interface TraderPanelViewModel {
  id: number;
  /* Who the trader works for: the home post owner's name, or "Independent". */
  affiliation: string;
  affiliationColor: string;
  /* own = the player's network, civilian = a neutral owner, foreign = another empire. */
  relation: 'own' | 'civilian' | 'foreign';
  homePost: string;
  from: string;
  to: string;
  goods: string;
  cargoCredits: number;
  etaSeconds: number | null;
  hullPercent: number;
  /*
   * Raid section (docs/trade-network.md#raids); null for the player's own
   * traders. `blocked` explains why it cannot be raided at all; `warning`
   * names the diplomatic cost of raiding it.
   */
  raid: {
    blocked: string | null;
    warning: string | null;
    /* Player fleets: ETA to the trader's current position (null = unreachable). */
    fleets: { fleetId: number; name: string; status: 'raiding' | 'ready' | 'no-warships' | 'unreachable'; etaSeconds: number | null }[];
  } | null;
}

/*
 * Presentational panel for a selected trader: affiliation, home post, the
 * current leg, cargo and its value, the time to arrival, and one RAID action
 * per player fleet (with the diplomatic cost spelled out before the click).
 */
@Component({
  selector: 'app-star-map-trader-info',
  standalone: true,
  templateUrl: './star-map-trader-info.component.html',
  styleUrl: './star-map-trader-info.component.scss',
})
export class StarMapTraderInfoComponent {
  @Input() vm: TraderPanelViewModel | null = null;

  @Output() raid = new EventEmitter<number>();
  @Output() close = new EventEmitter<void>();

  formatSeconds(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
  }
}

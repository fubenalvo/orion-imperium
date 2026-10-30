import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TreatyState } from '../star-map.models';

/*
 * One row of the diplomacy screen: the player's relation with one other
 * participant plus what is publicly known about it. Built by
 * StarMap.getDiplomacyRows; the component is a pure view and only emits
 * the player's choices (rules live in DiplomacyService /
 * EnemyDiplomacyService, see docs/diplomacy.md).
 */
export interface DiplomacyRowVm {
  id: string;
  name: string;
  color: string;
  personality: string;
  state: TreatyState;
  /* Seconds until the treaty may change (0 = now). */
  lockSeconds: number;
  /* False once the faction has no planet and no living fleet. */
  alive: boolean;
  planets: number;
  /* Fleet strength compared with the player's. */
  strength: 'weaker' | 'comparable' | 'stronger';
  /* Seconds left on this faction's peace offer to the player (0 = none). */
  offerSeconds: number;
  /* Seconds until the player may propose peace again after a refusal. */
  proposalCooldown: number;
  atWarWith: string[];
  atPeaceWith: string[];
}

@Component({
  selector: 'app-star-map-diplomacy',
  standalone: true,
  templateUrl: './star-map-diplomacy.component.html',
  styleUrl: './star-map-diplomacy.component.scss',
})
export class StarMapDiplomacyComponent {
  @Input() rows: DiplomacyRowVm[] = [];
  @Input() message: string | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() proposePeace = new EventEmitter<string>();
  @Output() declareWar = new EventEmitter<string>();
  @Output() acceptOffer = new EventEmitter<string>();
  @Output() declineOffer = new EventEmitter<string>();

  readonly strengthLabels: Record<DiplomacyRowVm['strength'], string> = {
    weaker: 'Weaker fleet than yours',
    comparable: 'Fleet comparable to yours',
    stronger: 'Stronger fleet than yours',
  };

  get warCount(): number {
    return this.rows.filter((r) => r.alive && r.state === 'war').length;
  }
}

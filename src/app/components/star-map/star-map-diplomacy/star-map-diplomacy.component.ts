import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DiplomacyRowVm, DiplomacySummaryVm } from '../star-map-diplomacy-vm';
import {
  OPINION_TREATY_BROKEN,
  OPINION_WAR_DECLARED,
  REPUTATION_SURPRISE_ATTACK,
  REPUTATION_TREATY_BROKEN,
  REPUTATION_WAR_DECLARED,
  SURPRISE_ATTACK_WINDOW_SECONDS,
  TRUCE_SECONDS,
  formatGameDuration,
} from '../diplomacy';

export type { DiplomacyRowVm } from '../star-map-diplomacy-vm';

/*
 * Diplomacy screen: one card per other empire with the relation, the
 * diplomatic values (opinion, reputation, exhaustion, truce) and the
 * available actions. Pure view: it only emits the player's choices; the
 * rules live in DiplomacyService / EnemyDiplomacyService and the numbers
 * come from star-map-diplomacy-vm.ts (docs/diplomacy.md).
 *
 * Declaring war and breaking a treaty go through an inline confirmation
 * that states the consequences, so the player always knows the cost.
 */
@Component({
  selector: 'app-star-map-diplomacy',
  standalone: true,
  templateUrl: './star-map-diplomacy.component.html',
  styleUrl: './star-map-diplomacy.component.scss',
})
export class StarMapDiplomacyComponent {
  @Input() rows: DiplomacyRowVm[] = [];
  @Input() summary: DiplomacySummaryVm | null = null;
  @Input() message: string | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() negotiate = new EventEmitter<string>();
  @Output() declareWar = new EventEmitter<string>();
  @Output() breakTreaty = new EventEmitter<string>();
  @Output() declineOffer = new EventEmitter<string>();

  /* Row awaiting confirmation of a war declaration or a treaty breach. */
  confirming: { id: string; action: 'war' | 'breach' } | null = null;

  readonly truceLabel = formatGameDuration(TRUCE_SECONDS);
  readonly warConsequence =
    `Your reputation ${REPUTATION_WAR_DECLARED}, their opinion of you ${OPINION_WAR_DECLARED}. ` +
    `Attacking them within ${formatGameDuration(SURPRISE_ATTACK_WINDOW_SECONDS)} of game time after the declaration counts as a surprise attack (reputation ${REPUTATION_SURPRISE_ATTACK}).`;
  readonly breachConsequence =
    `Treachery: your reputation ${REPUTATION_TREATY_BROKEN} (every empire trusts you less), their opinion of you ${OPINION_TREATY_BROKEN}.`;

  readonly strengthLabels: Record<DiplomacyRowVm['strength'], string> = {
    weaker: 'Weaker fleet than yours',
    comparable: 'Fleet comparable to yours',
    stronger: 'Stronger fleet than yours',
  };

  ask(id: string, action: 'war' | 'breach'): void {
    this.confirming = { id, action };
  }

  confirm(): void {
    if (!this.confirming) return;
    const { id, action } = this.confirming;
    this.confirming = null;
    if (action === 'war') this.declareWar.emit(id);
    else this.breakTreaty.emit(id);
  }

  isConfirming(id: string, action: 'war' | 'breach'): boolean {
    return this.confirming?.id === id && this.confirming.action === action;
  }

  /* Sign-prefixed value for opinion / reputation readouts. */
  signed(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
  }

  tone(value: number): 'positive' | 'danger' | null {
    return value >= 20 ? 'positive' : value <= -20 ? 'danger' : null;
  }
}

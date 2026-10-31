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
import {
  DEMAND_KINDS,
  DEMAND_PAIR_COOLDOWN_SECONDS,
  DEMAND_RULES,
  DemandKind,
  FOLLOW_THROUGH_SECONDS,
  PLAYER_DEMAND_COOLDOWN_SECONDS,
  REPUTATION_EMPTY_THREAT,
} from '../diplomatic-demand';

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
 *
 * Credit demands: at peace a card offers DEMAND CREDITS… (kind, amount,
 * consequences, then send). Incoming AI demands and the player's refused
 * ultimatums appear on the demander's / target's card with their timers.
 * The screen states what a refusal may cost but never whether an AI
 * threat is a bluff (that is decided only when the player refuses).
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
  /* Credit demands (docs/diplomacy.md): the player's outgoing demand and answers. */
  @Output() sendDemand = new EventEmitter<{ targetId: string; kind: DemandKind; amount: number }>();
  @Output() acceptDemand = new EventEmitter<number>();
  @Output() declineDemand = new EventEmitter<number>();
  @Output() carryOutThreat = new EventEmitter<number>();
  @Output() backDownThreat = new EventEmitter<number>();

  /* Row awaiting confirmation of a war declaration or a treaty breach. */
  confirming: { id: string; action: 'war' | 'breach' } | null = null;
  /* The open "demand credits" form (one row at a time). */
  demandForm: { id: string; kind: DemandKind; amount: number } | null = null;

  readonly demandKinds = DEMAND_KINDS;
  readonly demandKindLabels: Record<DemandKind, string> = {
    request: 'Request support',
    tribute: 'Demand tribute',
    threat: 'Ultimatum',
  };
  /*
   * What sending each kind costs and risks, from the same constants the
   * rules use. The AI's answer depends on its personality and situation;
   * nothing here promises success.
   */
  readonly demandOutgoingConsequence: Record<DemandKind, string> = {
    request:
      'A polite request: it does not offend them now, but every demand they still remember costs opinion. ' +
      'They pay if they like you and can spare the credits.',
    tribute:
      `Their opinion of you ${DEMAND_RULES.tribute.issueOpinion} now (more for repeated demands). ` +
      'They pay only if they respect your power more than they value their pride.',
    threat:
      `Their opinion of you ${DEMAND_RULES.threat.issueOpinion} now. If they refuse, you have ${formatGameDuration(FOLLOW_THROUGH_SECONDS)} ` +
      `to declare war (reputation ${REPUTATION_WAR_DECLARED}, their opinion ${OPINION_WAR_DECLARED}) or to back down ` +
      `(reputation ${REPUTATION_EMPTY_THREAT}; every empire takes your threats less seriously).`,
  };
  readonly backDownPenalty = REPUTATION_EMPTY_THREAT;
  readonly demandLimits =
    `One demand every ${formatGameDuration(PLAYER_DEMAND_COOLDOWN_SECONDS)}, and to the same empire every ${formatGameDuration(DEMAND_PAIR_COOLDOWN_SECONDS)} of game time.`;

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
    this.demandForm = null;
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

  openDemandForm(row: DiplomacyRowVm): void {
    this.confirming = null;
    this.demandForm = { id: row.id, kind: 'request', amount: row.demandOptions.suggested };
  }

  setDemandKind(kind: DemandKind): void {
    if (this.demandForm) this.demandForm = { ...this.demandForm, kind };
  }

  /* Clamps the typed amount to what the rules allow: whole credits, at least the minimum, at most their stock. */
  setDemandAmount(row: DiplomacyRowVm, raw: string): void {
    if (!this.demandForm) return;
    const parsed = Math.floor(Number(raw));
    const { minAmount, maxAmount } = row.demandOptions;
    const amount = Number.isFinite(parsed) ? Math.min(maxAmount, Math.max(minAmount, parsed)) : minAmount;
    this.demandForm = { ...this.demandForm, amount };
  }

  submitDemand(row: DiplomacyRowVm): void {
    const form = this.demandForm;
    if (!form || form.id !== row.id || !row.demandOptions.available) return;
    if (form.kind === 'threat' && !row.demandOptions.threatAllowed) return;
    this.demandForm = null;
    this.sendDemand.emit({ targetId: row.id, kind: form.kind, amount: form.amount });
  }

  isDemandFormOpen(id: string): boolean {
    return this.demandForm?.id === id;
  }

  /* Whole credits with thousands separators ("12,500"). */
  credits(value: number): string {
    return Math.floor(value).toLocaleString('en-US');
  }

  /* Sign-prefixed value for opinion / reputation readouts. */
  signed(value: number): string {
    return value > 0 ? `+${value}` : `${value}`;
  }

  tone(value: number): 'positive' | 'danger' | null {
    return value >= 20 ? 'positive' : value <= -20 ? 'danger' : null;
  }
}

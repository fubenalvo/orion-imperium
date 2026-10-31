import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { NegotiationSideVm, NegotiationVm } from '../star-map-diplomacy-vm';
import { PeaceTreaty, ResourceItemKind, TreatyItem } from '../peace-treaty';
import { TRUCE_SECONDS, formatGameDuration } from '../diplomacy';

/*
 * Peace negotiation dialog. Stateless: the draft lives in StarMap
 * (`negotiation.draft`) and arrives through the view model; every edit
 * emits a new treaty through `draftChange`, and StarMap passes back the
 * AI's live evaluation (acceptance meter and factors), so the player sees
 * the AI's judgment of exactly the terms on screen. The game is paused
 * while this dialog is open.
 *
 * "Demand" items are given by the AI, "offer" items by the player. Terms
 * are credits and raw materials only: planets and star systems are not
 * negotiable (docs/diplomacy.md#peace-treaties-peace-treatyts).
 */
@Component({
  selector: 'app-star-map-peace-negotiation',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './star-map-peace-negotiation.component.html',
  styleUrl: './star-map-peace-negotiation.component.scss',
})
export class StarMapPeaceNegotiationComponent {
  @Input({ required: true }) vm!: NegotiationVm;

  @Output() draftChange = new EventEmitter<PeaceTreaty>();
  @Output() send = new EventEmitter<PeaceTreaty>();
  @Output() acceptIncoming = new EventEmitter<void>();
  @Output() editIncoming = new EventEmitter<void>();
  @Output() declineIncoming = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  readonly truceLabel = formatGameDuration(TRUCE_SECONDS);
  readonly formatDuration = formatGameDuration;

  /* The side that gives in a column: demands are given by them, offers by you. */
  giverSide(column: 'demand' | 'offer'): NegotiationSideVm {
    return column === 'demand' ? this.vm.them : this.vm.you;
  }

  amount(column: 'demand' | 'offer', kind: ResourceItemKind): number {
    const giverId = this.giverSide(column).factionId;
    const item = this.vm.draft.items.find((i) => i.kind === kind && i.giverId === giverId);
    return item?.amount ?? 0;
  }

  setAmount(column: 'demand' | 'offer', kind: ResourceItemKind, raw: string): void {
    const side = this.giverSide(column);
    const max = kind === 'credits' ? side.credits : side.rawmaterials;
    const parsed = Math.floor(Number(raw));
    const amount = Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
    const items = this.vm.draft.items.filter((i) => !(i.kind === kind && i.giverId === side.factionId));
    if (amount > 0) items.push({ kind, giverId: side.factionId, amount });
    this.emit(items);
  }

  clearDraft(): void {
    this.emit([]);
  }

  submit(): void {
    if (this.vm.evaluation.valid) this.send.emit(this.vm.draft);
  }

  verdict(): string {
    const e = this.vm.evaluation;
    if (!e.valid) return e.invalidText ?? 'These terms are not possible.';
    if (e.accept) return `${this.vm.them.name} would accept these terms.`;
    if (e.acceptance >= 0.35) return `Close: ${this.vm.them.name} wants about ${e.shortfall.toLocaleString('en-US')} credits of value more.`;
    return `${this.vm.them.name} would refuse: about ${e.shortfall.toLocaleString('en-US')} credits of value short.`;
  }

  signed(value: number, digits = 2): string {
    const fixed = value.toFixed(digits);
    return value > 0 ? `+${fixed}` : fixed;
  }

  private emit(items: TreatyItem[]): void {
    this.draftChange.emit({ ...this.vm.draft, items });
  }
}

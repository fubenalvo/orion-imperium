import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { NegotiationSideVm, NegotiationVm } from '../star-map-diplomacy-vm';
import { PeaceTreaty, ResourceItemKind, TreatyItem } from '../peace-treaty';
import { TRUCE_TURNS } from '../diplomacy';

/*
 * Peace negotiation dialog. Stateless: the draft lives in StarMap
 * (`negotiation.draft`) and arrives through the view model; every edit
 * emits a new treaty through `draftChange`, and StarMap passes back the
 * AI's live evaluation (acceptance meter and factors), so the player sees
 * the AI's judgment of exactly the terms on screen. The game is paused
 * while this dialog is open.
 *
 * "Demand" items are given by the AI, "offer" items by the player.
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

  readonly truceTurns = TRUCE_TURNS;

  /* The side that gives in a column: demands are given by them, offers by you. */
  giverSide(column: 'demand' | 'offer'): NegotiationSideVm {
    return column === 'demand' ? this.vm.them : this.vm.you;
  }

  amount(column: 'demand' | 'offer', kind: ResourceItemKind): number {
    const giverId = this.giverSide(column).factionId;
    const item = this.vm.draft.items.find((i) => i.kind === kind && i.giverId === giverId);
    return item && 'amount' in item ? item.amount : 0;
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

  isPlanetSelected(column: 'demand' | 'offer', planetId: number): boolean {
    const giverId = this.giverSide(column).factionId;
    return this.vm.draft.items.some((i) => i.kind === 'planet' && i.giverId === giverId && i.planetId === planetId);
  }

  /* A planet is covered when its whole system is already listed. */
  isPlanetCovered(column: 'demand' | 'offer', systemId: string): boolean {
    return this.isSystemSelected(column, systemId);
  }

  togglePlanet(column: 'demand' | 'offer', planetId: number): void {
    const giverId = this.giverSide(column).factionId;
    const selected = this.isPlanetSelected(column, planetId);
    const items = this.vm.draft.items.filter((i) => !(i.kind === 'planet' && i.giverId === giverId && i.planetId === planetId));
    if (!selected) items.push({ kind: 'planet', giverId, planetId });
    this.emit(items);
  }

  isSystemSelected(column: 'demand' | 'offer', systemId: string): boolean {
    const giverId = this.giverSide(column).factionId;
    return this.vm.draft.items.some((i) => i.kind === 'system' && i.giverId === giverId && i.systemId === systemId);
  }

  /* Selecting a system replaces any single planets of that system (no planet listed twice). */
  toggleSystem(column: 'demand' | 'offer', systemId: string): void {
    const side = this.giverSide(column);
    const selected = this.isSystemSelected(column, systemId);
    const systemPlanets = new Set(side.systems.find((s) => s.id === systemId)?.planetIds ?? []);
    let items = this.vm.draft.items.filter((i) => !(i.kind === 'system' && i.giverId === side.factionId && i.systemId === systemId));
    if (!selected) {
      items = items.filter((i) => !(i.kind === 'planet' && i.giverId === side.factionId && systemPlanets.has(i.planetId)));
      items.push({ kind: 'system', giverId: side.factionId, systemId });
    }
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

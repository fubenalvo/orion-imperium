import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DysonBonusDef, DysonBonusId } from '../dyson-anchor';

/* View model of the selected Dyson anchor, built by StarMap (anchorPanelVm). */
export interface AnchorPanelViewModel {
  id: number;
  name: string;
  ownerName: string;
  color: string;
  /* The viewer owns it: bonus pick and DEMOLISH are offered. */
  own: boolean;
  building: boolean;
  secondsLeft: number;
  /* 0 … 1 construction progress (1 when complete). */
  progress: number;
  /* "Turrets 2/3 · Hull 900/900", or the construction-site line. */
  defense: string;
  bonus: DysonBonusDef | null;
  bonusOptions: readonly DysonBonusDef[];
}

/*
 * Presentational panel of a Dyson anchor (docs/dyson-swarm.md): owner,
 * construction state, defense, the one-time bonus pick and DEMOLISH (no
 * refund, frees the slot) behind an inline confirmation. Every decision is
 * emitted to StarMap, which applies it through SpaceBaseService.
 */
@Component({
  selector: 'app-star-map-anchor-info',
  standalone: true,
  templateUrl: './star-map-anchor-info.component.html',
  styleUrl: './star-map-anchor-info.component.scss',
})
export class StarMapAnchorInfoComponent implements OnChanges {
  @Input() vm: AnchorPanelViewModel | null = null;

  @Output() pickBonus = new EventEmitter<DysonBonusId>();
  @Output() demolish = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  confirmingDemolish = false;

  ngOnChanges(changes: SimpleChanges): void {
    // A different anchor never inherits an open confirmation.
    const previous = changes['vm']?.previousValue as AnchorPanelViewModel | null | undefined;
    if (previous && previous.id !== this.vm?.id) this.confirmingDemolish = false;
  }

  progressPercent(vm: AnchorPanelViewModel): number {
    return Math.round(vm.progress * 100);
  }

  confirmDemolish(): void {
    this.confirmingDemolish = false;
    this.demolish.emit();
  }
}

import {
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanetTile, ProductionOrder, StarSystem } from '../../../components/star-map/star-map.models';
import { ShipType } from '../../../services/ship.service';

export interface QueueOrderRequest {
  shipTypeId: string;
  quantity: number;
}

export interface ProductionPanelViewModel {
  planet: PlanetTile;
  system: StarSystem;
  factionId: string;
  buildable: ShipType[];
  capacity: number;
  power: number;
  queue: ProductionOrder[];
  shipCosts: Record<string, number>;
  shipBuildTimes: Record<string, number>;
  etas: Record<number, number | null>;
  factionCredits: number;
}

@Component({
  selector: 'app-star-map-production-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-production-panel.component.html',
  styleUrl: './star-map-production-panel.component.scss',
})
export class StarMapProductionPanelComponent {
  @Input() vm: ProductionPanelViewModel | null = null;
  @Input() showBuildMenu = false;
  @Input() buildError: string | null = null;

  @Output() openBuildMenu = new EventEmitter<void>();
  @Output() closeBuildMenu = new EventEmitter<void>();
  @Output() queueOrder = new EventEmitter<QueueOrderRequest>();
  @Output() cancelOrder = new EventEmitter<number>();

  selectedTypeId: string | null = null;
  selectedQuantity = 1;

  pickType(shipTypeId: string): void {
    this.selectedTypeId = shipTypeId;
    this.selectedQuantity = 1;
  }

  changeQuantity(delta: number): void {
    const next = this.selectedQuantity + delta;
    this.selectedQuantity = Math.max(1, Math.min(99, next));
  }

  totalCost(): number {
    if (!this.vm || !this.selectedTypeId) {
      return 0;
    }
    const cost = this.vm.shipCosts[this.selectedTypeId] ?? 0;
    return cost * this.selectedQuantity;
  }

  canQueue(): boolean {
    if (!this.vm || !this.selectedTypeId) {
      return false;
    }
    return this.vm.factionCredits >= this.totalCost();
  }

  confirmQueue(): void {
    if (!this.selectedTypeId) {
      return;
    }
    this.queueOrder.emit({ shipTypeId: this.selectedTypeId, quantity: this.selectedQuantity });
    this.selectedTypeId = null;
    this.selectedQuantity = 1;
    this.closeBuildMenu.emit();
  }

  cancelOrderClick(orderId: number): void {
    this.cancelOrder.emit(orderId);
  }

  formatEta(eta: number | null | undefined): string {
    if (eta == null) {
      return '—';
    }
    if (eta < 1) {
      return '< 1s';
    }
    return `${Math.ceil(eta)}s`;
  }
}

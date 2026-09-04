import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ShipStockEntryDisplay {
  typeId: string;
  typeName: string;
  count: number;
}

@Component({
  selector: 'app-star-map-ship-stock',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './star-map-ship-stock.component.html',
  styleUrl: './star-map-ship-stock.component.scss',
})
export class StarMapShipStockComponent {
  @Input() entries: ShipStockEntryDisplay[] = [];
  @Input() totalShips = 0;

  showDetails = false;

  toggleDetails(): void {
    this.showDetails = !this.showDetails;
  }

  closeDetails(event: MouseEvent): void {
    event.stopPropagation();
    this.showDetails = false;
  }
}

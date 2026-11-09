import { Component, Input, inject } from '@angular/core';
import { TutorialService } from '../../../services/tutorial.service';
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
  private readonly tutorial = inject(TutorialService);

  toggleDetails(): void {
    this.showDetails = !this.showDetails;
    if (this.showDetails) this.tutorial.notify('stock-opened');
  }

  closeDetails(event: MouseEvent): void {
    event.stopPropagation();
    this.showDetails = false;
  }
}

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown } from '../../../services/economy.service';
import { FactionCurrenciesComponent, CurrencyDisplay } from '../faction-currencies/faction-currencies.component';
import {
  StarMapShipStockComponent,
  ShipStockEntryDisplay,
} from '../star-map-ship-stock/star-map-ship-stock.component';

/*
 * =========================================================
 * STAR MAP HEADER
 * =========================================================
 *
 * Shared top HUD used by every star-map view (map, system,
 * planet). The right-hand group bundles the player's currency
 * row and the global empire ship stock indicator into a single
 * flex container so the spacing is consistent regardless of the
 * view.
 *
 * The header sits at the top 8% of its parent and pushes the
 * view content below it (the view's main grid is positioned with
 * `top: 8%`).
 */
@Component({
  selector: 'app-star-map-header',
  standalone: true,
  imports: [CommonModule, FactionCurrenciesComponent, StarMapShipStockComponent],
  templateUrl: './star-map-header.component.html',
  styleUrl: './star-map-header.component.scss',
})
export class StarMapHeaderComponent {
  @Input() title = '';
  @Input() currencies: CurrencyDisplay[] = [];
  @Input() economyBreakdown: EconomyBreakdown | null = null;
  @Input() shipStockEntries: ShipStockEntryDisplay[] = [];
  @Input() shipStockTotal = 0;
}

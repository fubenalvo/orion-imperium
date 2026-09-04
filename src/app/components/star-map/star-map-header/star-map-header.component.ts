import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown } from '../../../services/economy.service';
import { GameSpeed } from '../../../services/game-time.service';
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
 * planet). The left group shows the view title, the center
 * group holds the time-control buttons ([⏸] [1x] [2x]), and
 * the right group bundles the player's currency row and the
 * global empire ship stock indicator into a single flex
 * container so the spacing is consistent regardless of the
 * view.
 *
 * The header sits at the top 8% of its parent and pushes the
 * view content below it (the view's main grid is positioned with
 * `top: 8%`).
 *
 * Time controls: the header receives `gameSpeed` (1 or 2) and
 * `isPaused` from the StarMap orchestrator and emits
 * `setSpeed` / `togglePause` events back. The actual time
 * state lives in GameTimeService — the header is a pure view
 * of that state.
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

  @Input() gameSpeed: GameSpeed = 1;
  @Input() isPaused = false;

  @Output() setSpeed = new EventEmitter<GameSpeed>();
  @Output() togglePause = new EventEmitter<void>();
}

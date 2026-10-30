import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown } from '../../../services/economy.service';
import { GameSpeed } from '../../../services/game-time.service';
import { FactionCurrenciesComponent, CurrencyDisplay } from '../faction-currencies/faction-currencies.component';
import {
  StarMapShipStockComponent,
  ShipStockEntryDisplay,
} from '../star-map-ship-stock/star-map-ship-stock.component';
import { GameHeaderComponent, GameHeaderSpeedOption } from '../../game-header/game-header.component';

/*
 * =========================================================
 * STAR MAP HEADER
 * =========================================================
 *
 * Star-map flavour of the shared GameHeaderComponent, used by every
 * star-map view (map, system, planet). It fills the generic header with
 * the view title, an optional back button, the strategic time controls
 * ([⏸] [1x] [2x]), the player's currency row, the global ship stock
 * indicator and the pause-menu button.
 *
 * The header overlays the top --game-header-h of its parent; view content
 * that must not sit under it offsets itself by the same token.
 *
 * Time controls: the header receives `gameSpeed` (1 or 2) and `isPaused`
 * from the StarMap orchestrator and emits `setSpeed` / `togglePause` back.
 * The actual time state lives in GameTimeService — the header is a pure
 * view of that state. `openMenu` opens the pause menu (StarMapPauseComponent
 * only renders the overlay, not a trigger button).
 */
@Component({
  selector: 'app-star-map-header',
  standalone: true,
  imports: [CommonModule, GameHeaderComponent, FactionCurrenciesComponent, StarMapShipStockComponent],
  templateUrl: './star-map-header.component.html',
  styleUrl: './star-map-header.component.scss',
})
export class StarMapHeaderComponent {
  @Input() title = '';
  /** Destination of the back button, e.g. "STAR MAP". No button when null. */
  @Input() backLabel: string | null = null;
  @Input() currencies: CurrencyDisplay[] = [];
  @Input() economyBreakdown: EconomyBreakdown | null = null;
  @Input() shipStockEntries: ShipStockEntryDisplay[] = [];
  @Input() shipStockTotal = 0;

  @Input() gameSpeed: GameSpeed = 1;
  @Input() isPaused = false;

  @Output() setSpeed = new EventEmitter<GameSpeed>();
  @Output() togglePause = new EventEmitter<void>();
  @Output() openResearchTree = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  @Output() openMenu = new EventEmitter<void>();

  readonly speedOptions: readonly GameHeaderSpeedOption[] = [
    { value: 1, label: '1x' },
    { value: 2, label: '2x' },
  ];

  onSetSpeed(speed: number): void {
    this.setSpeed.emit(speed as GameSpeed);
  }
}

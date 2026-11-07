import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown, ResourceType } from '../../../services/economy.service';
import {
  TRADE_BUY_CREDITS_PER_RAW,
  TRADE_LOTS,
  TRADE_SELL_CREDITS_PER_RAW,
  TradeDirection,
  quoteTrade,
} from '../trade';

export interface CurrencyDisplay {
  name: string;
  value: number;
}

/*
 * Empire-wide trade figures for the resource overlay (docs/economy.md,
 * "Trading Post"; docs/trade-network.md). Built by StarMap.
 */
export interface TradeSummaryView {
  /* The player owns a Trading Post somewhere: the exchange is open. */
  hasTradingPost: boolean;
  ownPosts: number;
  networkPosts: number;
  networkTraders: number;
  /* Delivery income (outside the economy tick) in the last `windowMinutes`. */
  recentIncome: number;
  windowMinutes: number;
}

@Component({
  selector: 'app-faction-currencies',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './faction-currencies.component.html',
  styleUrl: './faction-currencies.component.scss',
})
export class FactionCurrenciesComponent {
  @Input() currencies: CurrencyDisplay[] = [];
  @Input() economyBreakdown: EconomyBreakdown | null = null;
  @Input() tradeSummary: TradeSummaryView | null = null;

  @Output() openResearchTree = new EventEmitter<void>();
  /* An exchange request; StarMap re-checks every rule in trade.ts executeTrade. */
  @Output() tradeRequest = new EventEmitter<{ direction: TradeDirection; raw: number }>();

  readonly tradeLots = TRADE_LOTS;
  readonly tradeBuyRate = TRADE_BUY_CREDITS_PER_RAW;
  readonly tradeSellRate = TRADE_SELL_CREDITS_PER_RAW;

  tradeCredits(direction: TradeDirection, raw: number): number {
    return quoteTrade(direction, raw).credits;
  }

  private stockOf(name: string): number {
    return this.currencies.find((c) => c.name === name)?.value ?? 0;
  }

  canTrade(direction: TradeDirection, raw: number): boolean {
    if (!this.tradeSummary?.hasTradingPost) return false;
    return direction === 'buyRaw'
      ? this.stockOf('credits') >= this.tradeCredits(direction, raw)
      : this.stockOf('rawmaterials') >= raw;
  }

  requestTrade(direction: TradeDirection, raw: number): void {
    if (!this.canTrade(direction, raw)) return;
    this.tradeRequest.emit({ direction, raw });
  }

  showBreakdown = false;
  selectedCurrency: ResourceType | null = null;
  expandedPlanet: string | null = null;

  toggleBreakdown(currencyName: string): void {
    const validCurrencies: ResourceType[] = ['credits', 'rawmaterials'];
    if (!validCurrencies.includes(currencyName as ResourceType)) return;

    if (this.showBreakdown && this.selectedCurrency === currencyName) {
      this.showBreakdown = false;
      this.selectedCurrency = null;
    } else {
      this.showBreakdown = true;
      this.selectedCurrency = currencyName as ResourceType;
    }
    this.expandedPlanet = null;
  }

  onCurrencyValueClick(currencyName: string): void {
    if (currencyName === 'research') {
      this.openResearchTree.emit();
    } else {
      this.toggleBreakdown(currencyName);
    }
  }

  closeBreakdown(): void {
    this.showBreakdown = false;
    this.selectedCurrency = null;
    this.expandedPlanet = null;
  }

  togglePlanet(planetName: string): void {
    this.expandedPlanet = this.expandedPlanet === planetName ? null : planetName;
  }

  isPlanetExpanded(planetName: string): boolean {
    return this.expandedPlanet === planetName;
  }

  getSelectedCurrencyLabel(): string {
    if (!this.selectedCurrency) return '';
    const labels: Record<ResourceType, string> = {
      credits: 'Credits',
      rawmaterials: 'Raw Materials',
      research: 'Research Points',
      energy: 'Energy',
    };
    return labels[this.selectedCurrency] || this.selectedCurrency.toUpperCase();
  }

  getProductionForCurrency(): number {
    if (!this.economyBreakdown || !this.selectedCurrency) return 0;
    return this.economyBreakdown.production[this.selectedCurrency] ?? 0;
  }

  /*
   * Raw production that does not come from deposits: the population
   * trickle, the economy's never-depleting emergency floor (docs/economy.md).
   */
  getRawSalvagePerSecond(): number {
    if (!this.economyBreakdown) return 0;
    return Math.max(0, (this.economyBreakdown.production['rawmaterials'] ?? 0) - this.economyBreakdown.depositMiningPerSecond);
  }

  getConsumptionForCurrency(): number {
    if (!this.economyBreakdown || !this.selectedCurrency) return 0;
    return this.economyBreakdown.consumption[this.selectedCurrency] ?? 0;
  }

  getNetForCurrency(): number {
    if (!this.economyBreakdown || !this.selectedCurrency) return 0;
    return this.economyBreakdown.net[this.selectedCurrency] ?? 0;
  }

  getPlanetNet(planet: { netRates: Partial<Record<ResourceType, number>> }): number {
    if (!this.selectedCurrency) return 0;
    return planet.netRates[this.selectedCurrency] ?? 0;
  }

  getPlanetProduction(planet: { production: Partial<Record<ResourceType, number>> }): number {
    if (!this.selectedCurrency) return 0;
    return planet.production[this.selectedCurrency] ?? 0;
  }

  getPlanetConsumption(planet: { consumption: Partial<Record<ResourceType, number>> }): number {
    if (!this.selectedCurrency) return 0;
    return planet.consumption[this.selectedCurrency] ?? 0;
  }

  hasPlanetActivity(planet: { production: Partial<Record<ResourceType, number>>; consumption: Partial<Record<ResourceType, number>> }): boolean {
    if (!this.selectedCurrency) return false;
    return (planet.production[this.selectedCurrency] ?? 0) !== 0 || (planet.consumption[this.selectedCurrency] ?? 0) !== 0;
  }
}

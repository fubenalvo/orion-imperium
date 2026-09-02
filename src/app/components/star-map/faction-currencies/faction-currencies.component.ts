import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown, ResourceType } from '../../../services/economy.service';

export interface CurrencyDisplay {
  name: string;
  value: number;
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

  showBreakdown = false;
  selectedCurrency: ResourceType | null = null;
  expandedPlanet: string | null = null;

  toggleBreakdown(currencyName: string): void {
    const validCurrencies: ResourceType[] = ['credits', 'rawmaterials', 'research'];
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

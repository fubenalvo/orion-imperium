import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EconomyBreakdown } from '../../../services/economy.service';

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
  expandedPlanet: string | null = null;

  toggleBreakdown(): void {
    this.showBreakdown = !this.showBreakdown;
  }

  closeBreakdown(): void {
    this.showBreakdown = false;
    this.expandedPlanet = null;
  }

  togglePlanet(planetName: string): void {
    this.expandedPlanet = this.expandedPlanet === planetName ? null : planetName;
  }

  isPlanetExpanded(planetName: string): boolean {
    return this.expandedPlanet === planetName;
  }
}

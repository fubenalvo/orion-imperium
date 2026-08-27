import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CurrencyDisplay {
  name: string;
  value: number;
}

@Component({
  selector: 'app-faction-currencies',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './faction-currencies.component.html',
  styleUrl: './faction-currencies.component.scss'
})
export class FactionCurrenciesComponent {
  @Input() currencies: CurrencyDisplay[] = [];
}

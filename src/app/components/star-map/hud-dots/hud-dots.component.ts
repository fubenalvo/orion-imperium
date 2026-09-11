import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-hud-dots',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hud-dots.component.html',
  styleUrl: './hud-dots.component.scss',
})
export class HudDotsComponent {
  @Input() count = 4;
  @Input() active = 3;
  @Input() size: 'sm' | 'md' = 'md';

  get dots(): boolean[] {
    return Array.from({ length: this.count }, (_, i) => i < this.active);
  }
}

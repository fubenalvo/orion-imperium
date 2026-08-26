import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Battle } from '../../services/battle.service';

@Component({
  selector: 'app-battle-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss'
})
export class BattleScreenComponent {
  battle: Battle | null = null;

  constructor(
    private router: Router,
    private battleService: BattleService
  ) {
    this.battle = this.battleService.getBattle();
  }

  backToStarMap(): void {
    this.battleService.clearBattle();
    this.router.navigate(['/star-map']);
  }
}

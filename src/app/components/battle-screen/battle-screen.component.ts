import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Battle, BattleResult } from '../../services/battle.service';

@Component({
  selector: 'app-battle-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss'
})
export class BattleScreenComponent implements OnInit {
  battle: Battle | null = null;
  result: BattleResult | null = null;
  battleResolved = false;

  constructor(
    private router: Router,
    private battleService: BattleService
  ) {
    this.battle = this.battleService.getBattle();
  }

  ngOnInit(): void {
    if (this.battle) {
      this.result = this.battleService.resolveBattle();
      this.battleResolved = true;
    }
  }

  backToStarMap(): void {
    this.battleService.clearBattle();
    const loserId = this.result?.loser.id;
    if (loserId != null) {
      this.battleService.setDestroyedFleetId(loserId);
    }
    this.router.navigate(['/star-map']);
  }

  getWinnerName(): string {
    return this.result?.winner.name ?? '';
  }

  getLoserName(): string {
    return this.result?.loser.name ?? '';
  }

  getFleetScore(fleetId: number): number {
    if (!this.result || !this.battle) return 0;
    return this.battle.fleet1.id === fleetId ? this.result.fleet1Score : this.result.fleet2Score;
  }

  getFleetAttack(fleetId: number): number {
    if (!this.battle || !this.result) return 0;
    return this.battle.fleet1.id === fleetId ? this.result.fleet1Attack : this.result.fleet2Attack;
  }

  getFleetShield(fleetId: number): number {
    if (!this.battle || !this.result) return 0;
    return this.battle.fleet1.id === fleetId ? this.result.fleet1Shield : this.result.fleet2Shield;
  }

  isWinner(fleetId: number): boolean {
    return this.result?.winner.id === fleetId;
  }

  isLoser(fleetId: number): boolean {
    return this.result?.loser.id === fleetId;
  }
}

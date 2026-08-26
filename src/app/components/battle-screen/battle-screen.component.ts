import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Battle, BattleResult, FleetShip } from '../../services/battle.service';

/*
 * =========================================================
 * BATTLE SCREEN COMPONENT
 * =========================================================
 *
 * Temporary view for battle resolution.
 * Reads battle data from BattleService, resolves it immediately,
 * and displays the result.
 *
 * Navigation flow:
 * 1. StarMap detects collision -> BattleService.setBattle() -> navigate to /battle
 * 2. BattleScreen resolves battle in ngOnInit()
 * 3. User clicks "Back to Star Map" -> loser marked destroyed -> navigate back
 * 4. StarMap processes destroyedFleetId on next init
 */

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

  /*
   * backToStarMap: Transitions back to the star map after battle.
   * The loser fleet is marked as destroyed and its ID is stored
   * in BattleService so StarMap can process it on next init.
   */
  backToStarMap(): void {
    this.battleService.clearBattle();
    const loser = this.result?.loser;
    if (loser) {
      loser.destroyed = true;
      this.battleService.setDestroyedFleetId(loser.id);
    }
    this.router.navigate(['/star-map']);
  }

  getWinnerName(): string {
    return this.result?.winner.name ?? '';
  }

  getLoserName(): string {
    return this.result?.loser.name ?? '';
  }

  /*
   * getFleetScore: Returns the score for the specified fleet.
   * NOTE: There is a bug in the template (line 31 of battle-screen.component.html)
   * where the score display always shows result.fleet1Score regardless of which fleet won.
   * This method itself is correct.
   */
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

  getShipTypeCounts(ships: FleetShip[]): { type: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const ship of ships) {
      counts.set(ship.type, (counts.get(ship.type) ?? 0) + 1);
    }
    return Array.from(counts.entries(), ([type, count]) => ({ type, count }));
  }
}

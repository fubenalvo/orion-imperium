import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Battle, BattleState, BattleLogEntry, FleetShip } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';

/*
 * =========================================================
 * BATTLE SCREEN COMPONENT
 * =========================================================
 *
 * View for turn-based battle simulation.
 *
 * Navigation flow:
 * 1. StarMap detects collision -> BattleService.setBattle() -> navigate to /battle
 * 2. BattleScreen initializes battle in ngOnInit()
 * 3. A timer calls processStep() every tickRateMs
 * 4. Each step processes one ship attack and updates the UI
 * 5. When battle ends, "Back to Star Map" becomes visible
 * 6. On back navigation, loser fleet is marked destroyed -> navigate back
 * 7. StarMap processes destroyedFleetId on next init
 */

@Component({
  selector: 'app-battle-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './battle-screen.component.html',
  styleUrl: './battle-screen.component.scss'
})
export class BattleScreenComponent implements OnInit, OnDestroy {
  battle: Battle | null = null;
  battleState: BattleState | null = null;
  battleLog: BattleLogEntry[] = [];
  battleOver = false;
  private stepTimer: any = null;

  constructor(
    private router: Router,
    private battleService: BattleService,
    private shipService: ShipService,
    private planetBattleService: PlanetBattleService,
    private cdr: ChangeDetectorRef
  ) {
    this.battle = this.battleService.getBattle();
  }

  ngOnInit(): void {
    if (this.battle) {
      this.battleService.startBattle();
      this.battle = this.battleService.getBattle();
      this.battleState = this.battleService.getBattleState();
      this.battleLog = this.battleService.getBattleLog();
      this.battleOver = this.battleService.isBattleOver();
      this.startStepTimer();
    }
  }

  ngOnDestroy(): void {
    this.stopStepTimer();
  }

  private startStepTimer(): void {
    this.stopStepTimer();
    const tickRate = this.battleService.getTickRate();
    this.stepTimer = setInterval(() => {
      this.tick();
    }, tickRate);
  }

  private stopStepTimer(): void {
    if (this.stepTimer) {
      clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
  }

  private tick(): void {
    const processed = this.battleService.processStep();
    if (processed) {
      this.battle = this.battleService.getBattle();
      this.battleLog = [...this.battleService.getBattleLog()];
      this.battleState = this.battleService.getBattleState();
    }

    if (this.battleService.isBattleOver()) {
      this.battleOver = true;
      this.stopStepTimer();
      this.battle = this.battleService.getBattle();
      this.battleState = this.battleService.getBattleState();
    }

    this.cdr.detectChanges();
  }

  backToStarMap(): void {
    this.stopStepTimer();
    const battle = this.battleService.getBattle();
    const loser = this.battleService.getLoser();
    this.battleService.clearBattle();

    if (battle?.type === 'planet') {
    } else if (loser) {
      loser.destroyed = true;
      this.battleService.setDestroyedFleetId(loser.id);
    }
    this.router.navigate(['/star-map']);
  }

  getWinnerName(): string {
    return this.battleService.getWinner()?.name ?? '';
  }

  getLoserName(): string {
    return this.battleService.getLoser()?.name ?? '';
  }

  isWinner(fleetId: number): boolean {
    return this.battleService.getWinner()?.id === fleetId;
  }

  isLoser(fleetId: number): boolean {
    return this.battleService.getLoser()?.id === fleetId;
  }

  getFleetShips(fleetId: number): FleetShip[] {
    if (!this.battle) return [];
    const fleet = fleetId === this.battle.fleet1.id ? this.battle.fleet1 : this.battle.fleet2;
    return fleet.ships;
  }

  getShipTypeCounts(ships: FleetShip[]): { type: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const ship of ships) {
      counts.set(ship.type, (counts.get(ship.type) ?? 0) + 1);
    }
    return Array.from(counts.entries(), ([type, count]) => ({ type, count }));
  }

  getAliveCount(ships: FleetShip[]): number {
    return ships.filter((s) => !s.destroyed).length;
  }

  getCurrentPhase(): string {
    if (!this.battleState || this.battleOver) return 'BATTLE OVER';
    if (this.battleState.currentFleetId === this.battleState.attackerId) {
      return 'ATTACKER TURN';
    }
    return 'DEFENDER TURN';
  }

  getMaxHp(shipTypeId: string): number {
    const shipType = this.shipService.getShipType(shipTypeId);
    if (shipType) return shipType.hitPoints;
    const virtualType = this.planetBattleService.getVirtualShipType(shipTypeId);
    return virtualType?.hitPoints ?? 1;
  }
}

import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BattleService, Battle, BattleState, BattleLogEntry, FleetShip, Fleet } from '../../services/battle.service';
import { ShipService } from '../../services/ship.service';
import { PlanetBattleService } from '../../services/planet-battle.service';
import { SaveGameService, SaveSlotId } from '../../services/save-game.service';
import { GameTimeService } from '../../services/game-time.service';

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
    private saveGameService: SaveGameService,
    private gameTimeService: GameTimeService,
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
    // Freeze the galaxy-map simulation while the player is on the battle
    // screen. Without this, StarMap's RAF loop (and the movement, AI,
    // economy and battle-detection it drives) keeps running in the
    // background because Angular reuses the StarMap component instance
    // across the /star-map -> /battle -> /star-map navigation. That
    // causes fleets to move, resources to tick and, worst case, new
    // battles to trigger while the player is fighting this one, which
    // looks indistinguishable from a full state reset on return.
    this.gameTimeService.pause();
  }

  ngOnDestroy(): void {
    this.stopStepTimer();
    // Resume the galaxy-map simulation as we leave the battle screen so
    // the player returns to a live world. Back to Star Map also calls
    // resume defensively before navigating, but this catches the case
    // where the component is torn down via browser back / route reuse.
    this.gameTimeService.resume();
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
    const winner = this.battleService.getWinner();

    this.battleService.clearBattle();

    if (battle?.type === 'planet' && battle.planetId && winner) {
      this.applyPlanetBattleResult(battle, winner, loser);
    } else if (loser) {
      this.persistFleetBattleResult(loser);
    }

    // Resume the galaxy-map simulation before navigating so that the
    // returned-to StarMap component is already receiving scaled deltas
    // and the player sees a live world. ngOnDestroy would also resume,
    // but Angular may not tear this component down before the StarMap
    // is shown again, so resume here as a safety net.
    this.gameTimeService.resume();

    this.router.navigate(['/star-map']);
  }

  /**
   * Persists the outcome of a fleet-vs-fleet battle to the autosave slot
   * before navigating back to the star map. The active session is always
   * backed by the autosave slot, so this mutation is read back by
   * StarMap.reloadAfterBattle() on the next /star-map navigation even
   * though the StarMap component instance is recreated between routes.
   */
  private persistFleetBattleResult(loser: Fleet): void {
    loser.destroyed = true;
    this.battleService.setDestroyedFleetId(loser.id);

    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.fleets) {
      // No save to patch — StarMap.reloadAfterBattle() will still pick
      // up the destroyedFleetId and apply it in-memory.
      return;
    }

    const fleet = data.fleets.find((f) => f.id === loser.id);
    if (fleet) {
      fleet.destroyed = true;
      this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
    }
  }

  private applyPlanetBattleResult(battle: Battle, winner: Fleet, loser: Fleet | null): void {
    const data = this.saveGameService.loadFromSlot(SaveSlotId.AUTOSAVE);
    if (!data || !data.starSystems) return;

    for (const system of data.starSystems) {
      const planet = system.planetsTiles?.find((p) => p.id === battle.planetId);
      if (!planet) continue;

      if (winner.id === battle.attackerId) {
        planet.factionId = winner.factionId;
      } else {
        const fleet = data.fleets?.find((f) => f.id === battle.attackerId);
        if (fleet) {
          fleet.destroyed = true;
        }
      }
      break;
    }

    this.saveGameService.saveToSlot(SaveSlotId.AUTOSAVE, data);
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

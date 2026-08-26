import { Injectable } from '@angular/core';
import { ShipService } from './ship.service';

@Injectable({ providedIn: 'root' })
export class BattleService {
  private currentBattle: Battle | null = null;
  private battleResult: BattleResult | null = null;
  private destroyedFleetId: number | null = null;

  constructor(private shipService: ShipService) {}

  setBattle(battle: Battle): void {
    this.currentBattle = battle;
    this.battleResult = null;
    this.destroyedFleetId = null;
  }

  getBattle(): Battle | null {
    return this.currentBattle;
  }

  getBattleResult(): BattleResult | null {
    return this.battleResult;
  }

  setDestroyedFleetId(fleetId: number): void {
    this.destroyedFleetId = fleetId;
  }

  getDestroyedFleetId(): number | null {
    return this.destroyedFleetId;
  }

  resolveBattle(): BattleResult {
    if (!this.currentBattle) {
      throw new Error('No battle to resolve');
    }

    const shipTypeMap = this.shipService.getShipTypeMap();

    const fleet1Attack = this.calculateTotalAttack(this.currentBattle.fleet1, shipTypeMap);
    const fleet1Shield = this.calculateTotalShield(this.currentBattle.fleet1, shipTypeMap);
    const fleet2Attack = this.calculateTotalAttack(this.currentBattle.fleet2, shipTypeMap);
    const fleet2Shield = this.calculateTotalShield(this.currentBattle.fleet2, shipTypeMap);

    const fleet1Score = Math.max(0, fleet1Attack - fleet2Shield);
    const fleet2Score = Math.max(0, fleet2Attack - fleet1Shield);

    const winner = fleet1Score >= fleet2Score ? this.currentBattle.fleet1 : this.currentBattle.fleet2;
    const loser = winner.id === this.currentBattle.fleet1.id ? this.currentBattle.fleet2 : this.currentBattle.fleet1;

    this.battleResult = {
      fleet1Score,
      fleet2Score,
      fleet1Attack,
      fleet1Shield,
      fleet2Attack,
      fleet2Shield,
      winner,
      loser,
      isDraw: fleet1Score === fleet2Score,
    };

    return this.battleResult;
  }

  private calculateTotalAttack(fleet: Fleet, shipTypes: Map<string, { attack: number; shield: number }>): number {
    return fleet.ships.reduce((sum, ship) => sum + (shipTypes.get(ship.type)?.attack ?? 0), 0);
  }

  private calculateTotalShield(fleet: Fleet, shipTypes: Map<string, { attack: number; shield: number }>): number {
    return fleet.ships.reduce((sum, ship) => sum + (shipTypes.get(ship.type)?.shield ?? 0), 0);
  }

  clearBattle(): void {
    this.currentBattle = null;
    this.battleResult = null;
    this.destroyedFleetId = null;
  }
}

export interface Fleet {
  id: number;
  name: string;
  factionId: string;
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  speed: number;
  systemId?: number;
  systemX?: number | null;
  systemY?: number | null;
  systemTargetX?: number | null;
  systemTargetY?: number | null;
  gridCol: number;
  gridRow: number;
  ships: FleetShip[];
  destroyed?: boolean;
}

export interface FleetShip {
  id: number;
  name: string;
  type: string;
}

export interface Battle {
  fleet1: Fleet;
  fleet2: Fleet;
  faction1Name: string;
  faction1Color: string;
  faction2Name: string;
  faction2Color: string;
}

export interface BattleResult {
  fleet1Score: number;
  fleet2Score: number;
  fleet1Attack: number;
  fleet1Shield: number;
  fleet2Attack: number;
  fleet2Shield: number;
  winner: Fleet;
  loser: Fleet;
  isDraw: boolean;
}
